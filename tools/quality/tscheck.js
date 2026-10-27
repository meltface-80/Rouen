#!/usr/bin/env node
// @ts-check
"use strict";
// ---------------------------------------------------------------------------
// Type-check ratchet (dev/quality.md, "Types").
//
// Every server-side module (launcher.js, index.js, lib/**, tools/quality/**, tools/windows/**)
// must open with `// @ts-check`, which makes TypeScript's checker read it as
// plain JavaScript: no rewrite, no build step, and the renamed-variable class
// of bug fails before the code ever runs. The files that did not pass when the
// gate came in are listed in ts-baseline.json, and the list may only SHRINK —
// a listed file that gains the pragma must leave the list.
//
// This script checks the pragmas; `npm run typecheck` then runs tsc.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = path.join(__dirname, "ts-baseline.json");
const REQUIRED = /^(index\.js|launcher\.js|lib\/.+\.js|tools\/(quality|windows)\/.+\.js)$/;
const IGNORED = /^lib\/hqp\/profiles\//;
const PRAGMA = /^(#![^\n]*\n)?\/\/ @ts-check\n/;

/**
 * @param {Record<string, boolean>} files  path → whether it carries the pragma
 * @param {string[]} exempt
 */
function judge(files, exempt) {
  const failures = [];
  const ex = new Set(exempt);
  for (const f of Object.keys(files).sort()) {
    if (files[f] && ex.has(f)) failures.push(`${f}: now carries // @ts-check — take it out of tools/quality/ts-baseline.json.`);
    if (!files[f] && !ex.has(f)) failures.push(`${f}: must open with // @ts-check (line 1, or line 2 after a #! line).`);
  }
  for (const f of [...ex].sort()) {
    if (!(f in files)) failures.push(`${f}: gone, but still in tools/quality/ts-baseline.json.`);
  }
  return failures;
}

function main() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  const files = /** @type {Record<string, boolean>} */ ({});
  for (const f of out.split("\n")) {
    if (!f || !REQUIRED.test(f) || IGNORED.test(f) || !fs.existsSync(path.join(ROOT, f))) continue;
    files[f] = PRAGMA.test(fs.readFileSync(path.join(ROOT, f), "utf8"));
  }
  const failures = judge(files, JSON.parse(fs.readFileSync(BASELINE, "utf8")));
  if (failures.length) {
    for (const f of failures) console.error(`[FAIL] ${f}`);
    return 1;
  }
  const checked = Object.values(files).filter(Boolean).length;
  console.log(`[PASS] @ts-check: ${checked} of ${Object.keys(files).length} server modules checked; the rest are baselined and may only shrink`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { judge, PRAGMA };
