"use strict";
// ---------------------------------------------------------------------------
// The updater's version order (lib/updater.js cmpVer) for the test builds the
// owner numbers X.Y.Z-tN (2026-10-22, dev/release.md): each below its stable
// X.Y.Z and above the release before it, and t10 above t9 — a prerelease
// compared as text put "t10" below "t9".
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { cmpVer, verGt } = require("../../lib/updater");

test("a test build sits between the release before it and its own stable version", () => {
  assert.equal(verGt("1.9.66-t2", "1.9.65"), true, "a box on a test build would be offered the older release");
  assert.equal(verGt("1.9.66", "1.9.66-t2"), true, "a box on a test build would not be offered its stable release");
  assert.equal(verGt("v1.9.66", "1.9.66-t9"), true);
  assert.equal(cmpVer("1.9.66-t2", "1.9.66-t2"), 0);
});

test("THE one: test numbers count as numbers — t10 after t9", () => {
  assert.equal(verGt("1.9.66-t10", "1.9.66-t9"), true);
  assert.equal(verGt("1.9.66-t9", "1.9.66-t10"), false);
  assert.equal(verGt("1.9.66-t2", "1.9.66-t1"), true);
  // other prereleases keep their text order, as before
  assert.equal(verGt("1.2.0-beta", "1.2.0-alpha"), true);
});
