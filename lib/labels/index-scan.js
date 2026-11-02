// @ts-check
"use strict";
/*
 * index-scan.js — the label scan (runLabelsIndexScan), moved out of index.js unchanged in v1.9.72-t60
 * (dev/quality.md, step 3). index.js keeps the label stores, the lookups and their rate limits, and hands them in
 * (./index.js has the list); the /music walk that feeds pass 0 is ./file-walk.js.
 *
 * Background scan — multi-pass label lookup pipeline.
 * Pass 0: File metadata (if /music mounted) — most authoritative.
 * Pass 1: iTunes (3 concurrent, 500ms between batches, abort on 429/403).
 * Pass Q: Qobuz (streaming-only libraries, i.e. no /music mount) — the user's
 *         actual source, so it resolves most iTunes-misses in one pass and
 *         keeps them out of the slow TADB→MB→Discogs cascade.
 * Pass 2: TheAudioDB (serial, 1 req/sec).
 * Pass 3: MusicBrainz (serial, rate-limited) — broad coverage.
 * Pass 4: Discogs (serial, rate-limited) — last resort.
 * Results saved to SQLite — scan only needs to run once per album.
 * Errors are logged to data/labels-scan.log. On excessive errors in a pass
 * the scan finishes early; the next 12-hour auto-rescan will retry.
 */
const { runDiscogsPass } = require("../labels-discogs-pass");

/**
 * @param {import("./index").IndexScanDeps} d
 * @returns {{ runLabelsIndexScan: (force?: boolean) => Promise<void> }}
 */
function createLabelsIndexScan(d) {
  const { DEBUG, albumIndex, labelsIndex, labelDiskCache, labelsOverride, labelMbidCache, releaseLookup, discogs,
    ITUNES_BLOCKED, lastFileLabelMap, lastFileBandcampMap, libraryIsImporting, appendLabelsLog, seedLabelsFromCache,
    labelGroupKey, setLabelName, rebuildLabelsMap, normalize, albumsNeedingRelease, saveLastScanTime, musicDirMounted,
    isLikelyNotALabel, labelsIndexAddAlbum, fetchLabelMbidFromMusicBrainz, setLabelMbid, bandcampWait,
    fetchLabelFromBandcamp, setAlbumYear, fetchLabelFromiTunes, itunesBatchWait, fetchQobuz, fetchLabelFromTheAudioDB,
    fetchLabelFromMusicBrainz, bumpLibraryMeta, kickFanArtFetches, kickDiscogsLogoFetches } = d;

  /** @param {boolean} [force]  an explicit Rescan: skips the wait for Roon's import to settle */
  async function runLabelsIndexScan(force) {
    // At the very top, before any label state is touched, any label log line is
    // written, and any cache is seeded. Off means this function does nothing at
    // all — not "does the harmless half".
    const labelsEnabled = d.labelsEnabled();
    if (!labelsEnabled) return;
    if (labelsIndex.building) return;
    // Never scan while Roon is importing — offsets are still moving and it piles
    // external fetches onto the churn. `force` (an explicit user "Rescan") skips
    // the check; automatic triggers (12h timer, lazy ensure, post-save) defer and
    // resume on the next natural trigger once Roon settles.
    if (!force && await libraryIsImporting()) {
      appendLabelsLog("[labels] scan deferred — Roon library is importing");
      return;
    }
    if (albumIndex.count === 0) {
      if (albumIndex.building) { try { await albumIndex.building; } catch (e) { /* albumIndex build failed — safe to continue; the count===0 check below will abort */ } }
      if (albumIndex.count === 0) return;
    }
    labelsIndex.building = true;
    labelsIndex.progress = 0;

    try {

    seedLabelsFromCache();

    // The tag walk has already run (runFileMetadataScan, above this call). Its
    // label names are handed over here so the cascade below only has to chase
    // what the files could not answer.
    const fileLabelMap = lastFileLabelMap() || new Map();
    const bandcampMap  = lastFileBandcampMap() || new Map();

    if (fileLabelMap.size) {
      let overrideCount = 0;
      for (const [key, fileLabel] of fileLabelMap) {
        const cached = labelDiskCache.get(key);
        if (cached && labelGroupKey(cached) !== labelGroupKey(fileLabel)) {
          setLabelName(key, fileLabel);
          overrideCount++;
        }
      }
      if (overrideCount) {
        rebuildLabelsMap();
        appendLabelsLog("[labels:files] corrected " + overrideCount + " stale cache entries from file tags");
        if (DEBUG) console.log("[labels:files] corrected", overrideCount, "stale cache entries from file tags");
      }
    }

    const toScan = albumIndex.albums.filter(al => {
      const key = normalize(al.title) + "||" + normalize(al.subtitle);
      return !labelsOverride.has(key) && !labelDiskCache.has(key);
    });
    // The albums whose tags gave no catalogue number, not yet asked of Discogs
    // (v1.9.67-t2): pass 4 asks for them after the label misses, a token given.
    const needsRelease = d.discogsToken() ? albumsNeedingRelease() : [];

    if (!toScan.length && !needsRelease.length) {
      labelsIndex.building = false;
      labelsIndex.builtAt = Date.now();
      saveLastScanTime();
      const msg = "[labels] scan: all albums already cached (" + labelsIndex.count + " labels)";
      if (DEBUG) console.log(msg);
      appendLabelsLog(msg);
      return;
    }

    const alreadyDone = albumIndex.albums.length - toScan.length;
    const total = albumIndex.albums.length;
    const scanCount = toScan.length;
    // Progress helper — weights each pass so bar moves throughout the full scan.
    // Passes 0+1 (files+iTunes) share 20%; TADB 30%; MB 30%; Discogs 20%.
    // basePct = fraction of library already cached.
    // Within each pass: interpolate between the pass start and end percentages.
    const basePct = total > 0 ? alreadyDone / total : 0;
    const scanPct = 1 - basePct; // fraction of bar dedicated to this scan
    // Streaming-only libraries (no /music mount) get an extra Qobuz pass between
    // iTunes and TheAudioDB. Qobuz is the user's actual source, so it resolves
    // most iTunes-misses in one pass instead of walking the slow serial
    // TADB→MB→Discogs cascade. The pass-index map and band weights shift to give
    // the Qobuz pass its own slice of the progress bar.
    const streamingOnly = !musicDirMounted();
    const PASS = streamingOnly
      ? { files: 0, itunes: 1, qobuz: 2, tadb: 3, mb: 4, discogs: 5 }
      : { files: 0, itunes: 1, bandcamp: 2, tadb: 3, mb: 4, discogs: 5 };
    // cumulative pass weights (fraction of the scan portion of the bar).
    const PASS_ENDS = streamingOnly
      ? [0.05, 0.15, 0.45, 0.60, 0.85, 1.00] // files, iTunes, Qobuz, TADB, MB, Discogs
      : [0.10, 0.20, 0.30, 0.55, 0.80, 1.00]; // files, iTunes, Bandcamp, TADB, MB, Discogs
    function passProgress(passIdx, pos, passTotal) {
      const start = passIdx > 0 ? PASS_ENDS[passIdx - 1] : 0;
      const end = PASS_ENDS[passIdx];
      const frac = passTotal > 0 ? pos / passTotal : 1;
      return Math.min(1, basePct + scanPct * (start + (end - start) * frac));
    }
    let done = 0;

    const startMsg = "[labels] scan started: " + toScan.length + " albums to look up (" + alreadyDone + " already cached)" + (needsRelease.length ? ", " + needsRelease.length + " to ask Discogs for a catalogue number" : "");
    console.log(startMsg);
    appendLabelsLog(startMsg);

    const saveLabelEntry = async (key, label, knownMbid, al) => {
      if (isLikelyNotALabel(label)) return;
      setLabelName(key, label);
      labelsIndexAddAlbum(label, al);
      const gk = labelGroupKey(label);
      if (gk && !labelMbidCache.has(gk)) {
        const resolvedMbid = knownMbid || await fetchLabelMbidFromMusicBrainz(label);
        if (resolvedMbid) {
          setLabelMbid(gk, resolvedMbid);
          const entry = labelsIndex.map.get(gk);
          if (entry && !entry.mbid) entry.mbid = resolvedMbid;
        } else {
          // Cache null so we don't re-query MusicBrainz for this label every scan.
          // Not persisted to DB — retried on container restart.
          labelMbidCache.set(gk, null);
        }
      }
    };

    // Fill in file labels for uncached albums using the map already built above.
    const needsApiScan = [];
    for (const al of toScan) {
      const key = normalize(al.title) + "||" + normalize(al.subtitle);
      const fileLabel = fileLabelMap.get(key);
      if (fileLabel) {
        await saveLabelEntry(key, fileLabel, null, al);
        done++;
        labelsIndex.progress = passProgress(PASS.files, done, scanCount);
      } else {
        needsApiScan.push(al);
      }
    }
    if (fileLabelMap.size) {
      const fileMsg = "[labels] pass 0 (files): " + fileLabelMap.size + " found in tags, " + needsApiScan.length + " still need API";
      if (DEBUG) console.log(fileMsg);
      appendLabelsLog(fileMsg);
    }

    // Pass 0B: Bandcamp — local library only (requires /music mount for COMMENT tag extraction).
    // Fetches album pages for purchases where the downloader embedded a bandcamp.com URL in tags.
    // Serial with 1.5 s between requests; circuit breaker at 5 consecutive errors or any 429/403.
    const needsItunes = [];
    if (!streamingOnly && bandcampMap.size) {
      const bcQueue = [], bcSkip = [];
      for (const al of needsApiScan) {
        (bandcampMap.has(normalize(al.title) + "||" + normalize(al.subtitle)) ? bcQueue : bcSkip).push(al);
      }
      needsItunes.push(...bcSkip);
      if (bcQueue.length) {
        const bcStartMsg = "[labels] pass 0B (Bandcamp): " + bcQueue.length + " albums with embedded URLs";
        if (DEBUG) console.log(bcStartMsg);
        appendLabelsLog(bcStartMsg);
        let bcErrors = 0, bcConsec = 0, bcAborted = false;
        let bcResolved = 0;
        const bcDeadline = Date.now() + 5 * 60 * 1000;
        for (let bi = 0; bi < bcQueue.length; bi++) {
          if (bcAborted) { needsItunes.push(...bcQueue.slice(bi)); break; }
          const al = bcQueue[bi];
          const key = normalize(al.title) + "||" + normalize(al.subtitle);
          const url = bandcampMap.get(key);
          try {
            await bandcampWait();
            const result = await fetchLabelFromBandcamp(url, al.subtitle);
            if (result && result.label && !isLikelyNotALabel(result.label)) {
              await saveLabelEntry(key, result.label, null, al);
              if (result.year) setAlbumYear(key, result.year, { src: "release" });
              bcResolved++;
              bcConsec = 0;
            } else {
              if (result && result.year) setAlbumYear(key, result.year, { src: "release" });
              needsItunes.push(al);
              bcConsec = 0;
            }
          } catch (e) {
            bcErrors++;
            bcConsec++;
            needsItunes.push(al);
            appendLabelsLog("[labels:bandcamp] error for \"" + al.title + "\": " + e.message);
            if (e.message && (e.message.includes("429") || e.message.includes("403"))) {
              bcAborted = true;
              appendLabelsLog("[labels:bandcamp] rate limited — aborting Bandcamp pass");
            } else if (bcConsec >= 5) {
              bcAborted = true;
              appendLabelsLog("[labels:bandcamp] 5 consecutive errors — aborting Bandcamp pass");
            }
          }
          labelsIndex.progress = passProgress(PASS.bandcamp, bi + 1, bcQueue.length);
          if (!bcAborted && Date.now() > bcDeadline) {
            bcAborted = true;
            needsItunes.push(...bcQueue.slice(bi + 1));
            appendLabelsLog("[labels:bandcamp] 5-minute time limit reached — remainder forwarded to iTunes");
            break;
          }
        }
        const bcMsg = "[labels] pass 0B (Bandcamp): complete, " + bcResolved + " resolved, " +
          needsItunes.length + " forwarded to iTunes" +
          (bcAborted ? " (aborted)" : "") + (bcErrors ? ", " + bcErrors + " errors total" : "");
        if (DEBUG) console.log(bcMsg);
        appendLabelsLog(bcMsg);
      }
    } else {
      needsItunes.push(...needsApiScan);
    }

    // Pass 1: iTunes — 3 concurrent, 500ms between batches.
    // Aborts the entire pass on first 429/403 to avoid getting IP-blocked.
    const needsAudioDB = [];
    const ITUNES_BATCH = 3;
    let itunesAborted = false;
    let itunesErrors = 0;
    const itunesCheck = async (al) => {
      if (itunesAborted) { needsAudioDB.push(al); return; }
      const key = normalize(al.title) + "||" + normalize(al.subtitle);
      try {
        const label = await fetchLabelFromiTunes(al.title, al.subtitle);
        if (label === ITUNES_BLOCKED) {
          itunesAborted = true;
          const msg = "[labels] pass 1 (iTunes): rate-limited (429/403) — aborting iTunes pass, will retry next scan window";
          console.log(msg);
          appendLabelsLog(msg);
          needsAudioDB.push(al);
        } else if (label && !isLikelyNotALabel(label)) { await saveLabelEntry(key, label, null, al); }
        else { needsAudioDB.push(al); }
      } catch (e) {
        itunesErrors++;
        appendLabelsLog("[labels:itunes] error for \"" + al.title + "\": " + e.message);
        needsAudioDB.push(al);
      }
      done++;
      labelsIndex.progress = passProgress(PASS.itunes, done, scanCount);
    };
    for (let i = 0; i < needsItunes.length; i += ITUNES_BATCH) {
      if (itunesAborted) { needsAudioDB.push(...needsItunes.slice(i)); break; }
      await itunesBatchWait();
      await Promise.allSettled(needsItunes.slice(i, i + ITUNES_BATCH).map(itunesCheck));
    }
    if (needsItunes.length) {
      const itunesMsg = "[labels] pass 1 (iTunes): done, " + needsAudioDB.length + " forwarded to next pass" +
        (itunesAborted ? " (aborted — rate limited)" : "") +
        (itunesErrors ? ", " + itunesErrors + " errors" : "");
      if (DEBUG) console.log(itunesMsg);
      appendLabelsLog(itunesMsg);
    }

    // Pass Q (Qobuz) — streaming-only libraries only (no /music mount).
    // Qobuz is the user's actual streaming source, so it resolves most albums
    // iTunes missed in a single pass; every hit here skips the slow serial
    // TADB→MB→Discogs cascade. Serial (700ms/req, two requests per album) with
    // the same 10-consecutive-error circuit breaker as the other network passes.
    // fetchQobuz already persists labels to labelDiskCache/labelsIndex; routing
    // hits through saveLabelEntry additionally resolves the label MBID for logos.
    let needsTadb = needsAudioDB;
    if (streamingOnly && needsAudioDB.length) {
      needsTadb = [];
      const qStartMsg = "[labels] pass Q (Qobuz, streaming-only): " + needsAudioDB.length + " albums";
      if (DEBUG) console.log(qStartMsg);
      appendLabelsLog(qStartMsg);
      let qobuzErrors = 0;
      let qobuzConsec = 0;
      let qobuzAborted = false;
      for (let qi = 0; qi < needsAudioDB.length; qi++) {
        if (qobuzAborted) {
          needsTadb.push(...needsAudioDB.slice(qi));
          labelsIndex.progress = passProgress(PASS.qobuz, needsAudioDB.length, needsAudioDB.length);
          break;
        }
        const al = needsAudioDB[qi];
        const key = normalize(al.title) + "||" + normalize(al.subtitle);
        try {
          const q = await fetchQobuz(al.title, al.subtitle);
          if (q && q.year) setAlbumYear(key, q.year, { src: "release" });
          if (q && q.label && !isLikelyNotALabel(q.label)) { await saveLabelEntry(key, q.label, null, al); qobuzConsec = 0; }
          else { needsTadb.push(al); qobuzConsec = 0; }
        } catch (e) {
          qobuzErrors++;
          qobuzConsec++;
          needsTadb.push(al);
          appendLabelsLog("[labels:qobuz] error for \"" + al.title + "\": " + e.message);
          if (qobuzConsec >= 10) {
            qobuzAborted = true;
            const msg = "[labels] pass Q (Qobuz): " + qobuzConsec + " consecutive errors — aborting, will retry next scan window";
            console.log(msg);
            appendLabelsLog(msg);
          }
        }
        labelsIndex.progress = passProgress(PASS.qobuz, qi + 1, needsAudioDB.length);
        if ((qi + 1) % 100 === 0) {
          appendLabelsLog("[labels] pass Q (Qobuz): " + (qi + 1) + "/" + needsAudioDB.length + " done so far");
        }
      }
      const qMsg = "[labels] pass Q (Qobuz): complete, " + needsTadb.length + " forwarded to TheAudioDB" +
        (qobuzAborted ? " (aborted — consecutive errors)" : "") +
        (qobuzErrors ? ", " + qobuzErrors + " errors total" : "");
      if (DEBUG) console.log(qMsg);
      appendLabelsLog(qMsg);
    }

    // Pass 2: TheAudioDB — serial (1 req/sec rate limit on the free API).
    // Circuit breaker: 10 consecutive errors → abort pass, wait for next scan window.
    if (needsTadb.length) {
      const tadbStartMsg = "[labels] pass 2 (TheAudioDB): " + needsTadb.length + " albums";
      if (DEBUG) console.log(tadbStartMsg);
      appendLabelsLog(tadbStartMsg);
    }
    const needsMB = [];
    let tadbErrors = 0;
    let tadbConsec = 0;
    let tadbAborted = false;
    for (let ti = 0; ti < needsTadb.length; ti++) {
      if (tadbAborted) {
        needsMB.push(...needsTadb.slice(ti));
        labelsIndex.progress = passProgress(PASS.tadb, needsTadb.length, needsTadb.length);
        break;
      }
      const al = needsTadb[ti];
      const key = normalize(al.title) + "||" + normalize(al.subtitle);
      try {
        const label = await fetchLabelFromTheAudioDB(al.title, al.subtitle);
        if (label) { await saveLabelEntry(key, label, null, al); tadbConsec = 0; }
        else { needsMB.push(al); tadbConsec = 0; }
      } catch (e) {
        tadbErrors++;
        tadbConsec++;
        needsMB.push(al);
        if (tadbConsec >= 10) {
          tadbAborted = true;
          const msg = "[labels] pass 2 (TheAudioDB): " + tadbConsec + " consecutive errors — aborting, will retry next scan window";
          console.log(msg);
          appendLabelsLog(msg);
        }
      }
      labelsIndex.progress = passProgress(PASS.tadb, ti + 1, needsTadb.length);
      if ((ti + 1) % 100 === 0) {
        appendLabelsLog("[labels] pass 2 (TheAudioDB): " + (ti + 1) + "/" + needsTadb.length + " done so far");
      }
    }
    if (needsTadb.length) {
      const tadbMsg = "[labels] pass 2 (TheAudioDB): complete, " + needsMB.length + " forwarded to MB" +
        (tadbAborted ? " (aborted — consecutive errors)" : "") +
        (tadbErrors ? ", " + tadbErrors + " errors total" : "");
      if (DEBUG) console.log(tadbMsg);
      appendLabelsLog(tadbMsg);
    }

    // Pass 3: MusicBrainz for remaining misses — serial to respect rate limit.
    // Circuit breaker: 10 consecutive errors → abort pass.
    if (needsMB.length) {
      const mbStartMsg = "[labels] pass 3 (MusicBrainz): " + needsMB.length + " albums";
      if (DEBUG) console.log(mbStartMsg);
      appendLabelsLog(mbStartMsg);
    }
    const needsDiscogs = [];
    let mbErrors = 0;
    let mbConsec = 0;
    let mbAborted = false;
    for (let mi = 0; mi < needsMB.length; mi++) {
      if (mbAborted) {
        needsDiscogs.push(...needsMB.slice(mi));
        labelsIndex.progress = passProgress(PASS.mb, needsMB.length, needsMB.length);
        break;
      }
      const al = needsMB[mi];
      const key = normalize(al.title) + "||" + normalize(al.subtitle);
      try {
        const mbResult = await fetchLabelFromMusicBrainz(al.title, al.subtitle);
        if (mbResult) {
          await saveLabelEntry(key, mbResult.label, mbResult.mbid, al);
          if (mbResult.year) setAlbumYear(key, mbResult.year, { src: "release" });
          mbConsec = 0;
        }
        else { needsDiscogs.push(al); mbConsec = 0; }
      } catch (e) {
        mbErrors++;
        mbConsec++;
        needsDiscogs.push(al);
        if (mbConsec >= 10) {
          mbAborted = true;
          const msg = "[labels] pass 3 (MusicBrainz): " + mbConsec + " consecutive errors — aborting, will retry next scan window";
          console.log(msg);
          appendLabelsLog(msg);
        }
      }
      labelsIndex.progress = passProgress(PASS.mb, mi + 1, needsMB.length);
      if ((mi + 1) % 100 === 0) {
        appendLabelsLog("[labels] pass 3 (MusicBrainz): " + (mi + 1) + "/" + needsMB.length + " done so far");
      }
    }
    if (needsMB.length) {
      const mbMsg = "[labels] pass 3 (MusicBrainz): complete, " + needsDiscogs.length + " forwarded to Discogs" +
        (mbAborted ? " (aborted — consecutive errors)" : "") +
        (mbErrors ? ", " + mbErrors + " errors total" : "");
      if (DEBUG) console.log(mbMsg);
      appendLabelsLog(mbMsg);
    }

    // Pass 4: Discogs (lib/labels-discogs-pass.js) — serial, rate-limited, the
    // last resort for a label; and, since v1.9.67-t2, the catalogue number and
    // kind of every album whose tags gave none. Circuit breaker: 10 consecutive
    // errors → abort pass. One answer serves a label miss for both.
    const labelKeyOf = (al) => normalize(al.title) + "||" + normalize(al.subtitle);
    // A label miss Discogs already answered with nothing is not asked again either (the review); a Force rescan asks everyone.
    const discogsQueue = needsDiscogs.filter(al => !releaseLookup.has(labelKeyOf(al))).map(al => ({ al, key: labelKeyOf(al), wantLabel: true }));
    const queued = new Set(discogsQueue.map(q => q.key));
    for (const al of needsRelease) {
      const key = labelKeyOf(al);
      if (!queued.has(key)) { queued.add(key); discogsQueue.push({ al, key, wantLabel: false }); }
    }
    const discogsDone = await runDiscogsPass(discogsQueue, {
      release: (title, artist) => discogs.release(title, artist),
      onLabel: (key, label, al) => saveLabelEntry(key, label, null, al),
      onRelease: (al, rel) => releaseLookup.keep(al, rel),
      tried: (key) => releaseLookup.mark(key),
      // Every label cached (scanCount 0): the bar is the pass's own, the weights would read 100% from its first album.
      progress: (done, total) => { labelsIndex.progress = scanCount ? passProgress(PASS.discogs, done, total) : done / total; },
      log: (line) => { if (DEBUG) console.log(line); appendLabelsLog(line); },
      warn: (line) => { console.log(line); appendLabelsLog(line); },
    });
    if (discogsDone.releases) bumpLibraryMeta();   // the Library's Album type counts and label order follow

    labelsIndex.building = false;
    labelsIndex.builtAt  = Date.now();
    saveLastScanTime();
    labelsIndex.count    = labelsIndex.map.size;
    const doneMsg = "[labels] scan complete: " + labelsIndex.count + " labels found";
    console.log(doneMsg);
    appendLabelsLog(doneMsg);
    kickFanArtFetches()
      .then(() => kickDiscogsLogoFetches())
      .catch(e => { if (DEBUG) console.error("[labels] logo fetch error:", e.message); });

    } catch (e) {
      // Any unexpected exception — always reset so future scans aren't permanently blocked.
      labelsIndex.building = false;
      labelsIndex.builtAt = Date.now();
      saveLastScanTime();
      const errMsg = "[labels] scan aborted by unexpected error: " + e.message;
      console.error(errMsg);
      appendLabelsLog(errMsg);
    }
  }

  return { runLabelsIndexScan };
}

module.exports = { createLabelsIndexScan };
