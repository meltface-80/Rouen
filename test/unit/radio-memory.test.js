"use strict";
// ---------------------------------------------------------------------------
// v1.9.3: an album the random album radio played is not played BY THE RADIO
// again for six months (lib/radio-memory.js) — the user's rule, set from a
// forum request to skip already-played albums in random radio mode.
//
// Plus the two places index.js must use it: the pick goes through it, and an
// album is noted only once Roon has taken it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRadioMemory, SIX_MONTHS_MS } = require("../../lib/radio-memory");
const { indexSource } = require("../lib/extract");

const DAY = 24 * 60 * 60 * 1000;
const albums = (n) => Array.from({ length: n }, (_, i) => ({ title: "A" + i, subtitle: "X" }));
const keyOf = (al) => al.title;

function memory(start, saved) {
  let clock = start || 1e12;
  let written = null;
  const m = createRadioMemory({ load: () => saved || null, save: (o) => { written = o; }, now: () => clock });
  return { m, tick: (ms) => { clock += ms; }, written: () => written };
}

test("the random album radio does not repeat itself within six months (v1.9.3)", async (t) => {
  await t.test("THE one: an album the radio played is not picked again", () => {
    const { m } = memory();
    const pool = albums(3);
    m.note("A0"); m.note("A1");
    for (let i = 0; i < 50; i++) {
      assert.equal(m.pick(pool, keyOf, null, Math.random).title, "A2");
    }
  });
  await t.test("six months is the window: still out at five months and a bit, back after six", () => {
    const { m, tick } = memory();
    const pool = albums(2);
    m.note("A0");
    tick(170 * DAY);
    assert.notEqual(m.playedAt("A0"), null, "dropped before six months");
    tick(SIX_MONTHS_MS - 170 * DAY + 1);
    assert.equal(m.playedAt("A0"), null, "still excluded after six months");
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(m.pick(pool, keyOf, null, Math.random).title);
    assert.ok(seen.has("A0"));
  });
  await t.test("the older 30-day preference still leans the pick, but never refuses one", () => {
    const { m } = memory();
    const pool = albums(3);
    const heard = (al) => al.title !== "A1";
    for (let i = 0; i < 30; i++) assert.equal(m.pick(pool, keyOf, heard, Math.random).title, "A1");
    const allHeard = () => true;
    assert.ok(m.pick(pool, keyOf, allHeard, Math.random), "a library heard in full stopped the radio");
  });
  await t.test("never a dead end: with everything played, the longest-ago radio play comes round first", () => {
    const { m, tick } = memory();
    const pool = albums(3);
    m.note("A1"); tick(DAY); m.note("A0"); tick(DAY); m.note("A2");
    assert.equal(m.pick(pool, keyOf, null, Math.random).title, "A1");
  });
  await t.test("it survives a restart: what was saved is what is excluded", () => {
    const first = memory();
    first.m.note("A0");
    const again = memory(1e12 + DAY, first.written());
    assert.notEqual(again.m.playedAt("A0"), null);
    assert.equal(again.m.pick(albums(2), keyOf, null, Math.random).title, "A1");
  });
  await t.test("what can never exclude anything again is not kept", () => {
    const first = memory();
    first.m.note("A0");
    const later = memory(1e12 + SIX_MONTHS_MS + DAY, first.written());
    assert.equal(later.m.size(), 0);
  });
  await t.test("an empty pool is no pick, not a crash", () => {
    const { m } = memory();
    assert.equal(m.pick([], keyOf, null, Math.random), null);
  });
});

test("every album has a radio key, including titles that reduce to nothing", async (t) => {
  const { loadIndexFunctions } = require("../lib/extract");
  const F = loadIndexFunctions(["radioAlbumKey", "albumKey", "canonText", "canonArtist", "normalize"]);
  await t.test("THE one: \u00f7 and an all-Japanese title are still keys, and distinct", () => {
    const a = F.radioAlbumKey({ title: "\u00f7", subtitle: "Ed Sheeran" });
    const b = F.radioAlbumKey({ title: "\u30c6\u30b9\u30c8", subtitle: "Someone" });
    assert.ok(a && b, "a null key can never be noted, so the rule never applies");
    assert.notEqual(a, b);
  });
  await t.test("an ordinary title keeps the library's own key", () => {
    assert.equal(F.radioAlbumKey({ title: "Kid A", subtitle: "Radiohead" }), F.albumKey("Kid A", "Radiohead"));
  });
});

test("index.js wires it in where the radio picks and plays", async (t) => {
  const src = indexSource();
  await t.test("the radio's pick goes through the memory", () => {
    const at = src.indexOf("async function pickSmartAlbum()");
    assert.ok(at > 0, "pickSmartAlbum moved");
    assert.match(src.slice(at, at + 900), /radioMemory\(\)\.pick\(/);
  });
  await t.test("an album is noted only after Roon has taken it", () => {
    const at = src.indexOf("async function radioTopUp(");
    const body = src.slice(at, at + 4000);
    const play = body.indexOf("await openAlbumByOffset(pick.offset");
    const note = body.indexOf("radioMemory().note(");
    assert.ok(play > 0 && note > play, "the album is used up before the add is known to have worked");
  });
  await t.test("the memory is made on first use, never at module load (it reads LABELS_DB_DIR)", () => {
    assert.doesNotMatch(src, /^const RADIO_MEMORY\b/m);
    const at = src.indexOf("function radioMemory()");
    const decl = src.indexOf("const LABELS_DB_DIR");
    assert.ok(at > 0 && decl > 0);
    assert.match(src.slice(at, at + 400), /if \(_radioMemory\) return _radioMemory;/);
  });
});
