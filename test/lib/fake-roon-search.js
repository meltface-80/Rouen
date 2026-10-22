"use strict";
// ---------------------------------------------------------------------------
// The fake server's search (N2b-1, v1.9.32, native-remote.md §9.1):
// Library::UnifiedSearch, its parameters read strictly, answered with a
// reference to a UnifiedSearchResults object it pushes — its top results
// (inline TopSearchResult values in a list), top album, top library album and
// album list — and UnifiedSearchResults::Dispose recorded.
//
// What it finds: the library's albums whose title is in the terms (by
// reference, pushed only if this connection was never sent them, as the
// server sends each object once a connection), and the streaming catalogue's
// (o.catalog: [{ title, artist, source }]) likewise, pushed anew. Not evidence
// that the real server answers this way: N2b-1 exists to find that out.
//
// faults.versions: the album list names each catalogue album's versions
// (an AlbumLiteVersions, and its list), sent once a connection as albums are;
// faults.emptyLeftOut: an empty list is left out of the result, as a sparse
// struct leaves out a default — a search that finds nothing has no members;
// faults.shortQuery: the album list a Query whose count says one more item
// than it carries, the last to follow (and never sent).
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { OWNER, OTHER } = require("./fake-roon-hearts");

/** The types the fake declares for its search results (ids chosen clear of the core's). */
const S = { Results: 40, TopList: 41, AlbumList: 42, TopResult: 43, Versions: 44, AlbumQuery: 45 };
const SEARCH_TYPES = [
  [S.Results, "Sooloos.Broker.Api.UnifiedSearchResults", [
    ["Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.TopSearchResult> Sooloos.Broker.Api.UnifiedSearchResults::TopSearchResults", 23],
    ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.UnifiedSearchResults::TopAlbum", 23],
    ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.UnifiedSearchResults::TopLibraryAlbum", 23],
    ["Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.AlbumLite> Sooloos.Broker.Api.UnifiedSearchResults::Albums", 23]]],
  [S.TopList, "Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.TopSearchResult>", []],
  [S.AlbumList, "Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.AlbumLite>", []],
  [S.TopResult, "Sooloos.Broker.Api.TopSearchResult", [
    ["bool Sooloos.Broker.Api.TopSearchResult::IsLocal", 2],
    ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.TopSearchResult::Album", 23],
    ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.TopSearchResult::LibraryAlbum", 23]]],
  [S.AlbumQuery, "Sooloos.Broker.Api.Query<Sooloos.Broker.Api.AlbumLite>", []],
  [S.Versions, "Sooloos.Broker.Api.AlbumLiteVersions", [
    ["Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.AlbumLite> Sooloos.Broker.Api.AlbumLiteVersions::Albums", 23]]],
];
const SEARCH_PARAMETERS = "Sooloos.Broker.Api.SearchParameters";

/**
 * @param {{ sig: string, r: BinaryReader, rid: number, oid: bigint, clientTypes: Map<number, { name: string, members: Array<[string, number]> }>,
 *           albums: any[], catalog: any[], albumOid: (i: number) => bigint, pushAlbum: (i: number) => void,
 *           pushCatalog: (j: number) => bigint, push: (cmd: number, body: Buffer) => void, ok: (rid: number, payload?: Buffer) => void,
 *           refuse: (rid: number, why: string) => void, sent: Set<string>,
 *           later: (fn: () => void) => void, nextOid: () => bigint, rec: any, faults: any }} c
 * @returns {boolean} whether it was the search, or its Dispose
 */
function handleSearch(c) {
  if (c.sig === "Sooloos.Broker.Api.UnifiedSearchResults::Dispose()") { c.rec.searchDisposed.push(c.oid.toString()); return true; }
  if (!c.sig.includes("Library::UnifiedSearch")) return false;
  if (c.sig !== "Sooloos.Broker.Api.Library::UnifiedSearch(Sooloos.Broker.Api.SearchParameters, Base.ResultCallback<Sooloos.Broker.Api.UnifiedSearchResults>)") {
    throw new Error("a UnifiedSearch form the fake does not take: " + c.sig);
  }
  const r = c.r;
  if (r.long() !== 1n) throw new Error("SearchParameters not sent as an inline value");
  const t = c.clientTypes.get(r.flexInt());
  if (!t || t.name !== SEARCH_PARAMETERS || t.members.length !== 8) throw new Error("not the SearchParameters type as declared: " + JSON.stringify(t));
  const body = new BinaryReader(r.bytes(r.flexInt()));
  /** @type {Record<string, any>} */
  const got = {};
  for (let idx = body.flexInt(); idx !== 0; idx = body.flexInt()) {
    const [name, prop] = t.members[idx - 1];
    const short = name.slice(name.lastIndexOf("::") + 2);
    if (short === "ProfileId" && prop === 4) got.profile = body.sooid();
    else if (short === "Terms" && prop === 20) got.terms = body.string();
    else if ((short === "MaxCount" || short === "MaxTopResultCount") && prop === 0) got[short] = body.integer();
    else throw new Error("a SearchParameters member the fake does not expect: " + name);
  }
  if (body.pos !== body.buf.length || r.pos !== r.buf.length) throw new Error("bytes after the search's parameters");
  if (!got.profile || (!got.profile.equals(OWNER) && !got.profile.equals(OTHER))) throw new Error("a search for a profile the fake does not have");
  if (typeof got.terms !== "string" || !got.terms) throw new Error("a search with no terms");
  c.rec.searches.push({ terms: got.terms, profile: got.profile.toString("hex"), max: got.MaxCount, top: got.MaxTopResultCount });

  const terms = got.terms.toLowerCase();
  const inTerms = (/** @type {any} */ a) => !!a.title && terms.includes(a.title.toLowerCase());
  const library = c.albums.map((a, i) => i).filter((i) => inTerms(c.albums[i]));
  const streaming = (c.catalog || []).map((a, j) => j).filter((j) => inTerms(c.catalog[j]));
  library.forEach(c.pushAlbum);   // sent once a connection: a no-op for an album the library read sent
  const streamOids = streaming.map((j) => c.pushCatalog(j));
  const libOids = library.map(c.albumOid);

  const root = c.nextOid(), top = c.nextOid(), list = c.nextOid();
  const ref = (/** @type {bigint} */ oid) => new BinaryWriter().long(oid).toBuffer();
  const raw = (/** @type {bigint} */ oid, /** @type {number} */ typeId, /** @type {Buffer} */ rest) =>
    c.push(3, Buffer.concat([new BinaryWriter().long(oid).flexInt(typeId).toBuffer(), rest]));
  const topItem = (/** @type {bigint} */ oid, /** @type {boolean} */ lib) => {
    const b = new BinaryWriter().flexInt(1).boolean(lib).flexInt(lib ? 3 : 2).long(oid).flexInt(0).toBuffer();
    return new BinaryWriter().long(1n).flexInt(S.TopResult).flexInt(b.length).bytes(b).toBuffer();
  };
  const tops = [...libOids.map((o) => topItem(o, true)), ...streamOids.map((o) => topItem(o, false))];
  // versions: each catalogue album by its versions object, pushed (with its list) once a connection.
  const versionsOf = (/** @type {number} */ j, /** @type {bigint} */ album) => {
    const v = 61000n + BigInt(j), vl = 62000n + BigInt(j);
    if (c.sent.has(String(v))) return v;
    c.sent.add(String(v));
    raw(vl, S.AlbumList, Buffer.concat([new BinaryWriter().integer(1).toBuffer(), ref(album)]));
    raw(v, S.Versions, new BinaryWriter().flexInt(1).long(vl).flexInt(0).toBuffer());
    return v;
  };
  const all = [...libOids, ...(c.faults.versions ? streaming.map((j, k) => versionsOf(j, streamOids[k])) : streamOids)];
  const lists = () => {
    raw(top, S.TopList, Buffer.concat([new BinaryWriter().integer(tops.length).toBuffer(), ...tops]));
    // incompleteSearch: the album list is never pushed — a result that does not all arrive.
    if (c.faults.shortQuery) raw(list, S.AlbumQuery, Buffer.concat([new BinaryWriter().flexInt(1).integer(all.length + 1).flexInt(0).toBuffer(), ...all.map(ref)]));
    else if (!c.faults.incompleteSearch) raw(list, S.AlbumList, Buffer.concat([new BinaryWriter().integer(all.length).toBuffer(), ...all.map(ref)]));
  };
  const rootObj = () => {
    const w = new BinaryWriter();
    if (tops.length || !c.faults.emptyLeftOut) w.flexInt(1).long(top);
    if (streamOids.length) w.flexInt(2).long(streamOids[0]);
    if (libOids.length) w.flexInt(3).long(libOids[0]);
    if (all.length || !c.faults.emptyLeftOut) w.flexInt(4).long(list);
    raw(root, S.Results, w.flexInt(0).toBuffer());
  };
  if (c.faults.refuseSearch) { c.refuse(c.rid, "Refused"); return true; }
  // lateSearch: the answer first, its objects after it.
  if (c.faults.lateSearch) { c.ok(c.rid, ref(root)); c.later(() => { lists(); rootObj(); }); return true; }
  lists(); rootObj();
  c.ok(c.rid, ref(root));
  return true;
}

module.exports = { handleSearch, SEARCH_TYPES };
