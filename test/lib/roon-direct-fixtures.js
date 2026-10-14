"use strict";
// The probe tests' shared fixtures: the owner's reported test library and
// the lifetime check every probe test holds the fake Core's record to.
const assert = require("node:assert/strict");
const { ALLOWED } = require("../../lib/roon-direct/methods");

const CORE_ID = "01234567-89ab-cdef-0123-456789abcdef";
const LIBRARY = [
  { title: "Kind of Blue", artist: "Miles Davis", source: "local", tracks: 5 },
  { title: "Blue", artist: "Joni Mitchell", source: "local", tracks: 10 },
  { title: "Mezzanine", artist: "Massive Attack", source: "tidal", tracks: 11 },
  { title: "Dummy", artist: "Portishead", source: "tidal", tracks: 11 },
  { title: "Untrue", artist: "Burial", source: "tidal", tracks: 13 },
  { title: "Discovery", artist: "Daft Punk", source: "tidal", tracks: 14 },
  { title: "Moon Safari", artist: "Air", source: "tidal", tracks: 10 },
  { title: "Rumours", artist: "Fleetwood Mac", source: "tidal", tracks: 120 },   // more than one page
];
const fast = { timeoutMs: 1500, settleMs: 1500, countGraceMs: 300 };

/** Every page retained released once, every query disposed once, nothing off the allowlist. */
function assertTidy(rec, out) {
  assert.deepEqual([...rec.released].sort(), [...rec.retained].sort(), "a retained page was not released, or released twice");
  assert.equal(new Set(rec.released).size, rec.released.length, "a page was released twice");
  assert.deepEqual([...rec.disposed].sort(), [...rec.opened].sort(), "a query opened was not disposed, or one was disposed twice");
  assert.equal(new Set(rec.disposed).size, rec.disposed.length, "a query was disposed twice");
  for (const sig of rec.signatures) assert.ok(ALLOWED.has(sig), "called off the allowlist: " + sig);
  if (out) {
    assert.equal(out.lifetime.pagesRetained, out.lifetime.pagesReleased);
    assert.equal(out.lifetime.queriesOpened, out.lifetime.queriesDisposed);
  }
}

module.exports = { CORE_ID, LIBRARY, fast, assertTidy };
