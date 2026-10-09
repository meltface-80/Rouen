"use strict";
// v1.9.3: where Smart Picks go when nobody has chosen is Nowhere ("ask"), at
// the user's word. A choice made in the menu or the older switch is kept.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const { smartPicksDestFrom } = loadIndexFunctions(["smartPicksDestFrom", "smartPicksDests"]);

test("Smart Picks go Nowhere unless someone chose otherwise (v1.9.3)", async (t) => {
  await t.test("THE one: a fresh install sends picks nowhere", () => {
    assert.equal(smartPicksDestFrom({}), "ask");
  });
  await t.test("a destination chosen in the menu is kept, whichever it is", () => {
    for (const d of ["library", "later", "ask"]) assert.equal(smartPicksDestFrom({ smartPicksDest: d }), d);
  });
  await t.test("the old switch, set either way, is kept", () => {
    assert.equal(smartPicksDestFrom({ smartPicksAutoAdd: true }), "library");
    assert.equal(smartPicksDestFrom({ smartPicksAutoAdd: false }), "ask");
  });
  await t.test("a value no version wrote is not trusted", () => {
    assert.equal(smartPicksDestFrom({ smartPicksDest: "everywhere" }), "ask");
  });
});
