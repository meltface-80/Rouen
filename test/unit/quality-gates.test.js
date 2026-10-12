"use strict";
// ---------------------------------------------------------------------------
// The gates' own decisions (dev/quality.md). A gate that cannot fail is
// worse than none — it reads as protection — so each verdict is pinned here,
// including the ones that make the allowances ONLY TIGHTEN.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const length = require("../../tools/quality/length.js");
const tscheck = require("../../tools/quality/tscheck.js");

const ROOT = path.resolve(__dirname, "..", "..");

test("length: lines are counted like wc -l", () => {
  assert.equal(length.countLines(""), 0);
  assert.equal(length.countLines("a\nb\n"), 2);
  assert.equal(length.countLines("a\nb"), 1);
});

test("length: a new file over the limit fails; at the limit it passes", () => {
  assert.equal(length.judge({ "a.js": 501 }, {}, { limit: 500 }).failures.length, 1);
  assert.equal(length.judge({ "a.js": 500 }, {}, { limit: 500 }).failures.length, 0);
});

test("length: a baselined file may not grow", () => {
  const { failures } = length.judge({ "big.js": 1001 }, { "big.js": 1000 }, { limit: 500 });
  assert.match(failures[0], /up from 1000/);
});

test("length: a baselined file that shrank fails until the smaller number is recorded", () => {
  const { failures } = length.judge({ "big.js": 990 }, { "big.js": 1000 }, { limit: 500 });
  assert.match(failures[0], /down from 1000/);
  const next = length.ratchet({ "big.js": 990 }, { "big.js": 1000 }, { limit: 500 });
  assert.deepEqual(next, { "big.js": 990 });
  assert.equal(length.judge({ "big.js": 990 }, next, { limit: 500 }).failures.length, 0);
});

test("length: the ratchet never raises an entry or adds one", () => {
  const next = length.ratchet({ "big.js": 1200, "new.js": 900 }, { "big.js": 1000 }, { limit: 500 });
  assert.deepEqual(next, { "big.js": 1000 });
});

test("length: a file split under the limit, or deleted, leaves the baseline", () => {
  assert.deepEqual(length.ratchet({ "big.js": 400 }, { "big.js": 1000 }, { limit: 500 }), {});
  assert.deepEqual(length.ratchet({}, { "big.js": 1000 }, { limit: 500 }), {});
  assert.match(length.judge({}, { "big.js": 1000 }).failures[0], /gone/);
});

test("length: the limit is 500 lines", () => {
  assert.equal(length.LIMIT, 500);
});

test("length: every baseline entry is genuinely over the limit", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/quality/length-baseline.json"), "utf8"));
  for (const [file, n] of Object.entries(baseline)) assert.ok(n > length.LIMIT, `${file}: ${n}`);
});

test("@ts-check: the pragma is found on line 1, or line 2 after a #! line, and nowhere else", () => {
  assert.ok(tscheck.PRAGMA.test("// @ts-check\n\"use strict\";\n"));
  assert.ok(tscheck.PRAGMA.test("#!/usr/bin/env node\n// @ts-check\n"));
  assert.ok(!tscheck.PRAGMA.test("\"use strict\";\n// @ts-check\n"));
  assert.ok(!tscheck.PRAGMA.test("// @ts-nocheck\n"));
});

test("@ts-check: an unchecked module outside the baseline fails", () => {
  assert.equal(tscheck.judge({ "lib/new.js": false }, []).length, 1);
  assert.equal(tscheck.judge({ "lib/new.js": true }, []).length, 0);
});

test("@ts-check: the baseline only shrinks — a listed file that gains the pragma must leave it", () => {
  assert.match(tscheck.judge({ "index.js": true }, ["index.js"])[0], /take it out/);
  assert.equal(tscheck.judge({ "index.js": false }, ["index.js"]).length, 0);
  assert.match(tscheck.judge({}, ["gone.js"])[0], /gone/);
});
