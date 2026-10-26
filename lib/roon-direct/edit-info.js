// @ts-check
"use strict";
/*
 * edit-info.js — t3 (dev/design/catalogue.md §4, v1.9.67-t3): what Roon itself holds of an album's catalogue number,
 * labels and kind, read once, by hand, over native mode's connection. Nothing is written.
 *
 *   Library::GetMultiAlbumEditInfo(AlbumEditInfoParameters { Albums, LanguagePreferences }) for a few library albums
 *   (the connection's own objects of them) → an answer by value: a list of AlbumEditInfo, each with its Type
 *   (AlbumType), IsLive, IsBootleg and IsCompilation, Labels, CatalogNumber, ProductCode, Country, Version,
 *   MetadataAlbumId and Title — every one an Edit*Info struct holding the value Roon shows, the file's own, the
 *   metadata service's and the user's edit, and which of those layers exist. The catalogue is the only source: the
 *   call has never been run upstream nor captured, so its argument form (edit-info args, below) and its answer's
 *   (a LengthPrefixed collection of inline structs) are this design's reading, each said as it is tried.
 *
 * Shown beside what Rouen holds of the same album (the tags' and Discogs', lib/release-facts.js; the label scan's
 * label), so the owner's run settles t4 (dev/design/catalogue.md §4): one kind per album or several, where Bootleg
 * lives, and whether Roon's number and labels are worth taking. Values as smart-probe.js says them; a list as
 * focus.js reads one; an answer the graph can't decode is given as its first HEX_MAX bytes in hex (as the settings
 * probe does), for the design to read.
 */
const { P, isRef, plain } = require("./objects");
const { BinaryReader, BinaryWriter } = require("./wire");
const { SIG, inlineStruct, refList } = require("./methods");
const { ALBUM_EDIT_INFO_PARAMETERS } = require("./schemas");
const { readList } = require("./focus");
const { noRoom } = require("./find");
const { deep } = require("./deep-value");

const TRIES = Object.freeze([[], ["en"]]);
const DEFAULT_N = 5, MAX_N = 25, HEX_MAX = 256;
/** AlbumType, as the catalogue has it (§12.19 maps it the other way). */
const TYPE_NAME = Object.freeze({ 0: "Main", 1: "Single", 2: "Show", 3: "Compilation", 4: "Other", 5: "Unknown", 6: "ExtendedPlay", 7: "Soundtrack" });
/** The AlbumEditInfo members the design is after, by their short names, with how each is said. */
const WANTED = Object.freeze(["Title", "Type", "IsLive", "IsBootleg", "IsCompilation", "Labels", "CatalogNumber", "ProductCode", "Country", "Version", "MetadataAlbumId"]);

/** A list of strings, LengthPrefixed (focus-write.js strList, not exported). @param {string[]} xs */
function strList(xs) {
  const w = new BinaryWriter().flexInt(xs.length);
  for (const x of xs) w.string(x);
  const b = w.toBuffer();
  return new BinaryWriter().integer(b.length).bytes(b).toBuffer();
}

/**
 * The call's one argument: AlbumEditInfoParameters with the albums as a collection of the connection's objects and
 * the languages as a collection of strings, both LengthPrefixed as the owner's server declares every list (§12.2).
 * @param {{ defineType(name: string, members: ReadonlyArray<{ name: string, propType: number }>): number }} g
 * @param {bigint[]} oids @param {string[]} languages
 */
function editInfoArgs(g, oids, languages) {
  return inlineStruct(g, ALBUM_EDIT_INFO_PARAMETERS, [
    ["System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumBase> Sooloos.Broker.Api.AlbumEditInfoParameters::Albums", refList(oids)],
    ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumEditInfoParameters::LanguagePreferences", strList(languages)],
  ]);
}

/** A struct's member by its short name (the server names members "type Namespace.Type::Member"). @param {any} v @param {string} name */
function memberOf(v, name) {
  if (!v || typeof v !== "object") return undefined;
  const k = Object.keys(v).find((x) => x.endsWith("::" + name));
  return k === undefined ? undefined : v[k];
}
/** The full name of a struct's member, for a list's element type. @param {any} v @param {string} name */
const fullNameOf = (v, name) => Object.keys(v || {}).find((x) => x.endsWith("::" + name)) || "";

/**
 * An Edit*Info struct as the page shows it: the value Roon shows and each layer (the file's own, the metadata
 * service's, the edit), a list's items read by its element type, and which layers the struct says it has.
 * @param {any} graph @param {any} v  the inline struct, or whatever came
 */
function layers(graph, v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || !("$type" in v)) return { as: typeof v, value: typeof v === "bigint" ? String(v) : v };
  /** @param {string} name */
  const say = (name) => {
    const x = memberOf(v, name);
    if (Buffer.isBuffer(x)) { const l = readList(graph, fullNameOf(v, name), x); return l ? (l.whole ? l.items : { items: l.items, whole: false }) : { bytes: x.length }; }
    if (typeof x === "bigint") return String(x);
    return x === undefined ? undefined : plain(x);
  };
  const out = /** @type {Record<string, any>} */ ({ struct: String(v.$type).replace(/Sooloos\.Broker\.Api\./g, "") });
  // A value's members, or a list's (EditListInfo: Values, LocalValues …), under one name each.
  for (const [key, name] of [["value", "Value"], ["local", "LocalValue"], ["metadata", "MetadataValue"], ["base", "BaseValue"], ["edit", "EditValue"],
    ["preferLocal", "PreferLocalValue"]]) {
    const s = say(name) ?? say(name + "s");
    if (s !== undefined) out[key] = s;
  }
  const has = ["HasLocalLayer", "HasMetadataLayer", "HasEditLayer"].filter((n) => memberOf(v, n) === true).map((n) => n.replace(/^Has|Layer$/g, "").toLowerCase());
  if (has.length) out.layers = has;
  return out;
}

/**
 * The answer, by value: a LengthPrefixed collection of inline AlbumEditInfo structs (this design's reading); failing
 * that, the collection bare; failing that, its bytes, said.
 * @param {any} graph @param {Buffer} payload
 * @returns {{ items: any[], form: string } | { undecoded: true, why: string, bytes: number, hex: string }}
 */
function readAnswer(graph, payload) {
  /** @param {string} form @param {BinaryReader} r */
  const items = (form, r) => {
    const n = r.flexInt();
    if (n < 0 || n > r.remaining) throw new Error(`a count of ${n} with ${r.remaining} byte(s) left`);
    const out = [];
    for (let i = 0; i < n; i++) {
      const it = graph.readValue(r, P.Object);
      // An item that is no inline struct (a reference, a null) is not this form: not read on as if it were.
      if (!it || typeof it !== "object" || isRef(it)) throw new Error(`item ${i + 1} of ${n} is not an inline struct`);
      out.push(it);
    }
    if (r.remaining) throw new Error(`${r.remaining} byte(s) after the ${n} item(s)`);
    return { items: out, form };
  };
  let why;
  try {
    const r = new BinaryReader(payload);
    const inner = new BinaryReader(r.bytes(r.integer()));
    if (r.remaining) throw new Error(`${r.remaining} byte(s) after the collection`);
    return items("LengthPrefixed collection of inline structs", inner);
  } catch (e) { why = String(e && /** @type {any} */ (e).message); }
  try { return items("bare collection of inline structs", new BinaryReader(payload)); }
  catch (e) { why += "; bare: " + String(e && /** @type {any} */ (e).message); }
  return { undecoded: true, why, bytes: payload.length, hex: payload.subarray(0, HEX_MAX).toString("hex") };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, off: () => string | null,
 *           release?: (title: string, artist: string) => any, log?: (line: string) => void }} deps
 *   release: what Rouen holds of an album (its label, catalogue number and kind, and which source said so)
 */
function createEditInfoProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;
  return {
    /**
     * @param {{ n?: number, title?: string, artist?: string }} [o]  n: how many albums (DEFAULT_N, at most MAX_N);
     *   title/artist: only albums whose title or artist holds the text
     * @returns {Promise<any>} what was read, or { error, status } when it could not be asked for
     */
    async run(o) {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A probe is already running.", status: 409 };
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
          const n = Math.max(1, Math.min(MAX_N, (o && o.n) || DEFAULT_N));
          const has = (/** @type {string} */ v, /** @type {string | undefined} */ needle) => !needle || v.toLowerCase().includes(needle.toLowerCase());
          const chosen = [...known.values()].filter((a) => has(a.title, o && o.title) && has(a.artist, o && o.artist)).slice(0, n);
          if (!chosen.length) return { error: "No library album matches; drop ?title= and ?artist=, or try another.", status: 404 };
          const oids = chosen.map((a) => BigInt(a.oid));
          /** @type {Array<{ languages: string[], status: string }>} */
          const tries = [];
          let res = null;
          for (const languages of TRIES) {
            const r = await g.call(root.library.oid, SIG.albumEditInfo, editInfoArgs(g, oids, [...languages]));
            tries.push({ languages: [...languages], status: r.success ? "Success" : String(r.status) });
            if (r.success) { res = r; break; }
          }
          const about = { asked: chosen.map((a) => ({ title: a.title, artist: a.artist })), tries, design: "dev/design/catalogue.md §4" };
          if (!res) { log("album edit info probe: refused in both forms"); return Object.assign(about, { read: false }); }
          const got = readAnswer(graph, res.payload);
          if ("undecoded" in got) { log("album edit info probe: an answer that couldn't be read"); return Object.assign(about, { read: false, answer: got }); }
          const albums = got.items.map((it, i) => {
            const a = chosen[i];
            const ref = memberOf(it, "Album");
            const named = isRef(ref) ? known.get(String(ref.$ref)) : null;
            const out = /** @type {Record<string, any>} */ ({
              album: named ? { title: named.title, artist: named.artist } : a ? { title: a.title, artist: a.artist, byPosition: true } : null,
              rouen: a && deps.release ? deps.release(a.title, a.artist) : null,
              roon: {}, members: it && typeof it === "object" ? Object.keys(it).filter((k) => k !== "$type").map((k) => k.slice(k.lastIndexOf("::") + 2)) : [],
            });
            for (const name of WANTED) {
              const l = layers(graph, memberOf(it, name));
              if (l && name === "Type" && typeof l.value === "number") l.name = (/** @type {any} */ (TYPE_NAME))[l.value] || null;
              out.roon[name] = l;
            }
            return out;
          });
          // The first one whole, every member under the server's own name, for the design to read.
          const first = got.items[0];
          log(`album edit info probe: ${albums.length} album(s) read, form: ${got.form}`);
          return Object.assign(about, { read: true, form: got.form, albums, whole: first ? deep(graph, "", first) : null,
            libraryType: root.library && root.library.typeName ? String(root.library.typeName) : null });
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createEditInfoProbe, editInfoArgs, readAnswer, layers, memberOf, TYPE_NAME, WANTED };
