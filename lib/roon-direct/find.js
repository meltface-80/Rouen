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
 * Sent once a connection (§4): an album the library read was sent comes back as a bare reference,
 * or as a later push of one field (a favourite); it is taken from what the connection has been
 * sent (`known`), which is also how it is known to be in the library. Everything else the search
 * sends stays in the graph, the result object alone let go: an album let go and later added to the
 * library would come short to the next read (its row alone), and an album's versions named again
 * by a later search would never arrive.
 *
 * A check runs on its own (v1.9.33, the review): started by one request, followed by others, so
 * nothing waits on one request for twenty searches.
 */
const { field, plain, isRef, waitFor } = require("./objects");
const { SIG, searchArgs } = require("./methods");
const { readFlexLong } = require("./wire");
const { profileFor } = require("./session");
const { sentWhole } = require("./albums");

/** MediaSource (the catalogue's enum), as the owner's server gave it (source.js). */
const SOURCE_CODE = Object.freeze({ tidal: 128, qobuz: 256 });
const NAME_OF = Object.freeze({ 1: "your own files", 128: "TIDAL", 256: "Qobuz" });
/** Each service a check asks about, by name: what the route takes and the page shows (one source). */
const SERVICES = Object.freeze(Object.fromEntries(Object.entries(SOURCE_CODE).map(([k, c]) => [k, NAME_OF[c]])));
const MAX_ITEMS = 20;

/**
 * A credit as a person reads it: the owner's server sends a catalogue album's PerformedBy with each
 * artist as a link, "[[4707962|June McDoom]]" or "[[8043642|Bibio]] & [[12822906|Dorian Concept]]"
 * (v1.9.36's probes, 2026-10-21); the library's come plain. Matched and shown by the names alone.
 * @param {string} s
 */
const plainCredit = (s) => s.replace(/\[\[\d+\|([^\]]*)\]\]/g, "$1");

/** A source's name, as a page shows it. @param {number | null} cs */
const sourceName = (cs) => (cs === null ? "unknown" : (/** @type {any} */ (NAME_OF))[cs] || `source ${cs}`);

/**
 * An album as the graph has it, laid over what the library read had of it (`base`), as albums.js
 * lays a later push over a known album: a field the graph holds is the server's later word. Shared
 * with listen-later.js (v1.9.36).
 * @param {any} a  the graph's object, or undefined (let go) @param {boolean} inLibrary @param {import("./albums").RoonAlbum} [base]
 * @returns {{ title: string, artist: string, contentSource: number | null, albumId: string | null, inLibrary: boolean }}
 */
function albumHit(a, inLibrary, base) {
  const t = field(a, "Title"), by = field(a, "PerformedBy"), cs = plain(field(a, "ContentSource")), aid = field(a, "AlbumId");
  return { title: typeof t === "string" ? t : base ? base.title : "", artist: typeof by === "string" ? plainCredit(by) : base ? base.artist : "",
    contentSource: typeof cs === "number" ? cs : base ? base.contentSource : null,
    albumId: typeof aid === "bigint" || typeof aid === "number" ? String(aid) : base ? base.albumId : null, inLibrary };
}

/** Room kept for the library's own reads on a connection: what a search or a list sends goes after it. */
const RESERVE = 25000;

/**
 * Why nothing more may be asked on this connection, or null: what a search or a list sends stays in
 * the graph (§9.1), and a graph at its cap fails the next library read — so none once fewer than
 * RESERVE objects of room are left. (v1.9.33 to v1.9.36 refused past half the cap: the owner's own
 * library of 12,962 albums holds 101,006 straight after its read, so nothing could ever run.)
 * @param {any} s  the session
 */
const noRoom = (s) => (s && s.graph && s.graph.maxObjects - s.graph.objects.size < RESERVE
  ? `Rouen's copy of what your server has sent on this connection has under ${RESERVE.toLocaleString("en")} objects of room left; this waits for the next connection (overnight, or when native mode is turned off and on).` : null);
const ALBUM = /\.Album(Lite)?$/;

/** An album the search gave. @typedef {{ title: string, artist: string, contentSource: number | null, albumId: string | null, inLibrary: boolean }} Hit */
/** One album asked about. @typedef {{ title: string, artist: string, service: "tidal" | "qobuz" }} Wanted */
/**
 * What the search said of it.
 * @typedef {{ title: string, artist: string, service: string,
 *             verdict: "found" | "no-id" | "in-library" | "other-source" | "not-found" | "incomplete" | "error",
 *             why?: string, hits?: Array<{ title: string, artist: string, source: string, inLibrary: boolean }> }} Finding
 */
/** The last check begun, as the page follows it (running while `busy`). @typedef {{ total: number, findings: Finding[], error: string | null }} Check */

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           keyOf: (title: string, artist: string) => string | null, profile: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null,
 *           off: () => string | null, log?: (line: string) => void, settleMs?: number }} deps
 *   known: what the connection has been sent of each library album (stage1.js), by object id, or
 *     null while its library has not been read on it;
 *   off: why no search may run now (native mode off, the library not read), or null
 */
function createFinder(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 4000;
  let busy = false;
  /** @type {Check} */
  let last = { total: 0, findings: [], error: null };

  /**
   * Why no check may begin now, or null; one place for find() and start(). What a search sends stays
   * in the graph (§9.1), and a graph at its cap fails the next library read: none past half.
   * @returns {{ error: string, status: number } | null}
   */
  function refusal() {
    const why = deps.off();
    if (why) return { error: why, status: 409 };
    if (busy) return { error: "A check is already running.", status: 409 };
    const full = noRoom(deps.link ? deps.link.session() : null);
    return full ? { error: full, status: 409 } : null;
  }

  /**
   * The albums a result holds so far, and whether all of it has arrived; undefined until the
   * result object itself has (a stub carries no members yet; one pushed with none found nothing).
   * @param {any} graph @param {bigint} rootId @param {Map<string, any>} known
   * @returns {{ hits: Hit[], whole: boolean } | undefined}
   */
  function walk(graph, rootId, known) {
    const root = graph.get(rootId);
    if (!root || !root.loaded) return undefined;
    /** @type {Map<string, Hit>} */
    const hits = new Map();
    const seen = new Set([rootId.toString()]);
    let whole = true;
    /** @param {any} a @param {string} id @param {boolean} inLibrary @param {import("./albums").RoonAlbum} [base] */
    const album = (a, id, inLibrary, base) => {
      const was = hits.get(id);
      if (was) { was.inLibrary = was.inLibrary || inLibrary; return; }
      hits.set(id, albumHit(a, inLibrary, base));
    };
    /** @param {any} v @param {boolean} inLibrary */
    const visit = (v, inLibrary) => {
      if (v === null || v === undefined) return;
      if (isRef(v)) {
        const id = v.$ref.toString();
        const o = graph.get(v.$ref);
        // Sent to the library read on this connection: in the library, as the read had it (§9.1), with
        // whatever the graph holds of it since (nothing, let go; a favourite or a title pushed alone).
        const k = known.get(id);
        if (k) { album(o, id, true, k); return; }
        if (!o) { whole = false; return; }
        if (ALBUM.test(o.typeName)) { if (sentWhole(o)) album(o, id, inLibrary); else whole = false; return; }
        if (seen.has(id)) return;
        seen.add(id);
        if (!o.loaded) { whole = false; return; }
        // Cut short (-1), or a query whose items are still to come.
        if (o.fields.$items) { if (o.fields.$count < 0 || o.fields.$items.length < o.fields.$count) whole = false; for (const x of o.fields.$items) visit(x, inLibrary); return; }
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
    return { hits: [...hits.values()], whole };
  }

  /** The first few, as the page shows them. @param {Hit[]} list */
  const shown = (list) => list.slice(0, 5).map((h) => ({ title: h.title, artist: h.artist, source: sourceName(h.contentSource), inLibrary: h.inLibrary }));

  /** @param {any} s @param {Wanted} w @returns {Promise<Finding>} */
  async function searchOne(s, w) {
    const base = { title: w.title, artist: w.artist, service: w.service };
    // A new connection (the nightly one, another profile) before its read: a library album sent in full
    // by the search could not be told from the catalogue's, and would pass for one to add.
    const known = deps.known(s);
    if (!known) return Object.assign(base, { verdict: /** @type {const} */ ("error"), why: "Your library hasn't been read on this connection to your server yet; check again in a minute." });
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
      got = await waitFor(settleMs, () => { const v = walk(graph, rid, known); return v && v.whole ? v : undefined; });
    } finally {
      // Let go on the server, once; and this side's copy of the result object alone (what it named stays, above).
      g.callNoReply(rid, SIG.searchDispose, Buffer.alloc(0));
    }
    const sofar = got || walk(graph, rid, known);
    graph.forget(rid);
    if (!got) {
      return Object.assign(base, { verdict: /** @type {const} */ ("incomplete"), why: `Your server's search result had not all arrived after ${settleMs / 1000} s.`,
        hits: shown(sofar ? sofar.hits : []) });
    }
    return judge(base, w, got.hits);
  }

  /** @param {{ title: string, artist: string, service: string }} base @param {Wanted} w @param {Hit[]} hits @returns {Finding} */
  function judge(base, w, hits) {
    const want = deps.keyOf(w.title, w.artist);
    const same = hits.filter((h) => want !== null && deps.keyOf(h.title, h.artist) === want);
    if (same.some((h) => h.inLibrary)) return Object.assign(base, { verdict: /** @type {const} */ ("in-library"), hits: shown(same) });
    const onIt = same.filter((h) => h.contentSource === SOURCE_CODE[w.service]);
    if (onIt.some((h) => h.albumId !== null)) return Object.assign(base, { verdict: /** @type {const} */ ("found"), hits: shown(same) });
    // On that service, but with no AlbumId: nothing an add could name it by.
    if (onIt.length) return Object.assign(base, { verdict: /** @type {const} */ ("no-id"), hits: shown(same) });
    if (same.length) return Object.assign(base, { verdict: /** @type {const} */ ("other-source"), hits: shown(same) });
    return Object.assign(base, { verdict: /** @type {const} */ ("not-found"), hits: shown(hits) });
  }

  /**
   * Each album asked about in turn, a search each, taking turns with reads and hearts.
   * @param {Wanted[]} wanted
   * @param {(f: Finding) => void} [each] told of each finding as it comes
   * @returns {Promise<{ findings: Finding[] } | { error: string, status: number }>}
   */
  async function find(wanted, each) {
    const no = refusal();
    if (no) return no;
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
        if (each) each(f);
      }
      // What the search sent stays in the graph (above): its size, to read against the cap if a check is run often.
      const s = deps.link ? deps.link.session() : null;
      log(`searched for ${findings.length} album(s): ` + ["found", "no-id", "in-library", "other-source", "not-found", "incomplete", "error"]
        .map((v) => `${findings.filter((f) => f.verdict === v).length} ${v}`).join(", ")
        + (s && s.graph ? `; the connection now holds ${s.graph.objects.size} objects` : ""));
      return { findings };
    } finally {
      busy = false;
    }
  }

  return {
    find,
    /**
     * A check begun, to follow with progress(); refused as find() would be.
     * @param {Wanted[]} wanted
     * @returns {{ running: true, total: number } | { error: string, status: number }}
     */
    start(wanted) {
      const no = refusal();
      if (no) return no;
      const list = wanted.slice(0, MAX_ITEMS);
      /** @type {Check} */
      const now = { total: list.length, findings: [], error: null };
      last = now;
      // find() takes `busy` before its first await: refused by nothing, as refusal() has just said.
      find(list, (f) => { now.findings.push(f); })
        .then((out) => { if ("error" in out) now.error = out.error; },
          (e) => { now.error = "The check stopped: " + (e && /** @type {any} */ (e).message); log("check stopped: " + (e && /** @type {any} */ (e).message)); });
      return { running: true, total: list.length };
    },
    /** The last check begun, as far as it has got; and what a check takes. */
    progress() {
      return { running: busy, total: last.total, findings: last.findings.slice(), error: last.error, max: MAX_ITEMS, services: SERVICES };
    },
  };
}

module.exports = { createFinder, MAX_ITEMS, SERVICES, sourceName, albumHit, noRoom, plainCredit };
