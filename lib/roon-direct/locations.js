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
 * without paging every track. No reverse-engineered client (the upstream,
 * Rouen) has sent RequireLocations before (its list encoding is this design's reading, methods.js refList), so
 * the probe proves it rather than assumes it:
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
 * Only Counts are read: no page is retained. Every query opened is disposed
 * exactly once (VirtualAlbumLiteQuery::Dispose, sent without waiting). A
 * timeout stops the run as it does for the track queries (§3).
 */
const { field, plain, waitFor } = require("./objects");
const { SIG, openAlbumQuery } = require("./methods");

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
 * One album query, counted and disposed.
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {{ libraryOid: bigint, profileId: Buffer, timeoutMs: number, pageSize: number, countGraceMs?: number, lifetime: any }} o
 * @param {bigint[] | null} locations
 * @returns {Promise<{ albums: number | null, inferred?: string, error?: string }>}
 */
async function countAlbums(g, graph, o, locations) {
  /** @type {bigint | null} */
  let q = null;
  try {
    q = await openAlbumQuery(g, o.libraryOid, o.profileId, locations, o.pageSize);
    o.lifetime.queriesOpened++;
    const r = await readCount(graph, q, o.timeoutMs, o.countGraceMs);
    if ("error" in r) return { albums: null, error: r.error };
    return r.inferred ? { albums: 0, inferred: "the query arrived with no Count: read as 0 (a sparse 0, not seen as a number)" } : { albums: r.count };
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
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {{ libraryOid: bigint, profileId: Buffer, timeoutMs: number, pageSize: number, countGraceMs?: number, lifetime: any }} o
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
    const r = await countAlbums(g, graph, o, [l.oid]);
    out.byLocation.push(Object.assign(row, r));
    if (r.error === "the query object never arrived") stop = "an earlier Location's query object never arrived";
  }
  out.verdict = verdict(out.control, out.byLocation);
  out.ok = !out.control.error && out.byLocation.every((/** @type {any} */ r) => !r.error && !r.skipped);
  return out;
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

module.exports = { probeLocations, describeLocation, readCount, verdict };
