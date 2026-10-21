// @ts-check
"use strict";
/*
 * file-cache.js — stage 1's saved sources (dev/design/roon-native.md §10), as a JSON file.
 * Moved out of stage1.js in v1.9.32, unchanged, to keep it under its 500 lines.
 */
const fs = require("node:fs");

/**
 * The saved sources, as a JSON file: written whole (to a temporary file, then
 * renamed, so a crash cannot leave half of one), read back, deleted.
 * @param {string} file
 */
function fileCache(file) {
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (e) { return null; }   // none saved yet, or unreadable: nothing is used, and the next read replaces it
    },
    /** @param {any} v */
    write(v) { fs.writeFileSync(file + ".tmp", JSON.stringify(v)); fs.renameSync(file + ".tmp", file); },
    remove() { fs.rmSync(file, { force: true }); },
  };
}

module.exports = { fileCache };
