"use strict";
// ---------------------------------------------------------------------------
// The library snapshot kept in step with Roon (split out of
// librarychange.test.js in v1.9.21, unchanged but for the index each harness
// is given): an album open as evidence, the diff-aware re-read, the jobs that
// follow a change, the import probe, a failed rebuild, and the change probe.
//
// Since v1.9.21 the official API's list as walked is `publicIndex`; what the
// screens read is `albumIndex` (publishLibrary), the same list unless Roon
// direct's library is in force. Every check below is of the walked list.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions, indexSource } = require("../lib/extract");
const { showLibrary, PAST_END } = require("../../lib/roon-direct/library");
// ---------------------------------------------------------------------------
// v1.8.68: an album open is the only thing that can see a mid-list change —
// the look compares the count and both ends, and an album re-identified in the
// middle moves neither. But a drifted offset is evidence about the SNAPSHOT
// only when the snapshot cannot place the album either; a tile left over from
// before the last re-read drifts too, and is not. Driven through the real
// loadAlbumSession up to the point it has decided, then stopped.
// ---------------------------------------------------------------------------
function openHarness(o) {
  const asked = [];
  const STOP = new Error("stop: past the drift handling");
  const X = { title: "Blue Lines", subtitle: "Massive Attack" };
  const OTHER = { title: "Bossanova", subtitle: "Pixies" };
  const F = loadIndexFunctions(["loadAlbumSession", "albumIdentityMatches", "normalize"], {
    navigateToAlbumList: async () => ({ hierarchy: "albums", total: o.total !== undefined ? o.total : 100 }),
    publicIndex: { count: 100, declared: 100 },
    // Roon has X at o.roonHas, and something else at every other offset.
    load: async (q) => ({ items: [q.offset === o.roonHas ? X : OTHER] }),
    // Where the SNAPSHOT puts X (-1: nowhere).
    relocateAlbumOffset: () => o.snapshotHas,
    findAlbumViaSearch: async () => (o.searchFinds ? { item: X, hierarchy: "browse" } : null),
    requestLibraryLook: (why, ms, walk) => asked.push({ why, ms, walk: !!walk }),
    browse: async () => { throw STOP; },
    roonBrowseError: () => STOP,
    DEBUG: false, console: { log() {}, warn() {}, error() {} },
  });
  return {
    asked,
    walks: () => asked.filter(a => a.walk),
    open: async (offset) => {
      try { await F.loadAlbumSession("sk", offset, null, X, "z1"); }
      catch (e) { if (e !== STOP && !e.stale) throw e; return e === STOP ? null : e.message; }
      return null;
    },
  };
}

// v1.9.21: with Roon direct's library in force, a Core album the official
// list has no row for carries an offset past that list's end
// (lib/roon-direct/library.js). Opening it is not evidence of anything.
test("an offset past the end of a list that has not moved: Roon's search, and no re-read", async (t) => {
  await t.test("THE one: found by the search, and the snapshot left alone", async () => {
    const h = openHarness({ roonHas: -1, snapshotHas: -1, searchFinds: true });
    assert.equal(await h.open(100), null);
    assert.deepEqual(h.asked, [], "every open of an album the official list lacks re-walked the whole library");
  });
  await t.test("not found: says so, rather than that the library just changed", async () => {
    const h = openHarness({ roonHas: -1, snapshotHas: -1, searchFinds: false });
    assert.match(await h.open(104), /doesn't list this album under the same title and artist/);
    assert.deepEqual(h.asked, []);
  });
  await t.test("control: past the end of a list that HAS moved is still handed to the watch", async () => {
    const h = openHarness({ roonHas: -1, snapshotHas: -1, searchFinds: true, total: 103 });
    await h.open(103);
    assert.equal(h.asked.length, 1);
  });
});

test("only an album the SNAPSHOT cannot place asks for the list to be re-read", async (t) => {
  await t.test("THE one: a mid-list change — the snapshot and Roon disagree, count unmoved", async () => {
    // The tile and the snapshot both say offset 40; Roon has moved X to 41.
    const h = openHarness({ roonHas: 41, snapshotHas: 40, searchFinds: true });
    await h.open(40);
    assert.equal(h.walks().length, 1,
      "a change only an album open can see was not reported — no look will ever find it");
  });

  await t.test("a stale TILE is not evidence: the snapshot already knows where the album went", async () => {
    // The tile is from before the last re-read (offset 40); the snapshot has
    // X at 41, and so does Roon. The snapshot is right — nothing to re-read.
    const h = openHarness({ roonHas: 41, snapshotHas: 41, searchFinds: true });
    await h.open(40);
    assert.deepEqual(h.walks(), [],
      "every stale tile after a library change asked for a full re-read of a snapshot that was " +
      "already current");
  });

  await t.test("not while the count is moving: the look follows that, and walks once it settles", async () => {
    const h = openHarness({ roonHas: 41, snapshotHas: 40, searchFinds: true, total: 103 });
    await h.open(40);
    assert.deepEqual(h.walks(), [], "an album open walked the list in the middle of an import");
    assert.equal(h.asked.length, 1, "the moved count was not handed to the watch at all");
    assert.equal(h.asked[0].ms, 0);
  });

  await t.test("an album the snapshot has but Roon no longer finds is evidence too", async () => {
    const h = openHarness({ roonHas: -1, snapshotHas: 40, searchFinds: false });
    await h.open(40);
    assert.equal(h.walks().length, 1, "the snapshot holds a removed album and nothing asked to re-read it");
  });

  await t.test("an album gone from Roon AND from the snapshot is not — they agree", async () => {
    const h = openHarness({ roonHas: -1, snapshotHas: -1, searchFinds: false });
    await h.open(40);
    assert.deepEqual(h.walks(), []);
  });

  await t.test("an album open where nothing moved asks for nothing", async () => {
    const h = openHarness({ roonHas: 40, snapshotHas: 40, searchFinds: true });
    await h.open(40);
    assert.deepEqual(h.asked, []);
  });
});

// ---------------------------------------------------------------------------
// v1.8.68: the re-read is diff-aware. Every walk the watch makes would
// otherwise move builtAt — and with it every live revision, so every open
// screen re-reads itself, and every per-snapshot cache is thrown away — for a
// library nobody touched.
// ---------------------------------------------------------------------------
function buildHarness(live, current, chainOpts, native) {
  const calls = { chain: 0, years: 0, ambiguous: 0, firstSeen: 0, credits: 0, roon: 0 };
  const reads = [];
  const publicIndex = Object.assign({ albums: [], count: 0, declared: 0 }, current);
  const albumIndex = { albums: publicIndex.albums, count: publicIndex.count, builtAt: 1000, progress: 0, building: null };
  const F = loadIndexFunctions(["buildAlbumIndex", "sameAlbumList", "publishLibrary"], {
    albumIndex, publicIndex, libraryViewCounts: null, showLibrary, SEARCH_PAGE: 2, DEBUG: false, console: { log() {}, error() {} },
    noteLibraryRead: (whole) => reads.push(whole),
    withBrowseSession: async (fn) => fn("k"),
    browse: async () => ({}),
    // `live.declared` lets a test have Roon declare more albums than it sends.
    load: async (o) => ({ list: { count: live.declared || live.length },
                          items: live.slice(o.offset, o.offset + o.count) }),
    indexRecord: (it, off) => ({ offset: off, title: it.title, subtitle: it.subtitle,
                                 image_key: it.image_key || null }),
    rebuildAmbiguousAlbumKeys: () => { calls.ambiguous++; },
    recordFirstSeenAlbums: () => { calls.firstSeen++; },
    rebuildCreditIdentities: () => { calls.credits++; },
    harvestAlbumYears: () => { calls.years++; }, roonDirect: { indexChanged: () => { calls.roon++; }, albums: () => native || null },   // v1.9.18
    syncChain: async () => { calls.chain++; },
    Date: { now: () => 5000 },
  });
  return { F, albumIndex, publicIndex, calls, reads };
}
const rec = (i, t, a, k) => ({ offset: i, title: t, subtitle: a, image_key: k || null });

// v1.9.21: with Roon direct's library in force the screens get the Core's
// list (publishLibrary), each album at its official row; the walk stays the
// walk, for everything that keeps it in step with Roon.
test("Roon direct's library: the screens get the Core's albums, the walk keeps its own", async () => {
  const live = [{ title: "A", subtitle: "x", image_key: "pa" }, { title: "B", subtitle: "y" }];
  const native = [{ oid: "9", title: "B", artist: "y", contentSource: 256, imageKey: "nb" },
    { oid: "8", title: "Only Roon", artist: "z", contentSource: 128, imageKey: "nz" }];
  const h = buildHarness(live, {}, undefined, native);
  await h.F.buildAlbumIndex({ chain: false });
  assert.deepEqual(h.publicIndex.albums.map((a) => a.title), ["A", "B"], "the walk was replaced by the Core's list");
  assert.deepEqual(h.albumIndex.albums.map((a) => [a.title, a.offset, a.roonSource, a.image_key]),
    [["B", 1, "qobuz", "nb"], ["Only Roon", PAST_END, "tidal", "nz"]], "THE one: the screens were given the walk, not the Core's list");
  assert.equal(h.albumIndex.count, 2);
  assert.equal(h.albumIndex.builtAt, 5000);
  const off = buildHarness(live, {});
  await off.F.buildAlbumIndex({ chain: false });
  assert.equal(off.albumIndex.albums, off.publicIndex.albums, "off: the walk itself, as before v1.9.21");
});

test("Roon's list read anew dates nothing: only the official list's walk does (the review, v1.9.21)", () => {
  const seen = [];
  const publicIndex = { albums: [{ offset: 0, title: "A", subtitle: "x", nTitle: "a", nArtist: "x" }], count: 1, declared: 1 };
  const albumIndex = { albums: [], count: 0, builtAt: 0 };
  const F = loadIndexFunctions(["publishLibrary"], {
    albumIndex, publicIndex, libraryViewCounts: null, showLibrary, Date: { now: () => 7 },
    roonDirect: { albums: () => [{ oid: "1", title: "A (Deluxe)", artist: "x", contentSource: 1, imageKey: null }] },
    indexRecord: (it, off) => ({ offset: off, title: it.title, subtitle: it.subtitle, nTitle: it.title.toLowerCase(), nArtist: it.subtitle }),
    rebuildAmbiguousAlbumKeys() {}, rebuildCreditIdentities() {}, recordFirstSeenAlbums: (list) => seen.push(list),
  });
  F.publishLibrary(false);
  assert.deepEqual(seen, [], "THE one: turning Roon direct on dated the Core's spellings as newly added");
  F.publishLibrary(true);
  assert.deepEqual(seen, [publicIndex.albums], "the walk's own albums, not the screens'");
  assert.equal(albumIndex.albums[0].title, "A (Deluxe)");
});

test("a re-read that finds nothing new publishes nothing", async (t) => {
  const LIVE = [{ title: "A", subtitle: "x" }, { title: "B", subtitle: "y" }, { title: "C", subtitle: "z" }];
  const SNAP = { albums: [rec(0, "A", "x"), rec(1, "B", "y"), rec(2, "C", "z")], count: 3, declared: 3 };

  await t.test("THE one: the same list leaves builtAt, and everything downstream, alone", async () => {
    const h = buildHarness(LIVE, SNAP);
    await h.F.buildAlbumIndex({ diff: true, chain: false });
    assert.equal(h.albumIndex.builtAt, 1000,
      "an unchanged library was republished — every open screen re-reads itself for nothing");
    assert.deepEqual(h.calls, { chain: 0, years: 0, ambiguous: 0, firstSeen: 0, credits: 0, roon: 0 });
  });

  await t.test("a new album, a renamed one, a moved row, a new cover: all published", async () => {
    const variants = {
      added:   LIVE.concat([{ title: "D", subtitle: "w" }]),
      renamed: [LIVE[0], { title: "B (Deluxe)", subtitle: "y" }, LIVE[2]],
      moved:   [LIVE[1], LIVE[0], LIVE[2]],
      cover:   [LIVE[0], Object.assign({ image_key: "new" }, LIVE[1]), LIVE[2]],
    };
    for (const [what, live] of Object.entries(variants)) {
      const h = buildHarness(live, SNAP);
      await h.F.buildAlbumIndex({ diff: true, chain: false });
      assert.equal(h.albumIndex.builtAt, 5000, "a " + what + " album was not published");
      assert.equal(h.calls.chain, 0, "chain:false still kicked the sync chain (" + what + ")");
      assert.deepEqual([h.calls.years, h.calls.roon], [1, 1], "the release years were not joined on, or Roon direct not told (" + what + ")");
    }
  });

  await t.test("without diff — the manual Rescan — it always publishes and chains", async () => {
    const h = buildHarness(LIVE, SNAP);
    await h.F.buildAlbumIndex();
    assert.equal(h.albumIndex.builtAt, 5000);
    assert.equal(h.calls.chain, 1, "the manual path lost its sync chain");
  });

  await t.test("THE one: a short walk never replaces a complete snapshot on the watch's say-so", async () => {
    // Roon declares four albums and sends two pages' worth less: a holed
    // snapshot cannot see a same-count change, so publishing it would leave
    // the library blind until somebody pressed Rescan.
    const short = LIVE.slice(0, 2);
    short.declared = 4;
    const h = buildHarness(short, SNAP);
    await assert.rejects(h.F.buildAlbumIndex({ diff: true, chain: false }), /short read/);
    assert.equal(h.albumIndex.builtAt, 1000, "the short walk was published");
    assert.equal(h.albumIndex.count, 3, "the complete snapshot was replaced by a holed one");
    assert.deepEqual(h.reads, [], "a walk that failed was counted as a read of the library");
  });

  await t.test("a short walk still beats a snapshot that was holed already, and the Rescan's", async () => {
    const short = LIVE.slice(0, 2);
    short.declared = 4;
    const holed = buildHarness(short, { albums: [rec(0, "A", "x")], count: 1, declared: 3 });
    await holed.F.buildAlbumIndex({ diff: true, chain: false });
    assert.equal(holed.albumIndex.count, 2);
    const manual = buildHarness(short, SNAP);
    await manual.F.buildAlbumIndex();
    assert.equal(manual.albumIndex.count, 2, "a person pressed Rescan and got nothing");
  });

  await t.test("every walk that worked counts as one — the first build included", async () => {
    // The routine re-read runs libraryVerifyMs() after the last whole-list
    // walk. The first build is one; not counting it walked the library twice
    // on every restart.
    const same = buildHarness(LIVE, SNAP);
    await same.F.buildAlbumIndex({ diff: true, chain: false });
    const first = buildHarness(LIVE, { albums: [], count: 0, declared: 0 });
    await first.F.buildAlbumIndex();
    assert.deepEqual([same.reads, first.reads], [[true], [true]]);
  });
});

// ---------------------------------------------------------------------------
// v1.8.68: the dependants run ONCE per burst of change.
// ---------------------------------------------------------------------------
function dependantsHarness(opts) {
  opts = opts || {};
  // Not 0: the code reads a zero timestamp as "never", so a clock starting
  // there gives every first change a deadline of "unset" and hides whatever
  // depends on it having passed.
  const state = { clock: 1_000_000, timers: [], runs: [] };
  const F = loadIndexFunctions(
    ["scheduleLibraryDependants", "armLibraryDependants", "cancelLibraryDependants",
     "libraryDependantsQuietMs", "libraryDependantsMaxWaitMs"], {
      _dependantsTimer: null, _dependantsFirstAt: 0, core: opts.unpaired ? null : {},
      Date: { now: () => state.clock },
      setTimeout: (fn, ms) => { const t = { fn, ms, at: state.clock + ms, unref() {} }; state.timers.push(t); return t; },
      clearTimeout: (t) => { const i = state.timers.indexOf(t); if (i >= 0) state.timers.splice(i, 1); },
      runLibraryDependants: async (why) => { state.runs.push(why); },
      console: { error() {} },
    });
  return {
    F, state,
    fireDue: () => {
      const due = state.timers.filter(t => t.at <= state.clock);
      for (const t of due) { state.timers.splice(state.timers.indexOf(t), 1); t.fn(); }
    },
  };
}

test("the jobs built on the snapshot follow a change once, after it goes quiet", async (t) => {
  const D = loadIndexFunctions(["libraryDependantsQuietMs", "libraryDependantsMaxWaitMs"], {});

  await t.test("THE one: a burst of re-reads costs one pass", () => {
    const h = dependantsHarness();
    for (let i = 0; i < 5; i++) { h.F.scheduleLibraryDependants("settled"); h.state.clock += 30000; h.fireDue(); }
    assert.equal(h.state.runs.length, 0, "the badges/genres/file-tags pass ran in the middle of a burst");
    assert.equal(h.state.timers.length, 1, "the pass was armed more than once");
    h.state.clock += D.libraryDependantsQuietMs();
    h.fireDue();
    assert.deepEqual(h.state.runs, ["auto rescan"],
      "five re-reads cost " + h.state.runs.length + " passes — a /music walk each");
  });

  await t.test("a library that never goes quiet still gets its pass", () => {
    const h = dependantsHarness();
    const stepMs = Math.floor(D.libraryDependantsQuietMs() / 2);
    for (let t0 = 0; t0 <= D.libraryDependantsMaxWaitMs(); t0 += stepMs) {
      h.F.scheduleLibraryDependants("settled");
      h.state.clock += stepMs;
      h.fireDue();
    }
    assert.ok(h.state.runs.length >= 1,
      "an import that keeps re-settling postponed the pass for ever — new albums never get badges");
  });

  await t.test("with no Core it waits for one rather than running", () => {
    const h = dependantsHarness({ unpaired: true });
    h.F.scheduleLibraryDependants("settled");
    h.state.clock += D.libraryDependantsQuietMs();
    h.fireDue();
    assert.equal(h.state.runs.length, 0);
    assert.equal(h.state.timers.length, 1, "owed work was dropped on an unpair");
  });

  await t.test("THE one: a Core gone past the deadline is waited for, not spun on", async () => {
    // The deadline is fixed at the first change. Re-arming on it once it had
    // passed was a 0 ms timer, firing about every millisecond until a re-pair.
    const h = dependantsHarness({ unpaired: true });
    h.F.scheduleLibraryDependants("settled");
    h.state.clock += D.libraryDependantsMaxWaitMs() + 60000;
    for (let i = 0; i < 5; i++) h.fireDue();
    assert.equal(h.state.timers.length, 1);
    assert.ok(h.state.timers[0].ms >= D.libraryDependantsQuietMs(),
      "with the Core gone past the deadline the pass re-armed every " + h.state.timers[0].ms + " ms");
  });

  await t.test("a manual Rescan that rebuilt takes the owed pass with it", () => {
    const h = dependantsHarness();
    h.F.scheduleLibraryDependants("settled");
    h.F.cancelLibraryDependants();
    h.state.clock += D.libraryDependantsMaxWaitMs();
    h.fireDue();
    assert.deepEqual(h.state.runs, []);
    h.F.scheduleLibraryDependants("settled");         // a fresh burst gets a fresh deadline
    h.state.clock += D.libraryDependantsQuietMs();
    h.fireDue();
    assert.deepEqual(h.state.runs, ["auto rescan"]);
    const src = indexSource();
    const route = src.slice(src.indexOf('app.post("/api/library/rescan"'));
    assert.ok(/if \(r\.status === "rebuilt"\) cancelLibraryDependants\(\);/.test(route.slice(0, 1500)),
      "the Rescan button no longer stands the watch's pass down — the /music walk runs twice");
  });
});

// ---------------------------------------------------------------------------
// v1.7.54: "Roon has finished" is inferred, and the inference got two things
// wrong.
// ---------------------------------------------------------------------------
test("the import probe watches for identification, not just for growth", async (t) => {
  const src = indexSource();
  const fn = src.slice(src.indexOf("async function libraryIsImporting("));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);

  await t.test("more than one settle window", () => {
    const F = loadIndexFunctions(["importSettleReads"], {});
    assert.ok(F.importSettleReads() >= 3,
      "the probe takes " + F.importSettleReads() + " samples, so it spans one " +
      "window. Roon imports in bursts, and any pause between bursts longer " +
      "than that window reads as finished — which is how a rebuild lands " +
      "halfway through an import");
  });

  await t.test("the sample carries identity, not only the count", () => {
    // Identification does not change the album count; it rewrites titles and
    // artists, which moves rows in an alphabetical list. The count alone can
    // only answer the "still adding" half of the user's question.
    assert.ok(/browseItemIdentity/.test(body),
      "libraryIsImporting compares nothing but the album count, so an import " +
      "that has finished ADDING but is still IDENTIFYING reads as settled");
    assert.ok(/offset: total - 1/.test(body),
      "only the head of the list is sampled — identification deep in the " +
      "library would never move it");
  });

  await t.test("that identity is the one the change probe uses", () => {
    // Shared, because the two probes ask questions whose answers must be
    // comparable: "is this the library we indexed" and "is this the library it
    // was five seconds ago". Two spellings of identity would make a
    // disagreement between them impossible to explain.
    const F = loadIndexFunctions(["browseItemIdentity"], {});
    assert.equal(F.browseItemIdentity({ title: "Rumours", subtitle: "Fleetwood Mac" }),
                 "Rumours||Fleetwood Mac");
    assert.equal(F.browseItemIdentity({ title: "Rumours" }), "Rumours||",
      "a missing artist must still produce a comparable value, not undefined");
    assert.equal(F.browseItemIdentity(null), "");
    // libraryChangedSince is a yes/no over libraryLook since v1.8.68, so the
    // identity it compares is libraryLook's.
    const look = src.slice(src.indexOf("async function libraryLook("));
    assert.ok(/browseItemIdentity/.test(look.slice(0, look.indexOf("\n}\n"))),
      "the change probe spells identity its own way again");
    const changed = src.slice(src.indexOf("async function libraryChangedSince("));
    assert.ok(/libraryLook\(/.test(changed.slice(0, changed.indexOf("\n}\n"))),
      "libraryChangedSince no longer goes through libraryLook — two probes, two ideas of identity");
  });
});

// ---------------------------------------------------------------------------
// v1.7.54: a rebuild that threw used to report success.
// ---------------------------------------------------------------------------
test("a failed rebuild is reported as a failure", async (t) => {
  const src = indexSource();

  await t.test("the catch records the failure instead of swallowing it", () => {
    const fn = src.slice(src.indexOf("async function checkAndMaybeRebuild("));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    assert.ok(/\.catch\(\(\) => \{ built = false; \}\)/.test(body),
      "buildAlbumIndex's rejection is discarded, so the old snapshot survives " +
      "and the caller is told 'rebuilt'");
    // The flag must track the SNAPSHOT and nothing else. Chaining the labels
    // map into the same promise as buildAlbumIndex makes a throw from
    // rebuildLabelsMap report a perfectly rebuilt snapshot as "error" — which
    // stops the dependants running and leaves every one of them stale, the
    // exact failure this version exists to fix.
    const build = body.indexOf("await buildAlbumIndex()");
    const labels = body.indexOf("rebuildLabelsMap()", build);
    assert.ok(build > 0 && labels > build, "the rebuild block moved");
    assert.ok(!body.slice(build, labels).includes(".then("),
      "rebuildLabelsMap is chained onto buildAlbumIndex's promise, so a failure " +
      "in the LABEL map is reported as a failed snapshot rebuild");
    assert.ok(/catch \(e\) \{ console\.error\("\[index\] labels map rebuild/.test(body),
      "a labels-map failure is now swallowed with no log at all");
    const failReturn = body.indexOf('if (!built) return { status: "error" };');
    const okReturn   = body.indexOf('return { status: "rebuilt"');
    assert.ok(failReturn > 0, "nothing acts on the failure");
    assert.ok(failReturn < okReturn,
      "the success return comes first, so a failed build still reports rebuilt");
  });

  // "error" re-arming the old chain is now "a failed re-read is retried by
  // the next looks", driven against the watch above.
});
