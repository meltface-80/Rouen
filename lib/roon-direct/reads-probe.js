// @ts-check
"use strict";
/*
 * reads-probe.js — N7-0 (dev/design/native-remote.md §16.4, v1.9.70-t3; t4 §16.5): the reads full native mode rests
 * on, each sent once over native mode's connection, by hand, and every answer given whole, so the builds after it are
 * written against what the owner's server sends rather than the catalogue's names alone. Read only: nothing is written.
 * In the order run (t4):
 *
 *   Library::GetAlbum(AlbumBase) for the album              Library::GetAlbumTrackLites(AlbumBase) for it
 *   Library::GetPerformer(PerformerBase) for its main performer, and the album's Image as the graph holds it (no call)
 *   Library::GetToplevelGenres(GetGenreParameters)          Library::GetAllTagLites(Profile)
 *   the zone's NowPlaying and Queue, as the graph holds them (no call), and the rest of the zone whole (v2.0.3-t12: where
 *   its signal path is held, for Now playing's, dev/design/native-remote.md §16.4)
 *   the zone's signal path, each of its steps given whole from the step itself (no call; v2.0.3-t14: the whole zone
 *   stops at the step, so what each step is made of — format, rates, DSP, device — was said by its type alone)
 *   Queue::GetItems on that queue — only when asked for (the whole queue, history and all, can be thousands)
 *   the album's other versions as the Album holds them (no call; v2.0.3-t13): each AlternateAlbumVersion in full, and
 *   every object one names whole, for the album view's Versions (dev/design/native-remote.md §16.4)
 *
 * The connection's state is said before the reads and after each step, and why it closed, if it did.
 *
 * Each step on its own: one refused, or unanswered, leaves the others (once the connection is uncertain nothing more is
 * sent). An answer is read by the graph's own reader (settings-probe.js's `answer`), an object it names waited for and
 * given whole (`whole`); a list answered, each item the same; an answer that can't be read, its first bytes.
 */
const { BinaryWriter } = require("./wire");
const { SIG, inlineStruct } = require("./methods");
const { GET_GENRE_PARAMETERS } = require("./schemas");
const { field, isRef, waitFor, shortType, fullNameOf } = require("./objects");
const { answer, whole } = require("./settings-probe");
const { zoneFor } = require("./smart");
const { profileObjectFor } = require("./session");
const { noRoom } = require("./find");
const { readList } = require("./focus");
const { listOf } = require("./answer-list");
const { deep } = require("./deep-value");

const WAIT_MS = 2500, ALBUM_WAIT_MS = 8000, MAX_ITEMS = 20, HEX_MAX = 256, MAX_NAMED = 24;

/** An object the graph holds, whole, by its reference. @param {any} graph @param {any} v */
const wholeOf = (graph, v) => whole(graph, v, new Set());

/**
 * An answer that is a list (IList<T>): LengthPrefixed (its length, then its count and items) or bare (its count and
 * items), each item a value or an object by reference, waited for and given whole; null when it isn't a list.
 * @param {any} graph @param {Buffer} payload @param {number} waitMs @param {Set<string>} fresh
 */
async function listAnswer(graph, payload, waitMs, fresh) {
  const read = listOf(graph, payload);
  if (!read) return null;
  const got = read.items, form = read.form;
  const refs = got.filter(isRef);
  // Each object named waited for as pushed with the answer, not as the graph held it before.
  await waitFor(waitMs, () => (refs.every((x) => { const o = graph.get(x.$ref); return o && o.loaded && fresh.has(String(x.$ref)); }) ? true : undefined));
  // Items the graph held but the server didn't push again with the answer: said, as they are read from what was held.
  const notPushed = refs.filter((x) => !fresh.has(String(x.$ref))).length;
  return Object.assign({ form, count: got.length, more: Math.max(0, got.length - MAX_ITEMS), items: got.slice(0, MAX_ITEMS).map((x) => wholeOf(graph, x)) },
    notPushed ? { notPushedWithAnswer: notPushed } : {},
    // A null answer (one zero byte) reads as an empty bare list: the two can't be told apart (the review).
    got.length === 0 && form === "bare list" ? { note: "An empty list, or no list at all: the two are the same byte." } : {});
}

/**
 * One call, its answer read: a list, else one value or object (given whole). Objects pushed since the call are the
 * answer's (`fresh`); the call's time, the object called and what was sent said. The arguments are built only once
 * the connection is known to be certain: building a struct's declares its type, a frame of its own (the review).
 * @param {any} s  the session @param {bigint} oid  the object called @param {string} sig
 * @param {() => Buffer} args  builds the arguments @param {{ list?: boolean, waitMs?: number, what?: string }} [o]  what: the argument, said
 */
async function ask(s, oid, sig, args, o = {}) {
  const waitMs = o.waitMs ?? WAIT_MS;
  const short = sig.replace(/Sooloos\.Broker\.Api\./g, "").replace(/\(.*$/, "");
  if (s.g.uncertain()) return { method: short, skipped: "An earlier call went unanswered; nothing more was sent." };
  const sent = { to: String(oid), with: o.what || "nothing" };
  /** @type {Set<string>} */
  const fresh = new Set();
  const seen = (/** @type {any} */ x) => { fresh.add(String(x.oid)); };
  s.graph.watchers.add(seen);
  const t0 = Date.now();
  try {
    const res = await s.g.call(oid, sig, args());
    if (!res.success) return { method: short, sent, refused: String(res.status), ms: Date.now() - t0 };
    const list = o.list ? await listAnswer(s.graph, res.payload, waitMs, fresh) : null;
    if (list) return { method: short, sent, ms: Date.now() - t0, answer: list };
    const a = await answer(s.graph, res.payload, waitMs, fresh);
    // An object named: given whole, as deep as `whole` goes (answer() says its own members only), and whether it came
    // with the answer or was only held from before.
    const deep = a && a.oid && a.object && a.object !== "named, never pushed"
      ? Object.assign(wholeOf(s.graph, { $ref: BigInt(a.oid) }), a.pushedWithAnswer === false ? { pushedWithAnswer: false } : {}) : a;
    return { method: short, sent, ms: Date.now() - t0, answer: deep, bytes: res.payload.length,
      ...(a && a.undecoded ? { hex: res.payload.subarray(0, HEX_MAX).toString("hex") } : {}) };
  } catch (e) {
    return { method: short, sent, error: String(e && /** @type {any} */ (e).message), ms: Date.now() - t0 };
  } finally {
    s.graph.watchers.delete(seen);
  }
}

/**
 * The first object a value names whose type is one of `types`: itself, a list's items, an inline struct's members,
 * a list object's $items; depth-bounded. @param {any} graph @param {any} v @param {RegExp} types @param {number} [depth]
 * @returns {bigint | null}
 */
function firstOf(graph, v, types, depth = 0) {
  if (!v || typeof v !== "object" || Buffer.isBuffer(v) || depth > 3) return null;
  if (isRef(v)) {
    const o = graph.get(v.$ref);
    if (!o) return null;
    if (types.test(shortType(o.typeName))) return BigInt(v.$ref);
    return Array.isArray(o.fields.$items) ? firstOf(graph, o.fields.$items, types, depth + 1) : null;
  }
  for (const x of Array.isArray(v) ? v : Object.values(v)) { const f = firstOf(graph, x, types, depth + 1); if (f !== null) return f; }
  return null;
}

/**
 * An album's main performer: the first PerformerLite (or Performer) its MainPerformers (else Performers) names — a list
 * member comes as its bytes (LengthPrefixed), read by focus.js's readList, the way every list member is read.
 * @param {any} graph @param {any} album  the Album or AlbumLite object @returns {bigint | null}
 */
function performerOf(graph, album) {
  for (const name of ["MainPerformers", "Performers"]) {
    const v = field(album, name);
    if (v === undefined) continue;
    const items = Buffer.isBuffer(v) ? ((readList(graph, fullNameOf(album.fields, name), v) || { items: [] }).items) : v;
    const got = firstOf(graph, items, /^Performer(Lite)?$/);
    if (got !== null) return got;
  }
  return null;
}

/**
 * A zone's signal path (v2.0.3-t14, §16.7): the SignalPath's own values (Quality, ProcessingSpeed, IsClipping, …) and
 * each of its Elements given whole from the element itself — its Quality and UniqueId, and the one part it carries
 * (Source, Raat, Output, SampleRateConversion, …) member by member, an object that part names (a RaatSignalPathElement's
 * Device) whole too. The whole zone stops four levels down, at the part, which the owner's reads of 2026-11-10 said by
 * its type alone. The elements a list object or a list held as bytes, either read. Calls nothing.
 * @param {any} graph @param {any} zone  the Zone object
 */
function signalPathOf(graph, zone) {
  const sp = field(zone, "SignalPath");
  if (sp === undefined) return { skipped: "The zone came without a SignalPath (none, or at its default)." };
  if (!isRef(sp)) return { skipped: "The zone's SignalPath wasn't sent by reference." };
  const path = graph.get(sp.$ref);
  if (!path || !path.loaded) return { skipped: "The zone's SignalPath was named but never pushed.", oid: String(sp.$ref) };
  /** @type {Record<string, any>} */
  const own = {};
  for (const k of Object.keys(path.fields)) {
    if (k.startsWith("$") || k.endsWith("::Elements")) continue;
    const v = path.fields[k];
    own[k.slice(k.lastIndexOf("::") + 2)] = isRef(v) ? wholeOf(graph, v) : deep(graph, k, v);
  }
  const els = field(path, "Elements");
  /** @type {any[] | null} */
  let items = null, cut = false;
  if (isRef(els)) {
    const list = graph.get(els.$ref);
    if (list && list.loaded && Array.isArray(list.fields.$items)) { items = list.fields.$items; cut = list.fields.$count === -1; }
  } else if (Buffer.isBuffer(els)) {
    const list = readList(graph, fullNameOf(path.fields, "Elements"), els);
    if (list) { items = list.items; cut = !list.whole; }
  }
  if (items === null) return { oid: String(sp.$ref), path: own, elements: { skipped: els === undefined ? "The SignalPath came without Elements." : "Its Elements couldn't be read." } };
  return Object.assign({ oid: String(sp.$ref), path: own, count: items.length }, cut ? { cut: "Not all of the elements arrived." } : {},
    items.length > MAX_ITEMS ? { more: items.length - MAX_ITEMS } : {},
    { elements: items.slice(0, MAX_ITEMS).map((x) => (isRef(x) ? wholeOf(graph, x) : deep(graph, "", x))) });
}

/**
 * An album's other versions (v2.0.3-t13, §16.4): its AlternateAlbumVersions as the Album holds it — a struct of lists
 * (LibraryGroupVersions, LibraryOtherVersions, StreamingVersions), each a list object of AlternateAlbumVersion structs,
 * which the owner's first read (The Dark Side of the Moon) said by their type alone. Here each is said in full
 * (deep-value.js), a list object opened for its items, and every object a version names given whole once, under
 * `named` (the first MAX_NAMED; the rest counted). Calls nothing.
 * @param {any} graph @param {any} album  the Album object
 */
function versionsOf(graph, album) {
  const v = field(album, "AlternateAlbumVersions");
  if (v === undefined) return { skipped: "The album came without AlternateAlbumVersions." };
  /** @type {Map<string, any>} */
  const named = new Map();
  let more = 0;
  /**
   * A value in full: a list object opened, its items each the same (a list that didn't all arrive, said so); an object
   * named, noted; a struct member by member; a list held as an array or as its bytes (focus.js readList) walked item by
   * item, so an object one names is noted too (the review: else said as its oid alone).
   * @param {any} x @param {string} name  the member's full name, which names a list's element type @param {number} depth
   * @returns {any}
   */
  const full = (x, name, depth) => {
    if (depth > 6) return "…";
    if (isRef(x)) {
      const o = graph.get(x.$ref);
      if (o && o.loaded && Array.isArray(o.fields.$items)) {
        return Object.assign({ list: shortType(o.typeName), oid: String(x.$ref), count: o.fields.$items.length },
          o.fields.$count === -1 ? { cut: "Not all of this list arrived." } : {},
          { items: o.fields.$items.slice(0, MAX_ITEMS).map((/** @type {any} */ y) => full(y, "", depth + 1)) });
      }
      const key = String(x.$ref);
      if (!named.has(key)) { if (named.size < MAX_NAMED) named.set(key, null); else more++; }
      return { ref: key };
    }
    if (Array.isArray(x)) return x.slice(0, MAX_ITEMS).map((y) => full(y, "", depth + 1));
    if (Buffer.isBuffer(x)) {
      const list = readList(graph, name, x);
      if (!list) return deep(graph, name, x);
      return Object.assign({ list: list.type, count: list.count }, list.whole ? {} : { whole: false },
        { items: list.items.slice(0, MAX_ITEMS).map((y) => full(y, "", depth + 1)) });
    }
    if (!x || typeof x !== "object" || !("$type" in x)) return deep(graph, name, x);
    /** @type {Record<string, any>} */
    const out = { struct: shortType(String(x.$type)) };
    for (const k of Object.keys(x)) if (k !== "$type") out[k.includes("::") ? k.slice(k.lastIndexOf("::") + 2) : k] = full(x[k], k, depth + 1);
    return out;
  };
  const said = full(v, "AlternateAlbumVersions", 0);
  for (const key of named.keys()) named.set(key, wholeOf(graph, { $ref: BigInt(key) }));
  return Object.assign({ versions: said, named: Object.fromEntries(named) }, more ? { namedNotSaid: more } : {});
}

/**
 * @param {{ link: { session(): any, status?: () => { lastDown?: any } } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, keyOf: (title: string, artist: string) => string | null,
 *           zones: () => any[], profile: () => string | null, log?: (line: string) => void, albumWaitMs?: number }} deps
 *   zones: the official API's zones (the zone matched to the server's by smart.js's zoneFor); profile: the chosen one's id
 */
function createReadsProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;
  return {
    /**
     * Every read of §16.4, once. title/artist: the album (the title alone: by the title; neither: the library's first);
     * zoneId: the zone (else the first playing, else the first; an id no zone has, said so).
     * @param {{ title?: string, artist?: string, zoneId?: string, queue?: boolean }} [o]  queue: the queue's items asked for too
     * @returns {Promise<any>}
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
          /** @type {bigint | null} */
          let queueRef = null, zoneMatched = false;
          const out = /** @type {Record<string, any>} */ ({ readOnly: true, design: "dev/design/native-remote.md §16.4, §16.5" });

          // The connection's state, said before the reads and after each (v1.9.70-t4, §16.5): the owner's first run lost
          // its connection after the queue's read, and the answer didn't say why.
          // "probe finished" (the owner's run) is Rouen's own link closing the session, not the server dropping it: the
          // keepalives (a server slow to answer them is closed by the link's check) and, once closed, the link's last
          // reason are said too (the review).
          const state = () => {
            const open = !!deps.link && deps.link.session() === s;
            const down = !open && deps.link && deps.link.status ? deps.link.status().lastDown || null : null;
            return Object.assign({ objects: graph.objects.size, cap: graph.maxObjects, overflowed: !!graph.overflowed,
              decodeErrors: graph.decodeErrors || 0, uncertain: s.g.uncertain() || null,
              keepalive: typeof s.keepalive === "function" ? Object.assign({}, s.keepalive()) : null, stillOpen: open }, down ? { lastDown: down } : {});
          };
          out.connection = { before: state(), after: /** @type {Record<string, any>} */ ({}) };
          // Each step on its own: one that throws is said, and the rest still run (the review).
          const step = async (/** @type {string} */ name, /** @type {() => Promise<void>} */ fn) => {
            try { await fn(); } catch (e) { out[name] = { error: String(e && /** @type {any} */ (e).message) }; }
            out.connection.after[name] = state();
          };

          // 3–5, 8. The album: whole, its tracks, its main performer, its image. The title alone matches by the title.
          await step("album", async () => {
            const byTitle = (/** @type {string} */ t) => deps.keyOf(t, "");
            const album = !o.title ? known.values().next().value
              : o.artist ? [...known.values()].find((a) => deps.keyOf(a.title, a.artist) === deps.keyOf(/** @type {string} */ (o.title), /** @type {string} */ (o.artist)))
                : [...known.values()].find((a) => byTitle(a.title) === byTitle(/** @type {string} */ (o.title)));
            if (!album) { out.album = { skipped: o.title ? "No album of that title (and artist) in your server's library on this connection." : "The library is empty." }; return; }
            const oid = BigInt(album.oid);
            const arg = () => new BinaryWriter().long(oid).toBuffer();
            const what = `the album, object ${oid}`;
            out.asked = { title: album.title, artist: album.artist };
            // Longer than the rest (§16.5): on the owner's server the Album named hadn't come in 2.5 s.
            out.album = await ask(s, root.library.oid, SIG.getAlbum, arg, { what, waitMs: deps.albumWaitMs ?? ALBUM_WAIT_MS });
            out.albumTracks = await ask(s, root.library.oid, SIG.albumTrackLites, arg, { list: true, what });
            // The Album answered (an object of its own), loaded; else the AlbumLite, if the graph still holds it (the
            // library read lets each go once read, so it seldom does).
            const answered = out.album.answer && out.album.answer.oid && out.album.answer.object ? graph.get(BigInt(out.album.answer.oid)) : null;
            const lite = graph.get(oid);
            const held = answered && answered.loaded ? answered : lite && lite.loaded ? lite : null;
            if (!held) {
              const none = { skipped: "No album object to read it from: GetAlbum gave none, and the library read no longer holds the album." };
              out.performer = none; out.image = none; out.versions = none;
              return;
            }
            const perf = performerOf(graph, held);
            out.performer = perf === null ? { skipped: "The album came without a main performer the graph holds." }
              : await ask(s, root.library.oid, SIG.getPerformer, () => new BinaryWriter().long(perf).toBuffer(), { what: `its main performer, object ${perf}` });
            out.versions = held === answered ? versionsOf(graph, held)
              : { skipped: "GetAlbum gave no Album; the library's AlbumLite holds no versions." };
            const img = field(held, "Image");
            out.image = img === undefined ? { skipped: "The album came without an Image." } : wholeOf(graph, img);
          });

          // 6–7. Genres and tags.
          await step("genres", async () => {
            out.genres = await ask(s, root.library.oid, SIG.toplevelGenres, () => inlineStruct(s.g, GET_GENRE_PARAMETERS, []), { what: "GetGenreParameters, every member its default" });
          });
          await step("tags", async () => {
            const profile = profileObjectFor(root, deps.profile());
            out.tags = profile ? await ask(s, root.library.oid, SIG.allTagLites, () => new BinaryWriter().long(BigInt(profile.oid)).toBuffer(), { what: `the profile, object ${profile.oid}` })
              : { skipped: "No profile to ask for." };
          });
          // 1–2. The zone: what it plays and its queue, as held (no call); the queue's items asked only with queue=1, and last:
          // the whole queue, its history with it, was 8,000 items on the owner's server (§16.5).
          await step("zone", async () => {
            const zones = deps.zones() || [];
            const z = o.zoneId ? zones.find((x) => x.zone_id === o.zoneId) : zones.find((x) => x.state === "playing") || zones[0];
            if (!z) {
              // v2.0.3-t13: the owner's read of 2026-11-10 found none on either side; how many the connection held is said,
              // so a Core with no zones at that moment (nothing switched on) is told from Rouen not seeing them
              // (counted as the zones probe counts them, zone-probe.js).
              let onConnection = 0;
              for (const x of graph.objects.values()) if (x.loaded && shortType(x.typeName) === "Zone") onConnection++;
              out.zone = { skipped: o.zoneId ? "The official API has no zone of that id." : "The official API has no zone to match.", onConnection };
              return;
            }
            const m = zoneFor(graph, z);
            if ("notSent" in m) { out.zone = { official: z.display_name || z.zone_id, skipped: m.notSent }; return; }
            const np = field(m.zone, "NowPlaying"), q = field(m.zone, "Queue");
            // The rest of the zone, whole, its NowPlaying and Queue said once above (v2.0.3-t12): where the server holds what
            // its signal path is made of (OutputSignalPathElement pushes were seen in §14.2), not yet read.
            const said = new Set([np, q].filter(isRef).map((r) => String(r.$ref)));
            out.zone = { official: z.display_name || z.zone_id, state: z.state || null, matchedBy: m.by, oid: String(m.zone.oid),
              nowPlaying: np === undefined ? "not sent (none, or at its default)" : wholeOf(graph, np),
              queue: q === undefined ? "not sent" : wholeOf(graph, q),
              signalPath: signalPathOf(graph, m.zone),
              whole: whole(graph, { $ref: m.zone.oid }, said) };
            zoneMatched = true;
            queueRef = isRef(q) ? BigInt(q.$ref) : null;
          });

          await step("queueItems", async () => {
            out.queueItems = !o.queue ? { skipped: "Not asked: add &queue=1 (the whole queue, its history with it, can be thousands of items)." }
              : !zoneMatched ? { skipped: "No zone matched (see zone), so there is no queue to ask." }
                : queueRef !== null ? await ask(s, queueRef, SIG.queueItems, () => Buffer.alloc(0), { list: true })
                : { skipped: "The zone's Queue wasn't sent by reference, so there is no object to ask." };
          });
          // The Album named and not come in time: looked for once more, after the other reads.
          if (out.album && out.album.answer && out.album.answer.object === "named, never pushed") {
            const later = graph.get(BigInt(out.album.answer.oid));
            out.albumLater = later && later.loaded ? wholeOf(graph, { $ref: later.oid }) : "Still not pushed by the end of the read.";
          }
          log("native reads probe: run");
          return out;
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createReadsProbe, listAnswer, firstOf, performerOf, ask, versionsOf, signalPathOf };
