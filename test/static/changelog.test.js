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
 *
 * Test builds (the owner, 2026-10-22): X.Y.Z-t1, X.Y.Z-t2, … into dev, and
 * X.Y.Z itself only for the stable release, its entry above its tests. A
 * series starts at t1 and counts up by one, like the versions themselves.
 *
 * Betas (the owner, 2026-11-03, v2.0.0-beta1): X.Y.Z-beta1, beta2, … cut only
 * when the owner says, between the test builds of the same X.Y.Z, newest on
 * top. The test builds count on through them (t1, t2, beta2, t3: the betas
 * are not test numbers), the betas count by one among themselves, and a
 * series may start at a beta (2.0.0-beta1 came straight after 1.9.71).
 *
 * The test builds of a released series are folded into its release's entry
 * (v2.0.0-beta1's tidy, the owner: "I want all the test builds condensed to a
 * single entry"), so a series may also be its stable entry alone.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const text = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
/** @typedef {{ base: number[], kind: "" | "t" | "beta", n: number, name: string }} Entry */
/** @type {Entry[]} */
const entries = [...text.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)(?:-(t|beta)(\d+))?\]/gm)].map((m) => ({
  base: [Number(m[1]), Number(m[2]), Number(m[3])],
  kind: /** @type {"" | "t" | "beta"} */ (m[4] || ""),
  n: m[5] === undefined ? 0 : Number(m[5]),
  name: m[1] + "." + m[2] + "." + m[3] + (m[4] ? "-" + m[4] + m[5] : ""),
}));
const baseName = (/** @type {number[]} */ b) => b.join(".");
const cmpBase = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// Skipped before this gate existed, and only these: the list may shrink, never grow.
const OLD_GAPS = new Set(["1.7.12>1.7.8", "1.5.27>1.5.23"]);

test("every entry's heading is a version the gate can read", () => {
  // A heading it can't read (1.9.71-T2, -rc1, [Unreleased]) would be skipped by every check below.
  const bad = text.split("\n").filter((l) => l.startsWith("## [") && !/^## \[\d+\.\d+\.\d+(?:-(?:t|beta)\d+)?\] — \d{4}-\d{2}-\d{2}$/.test(l));
  assert.deepEqual(bad, []);
});

test("package.json's version is the CHANGELOG's top entry", () => {
  assert.ok(entries.length > 0, "no version entries found");
  assert.equal(entries[0].name, pkg.version, "the top entry is not the version being built: an entry lost, or the bump not made");
});

test("versions only go down, none twice, and none skipped", () => {
  /** @type {Entry[][]} one series per X.Y.Z, newest first */
  const series = [];
  for (const e of entries) {
    const last = series[series.length - 1];
    if (last && cmpBase(last[0].base, e.base) === 0) last.push(e);
    else {
      assert.ok(!series.some((s) => cmpBase(s[0].base, e.base) === 0), `${baseName(e.base)} appears in two places`);
      series.push([e]);
    }
  }
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const name = baseName(s[0].base);
    // the stable entry, if there is one, tops its series, once
    const stable = s.filter((e) => e.kind === "");
    assert.ok(stable.length <= 1, `${name} twice`);
    if (stable.length) assert.equal(s[0].kind, "", `${name}: its stable entry is not above its test builds and betas`);
    // the test builds count down by one to t1, and so do the betas to beta1, whatever lies between them
    for (const kind of /** @type {const} */ (["t", "beta"])) {
      const ns = s.filter((e) => e.kind === kind).map((e) => e.n);
      ns.forEach((n, j) => assert.equal(n, ns.length - j, `${name}-${kind}: ${ns.join(", ")} — out of order, there twice, or one lost (a conflict resolved by taking one side?)`));
    }
    // and the series below is the version before it
    const next = series[i + 1];
    if (!next) continue;
    const [a, b] = [s[0].base, next[0].base];
    assert.ok(cmpBase(a, b) > 0, `${name} above ${baseName(b)}: out of order`);
    if (a[0] === b[0] && a[1] === b[1] && a[2] - b[2] !== 1) {
      assert.ok(OLD_GAPS.has(`${name}>${baseName(b)}`), `no entry between ${name} and ${baseName(b)}: one was lost`);
    }
  }
});

test("no merge conflict marker is left in the CHANGELOG", () => {
  const marks = text.split("\n").filter((l) => /^(<{7}|>{7}|={7})( |$)/.test(l));
  assert.deepEqual(marks, []);
});
