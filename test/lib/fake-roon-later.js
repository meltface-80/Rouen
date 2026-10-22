"use strict";
// ---------------------------------------------------------------------------
// The fake server's Listen Later (N2c-0, v1.9.36, native-remote.md §10.1):
// Library::GetListenLater, its arguments read strictly (a profile by its
// object, then the languages as a collection of strings), answered with a
// reference to a DataList<ListenLaterItem> it pushes. Each item is an inline
// ListenLaterItem naming an album: one of the streaming catalogue's (pushed
// if this connection was never sent it) or one of the library's (by
// reference, as the server sends each object once a connection).
//
// o.listenLater: [{ catalog: j } | { library: i }]. Faults: refuseEmptyLanguages
// (a list of no languages refused), refuseLater (every form refused),
// laterNotRef (an answer that is not a reference), lateLater (the answer
// first, the list after), sameLaterList (one list object a connection: named
// again by reference, never pushed twice). Not evidence of how the real server answers: the
// probe exists to find out.
//
// And (N2c-2, v1.9.45, §10.4) Library::SetListenLaterState's album form as
// lib/roon-direct/later.js sends it, read strictly — the profile's id, hearts'
// AlbumLink collection, the state — and answered: Pending (1) puts each album
// on o.listenLater (at its end, the newest), None (0) takes it off. A library
// album is named by its AlbumId, a catalogue album by its own. Faults:
// refuseLaterSet (refused), laterSetIgnored ("Success", nothing done).
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { readAlbumLinks, OWNER, OTHER } = require("./fake-roon-hearts");

const SIG = "Sooloos.Broker.Api.Library::GetListenLater(Sooloos.Broker.Api.Profile, System.Collections.Generic.IList<string>, Base.ResultCallback<Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.ListenLaterItem>>)";
const L = { Item: 50, List: 51 };
const LATER_TYPES = [
  [L.Item, "Sooloos.Broker.Api.ListenLaterItem", [
    ["string Sooloos.Broker.Api.ListenLaterItem::DataType", 20],
    ["Sooloos.Broker.Api.ListenLaterState Sooloos.Broker.Api.ListenLaterItem::State", 9],
    ["System.DateTime Sooloos.Broker.Api.ListenLaterItem::Timestamp", 8],
    ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.ListenLaterItem::Album", 23]]],
  [L.List, "Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.ListenLaterItem>", []],
];
// 2026-10-21T00:00:00Z in .NET ticks; each item a second after the one before it.
const TICKS = 621355968000000000n + BigInt(Date.UTC(2026, 9, 21)) * 10000n;

/**
 * @param {{ sig: string, r: BinaryReader, rid: number, later: any[], albumOid: (i: number) => bigint, pushAlbum: (i: number) => void,
 *           pushCatalog: (j: number) => bigint, push: (cmd: number, body: Buffer) => void, ok: (rid: number, payload?: Buffer) => void,
 *           refuse: (rid: number, why: string) => void, later_: (fn: () => void) => void, nextOid: () => bigint, rec: any, faults: any,
 *           sent: Set<string> }} c
 * @returns {boolean} whether it was GetListenLater
 */
function handleLater(c) {
  if (!c.sig.includes("GetListenLater")) return false;
  if (c.sig !== SIG) throw new Error("a GetListenLater form the fake does not take: " + c.sig);
  const r = c.r;
  const profile = r.long();
  if (profile !== 2n && profile !== 12n) throw new Error("GetListenLater for an object that is not a profile: " + profile);
  const body = new BinaryReader(r.bytes(r.flexInt()));
  const languages = [];
  for (let n = body.flexInt(); n > 0; n--) languages.push(body.string());
  if (body.pos !== body.buf.length || r.pos !== r.buf.length) throw new Error("bytes after GetListenLater's arguments");
  c.rec.laterAsks.push({ profile: String(profile), languages });
  if (c.faults.refuseLater || (c.faults.refuseEmptyLanguages && !languages.length)) { c.refuse(c.rid, "InvalidArguments"); return true; }
  if (c.faults.laterNotRef) { c.ok(c.rid, new BinaryWriter().string("not a reference").toBuffer()); return true; }

  const oids = (c.later || []).map((x) => ("catalog" in x ? c.pushCatalog(x.catalog) : (c.pushAlbum(x.library), c.albumOid(x.library))));
  const item = (/** @type {bigint} */ oid, /** @type {number} */ k) => {
    const b = new BinaryWriter().flexInt(1).string("Album").flexInt(2).integer(1).flexInt(3).long(TICKS + BigInt(k) * 10000000n)
      .flexInt(4).long(oid).flexInt(0).toBuffer();
    return new BinaryWriter().long(1n).flexInt(L.Item).flexInt(b.length).bytes(b).toBuffer();
  };
  const list = c.faults.sameLaterList ? 97000n : c.nextOid();
  if (c.faults.sameLaterList && c.sent.has(String(list))) { c.ok(c.rid, new BinaryWriter().long(list).toBuffer()); return true; }
  if (c.faults.sameLaterList) c.sent.add(String(list));
  const pushList = () => c.push(3, Buffer.concat([new BinaryWriter().long(list).flexInt(L.List).toBuffer(),
    new BinaryWriter().integer(oids.length).toBuffer(), ...oids.map(item)]));
  const ref = new BinaryWriter().long(list).toBuffer();
  if (c.faults.lateLater) { c.ok(c.rid, ref); c.later_(pushList); return true; }
  pushList();
  c.ok(c.rid, ref);
  return true;
}

const SET_SIG = "Sooloos.Broker.Api.Library::SetListenLaterState(System.Sooid, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>, Sooloos.Broker.Api.ListenLaterState, Base.ResultCallback)";

/**
 * @param {{ sig: string, r: BinaryReader, rid: number, clientTypes: Map<number, any>, later: any[], albums: any[], catalog: any[],
 *           albumIdOf: (i: number) => bigint, ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void,
 *           rec: any, faults: any }} c
 * @returns {boolean} whether it was SetListenLaterState
 */
function handleSetLater(c) {
  if (!c.sig.includes("SetListenLaterState")) return false;
  if (c.sig !== SET_SIG) throw new Error("a SetListenLaterState form the fake does not take: " + c.sig);
  const r = c.r;
  const profile = r.sooid();
  if (!profile.equals(OWNER) && !profile.equals(OTHER)) throw new Error("SetListenLaterState for a profile the fake does not have: " + profile.toString("hex"));
  const ids = readAlbumLinks(r, c.clientTypes);
  const state = r.flexInt();
  if (r.pos !== r.buf.length) throw new Error("bytes after SetListenLaterState's arguments");
  if (state !== 0 && state !== 1 && state !== 2) throw new Error("a ListenLaterState the catalogue does not have: " + state);
  c.rec.laterSets.push({ profile: profile.toString("hex"), albums: ids.map(String), state });
  if (c.faults.refuseLaterSet) { c.refuse(c.rid, "Refused"); return true; }
  if (!c.faults.laterSetIgnored) {
    for (const id of ids) {
      const i = c.albums.findIndex((_a, k) => c.albumIdOf(k) === id);
      const j = Number(id - 8000000000000n);
      const x = i >= 0 ? { library: i } : (c.catalog || [])[j] ? { catalog: j } : null;
      if (!x) throw new Error("SetListenLaterState named an album the fake doesn't have: " + id);
      const at = c.later.findIndex((y) => ("library" in x ? y.library === x.library : y.catalog === x.catalog));
      if (state === 1 && at < 0) c.later.push(x);
      if (state !== 1 && at >= 0) c.later.splice(at, 1);
    }
  }
  c.ok(c.rid);
  return true;
}

module.exports = { handleLater, handleSetLater, LATER_TYPES, TICKS };
