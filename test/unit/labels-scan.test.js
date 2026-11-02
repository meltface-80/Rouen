"use strict";
// ---------------------------------------------------------------------------
// The label scan pipeline (lib/labels/), moved out of index.js unchanged in v1.9.72-t60.
//
// buildFileLabelMap walks a real directory tree in a temp folder; music-metadata is a fake that answers per file, so
// what is checked is the walk itself: which folders it reads, what it keys each album under, what it publishes, and
// that a walk that broke off publishes no dates. The label scan runs on fakes for every lookup and store, which is
// what lets the cascade's order be seen: the files' labels first, then iTunes, Bandcamp or Qobuz, TheAudioDB,
// MusicBrainz and Discogs, each asked only for what the one before could not answer. The keys are index.js's own
// normalize / albumKey / albumKeys, extracted, so the walk and the scan meet in the key space they meet in for real.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadIndexFunctions } = require("../lib/extract");
const { buildFileLabelMap, createFileScan } = require("../../lib/labels/file-walk");
const { createLabelScan } = require("../../lib/labels");

const K = loadIndexFunctions(["normalize", "canonText", "canonArtist", "albumKey", "albumKeys", "albumTitleVariants"], {});

/** Runs fn with console.log/error captured; resolves to { out, err, value }. */
async function quietly(fn) {
  const out = [], err = [];
  const log = console.log, error = console.error;
  console.log = (...a) => { out.push(a.join(" ")); };
  console.error = (...a) => { err.push(a.join(" ")); };
  try { return { value: await fn(), out, err }; } finally { console.log = log; console.error = error; }
}

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

/** A /music tree in a temp folder: { "rel/dir/file.flac": meta | Error }; files are empty, the fake reads meta. */
function musicTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-labels-"));
  roots.push(root);
  const metas = new Map();
  for (const [rel, meta] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "");
    metas.set(abs, meta);
  }
  return { root, metas };
}

const meta = (common, format = {}) => ({ common, format, native: {} });

/** Every dependency the walk and the scan take, as fakes that record what they were asked. */
function deps(over = {}) {
  const calls = [];
  const note = (name, ret) => (...a) => { calls.push([name, ...a]); return typeof ret === "function" ? ret(...a) : ret; };
  const labelsIndex = { map: new Map(), count: 0, builtAt: 0, progress: 0, building: false };
  const d = {
    DEBUG: false, MUSIC_DIR: "/nowhere", calls, labelsIndex,
    musicDirMounted: () => true,
    importMetadata: async () => ({ parseFile: async () => { throw new Error("no tree"); } }),
    labelFolderDepth: () => 0,
    albumKeys: K.albumKeys, albumKey: K.albumKey, normalize: K.normalize,
    isLikelyNotALabel: (name) => /^not a label$/i.test(name || ""),
    fileTagDate: (common) => (common.year ? String(common.year) : null),
    noteHarvestedDate: (map, key, date) => { map.set(key, date); },
    addHarvestedYear: (map, title, version, artists, year) => { map.set(title + "|" + artists[0], year); },
    setAlbumFileFacts: note("setAlbumFileFacts", true),
    setAlbumSeen: note("setAlbumSeen", true),
    bumpLibraryMeta: note("bumpLibraryMeta"),
    albumFileCache: new Map(),
    releaseFacts: { replaceSource: note("replaceSource", 0), size: () => 0 },
    publishFileYears: note("publishFileYears"),
    albumIndex: { albums: [], count: 0, building: null },
    setLocalAlbumKeys: note("setLocalAlbumKeys"),
    harvestAlbumYears: note("harvestAlbumYears"),
    kickReleaseDayFill: note("kickReleaseDayFill"),
    labelsEnabled: () => true,
    discogsToken: () => "",
    labelDiskCache: new Map(),
    labelsOverride: new Map(),
    labelMbidCache: new Map(),
    releaseLookup: { has: () => false, keep: note("releaseKeep"), mark: note("releaseMark") },
    discogs: { release: async (title) => { calls.push(["discogs", title]); return null; } },
    ITUNES_BLOCKED: Symbol("itunes_blocked"),
    libraryIsImporting: async () => false,
    appendLabelsLog: note("log"),
    seedLabelsFromCache: note("seedLabelsFromCache"),
    labelGroupKey: (name) => K.normalize(name),
    setLabelName: note("setLabelName"),
    rebuildLabelsMap: note("rebuildLabelsMap"),
    albumsNeedingRelease: () => [],
    saveLastScanTime: note("saveLastScanTime"),
    labelsIndexAddAlbum: (label, al) => {
      calls.push(["labelsIndexAddAlbum", label, al.title]);
      labelsIndex.map.set(K.normalize(label), { display: label });
    },
    fetchLabelMbidFromMusicBrainz: async () => null,
    setLabelMbid: note("setLabelMbid"),
    bandcampWait: async () => {},
    fetchLabelFromBandcamp: async (url) => { calls.push(["bandcamp", url]); return null; },
    setAlbumYear: note("setAlbumYear"),
    fetchLabelFromiTunes: async (title) => { calls.push(["itunes", title]); return null; },
    itunesBatchWait: async () => {},
    fetchQobuz: async (title) => { calls.push(["qobuz", title]); return null; },
    fetchLabelFromTheAudioDB: async (title) => { calls.push(["tadb", title]); return null; },
    fetchLabelFromMusicBrainz: async (title) => { calls.push(["mb", title]); return null; },
    kickFanArtFetches: async () => { calls.push(["kickFanArtFetches"]); },
    kickDiscogsLogoFetches: async () => { calls.push(["kickDiscogsLogoFetches"]); },
  };
  return Object.assign(d, over);
}

/** deps() reading the given tree through a fake music-metadata. */
function treeDeps(tree, over = {}) {
  return deps({
    MUSIC_DIR: tree.root,
    importMetadata: async () => ({
      parseFile: async (file) => {
        const m = tree.metas.get(file);
        if (!m || m instanceof Error) throw m || new Error("not audio");
        return m;
      },
    }),
    ...over,
  });
}

const album = (title, subtitle) => ({ title, subtitle });
const lookups = (calls) => calls.filter(c => ["itunes", "bandcamp", "qobuz", "tadb", "mb", "discogs"].includes(c[0]))
  .map(c => c[0] + ":" + c[1]);

// ---------------------------------------------------------------------------
// buildFileLabelMap — the /music walk
// ---------------------------------------------------------------------------

test("the walk reads one file per album folder, and keys labels, Bandcamp links and local folders", async () => {
  const tree = musicTree({
    "Artist A/Album One/01.flac": meta({ album: "Album One", albumartist: "Artist A", artist: "Artist A",
      label: ["Label One"], comment: ["Bought at https://artista.bandcamp.com/album/album-one"], year: 1999 },
      { container: "flac", sampleRate: 44100, bitsPerSample: 16, numberOfChannels: 2, lossless: true }),
    "Artist A/Album One/02.flac": new Error("the second file must never be read"),
    "Artist B/Album Two/01.mp3": meta({ album: "Album Two", albumartist: "Artist B", organization: "Org Label" }),
    "Artist B/Album Two/cover.jpg": null,
    "Broken/01.flac": new Error("unreadable"),
    "Empty/notes.txt": null,
  });
  const d = treeDeps(tree);
  const { value: r, out } = await quietly(() => buildFileLabelMap(d));
  assert.equal(r.labelMap.get("album one||artist a"), "Label One");
  assert.equal(r.labelMap.get("album two||artist b"), "Org Label", "organization stands in for a missing label tag");
  assert.equal(r.bandcampMap.get("album one||artist a"), "https://artista.bandcamp.com/album/album-one");
  const k1 = K.albumKey("Album One", "Artist A");
  assert.ok(r.localKeys.has(k1), "an album on disk is not counted local");
  assert.equal(r.localDirs.get(k1), path.join(tree.root, "Artist A", "Album One"));
  const facts = d.calls.find(c => c[0] === "setAlbumFileFacts" && c[1] === k1);
  assert.deepEqual(facts[2], { container: "FLAC", bits: 16, rate: 44100, chan: 2, lossless: true });
  assert.ok(d.calls.some(c => c[0] === "setAlbumSeen" && c[1] === k1 && c[3] === "file"), "no first-seen date from the file");
  const published = d.calls.filter(c => c[0] === "publishFileYears");
  assert.equal(published.length, 1, "a finished walk publishes its dates once");
  assert.equal(published[0][2].get("album one||artist a"), "1999");
  assert.ok(out.some(l => /^\[local:walk\] \d+ dirs visited, 3 with audio, 2 tags read, 2 albums keyed, 1 tag reads failed/.test(l)),
    "the walk's own summary line changed:\n" + out.join("\n"));
});

test("Label folder depth takes the label from the folder at that depth, over the tag", async () => {
  const tree = musicTree({
    "Warp/Artist C/Album Three/01.flac": meta({ album: "Album Three", albumartist: "Artist C", label: ["Warp Pressing"] }),
  });
  const r = (await quietly(() => buildFileLabelMap(treeDeps(tree, { labelFolderDepth: () => 1 })))).value;
  assert.equal(r.labelMap.get("album three||artist c"), "Warp");
  const r0 = (await quietly(() => buildFileLabelMap(treeDeps(tree)))).value;
  assert.equal(r0.labelMap.get("album three||artist c"), "Warp Pressing");
});

test("no /music, or no music-metadata: nothing walked, nothing published", async () => {
  const tree = musicTree({ "A/B/01.flac": meta({ album: "B", albumartist: "A", label: ["L"] }) });
  let imported = 0;
  const unmounted = treeDeps(tree, { musicDirMounted: () => false, importMetadata: async () => { imported++; return {}; } });
  const r = (await quietly(() => buildFileLabelMap(unmounted))).value;
  assert.equal(r.labelMap.size + r.localKeys.size, 0);
  assert.equal(imported, 0, "music-metadata is loaded with nothing to walk");
  const missing = treeDeps(tree, { importMetadata: async () => { throw new Error("Cannot find module"); } });
  const r2 = (await quietly(() => buildFileLabelMap(missing))).value;
  assert.equal(r2.labelMap.size, 0);
  assert.ok(!missing.calls.some(c => c[0] === "publishFileYears"), "dates published from a walk that never ran");
});

test("a walk that broke off publishes no dates (v1.8.63)", async () => {
  const files = {};
  for (let i = 0; i < 50; i++) files["Artist/Album " + i + "/01.flac"] = meta({ album: "Album " + i, albumartist: "Artist", year: 2000 });
  const d = treeDeps(musicTree(files));
  const { value: r, err } = await quietly(() => buildFileLabelMap(d, () => { throw new Error("progress failed"); }));
  assert.ok(err.some(l => l.includes("the /music walk broke off")), "a broken-off walk is not said");
  assert.ok(!d.calls.some(c => c[0] === "publishFileYears"), "a broken-off walk's dates were published");
  assert.ok(r.localKeys.size > 0, "what the walk did read is still returned");
});

// ---------------------------------------------------------------------------
// runFileMetadataScan — the job around the walk
// ---------------------------------------------------------------------------

test("the walk job: not without /music or a library; then the walk, its keys, the years, the day lookups, in order", async () => {
  const tree = musicTree({ "A/B/01.flac": meta({ album: "B", albumartist: "A", label: ["Label B"] }) });
  const empty = treeDeps(tree);
  await quietly(() => createFileScan(empty).runFileMetadataScan("test"));
  assert.equal(empty.calls.length, 0, "the walk ran on an empty library");

  const d = treeDeps(tree, { albumIndex: { albums: [album("B", "A")], count: 1, building: null } });
  const scan = createFileScan(d);
  const { out } = await quietly(() => scan.runFileMetadataScan("test"));
  const order = d.calls.map(c => c[0]).filter(n => ["setLocalAlbumKeys", "harvestAlbumYears", "kickReleaseDayFill"].includes(n));
  assert.deepEqual(order, ["setLocalAlbumKeys", "harvestAlbumYears", "kickReleaseDayFill"]);
  assert.deepEqual(d.calls.find(c => c[0] === "harvestAlbumYears"), ["harvestAlbumYears", "file tags"]);
  assert.deepEqual(d.calls.find(c => c[0] === "kickReleaseDayFill"), ["kickReleaseDayFill", "after the /music walk", true]);
  assert.equal(scan.lastFileLabelMap().get("b||a"), "Label B");
  assert.ok(scan.lastFileBandcampMap() instanceof Map);
  assert.equal(scan.fileScanRunning(), false);
  assert.ok(out.includes("[files] tag scan complete (test)"));
});

test("the walk job runs once at a time, and a failure is logged and frees it", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let imports = 0;
  const d = deps({ albumIndex: { albums: [], count: 1, building: null },
    importMetadata: async () => { imports++; await gate; return { parseFile: async () => ({}) }; } });
  const scan = createFileScan(d);
  const { err } = await quietly(async () => {
    const first = scan.runFileMetadataScan("one");
    assert.equal(scan.fileScanRunning(), true);
    const second = scan.runFileMetadataScan("two");
    assert.equal(imports, 1, "a second walk started while the first ran");
    release();
    await Promise.all([first, second]);
  });
  assert.equal(scan.fileScanRunning(), false);
  assert.equal(err.length, 0);

  const tree = musicTree({ "A/B/01.flac": meta({ album: "B", albumartist: "A" }) });
  const failing = treeDeps(tree, { albumIndex: { albums: [], count: 1, building: null },
    setLocalAlbumKeys: () => { throw new Error("disk full"); } });
  const s2 = createFileScan(failing);
  const r = await quietly(() => s2.runFileMetadataScan());
  assert.ok(r.err.includes("[files] tag scan failed: disk full"));
  assert.equal(s2.fileScanRunning(), false, "a failed walk blocks every walk after it");
});

// ---------------------------------------------------------------------------
// runLabelsIndexScan — the label scan
// ---------------------------------------------------------------------------

test("Labels off: the scan does nothing at all", async () => {
  const d = deps({ labelsEnabled: () => false, albumIndex: { albums: [album("X", "Y")], count: 1, building: null } });
  await quietly(() => createLabelScan(d).runLabelsIndexScan(true));
  assert.deepEqual(d.calls, []);
  assert.equal(d.labelsIndex.building, false);
});

test("while Roon imports, an automatic scan waits and a forced one does not", async () => {
  const d = deps({ libraryIsImporting: async () => true, albumIndex: { albums: [], count: 1, building: null } });
  const s = createLabelScan(d);
  await quietly(() => s.runLabelsIndexScan());
  assert.deepEqual(d.calls, [["log", "[labels] scan deferred — Roon library is importing"]]);
  await quietly(() => s.runLabelsIndexScan(true));
  assert.ok(d.calls.some(c => c[0] === "seedLabelsFromCache"), "a forced scan waited for the import");
});

test("every album cached: the scan says so, stamps its time and asks nobody", async () => {
  const d = deps({ albumIndex: { albums: [album("X", "Y")], count: 1, building: null } });
  d.labelDiskCache.set("x||y", "Cached");
  await quietly(() => createLabelScan(d).runLabelsIndexScan());
  assert.deepEqual(lookups(d.calls), []);
  assert.ok(d.calls.some(c => c[0] === "saveLastScanTime"));
  assert.ok(d.labelsIndex.builtAt > 0);
  assert.equal(d.labelsIndex.building, false);
  assert.match(d.calls.filter(c => c[0] === "log").pop()[1], /^\[labels\] scan: all albums already cached/);
});

test("the cascade (a /music library): files, then Bandcamp, iTunes, TheAudioDB, MusicBrainz, Discogs — each asked only for the last one's misses", async () => {
  const tree = musicTree({
    "A/Files/01.flac": meta({ album: "Files", albumartist: "A", label: ["Tag Label"] }),
    "A/Camp/01.flac": meta({ album: "Camp", albumartist: "A", comment: ["https://a.bandcamp.com/album/camp"] }),
  });
  const albums = ["Files", "Camp", "Tunes", "Audio", "Brainz", "Nowhere"].map(t => album(t, "A"));
  const d = treeDeps(tree, {
    albumIndex: { albums, count: albums.length, building: null },
    fetchLabelFromBandcamp: async (url) => { d.calls.push(["bandcamp", url]); return { label: "Camp Label", year: "2001" }; },
    fetchLabelFromiTunes: async (t) => { d.calls.push(["itunes", t]); return t === "Tunes" ? "iTunes Label" : null; },
    fetchLabelFromTheAudioDB: async (t) => { d.calls.push(["tadb", t]); return t === "Audio" ? "TADB Label" : null; },
    fetchLabelFromMusicBrainz: async (t) => { d.calls.push(["mb", t]);
      return t === "Brainz" ? { label: "MB Label", mbid: "mbid-1", year: "1990" } : null; },
  });
  const s = createLabelScan(d);
  await quietly(() => s.runFileMetadataScan("test"));
  d.calls.length = 0;
  const { out } = await quietly(() => s.runLabelsIndexScan());
  assert.deepEqual(lookups(d.calls), [
    "bandcamp:https://a.bandcamp.com/album/camp",
    "itunes:Tunes", "itunes:Audio", "itunes:Brainz", "itunes:Nowhere",
    "tadb:Audio", "tadb:Brainz", "tadb:Nowhere",
    "mb:Brainz", "mb:Nowhere",
    "discogs:Nowhere",
  ]);
  const named = d.calls.filter(c => c[0] === "setLabelName").map(c => c[1] + "=" + c[2]);
  assert.deepEqual(named, ["files||a=Tag Label", "camp||a=Camp Label", "tunes||a=iTunes Label",
    "audio||a=TADB Label", "brainz||a=MB Label"]);
  assert.ok(d.calls.some(c => c[0] === "setLabelMbid" && c[2] === "mbid-1"), "MusicBrainz's label id is not kept");
  assert.ok(d.calls.some(c => c[0] === "setAlbumYear" && c[1] === "brainz||a" && c[2] === "1990"));
  assert.ok(out.includes("[labels] scan complete: 5 labels found"));
  assert.equal(d.labelsIndex.count, 5);
  assert.equal(d.labelsIndex.building, false);
  await new Promise(r => { setImmediate(r); });
  assert.deepEqual(d.calls.filter(c => c[0].startsWith("kick")).map(c => c[0]),
    ["kickFanArtFetches", "kickDiscogsLogoFetches"], "the logo fetches do not follow a finished scan");
});

test("a streaming-only library asks Qobuz between iTunes and TheAudioDB, and no Bandcamp", async () => {
  const albums = ["Q1", "Q2"].map(t => album(t, "S"));
  const d = deps({
    musicDirMounted: () => false,
    albumIndex: { albums, count: 2, building: null },
    fetchQobuz: async (t) => { d.calls.push(["qobuz", t]); return t === "Q1" ? { label: "Qobuz Label", year: "2010" } : null; },
  });
  await quietly(() => createLabelScan(d).runLabelsIndexScan());
  assert.deepEqual(lookups(d.calls), ["itunes:Q1", "itunes:Q2", "qobuz:Q1", "qobuz:Q2", "tadb:Q2", "mb:Q2", "discogs:Q2"]);
});

test("iTunes refusing (429/403) ends the iTunes pass at once; the rest go on to TheAudioDB", async () => {
  const albums = ["I1", "I2", "I3", "I4"].map(t => album(t, "S"));
  const d = deps({ musicDirMounted: () => false, albumIndex: { albums, count: 4, building: null } });
  d.fetchLabelFromiTunes = async (t) => { d.calls.push(["itunes", t]); return d.ITUNES_BLOCKED; };
  const { out } = await quietly(() => createLabelScan(d).runLabelsIndexScan());
  assert.deepEqual(lookups(d.calls).filter(l => l.startsWith("itunes")), ["itunes:I1", "itunes:I2", "itunes:I3"],
    "iTunes was asked again after refusing (one batch of three is already in flight)");
  assert.deepEqual(lookups(d.calls).filter(l => l.startsWith("qobuz")), ["qobuz:I1", "qobuz:I2", "qobuz:I3", "qobuz:I4"]);
  assert.ok(out.some(l => l.startsWith("[labels] pass 1 (iTunes): rate-limited (429/403)")));
});

test("an unexpected error aborts the scan but never leaves it marked as running", async () => {
  const d = deps({ albumIndex: { albums: [album("E", "S")], count: 1, building: null },
    seedLabelsFromCache: () => { throw new Error("database is locked"); } });
  const { err } = await quietly(() => createLabelScan(d).runLabelsIndexScan());
  assert.ok(err.includes("[labels] scan aborted by unexpected error: database is locked"));
  assert.equal(d.labelsIndex.building, false, "a crashed scan blocks every scan after it");
  assert.ok(d.labelsIndex.builtAt > 0);
});
