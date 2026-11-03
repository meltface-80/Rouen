"use strict";
// ---------------------------------------------------------------------------
// The suites run with nothing installed (.github/workflows/checks.yml: "The suites need no npm install"). A test that
// requires an installed package passes on a contributor's machine, where node_modules is there, and fails in CI for a
// reason unrelated to the code under test: v1.9.72-t27's phone-downloads.test.js required express ("Cannot find module
// 'express'", the whole file failed before a test ran). So a test requires only Node's own modules and its own files;
// an optional package (better-sqlite3's native build, ffmpeg-static) is required inside a try, its test skipping
// without it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");

const ROOT = path.join(__dirname, "..");
const BUILTIN = new Set(builtinModules.flatMap((m) => [m, "node:" + m]));

/** Every .js under a folder, node_modules aside. @param {string} dir @returns {string[]} */
function jsUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsUnder(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** The installed packages a file requires outside a try, as "file:line package". @param {string} file */
function bareRequires(file) {
  const out = [];
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // a comment naming a require is not one
    for (const m of line.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      const name = m[1];
      if (name.startsWith(".") || name.startsWith("/") || name.startsWith("node:") || BUILTIN.has(name) || BUILTIN.has(name.split("/")[0])) continue;
      if (/\btry\s*\{/.test(line)) continue;   // optional: required in a try, its test skipping without it
      out.push(path.relative(ROOT, file) + ":" + (i + 1) + " " + name);
    }
  });
  return out;
}

test("THE one: no test requires an installed package outside a try (CI's suites run with nothing installed)", () => {
  const found = jsUnder(ROOT).flatMap(bareRequires);
  assert.deepEqual(found, []);
});

test("the gate sees what it guards against, and lets the optional ones by", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rouen-req-"));
  const f = path.join(dir, "x.test.js");
  fs.writeFileSync(f, [
    // Written out piece by piece, so this file's own scan doesn't find it.
    "const express = req" + 'uire("express");',
    'let D = null; try { D = require("better-sqlite3"); } catch (e) { D = null; }',
    'const fs = require("node:fs"); const p = require("path"); const own = require("../lib/x");',
    "// a comment: req" + 'uire("music-metadata") is not a require',
    "  * nor here: req" + 'uire("ffmpeg-static")',
  ].join("\n"));
  assert.deepEqual(bareRequires(f).map((s) => s.split(" ")[1]), ["express"]);
});
