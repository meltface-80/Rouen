#!/usr/bin/env node
// @ts-check
"use strict";
// ---------------------------------------------------------------------------
// Baseline guard (dev/quality.md, "Moving a baseline").
//
// The three baselines — file length, @ts-check exemptions and ESLint
// suppressions — may only shrink. Each gate enforces that against the code,
// but not against an edit to the baseline itself: a number raised by hand and
// then "ratcheted", a file name added to the exemption list, or
// `eslint --suppress-all` all left their gate green. This compares each
// baseline with the one on the branch this work started from (the merge-base
// with origin/dev, or with a pull request's base branch) and fails if any
// allowance rose or appeared.
//
//   node tools/quality/baselines.js          compare with origin/dev
//   BASELINE_BASE=<ref> node …               compare with another ref
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FILES = {
  length: "tools/quality/length-baseline.json",
  ts: "tools/quality/ts-baseline.json",
  lint: "tools/lint/eslint-suppressions.json",
};

/**
 * @typedef {Record<string, number>} LengthBaseline
 * @typedef {string[]} TsBaseline
 * @typedef {Record<string, Record<string, {count: number}>>} LintBaseline
 * @typedef {{length: LengthBaseline, ts: TsBaseline, lint: LintBaseline}} Baselines
 */

/**
 * The decision, free of I/O so it can be tested. Shrinking or removing an
 * entry is always allowed; nothing may rise or appear.
 * @param {Baselines} base  the baselines where this work started
 * @param {Baselines} head  the baselines now
 * @returns {string[]} failures
 */
function judge(base, head) {
  const failures = [];
  for (const [file, n] of Object.entries(head.length)) {
    const was = base.length[file];
    if (was === undefined) failures.push(`${FILES.length}: ${file} was added (${n} lines). A new file must be under the limit, not baselined.`);
    else if (n > was) failures.push(`${FILES.length}: ${file} raised from ${was} to ${n}. The allowance may only shrink.`);
  }
  const wasExempt = new Set(base.ts);
  for (const file of head.ts) {
    if (!wasExempt.has(file)) failures.push(`${FILES.ts}: ${file} was added. A module must pass @ts-check, not be exempted.`);
  }
  for (const [file, rules] of Object.entries(head.lint)) {
    for (const [rule, { count }] of Object.entries(rules)) {
      const was = base.lint[file]?.[rule]?.count ?? 0;
      if (count > was) failures.push(`${FILES.lint}: ${file} ${rule} raised from ${was} to ${count}. Fix the violation instead of suppressing it.`);
    }
  }
  return failures;
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** @param {string} ref */
function baseRef(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch (e) {
    throw new Error(`cannot find ${ref} to compare the baselines with — run \`git fetch origin ${ref.replace(/^origin\//, "")}\``);
  }
  try {
    return git(["merge-base", "HEAD", ref]);
  } catch (e) {
    throw new Error(`no common history with ${ref} (a shallow clone?) — run \`git fetch --unshallow\``);
  }
}

/**
 * A baseline as it stood at a commit. One that did not exist there allows nothing.
 * @param {string} commit
 * @param {string} file
 * @param {unknown} empty
 */
function atCommit(commit, file, empty) {
  let text;
  try {
    text = git(["show", `${commit}:${file}`]);
  } catch (e) {
    // Safe to swallow: a baseline absent at the base allows nothing, which is
    // the strictest reading, so every entry now present is reported.
    return empty;
  }
  return JSON.parse(text);
}

/** @param {string} file */
function now(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function main() {
  const ref = process.env.BASELINE_BASE ||
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/dev");
  let commit;
  try {
    commit = baseRef(ref);
  } catch (e) {
    console.error(`[FAIL] baselines: ${e.message}`);
    return 1;
  }
  const base = {
    length: atCommit(commit, FILES.length, {}),
    ts: atCommit(commit, FILES.ts, []),
    lint: atCommit(commit, FILES.lint, {}),
  };
  const head = { length: now(FILES.length), ts: now(FILES.ts), lint: now(FILES.lint) };
  const failures = judge(base, head);
  if (failures.length) {
    for (const f of failures) console.error(`[FAIL] ${f}`);
    console.error(`Compared with ${ref} at ${commit.slice(0, 9)}. Never raise a baseline to make a change pass (CLAUDE.md, "Gates").`);
    return 1;
  }
  console.log(`[PASS] baselines: none raised or added since ${ref} (${commit.slice(0, 9)})`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { FILES, judge };
