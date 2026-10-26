// @ts-check
"use strict";
/*
 * edit-facts.js — t4 (dev/design/catalogue.md §4, v1.9.67-t4): what Roon itself holds of every library album's
 * catalogue number, kinds and labels, read over native mode's connection after each library read, and kept beside
 * the tags' and Discogs' (lib/release-facts.js, ranked between them, fact by fact). Nothing is written to Roon.
 *
 * The t3 probe (the owner's run, 2026-10-26) proved the call and its answer: Library::GetMultiAlbumEditInfo with
 * the albums as the connection's own objects and no languages, answered by value with a LengthPrefixed collection
 * of inline AlbumEditInfo structs. Each gives a Type (AlbumType) and, beside it, IsLive, IsBootleg and IsCompilation
 * flags; Rouen reads them as several kinds at once (the owner's decision on the run: Main + Live is album and live).
 * Its CatalogNumber (sparse: none on the ten the probe read), and its Labels (the file's own where it has one, else
 * the metadata service's), which fill the gaps Rouen's label scan left.
 *
 * The walk: the albums the connection was sent (`known`), BATCH a call, PAUSE_MS between calls, each in turn with
 * the connection's other traffic; one walk per connection, and again after EVERY_MS. Each item is taken by the album
 * the answer names, and only one of its batch: never by position. A whole walk replaces what Roon said before
 * (lib/roon-releases.js, as the file walk does); one cut short — the connection gone, native mode off, three
 * refusals, an answer that couldn't be read — changes nothing, says why, and is tried again after RETRY_MS at the
 * next library read.
 */
const { isRef } = require("./objects");
const { SIG } = require("./methods");
const { editInfoArgs, readAnswer, layers, memberOf } = require("./edit-info");
const { catalogueNumber, normTypes } = require("../release-facts");

const BATCH = 40, PAUSE_MS = 1500, EVERY_MS = 12 * 60 * 60 * 1000, RETRY_MS = 10 * 60 * 1000, MAX_REFUSALS = 3;
/** Roon's AlbumType → Rouen's kind; Unknown (5) says nothing. */
const TYPE_KIND = Object.freeze({ 0: "album", 1: "single", 2: "live", 3: "compilation", 4: "other", 6: "ep", 7: "soundtrack" });

/**
 * An album's kinds from Roon's Type and flags: Main + Live is album and live; a Bootleg has no kind of Rouen's own
 * and shows by its Type; Unknown alone is nothing.
 * @param {number | null | undefined} type @param {{ live?: boolean | null, compilation?: boolean | null }} flags
 * @returns {string[]}  in TYPES' order
 */
function kindsFromRoon(type, flags) {
  const out = [];
  const t = typeof type === "number" ? (/** @type {any} */ (TYPE_KIND))[type] : null;
  if (t) out.push(t);
  if (flags && flags.live === true) out.push("live");
  if (flags && flags.compilation === true) out.push("compilation");
  return normTypes(out);
}

/**
 * One AlbumEditInfo as Rouen keeps it: the value Roon shows of each fact.
 * @param {any} graph @param {any} it  the inline struct
 * @returns {{ catno: string | null, types: string[], labels: string[] }}
 */
function factsOf(graph, it) {
  const value = (/** @type {string} */ name) => { const l = layers(graph, memberOf(it, name)); return l && !("as" in l) ? l.value : undefined; };
  const labels = value("Labels"), catno = value("CatalogNumber");
  return {
    // A number that is no string (a server declaring the member otherwise) is not read as "[object Object]" (the review).
    catno: typeof catno === "string" ? catalogueNumber({ catalognumber: catno }) : null,
    types: kindsFromRoon(value("Type"), { live: value("IsLive"), compilation: value("IsCompilation") }),
    labels: Array.isArray(labels) ? labels.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [],
  };
}

/**
 * @typedef {{ title: string, artist: string, catno: string | null, types: string[], labels: string[] }} RoonRelease
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null,
 *           keep: ((records: RoonRelease[], whole: boolean) => any) | null, log?: (line: string) => void, now?: () => number,
 *           batch?: number, pauseMs?: number, everyMs?: number, sleep?: (ms: number) => Promise<void> }} deps
 *   keep: what index.js does with a walk's records (the cache's "roon" layer replaced when whole; labels filled)
 */
function createEditFacts(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const batch = deps.batch || BATCH, pauseMs = deps.pauseMs === undefined ? PAUSE_MS : deps.pauseMs, everyMs = deps.everyMs || EVERY_MS;
  const sleep = deps.sleep || ((/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); }));
  /** @type {any} */ let walkedOn = null;
  /** A read that came while a walk ran (a new connection's): walked once this one ends. @type {any} */
  let pending = null;
  let running = false, lastWholeAt = 0, notBefore = 0, stopped = false;
  /** @type {{ at: number, albums: number, read: number, unpaired: number, calls: number, whole: boolean, why: string | null, kept: any } | null} */
  let last = null;

  /** @param {any} session */
  async function walk(session) {
    const known = deps.known(session);
    if (!known) return;
    const albums = [...known.values()];
    /** @type {RoonRelease[]} */
    const records = [];
    let calls = 0, refusals = 0, unpaired = 0;
    /** @type {string | null} */
    let why = null;
    const started = now();
    // A batch refused is asked again (a refusal may be the moment's), up to MAX_REFUSALS in all; then the walk ends.
    for (let i = 0; i < albums.length && !why;) {
      const slice = albums.slice(i, i + batch);
      if (stopped || !deps.on()) { why = "native mode turned off"; break; }
      if (!deps.link || deps.link.session() !== session) { why = "the connection changed"; break; }
      let ok = false;
      await deps.inTurn(async () => {
        const s = deps.link ? deps.link.session() : null;
        if (!s || s !== session) { why = "the connection changed"; return; }
        if (s.g.uncertain()) { why = "the connection is being checked"; return; }
        calls++;
        const r = await s.g.call(s.root.library.oid, SIG.albumEditInfo, editInfoArgs(s.g, slice.map((a) => BigInt(a.oid)), []));
        if (!r.success) {
          refusals++;
          if (refusals >= MAX_REFUSALS) why = `refused ${refusals} times (${String(r.status)})`;
          return;
        }
        ok = true;
        const got = readAnswer(s.graph, r.payload);
        if ("undecoded" in got) { why = "an answer that couldn't be read: " + got.why; return; }
        // Each item by the album the answer itself names, and only one of this batch: never by position (the review:
        // a short or reordered answer must not give one album its neighbour's facts). One it can't name is left.
        const asked = new Set(slice.map((a) => String(a.oid)));
        for (const it of got.items) {
          const ref = memberOf(it, "Album");
          const a = isRef(ref) && asked.has(String(ref.$ref)) ? known.get(String(ref.$ref)) : null;
          if (!a || "$inline" in it) { unpaired++; continue; }
          records.push(Object.assign({ title: a.title, artist: a.artist }, factsOf(s.graph, it)));
        }
      });
      if (ok) i += batch;
      if (!why && i < albums.length) await sleep(pauseMs);
    }
    if (!why && !records.length) why = albums.length ? "nothing came back" : "no albums to ask about";
    const whole = !why;
    let kept = null;
    try { kept = deps.keep ? deps.keep(records, whole) : null; }
    catch (e) { why = (why ? why + "; " : "") + "keeping them failed: " + String(e && /** @type {any} */ (e).message); }
    if (whole && !why) lastWholeAt = now(); else notBefore = now() + RETRY_MS;   // a walk cut short is tried again, not in twelve hours
    last = { at: now(), albums: albums.length, read: records.length, unpaired, calls, whole, why, kept };
    log(`edit facts: ${records.length} of ${albums.length} albums read in ${calls} call(s), ${Math.round((now() - started) / 1000)} s` +
      (unpaired ? `, ${unpaired} unpaired` : "") + (whole && !why ? ", kept" : ", not kept: " + why));
  }

  return {
    /**
     * After a library read on `session`: a walk, in the background, unless one ran on this connection within
     * EVERY_MS. @param {any} session @returns {boolean} whether one started
     */
    start(session) {
      if (!deps.keep || !session || !deps.on()) return false;   // no keeper (a test's stage1): no walk
      if (running) { if (walkedOn !== session) pending = session; return false; }   // a new connection's read: after this walk
      if (walkedOn === session && now() - lastWholeAt < everyMs) return false;
      if (now() < notBefore) return false;
      running = true; stopped = false; walkedOn = session;
      walk(session)
        .catch((e) => { notBefore = now() + RETRY_MS; last = { at: now(), albums: 0, read: 0, unpaired: 0, calls: 0, whole: false, why: "the walk failed: " + String(e && e.message), kept: null }; log("edit facts: " + last.why); })
        .finally(() => { running = false; if (pending) { const p = pending; pending = null; this.start(p); } });
      return true;
    },
    /** Native mode off: a walk under way ends at its next call, keeping nothing. */
    stop() { stopped = true; },
    status: () => ({ running, last }),
  };
}

module.exports = { createEditFacts, kindsFromRoon, factsOf, BATCH, PAUSE_MS, EVERY_MS, RETRY_MS };
