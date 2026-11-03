"use strict";
// v2.0.0-beta1 (the owner, 2026-11-03: "Time to bump to Rouen v2.0.0-beta1"; betas only when the owner says, test
// builds X.Y.Z-tN between them): the APK's versionCode, worked out in .github/workflows/android.yml from package.json's
// version, follows the updaters' order (lib/updater.js cmpVer, AppUpdate.compare): the series before < X.Y.Z-betaN <
// X.Y.Z-tN < X.Y.Z. Android refuses an APK whose versionCode is lower than the one installed, so a code out of that
// order is an update that cannot be installed. The workflow's own script is run here, as the workflow runs it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const wf = fs.readFileSync(path.join(__dirname, "../../.github/workflows/android.yml"), "utf8");
const script = /code=\$\(node -e '([\s\S]*?)' "\$version"\)/.exec(wf);
/** @param {string} v @returns {number | null} */
function code(v) {
  try { return Number(execFileSync(process.execPath, ["-e", script ? script[1] : "process.exit(2)", v], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); } catch (e) { return null; /* the workflow refuses the version: no code */ }
}

test("THE one: versionCodes in the updaters' order, the beta included", () => {
  assert.ok(script, "the versionCode script isn't where the workflow had it");
  const order = ["1.9.71", "1.9.72-t82", "2.0.0-beta1", "2.0.0-beta2", "2.0.0-beta10", "2.0.0-t1", "2.0.0-t9", "2.0.0-t10", "2.0.0", "2.0.1-beta1", "2.0.1-t1", "2.0.1", "2.1.0-t1"];
  const codes = order.map(code);
  codes.forEach((c, i) => assert.ok(c !== null && Number.isInteger(c) && c > 0 && c <= 2100000000, `${order[i]}: no versionCode (${c})`));
  for (let i = 1; i < order.length; i++) assert.ok(/** @type {number} */ (codes[i]) > /** @type {number} */ (codes[i - 1]), `${order[i]} (${codes[i]}) does not install over ${order[i - 1]} (${codes[i - 1]})`);
});

test("every 2.x code is above every code the 1.x formula gave (the phones already installed)", () => {
  // 1.9.72-t82 under the old formula: 1×10⁷ + 9×10⁵ + 72×10² + 82
  assert.ok(/** @type {number} */ (code("2.0.0-beta1")) > 10907282);
});

test("a version the formula has no room for is refused, not given a code that collides", () => {
  assert.equal(code("2.0.0-beta100"), null);
  assert.equal(code("2.0.0-t899"), null);
  assert.equal(code("2.0.0-rc1"), null);
});
