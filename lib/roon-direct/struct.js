// @ts-check
"use strict";
/*
 * struct.js — a by-value struct and the lists the calls carry, as the wire takes them (moved out of methods.js in
 * v1.9.70-t3, unchanged): inlineStruct, refList, albumLinks. Nothing here sends anything.
 */
const { BinaryWriter } = require("./wire");
const { ALBUM_LINK } = require("./schemas");

/**
 * A by-value struct: flexLong(1) + flexInt(our type id) + flexInt(length) +
 * (flexInt(1-based member index) + value)* + flexInt(0).
 * @param {{ defineType(name: string, members: ReadonlyArray<{ name: string, propType: number }>): number }} remoting
 *   the remoting client, or the guard around it
 * @param {{ name: string, members: ReadonlyArray<[string, number]> }} schema
 * @param {Array<[string, Buffer]>} values  [full member name, encoded value]
 */
function inlineStruct(remoting, schema, values) {
  const typeId = remoting.defineType(schema.name, schema.members.map(([name, propType]) => ({ name, propType })));
  const body = new BinaryWriter();
  for (const [name, value] of values) {
    const i = schema.members.findIndex(([n]) => n === name);
    if (i < 0) throw new Error(`${schema.name} has no member ${name}`);
    body.flexInt(i + 1).bytes(value);
  }
  body.flexInt(0);
  const b = body.toBuffer();
  return new BinaryWriter().long(1).flexInt(typeId).flexInt(b.length).bytes(b).toBuffer();
}

/**
 * An IList of by-reference objects as a LengthPrefixed struct member:
 * flexInt(length) + [flexInt(count) + flexLong(object id) each]. The framing
 * is the one run live upstream (Library::Edit); each element as a bare
 * object id is how the official client's captured collection ARGUMENTS
 * carry by-reference objects. That a struct member's list reads its
 * elements the same way is this design's reading, first tried by the
 * Locations probe.
 * @param {bigint[]} oids
 */
function refList(oids) {
  const inner = new BinaryWriter().flexInt(oids.length);
  for (const oid of oids) inner.long(oid);
  const b = inner.toBuffer();
  return new BinaryWriter().integer(b.length).bytes(b).toBuffer();
}

/**
 * A collection of albums as hearts name them: flexInt(count), then an inline AlbumLink { AlbumId, Broker } each.
 * @param {Parameters<typeof inlineStruct>[0]} g @param {bigint} brokerOid @param {bigint[]} albumIds
 */
function albumLinks(g, brokerOid, albumIds) {
  const inner = new BinaryWriter().flexInt(albumIds.length);
  for (const id of albumIds) {
    inner.bytes(inlineStruct(g, ALBUM_LINK, [
      ["long Sooloos.Broker.Api.AlbumLink::AlbumId", new BinaryWriter().long(id).toBuffer()],
      ["Sooloos.Broker.Api.Broker Sooloos.Broker.Api.AlbumLink::Broker", new BinaryWriter().long(brokerOid).toBuffer()],
    ]));
  }
  return inner.toBuffer();
}

module.exports = { inlineStruct, refList, albumLinks };
