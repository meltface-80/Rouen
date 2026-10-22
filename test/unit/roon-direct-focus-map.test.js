"use strict";
// ---------------------------------------------------------------------------
// The mapping (lib/roon-direct/focus-map.js; native-remote.md §12.7.1, and
// §12.15 from v1.9.60): a Dynamic Playlist as a Roon album Focus — every
// filter Roon can hold, with Roon's own data behind it; the album limit
// dropped, said — or every part that stops it, named.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mapFocus, nullDate } = require("../../lib/roon-direct/focus-map");

const sp = (view, o = {}) => Object.assign({ name: "Folk", view: Object.assign({ sort: "album", dir: "asc", seed: 7, played: "any", genre: ["Folk"] }, view), limit: 100 }, o);
const NONE = { dates: null, formats: { require: [], exclude: [] }, rates: { require: [], exclude: [] }, bits: { require: [], exclude: [] },
  labels: { require: [], exclude: [] }, played: { require: null, exclude: null }, imported: { require: null, exclude: null } };

test("genres in and out, each sort that maps with its direction, Random with Rouen's seed", () => {
  assert.deepEqual(mapFocus(sp({ genre: ["Folk", "Blues", "!Pop"] }), 40, null),
    { focus: { include: ["Folk", "Blues"], exclude: ["Pop"], ordering: 4, direction: 1, seed: null, sort: "album", extra: NONE }, notes: [] });
  assert.deepEqual(["album", "artist", "year", "random", "added"].map((sort) => mapFocus(sp({ sort, dir: "desc" }), 40, null).focus.ordering),
    [4, 0, 2, 7, 1]);
  assert.equal(mapFocus(sp({ dir: "desc" }), 40, null).focus.direction, 2);
  assert.equal(mapFocus(sp({ sort: "random" }), 40, null).focus.seed, 7);
  assert.deepEqual(mapFocus(sp({}, { order: "random" }), 40, null).notes, ["Rouen plays it in random order: in Roon, play it with Shuffle."]);
  assert.deepEqual(mapFocus(sp({ genre: [] }), 40, null).focus.include, [], "a playlist of no genre is a Focus of the whole library");
});

test("§12.15: the album limit never stops it — Roon holds all, said", () => {
  assert.deepEqual(mapFocus(sp({}), 100, null).notes, []);
  assert.deepEqual(mapFocus(sp({ decade: ["1970"], genre: [] }, { name: "1970", limit: 25 }), 382, null).notes,
    ["Roon's smart playlists have no album limit: Roon holds all 382 albums it matches, not 25."]);
  assert.deepEqual(mapFocus(sp({}), null, null).notes, ["Roon's smart playlists have no album limit: Roon holds every album it matches, not 100."]);
});

test("§12.15: Decade as one date range — the owner's 1970 as Roon wrote it; side by side as one; a gap or an exclusion stops it", () => {
  const one = mapFocus(sp({ decade: ["1970"] }), 40, null).focus.extra.dates;
  assert.deepEqual(one, { min: 129105920, max: 129698847 }, "not the owner's 'roon track 1970' (§12.12)");
  assert.deepEqual(mapFocus(sp({ decade: ["1990", "1980"] }), 40, null).focus.extra.dates, { min: nullDate(1980, 0, 0), max: nullDate(1999, 12, 31) });
  assert.match(mapFocus(sp({ decade: ["1970", "1990"] }), 40, null).why[0], /Decade filter: decades with a gap/);
  assert.match(mapFocus(sp({ decade: ["!1970"] }), 40, null).why[0], /Decade filter: an excluded decade/);
});

test("§12.15: Source and Format as Roon's file formats; the rest as Roon's own lists and day counts", () => {
  const x = (view) => mapFocus(sp(view), 40, null).focus.extra;
  assert.deepEqual(x({ source: ["qobuz", "tidal"] }).formats, { require: [15, 12], exclude: [] });
  assert.deepEqual(x({ source: ["local"], format: ["FLAC", "!MPEG"] }).formats, { require: [1], exclude: [15, 12, 17, 4] });
  assert.deepEqual(x({ source: ["!qobuz"] }).formats, { require: [], exclude: [15] });
  // The review: Local or Qobuz; everything but Local and Qobuz — one list each, never refused as a contradiction.
  assert.deepEqual(x({ source: ["local", "qobuz"] }).formats, { require: [], exclude: [12, 17] });
  assert.deepEqual(x({ source: ["!local", "!qobuz"] }).formats, { require: [12], exclude: [] });
  assert.deepEqual(x({ source: ["local", "qobuz", "tidal"] }).formats, { require: [], exclude: [17] });
  assert.deepEqual(x({ format: ["DSF", "DSDIFF", "WAVE", "AIFF", "OGG"] }).formats, { require: [13, 14, 5, 7, 6], exclude: [] });
  assert.deepEqual(x({ rate: ["96000", "!44100"], bits: ["24"] }).rates, { require: [96000], exclude: [44100] });
  assert.deepEqual(x({ bits: ["24", "!16"] }).bits, { require: [24], exclude: [16] });
  assert.deepEqual(x({ label: ["Stax", "!Motown"] }).labels, { require: ["Stax"], exclude: ["Motown"] });
  assert.deepEqual(x({ added: ["30", "7", "!365"] }).imported, { require: 30, exclude: 365 }, "not the widest window of each");
  assert.deepEqual(["never", "played", "6", "12"].map((played) => x({ played }).played),
    [{ require: null, exclude: 36500 }, { require: 36500, exclude: null }, { require: null, exclude: 180 }, { require: null, exclude: 360 }]);
});

test("what Roon can't hold stops it, each part named", () => {
  const all = mapFocus(sp({ chan: ["2"], letter: ["A"], sort: "lastplayed", format: ["MP4"], rate: ["x"] }), 40, "Labels is off.");
  assert.deepEqual(all.why, ["Labels is off.", "its Channels filter (Roon's channel layout names aren't known)",
    "its Starts with filter (Roon has no first-letter filter)", "its Last played order (Roon has no such album order)",
    "its Source or Format filter: the format \"MP4\" (Rouen doesn't know which of Roon's formats it is)", "its Sample rate filter: a rate Rouen doesn't know"]);
  assert.match(mapFocus(sp({ sort: "plays" }), 40, null).why[0], /Most played order \(which way Roon's runs isn't known yet\)/);
  assert.match(mapFocus(sp({ source: ["qobuz"], format: ["FLAC"] }), 40, null).why[0], /a format together with a streaming source/);
  assert.match(mapFocus(sp({ source: ["!local", "!qobuz", "!tidal"] }), 40, null).why[0], /no source left/);
  assert.deepEqual(mapFocus(sp({ played: "sometimes" }), 40, null).why, ["its Played filter (\"sometimes\", which Rouen doesn't know)"]);
});
