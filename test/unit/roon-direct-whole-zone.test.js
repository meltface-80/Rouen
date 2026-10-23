"use strict";
// ---------------------------------------------------------------------------
// v1.9.66-t6 (native-remote.md §15.4–15.6): a push carrying a Zone's ZoneId, or an Endpoint's EndpointId, is the
// whole object, so the graph drops what it leaves out — a member back at its default. Proven on the owner's server
// (two recordings); the frames here are built, so they are not evidence of what a server sends.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P, field } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");

const API = "Sooloos.Broker.Api.";

/** A graph with a Zone (1), an Endpoint (2) and an Album (3) declared. */
function graph() {
  const g = new ObjectGraph();
  g.types.set(1, { id: 1, name: API + "Zone", members: [{ name: `System.Sooid ${API}Zone::ZoneId`, propType: P.Sooid },
    { name: `int ${API}Zone::CrossFade`, propType: P.Int }, { name: `int ${API}Zone::State`, propType: P.Int },
    { name: `string ${API}Zone::Name`, propType: P.String }] });
  g.types.set(2, { id: 2, name: API + "Endpoint", members: [{ name: `System.Sooid ${API}Endpoint::EndpointId`, propType: P.Sooid },
    { name: `double ${API}Endpoint::VolumeDouble`, propType: P.Double }] });
  g.types.set(3, { id: 3, name: API + "Album", members: [{ name: `System.Sooid ${API}Album::AlbumId`, propType: P.Sooid },
    { name: `string ${API}Album::Title`, propType: P.String }] });
  return g;
}
/** A push (cmd 3 PUSHOBJ, 5 UPDATEOBJ) of object `oid` of type `t`, its members [index, write] in order. */
function push(cmd, oid, t, members, cut) {
  const w = new BinaryWriter().long(BigInt(oid)).flexInt(t);
  for (const [i, put] of members) { w.flexInt(i); put(w); }
  const body = w.flexInt(0).toBuffer();
  return { cmd, isResponse: false, body: cut ? body.subarray(0, body.length - cut) : body };
}
const id = (w) => w.sooid(Buffer.from("16aa", "hex"));

test("a whole zone drops what it leaves out: crossfade turned off, State back at playing", () => {
  const g = graph();
  g.ingest(push(3, 10, 1, [[1, id], [2, (w) => w.integer(10)], [3, (w) => w.integer(1)], [4, (w) => w.string("TV")]]));
  const z = g.get(10n), fields = z.fields;
  assert.equal(field(z, "CrossFade"), 10);
  g.ingest(push(5, 10, 1, [[1, id], [4, (w) => w.string("TV")]]));   // whole: CrossFade and State left out
  assert.equal(field(z, "CrossFade"), undefined, "crossfade off");
  assert.equal(field(z, "State"), undefined, "playing, not the Loading before it");
  assert.equal(field(z, "Name"), "TV");
  assert.equal(z.fields, fields, "the same fields object, for a reader holding it");
});

test("the review: the probe's watch and the graph agree on what is whole, whatever the namespace", () => {
  const { isWhole } = require("../../lib/roon-direct/settings-probe");
  const pushed = { [`System.Sooid Roon.Broker.Api.Zone::ZoneId`]: Buffer.from("16aa", "hex") };
  assert.equal(isWhole({ typeName: "Roon.Broker.Api.Zone" }, pushed), true);
  assert.equal(isWhole({ typeName: API + "Zone" }, { [`System.Sooid ${API}Zone::ZoneId`]: Buffer.alloc(2) }), true);
  assert.equal(isWhole({ typeName: API + "Album" }, {}), null, "a type whose identity member isn't known");
});

test("a push without the identity member, a cut-short push, and other types still lay their fields over what is held", () => {
  const g = graph();
  g.ingest(push(3, 10, 1, [[1, id], [2, (w) => w.integer(10)], [4, (w) => w.string("TV")]]));
  g.ingest(push(5, 10, 1, [[3, (w) => w.integer(2)]]));                      // fields alone: kept
  assert.deepEqual([field(g.get(10n), "CrossFade"), field(g.get(10n), "State")], [10, 2]);
  g.ingest(push(5, 10, 1, [[1, id], [4, (w) => w.string("TV2")]], 2));       // its name cut short: not taken for whole
  assert.equal(field(g.get(10n), "CrossFade"), 10);
  g.ingest(push(3, 20, 2, [[1, id], [2, (w) => w.double(12)]]));
  g.ingest(push(5, 20, 2, [[1, id]]));                                     // an endpoint at volume 0
  assert.equal(field(g.get(20n), "VolumeDouble"), undefined);
  g.ingest(push(3, 30, 3, [[1, id], [2, (w) => w.string("Blue")]]));
  g.ingest(push(5, 30, 3, [[1, id]]));                                     // an album: not proven, so merged
  assert.equal(field(g.get(30n), "Title"), "Blue");
});
