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
// length prefix). Not evidence of how the real server answers, nor of how it
// declares these structs' members: the probe exists to find that out.
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { strList } = require("../../lib/roon-direct/focus-write");

const SIG = "Sooloos.Broker.Api.Library::GetMultiAlbumEditInfo(Sooloos.Broker.Api.AlbumEditInfoParameters, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumEditInfo>>)";
const E = { Info: 80, OptType: 81, OptBool: 82, OptStr: 83, ListStr: 84, ReqStr: 85 };   // clear of the core's, the search's (40s), Listen Later's (50s), the playlists' (60s) and transport's (70s)
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
    [`${A}EditOptionalRefInfo<string> ${A}AlbumEditInfo::CatalogNumber`, 23]]],
  [E.OptType, `${A}EditOptionalValInfo<${A}AlbumType>`, optional("EditOptionalValInfo`1", 19)],
  [E.OptBool, `${A}EditOptionalValInfo<bool>`, optional("EditOptionalValInfo`1", 12)],
  [E.OptStr, `${A}EditOptionalRefInfo<string>`, optional("EditOptionalRefInfo`1", 20)],
  [E.ReqStr, `${A}EditRequiredRefInfo<string>`, optional("EditRequiredRefInfo`1", 20).filter(([n]) => !n.includes("ClearBase"))],
  [E.ListStr, `${A}EditListInfo<string>`, [["LocalValues", 24], ["MetadataValues", 24], ["BaseValues", 24], ["ClearBaseValues", 2], ["BasePreferLocalValues", 2],
    ["PreferLocalValues", 12], ["AddValues", 24], ["RemoveValues", 24], ["Values", 24], ["HasLocalLayer", 2], ["HasMetadataLayer", 2], ["HasEditLayer", 2]]
    .map(([n, q]) => [`${q === 24 ? "System.Collections.Generic.IList<string>" : "bool"} ${A}EditListInfo\`1::${n}`, q])],
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
 * @param {{ sig: string, r: BinaryReader, rid: number, clientTypes: Map<number, any>, albums: any[], editInfo: any[] | undefined,
 *           albumOid: (i: number) => bigint, ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void,
 *           rec: any, faults: any }} c
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
      w.flexInt(idx(E.Info, "Album")).long(oid);
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

module.exports = { handleEditInfo, EDIT_TYPES };
