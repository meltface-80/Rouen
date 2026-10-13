"use strict";
// ---------------------------------------------------------------------------
// v1.9.16 of dev/design/roon-native.md stage 0: the album pages by Location,
// against a fake Core (test/lib/fake-roon-core.js) over real TCP — what the
// pages are taken to hold, when a source is compared with its tracks, what
// ContentSource says, and that every page is still released once. The fake is
// not evidence of how a real Core delivers pages (§6); the owner's run is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { startFakeCore } = require("../lib/fake-roon-core");
const { runProbe } = require("../../lib/roon-direct/probe");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY, fast, assertTidy } = require("../lib/roon-direct-fixtures");

// ---- v1.9.16: the album pages by Location -----------------------------------

test("pages that push only their rows: the albums are still gathered, by the rows' Data", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { rowsOnly: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  const tidal = out.locations.byLocation.find((l) => l.name === "TIDAL").paged;
  assert.equal(tidal.albums, 6);
  assert.deepEqual(tidal.via, { rows: 6, albumsPushed: 0 }, "THE one: how the Core delivers a page is reported");
  assert.match(out.locations.pagesVerdict, /^same:/);
  assertTidy(core.rec, out);
});

test("albums with no ContentSource: said so, not read as any source", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { noContentSource: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.match(out.locations.contentSourceVerdict, /^absent: none of the 8 albums paged carried a ContentSource/);
  assert.deepEqual(out.locations.byLocation.find((l) => l.name === "Music").paged.contentSource, { absent: 2 });
});

test("a ContentSource that names another source: disagrees, with the case", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { wrongContentSource: "local" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.match(out.locations.contentSourceVerdict, /^disagrees: 6 of 8 agree, 2 name another source, 0 carry none \(local album says 128; local album says 128\)/);
});

test("a Location with more albums than a probe pages through: counted, not paged, and not compared", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, maxAlbumsForPages: 3 }, fast));
  await core.idle();
  const tidal = out.locations.byLocation.find((l) => l.name === "TIDAL");
  assert.equal(tidal.albums, 6);
  assert.match(tidal.paged.note, /6 albums: more than the 3/);
  assert.match(out.locations.bySource.tidal.partial, /TIDAL: 6 albums: more than the 3/);
  assert.deepEqual(out.locations.bySource.local.same, 2);
  assertTidy(core.rec, out);
});

test("a Location whose pages come short: said so, and not compared with its tracks", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { shortAlbumPages: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 400 }));
  await core.idle();
  assert.match(out.locations.byLocation.find((l) => l.name === "Music").paged.note, /1 of 2 albums came as rows/);
  assert.match(out.locations.bySource.local.partial, /Music: 1 of 2 albums came as rows/, "THE one: a part of a Location's albums is not set against all of its tracks");
  assert.match(out.locations.pagesVerdict, /\(not compared: local, tidal\)$/);
  assert.doesNotMatch(out.locations.pagesVerdict, /^differ/);
  assertTidy(core.rec, out);
});

// ---- v1.9.16: the review's cases ----------------------------------------------
const { SIG } = require("../../lib/roon-direct/methods");
const QOBUZ_TOO = LIBRARY.concat([{ title: "Bloom", artist: "Beach House", source: "qobuz", tracks: 3 }]);

test("the album pages are read with the album query's own paging methods", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.equal(core.rec.signatures.filter((s) => s === SIG.albumRetainPage).length, 2, "Music's and TIDAL's one page each");
  assert.equal(core.rec.signatures.filter((s) => s === SIG.albumReleasePage).length, 2);
  assert.equal(SIG.albumReleasePage, "Sooloos.Broker.Api.VirtualAlbumLiteQuery::ReleasePage(int, Base.ResultCallback)");
});

test("the owner's shape: TIDAL holds none, TIDAL Library all — one source, compared whole", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { tidalLibrary: "all" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.equal(out.locations.byLocation.find((l) => l.name === "TIDAL").inferred !== undefined, true);
  assert.deepEqual(out.locations.bySource.tidal, { fromLocations: 6, fromTracks: 6, same: 6, onlyLocations: 0, onlyTracks: 0 });
  assert.match(out.locations.pagesVerdict, /^same: for /);
  assertTidy(core.rec, out);
});

test("a source split over two Locations, one of them short: the source is not compared", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { tidalLibrary: "split", shortAlbumPages: "TIDAL Library" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 400 }));
  await core.idle();
  assert.match(out.locations.bySource.tidal.partial, /TIDAL Library: 2 of 3 albums came as rows/,
    "THE one: TIDAL's whole Location is not set alone against all of TIDAL's tracks (a false 'differ')");
  assert.doesNotMatch(out.locations.pagesVerdict, /^differ/);
  assertTidy(core.rec, out);
});

test("albums only the tracks found are a difference, not hidden behind 'same'", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: QOBUZ_TOO, faults: { emptyLocation: "QOBUZ" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.deepEqual(out.locations.bySource.qobuz, { fromLocations: 0, fromTracks: 1, same: 0, onlyLocations: 0, onlyTracks: 1 });
  assert.match(out.locations.pagesVerdict, /^differ: qobuz 0 only by Location, 1 only by tracks/);
});

test("an album page the Core refuses: the Count stands, the page says why, the run is not ok", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { refuseAlbumPages: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  const music = out.locations.byLocation.find((l) => l.name === "Music");
  assert.equal(music.albums, 2, "THE one: a page that failed does not take the Count with it");
  assert.match(music.paged.error, /refused page 0: Refused/);
  assert.match(out.locations.verdict, /^filtered:/);
  assert.match(out.locations.bySource.local.partial, /Music: the Core refused page 0/);
  assert.equal(out.locations.ok, false);
  assert.equal(out.ok, false);
  assertTidy(core.rec, out);
});

test("tracks not read whole: a Location's albums are a one-page sample, never compared", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { silentTrackPages: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  assert.match(out.locations.bySource.local.partial, /Music: sampled 1 page/, "THE one: tracks partly seen are not a whole to compare with");
  assert.match(out.locations.contentSourceVerdict, /^agrees: every one of the 8/);
  assertTidy(core.rec, out);
});

test("album fields pushed after their rows: each page waits for them, and ContentSource is read", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { lateAlbumFieldsMs: 250 } });
  t.after(() => core.close());
  // No track paging: the albums have not been pushed before their pages.
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, maxTracksForAlbums: 0 }, fast));
  await core.idle();
  const music = out.locations.byLocation.find((l) => l.name === "Music").paged;
  assert.deepEqual(music.contentSource, { 1: 2 }, "THE one: read before the fields came, it would be 'absent'");
  assert.ok(music.titles.includes("Joni Mitchell — Blue"));
  assert.match(out.locations.contentSourceVerdict, /^agrees:/);
});

test("pages that push the albums but no rows: nothing is taken for an item, and it says how they came", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { noRows: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  const music = out.locations.byLocation.find((l) => l.name === "Music").paged;
  assert.deepEqual(music.via, { rows: 0, albumsPushed: 2 });
  assert.match(music.note, /0 of 2 albums came as rows/);
  assert.match(out.locations.bySource.local.partial, /Music: 0 of 2/);
  assertTidy(core.rec, out);
});

test("the page budget: spent, the next Location is counted and not paged", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, albumPageBudget: 1 }, fast));
  await core.idle();
  assert.equal(out.locations.byLocation.find((l) => l.name === "Music").paged.albums, 2);
  assert.match(out.locations.byLocation.find((l) => l.name === "TIDAL").paged.note, /page budget was spent/);
  assert.equal(out.locations.byLocation.find((l) => l.name === "TIDAL").albums, 6);
  assertTidy(core.rec, out);
});

// Two pages' worth of TIDAL albums (150), one track each.
const MANY = LIBRARY.slice(0, 2).concat(Array.from({ length: 150 }, (_, i) => ({ title: "T" + i, artist: "A", source: "tidal", tracks: 1 })));

test("a Location's first page short: its reading stops there, not a full wait per page", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: MANY, faults: { shortAlbumPages: "TIDAL" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  const tidal = out.locations.byLocation.find((l) => l.name === "TIDAL");
  assert.equal(tidal.paged.pages, 1, "THE one: the second page was not asked for after the first came short");
  assert.match(tidal.paged.note, /99 of 150 albums came as rows/);
  assertTidy(core.rec, out);
});

test("a Location whose source's tracks were not read whole: one page, a sample", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: MANY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, maxTracksForAlbums: 100 }, fast));
  await core.idle();
  const tidal = out.locations.byLocation.find((l) => l.name === "TIDAL");
  assert.equal(tidal.paged.pages, 1, "THE one: no whole to compare with, so no more than a sample");
  assert.equal(tidal.paged.albums, 100);
  assert.match(out.locations.bySource.tidal.partial, /sampled 1 page/);
  assertTidy(core.rec, out);
});

// ---- v1.9.17: a Location over the limit is sampled; covers -------------------

test("a Location with more albums than a probe compares: one page, a sample of what its albums say", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, maxAlbumsForPages: 3 }, fast));
  await core.idle();
  const tidal = out.locations.byLocation.find((l) => l.name === "TIDAL").paged;
  assert.equal(tidal.pages, 1, "THE one: sampled, not skipped — the owner's Qobuz library is 12,944 albums");
  assert.equal(tidal.albums, 6);
  assert.match(tidal.note, /6 albums: more than the 3 a probe compares; 1 page read as a sample/);
  assert.deepEqual(tidal.contentSource, { 128: 6 });
  assert.match(out.locations.bySource.tidal.partial, /a sample/, "a sample is never compared");
  assertTidy(core.rec, out);
});

test("each paged album's cover key is read, for stage 1 to match albums by", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  const music = out.locations.byLocation.find((l) => l.name === "Music").paged;
  assert.deepEqual(music.imageKeys, { carried: 2, unresolved: 0, of: 2 });
  assert.deepEqual(music.sample.map((a) => [a.title, a.by, a.contentSource, a.imageKey]).sort(),
    [["Blue", "Joni Mitchell", 1, "img1"], ["Kind of Blue", "Miles Davis", 1, "img0"]]);
});

test("a sample is one page, however many pages the Location holds", async (t) => {
  // 150 TIDAL albums: two pages' worth, over a limit of 3.
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: MANY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, maxAlbumsForPages: 3 }, fast));
  await core.idle();
  const tidal = out.locations.byLocation.find((l) => l.name === "TIDAL").paged;
  assert.equal(tidal.pages, 1, "THE one: not the whole page budget on a Location of 12,944 albums");
  assert.equal(tidal.albums, 100);
  assertTidy(core.rec, out);
});
