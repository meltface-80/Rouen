// @ts-check
"use strict";
/*
 * smart-probe.js — N2e-0 (dev/design/native-remote.md §12.1, v1.9.50): Roon's smart playlists, read
 * once, by hand, over native mode's connection, for the profile chosen in Settings → Native mode.
 * Nothing is written.
 *
 *   1. Every playlist the server lists (the Library's Playlists object, its AllPlaylists): its name,
 *      its Type as sent (PlaylistType: Smart 15), its counts and flags, and the members that arrived.
 *   2. Each smart playlist's AlbumCriteria and TrackCriteria — Roon's Focus — every member as sent.
 *   3. One playlist's items: Playlist::VirtualItemsQuery (captured from Roon's own app) → its Count →
 *      page 0 retained → up to 25 items, each by its Track's title, album and artist → the page released
 *      and the query disposed, once each, whatever happens.
 *
 * Answers with names, counts and values, never protocol bytes. What it sends stays in the graph.
 */
const { field, plain, isRef, waitFor } = require("./objects");
const { SIG, pageArg, openPlaylistItems } = require("./methods");
const { readCount } = require("./locations");
const { profileFor } = require("./session");
const { noRoom, plainCredit } = require("./find");

const PAGE = 100;
const SHOWN = 25;
// PlaylistType, as the catalogue has it.
const TYPE_NAME = Object.freeze({ 0: "Invalid", 1: "ITunes", 5: "Sooloos", 6: "SooloosReadOnly", 8: "IPod", 10: "Tidal", 11: "File",
  12: "Qobuz", 13: "RoonEditorial", 14: "KKBox", 15: "Smart" });
const SMART = 15;
const ITEM = /(?:^|\.)PlaylistItem$/;
const ITEM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?PlaylistItem>$/;
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
  if (Array.isArray(v)) return { count: v.length, first: v.slice(0, 5).map((x) => describe(graph, x, depth + 1)) };
  if ("$inline" in v) return { inline: "a struct whose type the server never declared" };
  if (isRef(v)) {
    const o = graph.get(v.$ref);
    if (!o || !o.loaded) return { object: "not sent" };
    const out = /** @type {Record<string, any>} */ ({ object: o.typeName.replace(/^Sooloos\.Broker\.Api\./, "") });
    const name = field(o, "Name") ?? field(o, "Title");
    if (typeof name === "string") out.name = name;
    if (o.fields.$items) Object.assign(out, { count: o.fields.$items.length, first: o.fields.$items.slice(0, 5).map((/** @type {any} */ x) => describe(graph, x, depth + 1)) });
    return out;
  }
  if ("$type" in v) {
    const out = /** @type {Record<string, any>} */ ({ struct: String(v.$type).replace(/^Sooloos\.Broker\.Api\./, "") });
    if (depth >= 2) return out;
    out.members = Object.fromEntries(Object.keys(v).filter((k) => k !== "$type").map((k) => [short(k), describe(graph, v[k], depth + 1)]));
    return out;
  }
  return { value: "of a shape the probe doesn't know" };
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

  /** Every playlist, as far as the server has sent them; undefined while the list itself hasn't arrived. @param {any} s */
  function listed(s) {
    const svcRef = field(s.root.library, "Playlists");
    const svc = isRef(svcRef) ? s.graph.get(svcRef.$ref) : null;
    const all = svc && svc.loaded ? field(svc, "AllPlaylists") : undefined;
    const list = isRef(all) ? s.graph.get(all.$ref) : null;
    if (!list || !list.loaded || !list.fields.$items) return undefined;
    return list.fields.$items.map((/** @type {any} */ x) => (isRef(x) ? s.graph.get(x.$ref) : null)).filter((/** @type {any} */ p) => p && p.loaded);
  }

  /** One playlist as the page shows it. @param {any} graph @param {any} p */
  function playlist(graph, p) {
    const type = plain(field(p, "Type"));
    const out = /** @type {Record<string, any>} */ ({
      name: field(p, "Name") ?? null, type: type ?? null, typeName: typeof type === "number" ? (/** @type {any} */ (TYPE_NAME))[type] || null : null,
      trackCount: plain(field(p, "TrackCount")) ?? null, itemCount: plain(field(p, "ItemCount")) ?? null,
      isPlayable: field(p, "IsPlayable") ?? null, isReadOnly: field(p, "IsReadOnly") ?? null,
      supportsItemsQuery: field(p, "SupportsVirtualItemsQuery") ?? null, members: Object.keys(p.fields).map(short).sort(),
    });
    for (const c of ["AlbumCriteria", "TrackCriteria"]) {
      const v = field(p, c);
      if (v !== undefined) out[c] = describe(graph, v);
    }
    return out;
  }

  /**
   * The first items of one playlist, its query released and disposed whatever happens.
   * @param {any} s @param {any} p @returns {Promise<Record<string, any>>}
   */
  async function items(s, p) {
    const { g, graph, root } = s;
    const known = deps.known(s);
    const qid = await openPlaylistItems(g, p.oid, /** @type {Buffer} */ (profileFor(root, deps.profile())), PAGE);
    let held = false;
    try {
      const c = await readCount(graph, qid, timeoutMs);
      if ("error" in c) return { query: true, error: "Its items query " + c.error + "." };
      /** The playlist's items, in the order they came, and what else the page pushed, by type. */
      const order = /** @type {string[]} */ ([]);
      const pushed = /** @type {Record<string, number>} */ ({});
      const before = graph.onObject;
      graph.onObject = (/** @type {any} */ x) => {
        const t = x.typeName.replace(/^Sooloos\.Broker\.Api\./, "");
        pushed[t] = (pushed[t] || 0) + 1;
        const id = ITEM.test(x.typeName) ? x.oid.toString() : ITEM_ROW.test(x.typeName) && isRef(field(x, "Data")) ? field(x, "Data").$ref.toString() : null;
        if (id && !order.includes(id)) order.push(id);
        before(x);
      };
      /** An item's track, once it and its title have arrived. @param {string} id */
      const trackOf = (id) => { const t = field(graph.get(BigInt(id)), "Track"); const o = isRef(t) ? graph.get(t.$ref) : null; return o && field(o, "Title") !== undefined ? o : null; };
      try {
        const want = Math.min(c.count, SHOWN);
        if (c.count) {
          const r = await g.call(qid, SIG.playlistItemsRetainPage, pageArg(0));
          if (!r.success) return { count: c.count, error: `Your server refused the playlist's first page ("${r.status}").` };
          held = true;
          await waitFor(timeoutMs, () => (order.length >= want && order.slice(0, want).every(trackOf) ? true : undefined));
        }
        const shown = order.slice(0, SHOWN).map((id) => {
          const t = trackOf(id);
          if (!t) return { arrived: false };
          const al = field(t, "Album");
          const alObj = isRef(al) ? graph.get(al.$ref) : null;
          const k = isRef(al) && known ? known.get(al.$ref.toString()) : undefined;
          const by = field(t, "PerformedBy") ?? (alObj ? field(alObj, "PerformedBy") : undefined);
          return { title: String(field(t, "Title")), album: (alObj && field(alObj, "Title")) || (k && k.title) || null,
            artist: typeof by === "string" ? plainCredit(by) : (k && k.artist) || null };
        });
        return { count: c.count, arrived: order.length, items: shown, pushed };
      } finally {
        graph.onObject = before;
      }
    } finally {
      if (held) g.callNoReply(qid, SIG.playlistItemsReleasePage, pageArg(0));
      g.callNoReply(qid, SIG.playlistItemsDispose, Buffer.alloc(0));
    }
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
          const all = await waitFor(timeoutMs, () => listed(s));
          if (!all) return { read: false, why: "Your server didn't send its playlists." };
          const playlists = all.map((p) => playlist(s.graph, p));
          const wanted = o && o.name ? all.find((p) => field(p, "Name") === o.name) : all.find((p) => plain(field(p, "Type")) === SMART);
          const out = /** @type {Record<string, any>} */ ({ read: true, playlists, smart: playlists.filter((p) => p.type === SMART).length });
          if (!wanted) {
            out.items = { error: o && o.name ? `Your server lists no playlist named "${o.name}".` : "Your server sent no playlist marked smart (Type 15); add ?name= to read one by name." };
          } else {
            out.items = Object.assign({ playlist: field(wanted, "Name") ?? null }, await items(s, wanted));
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
