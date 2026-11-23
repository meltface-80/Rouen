"use strict";
/*
 * Rouen, or Rouen Lite (dev/design/rouen-lite.md §2.1): Rouen's extension_id never changes (CLAUDE.md: Roon keys its
 * authorisation on it), and Rouen Lite, told so by ROUEN_LITE=1, is an extension of its own; index.js tells Roon
 * whichever this server is, and opens its database through lib/sqlite-compat.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { identity, isLite } = require("../../lib/lite");
const { indexSource } = require("../lib/extract");

test("Rouen's extension_id is the one it has always had; Rouen Lite's is its own", () => {
  assert.deepEqual(identity({}), { extension_id: "com.musicd.roon.random-albums", name: "Rouen" });
  assert.deepEqual(identity({ ROUEN_LITE: "0" }), { extension_id: "com.musicd.roon.random-albums", name: "Rouen" });
  assert.deepEqual(identity({ ROUEN_LITE: "1" }), { extension_id: "com.musicd.roon.rouen-lite", name: "Rouen Lite" });
  assert.equal(isLite({ ROUEN_LITE: "1" }), true);
  assert.equal(isLite({}), false);
});

test("index.js tells Roon the identity, and opens its database through the adapter", () => {
  const src = indexSource();
  assert.match(src, /\nconst ROUEN_IDENTITY = rouenIdentity\(\);\nconst roon = new RoonApi\(\{\n  extension_id: +ROUEN_IDENTITY\.extension_id,/);
  assert.match(src, /\n  display_name: +ROUEN_IDENTITY\.name \+ " v" \+ DISPLAY_SHORTVER,/);
  assert.match(src, /\nconst Database = openDatabaseModule\(\);\n/);
  assert.doesNotMatch(src, /require\("better-sqlite3"\)/, "only through lib/sqlite-compat.js");
});
