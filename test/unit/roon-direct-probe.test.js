"use strict";
// ---------------------------------------------------------------------------
// Stage 0 of dev/design/roon-native.md: the read-only probe, against a fake
// Core (test/lib/fake-roon-core.js) over real TCP. The fake is not evidence
// that a real Core answers this way (§6) — what these hold is Rouen's side:
// the broker ids it tries and in which order, the counts it reads, that it
// calls nothing off the allowlist, and that every page it retains is released
// once and every query it opens is disposed once, failures included.
//
// The library is the owner's reported test library: 2 local + 6 TIDAL albums,
// of which v1.9.x's inference called 4 local. The right answer is 2 / 6 / 0.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { startFakeCore } = require("../lib/fake-roon-core");
const { runProbe } = require("../../lib/roon-direct/probe");
const { ALLOWED } = require("../../lib/roon-direct/methods");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");

const CORE_ID = "01234567-89ab-cdef-0123-456789abcdef";
const LIBRARY = [
  { title: "Kind of Blue", artist: "Miles Davis", source: "local", tracks: 5 },
  { title: "Blue", artist: "Joni Mitchell", source: "local", tracks: 10 },
  { title: "Mezzanine", artist: "Massive Attack", source: "tidal", tracks: 11 },
  { title: "Dummy", artist: "Portishead", source: "tidal", tracks: 11 },
  { title: "Untrue", artist: "Burial", source: "tidal", tracks: 13 },
  { title: "Discovery", artist: "Daft Punk", source: "tidal", tracks: 14 },
  { title: "Moon Safari", artist: "Air", source: "tidal", tracks: 10 },
  { title: "Rumours", artist: "Fleetwood Mac", source: "tidal", tracks: 120 },   // more than one page
];
const fast = { timeoutMs: 1500, settleMs: 1500, countGraceMs: 300 };

/** Every page retained released once, every query disposed once, nothing off the allowlist. */
function assertTidy(rec, out) {
  assert.deepEqual([...rec.released].sort(), [...rec.retained].sort(), "a retained page was not released, or released twice");
  assert.equal(new Set(rec.released).size, rec.released.length, "a page was released twice");
  assert.deepEqual([...rec.disposed].sort(), [...rec.opened].sort(), "a query opened was not disposed, or one was disposed twice");
  assert.equal(new Set(rec.disposed).size, rec.disposed.length, "a query was disposed twice");
  for (const sig of rec.signatures) assert.ok(ALLOWED.has(sig), "called off the allowlist: " + sig);
  if (out) {
    assert.equal(out.lifetime.pagesRetained, out.lifetime.pagesReleased);
    assert.equal(out.lifetime.queriesOpened, out.lifetime.queriesDisposed);
  }
}

test("the probe on the owner's test library: 2 local, 6 TIDAL, 0 Qobuz albums", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();

  await t.test("the core_id in .NET Guid order was the broker id, and was tried first", () => {
    assert.equal(out.brokerId.used, "core_id, .NET Guid order");
    assert.equal(out.brokerId.tried.length, 1);
    assert.equal(core.rec.connections, 1);
  });
  await t.test("the Core's own graph: its profile, its totals, its Locations", () => {
    assert.deepEqual(out.core.profiles, ["Owner"]);
    assert.equal(out.core.profileUsed, "Owner");
    assert.deepEqual(out.core.library, { albums: 8, tracks: LIBRARY.reduce((n, a) => n + a.tracks, 0) });
    assert.deepEqual(out.core.locations.map((l) => l.name), ["Music", "TIDAL", "QOBUZ", "Internet Media"]);
  });
  await t.test("THE one: albums per source, read from the Core, not inferred", () => {
    assert.equal(out.ok, true, out.why);
    assert.deepEqual([out.sources.local.albums, out.sources.tidal.albums, out.sources.qobuz.albums], [2, 6, 0]);
    assert.deepEqual([out.sources.local.tracks, out.sources.tidal.tracks, out.sources.qobuz.tracks], [15, 179, 0]);
    assert.ok(out.sources.local.albumTitles.includes("Joni Mitchell — Blue"));
  });
  await t.test("one query per source, each with its own criterion", () => assert.deepEqual(core.rec.queries, ["local", "tidal", "qobuz"]));
  await t.test("TIDAL's 179 tracks were read in two pages, each released", () => {
    assert.equal(core.rec.retained.filter((p) => p.endsWith(":1")).length, 1);
  });
  await t.test("albums per Location, against an unfiltered control: 2 / 6 / 0, and the Core filtered", () => {
    assert.equal(out.locations.control.albums, 8);
    assert.deepEqual(out.locations.byLocation.map((l) => [l.name, l.albums]), [["Music", 2], ["TIDAL", 6], ["QOBUZ", 0], ["Internet Media", 0]]);
    assert.match(out.locations.verdict, /^filtered:/);
    assert.deepEqual(core.rec.albumQueries, ["all", ["Music"], ["TIDAL"], ["QOBUZ"], ["Internet Media"]], "the control first, then one Location each");
  });
  await t.test("a 0 sent as no Count at all is read as 0, and says it was inferred", () => {
    const q = out.locations.byLocation.find((l) => l.name === "QOBUZ");
    assert.match(q.inferred, /no Count: read as 0/);
    assert.equal(out.locations.byLocation.find((l) => l.name === "TIDAL").inferred, undefined);
  });
  await t.test("every page released once, every query disposed once, nothing off the allowlist", () => assertTidy(core.rec, out));
  await t.test("the album queries were disposed too: 3 track + 5 album queries", () => {
    assert.equal(core.rec.opened.length, 8);
    assert.equal(core.rec.signatures.filter((s) => s.includes("VirtualAlbumLiteQuery::Dispose")).length, 5);
  });
});

test("a broker id the Core refuses is reported, and the next is tried", async (t) => {
  // This Core's id is the core_id as written, not in .NET order.
  const plain = Buffer.from(CORE_ID.replace(/-/g, ""), "hex");
  const core = await startFakeCore({ brokerId: plain, albums: LIBRARY.slice(0, 2) });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, override: "ff".repeat(16) }, fast));
  await core.idle();
  assert.deepEqual(out.brokerId.tried.map((x) => [x.label, x.ok]), [["given by hand", false], ["core_id, .NET Guid order", false], ["core_id, as written", true]]);
  assert.equal(out.brokerId.used, "core_id, as written");
  assert.equal(out.ok, true, out.why);
  assert.equal(core.rec.connections, 3, "each attempt is its own connection");
});

test("no id the Core accepts: it says so and opens nothing", async (t) => {
  const core = await startFakeCore({ brokerId: Buffer.alloc(16, 9), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.equal(out.ok, false);
  assert.match(out.why, /refused every broker id/);
  assert.equal(out.brokerId.used, null);
  assert.equal(core.rec.signatures.length, 0);
});

test("no core_id and none given: nothing to try, and no connection", async () => {
  const out = await runProbe({ host: "127.0.0.1", port: 1 });
  assert.equal(out.ok, false);
  assert.match(out.why, /No broker id to try/);
  assert.deepEqual(out.brokerId.tried, []);
});

test("a Core that refuses the query: reported per source, and still tidy", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { refuseQuery: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.equal(out.ok, false);
  assert.match(out.sources.local.error, /refused the local track query: Refused/);
  assert.equal(core.rec.signatures.filter((s) => s.includes("VirtualTrackLiteQuery::Dispose")).length, 0, "no track query to dispose: none was opened");
  assertTidy(core.rec, out);
});

test("pages that never arrive: each is still released, the query disposed, and it says so", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 3), faults: { silentPages: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  assert.equal(out.sources.local.albums, 0);
  assert.match(out.sources.local.note, /0 of 15 tracks were pushed while the query was open/);
  assert.equal(core.rec.retained.length, 2, "local's page and TIDAL's page");
  assertTidy(core.rec, out);
});

test("a source with more tracks than a probe pages through: counted, not paged", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID, maxTracksForAlbums: 100 }, fast));
  await core.idle();
  assert.equal(out.sources.tidal.tracks, 179);
  assert.equal(out.sources.tidal.albums, null);
  assert.match(out.sources.tidal.note, /more than the 100/);
  assert.equal(out.sources.local.albums, 2);
  assertTidy(core.rec, out);
});

// ---- the review's findings, each pinned (v1.9.11) ----------------------------

test("a Location pushed a moment after the Library is still reported (the graph is waited on until quiet)", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 2), faults: { lateLocationMs: 200 } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.ok(out.core.locations.map((l) => l.name).includes("Music"), "THE one: the Locations are what §9.1 is decided on");
  assert.ok(out.locations.byLocation.some((l) => l.name === "Music"), "and the late one is counted");
});

test("tracks the Core had already pushed are counted when it pushes them again for their page", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { prePushSource: "local" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.equal(out.sources.local.albums, 2);
  assert.equal(out.sources.local.note, undefined, "all 15 were seen");
  assertTidy(core.rec, out);
});

test("a call answered after its timeout: the probe stops, asks nothing more, closes, and says why", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { slowRetainMs: 700 } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  assert.equal(out.ok, false);
  assert.match(out.why, /Stopped and closed: the Core did not answer call \d+ within 300 ms/);
  assert.match(out.sources.local.error, /did not answer/);
  assert.deepEqual([out.sources.tidal.skipped, out.sources.qobuz.skipped], ["an earlier call timed out", "an earlier call timed out"]);
  assert.deepEqual(core.rec.queries, ["local"], "THE one: nothing more was asked of a Core whose state is unknown");
  assert.deepEqual(core.rec.albumQueries, [], "not even the Locations probe");
  assert.equal(out.locations.skipped, "an earlier call timed out");
  assert.equal(core.rec.released.length, 0, "a page whose retain was never confirmed is not released (it may not exist)");
  assert.deepEqual(core.rec.disposed, core.rec.opened, "the query that was confirmed is still disposed");
});

test("a ping as the connection closes does not take Rouen down", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 1), faults: { pingOnClose: true } });
  t.after(() => core.close());
  const crashes = [];
  const onCrash = (e) => crashes.push(e.message);
  process.on("uncaughtException", onCrash);
  t.after(() => process.off("uncaughtException", onCrash));
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  await new Promise((r) => { setTimeout(r, 100); });
  assert.equal(out.ok, true, out.why);
  assert.deepEqual(crashes, [], "THE one: before the fix, replying to it threw 'not connected' inside the socket's data event");
});

// ---- the Locations probe (v1.9.13, dev/design/roon-native.md §9.1) -------------

test("a Core that ignores RequireLocations: every Location counts the whole library, and it says so", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { ignoreLocations: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.deepEqual(out.locations.byLocation.map((l) => l.albums), [8, 8, 8, 8]);
  assert.match(out.locations.verdict, /^ignored: every Location counted 8/, "THE one: equal counts are not read as a working filter");
  assertTidy(core.rec, out);
});

test("a Core that refuses the filtered query: each Location says so, the control stands, still tidy", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { refuseAlbumQuery: "filtered" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.equal(out.locations.control.albums, 8);
  for (const l of out.locations.byLocation) assert.match(l.error, /refused the album query by Location: Refused/);
  assert.match(out.locations.verdict, /^unknown: no Location was counted/);
  assert.equal(out.ok, false);
  assert.match(out.why, /see sources and locations/);
  assertTidy(core.rec, out);
});

test("a refused control: the verdict is unknown, not read from the Locations", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { refuseAlbumQuery: "all" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.match(out.locations.control.error, /refused the unfiltered album query/);
  assert.match(out.locations.verdict, /^unknown: the unfiltered control query failed/);
  assert.deepEqual(core.rec.albumQueries, ["all"], "no Location is asked about without a control to judge it by");
  assert.deepEqual(out.locations.byLocation.map((l) => l.skipped), Array(4).fill("the control query failed"));
  assertTidy(core.rec, out);
});

test("a query object that never arrives is an error, not a 0 — and the query is still disposed", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 2), faults: { noAlbumQueryObject: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  assert.equal(out.locations.control.albums, null, "THE one: no object is not a sparse 0");
  assert.match(out.locations.control.error, /never arrived/);
  assert.deepEqual(core.rec.albumQueries, ["all"], "not 4 more full timeouts for the same failure");
  assertTidy(core.rec, out);
});

test("no Locations pushed: nothing is queried, and it says why", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 2), faults: { noLocations: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  await core.idle();
  assert.deepEqual(core.rec.albumQueries, []);
  assert.match(out.locations.verdict, /^no Locations/);
  assert.equal(out.ok, true, out.why);
  assertTidy(core.rec, out);
});

test("an album query answered after its timeout: the Locations left are skipped, and it says why", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 2), faults: { slowAlbumQueryMs: 700 } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  assert.equal(out.ok, false);
  assert.match(out.why, /Stopped and closed: the Core did not answer call \d+ within 300 ms/);
  assert.match(out.locations.byLocation[0].error, /did not answer/);
  assert.deepEqual(out.locations.byLocation.slice(1).map((l) => l.skipped), Array(3).fill("an earlier call timed out"));
  assert.deepEqual(core.rec.albumQueries, ["all", ["Music"]], "THE one: nothing more was asked of a Core whose state is unknown");
  assert.deepEqual(core.rec.disposed, core.rec.opened.slice(0, core.rec.disposed.length), "the confirmed queries were disposed");
  assert.ok(core.rec.disposed.length >= 4, "3 track queries and the control, each disposed");
});

test("a Location whose query object never arrives stops the rest; the control counted", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.slice(0, 2), faults: { noAlbumQueryObject: "filtered" } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { timeoutMs: 300 }));
  await core.idle();
  assert.equal(out.locations.control.albums, 2);
  assert.match(out.locations.byLocation[0].error, /never arrived/);
  assert.deepEqual(out.locations.byLocation.slice(1).map((l) => l.skipped), Array(3).fill("an earlier Location's query object never arrived"));
  assert.deepEqual(core.rec.albumQueries, ["all", ["Music"]]);
  assertTidy(core.rec, out);
});

test("a Count pushed after its object, within the grace: read as the number it is", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { lateCountMs: 150 } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { countGraceMs: 1000 }));
  await core.idle();
  assert.deepEqual(out.locations.byLocation.map((l) => [l.albums, !!l.inferred]), [[2, false], [6, false], [0, false], [0, false]]);
  assert.match(out.locations.verdict, /^filtered:/);
});

test("a Count later than the grace reads as an inferred 0 — and inferred zeros never make a filter", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { lateCountMs: 800, ignoreLocations: true } });
  t.after(() => core.close());
  const out = await runProbe(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, { countGraceMs: 200 }));
  await core.idle();
  assert.equal(out.locations.control.albums, 8);
  assert.ok(out.locations.byLocation.every((l) => l.albums === 0 && l.inferred));
  assert.match(out.locations.verdict, /^unknown: no Count arrived as a number/, "THE one: a Core that ignored the criterion, read too early, is not 'filtered'");
  assertTidy(core.rec, out);
});
