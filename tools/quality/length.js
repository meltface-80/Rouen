#!/usr/bin/env node
// @ts-check
"use strict";
// ---------------------------------------------------------------------------
// File-length ratchet (QUALITY.md, "File length").
//
// No code file may pass LIMIT lines. Files that were already over it when the
// gate came in are listed in length-baseline.json and may only SHRINK: a file
// that grows fails, and a file that shrank fails too until the smaller number
// is recorded (`npm run lines -- --ratchet`), so the allowance only ever
// tightens. A file that drops under the limit leaves the baseline for good.
//
//   node tools/quality/length.js            check (exit 1 on any failure)
//   node tools/quality/length.js --ratchet  record shrunk / removed files
//   node tools/quality/length.js --report   also list every file over REPORT
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const LIMIT = 500;
const REPORT = 400;
const CODE = /\.(js|mjs|cjs|css|html)$/;
// Never part of the running app or its tests: the Pages site, the two
// historical tarballs, and HQPlayer's data profiles.
const IGNORED = /^(docs|old|data|lib\/hqp\/profiles)\/|(^|\/)node_modules\//;

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = path.join(__dirname, "length-baseline.json");

/** Lines per file, counted like `wc -l`. */
function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * The decision, free of I/O so it can be tested.
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} baseline
 * @param {{limit?: number, report?: number}} [opts]
 */
function judge(counts, baseline, opts = {}) {
  const limit = opts.limit ?? LIMIT;
  const report = opts.report ?? REPORT;
  const failures = [];
  const reports = [];
  for (const file of Object.keys(counts).sort()) {
    const n = counts[file];
    const allowed = baseline[file];
    if (allowed === undefined) {
      if (n > limit) failures.push(`${file}: ${n} lines, over the ${limit}-line limit. Split it into modules.`);
      else if (n > report) reports.push(`${file}: ${n} lines`);
    } else if (n > allowed) {
      failures.push(`${file}: ${n} lines, up from ${allowed}. It is already over the limit and may only shrink: move code out before adding.`);
    } else if (n < allowed) {
      failures.push(`${file}: ${n} lines, down from ${allowed}. Good — run \`npm run lines -- --ratchet\` to record it.`);
    } else {
      reports.push(`${file}: ${n} lines (over the limit; may not grow)`);
    }
  }
  for (const file of Object.keys(baseline).sort()) {
    if (counts[file] === undefined) failures.push(`${file}: gone, but still in the baseline. Run \`npm run lines -- --ratchet\`.`);
  }
  return { failures, reports };
}

/** The baseline brought up to date: entries only shrink or disappear, never grow or appear. */
function ratchet(counts, baseline, opts = {}) {
  const limit = opts.limit ?? LIMIT;
  const next = /** @type {Record<string, number>} */ ({});
  for (const file of Object.keys(baseline).sort()) {
    const n = counts[file];
    if (n !== undefined && n > limit) next[file] = Math.min(n, baseline[file]);
  }
  return next;
}

function trackedCodeFiles() {
  // Tracked plus new-but-unignored, so a file is measured before it is added.
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8" });
  return [...new Set(out.split("\n").filter((f) => f && CODE.test(f) && !IGNORED.test(f)))]
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function measure() {
  const counts = /** @type {Record<string, number>} */ ({});
  for (const f of trackedCodeFiles()) counts[f] = countLines(fs.readFileSync(path.join(ROOT, f), "utf8"));
  return counts;
}

function main(argv) {
  const counts = measure();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  if (argv.includes("--ratchet")) {
    const next = ratchet(counts, baseline);
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
    console.log(`length baseline: ${Object.keys(baseline).length} → ${Object.keys(next).length} entries`);
  }
  const { failures, reports } = judge(counts, JSON.parse(fs.readFileSync(BASELINE, "utf8")));
  if (argv.includes("--report")) for (const r of reports) console.log(`  ${r}`);
  if (failures.length) {
    for (const f of failures) console.error(`[FAIL] ${f}`);
    return 1;
  }
  console.log(`[PASS] file length: ${Object.keys(counts).length} files, none over ${LIMIT} lines outside the baseline, none grown`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { LIMIT, REPORT, countLines, judge, ratchet };
