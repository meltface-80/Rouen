// @ts-check
"use strict";
/*
 * drive-tree.js — the iBroadcast drive's folders and files (2.0.6-t2, dev/design/ibroadcast.md §4.3): from the library
 * read (library.js), the albums chosen for the drive as Artist / Album (Year) / NN Title.<ext>, "DN-NN" on a set of
 * several discs. Names are made safe for any file system, and two the same in one folder are told apart.
 */

/**
 * @typedef {import("./library").Album} Album
 * @typedef {import("./library").Track} Track
 * @typedef {{ path: string, name: string, album: Album, track: Track, ext: string }} DriveFile
 * @typedef {{ dirs: Map<string, string[]>, files: Map<string, DriveFile> }} Tree
 *   dirs: each folder's path ("" the top) → the names in it, folders ending in "/"
 */

/** A file's extension from its type as iBroadcast gives it, else from its path. @param {Track} t */
function extOf(t) {
  const type = String(t.type || "").toLowerCase();
  if (type.includes("flac")) return "flac";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
  if (type.includes("wav")) return "wav";
  if (type.includes("aif")) return "aif";
  if (type.includes("ogg") || type.includes("opus")) return "ogg";
  const m = /\.([a-z0-9]{2,4})$/i.exec(String(t.file || ""));
  return m ? m[1].toLowerCase() : "bin";
}

/**
 * A name safe in a folder on any file system: no slash or character Windows refuses, no control character, no trailing
 * dot or space, at most 120 characters; empty or "."/".." becomes `or`.
 * @param {string} s @param {string} or
 */
function safe(s, or) {
  // A lone surrogate (half an emoji, in a name as sent) made whole as U+FFFD: no file name or URL can hold one.
  const n = String(s || "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ").trim();
  // Cut by characters, not UTF-16 units: half an emoji would be a lone surrogate, which no file name or URL can hold.
  const n2 = [...n].slice(0, 120).join("").replace(/[. ]+$/, "");
  return n2 && n2 !== "." && n2 !== ".." ? n2 : or;
}

/** `name` in `taken` (compared without case), told apart as "name (2)" before its extension. @param {Set<string>} taken @param {string} name */
function unique(taken, name) {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let n = name;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${stem} (${i})${ext}`;
  taken.add(n.toLowerCase());
  return n;
}

/**
 * The drive's tree for these albums.
 * @param {Album[]} albums @returns {Tree}
 */
function buildTree(albums) {
  /** @type {Map<string, string[]>} */
  const dirs = new Map([["", []]]);
  /** @type {Map<string, Set<string>>} names taken in each folder */
  const taken = new Map([["", new Set()]]);
  /** @type {Map<string, DriveFile>} */
  const files = new Map();
  /** @type {Map<string, string>} each artist's folder, by the artist's name */
  const artistDirs = new Map();
  /** @param {string} parent @param {string} name @returns {string} the folder's path */
  const folder = (parent, name) => {
    const n = unique(/** @type {Set<string>} */ (taken.get(parent)), name);
    /** @type {string[]} */ (dirs.get(parent)).push(n + "/");
    const p = parent ? parent + "/" + n : n;
    dirs.set(p, []);
    taken.set(p, new Set());
    return p;
  };
  for (const a of albums) {
    const artistName = safe(a.artist, "Unknown artist");
    let artist = artistDirs.get(artistName.toLowerCase());
    if (!artist) { artist = folder("", artistName); artistDirs.set(artistName.toLowerCase(), artist); }
    const album = folder(artist, safe(a.title, "Untitled") + (a.year ? ` (${a.year})` : ""));
    const discs = new Set(a.tracks.map((t) => t.disc)).size > 1;
    for (const t of a.tracks) {
      const ext = extOf(t);
      const no = String(t.track || 0).padStart(2, "0");
      const name = unique(/** @type {Set<string>} */ (taken.get(album)), `${discs ? t.disc + "-" : ""}${no} ${safe(t.title, "Track")}.${ext}`);
      /** @type {string[]} */ (dirs.get(album)).push(name);
      const p = album + "/" + name;
      files.set(p, { path: p, name, album: a, track: t, ext });
    }
  }
  return { dirs, files };
}

module.exports = { buildTree, extOf, safe };
