// @ts-check
"use strict";
/*
 * library-add.js — "Add to library" (dev/design/native-remote.md §9.2, N2b-2, v1.9.41): a TIDAL or
 * Qobuz album put in your library, from its album page (TIDAL and Qobuz through Roon) and from
 * Smart Picks and Listen Later on Home.
 *
 *   POST /api/library/add {title, artist, service, album_id?}
 *        → {ok, via: "roon" | "service", state, offset?, library_title?, library_subtitle?, why?}
 *   GET  /api/library/add?title=&artist=
 *        → {state: "in-library" | "waiting" | "not-taken" | "none", offset?, library_title?, library_subtitle?, via?}
 * An album in the library is opened by Roon's own strings for it (library_title, library_subtitle): the play
 * routes check an album's identity against the library, and an edition named otherwise is refused.
 *
 * Native mode on: your server's own add (lib/roon-direct/adder.js), believed once the album is in
 * the library. Native mode off, or an add native mode could not send (its why said): today's way,
 * the album a favourite on the service with Rouen's own sign-in, which Roon imports on its next sync
 * (the owner, 2026-10-21). That needs the service's id for the album: the one the caller has (a
 * Smart Pick's, a Listen Later entry's), else Rouen's own search of that service by title and
 * artist, the album picked as the waveform's Qobuz lookup picks one, by the same builder (albumsearch.js).
 */
const { pickAlbumId, candidatesOf, NAMES_OF } = require("./albumsearch");

const NAMES = Object.freeze({ tidal: "TIDAL", qobuz: "Qobuz" });

/**
 * @typedef {{ offset: number, title: string, subtitle: string }} InLibrary
 * @param {{ adder: () => ReturnType<typeof import("./roon-direct/adder").createAdder> | null,
 *           inLibrary: (title: string, artist: string) => InLibrary | null,
 *           signedIn: (service: "tidal" | "qobuz") => boolean,
 *           favourite: (service: "tidal" | "qobuz", albumId: string) => Promise<void>,
 *           searchQobuz: (query: string) => Promise<any>, searchTidal: (query: string) => Promise<any>,
 *           wanted: (title: string, artist: string) => string[], titleForms: (title: string, version: string | null) => string[],
 *           keyOf: (title: string, artist: string) => string | null,
 *           errorStatus: (e: any) => number, log?: (line: string) => void, now?: () => number }} deps
 *   adder: native mode's (it says when native mode is off); inLibrary: where the album is in the library Rouen
 *   plays from, under Roon's strings; searchQobuz/searchTidal: the service's own catalogue search, as it answers
 */
function createLibraryAdd(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  /** Albums made a service favourite here, by their identity: Roon imports them when it syncs. @type {Map<string, number>} */
  const favourited = new Map();
  /** @param {string} title @param {string} artist */
  const idOf = (title, artist) => deps.wanted(title, artist)[0] || `${title}\u0000${artist}`;

  /** The service's id for the album, by Rouen's own search of it; null when it found none to be sure of. */
  async function findOnService(/** @type {"tidal" | "qobuz"} */ service, /** @type {string} */ title, /** @type {string} */ artist) {
    const q = `${title} ${artist}`.trim();
    const items = service === "qobuz" ? (((await deps.searchQobuz(q)) || {}).albums || {}).items : ((await deps.searchTidal(q)) || {}).items;
    const picked = pickAlbumId(deps.wanted(title, artist), candidatesOf(items, deps.titleForms, deps.keyOf, NAMES_OF[service]));
    log(`${NAMES[service]} search for "${title}": ${picked.id ? "album " + picked.id : "none"} — ${picked.reason}`);
    return picked.id ? String(picked.id) : null;
  }

  /** In the library: where, and under Roon's own strings. @param {InLibrary} rec */
  const there = (rec) => ({ state: "in-library", offset: rec.offset, library_title: rec.title, library_subtitle: rec.subtitle });

  return {
    /**
     * @param {{ title: string, artist: string, service: "tidal" | "qobuz", albumId: string | null }} w
     * @returns {Promise<{ ok: true, via?: "roon" | "service", state: string, offset?: number, why?: string | null, from?: string } | { error: string, status: number }>}
     */
    async add(w) {
      const here = deps.inLibrary(w.title, w.artist);
      if (here !== null) return Object.assign({ ok: /** @type {const} */ (true) }, there(here));
      const adder = deps.adder();
      /** Why native mode didn't add it, when it was on. @type {string | null} */
      let why = null;
      if (adder) {
        const r = await adder.add({ title: w.title, artist: w.artist, service: w.service });
        // `from`: the copy added — the other service's when the one asked for had none (the owner, 2026-10-21).
        if ("state" in r && r.state === "waiting") return { ok: true, via: "roon", state: "waiting", from: r.from };
        if ("state" in r && r.state === "in-library") {
          // Your server's search found it in your library: nothing to add. Where it is in Rouen's copy, when it can be told.
          const at = deps.inLibrary(w.title, w.artist);
          return at !== null ? Object.assign({ ok: /** @type {const} */ (true), via: /** @type {const} */ ("roon") }, there(at)) : { ok: true, via: "roon", state: "in-library" };
        }
        why = "notSent" in r ? r.notSent : null;
      }
      // Today's way: the service favourite, with Rouen's own sign-in.
      const name = NAMES[w.service];
      const lead = why ? why + " " : "";
      if (!deps.signedIn(w.service)) return { error: `${lead}Rouen isn't signed in to ${name}, so it can't add it as a ${name} favourite either.`, status: 409 };
      let id = w.albumId;
      try {
        if (!id) id = await findOnService(w.service, w.title, w.artist);
        if (!id) return { error: `${lead}${name}'s own search didn't find this album.`, status: 404 };
        await deps.favourite(w.service, id);
      } catch (e) {
        return { error: lead + String((/** @type {any} */ (e) && /** @type {any} */ (e).message) || e), status: deps.errorStatus(e) };
      }
      favourited.set(idOf(w.title, w.artist), now());
      // An add of your server's tried before and not taken is no longer what this album waits on (the review).
      if (adder) adder.forget(w.title, w.artist);
      log(`"${w.title}" made a ${name} favourite (album ${id})` + (why ? `; native mode didn't add it: ${why}` : ""));
      return { ok: true, via: "service", state: "waiting", why };
    },

    /** Where an album stands. @param {string} title @param {string} artist */
    state(title, artist) {
      const here = deps.inLibrary(title, artist);
      const adder = deps.adder();
      // The adder's word first: it is what settles an add sent (in the library, or not taken).
      const st = adder ? adder.state(title, artist) : null;
      if (st && st.state === "in-library" && here !== null) return Object.assign({ via: "roon" }, there(here));
      if (st && st.state !== "none" && st.state !== "in-library") return Object.assign({ via: "roon" }, st);
      if (here !== null) return there(here);
      if (favourited.has(idOf(title, artist))) return { state: "waiting", via: "service" };
      return { state: "none" };
    },
  };
}

/** @param {unknown} v */
const text = (v) => (typeof v === "string" && v.length <= 1000 ? v : null);

/**
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof createLibraryAdd>} la
 */
function mountLibraryAdd(app, la) {
  app.post("/api/library/add", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const title = text(b.title), artist = text(b.artist || "");
    const service = typeof b.service === "string" && Object.prototype.hasOwnProperty.call(NAMES, b.service) ? b.service : null;
    const albumId = b.album_id === undefined || b.album_id === null || b.album_id === "" ? null : text(String(b.album_id));
    if (title === null || !title.trim() || artist === null || !service || (b.album_id && albumId === null)) {
      return res.status(400).json({ error: "title, artist and service (tidal or qobuz), please" });
    }
    try {
      const out = await la.add({ title: title.trim(), artist: artist.trim(), service, albumId });
      if ("error" in out) return res.status(out.status).json({ ok: false, error: out.error });
      res.json(out);
    } catch (e) {
      // Unanswered, or the connection gone mid-way: said as it came, never protocol bytes (it carries none).
      res.status(502).json({ ok: false, error: "That didn't reach your server: " + (e && /** @type {any} */ (e).message) });
    }
  });
  app.get("/api/library/add", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = text(req.query.title), artist = text(req.query.artist || "");
    if (title === null || artist === null) return res.status(400).json({ error: "title and artist, please" });
    res.json(la.state(title.trim(), artist.trim()));
  });
}

module.exports = { createLibraryAdd, mountLibraryAdd, NAMES };
