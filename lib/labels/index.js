// @ts-check
"use strict";
/*
 * lib/labels — the label scan pipeline, moved out of index.js unchanged in v1.9.72-t60 (dev/quality.md, step 3):
 *
 *   file-walk.js   the /music tag walk (buildFileLabelMap) and the job that runs it (runFileMetadataScan): labels,
 *                  Bandcamp links, release dates, file formats, first-seen dates, catalogue numbers and the
 *                  local-album keys, read from one file per album folder. Not label work, so it runs with Labels off.
 *   index-scan.js  the label scan (runLabelsIndexScan): the walk's labels first, then iTunes, Bandcamp or Qobuz,
 *                  TheAudioDB, MusicBrainz and Discogs for what the files could not answer.
 *
 * index.js keeps every store these read and write, the lookups and their rate limits, the 12-hour timer and the
 * routes, and wires the two here with what they use (createLabelScan). A value index.js may replace (a setting, the
 * Discogs token) is handed in as a getter and read where the code read the variable.
 */
const { createFileScan } = require("./file-walk");
const { createLabelsIndexScan } = require("./index-scan");

/**
 * What the /music walk uses: index.js's own, by the same names.
 * @typedef {object} FileWalkDeps
 * @property {boolean} DEBUG
 * @property {string} MUSIC_DIR
 * @property {() => boolean} musicDirMounted
 * @property {() => Promise<any>} importMetadata  `import("music-metadata")`, from index.js
 * @property {() => number} labelFolderDepth  the Label folder depth setting (0: the tag's label), read live
 * @property {(title: string, artist: string) => string[]} albumKeys
 * @property {(title: string, artist: string) => string | null} albumKey
 * @property {(s: any) => string} normalize
 * @property {(name: string) => boolean} isLikelyNotALabel
 * @property {(common: any) => string | null} fileTagDate
 * @property {(map: Map<string, any>, key: string, date: string) => any} noteHarvestedDate
 * @property {(map: Map<string, any>, title: string, version: any, artists: string[], year: string) => any} addHarvestedYear
 * @property {(key: string, facts: any, src: string) => boolean} setAlbumFileFacts
 * @property {(key: string, ts: number, src: string) => boolean} setAlbumSeen
 * @property {() => void} bumpLibraryMeta
 * @property {Map<string, any>} albumFileCache
 * @property {{ replaceSource: (src: string, entries: Map<string, any>) => number, size: () => number }} releaseFacts
 * @property {(fileYears: Map<string, any>, fileDirect: Map<string, any>) => void} publishFileYears
 *   replaces index.js's fileAlbumYears and fileDirectYears, together, with a finished walk's dates
 * @property {{ albums: any[], count: number, building: Promise<any> | null }} albumIndex
 * @property {{ map: Map<string, any>, count: number, builtAt: number, progress: number, building: boolean }} labelsIndex
 * @property {(keys: Set<string>, dirs: Map<string, string>) => void} setLocalAlbumKeys
 * @property {(reason: string) => any} harvestAlbumYears
 * @property {(reason: string, force: boolean) => any} kickReleaseDayFill
 */

/**
 * What the label scan uses besides the walk's labels: index.js's own, by the same names.
 * @typedef {object} LabelStoreDeps
 * @property {() => boolean} labelsEnabled
 * @property {() => string} discogsToken
 * @property {Map<string, string>} labelDiskCache
 * @property {Map<string, any>} labelsOverride
 * @property {Map<string, string | null>} labelMbidCache
 * @property {{ has: (key: string) => boolean, keep: (al: any, rel: any) => any, mark: (key: string) => any }} releaseLookup
 * @property {{ release: (title: string, artist: string) => Promise<any> }} discogs
 * @property {symbol} ITUNES_BLOCKED
 * @property {() => Promise<boolean>} libraryIsImporting
 * @property {(message: string) => void} appendLabelsLog
 * @property {() => any} seedLabelsFromCache
 * @property {(name: string) => string} labelGroupKey
 * @property {(key: string, label: string) => void} setLabelName
 * @property {() => void} rebuildLabelsMap
 * @property {() => any[]} albumsNeedingRelease
 * @property {() => void} saveLastScanTime
 * @property {(labelName: string, album: any) => void} labelsIndexAddAlbum
 * @property {(labelName: string) => Promise<string | null>} fetchLabelMbidFromMusicBrainz
 * @property {(groupKey: string, mbid: string) => void} setLabelMbid
 * @property {() => Promise<void>} bandcampWait
 * @property {(url: string, albumArtist: string) => Promise<{ label?: string, year?: any } | null>} fetchLabelFromBandcamp
 * @property {(key: string, year: any, opts?: any) => any} setAlbumYear
 * @property {(title: string, artist: string) => Promise<any>} fetchLabelFromiTunes  a label, null, or ITUNES_BLOCKED
 * @property {() => Promise<void>} itunesBatchWait
 * @property {(title: string, artist: string) => Promise<{ label?: string, year?: any } | null>} fetchQobuz
 * @property {(title: string, artist: string) => Promise<string | null>} fetchLabelFromTheAudioDB
 * @property {(title: string, artist: string) => Promise<{ label: string, mbid: string, year?: any } | null>} fetchLabelFromMusicBrainz
 * @property {() => Promise<void>} kickFanArtFetches
 * @property {() => Promise<void>} kickDiscogsLogoFetches
 */

/**
 * The label scan's, plus what the last walk read: createLabelScan hands those in from file-walk.js.
 * @typedef {FileWalkDeps & LabelStoreDeps & { lastFileLabelMap: () => Map<string, string> | null,
 *   lastFileBandcampMap: () => Map<string, string> | null }} IndexScanDeps
 */

/**
 * The pipeline, wired once by index.js.
 * @param {FileWalkDeps & LabelStoreDeps} d
 */
function createLabelScan(d) {
  const files = createFileScan(d);
  const labels = createLabelsIndexScan({ ...d, lastFileLabelMap: files.lastFileLabelMap,
    lastFileBandcampMap: files.lastFileBandcampMap });
  return {
    runFileMetadataScan: files.runFileMetadataScan,
    runLabelsIndexScan: labels.runLabelsIndexScan,
    /** Whether a /music walk is in flight (the dates debug shows it). */
    fileScanRunning: files.fileScanRunning,
  };
}

module.exports = { createLabelScan };
