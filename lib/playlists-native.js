// @ts-check
"use strict";
/*
 * playlists-native.js — N2d (dev/design/native-remote.md §11, v1.9.42): playlists made and changed in
 * Rouen, in Roon itself, with native mode on (lib/roon-direct/playlists.js makes the calls).
 *
 *   GET  /api/roon-playlists                 whether Roon's playlists can be changed here, and which
 *   POST /api/roon-playlists/add {id? | name?, tracks? | albums?}
 *        → {ok, name, id, added, missing} | {ok: false, fallback: true, why}
 *   POST /api/roon-playlists/rename {id, name}       POST /api/roon-playlists/delete {id}
 *   POST /api/roon-playlists/copy            Rouen's own playlists made in Roon, once (begun here,
 *   GET  /api/roon-playlists/copy            followed here, as the add-to-library check is)
 *
 * Believed (§11.3) when the call answers "Success" and the official API's playlist list — what Roon's
 * own apps and Rouen's Playlists screen show — shows it within 10 s: one more playlist of the name made
 * or given, one fewer of a name deleted; an add by the playlist's track count ("N Tracks", else your
 * server's own TrackCount) up by the tracks sent, or at all for albums. An add not sent, or not shown,
 * answers `fallback` with why: the page then adds the tracks to Rouen's own playlist of that name, as
 * before (the owner, 2026-10-21), so nothing picked is lost; one partly taken answers the tracks not
 * taken (`kept`), for the page to keep. A rename or a delete not shown is only said.
 */

/**
 * @typedef {{ title: string, subtitle: string }} Official  a playlist as the official API lists it
 * @typedef {{ title: string, album_title: string, album_subtitle: string }} Track
 */

/** The track count an official list's subtitle gives ("12 Tracks"), or null. @param {string} sub */
const countOf = (sub) => { const m = /(\d[\d,]*)/.exec(String(sub || "")); return m ? Number(m[1].replace(/,/g, "")) : null; };

/**
 * @param {{ playlists: () => ReturnType<typeof import("./roon-direct/playlists").createPlaylists>,
 *           official: () => Promise<Official[]>, rouen: () => Array<{ name: string, tracks: Track[] }>,
 *           limits?: { tracks: number, albums: number, name: number },
 *           log?: (line: string) => void, pollMs?: number, waitMs?: number }} deps
 *   official: the official API's playlist list, read anew; rouen: Rouen's own playlists, with their tracks;
 *   limits: an add's, Rouen's own playlists' (the fallback must be able to take what was asked)
 */
function createNativePlaylists(deps) {
  const log = deps.log || (() => {});
  const pollMs = deps.pollMs === undefined ? 2000 : deps.pollMs;
  const waitMs = deps.waitMs === undefined ? 10000 : deps.waitMs;

  /** The official list, as it is now; null when it can't be read. */
  async function officialNow() {
    try { return await deps.official(); } catch (e) { return null; }   // unreadable: the caller asks again (shows), or says so
  }
  /** @param {Official[]} list @param {string} name */
  const named = (list, name) => list.find((p) => p.title === name) || null;
  /** How many playlists of this name the official list shows. @param {Official[]} list @param {string} name */
  const howMany = (list, name) => list.filter((p) => p.title === name).length;
  /**
   * A playlist's track count now: the official list's subtitle ("N Tracks") when it is one there and says a
   * number, else your server's own TrackCount; null when neither can say.
   * @param {string} id @param {string} name @param {Official[] | null} [list]
   */
  async function countNow(id, name, list) {
    const l = list === undefined ? await officialNow() : list;
    const n = l && howMany(l, name) === 1 ? countOf(/** @type {Official} */ (named(l, name)).subtitle) : null;
    if (n !== null) return n;
    const own = await deps.playlists().list();
    const p = "playlists" in own ? own.playlists.find((x) => x.id === id) : null;
    return p ? p.tracks : null;
  }
  /** Whether the official list comes to show `test` within waitMs. @param {(list: Official[]) => boolean} test */
  async function shows(test) {
    const until = Date.now() + waitMs;
    for (;;) {
      const list = await officialNow();
      if (list && test(list)) return true;
      if (Date.now() >= until) return false;
      await new Promise((r) => { setTimeout(r, pollMs); });
    }
  }

  /**
   * Tracks or albums added to a Roon playlist (made first when only a name is given), and believed.
   * @param {{ id?: string, name?: string, tracks?: Track[], albums?: Array<{ title: string, subtitle: string }> }} b
   */
  async function add(b) {
    const pl = deps.playlists();
    let made = false;
    let id = b.id || null;
    let name = b.name || "";
    /** @param {string} why */
    const fallback = (why) => ({ ok: /** @type {const} */ (false), fallback: true, why, name, made });
    if (!id) {
      const before = await officialNow();
      const was = before ? howMany(before, name) : null;
      const out = await pl.create(name);
      if ("notSent" in out) return fallback(out.notSent);
      if ("error" in out) return fallback(out.error);
      made = true;
      id = out.id;
      name = out.name;
      if (was === null || !(await shows((list) => howMany(list, name) > was))) return fallback(`Roon didn't show the new playlist "${name}".`);
    } else {
      const listed = await pl.list();
      if ("notSent" in listed) return fallback(listed.notSent);
      const p = listed.playlists.find((x) => x.id === id);
      if (!p) return fallback("Your server doesn't list that playlist any more.");
      name = p.name;
    }
    const had = await countNow(id, name);
    const out = b.albums ? await pl.addAlbums(id, b.albums) : await pl.addTracks(id, b.tracks || []);
    if ("notSent" in out) return fallback(out.notSent);
    if ("error" in out) return fallback(out.error);
    // Albums are counted by Roon in tracks: shown once the count has gone up at all; tracks, by the number sent.
    const enough = (/** @type {number | null} */ n) => n !== null && had !== null && (b.albums ? n > had : n >= had + out.sent);
    let shown = false;
    for (const until = Date.now() + waitMs; !shown;) {
      shown = enough(await countNow(/** @type {string} */ (id), name));
      if (shown || Date.now() >= until) break;
      await new Promise((r) => { setTimeout(r, pollMs); });
    }
    if (!shown) return fallback(`Roon didn't show what was added to "${name}".`);
    log(`"${name}": ${out.sent} sent and shown, ${out.missing.length} not found, ${out.failed.length} not taken`);
    return { ok: /** @type {const} */ (true), via: "roon", id, name, added: out.sent, missing: out.missing, kept: out.failed, why: out.why };
  }

  /** The copy of Rouen's own playlists, as the page follows it. */
  let copy = { running: false, total: 0, /** @type {any[]} */ done: [], error: /** @type {string | null} */ (null) };

  async function copyAll() {
    const mine = deps.rouen();
    copy = { running: true, total: mine.length, done: [], error: null };
    try {
      for (const p of mine) {
        // Read before each, until it can be: a list not read can't say whether Roon has the name (the review).
        let now = await officialNow();
        if (!now) await shows((list) => { now = list; return true; });
        if (!now) { copy.done.push({ name: p.name, result: "failed", why: "Your server's playlist list couldn't be read; nothing was made for it." }); continue; }
        if (now.some((x) => x.title === p.name)) { copy.done.push({ name: p.name, result: "skipped", why: "Roon already has a playlist of that name." }); continue; }
        const out = await add({ name: p.name, tracks: p.tracks.map((t) => ({ title: t.title, album_title: t.album_title, album_subtitle: t.album_subtitle || "" })) });
        if (out.ok) copy.done.push({ name: p.name, result: "copied", added: out.added, of: p.tracks.length, missing: out.missing.concat(out.kept) });
        else copy.done.push({ name: p.name, result: "failed", why: out.why + (out.made ? " It was made in Roon: check it there before copying again." : "") });
      }
    } catch (e) {
      copy.error = "The copy stopped: " + (e && /** @type {any} */ (e).message);
    } finally {
      copy.running = false;
      log(`copied Rouen's playlists to Roon: ${copy.done.filter((d) => d.result === "copied").length} of ${copy.total}`);
    }
  }

  return {
    /** @returns {Promise<{ available: true, playlists: Array<{ id: string, name: string, tracks: number | null }> } | { available: false, why: string }>} */
    async list() {
      const r = await deps.playlists().list();
      if ("notSent" in r) return { available: false, why: r.notSent };
      return { available: true, playlists: r.playlists.filter((p) => !p.readOnly).map(({ id, name, tracks }) => ({ id, name, tracks })) };
    },
    add,
    /** @param {string} id @param {string} name */
    async rename(id, name) {
      const before = await officialNow();
      if (!before) return { error: "Your server's playlist list couldn't be read; nothing was renamed.", status: 503 };
      const was = howMany(before, name);
      const r = await deps.playlists().rename(id, name);
      if ("notSent" in r) return { error: r.notSent || "Native mode is off.", status: 409 };
      if ("error" in r) return { error: r.error, status: 502 };
      return (await shows((list) => howMany(list, name) > was)) ? { ok: true } : { error: `Roon didn't show the new name "${name}".`, status: 504 };
    },
    /** @param {string} id */
    async remove(id) {
      const before = await officialNow();
      if (!before) return { error: "Your server's playlist list couldn't be read; nothing was deleted.", status: 503 };
      const r = await deps.playlists().remove(id);
      if ("notSent" in r) return { error: r.notSent || "Native mode is off.", status: 409 };
      if ("error" in r) return { error: r.error, status: 502 };
      const was = howMany(before, r.name);
      return (await shows((list) => howMany(list, r.name) < was)) ? { ok: true } : { error: `Roon still shows "${r.name}".`, status: 504 };
    },
    limits: () => deps.limits || { tracks: 200, albums: 30, name: 60 },
    /** Begun, to follow with copyProgress(); one at a time. */
    startCopy() {
      if (copy.running) return { error: "A copy is already running.", status: 409 };
      copyAll().catch((e) => { log("copy failed: " + (e && e.message)); });
      return { running: true, total: deps.rouen().length };
    },
    copyProgress: () => ({ running: copy.running, total: copy.total, done: copy.done.slice(), error: copy.error }),
  };
}

/** @param {unknown} v @param {number} max */
const text = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const ID = /^[0-9a-f]{2,64}$/;

/**
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof createNativePlaylists>} np
 */
function mountNativePlaylists(app, np) {
  /** An answer, or the error as it came. @param {(req: any) => Promise<any>} fn */
  const route = (fn) => async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    try {
      const out = await fn(req);
      if (out && "error" in out && typeof out.status === "number") return res.status(out.status).json({ ok: false, error: out.error });
      res.json(out);
    } catch (e) {
      // Unanswered, or the connection gone mid-way: said as it came, never protocol bytes (it carries none).
      res.status(502).json({ ok: false, error: "That didn't reach your server: " + (e && /** @type {any} */ (e).message) });
    }
  };
  app.get("/api/roon-playlists", route(() => np.list()));
  app.post("/api/roon-playlists/add", route(async (req) => {
    const b = req.body || {};
    // Rouen's own playlists' limits: what Roon didn't take must fit the fallback (the review).
    const lim = np.limits();
    const id = typeof b.id === "string" && ID.test(b.id) ? b.id : null;
    const name = text(b.name, lim.name);
    const tracks = Array.isArray(b.tracks) && b.tracks.length <= lim.tracks && b.tracks.every((/** @type {any} */ t) => t && text(t.title, 1000) && text(t.album_title, 1000))
      ? b.tracks.map((/** @type {any} */ t) => ({ title: t.title, album_title: t.album_title, album_subtitle: typeof t.album_subtitle === "string" ? t.album_subtitle : "" })) : null;
    const albums = Array.isArray(b.albums) && b.albums.length <= lim.albums && b.albums.every((/** @type {any} */ a) => a && text(a.title, 1000))
      ? b.albums.map((/** @type {any} */ a) => ({ title: a.title, subtitle: typeof a.subtitle === "string" ? a.subtitle : "" })) : null;
    if ((!id && !name) || (!tracks === !albums) || (tracks && !tracks.length) || (albums && !albums.length)) {
      return { error: "a playlist (id or name) and tracks or albums, please", status: 400 };
    }
    return np.add(Object.assign(id ? { id } : { name: /** @type {string} */ (name) }, tracks ? { tracks } : { albums }));
  }));
  app.post("/api/roon-playlists/rename", route(async (req) => {
    const b = req.body || {};
    const name = text(b.name, np.limits().name);
    if (typeof b.id !== "string" || !ID.test(b.id) || !name) return { error: "id and name, please", status: 400 };
    return np.rename(b.id, name);
  }));
  app.post("/api/roon-playlists/delete", route(async (req) => {
    const b = req.body || {};
    if (typeof b.id !== "string" || !ID.test(b.id)) return { error: "id, please", status: 400 };
    return np.remove(b.id);
  }));
  app.post("/api/roon-playlists/copy", route(async () => np.startCopy()));
  app.get("/api/roon-playlists/copy", route(async () => np.copyProgress()));
}

module.exports = { createNativePlaylists, mountNativePlaylists, countOf };
