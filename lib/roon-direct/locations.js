// @ts-check
"use strict";
/*
 * locations.js — the Locations probe, part of stage 0 of
 * dev/design/roon-native.md (§9.1, option b). Read only, run by the probe
 * after the per-source track queries, on the same connection.
 *
 * The owner's Core (v1.9.12 run) reports TIDAL and Qobuz among its storage
 * Locations. If Library::VirtualAlbumQuery with RequireLocations = [one
 * Location] counts that Location's albums, stage 1 can read an album's source
 * without paging every track. Before v1.9.13 Rouen had not sent
 * RequireLocations (its list encoding is this design's reading, methods.js
 * refList), so the probe proves it rather than assumes it:
 *
 *   1. a control: the same album query with no RequireLocations, whose Count
 *      is every album the profile sees. If it fails, nothing else is asked:
 *      no Location's count could be judged without it;
 *   2. per Location the Core pushed: the query with that Location alone. A
 *      query object that never arrives stops the rest (whatever lost it would
 *      lose them all, at a full timeout each);
 *   3. a verdict (below) that says "filtered" only on evidence a misread
 *      criterion cannot give.
 *
 * Then (v1.9.16, the owner's choice): a Location that stands for a source
 * (albumsource.js) and holds albums is paged (paging.js): its albums are the
 * Data of the page's rows (VirtualQueryElement<AlbumLite>), and a page is
 * whole only when each album's fields have arrived. Its albums, by object id,
 * are checked against the albums the source's tracks belong to — when those
 * were read whole; otherwise one page is read, as a sample of ContentSource —
 * and each album's own ContentSource is read. A source is compared only when
 * every one of its Locations that holds albums was read whole. A page that
 * comes short ends that Location's reading; all Locations share a budget of
 * pages (albumPageBudget), so a probe run by hand stays short.
 * Every page retained is released once; every query opened is disposed
 * exactly once (VirtualAlbumLiteQuery::Dispose, sent without waiting). A
 * timeout stops the run as it does for the track queries (§3).
 */
const { field, plain, waitFor, isRef, imageKeyFrom } = require("./objects");
const { SIG, openAlbumQuery } = require("./methods");
const { pageThrough } = require("./paging");
const { sourceOfLocation, tally, contentSourceVerdict, crossCheck, crossVerdict } = require("./albumsource");

/**
 * An album's cover key: its Image (a reference, or an inline value) has a Url
 * of the form broker:///image/<key>.<ext> (deep-roon-mcp's reading).
 * @param {import("./objects").ObjectGraph} graph
 * @param {any} album
 * @returns {string | null}
 */
function imageKeyOf(graph, album) {
  return imageKeyFrom(graph, field(album, "Image"));
}

/** A page's row for an album: its Data is the album. */
const ALBUM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?AlbumLite>$/;

/**
 * How long a query object that has arrived may go on without a Count before
 * the Count is taken as an absent 0. Only Counts are read, so a long wait is
 * cheap; a Count that came late and was read as 0 is not.
 */
const COUNT_GRACE_MS = 3000;

/**
 * A Location as reported: its name, its category and type, whether it is
 * online, how many files it holds — as the Core pushed them.
 * @param {import("./objects").RoonObject} l
 */
function describeLocation(l) {
  return {
    name: field(l, "DisplayName") || field(l, "Name") || null,
    category: plain(field(l, "Category")), type: plain(field(l, "Type")),
    online: plain(field(l, "IsOnline")), files: plain(field(l, "MusicFileCount")),
  };
}

/**
 * A query's Count. The Core sends struct members sparsely, so a Count of 0
 * may arrive as no Count member at all (the likely story of the owner's
 * Qobuz track query, v1.9.12; not proven). A query object that is there with
 * no Count member after the grace is read as 0 and marked inferred — even
 * when the grace runs past the timeout. A Count that is there but is not a
 * count, or no query object at all, is an error, never a 0.
 * @param {import("./objects").ObjectGraph} graph
 * @param {bigint} qid
 * @param {number} timeoutMs
 * @param {number} [graceMs]
 * @returns {Promise<{ count: number, inferred?: boolean } | { error: string }>}
 */
async function readCount(graph, qid, timeoutMs, graceMs) {
  if (graceMs === undefined) graceMs = COUNT_GRACE_MS;
  /** @returns {{ count: number } | { error: string } | undefined} */
  const read = () => {
    const c = field(graph.get(qid), "Count");
    if (c === undefined) return undefined;
    const n = typeof c === "bigint" ? Number(c) : c;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? { count: n } : { error: `the query's Count was not a count: ${String(c)}` };
  };
  const first = await waitFor(timeoutMs, () => read() || (graph.get(qid) ? null : undefined));
  if (first === undefined) return { error: "the query object never arrived" };
  if (first) return first;
  const late = await waitFor(graceMs, read);
  return late || { count: 0, inferred: true };
}

/**
 * One album query, counted, paged when `pageAs` names the source it stands
 * for, and disposed.
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {Opts} o
 * @param {bigint[] | null} locations
 * @param {string | null} [pageAs]
 * @returns {Promise<{ albums: number | null, inferred?: string, error?: string, paged?: any }>}
 */
async function countAlbums(g, graph, o, locations, pageAs) {
  /** @type {bigint | null} */
  let q = null;
  try {
    q = await openAlbumQuery(g, o.libraryOid, o.profileId, locations, o.pageSize);
    o.lifetime.queriesOpened++;
    const r = await readCount(graph, q, o.timeoutMs, o.countGraceMs);
    if ("error" in r) return { albums: null, error: r.error };
    if (r.inferred) return { albums: 0, inferred: "the query arrived with no Count: read as 0 (a sparse 0, not seen as a number)" };
    if (!pageAs || r.count === 0) return { albums: r.count };
    if (o.budget.left <= 0) return { albums: r.count, paged: { note: "the probe's page budget was spent on earlier Locations" } };
    // The Count stands whatever the paging does: a page that fails says so on its own.
    /** @type {any} */
    let paged;
    // More than a probe compares (v1.9.17): one page, a sample of what its
    // albums say (ContentSource, cover, fields arriving), never compared.
    const sampleOnly = r.count > o.maxAlbums;
    try { paged = await pageAlbums(g, graph, q, r.count, pageAs, o, sampleOnly); }
    catch (e) { paged = { error: e.message }; }
    return { albums: r.count, paged };
  } catch (e) {
    return { albums: null, error: e.message };
  } finally {
    if (q !== null) {
      if (g.callNoReply(q, SIG.albumDispose, Buffer.alloc(0))) o.lifetime.queriesDisposed++;
      else o.lifetime.unsent++;
    }
  }
}

/**
 * A Location's albums, page by page: the Data of each page's rows, a page
 * whole once every album's Title has arrived (the Core may push an album's
 * fields after its row, or not again at all for one it pushed before — then
 * the wait runs out and the note says how many came). Albums pushed
 * themselves are counted in `via` only: any album the Core pushes while the
 * query is open would otherwise pass for one of its items.
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {bigint} q
 * @param {number} count
 * @param {string} source
 * @param {Opts} o
 * @param {boolean} [sampleOnly]  one page only, whatever the tracks (a Location over maxAlbums)
 */
async function pageAlbums(g, graph, q, count, source, o, sampleOnly) {
  const compare = !sampleOnly && !!(o.trackAlbums && o.trackAlbums[source]);
  /** @type {Set<string>} */
  const pushed = new Set();
  /** @param {string} id */
  const loaded = (id) => field(graph.get(BigInt(id)), "Title") !== undefined;
  const paged = await pageThrough(g, graph, q, count, {
    pageSize: o.pageSize, timeoutMs: o.timeoutMs, lifetime: o.lifetime, retain: SIG.albumRetainPage, release: SIG.albumReleasePage,
    stopWhenShort: true, ready: loaded, maxPages: Math.min(compare ? Infinity : 1, o.budget.left),
    take: (obj) => {
      if (ALBUM_ROW.test(obj.typeName)) { const d = field(obj, "Data"); return isRef(d) ? d.$ref.toString() : null; }
      if (obj.typeName.endsWith(".AlbumLite")) pushed.add(obj.oid.toString());
      return null;
    },
  });
  o.budget.left -= paged.pages;
  const ids = [...paged.seen];
  const albums = ids.map((oid) => graph.get(BigInt(oid)));
  const ready = ids.filter(loaded);
  /** @type {any} */
  const res = {
    albums: ids.length, pages: paged.pages,
    via: { rows: ids.length, albumsPushed: pushed.size },
    contentSource: tally(albums.map((a) => plain(field(a, "ContentSource")))),
    source: tally(albums.map((a) => plain(field(a, "Source")))),
    titles: albums.slice(0, 25).map((a, i) => {
      const t = field(a, "Title"), by = field(a, "PerformedBy");
      return t ? (by ? `${by} — ${t}` : t) : `(album ${ids[i]}, its fields never arrived)`;
    }),
  };
  if (paged.error) res.error = paged.error;
  if (sampleOnly) res.note = `${count} albums: more than the ${o.maxAlbums} a probe compares; ${paged.pages} page read as a sample`;
  else if (!compare) res.note = `sampled ${paged.pages} page(s): this source's tracks were not read whole, so there is nothing to compare its albums with`;
  else if (ids.length !== count) res.note = `${ids.length} of ${count} albums came as rows while the query was open`;
  // What stage 1 would match an album to Rouen's own by (v1.9.17): its cover's
  // image key (the Image's broker:///image/<key>.<ext> Url) and its title and
  // artist. Shown for the first few, and how many carry a key at all.
  const keys = albums.map((a) => imageKeyOf(graph, a));
  // A cover sent by reference whose object never arrived is not "no cover":
  // counted apart, as the key stage 1 would match by is then unknown, not absent.
  const unresolved = albums.filter((a, i) => !keys[i] && isRef(field(a, "Image")) && !graph.get(field(a, "Image").$ref)).length;
  res.imageKeys = { carried: keys.filter(Boolean).length, unresolved, of: ids.length };
  res.sample = albums.slice(0, 8).map((a, i) => ({ title: field(a, "Title") || null, by: field(a, "PerformedBy") || null,
    contentSource: plain(field(a, "ContentSource")), imageKey: keys[i] || null }));
  if (ready.length < ids.length) res.unloaded = `${ids.length - ready.length} of ${ids.length} albums' fields never arrived; their ContentSource is not judged`;
  // For the cross-check and the ContentSource verdict; not reported as such.
  Object.defineProperty(res, "_whole", { enumerable: false, value: compare && !paged.error && ids.length === count });
  Object.defineProperty(res, "_albums", { enumerable: false, value: ids.map((oid, i) => ({ oid, source, contentSource: plain(field(albums[i], "ContentSource")), loaded: loaded(oid) })) });
  return res;
}

/**
 * @typedef {{ libraryOid: bigint, profileId: Buffer, timeoutMs: number, pageSize: number, countGraceMs?: number,
 *             maxAlbums: number, trackAlbums?: Record<string, Set<string>>, budget: { left: number }, lifetime: any }} Opts
 */

/**
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {Opts} o
 */
async function probeLocations(g, graph, o) {
  /** @type {any} */
  const out = { ok: false, control: null, byLocation: [], verdict: null };
  if (g.uncertain()) { out.skipped = "an earlier call timed out"; return out; }
  const locations = graph.ofType("Location");
  if (!locations.length) { out.ok = true; out.verdict = "no Locations: the Core pushed none, so there is nothing to count by"; return out; }

  out.control = await countAlbums(g, graph, o, null);
  /** @type {string} */
  let stop = out.control.albums === null ? "the control query failed" : "";
  for (const l of locations) {
    const d = describeLocation(l);
    const row = { name: d.name, category: d.category, type: d.type };
    if (g.uncertain()) stop = "an earlier call timed out";
    if (stop) { out.byLocation.push(Object.assign(row, { skipped: stop })); continue; }
    const r = await countAlbums(g, graph, o, [l.oid], sourceOfLocation(d));
    out.byLocation.push(Object.assign(row, r));
    if (r.error === "the query object never arrived") stop = "an earlier Location's query object never arrived";
  }
  out.verdict = verdict(out.control, out.byLocation);
  summarisePages(out, o.trackAlbums || {});
  out.ok = !out.control.error && out.byLocation.every((/** @type {any} */ r) => !r.error && !r.skipped && !(r.paged && r.paged.error));
  return out;
}

/**
 * The album pages' two answers (albumsource.js): the albums by Location
 * against the albums by tracks, per source; and each album's ContentSource
 * against its Location's source. A source is compared only when every one of
 * its Locations that holds albums (TIDAL and TIDAL Library are both TIDAL's)
 * was read whole; otherwise it is marked partial, with why.
 * @param {any} out
 * @param {Record<string, Set<string>>} trackAlbums
 */
function summarisePages(out, trackAlbums) {
  /** @type {Record<string, string[]>} */
  const partial = {};
  /** @type {Record<string, Set<string>>} */
  const bySource = {};
  /** @type {Array<{ oid: string, source: string, contentSource: any }>} */
  const judged = [];
  for (const r of out.byLocation) {
    const s = sourceOfLocation(r);
    if (!s) continue;
    if (!bySource[s]) bySource[s] = new Set();
    if (r.paged && r.paged._albums) for (const a of r.paged._albums) if (a.loaded) judged.push(a);
    if (r.skipped || r.error) { (partial[s] = partial[s] || []).push(`${r.name}: not counted`); continue; }
    if (!(typeof r.albums === "number" && r.albums > 0)) continue;
    if (!r.paged || !r.paged._whole) {
      (partial[s] = partial[s] || []).push(`${r.name}: ${r.paged ? (r.paged.error || r.paged.note || "not read whole") : "not paged"}`);
      continue;
    }
    for (const a of r.paged._albums) bySource[s].add(a.oid);
  }
  for (const s of Object.keys(partial)) delete bySource[s];
  /** @type {Record<string, Set<string>>} */
  const tracks = {};
  for (const [s, set] of Object.entries(trackAlbums)) if (!partial[s]) tracks[s] = set;
  out.bySource = crossCheck(bySource, tracks);
  for (const [s, why] of Object.entries(partial)) out.bySource[s] = { partial: why.join("; ") };
  out.pagesVerdict = crossVerdict(out.bySource);
  out.contentSourceVerdict = contentSourceVerdict(judged);
}

/**
 * Whether the Core applied RequireLocations, from the counts. Only counts the
 * Core sent as numbers are evidence; an inferred 0 is not (a late Count reads
 * as one). "filtered" needs two such counts that differ, one of them between
 * 0 and the control: a criterion the Core misread gives none of that — it
 * counts every Location as the whole library (ignored), as nothing (all 0),
 * or as more than the library holds.
 * @param {{ albums: number | null }} control
 * @param {Array<{ albums?: number | null, inferred?: string }>} rows
 */
function verdict(control, rows) {
  const c = control.albums;
  if (c === null) return "unknown: the unfiltered control query failed, so no count can be judged";
  if (c === 0) return "unknown: the control counted no albums, so a filter cannot be told from none";
  const counted = rows.filter((r) => typeof r.albums === "number");
  if (!counted.length) return "unknown: no Location was counted";
  const real = /** @type {number[]} */ (counted.filter((r) => !r.inferred).map((r) => r.albums));
  const inferred = counted.length - real.length;
  const note = inferred ? ` (${inferred} more read as an inferred 0, which is not evidence)` : "";
  if (!real.length) return "unknown: no Count arrived as a number; every 0 was inferred";
  const over = real.find((n) => n > c);
  if (over !== undefined) return `misread: a Location counted ${over}, more than the ${c} albums with no criterion`;
  if (real.every((n) => n === 0)) return `misread: every Location whose Count arrived counted 0${note} — the criterion matched nothing`;
  if (real.length >= 2 && real.every((n) => n === c)) {
    return `ignored: every Location counted ${c}, the same as with no criterion${note} — the Core most likely did not apply RequireLocations as sent`;
  }
  if (new Set(real).size >= 2 && real.some((n) => n > 0 && n < c)) {
    const partly = counted.length < rows.length ? ` (${rows.length - counted.length} Location(s) not counted)` : "";
    return `filtered: the Counts differ by Location and stay within the ${c} with no criterion${note}, so the Core applied RequireLocations${partly}`;
  }
  return `unknown: the Counts that arrived (${real.join(", ")}) do not tell a filter by Location from none${note}`;
}

module.exports = { probeLocations, describeLocation, readCount, verdict, imageKeyOf };
