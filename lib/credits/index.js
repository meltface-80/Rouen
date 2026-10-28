// @ts-check
"use strict";
/*
 * credits/index.js — album credits put together (v1.9.70-t1, dev/design/album-credits.md): the store, the files'
 * reader, Wikipedia's reader (v1.9.70-t2), the pictures' queue and the finder, made from what index.js holds, so index.js gives what it has and mounts
 * the routes (lib/routes/album-credits.js).
 */
const { createCreditStore } = require("./store");
const { createAlbumFiles } = require("./files");
const { createActs } = require("./acts");
const { createCreditFinder } = require("./finder");
const { createWikipedia } = require("./wikipedia");

/**
 * @param {{ db: () => any, roon: () => any, dirOf: (title: string, artist: string) => string | null, readdir: (dir: string) => string[],
 *           parseFile: (file: string, opts: object) => Promise<any>, mb: (path: string) => Promise<any>,
 *           json: (url: string, headers?: Record<string, string>) => Promise<any>, fanartKey: () => string,
 *           albumKey: (title: string, artist: string) => string | null, nameKey: (name: string) => string, userAgent: string,
 *           log?: (line: string) => void }} d
 */
function createAlbumCredits(d) {
  // A name or a title in a script Rouen's keys drop (they keep a–z and 0–9 only) would have no key, and be left out
  // whole (the review): such a name is compared as written, lower-cased, instead.
  const plain = (/** @type {any} */ s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nameKey = (/** @type {string} */ n) => d.nameKey(n) || plain(n);
  const albumKey = (/** @type {string} */ t, /** @type {string} */ a) => d.albumKey(t, a) || (plain(t) ? "~" + plain(t) + "||" + plain(a) : null);
  const store = createCreditStore({ db: d.db, log: d.log });
  const wikipedia = createWikipedia({ json: d.json, userAgent: d.userAgent });
  const acts = createActs({ store, mb: d.mb, json: d.json, fanartKey: d.fanartKey, nameKey, userAgent: d.userAgent, log: d.log, wikipedia });
  const files = createAlbumFiles({ dirOf: d.dirOf, readdir: d.readdir, parseFile: d.parseFile, log: d.log });
  const finder = createCreditFinder({ store, roon: d.roon, files, mb: d.mb, wikipedia, albumKey, nameKey,
    onNames: (names) => acts.want(names), log: d.log });
  return { store, acts, finder };
}

module.exports = { createAlbumCredits };
