// @ts-check
"use strict";
/*
 * suggest-probe.js — stage 0 of suggestions from Roon (dev/design/roon-suggestions.md §4, 2.0.6-t17): what Roon's own
 * "See also" and similar artists hold, and what its search answers for a similar artist, read once by hand over native
 * mode's connection, so Smart Picks and the share card's suggestions are built on what the owner's server sends.
 * Read only: nothing is written.
 *
 *   Library::GetAlbum(AlbumBase) for the album              its SeeAlso, whole
 *   Library::GetPerformer(PerformerBase) for its main performer       its SimilarTo, whole
 *   for each of the first three of SimilarTo: GetPerformer for it, whole; Library::UnifiedSearch for its name, its
 *   result's own members and its albums in Roon's order, then UnifiedSearchResults::Dispose(), once
 *
 * Each step on its own, the connection's state said after each (reads-probe.js's way); nothing runs while the graph has
 * too little room left (find.js noRoom), nor after a call went unanswered.
 */
const { BinaryWriter, readFlexLong } = require("./wire");
const { SIG, searchArgs } = require("./methods");
const { field, isRef, waitFor, fullNameOf, shortType } = require("./objects");
const { whole } = require("./settings-probe");
const { ask, performerOf } = require("./reads-probe");
const { noRoom, albumHit, sourceName } = require("./find");
const { profileFor } = require("./session");
const { readList } = require("./focus");

const SIMILAR_ASKED = 3, ALBUMS_SHOWN = 15, MAX_ITEMS = 30, ALBUM_WAIT_MS = 8000, SEARCH_MS = 4000, SETTLE_MS = 1500;

/** An object the graph holds, whole, by its reference. @param {any} graph @param {any} v */
const wholeOf = (graph, v) => whole(graph, v, new Set());

/**
 * A list member's items, however it is held: its bytes (LengthPrefixed, focus.js readList), a list object by
 * reference, an array; a lone reference as one item. Null when the member didn't come.
 * @param {any} graph @param {any} holder  the object @param {string} name
 * @returns {{ items: any[], form: string } | null}
 */
function itemsOf(graph, holder, name) {
  const v = field(holder, name);
  if (v === undefined) return null;
  if (Buffer.isBuffer(v)) {
    const l = readList(graph, fullNameOf(holder.fields, name), v);
    return l ? { items: l.items, form: "LengthPrefixed list" } : { items: [], form: "bytes not read as a list: " + v.subarray(0, 64).toString("hex") };
  }
  if (isRef(v)) {
    const o = graph.get(BigInt(v.$ref));
    if (o && o.loaded && Array.isArray(o.fields.$items)) return { items: o.fields.$items, form: "list object " + shortType(o.typeName) };
    return { items: [v], form: "one object by reference" };
  }
  return Array.isArray(v) ? { items: v, form: "array" } : { items: [v], form: typeof v };
}

/**
 * A member's items, each given whole, the first MAX_ITEMS. @param {any} graph @param {any} holder @param {string} name
 */
function membersWhole(graph, holder, name) {
  const got = itemsOf(graph, holder, name);
  if (!got) return { skipped: `It came without ${name} (none, or at its default).` };
  return Object.assign({ form: got.form, count: got.items.length, items: got.items.slice(0, MAX_ITEMS).map((x) => wholeOf(graph, x)) },
    got.items.length > MAX_ITEMS ? { more: got.items.length - MAX_ITEMS } : {});
}

/**
 * @param {{ link: { session(): any, status?: () => any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           log?: (line: string) => void, off: () => string | null, known: (s: any) => Map<string, any> | null,
 *           keyOf: (title: string, artist: string) => string | null, zones: () => any[], profile: () => string | null,
 *           albumWaitMs?: number, searchMs?: number, settleMs?: number }} deps
 */
function createSuggestProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;
  return {
    /**
     * The probe of roon-suggestions.md §4, once. title/artist: the album; without them, the album playing (the first
     * playing zone's, found in the library read), else the library's first.
     * @param {{ title?: string, artist?: string }} [o]
     */
    async run(o = {}) {
      const why = deps.off();
      if (why) return { error: why, status: 503 };
      if (busy) return { error: "A read is already running; wait for it.", status: 409 };
      busy = true;
      try {
        return await deps.inTurn(async () => {
          const s = deps.link ? deps.link.session() : null;
          if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
          const full = noRoom(s);
          if (full) return { error: full, status: 503 };
          const known = deps.known(s);
          if (!known) return { error: "Your library hasn't been read on this connection to your server yet.", status: 503 };
          const { graph, root } = s;
          const out = /** @type {Record<string, any>} */ ({ readOnly: true, design: "dev/design/roon-suggestions.md §4" });
          const state = () => ({ objects: graph.objects.size, cap: graph.maxObjects, uncertain: s.g.uncertain() || null,
            stillOpen: !!deps.link && deps.link.session() === s });
          out.connection = { before: state(), after: /** @type {Record<string, any>} */ ({}) };
          const step = async (/** @type {string} */ name, /** @type {() => Promise<void>} */ fn) => {
            try { await fn(); } catch (e) { out[name] = { error: String(e && /** @type {any} */ (e).message) }; }
            out.connection.after[name] = state();
          };

          // The album: the one named, else the one playing, else the library's first.
          const byKey = (/** @type {string} */ t, /** @type {string} */ a) => { const k = deps.keyOf(t, a); return k ? [...known.values()].find((x) => deps.keyOf(x.title, x.artist) === k) : undefined; };
          let album = o.title ? byKey(o.title, o.artist || "") : undefined;
          let chose = o.title ? "the album named" : "";
          if (!album && !o.title) {
            const z = (deps.zones() || []).find((x) => x.state === "playing" && x.now_playing);
            const np = z && z.now_playing && z.now_playing.three_line;
            if (np) { album = byKey(String(np.line3 || ""), String(np.line2 || "")); chose = album ? "the album playing in " + (z.display_name || "a zone") : ""; }
          }
          if (!album && !o.title) { album = known.values().next().value; chose = "the library's first (nothing playing was found in the library)"; }
          if (!album) return { error: "No album of that title (and artist) in your server's library on this connection.", status: 404 };
          out.asked = { title: album.title, artist: album.artist, chose };

          /** @type {bigint[]} */
          let similar = [];
          await step("album", async () => {
            const oid = BigInt(album.oid);
            const got = await ask(s, root.library.oid, SIG.getAlbum, () => new BinaryWriter().long(oid).toBuffer(),
              { what: `the album, object ${oid}`, waitMs: deps.albumWaitMs ?? ALBUM_WAIT_MS });
            const held = got.answer && got.answer.oid ? graph.get(BigInt(got.answer.oid)) : null;
            out.album = { method: got.method, ms: got.ms, refused: got.refused, error: got.error };
            if (!held || !held.loaded) { out.album.skipped = "GetAlbum gave no Album the graph holds."; return; }
            out.seeAlso = membersWhole(graph, held, "SeeAlso");
            const perf = performerOf(graph, held);
            if (perf === null) { out.performer = { skipped: "The album came without a main performer the graph holds." }; return; }
            const p = await ask(s, root.library.oid, SIG.getPerformer, () => new BinaryWriter().long(perf).toBuffer(), { what: `its main performer, object ${perf}` });
            const ph = p.answer && p.answer.oid ? graph.get(BigInt(p.answer.oid)) : null;
            out.performer = { method: p.method, ms: p.ms, refused: p.refused, error: p.error, name: ph ? field(ph, "Name") : undefined };
            if (!ph || !ph.loaded) { out.performer.skipped = "GetPerformer gave no Performer the graph holds."; return; }
            out.similarTo = membersWhole(graph, ph, "SimilarTo");
            const items = itemsOf(graph, ph, "SimilarTo");
            similar = items ? items.items.filter(isRef).map((x) => BigInt(x.$ref)).slice(0, SIMILAR_ASKED) : [];
          });

          // Each of the first three similar artists: GetPerformer for it, and Roon's search for its name.
          out.similarRead = [];
          for (const pid of similar) {
            const one = /** @type {Record<string, any>} */ ({ oid: String(pid) });
            out.similarRead.push(one);
            await step("similar " + pid, async () => {
              const lite = graph.get(pid);
              const name = lite ? field(lite, "Name") : undefined;
              one.name = typeof name === "string" ? name : null;
              const p = await ask(s, root.library.oid, SIG.getPerformer, () => new BinaryWriter().long(pid).toBuffer(), { what: `a similar artist, object ${pid}` });
              one.performer = p.answer && p.answer.oid ? Object.assign({ ms: p.ms }, wholeOf(graph, { $ref: BigInt(p.answer.oid) }))
                : { refused: p.refused, error: p.error, skipped: p.skipped, ms: p.ms };
              if (!one.name) { one.search = { skipped: "No name to search for." }; return; }
              if (s.g.uncertain()) { one.search = { skipped: "An earlier call went unanswered; nothing more was sent." }; return; }
              one.search = await searchFor(s, known, one.name, deps.searchMs ?? SEARCH_MS);
            });
          }
          log("suggestions probe: run");
          return out;
        });
      } finally {
        busy = false;
      }
    },
  };

  /**
   * Roon's search for a name: the result's own members (each whole, its lists by count and their first items) and its
   * albums in Roon's order — each in the library or not (known), its source and AlbumId — then the result disposed once.
   * @param {any} s @param {Map<string, any>} known @param {string} name @param {number} waitMs
   */
  async function searchFor(s, known, name, waitMs) {
    const { g, graph, root } = s;
    const pid = /** @type {Buffer} */ (profileFor(root, deps.profile()));
    const t0 = Date.now();
    const res = await g.call(root.library.oid, SIG.unifiedSearch, searchArgs(g, pid, name));
    if (!res.success) return { refused: String(res.status), ms: Date.now() - t0 };
    const r = readFlexLong(res.payload, 0);
    if (!r || r[0] < 2n || r[1] !== res.payload.length) return { error: "No result object in the answer.", ms: Date.now() - t0 };
    const rid = r[0];
    try {
      await waitFor(waitMs, () => { const o = graph.get(rid); return o && o.loaded ? o : undefined; });
      const res0 = graph.get(rid);
      if (!res0 || !res0.loaded) return { error: `The result had not arrived after ${waitMs / 1000} s.`, ms: Date.now() - t0 };
      // Its lists' items arrive after it: given time, then read as they are.
      await waitFor(deps.settleMs ?? SETTLE_MS, () => undefined);
      /** @type {Record<string, any>} */
      const members = {};
      for (const k of Object.keys(res0.fields)) {
        if (k.startsWith("$")) continue;
        const short = k.slice(k.lastIndexOf("::") + 2), got = itemsOf(graph, res0, short);
        members[short] = got && got.items.length > 1 ? { form: got.form, count: got.items.length, first: got.items.slice(0, 3).map((x) => wholeOf(graph, x)) }
          : wholeOf(graph, res0.fields[k]);
      }
      const albums = [];
      const al = itemsOf(graph, res0, "Albums");
      for (const x of al ? al.items : []) {
        if (!isRef(x)) continue;
        const k = known.get(String(x.$ref)), o = graph.get(BigInt(x.$ref));
        const h = albumHit(o, !!k, k);
        // A library album as the library read had it, which may carry neither (said as unknown, never "undefined").
        albums.push({ title: h.title, artist: h.artist, source: sourceName(h.contentSource ?? null), inLibrary: h.inLibrary, albumId: h.albumId ?? null });
        if (albums.length >= ALBUMS_SHOWN) break;
      }
      return { query: name, ms: Date.now() - t0, members, albums, albumsCount: al ? al.items.length : 0 };
    } finally {
      g.callNoReply(rid, SIG.searchDispose, Buffer.alloc(0));
      graph.forget(rid);
    }
  }
}

module.exports = { createSuggestProbe, itemsOf };
