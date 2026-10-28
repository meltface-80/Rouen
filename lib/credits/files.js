// @ts-check
"use strict";
/*
 * files.js — an album's own files, read for their credits (dev/design/album-credits.md §2.2): every audio file in the
 * folder the label scan kept for the album, each read with music-metadata, in the album's order (their disc and track
 * tags, then their names). What each file's native tags say of who played and made it is rules.js's to read; what
 * this gives is the tracks in order, and the album's MusicBrainz release id where its files carry one.
 */
const path = require("path");

const AUDIO_RE = /\.(flac|mp3|m4a|aac|ogg|opus|wv|ape|wav|aiff?|dsf|dff)$/i;

/**
 * @typedef {{ native: Record<string, Array<{ id: string, value: any }>>, disc: number, track: number, name: string, release: string | null, number?: number }} TaggedFile
 *   number: its place through the album (numbered), from its disc and track tags
 */

/** @param {any} meta @param {string} name @returns {TaggedFile} */
function tagged(meta, name) {
  const c = (meta && meta.common) || {};
  const id = typeof c.musicbrainz_albumid === "string" ? c.musicbrainz_albumid.trim() : "";
  return { native: (meta && meta.native) || {}, disc: Number(c.disk && c.disk.no) || 1, track: Number(c.track && c.track.no) || 0, name, release: id || null };
}

/**
 * Each file's place through the album, from its disc and track tags: disc 1's tracks, then disc 2's after the highest
 * track number disc 1's files have, and so on, so a file that couldn't be read leaves its number empty rather than
 * moving every later one up (the review). Files with no track tag come after every numbered one, in the folder's order,
 * so none takes a tagged track's number.
 * @param {TaggedFile[]} files  in the album's order @returns {TaggedFile[]}
 */
function numbered(files) {
  /** @type {Map<number, number>} */
  const most = new Map();
  for (const f of files) if (f.track > 0) most.set(f.disc, Math.max(most.get(f.disc) || 0, f.track));
  /** @type {Map<number, number>} */
  const before = new Map();
  let n = 0;
  for (const d of [...most.keys()].sort((a, b) => a - b)) { before.set(d, n); n += most.get(d) || 0; }
  let after = n;
  for (const f of files) f.number = f.track > 0 && before.has(f.disc) ? /** @type {number} */ (before.get(f.disc)) + f.track : ++after;
  return files;
}

/**
 * The release id most of the files carry, or null. @param {TaggedFile[]} files
 */
function releaseOf(files) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const f of files) if (f.release) n.set(f.release, (n.get(f.release) || 0) + 1);
  let best = null, most = 0;
  for (const [id, c] of n) if (c > most) { best = id; most = c; }
  return best;
}

/**
 * @param {{ dirOf: (title: string, artist: string) => string | null, readdir: (dir: string) => string[],
 *           parseFile: (file: string, opts: object) => Promise<any>, log?: (line: string) => void }} deps
 *   dirOf: the folder the label scan kept for the album, or null; readdir: a folder's file names; parseFile: music-metadata's
 */
function createAlbumFiles(deps) {
  return {
    /**
     * The album's files in its order, read; why there are none.
     * @param {string} title @param {string} artist
     * @returns {Promise<{ files: TaggedFile[], dir: string | null, why: string | null, unread: number }>}
     */
    async read(title, artist) {
      const dir = deps.dirOf(title, artist);
      if (!dir) return { files: [], dir: null, why: "Not one of the albums found in /music.", unread: 0 };
      let names;
      try { names = deps.readdir(dir).filter((n) => AUDIO_RE.test(n)).sort(); }
      catch (e) { return { files: [], dir, why: "Its folder couldn't be read: " + String(e && /** @type {any} */ (e).message), unread: 0 }; }
      /** @type {TaggedFile[]} */
      const files = [];
      let unread = 0;
      for (const name of names) {
        try { files.push(tagged(await deps.parseFile(path.join(dir, name), { duration: false, skipCovers: true }), name)); }
        catch (e) { unread++; /* a file music-metadata can't read has no tags to give; counted, the rest stand */ }
      }
      files.sort((a, b) => a.disc - b.disc || (a.track || Infinity) - (b.track || Infinity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { files: numbered(files), dir, why: files.length ? null : "No audio file in its folder could be read.", unread };
    },
  };
}

module.exports = { createAlbumFiles, releaseOf, tagged, numbered, AUDIO_RE };
