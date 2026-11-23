"use strict";
/*
 * sqlite-as-better.js — preloaded (node --require) so that require("better-sqlite3") gives lib/sqlite-compat.js's
 * adapter over node:sqlite, as Rouen Lite has it (dev/design/rouen-lite.md §3.1): every suite written against
 * better-sqlite3 then runs, unchanged, on Node's own SQLite. test/unit/sqlite-compat.test.js runs them so.
 */
const Module = require("node:module");
const path = require("node:path");
const { openDatabaseModule } = require(path.join(__dirname, "..", "..", "lib", "sqlite-compat"));
const adapter = openDatabaseModule((name) => { if (name === "better-sqlite3") throw new Error("not on Android"); return require(name); });
if (!adapter) throw new Error("node:sqlite isn't in this Node: Rouen Lite needs Node 22.5 or later");
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "better-sqlite3") return adapter;
  return load.call(this, request, parent, isMain);
};
