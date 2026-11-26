"use strict";
// ---------------------------------------------------------------------------
// A ProfileData<bool> read (lib/roon-direct/profile-data.js, native-remote.md
// §8.2): an album's or track's IsFavorite, one value per Roon profile. What it
// shows must be the Core's answer for the profile Rouen acts for, or nothing.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { profileBool, profileBools, sameHearts } = require("../../lib/roon-direct/profile-data");

const ME = Buffer.from("123f01162027273a55d64bbf4a85f335410e2f", "hex");
const OTHER = Buffer.from("aa3f01162027273a55d64bbf4a85f335410e2f", "hex");
/** count, then (length + id + 0/1) per entry — lengths and counts under 128 are one byte. */
const body = (...entries) => Buffer.concat([Buffer.from([entries.length]),
  ...entries.map(([id, v]) => Buffer.concat([Buffer.from([id.length]), id, Buffer.from([v])]))]);

test("THE one: the value for Rouen's profile, not another's", () => {
  assert.equal(profileBool(body([OTHER, 0], [ME, 1]), ME), true);
  assert.equal(profileBool(body([OTHER, 1], [ME, 0]), ME), false, "another profile's heart was shown as this one's");
  assert.equal(profileBool(body([OTHER, 1]), ME), false, "no entry for the profile is not a favourite");
  assert.equal(profileBool(body(), ME), false);
});

test("anything that does not parse exactly is no answer, never a guess", () => {
  const good = body([ME, 1]);
  assert.equal(profileBool(good.subarray(0, good.length - 1), ME), undefined, "cut short");
  assert.equal(profileBool(Buffer.concat([good, Buffer.from([0])]), ME), undefined, "bytes left over");
  assert.equal(profileBool(body([ME, 2]), ME), undefined, "a value that is not 0 or 1");
  assert.equal(profileBool(Buffer.from([100, 1, 1]), ME), undefined, "a count the body cannot hold");
  assert.equal(profileBool(undefined, ME), undefined, "the member never came");
  assert.equal(profileBool(true, ME), undefined, "a plain bool is not this encoding");
});

// 2.0.7-t4 (profiles.md §5): every profile's at once, for a device linked to a Roon profile other than the chosen one.
test("every profile's value from one read, by hex id; the same refusals", () => {
  assert.deepEqual(profileBools(body([OTHER, 1], [ME, 0])), { [OTHER.toString("hex")]: true, [ME.toString("hex")]: false });
  assert.deepEqual(profileBools(body([ME, 1], [ME, 0])), { [ME.toString("hex")]: true }, "the first entry for a profile is its value");
  assert.deepEqual(profileBools(body()), {});
  const good = body([ME, 1]);
  assert.equal(profileBools(good.subarray(0, good.length - 1)), undefined, "cut short");
  assert.equal(profileBools(Buffer.concat([good, Buffer.from([0])])), undefined, "bytes left over");
  assert.equal(profileBools(body([OTHER, 1], [ME, 2])), undefined, "a value that is not 0 or 1, after a good one");
  assert.equal(profileBools(undefined), undefined);
  assert.equal(profileBool(body([ME, 1]), /** @type {any} */ ("not a buffer")), undefined, "no profile id: no answer");
});

test("the review of 2.0.7-t4: two reads give the same hearts whatever their order, and false is the same as left out", () => {
  assert.equal(sameHearts({ a: true, b: true }, { b: true, a: true }), true, "the order of the profiles counted");
  assert.equal(sameHearts({}, { a: false }), true, "a profile said false counted as a change");
  assert.equal(sameHearts(null, undefined), true);
  assert.equal(sameHearts({ a: true }, { a: false }), false);
  assert.equal(sameHearts({ a: true }, { b: true }), false);
});
