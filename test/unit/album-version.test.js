"use strict";
// An album's version taken off its title for the Shelf's spine (v1.9.68-t2): editions are, records are not.
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitVersion } = require("../../lib/album-version");

test("an edition at the end of a title is its version", () => {
  assert.deepEqual(splitVersion("Abbey Road (Remastered 2009)"), { base: "Abbey Road", version: "Remastered 2009" });
  assert.deepEqual(splitVersion("Rumours [2011 Remaster]"), { base: "Rumours", version: "2011 Remaster" });
  assert.deepEqual(splitVersion("Purple Rain (Deluxe Edition)"), { base: "Purple Rain", version: "Deluxe Edition" });
  assert.deepEqual(splitVersion("Kind of Blue - Legacy Edition"), { base: "Kind of Blue", version: "Legacy Edition" });
  assert.deepEqual(splitVersion("Parachutes (Limited Edition)"), { base: "Parachutes", version: "Limited Edition" });
});

test("several, taken off one by one, in their order", () => {
  assert.deepEqual(splitVersion("The Wall (Super Deluxe) [2011 Remaster]"), { base: "The Wall", version: "Super Deluxe · 2011 Remaster" });
});

test("brackets that are the record's own stay in the title", () => {
  assert.equal(splitVersion("Music for the Masses (Instrumental)"), null);
  assert.equal(splitVersion("(What's the Story) Morning Glory?"), null);
  assert.equal(splitVersion("Untrue"), null);
  assert.equal(splitVersion("Selected Ambient Works 85–92"), null);
  // a version word inside the title, not at its end, is the title's
  assert.equal(splitVersion("The Deluxe Room (Live in Paris)"), null);
});

test("a title that is only a version is left whole, and nothing is nothing", () => {
  assert.equal(splitVersion("(Deluxe Edition)"), null);
  assert.equal(splitVersion(""), null);
  assert.equal(splitVersion(null), null);
});
