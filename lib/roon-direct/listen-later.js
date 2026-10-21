// @ts-check
"use strict";
/*
 * listen-later.js — N2c-0 (dev/design/native-remote.md §10.1, v1.9.36): Roon's own Listen Later,
 * read once, by hand, over native mode's connection. Nothing is written.
 *
 *   Library::GetListenLater(Profile, IList<string>) for the profile chosen in Settings → Native
 *   mode → a reference to a DataList<ListenLaterItem> the server pushes → each item: what it is
 *   (DataType), its State and Timestamp, and what it names — an album (title, artist, source, in
 *   the library or not), a track, an artist.
 *
 * The call has never been run (upstream's client never did; Roon's app was never captured making
 * it), so its second argument is this design's reading (methods.js listenLaterArgs): sent with no
 * languages first, and with ["en"] once if that is refused, each status reported.
 *
 * Sent once a connection (§4), as the search's albums are (find.js, whose album rule this shares):
 * a library album comes back as a bare reference, or as one field pushed since, and is taken from
 * what the library read on this connection was sent (`known`), with whatever has been pushed of it
 * since laid over — so nothing runs until the library has been read whole on it. Everything the
 * answer sends is kept, the list included: the same list named again on this connection would come
 * as a bare reference.
 */
const { field, plain, isRef, waitFor } = require("./objects");
const { SIG, listenLaterArgs } = require("./methods");
const { readFlexLong } = require("./wire");
const { sentWhole } = require("./albums");
const { profileObjectFor } = require("./session");
const { sourceName, albumHit, noRoom } = require("./find");
const { imageKeyOf } = require("./locations");

const TRIES = Object.freeze([[], ["en"]]);
const MAX_SHOWN = 100;
const TICKS_MASK = (1n << 62n) - 1n;
const EPOCH_TICKS = 621355968000000000n;   // 1970-01-01 in .NET ticks

/**
 * A DateTime as it came: .NET ticks, the top two bits its kind if the server wrote DateTime.ToBinary
 * (1 UTC, 2 local) — an ISO time, marked when local; the number as it came when it is not one.
 * @param {any} v
 */
function when(v) {
  if (typeof v !== "bigint") return plain(v) ?? null;
  const u = BigInt.asUintN(64, v);
  const kind = Number(u >> 62n), ticks = u & TICKS_MASK;
  if (ticks < EPOCH_TICKS) return String(v);
  const iso = new Date(Number((ticks - EPOCH_TICKS) / 10000n)).toISOString();
  return kind === 2 ? iso.replace("Z", " (the server's local time)") : iso;
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           profile: () => string | null, known: (session: any) => Map<string, import("./albums").RoonAlbum> | null,
 *           off: () => string | null, log?: (line: string) => void, settleMs?: number }} deps
 */
function createListenLaterReader(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 4000;
  let busy = false;

  /**
   * The list as far as it has arrived, and whether all of it has; undefined until the list itself has.
   * @param {any} graph @param {bigint} listId @param {Map<string, any>} known @param {number} max
   */
  function walk(graph, listId, known, max) {
    const list = graph.get(listId);
    if (!list || !list.loaded) return undefined;
    if (!list.fields.$items) return { kind: list.typeName, count: null, arrived: 0, items: [], whole: true, notList: true };
    let whole = !(list.fields.$count < 0 || list.fields.$items.length < list.fields.$count);
    /** A member of an item, inline (by its full name) or pushed. @param {any} it @param {string} name */
    const member = (it, name) => {
      if (isRef(it)) return field(graph.get(it.$ref), name);
      const k = Object.keys(it || {}).find((x) => x.endsWith("::" + name));
      return k ? it[k] : undefined;
    };
    /** What a reference names, by `pick`; null when there is none; undefined while it has not arrived. @param {any} v @param {(o: any) => any} pick */
    const named = (v, pick) => {
      if (!isRef(v)) return null;
      const o = graph.get(v.$ref);
      if (!o || !o.loaded) { whole = false; return undefined; }
      return pick(o);
    };
    /** An album: known from the library read (laid over by the graph), or sent whole now. @param {any} a */
    const album = (a) => {
      if (!isRef(a)) return null;
      const o = graph.get(a.$ref);
      const k = known.get(a.$ref.toString());
      const hit = k ? albumHit(o, true, k) : o && sentWhole(o) ? albumHit(o, false) : null;
      if (!hit) { whole = false; return undefined; }
      // Its id and cover too (v1.9.45, §10.4): a change names the album by its AlbumId, and the list shows its cover.
      return { title: hit.title, artist: hit.artist, source: sourceName(hit.contentSource), inLibrary: hit.inLibrary,
        albumId: hit.albumId, imageKey: (o ? imageKeyOf(graph, o) : null) || (k ? k.imageKey : null) };
    };
    const items = list.fields.$items.slice(0, max).map((/** @type {any} */ it) => {
      if (isRef(it) && !(graph.get(it.$ref) || {}).loaded) { whole = false; return { arrived: false }; }
      return {
        type: member(it, "DataType") ?? null, state: plain(member(it, "State")) ?? null, at: when(member(it, "Timestamp")),
        text: member(it, "Text") ?? null, album: album(member(it, "Album")),
        track: named(member(it, "Track"), (o) => String(field(o, "Title") || "")),
        artist: named(member(it, "Performer"), (o) => String(field(o, "Name") || "")),
      };
    });
    // count: as the list says it; arrived: what came (fewer when cut short, or still to follow).
    return { kind: list.typeName, count: list.fields.$count < 0 ? null : list.fields.$count, arrived: list.fields.$items.length, items, whole };
  }

  return {
    /**
     * @param {{ max?: number }} [o]  max: the items walked (the probe's 100; the list's, more — later.js)
     * @returns {Promise<any>} the list as read, or { error, status } when it could not be asked for
     */
    async read(o) {
      const max = (o && o.max) || MAX_SHOWN;
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A read is already running.", status: 409 };
      busy = true;
      try {
        return await deps.inTurn(async () => {
          const s = deps.link ? deps.link.session() : null;
          if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
          const full = noRoom(s);
          if (full) return { error: full, status: 409 };
          const known = deps.known(s);
          if (!known) return { error: "Your library hasn't been read on this connection to your server yet; try again in a minute.", status: 409 };
          const { g, graph, root } = s;
          if (g.uncertain()) return { error: "The connection to your server is being checked.", status: 503 };
          const profile = profileObjectFor(root, deps.profile());
          if (!profile) return { error: "Your server sent no profile with an id.", status: 502 };
          /** @type {Array<{ languages: string[], status: string }>} */
          const tries = [];
          let res = null;
          for (const languages of TRIES) {
            const r = await g.call(root.library.oid, SIG.getListenLater, listenLaterArgs(profile.oid, [...languages]));
            tries.push({ languages: [...languages], status: r.success ? "Success" : String(r.status) });
            if (r.success) { res = r; break; }
          }
          const about = { profile: String(field(profile, "Name") || "(unnamed)"), tries };
          if (!res) { log("Listen Later: refused in both forms"); return Object.assign(about, { read: false }); }
          const ref = readFlexLong(res.payload, 0);
          if (!ref || ref[0] < 2n || ref[1] !== res.payload.length) {
            // Not a reference: described, never passed on (no protocol bytes reach a browser).
            return Object.assign(about, { read: false, answer: { reference: false, bytes: res.payload.length } });
          }
          const got = await waitFor(settleMs, () => { const v = walk(graph, ref[0], known, max); return v && v.whole ? v : undefined; });
          const sofar = got || walk(graph, ref[0], known, max);
          log(`Listen Later read: ${sofar ? sofar.arrived : 0} item(s)${got ? "" : ", not all arrived"}; the connection now holds ${graph.objects.size} objects`);
          if (!sofar) return Object.assign(about, { read: false, why: `The list had not arrived after ${settleMs / 1000} s.` });
          const list = Object.assign({}, sofar);
          delete list.whole;
          return Object.assign(about, { read: true, complete: !!got, list });
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createListenLaterReader, when };
