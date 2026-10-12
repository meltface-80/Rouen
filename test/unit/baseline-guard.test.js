"use strict";
// ---------------------------------------------------------------------------
// The baseline guard (tools/quality/baselines.js, dev/quality.md). Each gate
// already stops the CODE from getting worse; this pins that the BASELINES
// themselves cannot be loosened by hand. The three ways that worked before the
// guard are reproduced here as inputs that must fail.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const guard = require("../../tools/quality/baselines.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "tools/quality/baselines.js");

/** @param {Partial<{length: object, ts: string[], lint: object}>} b */
const B = (b) => ({ length: {}, ts: [], lint: {}, ...b });

test("unchanged baselines pass", () => {
  const b = B({ length: { "index.js": 20301 }, ts: ["index.js"], lint: { "index.js": { "no-empty": { count: 10 } } } });
  assert.deepEqual(guard.judge(b, structuredClone(b)), []);
});

test("length: a raised entry fails — the hand-edit-then-ratchet bypass", () => {
  // Raising index.js to 20400 by hand and running `npm run lines -- --ratchet`
  // after adding 50 lines recorded 20351, and the length gate passed.
  const f = guard.judge(B({ length: { "index.js": 20301 } }), B({ length: { "index.js": 20351 } }));
  assert.equal(f.length, 1);
  assert.match(f[0], /index\.js raised from 20301 to 20351/);
});

test("length: an added entry fails", () => {
  const f = guard.judge(B({}), B({ length: { "lib/big.js": 900 } }));
  assert.equal(f.length, 1);
  assert.match(f[0], /lib\/big\.js was added/);
});

test("length: a shrunk or removed entry passes", () => {
  const base = B({ length: { "index.js": 20301, "public/app.js": 19300 } });
  assert.deepEqual(guard.judge(base, B({ length: { "index.js": 20000 } })), []);
});

test("@ts-check: a module added to the exemptions fails", () => {
  const f = guard.judge(B({ ts: ["index.js"] }), B({ ts: ["index.js", "lib/nots.js"] }));
  assert.equal(f.length, 1);
  assert.match(f[0], /lib\/nots\.js was added/);
});

test("@ts-check: a module leaving the exemptions passes", () => {
  assert.deepEqual(guard.judge(B({ ts: ["index.js", "lib/qobuz.js"] }), B({ ts: ["index.js"] })), []);
});

test("lint: a raised suppression count fails — the --suppress-all bypass", () => {
  const base = B({ lint: { "index.js": { "no-empty": { count: 10 } } } });
  const f = guard.judge(base, B({ lint: { "index.js": { "no-empty": { count: 11 } } } }));
  assert.equal(f.length, 1);
  assert.match(f[0], /index\.js no-empty raised from 10 to 11/);
});

test("lint: a suppression for a new file or a new rule fails", () => {
  const base = B({ lint: { "index.js": { "no-empty": { count: 10 } } } });
  const head = B({ lint: {
    "index.js": { "no-empty": { count: 10 }, "no-undef": { count: 1 } },
    "lib/lintbad.js": { "no-empty": { count: 1 } },
  } });
  const f = guard.judge(base, head);
  assert.equal(f.length, 2);
  assert.ok(f.some((m) => /index\.js no-undef raised from 0 to 1/.test(m)));
  assert.ok(f.some((m) => /lib\/lintbad\.js no-empty raised from 0 to 1/.test(m)));
});

test("lint: a lowered or pruned suppression passes", () => {
  const base = B({ lint: { "index.js": { "no-empty": { count: 10 }, "no-new-func": { count: 2 } }, "lib/x.js": { "no-empty": { count: 1 } } } });
  const head = B({ lint: { "index.js": { "no-empty": { count: 9 } } } });
  assert.deepEqual(guard.judge(base, head), []);
});

test("every failure is reported, not just the first", () => {
  const f = guard.judge(B({}), B({ length: { "a.js": 600 }, ts: ["b.js"], lint: { "c.js": { "no-empty": { count: 1 } } } }));
  assert.equal(f.length, 3);
});

test("the real baselines are in the shapes the guard reads", () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
  const real = { length: read(guard.FILES.length), ts: read(guard.FILES.ts), lint: read(guard.FILES.lint) };
  assert.ok(Object.keys(real.length).length > 0 && real.ts.length > 0 && Object.keys(real.lint).length > 0);
  for (const rules of Object.values(real.lint)) {
    for (const r of Object.values(rules)) assert.equal(typeof r.count, "number");
  }
  assert.deepEqual(guard.judge(real, structuredClone(real)), []);
});

test("the script compares against a git ref and passes on itself", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8", env: { ...process.env, BASELINE_BASE: "HEAD" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[PASS\] baselines/);
});

test("the script fails, not passes, when it has nothing to compare with", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8", env: { ...process.env, BASELINE_BASE: "refs/heads/no-such-branch-xyz" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot find refs\/heads\/no-such-branch-xyz/);
});

test("the guard is part of the gates and CI gives it history to compare with", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.gates, /npm run baselines/);
  assert.equal(pkg.scripts.baselines, "node tools/quality/baselines.js");
  const checks = fs.readFileSync(path.join(ROOT, ".github/workflows/checks.yml"), "utf8");
  const gatesJob = checks.slice(checks.indexOf("  gates:"), checks.indexOf("  tests:"));
  assert.match(gatesJob, /fetch-depth: 0/);
  assert.match(gatesJob, /run: npm run baselines/);
});
