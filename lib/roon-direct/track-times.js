// @ts-check
"use strict";
/*
 * track-times.js — v1.9.70-t14 (dev/design/native-remote.md §16.6, roon-native.md §4 "3e"): an album's track lengths
 * as your server holds them, read over native mode's connection when Rouen's album page asks. Read only; nothing is
 * written to Roon. Roon's public extension API gives no track length, so without native mode the album page has none.
 *
 *   Library::GetAlbumTrackLites(AlbumBase) for the album: proven on the owner's server by the reads probe (2026-10-28,
 *     §16.6) — a LengthPrefixed list of its TrackLites by reference, pushed with the answer, each with its Title,
 *     LengthSeconds, TrackNumber and MediaNumber (the disc). The argument is the album's object id, as the probe sent it.
 *
 * Only a whole answer is "read": a TrackLite still not loaded after the wait makes it "wait" (asked again), never a
 * list cut short that a page would keep. "wait" is also every passing state — native mode on but not connected,
 * checking the server after an update, the library not yet read on this connection. The wait for the TrackLites is
 * outside the native turn, so a slow push holds up nothing else. The objects this read brought into the graph (each
 * TrackLite, and what it names, first pushed by this answer) are let go once read; any the graph held before stay.
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { isRef, field, waitFor } = require("./objects");
const { noRoom } = require("./find");
const { albumIndex } = require("./albums");
const { listOf } = require("./answer-list");

/** How long the tracks named in the answer are waited for (44 ms on the owner's server). */
const WAIT_MS = 3000;

/**
 * One TrackLite's length and place, from the object the graph holds; null when it isn't there with a length.
 * @param {any} graph @param {any} v  a reference to the TrackLite
 * @returns {{ disc: number, number: number, title: string, seconds: number } | null}
 */
function trackOf(graph, v) {
  if (!isRef(v)) return null;
  const o = graph.get(BigInt(v.$ref));
  if (!o || !o.loaded) return null;
  const seconds = Number(field(o, "LengthSeconds"));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const title = field(o, "Title");
  return { disc: Number(field(o, "MediaNumber")) || 1, number: Number(field(o, "TrackNumber")) || 0,
    title: typeof title === "string" ? title : "", seconds: Math.round(seconds) };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, off: () => string | null,
 *           on?: () => boolean, keyOf: (title: string, artist: string) => string | null, waitMs?: number }} deps
 */
function createRoonTrackTimes(deps) {
  return {
    /**
     * An album's tracks with their lengths, in disc and track order.
     * @param {string} title @param {string} artist
     * @returns {Promise<{ read: true, tracks: Array<{ disc: number, number: number, title: string, seconds: number }> }
     *   | { read: false, why: string, wait?: boolean }>}
     */
    async album(title, artist) {
      const why = deps.off();
      // Native mode on, but not ready yet: for now only.
      if (why) return deps.on && deps.on() ? { read: false, wait: true, why } : { read: false, why };
      /** Objects first pushed while this read is out, by id. @type {Set<string>} */
      const fresh = new Set();
      /** @type {any} */
      let graph = null;
      const seen = (/** @type {any} */ o, /** @type {any} */ pushed) => { if (o.fields === pushed) fresh.add(String(o.oid)); };
      try {
        /** @returns {Promise<{ payload: Buffer } | { read: false, why: string, wait?: boolean }>} */
        const ask = async () => {
          const s = deps.link ? deps.link.session() : null;
          if (!s) return { read: false, wait: true, why: "Native mode isn't connected to your server right now." };
          const full = noRoom(s);
          if (full) return { read: false, wait: true, why: full };
          const known = deps.known(s);
          if (!known) return { read: false, wait: true, why: "Your library hasn't been read on this connection to your server yet." };
          if (s.g.uncertain()) return { read: false, wait: true, why: "The connection to your server is being checked." };
          const want = deps.keyOf(title, artist);
          const album = want ? albumIndex(known, deps.keyOf).get(want) || null : null;
          if (!album) return { read: false, why: "Your server's library has no album of that title and artist on this connection." };
          graph = s.graph;
          // A new object's fields are the very ones pushed (objects.js ingest); an update's are merged into the held ones.
          graph.watchers.add(seen);
          const r = await s.g.call(s.root.library.oid, SIG.albumTrackLites, new BinaryWriter().long(BigInt(album.oid)).toBuffer());
          if (!r.success) return { read: false, why: "Your server refused the read: " + String(r.status) };
          return { payload: r.payload };
        };
        const asked = await deps.inTurn(ask);
        if (!("payload" in asked)) return asked;
        const list = listOf(graph, asked.payload);
        if (!list) return { read: false, why: "Your server's answer couldn't be read as a list of tracks." };
        // A null answer and an empty list are the same byte: either way, none to show.
        if (!list.items.length) return { read: false, why: "Your server gave no tracks for this album." };
        const refs = list.items.filter(isRef);
        // Let go what this read brought, however it ends: each TrackLite, and the objects it names, first pushed by it.
        const letGo = () => {
          for (const x of refs) {
            const o = graph.get(BigInt(x.$ref));
            for (const v of o ? Object.values(o.fields) : []) if (isRef(v) && fresh.has(String(v.$ref))) graph.forget(BigInt(v.$ref));
            if (fresh.has(String(x.$ref))) graph.forget(BigInt(x.$ref));
          }
        };
        const loaded = await waitFor(deps.waitMs ?? WAIT_MS, () => (refs.every((x) => { const o = graph.get(BigInt(x.$ref)); return o && o.loaded; }) ? true : undefined));
        if (!loaded) { letGo(); return { read: false, wait: true, why: "Your server's tracks for this album hadn't all arrived." }; }
        const tracks = /** @type {Array<{ disc: number, number: number, title: string, seconds: number }>} */ (
          list.items.map((x) => trackOf(graph, x)).filter(Boolean));
        tracks.sort((a, b) => a.disc - b.disc || a.number - b.number);
        letGo();
        return { read: true, tracks };
      } finally {
        if (graph) graph.watchers.delete(seen);
      }
    },
  };
}

module.exports = { createRoonTrackTimes, trackOf };
