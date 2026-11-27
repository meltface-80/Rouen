"use strict";
// ---------------------------------------------------------------------------
// An album's title without its edition (lib/album-edition.js, 2.0.8-t11). The owner, 2026-11-27: "Need to normalise
// the search. Remove things like 25th edition etc and then it finds it" — Roon's search found nothing for The
// Chameleons' "Script Of The Bridge - 25th Anniversary Edition", and the album for "Script Of The Bridge".
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { withoutEdition } = require("../../lib/album-edition");

test("THE one for the owner: an edition after a dash goes, as one in brackets does", () => {
  assert.equal(withoutEdition("Script Of The Bridge - 25th Anniversary Edition"), "Script Of The Bridge");
  assert.equal(withoutEdition("Pink Flag (2006 Remastered Version)"), "Pink Flag");
  assert.equal(withoutEdition("Ledbetter Heights (30th Anniversary Sessions)"), "Ledbetter Heights");
  assert.equal(withoutEdition("Rumours [Super Deluxe]"), "Rumours");
});

test("both, and more than one, in either order", () => {
  assert.equal(withoutEdition("Disintegration - Deluxe Edition (Remastered)"), "Disintegration");
  assert.equal(withoutEdition("Hounds of Love (2018 Remaster) - Expanded"), "Hounds of Love");
  assert.equal(withoutEdition("Kind of Blue (Legacy Edition) [Mono]"), "Kind of Blue");
});

test("a dash that isn't an edition stays: another record, or the title itself", () => {
  assert.equal(withoutEdition("Selected Ambient Works - Volume II"), "Selected Ambient Works - Volume II");
  assert.equal(withoutEdition("Live - Part Two"), "Live - Part Two");
  assert.equal(withoutEdition("Up the Bracket"), "Up the Bracket");
  assert.equal(withoutEdition("Mono"), "Mono", "a title that is all edition word kept whole");
  assert.equal(withoutEdition("(What's the Story) Morning Glory?"), "(What's the Story) Morning Glory?");
  assert.equal(withoutEdition("(Untitled)"), "(Untitled)", "nothing left: the title as it was");
  assert.equal(withoutEdition(""), "");
  assert.equal(withoutEdition(null), "");
});
