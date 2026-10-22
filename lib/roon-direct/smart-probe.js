// @ts-check
"use strict";
/*
 * smart-probe.js — N2e-0 (dev/design/native-remote.md §12.1, v1.9.50): Roon's smart playlists, read
 * once, by hand, over native mode's connection, for the profile chosen in Settings → Native mode.
 * Nothing is written.
 *
 *   1. Every playlist the server lists (the Library's Playlists object, its AllPlaylists): its name,
 *      its Type as sent (PlaylistType: Smart 15), its counts and flags, and the members that arrived.
 *   2. Each smart playlist's AlbumCriteria and TrackCriteria — Roon's Focus — every member as sent; from v1.9.52
 *      each list read (focus.js, §12.5): its count and items, a genre, tag or performer by its type and Name.
 *   3. One playlist's items: Playlist::VirtualItemsQuery (captured from Roon's own app) → its Count →
 *      page 0 retained → up to 25 items, each by its Track's title, album and artist → the page released
 *      and the query disposed, once each, whatever happens.
 *
 * Answers with names, counts and values, never protocol bytes, but one: a Focus's date (a NullDate), whose form no
 * source gives, said as its four bytes beside every reading of them (focus.js readNullDate, v1.9.57, §12.11). What it
 * sends stays in the graph.
 */
const { field, plain, isRef, waitFor } = require("./objects");
const { profileFor } = require("./session");
const { noRoom } = require("./find");
const { readItemsPage } = require("./playlist-items");
const { allPlaylists, isSmart, imagesOf } = require("./playlists");
const { readList, readNullDate } = require("./focus");

const SHOWN = 25;
// PlaylistType, as the catalogue has it.
const TYPE_NAME = Object.freeze({ 0: "Invalid", 1: "ITunes", 5: "Sooloos", 6: "SooloosReadOnly", 8: "IPod", 10: "Tidal", 11: "File",
  12: "Qobuz", 13: "RoonEditorial", 14: "KKBox", 15: "Smart" });
/** A member's short name, from its full one ("string Sooloos.Broker.Api.Playlist::Name" → "Name"). @param {string} k */
const short = (k) => k.slice(k.lastIndexOf("::") + 2);

/**
 * A value as the page shows it: as it is; a list by its count and first five; an object by its type and Name; an inline
 * struct by its members, two levels deep. Never bytes: a Sooid or a byte array is said by its length.
 * @param {any} graph @param {any} v @param {number} [depth]
 * @returns {any}
 */
function describe(graph, v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return String(v);
  if (Buffer.isBuffer(v)) return { bytes: v.length };
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return depth >= 2 ? { count: v.length } : { count: v.length, first: v.slice(0, 5).map((x) => describe(graph, x, depth + 1)) };
  if ("$inline" in v) return { inline: "a struct whose type the server never declared" };
  if (isRef(v)) {
    const o = graph.get(v.$ref);
    if (!o || !o.loaded) return { object: "not sent" };
    const out = /** @type {Record<string, any>} */ ({ object: o.typeName.replace(/^Sooloos\.Broker\.Api\./, "") });
    const name = field(o, "Name") ?? field(o, "Title");
    if (typeof name === "string") out.name = name;
    if (o.fields.$items) {
      out.count = o.fields.$items.length;
      // Two levels, as a struct's: a list that names itself (or another that names it back) ends here (the review).
      if (depth < 2) out.first = o.fields.$items.slice(0, 5).map((/** @type {any} */ x) => describe(graph, x, depth + 1));
    }
    return out;
  }
  if ("$type" in v) {
    const out = /** @type {Record<string, any>} */ ({ struct: String(v.$type).replace(/^Sooloos\.Broker\.Api\./, "") });
    if (depth >= 2) return out;
    out.members = Object.fromEntries(Object.keys(v).filter((k) => k !== "$type").map((k) => [short(k), member(graph, k, v[k], depth + 1)]));
    return out;
  }
  return { value: "of a shape the probe doesn't know" };
}

/**
 * A struct's member as the page shows it: a Focus list (its bytes, as the graph keeps a LengthPrefixed value) read by its
 * element type (focus.js, v1.9.52, §12.5) — its count, its items as describe() says them, and whether it read whole;
 * a date (a NullDate) as readNullDate says it (v1.9.57); anything else as describe() says it.
 * @param {any} graph @param {string} fullName @param {any} v @param {number} depth
 */
function member(graph, fullName, v, depth) {
  // A date (Sooloos.NullDate: four bytes on the owner's server, §12.11) said as what it can be, for the decade mapping.
  if (Buffer.isBuffer(v) && /^Sooloos\.NullDate /.test(fullName)) return readNullDate(v);
  const list = Buffer.isBuffer(v) ? readList(graph, fullName, v) : null;
  if (!list) return describe(graph, v, depth);
  const out = /** @type {Record<string, any>} */ ({ list: list.type, count: list.count });
  if (list.items.length) out.items = list.items.slice(0, SHOWN).map((x) => describe(graph, x, depth + 1));
  if (!list.whole) out.whole = false;
  return out;
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, profile: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, off: () => string | null,
 *           log?: (line: string) => void, timeoutMs?: number }} deps
 *   known: what the connection was sent of each library album, by object id (a track's Album may name one by reference)
 */
function createSmartProbe(deps) {
  const log = deps.log || (() => {});
  const timeoutMs = deps.timeoutMs || 8000;
  let busy = false;

  /** One playlist as the page shows it. @param {any} graph @param {any} p */
  function playlist(graph, p) {
    const type = plain(field(p, "Type"));
    const out = /** @type {Record<string, any>} */ ({
      name: field(p, "Name") ?? null, type: type ?? null, typeName: typeof type === "number" ? (/** @type {any} */ (TYPE_NAME))[type] || null : null,
      trackCount: plain(field(p, "TrackCount")) ?? null, itemCount: plain(field(p, "ItemCount")) ?? null,
      isPlayable: field(p, "IsPlayable") ?? null, isReadOnly: field(p, "IsReadOnly") ?? null,
      supportsItemsQuery: field(p, "SupportsVirtualItemsQuery") ?? null, smart: isSmart(p), members: Object.keys(p.fields).map(short).sort(),
      // Its cover art's broker keys, or why none (v1.9.59: the tiles' art).
      images: imagesOf(graph, p),
    });
    for (const c of ["AlbumCriteria", "TrackCriteria"]) {
      const v = field(p, c);
      // Inline, as the owner's server sent it (§12.2); by reference, its object's members as an inline one's (the review).
      const o = isRef(v) ? graph.get(v.$ref) : null;
      if (v !== undefined) out[c] = describe(graph, o && o.loaded && !o.fields.$items ? Object.assign({ $type: o.typeName }, o.fields) : v);
    }
    return out;
  }

  /**
   * The first items of one playlist (playlist-items.js, shared with smart.js since v1.9.51).
   * @param {any} s @param {any} p @returns {Promise<Record<string, any>>}
   */
  async function items(s, p) {
    const pid = profileFor(s.root, deps.profile());
    if (!Buffer.isBuffer(pid)) return { error: "Your server sent no profile with an id." };
    return readItemsPage(s, { pid, known: deps.known(s), timeoutMs, page: 0, want: SHOWN }, p.oid);
  }

  return {
    /**
     * @param {{ name?: string }} [o]  name: the playlist whose items to read; else the first smart one
     * @returns {Promise<any>} what was read, or { error, status } when it could not be asked for
     */
    async run(o) {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A probe is already running.", status: 409 };
      busy = true;
      try {
        return await deps.inTurn(async () => {
          const s = deps.link ? deps.link.session() : null;
          if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
          const full = noRoom(s);
          if (full) return { error: full, status: 409 };
          if (s.g.uncertain()) return { error: "The connection to your server is being checked.", status: 503 };
          const got = await waitFor(timeoutMs, () => allPlaylists(s));
          if (!got) return { read: false, why: "Your server didn't send its playlists, whole, in time." };
          const all = got.playlists;
          const playlists = all.map((p) => playlist(s.graph, p));
          const wanted = o && o.name ? all.find((p) => field(p, "Name") === o.name) : all.find(isSmart);
          const out = /** @type {Record<string, any>} */ ({ read: true, playlists, smart: playlists.filter((p) => p.smart).length });
          if (!wanted) {
            out.items = { error: o && o.name ? `Your server lists no playlist named "${o.name}".` : "Your server sent no playlist marked smart (Type 15, or with a Focus); add ?name= to read one by name." };
          } else {
            // Its items asked for last, and a refusal or a lost connection said there: what was read above stays (the review).
            let got_;
            try { got_ = await items(s, wanted); }
            catch (e) { got_ = { error: "Its items couldn't be read: " + (e && /** @type {any} */ (e).message) }; }
            out.items = Object.assign({ playlist: field(wanted, "Name") ?? null }, got_);
          }
          log(`smart playlists probe: ${playlists.length} playlist(s), ${out.smart} smart; items of "${out.items.playlist || "-"}": ${out.items.count ?? "-"}`);
          return out;
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createSmartProbe, describe, TYPE_NAME };
