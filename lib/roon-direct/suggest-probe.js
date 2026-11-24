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
 *   for each of the first three of SimilarTo, in a turn of its own: GetPerformer for it, whole; Library::UnifiedSearch
 *   for its name, read as find.js reads a search (its walk: albums in Roon's order, each in the library or not, waited
 *   for until whole) with the result's own members, then UnifiedSearchResults::Dispose(), once
 *
 * Each step on its own, the connection's state said after each as reads-probe.js says it; nothing is sent while the
 * graph has too little room left (find.js noRoom), after a call went unanswered, or on a connection other than the
 * one the run began on.
 */
const { BinaryWriter, readFlexLong } = require("./wire");
const { SIG, searchArgs } = require("./methods");
const { field, isRef, waitFor, fullNameOf, shortType } = require("./objects");
const { whole } = require("./settings-probe");
const { ask, performerOf } = require("./reads-probe");
const { noRoom, sourceName, walk } = require("./find");
const { profileFor } = require("./session");
const { readList } = require("./focus");

const SIMILAR_ASKED = 3, ALBUMS_SHOWN = 15, MAX_ITEMS = 30, ALBUM_WAIT_MS = 8000, SEARCH_MS = 4000;

/** An object the graph holds, whole, by its reference. @param {any} graph @param {any} v */
const wholeOf = (graph, v) => whole(graph, v, new Set());

/**
 * A list member's items, however it is held, and whether all of it arrived: its bytes (LengthPrefixed, focus.js
 * readList), a list object by reference (its $items against its $count; -1 is a list cut short), an array; a lone
 * reference as one item. Null when the member didn't come.
 * @param {any} graph @param {any} holder  the object @param {string} name
 * @returns {{ items: any[], form: string, whole: boolean, count?: number } | null}
 */
function itemsOf(graph, holder, name) {
  const v = field(holder, name);
  if (v === undefined) return null;
  if (Buffer.isBuffer(v)) {
    const l = readList(graph, fullNameOf(holder.fields, name), v);
    return l ? { items: l.items, form: "LengthPrefixed list", whole: !!l.whole, count: l.count }
      : { items: [], form: "bytes not read as a list: " + v.subarray(0, 64).toString("hex"), whole: false };
  }
  if (isRef(v)) {
    const o = graph.get(BigInt(v.$ref));
    if (o && o.loaded && Array.isArray(o.fields.$items)) {
      const count = o.fields.$count;
      return { items: o.fields.$items, form: "list object " + shortType(o.typeName), whole: count >= 0 && o.fields.$items.length >= count, count };
    }
    if (!o || !o.loaded) return { items: [], form: "a list object named, not yet pushed", whole: false };
    return { items: [v], form: "one object by reference", whole: true };
  }
  return Array.isArray(v) ? { items: v, form: "array", whole: true } : { items: [v], form: typeof v, whole: true };
}

/** A member's items, each given whole, the first MAX_ITEMS. @param {any} graph @param {any} holder @param {string} name */
function membersWhole(graph, holder, name) {
  const got = itemsOf(graph, holder, name);
  if (!got) return { skipped: `It came without ${name} (none, or at its default).` };
  return Object.assign({ form: got.form, count: got.items.length, items: got.items.slice(0, MAX_ITEMS).map((x) => wholeOf(graph, x)) },
    got.whole ? {} : { cut: "Not all of it had arrived.", declared: got.count ?? null },
    got.items.length > MAX_ITEMS ? { more: got.items.length - MAX_ITEMS } : {});
}

/** A call's answer that named no object the graph holds: everything ask() said of it, never thrown away. @param {any} r */
const said = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "method"));

/**
 * @param {{ link: { session(): any, status?: () => any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           log?: (line: string) => void, off: () => string | null, known: (s: any) => Map<string, any> | null,
 *           keyOf: (title: string, artist: string) => string | null, zones: () => any[], profile: () => string | null,
 *           albumWaitMs?: number, searchMs?: number }} deps
 */
function createSuggestProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;

  /** The session the run may use, or why not. @param {any} [was]  the run's own session: another is refused */
  function ready(was) {
    const why = deps.off();
    if (why) return { error: why, status: 503 };
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
    if (was && s !== was) return { error: "Native mode's connection changed during the read; run it again.", status: 503 };
    const full = noRoom(s);
    if (full) return { error: full, status: 503 };
    const known = deps.known(s);
    if (!known) return { error: "Your library hasn't been read on this connection to your server yet.", status: 503 };
    return { s, known };
  }

  /** The connection's state, as reads-probe.js says it. @param {any} s */
  function state(s) {
    const graph = s.graph;
    const open = !!deps.link && deps.link.session() === s;
    const down = !open && deps.link && deps.link.status ? deps.link.status().lastDown || null : null;
    return Object.assign({ objects: graph.objects.size, cap: graph.maxObjects, overflowed: !!graph.overflowed,
      decodeErrors: graph.decodeErrors || 0, uncertain: s.g.uncertain() || null,
      keepalive: typeof s.keepalive === "function" ? Object.assign({}, s.keepalive()) : null, stillOpen: open }, down ? { lastDown: down } : {});
  }

  /**
   * The album asked about: by title and artist; by title alone; else the one playing (by its key, else its title when one
   * album of the library has it); else, with nothing playing, the library's first. Something playing that isn't in the
   * library is said, never passed over for another album.
   * @param {Map<string, any>} known @param {{ title?: string, artist?: string }} o
   * @returns {{ album: any, chose: string } | { error: string, status: number }}
   */
  function choose(known, o) {
    const all = [...known.values()];
    const k = (/** @type {string} */ t, /** @type {string} */ a) => deps.keyOf(t, a);
    const byBoth = (/** @type {string} */ t, /** @type {string} */ a) => { const w = k(t, a); return w ? all.find((x) => k(x.title, x.artist) === w) : undefined; };
    const byTitle = (/** @type {string} */ t) => { const w = k(t, ""); const hits = w ? all.filter((x) => k(x.title, "") === w) : []; return hits.length === 1 ? hits[0] : undefined; };
    if (o.title) {
      const a = o.artist ? byBoth(o.title, o.artist) : byTitle(o.title);
      return a ? { album: a, chose: "the album named" }
        : { error: "No album of that title" + (o.artist ? " and artist in your server's library on this connection." : " alone in your server's library on this connection (none, or more than one: add &artist=)."), status: 404 };
    }
    const z = (deps.zones() || []).find((x) => x.state === "playing" && x.now_playing && x.now_playing.three_line);
    if (z) {
      const np = z.now_playing.three_line, t = String(np.line3 || ""), ar = String(np.line2 || "");
      const a = byBoth(t, ar) || byTitle(t);
      return a ? { album: a, chose: "the album playing in " + (z.display_name || "a zone") }
        : { error: `"${t}" by ${ar}, playing in ${z.display_name || "a zone"}, isn't an album of your library on this connection: add &title=…&artist=… for one that is.`, status: 404 };
    }
    const first = all[0];
    return first ? { album: first, chose: "the library's first (nothing is playing)" } : { error: "The library is empty.", status: 404 };
  }

  return {
    /**
     * The probe of roon-suggestions.md §4, once. title/artist: the album; without them, the album playing.
     * @param {{ title?: string, artist?: string }} [o]
     */
    async run(o = {}) {
      if (busy) return { error: "A read is already running; wait for it.", status: 409 };
      busy = true;
      try {
        /** @type {any} */
        let s0 = null;
        /** @type {bigint[]} */
        let similar = [];
        const out = /** @type {Record<string, any>} */ ({ readOnly: true, design: "dev/design/roon-suggestions.md §4" });
        // 1–2, in one turn: the album's See also, its artist's similar artists.
        const first = await deps.inTurn(async () => {
          const r = ready();
          if (!("s" in r)) return r;
          const { s, known } = r;
          s0 = s;
          const c = choose(known, o);
          if (!("album" in c)) return c;
          const { graph, root } = s;
          out.asked = { title: c.album.title, artist: c.album.artist, chose: c.chose };
          out.connection = { before: state(s), after: /** @type {Record<string, any>} */ ({}) };
          try {
            const oid = BigInt(c.album.oid);
            const got = await ask(s, root.library.oid, SIG.getAlbum, () => new BinaryWriter().long(oid).toBuffer(),
              { what: `the album, object ${oid}`, waitMs: deps.albumWaitMs ?? ALBUM_WAIT_MS });
            const held = got.answer && got.answer.oid ? graph.get(BigInt(got.answer.oid)) : null;
            if (!held || !held.loaded) { out.album = said(got); out.seeAlso = { skipped: "GetAlbum gave no Album the graph holds (album, as it came)." }; return null; }
            // The Album itself is not what is asked; its See also and its artist are.
            out.album = { ms: got.ms, title: field(held, "Title") };
            out.seeAlso = membersWhole(graph, held, "SeeAlso");
            const perf = performerOf(graph, held);
            if (perf === null) { out.performer = { skipped: "The album came without a main performer the graph holds." }; return null; }
            const p = await ask(s, root.library.oid, SIG.getPerformer, () => new BinaryWriter().long(perf).toBuffer(), { what: `its main performer, object ${perf}` });
            const ph = p.answer && p.answer.oid ? graph.get(BigInt(p.answer.oid)) : null;
            if (!ph || !ph.loaded) { out.performer = said(p); return null; }
            out.performer = { ms: p.ms, name: field(ph, "Name") };
            out.similarTo = membersWhole(graph, ph, "SimilarTo");
            const items = itemsOf(graph, ph, "SimilarTo");
            similar = items ? items.items.filter(isRef).map((x) => BigInt(x.$ref)).slice(0, SIMILAR_ASKED) : [];
          } catch (e) {
            out.albumError = String(e && /** @type {any} */ (e).message);
          } finally {
            out.connection.after.album = state(s);
          }
          return null;
        });
        if (first) return first;

        // 3. Each of the first three similar artists, in a turn of its own: native mode's other work goes between them.
        out.similarRead = [];
        for (const pid of similar) {
          const one = /** @type {Record<string, any>} */ ({ oid: String(pid) });
          out.similarRead.push(one);
          await deps.inTurn(async () => {
            const r = ready(s0);
            if (!("s" in r)) { one.skipped = r.error; return; }
            const { s, known } = r;
            try {
              const lite = s.graph.get(pid);
              const name = lite ? field(lite, "Name") : undefined;
              one.name = typeof name === "string" ? name : null;
              const p = await ask(s, s.root.library.oid, SIG.getPerformer, () => new BinaryWriter().long(pid).toBuffer(), { what: `a similar artist, object ${pid}` });
              one.performer = p.answer && p.answer.oid && p.answer.object ? Object.assign({ ms: p.ms }, wholeOf(s.graph, { $ref: BigInt(p.answer.oid) })) : said(p);
              if (!one.name) one.search = { skipped: "No name to search for." };
              else if (s.g.uncertain()) one.search = { skipped: "An earlier call went unanswered; nothing more was sent." };
              else one.search = await searchFor(s, known, one.name, deps.searchMs ?? SEARCH_MS);
            } catch (e) {
              one.error = String(e && /** @type {any} */ (e).message);
            } finally {
              out.connection.after["similar " + pid] = state(s);
            }
          });
        }
        log("suggestions probe: run");
        return out;
      } finally {
        busy = false;
      }
    },
  };

  /**
   * Roon's search for a name, read as find.js reads one: waited for until whole (its walk), its albums in Roon's order
   * (top results, top album, top library album, then the album list; each in the library or not, its source and
   * AlbumId), and the result's own members, each list by its count and first items; the result disposed once.
   * @param {any} s @param {Map<string, any>} known @param {string} name @param {number} waitMs
   */
  async function searchFor(s, known, name, waitMs) {
    const { g, graph, root } = s;
    const pid = /** @type {Buffer} */ (profileFor(root, deps.profile()));
    const t0 = Date.now();
    const res = await g.call(root.library.oid, SIG.unifiedSearch, searchArgs(g, pid, name));
    if (!res.success) return { query: name, refused: String(res.status), ms: Date.now() - t0 };
    const r = readFlexLong(res.payload, 0);
    if (!r || r[0] < 2n || r[1] !== res.payload.length) return { query: name, error: "No result object in the answer.", ms: Date.now() - t0 };
    const rid = r[0];
    try {
      const got = await waitFor(waitMs, () => { const v = walk(graph, rid, known); return v && v.whole ? v : undefined; });
      const sofar = got || walk(graph, rid, known);
      const res0 = graph.get(rid);
      /** @type {Record<string, any>} */
      const members = {};
      for (const k of Object.keys(res0 && res0.loaded ? res0.fields : {})) {
        if (k.startsWith("$")) continue;
        const short = k.slice(k.lastIndexOf("::") + 2), list = itemsOf(graph, res0, short);
        members[short] = list && list.items.length > 1
          ? Object.assign({ form: list.form, count: list.items.length, first: list.items.slice(0, 3).map((x) => wholeOf(graph, x)) }, list.whole ? {} : { cut: true })
          : wholeOf(graph, res0.fields[k]);
      }
      const hits = sofar ? sofar.hits : [];
      return Object.assign({ query: name, ms: Date.now() - t0, whole: !!got, members, albumsFound: hits.length,
        albums: hits.slice(0, ALBUMS_SHOWN).map((h) => ({ title: h.title, artist: h.artist, source: sourceName(h.contentSource ?? null), inLibrary: h.inLibrary, albumId: h.albumId ?? null })) },
        got ? {} : { incomplete: `Not all of the result had arrived after ${waitMs / 1000} s: what had, as it was.` });
    } finally {
      g.callNoReply(rid, SIG.searchDispose, Buffer.alloc(0));
      graph.forget(rid);
    }
  }
}

module.exports = { createSuggestProbe, itemsOf };
