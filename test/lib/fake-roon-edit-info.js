"use strict";
// ---------------------------------------------------------------------------
// The fake server's album edit info (t3, v1.9.67-t3, dev/design/catalogue.md §4):
// Library::GetMultiAlbumEditInfo, its one argument read strictly (an inline
// AlbumEditInfoParameters as the client declared it: the albums as a
// LengthPrefixed collection of the connection's objects, the languages as one
// of strings), answered BY VALUE with a LengthPrefixed collection of inline
// AlbumEditInfo structs — each naming its album by reference and carrying
// Title, Type, IsLive, IsBootleg, IsCompilation, Labels and CatalogNumber as
// the catalogue's Edit*Info structs, sparse: only what is set is sent.
//
// o.editInfo: by album index, { type, live, bootleg, compilation, labels, catno,
// localCatno, metadataLabels }; an album not listed gets an AlbumEditInfo with
// its Album and Title alone. Faults: refuseEditInfo (every form refused),
// editInfoRefuseEmptyLanguages (no languages refused), editInfoNotList (an
// answer that is not a collection), editInfoBare (the collection without its
// length prefix), editInfoMisnamed (the first item names an album not asked
// about). Credits (v1.9.70-t1, dev/design/album-credits.md §2.1): an album's
// `credits` [{ role, type, name }] ride its AlbumEditInfo, and its `trackCredits`
// (one list a track) answer Library::GetTrackEditInfo(AlbumBase), the album's
// object id its one argument, each performer pushed first as a PerformerLite
// (`unnamedPerformer`: one pushed without its Name). Faults: refuseTrackEditInfo.
// about). Not evidence of how the real server answers, nor of how it
// declares these structs' members: the probe exists to find that out.
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { strList } = require("../../lib/roon-direct/focus-write");

const SIG = "Sooloos.Broker.Api.Library::GetMultiAlbumEditInfo(Sooloos.Broker.Api.AlbumEditInfoParameters, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumEditInfo>>)";
const E = { Info: 80, OptType: 81, OptBool: 82, OptStr: 83, ListStr: 84, ReqStr: 85, Track: 86, Credit: 87, ListCredit: 88, ReqInt: 89, Performer: 90 };   // clear of the core's, the search's (40s), Listen Later's (50s), the playlists' (60s) and transport's (70s)
const A = "Sooloos.Broker.Api.";
/** The catalogue's members, each with a property type the fake chooses (the real server's are unknown). */
const optional = (/** @type {string} */ t, /** @type {number} */ p) => [["LocalValue", p], ["MetadataValue", p], ["BaseValue", p], ["ClearBaseValue", 2], ["BasePreferLocalValue", 2],
  ["PreferLocalValue", 12], ["EditValue", p], ["Value", p], ["HasLocalLayer", 2], ["HasMetadataLayer", 2], ["HasEditLayer", 2]].map(([n, q]) => [`${p === 20 ? "string" : p === 12 ? "bool?" : A + "AlbumType?"} ${A}${t}::${n}`, q]);
const EDIT_TYPES = [
  [E.Info, A + "AlbumEditInfo", [
    [`${A}AlbumLite ${A}AlbumEditInfo::Album`, 23],
    [`${A}EditRequiredRefInfo<string> ${A}AlbumEditInfo::Title`, 23],
    [`${A}EditOptionalValInfo<bool> ${A}AlbumEditInfo::IsCompilation`, 23],
    [`${A}EditOptionalValInfo<bool> ${A}AlbumEditInfo::IsLive`, 23],
    [`${A}EditOptionalValInfo<bool> ${A}AlbumEditInfo::IsBootleg`, 23],
    [`${A}EditOptionalValInfo<${A}AlbumType> ${A}AlbumEditInfo::Type`, 23],
    [`${A}EditListInfo<string> ${A}AlbumEditInfo::Labels`, 23],
    [`${A}EditOptionalRefInfo<string> ${A}AlbumEditInfo::CatalogNumber`, 23],
    [`${A}EditListInfo<${A}Credit> ${A}AlbumEditInfo::Credits`, 23]]],
  [E.OptType, `${A}EditOptionalValInfo<${A}AlbumType>`, optional("EditOptionalValInfo`1", 19)],
  [E.OptBool, `${A}EditOptionalValInfo<bool>`, optional("EditOptionalValInfo`1", 12)],
  [E.OptStr, `${A}EditOptionalRefInfo<string>`, optional("EditOptionalRefInfo`1", 20)],
  [E.ReqStr, `${A}EditRequiredRefInfo<string>`, optional("EditRequiredRefInfo`1", 20).filter(([n]) => !n.includes("ClearBase"))],
  [E.ListStr, `${A}EditListInfo<string>`, [["LocalValues", 24], ["MetadataValues", 24], ["BaseValues", 24], ["ClearBaseValues", 2], ["BasePreferLocalValues", 2],
    ["PreferLocalValues", 12], ["AddValues", 24], ["RemoveValues", 24], ["Values", 24], ["HasLocalLayer", 2], ["HasMetadataLayer", 2], ["HasEditLayer", 2]]
    .map(([n, q]) => [`${q === 24 ? "System.Collections.Generic.IList<string>" : "bool"} ${A}EditListInfo\`1::${n}`, q])],
  [E.Track, A + "TrackEditInfo", [
    [`${A}EditRequiredValInfo<int> ${A}TrackEditInfo::TrackNumber`, 23],
    [`${A}EditRequiredValInfo<int> ${A}TrackEditInfo::MediaNumber`, 23],
    [`${A}EditListInfo<${A}Credit> ${A}TrackEditInfo::Credits`, 23]]],
  [E.Credit, A + "Credit", [[`string ${A}Credit::Role`, 20], [`${A}CreditType ${A}Credit::Type`, 9], [`${A}PerformerLite ${A}Credit::Performer`, 23]]],
  [E.ListCredit, `${A}EditListInfo<${A}Credit>`, [["LocalValues", 24], ["Values", 24], ["HasLocalLayer", 2]]
    .map(([n, q]) => [`${q === 24 ? `System.Collections.Generic.IList<${A}Credit>` : "bool"} ${A}EditListInfo\`1::${n}`, q])],
  [E.ReqInt, `${A}EditRequiredValInfo<int>`, [[`int ${A}EditRequiredValInfo\`1::Value`, 0], [`bool ${A}EditRequiredValInfo\`1::HasMetadataLayer`, 2]]],
  [E.Performer, A + "PerformerLite", [[`string ${A}PerformerLite::Name`, 20]]],
];

/** An inline struct: marker 1, the type, its length, then (index, value)* and 0. @param {number} tid @param {(w: BinaryWriter) => void} fill */
function inline(tid, fill) {
  const w = new BinaryWriter();
  fill(w);
  const b = w.flexInt(0).toBuffer();
  return new BinaryWriter().long(1n).flexInt(tid).flexInt(b.length).bytes(b).toBuffer();
}
/** The member index of a short name in a type's members. @param {number} tid @param {string} name */
const idx = (tid, name) => EDIT_TYPES.find(([id]) => id === tid)[2].findIndex(([n]) => n.endsWith("::" + name)) + 1;
/**
 * An EditListInfo<Credit>: its Values a LengthPrefixed list (a count, then each Credit inline), each performer pushed
 * first by its object. @param {Array<{ role?: string, type?: number, name: string }>} credits
 * @param {(name: string) => bigint} performer  the PerformerLite's object id, pushed to the client
 */
function creditList(credits, performer) {
  const list = new BinaryWriter().flexInt(credits.length);
  for (const cr of credits) {
    const oid = performer(cr.name);
    list.bytes(inline(E.Credit, (x) => {
      if (cr.role !== undefined) x.flexInt(idx(E.Credit, "Role")).string(cr.role);
      if (cr.type !== undefined) x.flexInt(idx(E.Credit, "Type")).integer(cr.type);
      x.flexInt(idx(E.Credit, "Performer")).long(oid);
    }));
  }
  const b = list.toBuffer();
  return inline(E.ListCredit, (x) => { x.flexInt(idx(E.ListCredit, "Values")).integer(b.length).bytes(b); });
}

/**
 * @param {{ sig: string, r: BinaryReader, rid: number, clientTypes: Map<number, any>, albums: any[], editInfo: any[] | undefined,
 *           albumOid: (i: number) => bigint, ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void,
 *           rec: any, faults: any, performer: (name: string) => bigint }} c
 * @returns {boolean} whether it was GetMultiAlbumEditInfo
 */
function handleEditInfo(c) {
  if (!c.sig.includes("GetMultiAlbumEditInfo")) return false;
  if (c.sig !== SIG) throw new Error("a GetMultiAlbumEditInfo form the fake does not take: " + c.sig);
  const r = c.r;
  if (r.long() !== 1n) throw new Error("AlbumEditInfoParameters not sent as an inline value");
  const t = c.clientTypes.get(r.flexInt());
  if (!t || t.name !== A + "AlbumEditInfoParameters" || t.members.length !== 2) throw new Error("not the AlbumEditInfoParameters type as declared: " + JSON.stringify(t));
  const body = new BinaryReader(r.bytes(r.flexInt()));
  /** @type {bigint[]} */ const oids = [];
  /** @type {string[]} */ const languages = [];
  for (let i = body.flexInt(); i !== 0; i = body.flexInt()) {
    const [name, prop] = t.members[i - 1];
    if (prop !== 24) throw new Error("a member not declared LengthPrefixed: " + name);
    const list = new BinaryReader(body.bytes(body.integer()));
    if (name.endsWith("::Albums")) for (let n = list.flexInt(); n > 0; n--) oids.push(list.long());
    else if (name.endsWith("::LanguagePreferences")) for (let n = list.flexInt(); n > 0; n--) languages.push(list.string());
    else throw new Error("an AlbumEditInfoParameters member the fake does not expect: " + name);
    if (list.pos !== list.buf.length) throw new Error("bytes after the elements of " + name);
  }
  if (body.pos !== body.buf.length || r.pos !== r.buf.length) throw new Error("bytes after GetMultiAlbumEditInfo's argument");
  c.rec.editInfoAsks.push({ albums: oids.map(String), languages });
  if (c.faults.refuseEditInfo || (c.faults.editInfoRefuseEmptyLanguages && !languages.length)) { c.refuse(c.rid, "InvalidArguments"); return true; }
  if (c.faults.editInfoNotList) { c.ok(c.rid, new BinaryWriter().string("not a collection").toBuffer()); return true; }

  const items = oids.map((oid) => {
    const i = c.albums.findIndex((_a, k) => c.albumOid(k) === oid);
    if (i < 0) throw new Error("GetMultiAlbumEditInfo named an album the fake doesn't have: " + oid);
    const e = (c.editInfo || [])[i];
    return inline(E.Info, (w) => {
      // editInfoMisnamed: the first item names an album the call never asked about (a reordered or short answer).
      w.flexInt(idx(E.Info, "Album")).long(c.faults.editInfoMisnamed && oid === oids[0] ? oid + 1000n : oid);
      w.flexInt(idx(E.Info, "Title")).bytes(inline(E.ReqStr, (x) => { x.flexInt(idx(E.ReqStr, "Value")).string(c.albums[i].title).flexInt(idx(E.ReqStr, "HasMetadataLayer")).boolean(true); }));
      if (!e) return;
      const flag = (/** @type {string} */ name, /** @type {boolean | undefined} */ v) => {
        if (v === undefined) return;
        w.flexInt(idx(E.Info, name)).bytes(inline(E.OptBool, (x) => { x.flexInt(idx(E.OptBool, "Value")).boolean(v).flexInt(idx(E.OptBool, "HasMetadataLayer")).boolean(true); }));
      };
      flag("IsCompilation", e.compilation); flag("IsLive", e.live); flag("IsBootleg", e.bootleg);
      if (e.type !== undefined) w.flexInt(idx(E.Info, "Type")).bytes(inline(E.OptType, (x) => { x.flexInt(idx(E.OptType, "Value")).boolean(true).integer(e.type).flexInt(idx(E.OptType, "HasMetadataLayer")).boolean(true); }));
      if (e.labels) {
        w.flexInt(idx(E.Info, "Labels")).bytes(inline(E.ListStr, (x) => {
          x.flexInt(idx(E.ListStr, "Values")).bytes(strList(e.labels));
          if (e.metadataLabels) x.flexInt(idx(E.ListStr, "MetadataValues")).bytes(strList(e.metadataLabels)).flexInt(idx(E.ListStr, "HasMetadataLayer")).boolean(true);
        }));
      }
      if (e.credits) w.flexInt(idx(E.Info, "Credits")).bytes(creditList(e.credits, c.performer));
      if (e.catno !== undefined) {
        w.flexInt(idx(E.Info, "CatalogNumber")).bytes(inline(E.OptStr, (x) => {
          x.flexInt(idx(E.OptStr, "Value")).string(e.catno);
          if (e.localCatno !== undefined) x.flexInt(idx(E.OptStr, "LocalValue")).string(e.localCatno).flexInt(idx(E.OptStr, "HasLocalLayer")).boolean(true);
          x.flexInt(idx(E.OptStr, "HasMetadataLayer")).boolean(true);
        }));
      }
    });
  });
  const bare = Buffer.concat([new BinaryWriter().flexInt(items.length).toBuffer(), ...items]);
  c.ok(c.rid, c.faults.editInfoBare ? bare : Buffer.concat([new BinaryWriter().integer(bare.length).toBuffer(), bare]));
  return true;
}

const TRACK_SIG = "Sooloos.Broker.Api.Library::GetTrackEditInfo(Sooloos.Broker.Api.AlbumBase, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.TrackEditInfo>>)";

/**
 * Library::GetTrackEditInfo(AlbumBase): the album's object id, read strictly; every track's TrackEditInfo by value.
 * @param {{ sig: string, r: BinaryReader, rid: number, albums: any[], editInfo: any[] | undefined, albumOid: (i: number) => bigint,
 *           performer: (name: string) => bigint, ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void,
 *           rec: any, faults: any }} c
 * @returns {boolean} whether it was GetTrackEditInfo
 */
function handleTrackEditInfo(c) {
  if (!c.sig.includes("GetTrackEditInfo")) return false;
  if (c.sig !== TRACK_SIG) throw new Error("a GetTrackEditInfo form the fake does not take: " + c.sig);
  const oid = c.r.long();
  if (c.r.pos !== c.r.buf.length) throw new Error("bytes after GetTrackEditInfo's album");
  const i = c.albums.findIndex((_a, k) => c.albumOid(k) === oid);
  if (i < 0) throw new Error("GetTrackEditInfo named an album the fake doesn't have: " + oid);
  c.rec.trackEditInfoAsks.push(String(oid));
  if (c.faults.refuseTrackEditInfo) { c.refuse(c.rid, "InvalidArguments"); return true; }
  const lists = ((c.editInfo || [])[i] || {}).trackCredits || [];
  const num = (/** @type {number} */ n) => inline(E.ReqInt, (x) => { x.flexInt(idx(E.ReqInt, "Value")).integer(n); });
  // Sent last track first: the client puts them in the album's order by their numbers.
  const items = lists.map((credits, k) => inline(E.Track, (w) => {
    w.flexInt(idx(E.Track, "TrackNumber")).bytes(num(k + 1)).flexInt(idx(E.Track, "MediaNumber")).bytes(num(1));
    w.flexInt(idx(E.Track, "Credits")).bytes(creditList(credits, c.performer));
  })).reverse();
  const bare = Buffer.concat([new BinaryWriter().flexInt(items.length).toBuffer(), ...items]);
  c.ok(c.rid, Buffer.concat([new BinaryWriter().integer(bare.length).toBuffer(), bare]));
  return true;
}

module.exports = { handleEditInfo, handleTrackEditInfo, EDIT_TYPES };
