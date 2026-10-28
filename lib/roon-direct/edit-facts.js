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
 * the answer names, and only one of its batch: never by position.
 *
 * Kept as it goes (v1.9.68-t3: on the owner's library of thirteen thousand albums Roon's layer held nothing — a
 * walk is some nine minutes of calls, and one kept only whole lost all of it to anything in them, then waited for
 * the next library read). Every KEEP_EVERY calls, and when a walk is cut short, what it has read since is kept
 * (lib/roon-releases.js, whole: false — written over Roon's own, nothing dropped). A walk cut short — the
 * connection gone, native mode off, three refusals, an answer that couldn't be read — says why, and goes on where it
 * stopped after RETRY_MS on its own timer (a new connection starts it from the first album). While the connection is
 * being checked it waits, up to WAIT_MAX pauses, rather than ending. Only a pass that reached the last album replaces
 * Roon's layer whole (whole: true), so what Roon no longer says goes then.
 */
const { isRef, memberOf } = require("./objects");
const { SIG } = require("./methods");
const { editInfoArgs, readAnswer, layers } = require("./edit-info");
const { catalogueNumber, normTypes } = require("../release-facts");

const BATCH = 40, PAUSE_MS = 1500, EVERY_MS = 12 * 60 * 60 * 1000, RETRY_MS = 10 * 60 * 1000, MAX_REFUSALS = 3;
const KEEP_EVERY = 10, WAIT_MAX = 40;
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
 * One answer's items, each by the album the answer itself names, and only one of the batch asked: never by position
 * (the review: a short or reordered answer must not give one album its neighbour's facts). One it can't name is left.
 * @param {any} graph @param {Buffer} payload @param {Set<string>} asked  the batch's album oids
 * @returns {{ items: Array<{ oid: string, facts: { catno: string | null, types: string[], labels: string[] } }>, unpaired: number } | { undecoded: string }}
 */
function itemsOf(graph, payload, asked) {
  const got = readAnswer(graph, payload);
  if ("undecoded" in got) return { undecoded: got.why };
  const items = [];
  let unpaired = 0;
  for (const it of got.items) {
    const ref = memberOf(it, "Album");
    if (!isRef(ref) || !asked.has(String(ref.$ref)) || "$inline" in it) { unpaired++; continue; }
    items.push({ oid: String(ref.$ref), facts: factsOf(graph, it) });
  }
  return { items, unpaired };
}

/**
 * @typedef {{ title: string, artist: string, catno: string | null, types: string[], labels: string[] }} RoonRelease
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null,
 *           keep: ((records: RoonRelease[], whole: boolean) => any) | null, log?: (line: string) => void, now?: () => number,
 *           batch?: number, pauseMs?: number, everyMs?: number, retryMs?: number, sleep?: (ms: number) => Promise<void>,
 *           timer?: (fn: () => void, ms: number) => any, clearTimer?: (t: any) => void, itemsOf?: typeof itemsOf,
 *           keepEvery?: number, waitMax?: number }} deps
 *   keep: what index.js does with a walk's records — a part merged into the cache's "roon" layer (whole: false), the
 *   whole pass replacing it (whole: true); labels filled either way. timer: the retry's own clock (setTimeout).
 */
function createEditFacts(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const batch = deps.batch || BATCH, pauseMs = deps.pauseMs === undefined ? PAUSE_MS : deps.pauseMs, everyMs = deps.everyMs || EVERY_MS;
  const sleep = deps.sleep || ((/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); }));
  const retryMs = deps.retryMs || RETRY_MS;
  const decode = deps.itemsOf || itemsOf, keepEvery = deps.keepEvery || KEEP_EVERY, waitMax = deps.waitMax || WAIT_MAX;
  const timer = deps.timer || ((/** @type {() => void} */ fn, /** @type {number} */ ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; });
  const clearTimer = deps.clearTimer || ((/** @type {any} */ t) => clearTimeout(t));
  /** @type {any} */ let walkedOn = null;
  /** A read that came while a walk ran (a new connection's): walked once this one ends. @type {any} */
  let pending = null;
  let running = false, lastWholeAt = 0, notBefore = 0, stopped = false;
  /** @type {any} */ let retryTimer = null;
  /** The pass under way: its connection, its albums as they were when it began, how far it has come, and every
   * record it has read (the whole pass is kept from these at its end).
   * @type {{ session: any, albums: any[], at: number, records: RoonRelease[] } | null} */
  let pass = null;
  /** @type {{ at: number, albums: number, read: number, unpaired: number, calls: number, whole: boolean, why: string | null, kept: any, from: number, to: number } | null} */
  let last = null;

  /** @param {any} session */
  async function walk(session) {
    const known = deps.known(session);
    if (!known) return;
    // A pass on this connection that was cut short goes on where it stopped, over the albums it began with.
    if (!pass || pass.session !== session) pass = { session, albums: [...known.values()], at: 0, records: [] };
    const p = pass, albums = p.albums, from = p.at;
    /** What is read since the last keep. @type {RoonRelease[]} */
    let part = [];
    let calls = 0, refusals = 0, unpaired = 0, sinceKeep = 0, waits = 0;
    /** @type {string | null} */
    let why = null;
    /** @type {any} */ let kept = null;
    const started = now();
    const keepPart = () => {
      if (!part.length || !deps.keep) return null;
      const got = part;
      part = [];
      return deps.keep(got, false);
    };
    // A batch refused is asked again (a refusal may be the moment's), up to MAX_REFUSALS in all; then the walk ends.
    while (p.at < albums.length && !why) {
      const slice = albums.slice(p.at, p.at + batch);
      if (stopped || !deps.on()) { why = "native mode turned off"; break; }
      if (!deps.link || deps.link.session() !== session) { why = "the connection changed"; break; }
      let ok = false, checking = false;
      await deps.inTurn(async () => {
        const s = deps.link ? deps.link.session() : null;
        if (!s || s !== session) { why = "the connection changed"; return; }
        if (s.g.uncertain()) { checking = true; return; }
        calls++;
        const r = await s.g.call(s.root.library.oid, SIG.albumEditInfo, editInfoArgs(s.g, slice.map((a) => BigInt(a.oid)), []));
        if (!r.success) {
          refusals++;
          if (refusals >= MAX_REFUSALS) why = `refused ${refusals} times (${String(r.status)})`;
          return;
        }
        ok = true;
        const got = decode(s.graph, r.payload, new Set(slice.map((a) => String(a.oid))));
        if ("undecoded" in got) { why = "an answer that couldn't be read: " + got.undecoded; return; }
        unpaired += got.unpaired;
        for (const { oid, facts } of got.items) {
          const a = known.get(oid);
          if (!a) { unpaired++; continue; }
          const rec = Object.assign({ title: a.title, artist: a.artist }, facts);
          part.push(rec);
          p.records.push(rec);
        }
      });
      // The connection being checked: the same batch again once it is through, rather than the walk ended.
      if (checking) {
        if (++waits > waitMax) why = "the connection is being checked";
        else await sleep(pauseMs);
        continue;
      }
      waits = 0;
      if (ok && !why) {
        p.at += batch;
        if (++sinceKeep >= keepEvery) { sinceKeep = 0; kept = keepPart() || kept; }
      }
      if (!why && p.at < albums.length) await sleep(pauseMs);
    }
    if (!why && !p.records.length) why = albums.length ? "nothing came back" : "no albums to ask about";
    try {
      if (!why) { part = []; kept = deps.keep ? deps.keep(p.records, true) : null; }
      else kept = keepPart() || kept;
    } catch (e) { why = (why ? why + "; " : "") + "keeping them failed: " + String(e && /** @type {any} */ (e).message); }
    const whole = !why;
    if (whole) { lastWholeAt = now(); pass = null; }
    else if (!stopped && deps.on()) {
      // cut short: again on its own timer — where it stopped on this connection, from the start on a new one
      notBefore = now() + retryMs;
      if (retryTimer) clearTimer(retryTimer);
      // the timer is the time it waits for: notBefore is cleared, not compared (a clock a moment behind would refuse it)
      retryTimer = timer(() => { retryTimer = null; notBefore = 0; const s = deps.link ? deps.link.session() : null; if (s) start(s); }, retryMs);
    }
    last = { at: now(), albums: albums.length, read: p.records.length, unpaired, calls, whole, why, kept, from, to: Math.min(p.at, albums.length) };
    log(`edit facts: albums ${from + 1}–${last.to} of ${albums.length} read in ${calls} call(s), ${Math.round((now() - started) / 1000)} s` +
      (unpaired ? `, ${unpaired} unpaired` : "") + (whole ? ", the whole library kept" : `, kept so far; ${why}`));
  }

  /**
   * After a library read on `session`, or the retry's timer: a walk, in the background, unless one ran whole on this
   * connection within EVERY_MS. @param {any} session @returns {boolean} whether one started
   */
  function start(session) {
    if (!deps.keep || !session || !deps.on()) return false;   // no keeper (a test's stage1): no walk
    if (running) { if (walkedOn !== session) pending = session; return false; }   // a new connection's read: after this walk
    if (walkedOn === session && !pass && now() - lastWholeAt < everyMs) return false;
    if (now() < notBefore) return false;
    running = true; stopped = false; walkedOn = session;
    walk(session)
      .catch((e) => {
        notBefore = now() + retryMs;
        last = { at: now(), albums: 0, read: 0, unpaired: 0, calls: 0, whole: false, why: "the walk failed: " + String(e && e.message), kept: null, from: 0, to: 0 };
        log("edit facts: " + last.why);
      })
      .finally(() => { running = false; if (pending) { const q = pending; pending = null; start(q); } });
    return true;
  }

  return {
    start,
    /** Native mode off: a walk under way ends at its next call, keeping what it has read; no retry. */
    stop() { stopped = true; if (retryTimer) { clearTimer(retryTimer); retryTimer = null; } },
    /** pass: a pass cut short that will go on (how far it has come, of how many). */
    status: () => ({ running, last, pass: pass ? { at: pass.at, albums: pass.albums.length } : null }),
  };
}

module.exports = { createEditFacts, kindsFromRoon, factsOf, itemsOf, BATCH, PAUSE_MS, EVERY_MS, RETRY_MS, KEEP_EVERY, WAIT_MAX };
