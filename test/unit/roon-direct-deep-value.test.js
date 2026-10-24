"use strict";
// ---------------------------------------------------------------------------
// lib/roon-direct/deep-value.js (v1.9.66-t13, native-remote.md §15.13; from push-log.js, t11): a value said in full —
// numbers JSON can't hold as text, references by which object, structs under the server's own names, lists cut at
// DEEP_ITEMS and depth at DEEP, a list's bytes read as its items (focus.js readList), one cut short said so.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { deep, memberName } = require("../../lib/roon-direct/deep-value");

const API = "Sooloos.Broker.Api.";

test("a value in full: −∞ and big numbers as text, a reference by its object, a struct under its own names", () => {
  const g = new ObjectGraph();
  assert.equal(deep(g, "", -Infinity), "-Infinity");
  assert.equal(deep(g, "", 5n), "5");
  assert.deepEqual(deep(g, "", { $ref: 9n }), { ref: "9" });
  assert.deepEqual(deep(g, "", { $type: API + "ParametricEqualizerSpec", [`double ${API}ParametricEqualizerSpec::GainDb`]: -3.1 }),
    { $type: "ParametricEqualizerSpec", GainDb: -3.1 });
  assert.equal(deep(g, "", undefined), null);
  assert.equal(memberName(`double ${API}X::GainDb`), "GainDb");
  assert.equal(memberName("$items"), "$items");
});

test("bounded: a list past DEEP_ITEMS says how many more; past DEEP levels, cut", () => {
  const g = new ObjectGraph();
  const many = Array.from({ length: 40 }, (_, i) => i);
  const out = deep(g, "", many);
  assert.equal(out.length, 33);
  assert.equal(out[32], "… 8 more");
  let nested = 1;
  for (let i = 0; i < 8; i++) nested = [nested];
  assert.equal(JSON.stringify(deep(g, "", nested)), '[[[[[["…"]]]]]]');
});

test("a list's bytes read as its items, each with its members; bytes not a list said by their length; one cut short said so", () => {
  const g = new ObjectGraph();
  g.types.set(50, { id: 50, name: API + "ParametricEqualizerBand", members: [{ name: `double ${API}ParametricEqualizerBand::GainDb`, propType: P.Double }] });
  const band = (db) => { const m = new BinaryWriter().flexInt(1).double(db).flexInt(0).toBuffer();
    return new BinaryWriter().long(1n).integer(50).integer(m.length).bytes(m).toBuffer(); };
  const name = `System.Collections.Generic.IList<${API}ParametricEqualizerBand> ${API}ParametricEqualizerSpec::Bands`;
  const two = new BinaryWriter().integer(2).bytes(band(2)).bytes(band(-1.5)).toBuffer();
  assert.deepEqual(deep(g, name, two), { list: "ParametricEqualizerBand", count: 2,
    items: [{ $type: "ParametricEqualizerBand", GainDb: 2 }, { $type: "ParametricEqualizerBand", GainDb: -1.5 }] });
  const cut = new BinaryWriter().integer(2).bytes(band(2)).toBuffer();
  assert.equal(deep(g, name, cut).whole, false, "a list cut short: said not whole");
  assert.deepEqual(deep(g, "string X::Y", Buffer.from([1, 2, 3])), { bytes: 3 });
});
