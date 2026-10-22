"use strict";
/*
 * changelog.test.js — every version has its entry, and only one.
 *
 * v1.9.34: two branches open at once each added an entry at the top of
 * CHANGELOG.md and bumped package.json. Resolving their conflict on GitHub by
 * taking one side dropped the other's: 1.9.33's whole entry went, and part of
 * 1.9.32's, with nothing to say so — every code gate was green. This is that
 * gate: package.json's version is the top entry, versions only go down, none
 * is skipped (the two gaps already in the history aside, and no new one may
 * join them), none appears twice, and no conflict marker is left in the file.
 *
 * It cannot tell that a section went missing from an entry that is still
 * there (1.9.32's "Changed"): dev/release.md's rule — one build branch at a
 * time, the version and entry made last, on the latest dev — is what keeps
 * that from happening.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const text = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const versions = [...text.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)\]/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
const name = (/** @type {number[]} */ v) => v.join(".");
// Skipped before this gate existed, and only these: the list may shrink, never grow.
const OLD_GAPS = new Set(["1.7.12>1.7.8", "1.5.27>1.5.23"]);

test("package.json's version is the CHANGELOG's top entry", () => {
  assert.ok(versions.length > 0, "no version entries found");
  assert.equal(name(versions[0]), pkg.version, "the top entry is not the version being built: an entry lost, or the bump not made");
});

test("versions only go down, none twice, and none skipped", () => {
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [versions[i - 1], versions[i]];
    const down = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    assert.ok(down, `${name(a)} above ${name(b)}: out of order, or there twice`);
    if (a[0] === b[0] && a[1] === b[1] && a[2] - b[2] !== 1) {
      assert.ok(OLD_GAPS.has(`${name(a)}>${name(b)}`), `no entry between ${name(a)} and ${name(b)}: one was lost (a conflict resolved by taking one side?)`);
    }
  }
});

test("no merge conflict marker is left in the CHANGELOG", () => {
  const marks = text.split("\n").filter((l) => /^(<{7}|>{7}|={7})( |$)/.test(l));
  assert.deepEqual(marks, []);
});
