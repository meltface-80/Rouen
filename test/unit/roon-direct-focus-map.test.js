"use strict";
// ---------------------------------------------------------------------------
// N2e-2b's mapping (lib/roon-direct/focus-map.js, v1.9.53, native-remote.md
// §12.7.1): a Dynamic Playlist as a Roon album Focus — only what maps exactly
// — or every part that stops it, named (the owner, §12.6).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mapFocus } = require("../../lib/roon-direct/focus-map");

const sp = (view, o = {}) => Object.assign({ name: "Folk", view: Object.assign({ sort: "album", dir: "asc", seed: 7, played: "any", genre: ["Folk"] }, view), limit: 100 }, o);

test("genres in and out, each sort that maps exactly with its direction, Random with Rouen's seed", () => {
  assert.deepEqual(mapFocus(sp({ genre: ["Folk", "Blues", "!Pop"] }), 40, null),
    { focus: { include: ["Folk", "Blues"], exclude: ["Pop"], ordering: 4, direction: 1, seed: null, sort: "album" }, notes: [] });
  assert.deepEqual(["album", "artist", "year", "random"].map((sort) => mapFocus(sp({ sort, dir: "desc" }), 40, null).focus.ordering), [4, 0, 2, 7]);
  assert.equal(mapFocus(sp({ dir: "desc" }), 40, null).focus.direction, 2);
  assert.equal(mapFocus(sp({ sort: "random" }), 40, null).focus.seed, 7);
  assert.deepEqual(mapFocus(sp({}, { order: "random" }), 40, null).notes, ["Rouen plays it in random order: in Roon, play it with Shuffle."]);
});

test("the album limit stops it only when it cuts", () => {
  assert.ok("focus" in mapFocus(sp({}), 100, null));
  assert.deepEqual(mapFocus(sp({}), 340, null).why, ["its album limit (Rouen plays 100 of the 340 albums it matches; Roon's would hold all 340)"]);
  assert.match(mapFocus(sp({}), null, null).why[0], /library isn't read yet/);
});

test("everything else stops it, each part named: facets, played, the sorts Rouen's own data drives, no genre, unavailable", () => {
  const all = mapFocus(sp({ source: ["local"], decade: ["1970"], label: ["Stax"], format: ["FLAC"], rate: ["96000"], bits: ["24"], chan: ["2"],
    letter: ["A"], added: ["30"], played: "never", sort: "plays", genre: [] }), 40, "Labels is off.");
  assert.deepEqual(all.why, ["Labels is off.", "its Source filter (not made in Roon by this test)", "its Decade filter (not made in Roon by this test)",
    "its Label filter (not made in Roon by this test)", "its Format filter (not made in Roon by this test)", "its Sample rate filter (not made in Roon by this test)",
    "its Bit depth filter (not made in Roon by this test)", "its Channels filter (not made in Roon by this test)", "its First letter filter (not made in Roon by this test)",
    "its Recently added filter (not made in Roon by this test)", "its Played filter (Rouen's play history is what Rouen saw, not Roon's)",
    "its Most played order (Rouen's play counts are its own, not Roon's)", "no genre (this test makes a Dynamic Playlist of genres)"]);
  assert.match(mapFocus(sp({ sort: "added" }), 40, null).why[0], /Recently added order/);
  assert.match(mapFocus(sp({ sort: "lastplayed" }), 40, null).why[0], /Last played order/);
});
