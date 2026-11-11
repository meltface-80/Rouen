// @ts-check
"use strict";
/*
 * playlist-artists.js — each track's own artist in one of your Roon playlists, read from your server the way its smart
 * playlists already are (v2.0.3-t4, dev/design/playlist-artists.md). The official API gives a playlist's row one line
 * under its title, and for many tracks that line is the composers; the server's own item for the track names who
 * performed it.
 *
 *   The playlist found by its name among the chosen profile's (playlists.js's read; two of one name: none is guessed)
 *   → Playlist::VirtualItemsQuery a page at a time (playlist-items.js, proven on the owner's server for smart
 *   playlists, §12.2 of native-remote.md), each item its Track's title, artist (PerformedBy) and album → kept.
 *
 * Read only: nothing is written to Roon. A page brings some 3,800 objects for 100 tracks and they stay in the connection's
 * graph until the next connection, room the smart playlists' pages need too (smart.js stops under 50,000): so no page
 * is asked for here with under 70,000 left — five of smart.js's pages always kept for it — and the answer is kept per
 * playlist for the connection, read again only when its track count changes or after an hour (the review). Each page
 * takes its own turn on the connection, so a play or a pause never waits behind a long playlist; the read stops at the
 * first page that doesn't arrive whole. One read per playlist at a time.
 */
const { field, isRef } = require("./objects");
const { profileFor, profileObjectFor, profilesOf } = require("./session");
const { readItemsPage, PAGE } = require("./playlist-items");

/**
 * 10,000 tracks, the official API's read of a playlist since 2.0.4-t1 (PLAYLIST_ITEMS). Until 2.0.5-t1 this stayed at
 * 1,000, so every row past it kept the official line, the composers (Kenny G at 1,161 and Tina Turner at 1,355 on a
 * playlists user's 1,715-track playlist, 2026-11-11). Room on the connection (PAGE_ROOM) still ends a read sooner.
 */
const MAX_PAGES = 100;
const PAGE_ROOM = 70000, TIMEOUT_MS = 8000, KEEP_MS = 60 * 60 * 1000;

/**
 * @typedef {{ title: string, artist: string | null, album: string | null } | null} Track  null: it didn't arrive in time
 * @typedef {{ status: "ok", name: string, tracks: Track[], count: number | null, whole: boolean, capped?: boolean }
 *   | { status: "off" | "none" | "failed", why: string }} Answer
 */

/** A title as compared: lower case, letters and digits only (any script), so "Hold the Line" is "hold the line"'s. */
const norm = (/** @type {string | null | undefined} */ s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Each row's track among the server's: the one at the row's own place when its title is the row's; else, when the list
 * is whole, the one of that title when every track of that title has one artist (a partial list can't say that, the
 * review); else none (-1). Pure.
 * @param {string[]} rows  the titles the official API gave, in its order
 * @param {Track[]} tracks  the server's, in the playlist's order
 * @param {boolean} [whole]  every track of the playlist read and arrived
 * @returns {number[]}
 */
function alignTracks(rows, tracks, whole = true) {
  /** Per title, its artists and the first track with it. @type {Map<string, { artists: Set<string>, at: number }>} */
  const byTitle = new Map();
  tracks.forEach((t, i) => {
    if (!t || !t.artist) return;
    const k = norm(t.title);
    if (!k) return;
    let e = byTitle.get(k);
    if (!e) byTitle.set(k, (e = { artists: new Set(), at: i }));
    e.artists.add(t.artist);
  });
  return rows.map((title, i) => {
    const k = norm(title);
    const here = tracks[i];
    if (k && here && here.artist && norm(here.title) === k) return i;
    const e = k && whole ? byTitle.get(k) : undefined;
    return e && e.artists.size === 1 ? e.at : -1;
  });
}

/**
 * Each row's artist (alignTracks), or null where none is known: the row keeps its line as it was. Pure.
 * @param {string[]} rows @param {Track[]} tracks @param {boolean} [whole]
 * @returns {Array<string | null>}
 */
function alignArtists(rows, tracks, whole = true) {
  return alignTracks(rows, tracks, whole).map((j) => (j >= 0 && tracks[j] ? tracks[j].artist : null));
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           profile: () => string | null, known: (s: any) => Map<string, any> | null,
 *           playlists: { read(s: any): Promise<{ list: Array<{ oid: bigint, id: string, name: string, tracks: number | null }> } | { notSent: string }> },
 *           log?: (line: string) => void, now?: () => number, timeoutMs?: number,
 *           page?: (s: any, o: any, oid: bigint) => Promise<any> }} deps
 *   page: stands in for playlist-items.js's readItemsPage in tests
 */
function createPlaylistArtists(deps) {
  const now = deps.now || Date.now;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const page = deps.page || readItemsPage;
  /** Per session, per playlist id. @type {WeakMap<object, Map<string, { tracks: number | null, at: number, value: Answer }>>} */
  const kept = new WeakMap();
  /** @type {Map<string, Promise<Answer>>} */
  const running = new Map();

  /** The session to read on, or why not. @returns {{ s: any } | { why: Answer }} */
  function sessionNow() {
    if (!deps.on()) return { why: { status: "off", why: "Native mode is off." } };
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { why: { status: "off", why: "Native mode isn't connected to your server right now." } };
    if (s.g.uncertain()) return { why: { status: "failed", why: "The connection to your server is being checked." } };
    return { s };
  }

  /**
   * The playlist of that name, the chosen profile's, and what is kept of it; or why not. In the connection's turn.
   * @param {string} name
   * @returns {Promise<{ s: any, pid: Buffer, pl: { oid: bigint, id: string, name: string, tracks: number | null }, hit: Answer | null } | { why: Answer }>}
   */
  async function find(name) {
    const at = sessionNow();
    if ("why" in at) return at;
    const { s } = at;
    const profiles = profilesOf(s.root);
    if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return { why: { status: "failed", why: "Choose your profile in Settings → Native mode first." } };
    const pid = profileFor(s.root, deps.profile());
    if (!Buffer.isBuffer(pid)) return { why: { status: "failed", why: "Your server sent no profile." } };
    const pobj = profileObjectFor(s.root, deps.profile());
    const r = await deps.playlists.read(s);
    if ("notSent" in r) return { why: { status: "failed", why: r.notSent || "Your server didn't send its playlists." } };
    const mine = (/** @type {any} */ x) => { const p = s.graph.get(x.oid); const o = p ? field(p, "Profile") : undefined; return !isRef(o) || !pobj || o.$ref === pobj.oid; };
    let hits = r.list.filter((x) => x.name === name && mine(x));
    if (!hits.length) hits = r.list.filter((x) => typeof x.name === "string" && x.name.toLowerCase() === name.toLowerCase() && mine(x));
    if (!hits.length) return { why: { status: "none", why: `Your server lists no playlist called "${name}".` } };
    if (hits.length > 1) return { why: { status: "none", why: `Your server lists ${hits.length} playlists called "${name}"; Rouen can't tell which.` } };
    const pl = hits[0];
    const byId = kept.get(s);
    const k = byId ? byId.get(pl.id) : undefined;
    return { s, pid, pl, hit: k && k.tracks === pl.tracks && now() - k.at < KEEP_MS ? k.value : null };
  }

  /** @param {string} name @returns {Promise<Answer>} */
  async function readNow(name) {
    const f = await deps.inTurn(() => find(name));
    if ("why" in f) return f.why;
    if (f.hit) return f.hit;
    const { s, pid, pl } = f;
    /** @type {Track[]} */
    const tracks = [];
    let count = /** @type {number | null} */ (null), capped = false, arrived = true;
    for (let p = 0; p < MAX_PAGES; p++) {
      // One page a turn: whatever else the connection is asked (a pause, a skip) goes between pages.
      const got = await deps.inTurn(async () => {
        const at = sessionNow();
        if ("why" in at) return { why: at.why };
        if (at.s !== s) return { why: /** @type {Answer} */ ({ status: "failed", why: "The connection to your server changed during the read." }) };
        if (s.graph.maxObjects - s.graph.objects.size < PAGE_ROOM) return { room: true };
        return page(s, { pid, known: deps.known(s), timeoutMs, page: p, want: PAGE }, pl.oid);
      });
      if ("why" in got) return got.why;
      if ("room" in got) { capped = true; break; }
      if ("error" in got) return { status: "failed", why: got.error };
      count = got.count;
      for (const it of got.items) tracks.push("arrived" in it ? null : { title: it.title, artist: it.artist, album: it.album });
      // A page that didn't arrive whole ends the read: the next would take as long, and the answer isn't kept.
      if (got.complete === false || tracks.some((t) => t === null)) { arrived = false; break; }
      // No Count sent: one page read, and how many more there are unknown.
      if (count === null) { capped = true; break; }
      if (tracks.length >= count || got.items.length < PAGE) break;
      if (p === MAX_PAGES - 1) capped = true;
    }
    const whole = arrived && !capped;
    /** @type {Answer} */
    const value = Object.assign({ status: /** @type {"ok"} */ ("ok"), name: pl.name, tracks, count, whole }, capped ? { capped } : {});
    // Kept unless a track didn't arrive in time or the count never came: those are asked for again next time.
    if (arrived && count !== null) {
      let byId = kept.get(s);
      if (!byId) kept.set(s, (byId = new Map()));
      byId.set(pl.id, { tracks: pl.tracks, at: now(), value });
    }
    return value;
  }

  return {
    /**
     * The playlist's tracks as your server has them, each with its own artist; or why not.
     * @param {string} name  the playlist's name, as the official API lists it
     * @returns {Promise<Answer>}
     */
    read(name) {
      if (!deps.on()) return Promise.resolve({ status: "off", why: "Native mode is off." });
      const key = String(name || "");
      if (!key.trim()) return Promise.resolve({ status: "none", why: "No playlist named." });
      let p = running.get(key);
      if (!p) {
        p = readNow(key)
          .catch((e) => /** @type {Answer} */ ({ status: "failed", why: String((e && /** @type {any} */ (e).message) || e) }))
          .finally(() => { running.delete(key); });
        running.set(key, p);
      }
      return p;
    },
  };
}

module.exports = { createPlaylistArtists, alignArtists, alignTracks, norm, MAX_PAGES };
