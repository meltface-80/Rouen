// @ts-check
"use strict";
/*
 * resolve.js — a Smart Pick's album, found and added (dev/design/smart-picks.md §11, 2.0.8-t9). The owner, 2026-11-26:
 * "How can we avoid having to rely on Qobuz being logged in or used. With native mode can we replace this."
 *
 *   find(name)   the album a candidate artist would be picked with: your server's own search for the name (native mode
 *                in use), the first of its albums in Roon's order credited to that artist, not in the library, on TIDAL
 *                or Qobuz with an AlbumId; else Rouen's own Qobuz search, then TIDAL's, where signed in. Kept a week,
 *                misses included, but only what a search answered: one that couldn't answer is asked again next time.
 *   add(...)     the album put in the pick's profile's library through "Add to library" (library-add.js): your
 *                server's own add, else the service favourite with Rouen's sign-in.
 *   ready()      whether anything can find an album at all: native mode in use (unless its searches have shown your
 *                server has no streaming service), or a service signed in.
 *
 * Moved out of index.js (resolveSmartAlbum, autoAddSmartAlbum, smartPicksServiceReady), the services' part unchanged.
 */

/** MediaSource, as find.js has it: the streaming services an album can be added from. */
const STREAMING = Object.freeze({ 128: "tidal", 256: "qobuz" });
/** Searches answered with no streaming album at all, before native mode is taken to have no service to find one on. */
const NO_STREAMING_AFTER = 10;
/** What the native adder answers for a profile with no Roon profile (roon-direct/session.js WHY_NOBODY): no add of Roon's. */
const { WHY_NOBODY } = require("../roon-direct/session");

/**
 * @typedef {{ service: string, id: string, title: string, artist?: string, image?: string | null }} PickAlbum
 *   id: the service's own album id; "" for one Roon found (its AlbumId is Roon's, not the service's)
 * @param {{
 *   canon: (name: string) => string, albumKey: (title: string, artist: string) => string | null,
 *   cacheGet: (key: string, ttlMs: number) => any, cacheSet: (key: string, value: any) => void, ttlMs: number,
 *   native: () => { albumsBy: (name: string) => Promise<{ hits: import("../roon-direct/find").Hit[] } | { error: string }> } | null,
 *   qobuz: { ready: () => boolean, albums: (name: string) => Promise<any[]> },
 *   tidal: { ready: () => boolean, artists: (name: string) => Promise<any>, albums: (artistId: string) => Promise<any[]> },
 *   deezer?: (path: string) => Promise<any>,
 *   libraryAdd: () => { add: (w: { title: string, artist: string, service: "tidal" | "qobuz", albumId: string | null }) => Promise<any> } | null,
 *   asRoonOf: <T>(profile: string, fn: () => T) => T,
 *   signedIn: (service: "tidal" | "qobuz") => boolean, favourite: (service: "tidal" | "qobuz", albumId: string) => Promise<void>,
 *   rateLimited: (e: any) => boolean, log?: (line: string) => void, error?: (line: string) => void,
 * }} d
 *   native: native mode's search while native mode is in use, else null; qobuz.albums: Rouen's own Qobuz search, its
 *   albums normalized; tidal.artists: its artist search page ({ items }), tidal.albums: an artist's albums normalized;
 *   deezer: Deezer's API, for a cover Roon's own key can't give (native-remote.md §12.17); albumKey: Rouen's key for an
 *   album (index.js albumKey), null when its title has nothing it keys by; favourite: the service favourite (as before
 *   2.0.8-t9), for a profile with no Roon profile to add as
 */
function createPickAlbums(d) {
  const log = d.log || (() => {});
  const error = d.error || log;
  /** Since the last tally (a build's start): candidates Roon's search answered for and found an album for; candidates
   * anything answered for (a search, or what one answered before); whether Roon's not answering has been said. */
  let asked = 0, found = 0, heard = 0, saidRoon = false;
  /** Whether your server's search has shown it has a streaming service: true once any search gave a TIDAL or Qobuz album,
   * false after NO_STREAMING_AFTER answered without one (a library of its own files only), null until then. */
  let streams = /** @type {boolean | null} */ (null), dry = 0;
  /** The day the build was last said to be skipped. */
  let skipSaid = "";

  /** One album as Rouen keys it, else as written ("+"). @param {{ title: string, artist: string }} x */
  const keyOf = (x) => d.albumKey(x.title, x.artist) || `=${String(x.title).normalize("NFKC").toLowerCase().trim()}|${d.canon(x.artist)}`;

  /** A cover for an album Roon found, from Deezer's album search; "" when it has none to be sure of. @param {string} title @param {string} artist */
  async function coverOf(title, artist) {
    if (!d.deezer) return "";
    try {
      // A quote would end the search's own: dropped from the terms (the review).
      const q = (/** @type {string} */ v) => v.replace(/"/g, " ");
      const j = await d.deezer("search/album?limit=10&q=" + encodeURIComponent(`artist:"${q(artist)}" album:"${q(title)}"`));
      const want = keyOf({ title, artist });
      const a = ((j && j.data) || []).find((/** @type {any} */ x) => x && x.artist && keyOf({ title: String(x.title || ""), artist: String(x.artist.name || "") }) === want);
      return a ? String(a.cover_big || a.cover_medium || a.cover_xl || "") : "";
    } catch (e) {
      return "";   // a picture only: the pick shows its plain tile, as one with no cover always has
    }
  }

  /**
   * Roon's: undefined when its search couldn't be asked or couldn't answer (the next is tried, nothing kept); else the
   * album, or null for an answer with none. @param {string} name @param {string} want
   * @returns {Promise<PickAlbum | null | undefined>}
   */
  async function onRoon(name, want) {
    const n = d.native();
    if (!n) return undefined;
    const r = await n.albumsBy(name);
    if ("error" in r) {
      // Once a build: the same why (no room, not connected) would come for every candidate.
      if (!saidRoon) log(`[picks] Roon's search for ${JSON.stringify(name)} didn't answer: ${r.error}`);
      saidRoon = true;
      return undefined;
    }
    asked++;
    if (r.hits.some((h) => h.contentSource !== null && h.contentSource in STREAMING)) streams = true;
    else if (streams !== true && ++dry >= NO_STREAMING_AFTER && streams === null) {
      streams = false;
      log(`[picks] ${NO_STREAMING_AFTER} of Roon's searches found no TIDAL or Qobuz album at all: your server seems to have no streaming service, so Smart Picks need Rouen's own sign-in`);
    }
    const hit = r.hits.find((h) => !h.inLibrary && h.albumId !== null && h.contentSource !== null && h.contentSource in STREAMING && d.canon(h.artist) === want);
    if (!hit) return null;
    found++;
    const service = /** @type {any} */ (STREAMING)[/** @type {number} */ (hit.contentSource)];
    return { service, id: "", title: hit.title, artist: hit.artist, image: await coverOf(hit.title, hit.artist) };
  }

  return {
    ready: () => (!!d.native() && streams !== false) || d.qobuz.ready() || d.tidal.ready(),

    /**
     * Since the last tally, reset (each build takes one at its start and one at its end): what Roon's search answered,
     * for the build's log line, and how many candidates anything answered for — none, and the build found nothing it
     * may keep as a day's answer (smart-picks.md §11).
     */
    tally() { const t = { asked, found, heard }; asked = 0; found = 0; heard = 0; saidRoon = false; return t; },

    /** Whether the skip with nothing to find albums with is to be said: once a day. @param {string} day */
    sayNotReady(day) { const say = skipSaid !== day; skipSaid = day; return say; },

    /**
     * The album to pick the artist with, or null. PERSISTED, INCLUDING MISSES: the one call that dominates a build —
     * every candidate TRIED costs a search, not every candidate kept. A miss is stored as { album: null }, which is
     * truthy, so a cached negative is told from a cache miss.
     * @param {string} artistName @returns {Promise<PickAlbum | null>}
     */
    async find(artistName) {
      const wantCanon = d.canon(artistName);
      if (!wantCanon) return null;
      const key = "alb:" + wantCanon;
      const hit = d.cacheGet(key, d.ttlMs);
      if (hit) { heard++; return hit.album; }

      /** @type {PickAlbum | null} */
      let album = null;
      // Whether a search actually ANSWERED. A negative may only be cached when one did: caching "no album" after
      // consulting nothing would write up to 150 dead entries on a machine with nothing to search, and the user who
      // then connects Qobuz or turns native mode on would get an empty feature for the next seven days. A thrown
      // lookup is the same case: a one-minute token blip must not become a week-long hole.
      let answered = false, errored = false;
      // Roon's misses are kept on their own (the review): kept with the services' they would stop Rouen's own sign-in,
      // connected later, from being asked for a week.
      const roonKey = "alb-roon:" + wantCanon;
      const roonMissed = !!d.cacheGet(roonKey, d.ttlMs);
      const roon = roonMissed ? null : await onRoon(artistName, wantCanon);
      if (roon !== undefined) heard++;
      if (roon === null && !roonMissed) d.cacheSet(roonKey, { album: null });
      if (roon) album = roon;
      if (!album && d.qobuz.ready()) {
        try {
          const albums = await d.qobuz.albums(artistName);
          answered = true;
          // Qobuz search matches on title as well as artist, so an unfiltered top hit is regularly a different act
          // covering the name. Require the credit to be the artist asked for, in the space the candidates are keyed in.
          const q = albums.find((a) => d.canon(a.artist) === wantCanon);
          if (q) album = Object.assign({ service: "qobuz" }, q);
        } catch (e) {
          if (d.rateLimited(e)) throw e;      // abort the build, do not hammer
          errored = true;
          error(`[picks] Qobuz album lookup for ${JSON.stringify(artistName)} failed: ${/** @type {Error} */ (e).message}`);
        }
      }
      if (!album && d.tidal.ready()) {
        try {
          // searchArtists returns a page — { items, total } — NOT an array.
          const page = await d.tidal.artists(artistName);
          answered = true;
          const a = ((page && page.items) || []).find((/** @type {any} */ x) => x && d.canon(x.name) === wantCanon);
          if (a && a.id) {
            const albums = await d.tidal.albums(String(a.id));
            if (albums.length) album = Object.assign({ service: "tidal" }, albums[0]);
          }
        } catch (e) {
          if (d.rateLimited(e)) throw e;
          errored = true;
          error(`[picks] TIDAL album lookup for ${JSON.stringify(artistName)} failed: ${/** @type {Error} */ (e).message}`);
        }
      }
      if (answered && roon === undefined) heard++;
      if (album || (answered && !errored)) d.cacheSet(key, { album });
      return album;
    },

    /**
     * A pick's album put in the library, as its profile's devices act in Roon: your server's own add, else the
     * service favourite. True when it was sent or is there already; false (logged) when it couldn't be — the pick
     * still ships, to be added by hand. Too many requests from a service is thrown, to stop the build.
     * @param {PickAlbum} album @param {string} artist  the pick's artist, when the album has no credit of its own
     * @param {string} profile
     */
    async add(album, artist, profile) {
      const la = d.libraryAdd();
      if (!album || !album.service || !la || !(album.service === "qobuz" || album.service === "tidal")) return false;
      const service = /** @type {"tidal" | "qobuz"} */ (album.service);
      let r;
      try {
        r = await d.asRoonOf(profile, () => la.add({ title: album.title, artist: album.artist || artist, service, albumId: album.id || null }));
        // A profile with no Roon profile to add as (§11, the review): the service favourite, as before 2.0.8-t9, where
        // Rouen is signed in and the album has the service's id.
        if (r && r.error === WHY_NOBODY && album.id && d.signedIn(service)) { await d.favourite(service, album.id); r = { ok: true }; }
      } catch (e) {
        if (d.rateLimited(e)) throw e;
        r = { error: String((e && /** @type {any} */ (e).message) || e) };
      }
      if (r && r.ok) return true;
      const why = (r && r.error) || "not added";
      if (r && r.status === 429) { const e = /** @type {any} */ (new Error(why)); e.code = 429; throw e; }
      error(`[picks] could not add ${JSON.stringify(album.title)} (${service}): ${why}`);
      return false;
    },
  };
}

module.exports = { createPickAlbums, STREAMING };
