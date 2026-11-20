// @ts-check
"use strict";
/*
 * library.js — the iBroadcast library, read and kept for the drive Roon will import (2.0.6-t1,
 * dev/design/ibroadcast.md §3.2), ported from Mandarin's IBroadcastLibrary.cs. iBroadcast's library server answers the
 * whole library at once (tracks, albums, artists: each an id → an array of values, with a map naming the places), and
 * its status says when it last changed (status.lastmodified): read again only then, or when Read library now asks.
 *
 * Kept as Mandarin reads it, in data/ibroadcast/library.json, and nowhere else (not in Rouen's library, not in Roon's):
 *   - an album iBroadcast keeps one entry per disc (one name, one artist) is one album again, its discs in order;
 *   - a track or an album in the trash, never;
 *   - a track listed under two albums (or twice in one) once, under the album its own entry names, else the first to
 *     list it (Mandarin's item 489).
 */
const nodeFs = require("node:fs");
const path = require("node:path");
const { str, IBroadcastError } = require("./api");

/** @typedef {{ id: string, title: string, artist: string, track: number, disc: number, length: number, size: number,
 *              type: string, file: string, artwork: string | null }} Track
 *  @typedef {{ id: string, title: string, artist: string, year: number | null, tracks: Track[] }} Album
 *  @typedef {{ lastmodified: string | null, at: number, streaming_server: string | null, artwork_server: string | null,
 *              albums: Album[] }} Kept */

/** Lossless types (FLAC, WAV, AIFF), from a file's type as iBroadcast gives it ("audio/flac"). @param {string} type */
const lossless = (type) => /flac|wav|aif/i.test(type);

/** @param {any} v @returns {number | null} */
const number = (v) => { const n = typeof v === "number" ? v : Number.parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
/** @param {any} v */
const text = (v) => str(v) || "";
/** @param {Record<string, any>} r */
const trashed = (r) => r.trashed === true;
/** A title or name compared as one: case and spacing aside. @param {string} s */
const canon = (s) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** One of the library's tables as id → (name → value), by its map. @param {any} t @returns {Map<string, Record<string, any>>} */
function table(t) {
  /** @type {Map<string, Record<string, any>>} */
  const out = new Map();
  if (!t || typeof t !== "object" || !t.map || typeof t.map !== "object") return out;
  for (const [id, row] of Object.entries(t)) {
    if (id === "map" || !Array.isArray(row)) continue;
    /** @type {Record<string, any>} */
    const r = {};
    for (const [name, at] of Object.entries(t.map)) if (typeof at === "number" && at >= 0 && at < row.length) r[name] = row[at];
    out.set(id, r);
  }
  return out;
}

/**
 * iBroadcast's library answer as the albums Rouen keeps.
 * @param {any} answer @param {number} at @returns {Kept}
 */
function albumsOf(answer, at) {
  const lib = answer && answer.library;
  if (!lib || typeof lib !== "object") throw new IBroadcastError("iBroadcast sent no library", 502);
  const albums = table(lib.albums), tracks = table(lib.tracks), artists = table(lib.artists);
  const artistName = (/** @type {any} */ id) => { const a = artists.get(text(id)); return a ? text(a.name) : ""; };
  // An album a disc an entry: one album again (one name, one artist), its entries by disc, then id.
  /** @type {Map<string, Array<[string, Record<string, any>]>>} */
  const groups = new Map();
  for (const [id, a] of albums) {
    if (trashed(a)) continue;
    const k = canon(text(a.name)) + "|" + text(a.artist_id);
    const g = groups.get(k);
    if (g) g.push([id, a]); else groups.set(k, [[id, a]]);
  }
  const sets = [...groups.values()].map((g) => g.sort((x, y) => ((number(x[1].disc) || 1) - (number(y[1].disc) || 1)) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
  /** @type {Map<string, number>} */
  const setOf = new Map();
  sets.forEach((set, i) => { for (const [id] of set) setOf.set(id, i); });
  /** Each set's tracks, as its own entries list them. */
  const lists = sets.map((set) => new Set(set.flatMap(([, a]) => (Array.isArray(a.tracks) ? a.tracks : []).map(text))));
  // Which album each track is kept under: the one its own entry names, where that is among these and lists it (one
  // naming an album that doesn't list it would lose it: the review); else the first to list it.
  /** @type {Map<string, number>} */
  const under = new Map();
  sets.forEach((set, i) => {
    for (const tid of lists[i]) {
      const t = tracks.get(tid);
      if (!t || trashed(t) || under.has(tid)) continue;
      const named = setOf.get(text(t.album_id));
      under.set(tid, named !== undefined && lists[named].has(tid) ? named : i);
    }
  });
  /** @type {Album[]} */
  const out = [];
  sets.forEach((set, i) => {
    const [firstId, first] = set[0];
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {Track[]} */
    const rows = [];
    for (const [, a] of set) {
      const disc = number(a.disc) || 1;
      for (const tid of (Array.isArray(a.tracks) ? a.tracks : []).map(text)) {
        const t = tracks.get(tid);
        if (!t || under.get(tid) !== i || seen.has(tid)) continue;
        seen.add(tid);
        rows.push({ id: tid, title: text(t.title), artist: artistName(t.artist_id), track: number(t.track) || 0, disc, length: number(t.length) || 0,
          size: number(t.size) || 0, type: text(t.type), file: text(t.file), artwork: str(t.artwork_id) === "0" ? null : str(t.artwork_id) });
      }
    }
    if (!rows.length) return;
    const artist = artistName(first.artist_id) || "Unknown artist";
    for (const r of rows) if (!r.artist) r.artist = artist;
    const year = number(first.year) || rows.map((r) => number(tracks.get(r.id)?.year)).find((y) => !!y && y > 0) || null;
    out.push({ id: firstId, title: text(first.name), artist, year: year && year > 0 ? year : null, tracks: rows });
  });
  const settings = answer.settings || {};
  return { lastmodified: str(answer.status && answer.status.lastmodified), at, streaming_server: str(settings.streaming_server),
    artwork_server: str(settings.artwork_server), albums: out };
}

/** What the page says of a library kept: its counts. @param {Kept | null} k */
function summary(k) {
  if (!k) return { albums: null, tracks: null, lossless: null, bytes: null, at: null };
  let tracks = 0, loss = 0, bytes = 0;
  for (const a of k.albums) for (const t of a.tracks) { tracks++; if (lossless(t.type)) loss++; bytes += t.size; }
  return { albums: k.albums.length, tracks, lossless: loss, bytes, at: k.at };
}

/**
 * @param {{ account: { connected(): boolean, api: { json(mode: string, extra?: any, url?: string): Promise<any>, library: string } },
 *           dataDir: string, log?: (line: string) => void, now?: () => number, fs?: typeof nodeFs }} o
 */
function createIBroadcastLibrary(o) {
  const fs = o.fs || nodeFs;
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const file = path.join(o.dataDir, "ibroadcast", "library.json");
  /** @type {Kept | null | undefined} undefined: not yet read from disk */
  let held;
  /** The reading under way, and whether it was forced: a second asker waits for it. @type {Promise<Kept | null> | null} */
  let reading = null;
  let readingForced = false;
  /** Moves on when the library is forgotten: a reading begun before it keeps nothing (the review). */
  let generation = 0;
  /** The last reading's failure, in iBroadcast's words; null once one succeeds. @type {string | null} */
  let error = null;

  /** @returns {Kept | null} */
  function kept() {
    if (held !== undefined) return held;
    try { held = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { held = null; }   // none kept yet (or unreadable): the next reading writes it whole
    return held || null;
  }

  /** @param {Kept} k */
  function keep(k) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(k));
    fs.renameSync(file + ".tmp", file);
    held = k;
  }

  /** @param {boolean} force @returns {Promise<Kept | null>} */
  async function read(force) {
    const gen = generation;
    if (!o.account.connected()) return null;
    const had = kept();
    if (!force && had) {
      const st = await o.account.api.json("status");
      const lm = str(st && st.status && st.status.lastmodified);
      if (lm && lm === had.lastmodified) return had;
    }
    const k = albumsOf(await o.account.api.json("library", undefined, o.account.api.library), now());
    // Signed out while iBroadcast answered: what it answered is for an account no longer here.
    if (gen !== generation || !o.account.connected()) return null;
    keep(k);
    const s = summary(k);
    log(`the library read: ${s.albums} albums, ${s.tracks} tracks`);
    return k;
  }

  return {
    /**
     * The library read again (force: whatever iBroadcast says of when it changed); one reading at a time.
     * @param {boolean} force @returns {Promise<Kept | null>}
     */
    read(force) {
      if (reading && (readingForced || !force)) return reading;
      // Forced while a look that may not read is under way (the ten minutes' watch): read after it (the review).
      const before = reading ? reading.catch(() => null) : Promise.resolve(null);
      /** @type {Promise<Kept | null>} */
      const run = before.then(() => read(force))
        .then((k) => { error = null; return k; }, (e) => { error = String((e && e.message) || e); throw e; })
        .finally(() => { if (reading === run) { reading = null; readingForced = false; } });
      reading = run;
      readingForced = force;
      return run;
    },
    /** What the page says: what is kept, whether it is being read, and the last failure. */
    state() { return Object.assign(summary(kept()), { reading: !!reading, error }); },
    /** The library kept, for the drive (stage 2). */
    kept,
    /** Signed out: the library kept here goes. */
    forget() {
      generation++;
      held = null;
      error = null;
      try { fs.rmSync(file, { force: true }); }
      catch (e) { log("the library kept couldn't be removed: " + String(/** @type {any} */ (e).message)); }
    },
  };
}

module.exports = { createIBroadcastLibrary, albumsOf, summary, table };
