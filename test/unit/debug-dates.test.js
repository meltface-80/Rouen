"use strict";
// ---------------------------------------------------------------------------
// The Release date report (lib/routes/debug-dates.js; out of index.js in v1.9.70-t9, and its test out of
// releasedays.test.js with it, unchanged): GET /api/debug/dates, the instrument for the next report of this kind. The
// sort's own functions are index.js's, read from it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const { createDateReport } = require("../../lib/routes/debug-dates");

const TEXT = ["normalize", "canonText", "canonArtist", "albumTitleVariants"];

test("releaseDateReport says why each album sits where it does", async (t) => {
  const albums = [
    { title: "Wild In The Streets", subtitle: "Clinic", nTitle: "wild in the streets", nArtist: "clinic",
      srcKeys: ["wild in streets||clinic"] },
    { title: "Ride Lonesome", subtitle: "Beck", nTitle: "ride lonesome", nArtist: "beck",
      srcKeys: ["ride lonesome||beck"] },
    { title: "Old One", subtitle: "Band", nTitle: "old one", nArtist: "band", srcKeys: ["old one||band"] },
    { title: "Nowhen", subtitle: "Band", nTitle: "nowhen", nArtist: "band", srcKeys: ["nowhen||band"] },
  ];
  const years = new Map([["wild in the streets||clinic", "2026"], ["ride lonesome||beck", "2026"],
                         ["old one||band", "1999"]]);
  const dates = new Map([["ride lonesome||beck", "2026-09-18"], ["old one||band", "1999-05"]]);
  const fakes = {
    albumIndex: { albums, count: albums.length, builtAt: 1 },
    albumYearCache: years, albumDateCache: dates,
    albumYearSource: new Map([["wild in the streets||clinic", "file"], ["ride lonesome||beck", "file"]]),
    albumDateSource: new Map([["ride lonesome||beck", "release"]]),
    dateFillTried: new Map([["wild in the streets||clinic", { ts: 1790000000000, day: null, year: "2026" }]]),
    // The order, as the real sort gives it for these dates.
    libraryView: () => [albums[1], albums[0], albums[2], albums[3]],
    albumSource: () => "local", sourceBadgesDistinguish: () => false, albumBadge: () => null,
    localAlbumKeys: new Set(["wild in streets||clinic"]),
    qobuzAlbumKeys: new Set(["ride lonesome||beck"]),
    roonServices: { qobuz: false, tidal: false },
    qobuzReady: () => true, tidalReady: () => false, claimingServices: () => [],
    _fileScanRunning: false,
    dateFillRunning: false, dateFillLastKick: 0,
    DATE_FILL_RETRY_MS: 30 * 864e5, DATE_FILL_RECENT_RETRY_MS: 3 * 864e5,
  };
  const X = loadIndexFunctions(
    ["albumDateOf", "albumYearOf", "albumYearKey", "releaseDayFillCandidates", "dateFillRetryMs"].concat(TEXT), fakes);
  // The report itself: lib/routes/debug-dates.js since v1.9.70-t9, given what index.js gives it.
  const R = { releaseDateReport: createDateReport({ normalize: X.normalize, libraryView: fakes.libraryView, albumIndex: () => fakes.albumIndex,
    albumYearKey: X.albumYearKey, albumDateOf: X.albumDateOf, albumYearCache: years, albumDateCache: dates,
    albumYearSource: fakes.albumYearSource, albumDateSource: fakes.albumDateSource, dateFillTried: fakes.dateFillTried,
    roonServices: () => fakes.roonServices, qobuzReady: fakes.qobuzReady, tidalReady: fakes.tidalReady, claimingServices: fakes.claimingServices,
    fileScanRunning: () => fakes._fileScanRunning, dateFill: () => ({ running: fakes.dateFillRunning, lastKick: fakes.dateFillLastKick }),
    releaseDayFillCandidates: X.releaseDayFillCandidates, albumBadge: fakes.albumBadge, albumSource: fakes.albumSource,
    localAlbumKeys: () => fakes.localAlbumKeys, qobuzAlbumKeys: () => fakes.qobuzAlbumKeys }) };

  const r = R.releaseDateReport({});
  await t.test("coverage: to the day, to the month, year only, undated", () => {
    assert.deepEqual(r.coverage, { albums: 4, to_the_day: 1, to_the_month: 1, year_only: 1, undated: 1 });
  });

  await t.test("the services question is answered from both sides", () => {
    assert.deepEqual(r.roon_services, { qobuz: false, tidal: false });
    assert.deepEqual(r.extension_signed_in, { qobuz: true, tidal: false });
  });

  await t.test("an album looked up by name shows its position and every reason", () => {
    const q = R.releaseDateReport({ q: "clinic" });
    assert.equal(q.albums.length, 1);
    const a = q.albums[0];
    assert.equal(a.position, 2);
    assert.equal(a.year, "2026");
    assert.equal(a.year_source, "file");
    assert.equal(a.date, null, "a year-only album reported a date");
    assert.equal(a.sorts_as, "2026-00-00");
    assert.equal(a.local_file, true);
    assert.equal(a.qobuz_favourite, false);
    assert.deepEqual(a.musicbrainz_lookup,
      { at: new Date(1790000000000).toISOString(), year: "2026", day: null });
  });

  await t.test("the default list is the top of the newest-first order", () => {
    assert.deepEqual(r.albums.map(a => a.title), ["Ride Lonesome", "Wild In The Streets", "Old One", "Nowhen"]);
    assert.equal(r.albums[0].date_source, "release");
    assert.equal(r.albums[0].qobuz_favourite, true);
    assert.equal(R.releaseDateReport({ limit: "1" }).albums.length, 1);
  });
});
