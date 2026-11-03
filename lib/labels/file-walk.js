// @ts-check
"use strict";
/*
 * file-walk.js — the /music tag walk (buildFileLabelMap) and the job that runs it (runFileMetadataScan), moved out of
 * index.js unchanged in v1.9.72-t60 (dev/quality.md, step 3). index.js keeps the stores the walk writes into (album
 * years, file facts, first-seen dates, release facts, the local-album keys) and hands them in (./index.js has the
 * list); what the label scan and the dates debug read back of the walk goes through createFileScan's getters.
 *
 * Both functions stand at the left margin, as they did in index.js, and take what they use as their first argument
 * rather than closing over it: test/static/release-days-wiring.test.js reads them there.
 */
const fs = require("node:fs");
const path = require("node:path");
const { releaseTypes, catalogueNumber } = require("../release-facts");

// Build a map of albumKey → label from audio file tags.
// Expects Artist/Album/track.flac layout — reads one file per album directory.
/**
 * @param {import("./index").FileWalkDeps} d
 * @param {(n: number) => void} [onProgress]  every 50 album folders, with how many so far
 * @returns {Promise<{ labelMap: Map<string, string>, bandcampMap: Map<string, string>, localKeys: Set<string>,
 *   localDirs: Map<string, string> }>}
 */
async function buildFileLabelMap(d, onProgress) {
  const { DEBUG, MUSIC_DIR, musicDirMounted, importMetadata, labelFolderDepth, albumKeys, albumKey, normalize,
    isLikelyNotALabel, fileTagDate, noteHarvestedDate, addHarvestedYear, setAlbumFileFacts, setAlbumSeen,
    bumpLibraryMeta, albumFileCache, releaseFacts, publishFileYears } = d;
  const map = new Map();
  const bandcampMap = new Map(); // albumKey → Bandcamp album page URL (from COMMENT tag)
  // Every album seen on disk, keyed the same way as the maps above — this is
  // the evidence behind the "local files" badge. Collected for EVERY album
  // directory (not just ones that yielded a label), since presence on disk is
  // the whole question.
  const localKeys = new Set();
  // key -> the directory the sampled file came from. Same lifetime and the
  // same rebuild triggers as localKeys, so the two cannot drift apart.
  const localDirs = new Map();
  // Built LOCALLY and published at the end, never cleared in place. This walk
  // takes minutes, while the Qobuz/TIDAL favourites come back in seconds — and
  // harvestAlbumYears fills gaps only, so whichever source lands first used to
  // win permanently. Blanking the shared map at the start of the walk handed
  // the services an open goal on every rescan: they would fill in the years the
  // last file scan had found, and the freshly-read tags would arrive to find
  // every album already dated. (Source precedence in setAlbumYear is the real
  // guard; this keeps the map itself from ever being observed half-built.)
  const fileYears = new Map();
  // The same dates under the tag-derived key (fileDirectYears). Collected, not
  // written as the walk goes: a write per FOLDER made two statements for an
  // album the walk finds twice, and the harvest's restatement of one undid the
  // other's on every walk (v1.8.63).
  const fileDirect = new Map();
  let formatWrites = 0;
  // Each album's catalogue number and kind as tagged (v1.9.67, lib/release-facts.js), published whole after the walk:
  // what the tags say now replaces what they said before, and a walk cut short changes nothing.
  const releaseSeen = new Map();
  if (!musicDirMounted()) return { labelMap: map, bandcampMap, localKeys, localDirs };
  let mm;
  try { mm = await importMetadata(); } catch (e) {
    if (DEBUG) console.error("[labels:files] music-metadata not available:", e.message);
    return { labelMap: map, bandcampMap, localKeys, localDirs };
  }
  const parseFile = mm.parseFile || (mm.default && mm.default.parseFile);
  if (!parseFile) {
    if (DEBUG) console.error("[labels:files] music-metadata loaded but parseFile not found");
    return { labelMap: map, bandcampMap, localKeys, localDirs };
  }

  const AUDIO_RE = /\.(flac|mp3|m4a|aac|ogg|opus|wv|ape|wav|aiff?)$/i;

  // Recursively scan directories up to MAX_DEPTH levels deep.
  // When audio files are found in a directory, read tags from the first one.
  // Match is keyed on tag values (common.album + common.albumartist) so
  // directory naming convention (Artist/Album vs flat Artist - Album) doesn't matter.
  // 5, not 3: /music/Artist/Album/CD1 fits in 3, but /music/Genre/Artist/Album/Disc 1
  // does not, and a subtree past the limit is skipped WHOLE and silently — the
  // albums in it simply never count as local.
  const MAX_DEPTH = 5;
  let _fsProcessed = 0;
  // Diagnostics for the one question the old summary could not answer: when the
  // local count is short, is it because the walk never SAW those albums, or
  // because it saw them and the keys didn't match? Counting is free and the
  // difference decides which half of the code to look at.
  const walk = { dirs: 0, tooDeep: 0, unreadable: 0, withAudio: 0, parsed: 0,
                 parseFailed: 0, keyed: 0, noAlbumTag: 0 };
  // album key → earliest file mtime seen for it. Published after the walk, the
  // same way the label and year maps are, so a partial walk never lands.
  const fileSeen = new Map();
  async function scanDir(dirPath, depth) {
    if (depth > MAX_DEPTH) { walk.tooDeep++; return; }
    walk.dirs++;
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
    catch (e) { walk.unreadable++; return; /* permission denied or dir vanished mid-scan */ }

    const audioFile = entries.find(e => e.isFile() && AUDIO_RE.test(e.name));
    if (audioFile) {
      walk.withAudio++;
      _fsProcessed++;
      if (onProgress && _fsProcessed % 50 === 0) onProgress(_fsProcessed);
      try {
        const meta = await parseFile(path.join(dirPath, audioFile.name), { duration: false, skipCovers: true });
        let label = (meta.common.label && meta.common.label[0]) || meta.common.organization || null;
        // Label-folder organisation: take the label from the folder at the
        // configured depth under the music root, overriding the per-file tag
        // (which is often the granular pressing/reissue label, not the parent
        // label the user files under). Opt-in; 0 = use the tag (default).
        if (labelFolderDepth() > 0) {
          const rel = path.relative(MUSIC_DIR, dirPath).split(path.sep).filter(Boolean);
          const folderLabel = rel[labelFolderDepth() - 1];
          if (folderLabel) label = folderLabel;
        }
        walk.parsed++;
        // The file's own timestamp — the closest thing to "when did this album
        // arrive" that exists anywhere. It is when the FILE landed on this
        // disk, not when Roon imported it, which is why it is ranked evidence
        // rather than treated as fact.
        let fileMtime = 0;
        try { fileMtime = fs.statSync(path.join(dirPath, audioFile.name)).mtimeMs || 0; }
        catch (e) { /* stat can fail where the read succeeded; simply no date */ }
        const album = meta.common.album;
        if (!album) walk.noAlbumTag++;
        const albumartist = meta.common.albumartist
          || (meta.common.artists && meta.common.artists[0])
          || meta.common.artist || null;
        // Record every on-disk album under both credit spellings — Roon's
        // album-artist can match either the ALBUMARTIST or the ARTIST tag, and
        // a miss here just means a missing badge, never a wrong one.
        if (album) {
          // albumKeys, not albumKey: the library index stores albumKeys() for
          // every album, which enumerates the whole credit AND each name in it.
          // Keying the file side on the whole credit only made the match
          // one-directional — a tag reading "Robert Plant & Alison Krauss"
          // could never meet a Roon credit of "Robert Plant", while the reverse
          // matched fine. That asymmetry is invisible except as a local count
          // that is quietly too low.
          for (const k of albumKeys(album, albumartist || "")) {
            localKeys.add(k);
            // WHERE the album is, not just that it exists. The waveform needs a
            // file, and until v1.7.90 nothing in this extension knew a path:
            // the walk read one sampled file per directory and kept only the
            // tags. Recording the directory here is free (we are standing in
            // it), and it lets a track be resolved LAZILY later — read the tags
            // of the dozen files in one folder when a track starts playing,
            // rather than indexing ~70,000 files up front for a feature most
            // of them will never be asked about.
            localDirs.set(k, dirPath);
          }
          // Also key by the track artist — Roon's album credit sometimes matches
          // that instead. NOT for compilations: one sampled track would claim a
          // various-artists disc for whichever performer happened to be first,
          // and could then badge an unrelated streaming album as local.
          const isCompilation = /various|soundtrack|ost\b/i.test(albumartist || "") ||
                                meta.common.compilation === true;
          if (meta.common.artist && !isCompilation) {
            for (const k of albumKeys(album, meta.common.artist)) {
              localKeys.add(k);
              localDirs.set(k, dirPath);
            }
          }
          // A compilation whose ALBUMARTIST tag is missing gets the first
          // track's performer instead, which never matches Roon's "Various
          // Artists". The title still has to match, so this cannot badge an
          // unrelated album.
          if (isCompilation || meta.common.compilation === true) {
            const kv = albumKey(album, "Various Artists");
            if (kv) { localKeys.add(kv); localDirs.set(kv, dirPath); }
          }
          walk.keyed++;
          if (fileMtime > 0) {
            for (const k of albumKeys(album, albumartist || "")) {
              fileSeen.set(k, Math.min(fileSeen.get(k) || Infinity, fileMtime));
            }
          }
          // What this album actually IS on disk. music-metadata has already
          // parsed all of it as part of the read above, so these four facets
          // cost nothing beyond the assignment — the `format` block was simply
          // never looked at before.
          const fmt = meta.format || {};
          if (fmt.container || fmt.sampleRate) {
            const facts = {
              container: fmt.container ? String(fmt.container).toUpperCase() : null,
              bits: Number.isFinite(fmt.bitsPerSample) ? fmt.bitsPerSample : null,
              rate: Number.isFinite(fmt.sampleRate) ? fmt.sampleRate : null,
              chan: Number.isFinite(fmt.numberOfChannels) ? fmt.numberOfChannels : null,
              lossless: !!fmt.lossless
            };
            // Written under the same key space the badges match on, so the
            // facet reaches the album through its srcKeys even when Roon's
            // title and the file's tags disagree about the album's name.
            for (const k of albumKeys(album, albumartist || "")) {
              if (setAlbumFileFacts(k, facts, "file")) formatWrites++;
            }
          }
          // Its catalogue number and kind, as tagged, under the same keys; a set's second disc never overwrites its first.
          const rel = { catno: catalogueNumber(meta.common, meta.native), types: releaseTypes(meta.common) };
          if (rel.catno || rel.types.length) {
            for (const k of albumKeys(album, albumartist || "")) if (!releaseSeen.has(k)) releaseSeen.set(k, rel);
          }
        }
        if (label && !isLikelyNotALabel(label) && album) {
          const key = normalize(album) + "||" + normalize(albumartist || "");
          if (!map.has(key)) map.set(key, label);
        }
        // Capture the release date from file tags too (the Decade filter reads
        // its year, the Release date sort its day).
        const fyear = fileTagDate(meta.common);
        if (album && fyear) {
          // Under the TAG-derived key — the year cache's own key space — for
          // the albums the srcKeys join below cannot reach (fileDirectYears).
          noteHarvestedDate(fileDirect, normalize(album) + "||" + normalize(albumartist || ""), fyear);
          // ...and again in the badge key space, so harvestAlbumYears can reach
          // it through the album's srcKeys when they DON'T agree. Roon renames
          // albums ("(Deluxe Edition)"), reads a different album artist, and
          // credits collaborations its own way — every one of those used to
          // strand a perfectly good file-tag year under a key nothing looks up.
          // These mirror the keys the "local files" badge matches on, with one
          // exception: the badge also keys an album with NO artist tag at all,
          // which is too weak an identity to hang a year on.
          addHarvestedYear(fileYears, album, null, [albumartist || ""], fyear);
          const isComp = /various|soundtrack|ost\b/i.test(albumartist || "") ||
                         meta.common.compilation === true;
          if (meta.common.artist && !isComp) {
            addHarvestedYear(fileYears, album, null, [meta.common.artist], fyear);
          }
        }
        // Extract Bandcamp album page URL from COMMENT tags (embedded by Bandcamp downloader).
        // Scan all comment entries — the URL may not be in slot 0 if other tags share the field.
        if (album) {
          const comments = meta.common.comment || [];
          for (const c of comments) {
            const text = typeof c === "string" ? c : (c && c.text ? c.text : "");
            // Require /album/ path to avoid artist pages or bare domain mentions.
            const bcMatch = text.match(/https?:\/\/[a-z0-9-]+\.bandcamp\.com\/album\/[a-z0-9_%-]+/i);
            if (bcMatch) {
              const bcKey = normalize(album) + "||" + normalize(albumartist || "");
              if (!bandcampMap.has(bcKey)) bandcampMap.set(bcKey, bcMatch[0]);
              break;
            }
          }
        }
      } catch (e) {
        // Unreadable or untagged. Counted, because a directory whose FIRST
        // audio file won't parse is dropped whole — no second file is tried —
        // and that is invisible unless someone counts it.
        walk.parseFailed++;
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) await scanDir(path.join(dirPath, entry.name), depth + 1);
    }
  }

  let walkAborted = false;
  try {
    await scanDir(MUSIC_DIR, 0);
  } catch (e) {
    walkAborted = true;
    if (DEBUG) console.error("[labels:files] scan error:", e.message);
  }
  if (DEBUG) console.log("[labels:files] file scan found", map.size, "labels,", bandcampMap.size,
                         "Bandcamp URLs,", fileYears.size, "dated identities");
  // Unconditional: this is the line that says whether a short local count is a
  // walk problem or a match problem, and it is useless if it only appears when
  // someone happened to have debug on.
  console.log("[local:walk] " + walk.dirs + " dirs visited, " + walk.withAudio +
              " with audio, " + walk.parsed + " tags read, " + walk.keyed + " albums keyed" +
              (walk.tooDeep     ? ", " + walk.tooDeep + " SKIPPED past depth " + MAX_DEPTH : "") +
              (walk.unreadable  ? ", " + walk.unreadable + " unreadable" : "") +
              (walk.parseFailed ? ", " + walk.parseFailed + " tag reads failed" : "") +
              (walk.noAlbumTag  ? ", " + walk.noAlbumTag + " had no album tag" : ""));
  // Publish in one assignment, so the join never sees a partial walk — and not
  // at all from a walk that broke off: the harvest RESTATES these as what the
  // files say now (v1.8.63), and a walk that stopped halfway does not know.
  if (walkAborted) {
    console.error("[files] the /music walk broke off — its release dates were not used");
  } else {
    publishFileYears(fileYears, fileDirect);
  }
  let seenWrites = 0;
  for (const [k, ts] of fileSeen) if (setAlbumSeen(k, ts, "file")) seenWrites++;
  if (seenWrites) {
    bumpLibraryMeta();   // the Recently added ordering just changed
    console.log("[seen] " + seenWrites + " albums dated from file timestamps");
  }
  if (formatWrites) {
    bumpLibraryMeta();   // the Format/Sample rate/Bit depth facets just gained values
    console.log("[format] " + albumFileCache.size + " album identities carry file format");
  }
  const releaseWrites = releaseFacts.replaceSource("file", releaseSeen);
  if (releaseWrites) {
    bumpLibraryMeta();   // the Album type facet and the label order just changed
    console.log("[release] " + releaseWrites + " album identities changed their catalogue number or kind; " + releaseFacts.size() + " carry one");
  }
  // No year is written here any more: the walk's dates reach the cache through
  // harvestAlbumYears("file tags"), which the only caller runs next and which
  // counts the tag-key applications in `added`, so its bump covers them.
  return { labelMap: map, bandcampMap, localKeys, localDirs };
}

// ---------------------------------------------------------------------------
// The /music tag walk, on its own.
//
// This is NOT label work, and keeping it inside runLabelsIndexScan was the
// reason "Labels off" still looked like label scanning: it entered a function
// named for labels, flipped labelsIndex.building, seeded the label map and
// wrote "[labels] …" into the labels scan log.
//
// What this pass actually produces, and what breaks if it stops:
//   release years          -> the Decade filter
//   local album keys       -> the "local files" badge
//   container/bits/rate/
//     channels/lossless    -> the Format, Sample rate, Bit depth and Channels
//                             filters
//   label names from tags  -> handed to the label scan, but only when it runs
//
// So it runs whether or not Labels is switched on. Its label output is simply
// kept for whoever wants it, and nothing consumes it while Labels is off.
// ---------------------------------------------------------------------------
/**
 * @param {import("./index").FileWalkDeps} d
 * @param {FileScanState} s
 * @param {string} [reason]  for the log line ("scheduled" when none)
 */
async function runFileMetadataScan(d, s, reason) {
  const { musicDirMounted, albumIndex, labelsIndex, setLocalAlbumKeys, harvestAlbumYears, kickReleaseDayFill } = d;
  if (s.fileScanRunning) return;
  if (!musicDirMounted()) return;    // nothing to walk
  if (albumIndex.count === 0) return;
  s.fileScanRunning = true;
  try {
    const estimate = albumIndex.albums.length || 1000;
    const { labelMap, bandcampMap, localKeys, localDirs } = await buildFileLabelMap(d, (n) => {
      labelsIndex.progress = Math.min(0.15, n / estimate);
    });
    s.lastFileLabelMap = labelMap || new Map();
    s.lastFileBandcampMap = bandcampMap || new Map();
    // Only replace the known-local set when the scan actually saw the mount —
    // an unmounted /music must not wipe badges earned by a previous scan.
    if (localKeys && localKeys.size) setLocalAlbumKeys(localKeys, localDirs);
    // The walk just re-read every album's tags, so join its years on now.
    harvestAlbumYears("file tags");
    // ...and look up the day of every album the tags dated only to the year,
    // straight away (v1.8.62).
    kickReleaseDayFill("after the /music walk", true);
    console.log("[files] tag scan complete (" + (reason || "scheduled") + ")");
  } catch (e) {
    console.error("[files] tag scan failed: " + e.message);
  } finally {
    s.fileScanRunning = false;
  }
}

// What the last walk produced, kept for the label scan to consume when it
// runs. Both were locals of the combined function before the split, and the
// Bandcamp pass still reads the second — leaving it behind was a ReferenceError
// that the scan's own catch would have swallowed into "scan aborted by
// unexpected error", killing every pass after it on a /music library.
/** @typedef {{ lastFileLabelMap: Map<string, string> | null, lastFileBandcampMap: Map<string, string> | null,
 *   fileScanRunning: boolean }} FileScanState */

/**
 * The walk, wired: one state, kept between walks.
 * @param {import("./index").FileWalkDeps} d
 */
function createFileScan(d) {
  /** @type {FileScanState} */
  const s = { lastFileLabelMap: null, lastFileBandcampMap: null, fileScanRunning: false };
  return {
    /** @param {string} [reason] */
    runFileMetadataScan: (reason) => runFileMetadataScan(d, s, reason),
    lastFileLabelMap: () => s.lastFileLabelMap,
    lastFileBandcampMap: () => s.lastFileBandcampMap,
    fileScanRunning: () => s.fileScanRunning,
  };
}

module.exports = { buildFileLabelMap, runFileMetadataScan, createFileScan };
