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
 *   the zone's NowPlaying and Queue, as the graph holds them (no call)
 *   Queue::GetItems on that queue — only when asked for (the whole queue, history and all, can be thousands)
 *
 * The connection's state is said before the reads and after each step, and why it closed, if it did.
 *
 * Each step on its own: one refused, or unanswered, leaves the others (once the connection is uncertain nothing more is
 * sent). An answer is read by the graph's own reader (settings-probe.js's `answer`), an object it names waited for and
 * given whole (`whole`); a list answered, each item the same; an answer that can't be read, its first bytes.
 */
const { BinaryReader, BinaryWriter } = require("./wire");
const { SIG, inlineStruct } = require("./methods");
const { GET_GENRE_PARAMETERS } = require("./schemas");
const { P, field, isRef, waitFor, shortType } = require("./objects");
const { answer, whole } = require("./settings-probe");
const { zoneFor } = require("./smart");
const { profileObjectFor } = require("./session");
const { noRoom } = require("./find");
const { readList } = require("./focus");
const { fullNameOf } = require("./edit-info");

const WAIT_MS = 2500, ALBUM_WAIT_MS = 8000, MAX_ITEMS = 20, HEX_MAX = 256;

/** An object the graph holds, whole, by its reference. @param {any} graph @param {any} v */
const wholeOf = (graph, v) => whole(graph, v, new Set());

/**
 * An answer that is a list (IList<T>): LengthPrefixed (its length, then its count and items) or bare (its count and
 * items), each item a value or an object by reference, waited for and given whole; null when it isn't a list.
 * @param {any} graph @param {Buffer} payload @param {number} waitMs @param {Set<string>} fresh
 */
async function listAnswer(graph, payload, waitMs, fresh) {
  /** @param {BinaryReader} r */
  const items = (r) => {
    const n = r.flexInt();
    if (n < 0 || n > r.remaining) throw new Error(`a count of ${n} with ${r.remaining} byte(s) left`);
    const out = [];
    for (let i = 0; i < n; i++) out.push(graph.readValue(r, P.Object));
    if (r.remaining) throw new Error(`${r.remaining} byte(s) after the ${n} item(s)`);
    return out;
  };
  /** @type {any[] | null} */
  let got = null, form = "";
  try {
    const r = new BinaryReader(payload);
    const inner = new BinaryReader(r.bytes(r.integer()));
    if (r.remaining) throw new Error("bytes after the list");
    got = items(inner); form = "LengthPrefixed list";
  } catch (e) {
    // Not that form: tried bare next, and failing both, not a list (the caller reads it as one value).
    try { got = items(new BinaryReader(payload)); form = "bare list"; } catch (e2) { return null; }
  }
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
              out.performer = none; out.image = none;
              return;
            }
            const perf = performerOf(graph, held);
            out.performer = perf === null ? { skipped: "The album came without a main performer the graph holds." }
              : await ask(s, root.library.oid, SIG.getPerformer, () => new BinaryWriter().long(perf).toBuffer(), { what: `its main performer, object ${perf}` });
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
            if (!z) { out.zone = { skipped: o.zoneId ? "The official API has no zone of that id." : "The official API has no zone to match." }; return; }
            const m = zoneFor(graph, z);
            if ("notSent" in m) { out.zone = { official: z.display_name || z.zone_id, skipped: m.notSent }; return; }
            const np = field(m.zone, "NowPlaying"), q = field(m.zone, "Queue");
            out.zone = { official: z.display_name || z.zone_id, state: z.state || null, matchedBy: m.by, oid: String(m.zone.oid),
              nowPlaying: np === undefined ? "not sent (none, or at its default)" : wholeOf(graph, np),
              queue: q === undefined ? "not sent" : wholeOf(graph, q) };
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

module.exports = { createReadsProbe, listAnswer, firstOf, performerOf, ask };
