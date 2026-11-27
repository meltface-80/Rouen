// @ts-check
"use strict";
/*
 * added-probe.js — stage 0 of dev/design/recently-added.md (2.0.6-t5): what Roon holds of when each album was added,
 * asked of the owner's server by hand, over native mode's connection, once its library has been read. Read only.
 *
 *   1. AlbumLite's members, and a query row's, as the server declared them on this connection: those that speak of a
 *      date, an import or an addition are what stage 1 would read. No call.
 *   2. The control: Library::VirtualAlbumQuery with no criterion, its Count.
 *   3. Newest first: the same query with Ordering {ImportDate, Descending}, its Count against the control, paged through
 *      whole as stage 1 would (each page released, its rows let go from the graph), each row's album named from the
 *      library read by object id; a row's Index, where it has one, says whether the rows came in its order.
 *   4. Oldest first: Ascending, one page.
 *   5. The verdict (verdictOf, compare): "ordered" only on equal Counts, a whole read of library albums, an oldest-first
 *      page not in the newest-first order, and, in a library of two pages or more, found at the newest-first read's end.
 */
const { field, plain, isRef } = require("./objects");
const { SIG, openAlbumQuery, openAlbumQueryOrdered } = require("./methods");
const { profileFor } = require("./session");
const { pageThrough } = require("./paging");
const { readCount } = require("./locations");
const { noRoom } = require("./find");
const { readNullDate } = require("./focus");

const TIMEOUT_MS = 8000, PAGE_SIZE = 100, PAGE_BUDGET = 300, SAMPLE = 20;
/** Roon's AlbumOrdering ImportDate, and OrderingDirection (focus-map.js). */
const IMPORT_DATE = 1, ASCENDING = 1, DESCENDING = 2;
/** A page's row for an album: its Data is the album (as locations.js reads them). */
const ALBUM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?AlbumLite>$/;
const ALBUM_LITE = /(?:^|\.)AlbumLite$/;
/** A member's name that may hold when an album was added. */
const DATE_LIKE = /date|import|added|created|time/i;

/**
 * The members of the first type the connection declared whose name matches, by their short names.
 * @param {{ types?: Map<number, { name: string, members: Array<{ name: string, propType: number }> }> }} graph @param {RegExp} re
 * @returns {{ type: string, members: string[], dateLike: string[], declared: Array<{ member: string, propType: number }> } | null}
 */
function membersOf(graph, re) {
  for (const t of (graph.types || new Map()).values()) {
    if (!re.test(t.name)) continue;
    const members = t.members.map((m) => m.name.slice(m.name.lastIndexOf("::") + 2));
    // Each date-like member as declared, with its property type (objects.js P): what form its value takes (2.0.6-t7).
    const declared = t.members.filter((m) => DATE_LIKE.test(m.name.slice(m.name.lastIndexOf("::") + 2)))
      .map((m) => ({ member: m.name, propType: m.propType }));
    return { type: t.name, members, dateLike: members.filter((m) => DATE_LIKE.test(m)), declared };
  }
  return null;
}

/** .NET's 0001-01-01 in Unix milliseconds, and its ticks (100 ns) in a millisecond. */
const DOTNET_EPOCH_MS = -62135596800000, TICKS_PER_MS = 10000n;

/** A NullDate's integer as its date, (year << 16) | (month << 8) | day (native-remote.md §12.12), or null outside 1990–2100. @param {number | null | undefined} n */
function nullDateOf(n) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= 2 ** 31) return null;
  const y = n >> 16, m = (n >> 8) & 0xff, d = n & 0xff;
  return y >= 1990 && y <= 2100 && m <= 12 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}

/**
 * An album's raw ImportDate (albums.js importOf) read in every form it may take (2.0.6-t7, recently-added.md §3.2), so
 * the one that gives the dates Roon shows shows itself: digits as .NET ticks (and as a DateTime's ToBinary, its two top
 * bits its kind), Unix milliseconds, Unix seconds and a NullDate's integer; bytes as readNullDate reads them, and each
 * of its integer readings as a NullDate (the review: a NullDate comes as bytes holding that integer). A date outside
 * the years 1990 to 2100 is null.
 * @param {string | null | undefined} raw
 */
function readingsOf(raw) {
  if (raw === null || raw === undefined) return null;
  /** @param {number} ms */
  const iso = (ms) => {
    const d = new Date(ms);
    const y = Number.isFinite(d.getTime()) ? d.getUTCFullYear() : 0;
    return y >= 1990 && y <= 2100 ? d.toISOString() : null;
  };
  if (raw.startsWith("hex:")) {
    const r = readNullDate(Buffer.from(raw.slice(4), "hex"));
    for (const k of ["integer", "optionalInteger", "long", "int32le", "int32be"]) r[k + "AsNullDate"] = nullDateOf(r[k]);
    return { bytes: r };
  }
  if (!/^-?\d+$/.test(raw)) return { other: raw };
  const n = BigInt(raw);
  const nd = Number(n);
  const ticks = (/** @type {bigint} */ t) => iso(DOTNET_EPOCH_MS + Number(t / TICKS_PER_MS));
  return {
    dotnetTicks: ticks(n),
    dotnetBinary: ticks(BigInt.asUintN(64, n) & 0x3FFFFFFFFFFFFFFFn),
    unixMs: iso(nd),
    unixSeconds: iso(nd * 1000),
    nullDate: nullDateOf(nd),
  };
}

/**
 * The two reads compared: how much of the oldest-first page is at the newest-first read's end (a tie within one import
 * may fall either side of a page's edge), and whether the oldest-first page came in the newest-first order (the order
 * ignored: both in the server's own).
 * @param {string[]} desc @param {string[]} asc
 */
function compare(desc, asc) {
  const tail = new Set(desc.slice(-asc.length));
  return { atEnd: asc.length ? asc.filter((id) => tail.has(id)).length / asc.length : 0,
    sameAsNewest: asc.length > 1 && asc.every((id, i) => id === desc[i]) };
}

/**
 * The verdict, from what the reads gave (the review: a small library, an empty one, and a Count that never came are
 * said as what they are, never "ordered").
 * @param {{ control: number | null, controlInferred?: boolean, desc: any, asc: any }} r
 */
function verdictOf(r) {
  const { control, desc, asc } = r;
  if (control === null) return "unknown: the unfiltered control query failed";
  if (r.controlInferred) return "unknown: the unfiltered control's Count never came (a slow Count reads as 0)";
  if (control === 0) return "unknown: the library holds no albums, so there is no order to tell";
  if (!desc || desc.error) return "unknown: the newest-first read failed" + (desc && desc.error ? ` (${desc.error})` : "");
  if (desc.inferred) return "unknown: the newest-first query's Count never came";
  if (desc.count !== control) return `misread: the newest-first query counted ${desc.count} albums, the control ${control} — the order was not taken as sent`;
  if (desc.budgetReached) return `unknown: the newest-first read stopped at its page budget, ${desc.rows} of ${desc.count} albums`;
  if (desc.rows !== desc.count) return `short: ${desc.rows} of ${desc.count} albums came in the newest-first read`;
  if (desc.matched !== desc.rows) return `unpaired: ${desc.rows - desc.matched} of its albums aren't in the library read`;
  if (desc.indexInOrder === false) return "unordered: the rows didn't come in their Index order";
  if (!asc || asc.error || asc.inferred || asc.count !== control) return "unknown: the oldest-first read failed or counted otherwise" + (asc && asc.error ? ` (${asc.error})` : "");
  if (!asc.rows || asc.short) return `unknown: the oldest-first page came short (${asc.rows || 0} albums)`;
  if (control === 1) return "unknown: one album, so there is no order to tell";
  if (asc.sameAsNewest) return "ignored: oldest first came in the same order as newest first — the order was not taken";
  // Only a library of at least two pages' worth can tell by the end: in a smaller one, any oldest-first page is mostly
  // the newest-first read's end whatever the order.
  const large = control >= 2 * asc.rows;
  if (large && asc.atEnd < 0.9) return `not reversed: only ${Math.round(asc.atEnd * 100)}% of the oldest-first page are at the newest-first read's end — the order may not have been taken`;
  return `ordered: ${control} albums in Roon's order of date added, newest and oldest first` +
    (large ? "" : " (a small library: told by the two directions differing)") + " — compare the first 20 with Roon's own Albums sorted by Date added";
}

/**
 * One read in Roon's order of date added: opened, counted, paged (all, or up to the budget), disposed once.
 * @param {any} s @param {any} o @param {number} direction @param {number} maxPages
 */
async function orderedRead(s, o, direction, maxPages) {
  const { g, graph } = s;
  /** @type {bigint | null} */
  let q = null;
  try {
    q = await openAlbumQueryOrdered(g, o.libraryOid, o.profileId, IMPORT_DATE, direction, o.pageSize);
    o.lifetime.queriesOpened++;
    const c = await readCount(graph, q, o.timeoutMs, o.countGraceMs);
    if ("error" in c) return { count: null, error: c.error };
    const count = c.inferred ? 0 : c.count;
    const inferred = !!c.inferred;
    /** Each album's row, and its Index where the row has one. @type {Map<string, bigint>} */
    const rowOf = new Map();
    /** @type {Map<string, number | null>} */
    const indexOf = new Map();
    const paged = await pageThrough(g, graph, q, count, {
      pageSize: o.pageSize, timeoutMs: o.timeoutMs, lifetime: o.lifetime, retain: SIG.albumRetainPage, release: SIG.albumReleasePage,
      stopWhenShort: true, maxPages,
      take: (obj) => {
        if (!ALBUM_ROW.test(obj.typeName)) return null;
        const d = field(obj, "Data");
        if (!isRef(d)) return null;
        const id = d.$ref.toString();
        rowOf.set(id, obj.oid);
        const ix = plain(field(obj, "Index"));
        indexOf.set(id, typeof ix === "number" ? ix : typeof ix === "bigint" ? Number(ix) : null);
        return id;
      },
      // A whole library's rows on the connection native mode keeps: each page's let go once read (as albums.js does).
      afterPage: () => { for (const row of rowOf.values()) graph.forget(row); rowOf.clear(); },
    });
    const ids = [...paged.seen];
    const indexes = ids.map((id) => indexOf.get(id));
    const indexInOrder = indexes.every((x) => typeof x === "number") ? indexes.every((x, i) => i === 0 || /** @type {number} */ (x) > /** @type {number} */ (indexes[i - 1])) : null;
    const name = (/** @type {string} */ id) => {
      const a = o.byOid.get(id);
      const ix = indexOf.get(id);
      const at = typeof ix === "number" ? { index: ix } : {};
      // The album's ImportDate as the library read kept it, and its readings (2.0.6-t7).
      const imp = a && a.importDate !== undefined ? { importDate: a.importDate, readings: readingsOf(a.importDate) } : {};
      return a ? { title: a.title || null, by: a.artist || null, contentSource: a.contentSource, ...at, ...imp } : { oid: id, inLibrary: false, ...at };
    };
    // The budget, only when nothing else stopped it (the review: a short page is said as short).
    const budgetReached = !paged.short && !paged.error && ids.length < count && paged.pages >= maxPages;
    return { count, ...(inferred ? { inferred } : {}), rows: ids.length, pages: paged.pages, matched: ids.filter((id) => o.byOid.has(id)).length, indexInOrder,
      budgetReached, ids, first: ids.slice(0, SAMPLE).map(name),
      ...(paged.error ? { error: paged.error } : {}), ...(paged.short ? { short: true } : {}) };
  } catch (e) {
    return { count: null, error: String(e && /** @type {any} */ (e).message) };
  } finally {
    if (q !== null) { if (g.callNoReply(q, SIG.albumDispose, Buffer.alloc(0))) o.lifetime.queriesDisposed++; else o.lifetime.unsent++; }
  }
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, profile: () => string | null, log?: (line: string) => void }} deps
 */
function createAddedProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;
  return {
    /** @param {{ maxPages?: number, countGraceMs?: number }} [o] @returns {Promise<any>} */
    async run(o = {}) {
      const why = deps.off();
      if (why) return { error: why, status: 503 };
      if (busy) return { error: "A probe is already running; wait for it.", status: 409 };
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
          if (!root.library) return { error: "The Core's graph arrived without its Library.", status: 503 };
          if (!root.profileId) return { error: "The Core's graph arrived without a profile.", status: 503 };
          const profileId = /** @type {Buffer} */ (profileFor({ profiles: root.profiles || [], profileId: root.profileId }, deps.profile()));
          const t0 = Date.now();
          const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
          /** @type {Map<string, import("./albums").RoonAlbum>} */
          const byOid = new Map();
          for (const a of known.values()) byOid.set(String(a.oid), a);
          const oo = { libraryOid: root.library.oid, profileId, timeoutMs: TIMEOUT_MS, pageSize: PAGE_SIZE, countGraceMs: o.countGraceMs, lifetime, byOid };
          /** @type {Record<string, any>} */
          const out = { readOnly: true, design: "dev/design/recently-added.md §3" };
          // 1. The fields, as declared on this connection.
          out.albumLite = membersOf(graph, ALBUM_LITE);
          out.row = membersOf(graph, ALBUM_ROW);
          // 2. The control.
          /** @type {number | null} */
          let control = null;
          let controlInferred = false;
          /** @type {bigint | null} */
          let cq = null;
          try {
            cq = await openAlbumQuery(s.g, oo.libraryOid, profileId, null, oo.pageSize);
            lifetime.queriesOpened++;
            const r = await readCount(graph, cq, oo.timeoutMs, oo.countGraceMs);
            control = "error" in r ? null : (r.inferred ? 0 : r.count);
            controlInferred = !("error" in r) && !!r.inferred;
            out.control = "error" in r ? { error: r.error } : { albums: control, ...(controlInferred ? { inferred: true } : {}) };
          } catch (e) {
            out.control = { error: String(e && /** @type {any} */ (e).message) };
          } finally {
            if (cq !== null) { if (s.g.callNoReply(cq, SIG.albumDispose, Buffer.alloc(0))) lifetime.queriesDisposed++; else lifetime.unsent++; }
          }
          // 3, 4. Newest first, whole; oldest first, one page.
          /** @type {any} */
          const desc = s.g.uncertain() ? { count: null, error: "an earlier call went unanswered" } : await orderedRead(s, oo, DESCENDING, o.maxPages ?? PAGE_BUDGET);
          /** @type {any} */
          const asc = s.g.uncertain() ? { count: null, error: "an earlier call went unanswered" } : await orderedRead(s, oo, ASCENDING, 1);
          if (asc.ids && desc.ids) Object.assign(asc, compare(desc.ids, asc.ids));
          delete asc.budgetReached;   // a page, as asked: no budget to reach
          out.verdict = verdictOf({ control, controlInferred, desc, asc });
          for (const r of [desc, asc]) delete r.ids;
          out.newestFirst = desc;
          out.oldestFirst = asc;
          // How many albums of the library read carry an ImportDate at all (2.0.6-t7).
          let withImport = 0;
          for (const a of byOid.values()) if (a.importDate) withImport++;
          out.importDates = { albums: byOid.size, withImportDate: withImport };
          out.lifetime = lifetime;
          out.ms = Date.now() - t0;
          out.connection = { stillOpen: !!deps.link && deps.link.session() === s, uncertain: s.g.uncertain() || null, objects: graph.objects.size };
          log("recently-added probe: run");
          return out;
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createAddedProbe, verdictOf, compare, membersOf, orderedRead, readingsOf, nullDateOf, IMPORT_DATE, ASCENDING, DESCENDING };
