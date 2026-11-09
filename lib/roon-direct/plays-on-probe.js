// @ts-check
"use strict";
/*
 * plays-on-probe.js — stage 0 of dev/design/plays-on.md, candidate (a): the records in the library that credit an
 * artist, asked of the owner's server the way Roon's own artist page asks. Read only, run by hand, over native mode's
 * connection (or one short connection), on the same session so object ids line up. Nothing is written.
 *
 *   1. Resolve the artist to a performer: a library album that is theirs (its lead, &album= to pick it) gives its
 *      MainPerformer — one Performer object across Roon's graph, the same one its Toto and session records credit. The
 *      resolved performer's name must be the artist asked for, or it is refused (a record they only appear on would
 *      otherwise resolve to its lead).
 *   2. A control: Library::VirtualAlbumQuery with no criterion, whose Count is every album the profile sees.
 *   3. The performer filter, each credit kind the owner chose (decision 2): performing (MainPerformers, Performers),
 *      production, writing (Composers). VirtualAlbumQuery with that Require… = [the performer], sent LengthPrefixed as
 *      RequireLocations is (and declared so in the stock schema, schemas.js — one declaration the control shares, since
 *      a type can be declared only once a connection). Each Count is compared to the control (verdictOf): "filtered"
 *      only on a Count strictly between 0 and the control — a misread or ignored criterion counts the whole library, 0,
 *      or more. A filtered kind's first page is read as a sample, so the owner sees the records and their source.
 *   4. Every query disposed exactly once, every page released once (paging.js), the lifetime and the duration reported.
 *
 * Library-scoped: candidate (b), the performer's catalogue-wide page (Album::GetAlbums), follows once its signature is
 * sourced (dev/design/plays-on.md §3.3, §5.4). This probe proves the mechanism on the owner's Core.
 */
const { BinaryWriter } = require("./wire");
const { field, plain, isRef } = require("./objects");
const { SIG, openAlbumQuery, openAlbumQueryByPerformer } = require("./methods");
const { profileFor } = require("./session");
const { pageThrough } = require("./paging");
const { readCount, imageKeyOf } = require("./locations");
const { performerOf, ask } = require("./reads-probe");
const { noRoom } = require("./find");

const TIMEOUT_MS = 8000, ALBUM_WAIT_MS = 8000, PAGE_SIZE = 100, PAGE_BUDGET = 6, SAMPLE = 20;
/** The credit kinds the owner chose (decision 2): performing, then production, then writing. */
const KINDS = Object.freeze(["mainPerformers", "performers", "production", "composers"]);
/** A page's row for an album: its Data is the album (as locations.js reads them). */
const ALBUM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?AlbumLite>$/;

/** A name compared as this probe matches an artist to a library album: a–z and 0–9 only, lower-cased. @param {string} s */
function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }

/** Whether a resolved performer's name is the artist asked for; a performer with no name can't be checked, so it passes.
 * @param {string | null} name @param {string} artist */
function nameMatches(name, artist) { return !name || normName(name) === normName(artist); }

/**
 * Whether the Core applied the performer filter, from the Count against the unfiltered control. "filtered" only when
 * the Count lies strictly between 0 and the control — the one shape a misread criterion cannot give.
 * @param {number | null} count @param {number | null} control
 */
function verdictOf(count, control) {
  if (control === null) return "unknown: the unfiltered control query failed, so no count can be judged";
  if (control === 0) return "unknown: the control counted no albums";
  if (count === null) return "unknown: the filtered query gave no Count";
  if (count === 0) return "none: no album in the library credits this performer in this kind (or the criterion matched nothing — see the other property type)";
  if (count > control) return `misread: ${count}, more than the ${control} albums with no criterion`;
  if (count === control) return `ignored: the same Count as with no criterion (${control}) — the Core most likely did not apply the performer filter as sent`;
  return `filtered: ${count} album(s) in the library credit this performer in this kind`;
}

/**
 * The artist resolved to a Performer object id, from a library album that is theirs. With a title, that album; else the
 * first whose artist is exactly the name asked. GetAlbum gives the album whole; its MainPerformer is the performer.
 * @param {any} s @param {Map<string, import("./albums").RoonAlbum>} known @param {string} artist @param {string} [albumTitle]
 * @returns {Promise<{ performer?: string, name?: string | null, error?: string, resolvedTo?: string, from?: any, note?: string }>}
 */
async function resolvePerformer(s, known, artist, albumTitle) {
  const { graph } = s;
  const want = normName(artist), wantTitle = albumTitle ? normName(albumTitle) : null;
  /** @type {import("./albums").RoonAlbum | null} */
  let pick = null;
  for (const a of known.values()) {
    if (wantTitle) { if (normName(a.title) === wantTitle) { pick = a; break; } }
    else if (normName(a.artist) === want) { pick = a; break; }
  }
  if (!pick) {
    return { error: albumTitle
      ? "No album of that title is in your server's library on this connection."
      : `No album in your library is led by "${artist}", so this probe (library-scoped, candidate a) can't resolve them to a performer — it resolves an artist from a record of their own. Add &album=<a record they lead> if their name differs from the album's exact artist. An artist with no record of their own in the library is resolved by the catalogue-wide read (candidate b), not yet built.` };
  }
  const oid = BigInt(pick.oid);
  const from = { title: pick.title, artist: pick.artist };
  const got = await ask(s, s.root.library.oid, SIG.getAlbum, () => new BinaryWriter().long(oid).toBuffer(), { what: `the album, object ${oid}`, waitMs: ALBUM_WAIT_MS });
  if (got.refused) return { error: `GetAlbum refused: ${got.refused}`, from };
  const answeredOid = got.answer && got.answer.oid && got.answer.object && got.answer.object !== "named, never pushed" ? BigInt(got.answer.oid) : null;
  const answered = answeredOid ? graph.get(answeredOid) : null;
  const lite = graph.get(oid);
  const album = answered && answered.loaded ? answered : lite && lite.loaded ? lite : null;
  if (!album) return { error: "GetAlbum gave no album object to resolve a performer from.", from };
  const perf = performerOf(graph, album);
  if (perf === null) return { error: "the album came without a main performer the graph holds.", from };
  const po = graph.get(perf);
  const name = (po && field(po, "Name")) || null;
  // The resolved performer must be the artist asked for. On the &album= path the album is picked by title, so its lead
  // could be anyone's (a record they only appear on resolves to its lead); even on the name path a compilation's lead
  // can differ. A mismatch would report another artist's records as this one's, so refuse it. A performer with no name
  // can't be checked — proceed, and say so.
  if (!nameMatches(name, artist)) {
    return { error: `That record resolved to the performer "${name}", not "${artist}" — its lead is not the artist asked for. Pass &album=<one of ${artist}'s own records>, or drop &album= so an album led by "${artist}" is used.`, resolvedTo: name, from };
  }
  return { performer: String(perf), name, from, ...(name ? {} : { note: "the performer carried no name to verify against the artist asked for" }) };
}

/**
 * @typedef {{ libraryOid: bigint, profileId: Buffer, timeoutMs: number, pageSize: number, countGraceMs?: number,
 *             budget: { left: number }, lifetime: any }} Opts
 */

/**
 * One performer-filtered album query: opened, counted, a sample page read when it looks filtered, disposed exactly once.
 * @param {any} s @param {Opts} o @param {"mainPerformers"|"performers"|"production"|"composers"} kind
 * @param {bigint[]} performerIds @param {number | null} control
 */
async function askKind(s, o, kind, performerIds, control) {
  const { g, graph } = s;
  /** @type {bigint | null} */
  let q = null;
  try {
    q = await openAlbumQueryByPerformer(g, o.libraryOid, o.profileId, kind, performerIds, o.pageSize);
    o.lifetime.queriesOpened++;
    const r = await readCount(graph, q, o.timeoutMs, o.countGraceMs);
    if ("error" in r) return { kind, count: null, error: r.error };
    const count = r.inferred ? 0 : r.count;
    // An inferred 0 (the query came with no Count member) is not evidence of "no appearances": a slow Count also reads as
    // 0 (locations.js treats it the same). Say unknown, not none.
    const verdict = r.inferred ? "unknown: the query arrived with no Count member (an inferred 0 — a slow Count reads as 0, so not taken as evidence)" : verdictOf(count, control);
    /** @type {any} */
    const out = { kind, count, verdict };
    if (verdict.startsWith("filtered") && o.budget.left > 0) out.sample = await pageSample(g, graph, q, Math.min(count, o.pageSize), o);
    return out;
  } catch (e) {
    return { kind, count: null, error: String(e && /** @type {any} */ (e).message) };
  } finally {
    if (q !== null) { if (g.callNoReply(q, SIG.albumDispose, Buffer.alloc(0))) o.lifetime.queriesDisposed++; else o.lifetime.unsent++; }
  }
}

/**
 * One page of a filtered query, as a sample: each row's album (its Data), read once its Title has arrived, released.
 * @param {ReturnType<typeof import("./methods").guarded>} g @param {import("./objects").ObjectGraph} graph
 * @param {bigint} q @param {number} want @param {Opts} o
 */
async function pageSample(g, graph, q, want, o) {
  /** @param {string} id */
  const loaded = (id) => field(graph.get(BigInt(id)), "Title") !== undefined;
  const paged = await pageThrough(g, graph, q, want, {
    pageSize: o.pageSize, timeoutMs: o.timeoutMs, lifetime: o.lifetime, retain: SIG.albumRetainPage, release: SIG.albumReleasePage,
    stopWhenShort: true, ready: loaded, maxPages: Math.min(1, o.budget.left),
    take: (obj) => { if (ALBUM_ROW.test(obj.typeName)) { const d = field(obj, "Data"); return isRef(d) ? d.$ref.toString() : null; } return null; },
  });
  o.budget.left -= paged.pages;
  const ids = [...paged.seen];
  return {
    rows: ids.length, pages: paged.pages,
    albums: ids.slice(0, SAMPLE).map((oid) => {
      const a = graph.get(BigInt(oid));
      return { title: field(a, "Title") || null, by: field(a, "PerformedBy") || null, contentSource: plain(field(a, "ContentSource")), imageKey: imageKeyOf(graph, a) };
    }),
    ...(paged.error ? { error: paged.error } : {}),
  };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, profile: () => string | null, log?: (line: string) => void }} deps
 */
function createPlaysOnProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;
  return {
    /**
     * The records in the library that credit the artist. artist: the name (required); album: one of their own records,
     * to resolve the performer from when their name isn't a library album's exact artist; maxPages: the sample-page budget.
     * @param {{ artist?: string, album?: string, maxPages?: number, countGraceMs?: number }} [o]
     * @returns {Promise<any>}
     */
    async run(o = {}) {
      const why = deps.off();
      if (why) return { error: why, status: 503 };
      if (!o.artist) return { error: "An artist, please (?artist=…).", status: 400 };
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
          /** @type {Opts} */
          const oo = { libraryOid: root.library.oid, profileId, timeoutMs: TIMEOUT_MS, pageSize: PAGE_SIZE, countGraceMs: o.countGraceMs, budget: { left: o.maxPages ?? PAGE_BUDGET }, lifetime };
          /** @type {Record<string, any>} */
          const out = { readOnly: true, design: "dev/design/plays-on.md §4", artist: o.artist, scope: "the library (candidate a); the catalogue-wide (b) follows" };

          // 1. Resolve the performer.
          const resolved = await resolvePerformer(s, known, o.artist, o.album);
          out.performer = resolved;
          if (!resolved.performer) { out.lifetime = lifetime; out.ms = Date.now() - t0; return out; }
          const pid = [BigInt(resolved.performer)];

          // 2. The unfiltered control.
          /** @type {number | null} */
          let control = null;
          /** @type {bigint | null} */
          let cq = null;
          try {
            cq = await openAlbumQuery(s.g, oo.libraryOid, oo.profileId, null, oo.pageSize);
            lifetime.queriesOpened++;
            const r = await readCount(graph, cq, oo.timeoutMs, oo.countGraceMs);
            control = "error" in r ? null : (r.inferred ? 0 : r.count);
            out.control = "error" in r ? { error: r.error } : { albums: control };
          } finally {
            if (cq !== null) { if (s.g.callNoReply(cq, SIG.albumDispose, Buffer.alloc(0))) lifetime.queriesDisposed++; else lifetime.unsent++; }
          }

          // 3. The performer filter, each credit kind the owner chose, against the control. The list is declared and sent
          // LengthPrefixed (schemas.js, as RequireLocations is); whether the Core applied it is the verdict's to say.
          out.byKind = [];
          for (const kind of KINDS) {
            out.byKind.push(s.g.uncertain() ? { kind, skipped: "an earlier call went unanswered" } : await askKind(s, oo, /** @type {any} */ (kind), pid, control));
          }

          out.lifetime = lifetime;
          out.ms = Date.now() - t0;
          out.connection = { stillOpen: !!deps.link && deps.link.session() === s, uncertain: s.g.uncertain() || null, objects: graph.objects.size };
          log("plays-on probe: run");
          return out;
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createPlaysOnProbe, resolvePerformer, askKind, pageSample, verdictOf, normName, nameMatches };
