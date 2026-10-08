"use strict";
// ---------------------------------------------------------------------------
// v1.9.1: Shelf follows the remote's theme — Graphite and Brass, or Brass
// light — from a stylesheet of its own (the remote's style.css is 5000 lines
// written for another page). The tokens both define must carry the same
// values, or "follows the remote's theme" quietly becomes "looks a bit like
// it": the first draft had already drifted on four of them. Same values also
// means the remote's contrast floors (themes.test.js) speak for Shelf's text.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "..", "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");

// The custom properties declared in the first block that opens with `head`.
function tokens(css, head) {
  const at = css.indexOf(head);
  assert.ok(at > -1, "no block opening with " + JSON.stringify(head));
  const open = css.indexOf("{", at), close = css.indexOf("}", open);
  const out = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
}

// Shelf's name → the remote's.
const SAME = { "--bg": "--bg", "--bg-elev": "--bg-elev", "--bg-elev-2": "--bg-elev-2", "--border": "--border",
  "--text": "--text", "--text-dim": "--text-dim", "--text-faint": "--text-faint", "--accent": "--accent",
  "--accent-soft": "--accent-soft", "--on-accent": "--on-accent", "--accent-hi": "--accent-text" };

test("Shelf's palette is the remote's, token for token (v1.9.1)", async (t) => {
  const style = read("style.css"), shelf = read("shelf.css");
  for (const [family, remoteHead, shelfHead] of [
    ["Graphite and Brass", '[data-theme="dark"][data-palette="graphite"] {', ":root {"],
    ["Brass light", '[data-theme="light"][data-palette="brass"] {', '[data-theme="light"] {'],
  ]) {
    await t.test(family, () => {
      const remote = tokens(style, remoteHead), mine = tokens(shelf, shelfHead);
      for (const [s, r] of Object.entries(SAME)) {
        assert.ok(mine[s], "shelf.css has no " + s + " for " + family);
        assert.ok(remote[r], "style.css has no " + r + " for " + family);
        assert.equal(mine[s], remote[r], family + ": shelf.css " + s + " is " + mine[s] + ", style.css " + r + " is " + remote[r]);
      }
    });
  }
});
