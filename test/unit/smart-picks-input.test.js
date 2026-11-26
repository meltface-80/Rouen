"use strict";
// ---------------------------------------------------------------------------
// What Smart Picks' seeds are made from (lib/smart-picks/input.js, 2.0.6-t22) and Why these picks' route
// (lib/routes/smart-picks-why.js). Each test was broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeedInput } = require("../../lib/smart-picks/input");
const { mountSmartPicksWhy } = require("../../lib/routes/smart-picks-why");

const NOW = Date.UTC(2026, 10, 26);
const keyOf = (al) => (al && al.title ? al.title.toLowerCase() + "||" + String(al.subtitle || "").toLowerCase() : null);
const LIB = [{ title: "Mezzanine (Remastered)", subtitle: "Massive Attack" }, { title: "Köln", subtitle: "Keith Jarrett" }];

function input(o = {}) {
  return createSeedInput({
    albums: () => LIB, keyOf, splitCredit: (c) => c.split(" & "), canonArtist: (n) => n.toLowerCase(),
    genresOf: () => ["Jazz"], yearOf: () => 1975, cap: () => 5, now: () => NOW,
    listening: { albumPlayRows: () => o.albumPlays || [], trackPlaysAlone: () => o.tracks || [] },
    suggested: o.suggested || (() => [{ album: "Mezzanine", artist: "Massive Attack" }]),
    // As index.js smartLibraryRecord: tolerant of an edition's suffix.
    libraryRecord: (title, artist) => LIB.find((a) => a.title.startsWith(title) && a.subtitle === artist) || null,
  });
}

test("a pick is matched to the library as Roon spells it, so a track of it tried says nothing", () => {
  assert.deepEqual([...input().suggestedKeys()], ["mezzanine (remastered)||massive attack"],
    "THE one (the review): the pick's key as the service named it, never matching the library's");
  const r = input({ tracks: [{ key: "mezzanine (remastered)||massive attack", artist: "Massive Attack", ts: NOW }] }).seedsFor(new Set());
  assert.equal(r.seeds.find((s) => s.name === "Massive Attack").via, "owned", "a pick being tried made its artist a seed from listening");
});

test("a track counts for the library artists its own credit names; a database that can't be read is said, not ignored", () => {
  const r = input({ tracks: [{ key: null, artist: "Keith Jarrett & Stranger", ts: NOW }] }).seedsFor(new Set());
  assert.deepEqual(r.seeds.filter((s) => s.via === "listening").map((s) => s.name), ["Keith Jarrett"]);
  assert.throws(() => input({ suggested: () => { throw new Error("disk I/O error"); } }).seedsFor(new Set()), /disk I\/O error/,
    "THE one (the review): an unreadable list of picks read as none, so picks being tried seeded");
});

test("GET /api/smart-picks/why: the last build's, or null before the first", () => {
  /** @type {Record<string, Function>} */
  const routes = {};
  const app = { get: (p, fn) => { routes[p] = fn; } };
  let why = null;
  mountSmartPicksWhy(app, { why: () => why });
  const call = () => { let out; routes["/api/smart-picks/why"]({}, { set() {}, json: (b) => { out = b; } }); return out; };
  assert.deepEqual(call(), { why: null });
  why = { day: "2026-11-26", seeds: [] };
  assert.deepEqual(call(), { why: { day: "2026-11-26", seeds: [] } });
});
