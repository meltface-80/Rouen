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
 * Read only: nothing is written to Roon. A page brings some 3,800 objects for 100 tracks and they stay in the graph, so
 * no page is asked for with under 50,000 objects of room left (as smart.js), and the answer is kept per playlist and
 * session — read again only when its track count changes, or after ten minutes. One read per playlist at a time.
 */
const { field, isRef } = require("./objects");
const { profileFor, profileObjectFor, profilesOf } = require("./session");
const { readItemsPage, PAGE } = require("./playlist-items");

/** As the official API's read of a playlist stops (PLAYLIST_ITEMS in index.js): 1,000 tracks. */
const MAX_PAGES = 10;
const PAGE_ROOM = 50000, TIMEOUT_MS = 8000, KEEP_MS = 10 * 60 * 1000;

/**
 * @typedef {{ title: string, artist: string | null, album: string | null } | null} Track  null: it didn't arrive in time
 * @typedef {{ status: "ok", name: string, tracks: Track[], count: number | null, capped?: boolean }
 *   | { status: "off" | "none" | "failed", why: string }} Answer
 */

/** A title as compared: lower case, letters and digits only (any script), so "Hold the Line" is "hold the line"'s. */
const norm = (/** @type {string | null | undefined} */ s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Each row's artist, from the server's tracks: the track at the row's own place when its title is the row's; else, the
 * one artist every track of that title has; else none (the row keeps its line as it was). Pure.
 * @param {string[]} rows  the titles the official API gave, in its order
 * @param {Track[]} tracks  the server's, in the playlist's order
 * @returns {Array<string | null>}
 */
function alignArtists(rows, tracks) {
  /** @type {Map<string, Set<string>>} */
  const byTitle = new Map();
  for (const t of tracks) {
    if (!t || !t.artist) continue;
    const k = norm(t.title);
    if (!k) continue;
    let set = byTitle.get(k);
    if (!set) byTitle.set(k, (set = new Set()));
    set.add(t.artist);
  }
  return rows.map((title, i) => {
    const k = norm(title);
    const here = tracks[i];
    if (k && here && here.artist && norm(here.title) === k) return here.artist;
    const set = k ? byTitle.get(k) : undefined;
    return set && set.size === 1 ? [...set][0] : null;
  });
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

  /** @param {string} name @returns {Promise<Answer>} */
  const readNow = (name) => deps.inTurn(async () => {
    if (!deps.on()) return { status: "off", why: "Native mode is off." };
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { status: "off", why: "Native mode isn't connected to your server right now." };
    if (s.g.uncertain()) return { status: "failed", why: "The connection to your server is being checked." };
    const profiles = profilesOf(s.root);
    if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return { status: "failed", why: "Choose your profile in Settings → Native mode first." };
    const pid = profileFor(s.root, deps.profile());
    if (!Buffer.isBuffer(pid)) return { status: "failed", why: "Your server sent no profile." };
    const pobj = profileObjectFor(s.root, deps.profile());
    const r = await deps.playlists.read(s);
    if ("notSent" in r) return { status: "failed", why: r.notSent || "Your server didn't send its playlists." };
    const mine = (/** @type {any} */ x) => { const p = s.graph.get(x.oid); const o = p ? field(p, "Profile") : undefined; return !isRef(o) || !pobj || o.$ref === pobj.oid; };
    let hits = r.list.filter((x) => x.name === name && mine(x));
    if (!hits.length) hits = r.list.filter((x) => typeof x.name === "string" && x.name.trim().toLowerCase() === name.trim().toLowerCase() && mine(x));
    if (!hits.length) return { status: "none", why: `Your server lists no playlist called "${name}".` };
    if (hits.length > 1) return { status: "none", why: `Your server lists ${hits.length} playlists called "${name}"; Rouen can't tell which.` };
    const pl = hits[0];
    let byId = kept.get(s);
    const hit = byId ? byId.get(pl.id) : undefined;
    if (hit && hit.tracks === pl.tracks && now() - hit.at < KEEP_MS) return hit.value;
    const known = deps.known(s);
    /** @type {Track[]} */
    const tracks = [];
    let count = /** @type {number | null} */ (null), capped = false;
    for (let p = 0; p < MAX_PAGES; p++) {
      if (s.graph.maxObjects - s.graph.objects.size < PAGE_ROOM) { capped = true; break; }
      const got = await page(s, { pid, known, timeoutMs, page: p, want: PAGE }, pl.oid);
      if ("error" in got) return { status: "failed", why: got.error };
      count = got.count;
      for (const it of got.items) tracks.push("arrived" in it ? null : { title: it.title, artist: it.artist, album: it.album });
      if (count === null || tracks.length >= count || got.items.length < PAGE) break;
      if (p === MAX_PAGES - 1) capped = true;
    }
    /** @type {Answer} */
    const value = Object.assign({ status: /** @type {"ok"} */ ("ok"), name: pl.name, tracks, count }, capped ? { capped } : {});
    // Kept only whole: a track that didn't arrive in time is asked for again next time.
    if (!tracks.some((t) => t === null)) {
      if (!byId) kept.set(s, (byId = new Map()));
      byId.set(pl.id, { tracks: pl.tracks, at: now(), value });
    }
    return value;
  });

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
          .catch((e) => /** @type {Answer} */ ({ status: "failed", why: String(e && /** @type {any} */ (e).message) }))
          .finally(() => { running.delete(key); });
        running.set(key, p);
      }
      return p;
    },
  };
}

module.exports = { createPlaylistArtists, alignArtists, norm, MAX_PAGES };
