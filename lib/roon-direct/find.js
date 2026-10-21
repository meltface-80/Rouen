// @ts-check
"use strict";
/*
 * find.js — N2b-1 (dev/design/native-remote.md §9.1, v1.9.32): the server's own search, asked
 * whether it can find the TIDAL and Qobuz albums Rouen would add to the library. Read only:
 * nothing is written, and nothing runs unless Settings → Native mode's check is pressed.
 *
 *   Library::UnifiedSearch("title artist") on the link's session → a UnifiedSearchResults object
 *   the server pushes → its albums (top results, top album, top library album, the album list),
 *   each in the library or not → UnifiedSearchResults::Dispose(), sent once, without waiting.
 *
 * Sent once a connection (§4): an album the library read was sent, and let go, comes back as a
 * bare reference; it is taken from what the connection has been sent (`known`), which is also how
 * it is known to be in the library. An album the search sends anew stays in the graph: let go, and
 * later added to the library, the next library read would be given its row alone and come short.
 */
const { field, plain, isRef, waitFor } = require("./objects");
const { SIG, searchArgs } = require("./methods");
const { readFlexLong } = require("./wire");
const { profileFor } = require("./session");

/** MediaSource (the catalogue's enum), as the owner's server gave it (source.js). */
const SOURCE_CODE = Object.freeze({ tidal: 128, qobuz: 256 });
const NAME_OF = Object.freeze({ 1: "your own files", 128: "TIDAL", 256: "Qobuz" });
const MAX_ITEMS = 20;

/** An album the search gave. @typedef {{ title: string, artist: string, contentSource: number | null, albumId: string | null, inLibrary: boolean }} Hit */
/** One album asked about. @typedef {{ title: string, artist: string, service: "tidal" | "qobuz" }} Wanted */
/**
 * What the search said of it.
 * @typedef {{ title: string, artist: string, service: string,
 *             verdict: "found" | "no-id" | "in-library" | "other-source" | "not-found" | "incomplete" | "error",
 *             why?: string, hits?: Array<{ title: string, artist: string, source: string, inLibrary: boolean }> }} Finding
 */

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           keyOf: (title: string, artist: string) => string | null, profile: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null,
 *           off: () => string | null, log?: (line: string) => void, settleMs?: number }} deps
 *   known: what the connection has been sent of each library album (stage1.js), by object id, or null;
 *   off: why no search may run now (native mode off, the library not read), or null
 */
function createFinder(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 4000;
  let busy = false;

  /**
   * The albums a result holds, or undefined while a piece of it has not arrived.
   * @param {any} graph @param {bigint} rootId @param {Map<string, any> | null} known
   * @returns {{ hits: Hit[], containers: bigint[] } | undefined}
   */
  function walk(graph, rootId, known) {
    const root = graph.get(rootId);
    if (!root || !Object.keys(root.fields).length) return undefined;   // a stub carries no members yet
    /** @type {Map<string, Hit>} */
    const hits = new Map();
    /** @type {bigint[]} */
    const containers = [rootId];
    const seen = new Set([rootId.toString()]);
    let whole = true;
    /** @param {any} a @param {string} id @param {boolean} inLibrary */
    const album = (a, id, inLibrary) => {
      const was = hits.get(id);
      if (was) { was.inLibrary = was.inLibrary || inLibrary; return; }
      const cs = plain(field(a, "ContentSource"));
      const aid = field(a, "AlbumId");
      hits.set(id, { title: String(field(a, "Title") || ""), artist: String(field(a, "PerformedBy") || ""),
        contentSource: typeof cs === "number" ? cs : null,
        albumId: typeof aid === "bigint" || typeof aid === "number" ? String(aid) : null, inLibrary });
    };
    /** @param {any} v @param {boolean} inLibrary */
    const visit = (v, inLibrary) => {
      if (v === null || v === undefined) return;
      if (isRef(v)) {
        const id = v.$ref.toString();
        const o = graph.get(v.$ref);
        if (!o) {
          // Sent before on this connection and let go by the library read: in the library (§9.1).
          const k = known && known.get(id);
          if (k) { hits.set(id, Object.assign({}, k, { inLibrary: true })); return; }
          whole = false;
          return;
        }
        if (/\.Album(Lite)?$/.test(o.typeName)) { album(o, id, inLibrary || (known ? known.has(id) : false)); return; }
        if (seen.has(id)) return;
        seen.add(id);
        containers.push(v.$ref);
        if (o.fields.$items) { if (o.fields.$count < 0) whole = false; for (const x of o.fields.$items) visit(x, inLibrary); return; }
        if (/\.AlbumLiteVersions$/.test(o.typeName)) { visit(field(o, "Albums"), inLibrary); return; }
        return;   // performers, tracks, works: not what is asked
      }
      if (typeof v === "object" && /\.TopSearchResult$/.test(String(v.$type))) {
        // An inline value: its members are on it, by their full names (objects.js readValue).
        const member = (/** @type {string} */ name) => { const k = Object.keys(v).find((x) => x.endsWith("::" + name)); return k ? v[k] : undefined; };
        visit(member("Album"), inLibrary);
        visit(member("LibraryAlbum"), true);
      }
    };
    visit(field(root, "TopSearchResults"), false);
    visit(field(root, "TopAlbum"), false);
    visit(field(root, "TopLibraryAlbum"), true);
    visit(field(root, "Albums"), false);
    return whole ? { hits: [...hits.values()], containers } : undefined;
  }

  /** @param {any} s @param {Wanted} w @returns {Promise<Finding>} */
  async function searchOne(s, w) {
    const base = { title: w.title, artist: w.artist, service: w.service };
    const { g, graph, root } = s;
    if (g.uncertain()) return Object.assign(base, { verdict: /** @type {const} */ ("error"), why: "The connection to your server is being checked." });
    const pid = /** @type {Buffer} */ (profileFor(root, deps.profile()));
    const res = await g.call(root.library.oid, SIG.unifiedSearch, searchArgs(g, pid, `${w.title} ${w.artist}`.trim()));
    if (!res.success) return Object.assign(base, { verdict: /** @type {const} */ ("error"), why: `Your server refused the search ("${res.status}").` });
    const r = readFlexLong(res.payload, 0);
    if (!r || r[0] < 2n || r[1] !== res.payload.length) return Object.assign(base, { verdict: /** @type {const} */ ("error"), why: "Your server's search came back with no result object." });
    const rid = r[0];
    let got;
    try {
      got = await waitFor(settleMs, () => walk(graph, rid, deps.known(s)));
    } finally {
      // Let go on the server, once; and this side's copy of the result's lists (its albums stay, §9.1).
      g.callNoReply(rid, SIG.searchDispose, Buffer.alloc(0));
    }
    const done = got || walk(graph, rid, deps.known(s));
    for (const c of done ? done.containers : [rid]) graph.forget(c);
    if (!got) return Object.assign(base, { verdict: /** @type {const} */ ("incomplete"), why: `Your server's search result had not all arrived after ${settleMs / 1000} s.` });
    return judge(base, w, got.hits);
  }

  /** @param {{ title: string, artist: string, service: string }} base @param {Wanted} w @param {Hit[]} hits @returns {Finding} */
  function judge(base, w, hits) {
    const want = deps.keyOf(w.title, w.artist);
    const same = hits.filter((h) => want !== null && deps.keyOf(h.title, h.artist) === want);
    const shown = (/** @type {Hit[]} */ list) => list.slice(0, 5).map((h) => ({ title: h.title, artist: h.artist,
      source: h.contentSource === null ? "unknown" : (/** @type {any} */ (NAME_OF))[h.contentSource] || `source ${h.contentSource}`, inLibrary: h.inLibrary }));
    if (same.some((h) => h.inLibrary)) return Object.assign(base, { verdict: /** @type {const} */ ("in-library"), hits: shown(same) });
    const onIt = same.filter((h) => h.contentSource === SOURCE_CODE[w.service]);
    if (onIt.some((h) => h.albumId !== null)) return Object.assign(base, { verdict: /** @type {const} */ ("found"), hits: shown(same) });
    // On that service, but with no AlbumId: nothing an add could name it by.
    if (onIt.length) return Object.assign(base, { verdict: /** @type {const} */ ("no-id"), hits: shown(same) });
    if (same.length) return Object.assign(base, { verdict: /** @type {const} */ ("other-source"), hits: shown(same) });
    return Object.assign(base, { verdict: /** @type {const} */ ("not-found"), hits: shown(hits) });
  }

  return {
    /**
     * Each album asked about in turn, a search each, taking turns with reads and hearts.
     * @param {Wanted[]} wanted
     * @returns {Promise<{ findings: Finding[] } | { error: string, status: number }>}
     */
    async find(wanted) {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A check is already running.", status: 409 };
      busy = true;
      try {
        /** @type {Finding[]} */
        const findings = [];
        for (const w of wanted.slice(0, MAX_ITEMS)) {
          const f = await deps.inTurn(async () => {
            const s = deps.link ? deps.link.session() : null;
            if (!s) return Object.assign({ title: w.title, artist: w.artist, service: w.service },
              { verdict: /** @type {const} */ ("error"), why: "Native mode isn't connected to your server right now." });
            // Unanswered, or the connection gone: that album's answer, and the next is asked.
            try { return await searchOne(s, w); }
            catch (e) { return Object.assign({ title: w.title, artist: w.artist, service: w.service },
              { verdict: /** @type {const} */ ("error"), why: "That didn't reach your server: " + (e && /** @type {any} */ (e).message) }); }
          });
          findings.push(f);
        }
        log(`searched for ${findings.length} album(s): ` + ["found", "no-id", "in-library", "other-source", "not-found", "incomplete", "error"]
          .map((v) => `${findings.filter((f) => f.verdict === v).length} ${v}`).join(", "));
        return { findings };
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createFinder, MAX_ITEMS };
