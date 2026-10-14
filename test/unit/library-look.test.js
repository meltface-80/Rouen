"use strict";
// ---------------------------------------------------------------------------
// The look at Roon's list the library watch repeats (libraryLook), against
// the official API's list as walked (publicIndex since v1.9.21). Split out of
// librarychange.test.js in v1.9.21, unchanged but for the index it is given.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");

// ---------------------------------------------------------------------------
// v1.7.55: the probe the ten-minute watch repeats had no test at all, and it
// carried the one bug that makes a frequent poll dangerous.
//
// buildAlbumIndex keeps TWO numbers: `count`, the albums that actually arrived
// after holes were filtered out, and `declared`, what Roon said the library
// held when the snapshot was taken. Its own comment says why:
//
//   "Comparing a live count against the filtered one would then report 'the
//    library moved' forever on a library that never changed — and every album
//    open would arm another full re-walk."
//
// loadAlbumSession was fixed for exactly that. This probe was not: it compared
// against `count`. At the old twelve-hour interval it cost two needless
// re-walks a day and went unnoticed for versions. At ten minutes it is a full
// library walk, a genre harvest and an art prewarm every ten minutes, forever,
// on a library nobody has touched — the watch would have been a self-inflicted
// denial of service on the Core.
// ---------------------------------------------------------------------------
function probeHarness(live, snapshot) {
  const loads = [];
  const reads = [];
  const F = loadIndexFunctions(["libraryChangedSince", "libraryLook", "browseItemIdentity"], {
    noteLibraryRead: (whole) => reads.push(whole),
    withBrowseSession: async (fn) => fn("k"),
    browse: async () => ({}),
    load: async (opts) => {
      loads.push(opts.offset);
      const it = live.albums[opts.offset];
      return { list: { count: live.total }, items: it ? [it] : [] };
    },
    publicIndex: snapshot,
  });
  return { F, loads, reads };
}
const al = (t, a) => ({ title: t, subtitle: a });

test("the change probe does not cry wolf at ten-minute intervals", async (t) => {
  await t.test("an unchanged library reports unchanged", async () => {
    const live = { total: 3, albums: [al("A", "x"), al("B", "y"), al("C", "z")] };
    const h = probeHarness(live, { count: 3, declared: 3, albums: live.albums.slice() });
    assert.equal(await h.F.libraryChangedSince(), false);
    assert.deepEqual(h.loads, [0, 2], "head and tail, three round-trips total");
  });

  await t.test("a changed count reports changed, and skips the tail read", async () => {
    const live = { total: 4, albums: [al("A", "x"), al("B", "y"), al("C", "z"), al("D", "w")] };
    const h = probeHarness(live, { count: 3, declared: 3, albums: live.albums.slice(0, 3) });
    assert.equal(await h.F.libraryChangedSince(), true);
    assert.deepEqual(h.loads, [0], "the tail was read even though the count already answered");
  });

  await t.test("THE one: a HOLED snapshot does not report changed forever", async () => {
    // Roon said 4, only 3 arrived, and the build filtered the hole out. The
    // library has not changed since. Comparing the live 4 against the filtered
    // 3 says "moved" — and says it again ten minutes later, and forever.
    const live = { total: 4, albums: [al("A", "x"), al("B", "y"), al("C", "z"), al("D", "w")] };
    const h = probeHarness(live, {
      count: 3, declared: 4, albums: [al("A", "x"), al("B", "y"), al("C", "z")],
    });
    assert.equal(await h.F.libraryChangedSince(), false,
      "a snapshot with holes reports the library moved on EVERY probe. At ten " +
      "minutes that is a full re-walk, a genre harvest and an art prewarm 144 " +
      "times a day against a library nobody touched");
  });

  await t.test("a holed snapshot still notices the count moving", async () => {
    // Bounded, not blind: it stops comparing identities, not counts.
    const live = { total: 9, albums: [al("A", "x")] };
    const h = probeHarness(live, { count: 3, declared: 4, albums: [al("A", "x")] });
    assert.equal(await h.F.libraryChangedSince(), true);
  });

  await t.test("a same-count swap at either end is still caught", async () => {
    // The identity reads are the only thing that can see a library whose album
    // count did not change — a replaced album, or one Roon re-identified.
    const first = { total: 3, albums: [al("NEW", "x"), al("B", "y"), al("C", "z")] };
    const hf = probeHarness(first, {
      count: 3, declared: 3, albums: [al("A", "x"), al("B", "y"), al("C", "z")] });
    assert.equal(await hf.F.libraryChangedSince(), true, "a changed FIRST album was missed");

    const last = { total: 3, albums: [al("A", "x"), al("B", "y"), al("NEW", "z")] };
    const hl = probeHarness(last, {
      count: 3, declared: 3, albums: [al("A", "x"), al("B", "y"), al("C", "z")] });
    assert.equal(await hl.F.libraryChangedSince(), true, "a changed LAST album was missed");
  });

  await t.test("an empty snapshot does not read a tail that isn't there", async () => {
    const h = probeHarness({ total: 0, albums: [] }, { count: 0, declared: 0, albums: [] });
    assert.equal(await h.F.libraryChangedSince(), false);
    assert.deepEqual(h.loads, [0]);
  });

  await t.test("a one-album library reads no tail", async () => {
    const live = { total: 1, albums: [al("A", "x")] };
    const h = probeHarness(live, { count: 1, declared: 1, albums: live.albums.slice() });
    assert.equal(await h.F.libraryChangedSince(), false);
    assert.deepEqual(h.loads, [0], "offset 0 was read twice as head and tail");
  });

  await t.test("a snapshot from before `declared` existed still works", async () => {
    // Records written by an older version have no `declared` field at all.
    const live = { total: 2, albums: [al("A", "x"), al("B", "y")] };
    const h = probeHarness(live, { count: 2, albums: live.albums.slice() });
    assert.equal(await h.F.libraryChangedSince(), false,
      "an upgraded install reports its library changed on every probe");
  });
});

test("the watch's look reads the whole signature", async (t) => {
  await t.test("THE one: full reads the last album even when the count has moved", async () => {
    // Without the tail, two looks agreeing on count and first album would call
    // the library settled while Roon is still re-identifying its end.
    const live = { total: 4, albums: [al("A", "x"), al("B", "y"), al("C", "z"), al("D", "w")] };
    const h = probeHarness(live, { count: 3, declared: 3, albums: live.albums.slice(0, 3) });
    const look = await h.F.libraryLook({ full: true });
    assert.equal(look.changed, true);
    assert.deepEqual(h.loads, [0, 3], "the watch's look skipped the last album");
    assert.equal(look.sig, "4|A||x|D||w");
  });

  await t.test("the yes/no form still stops at what answers it", async () => {
    const live = { total: 4, albums: [al("A", "x"), al("B", "y"), al("C", "z"), al("D", "w")] };
    const h = probeHarness(live, { count: 3, declared: 3, albums: live.albums.slice(0, 3) });
    assert.equal(await h.F.libraryChangedSince(), true);
    assert.deepEqual(h.loads, [0]);
  });

  await t.test("every answered look counts as a check — the manual one too", async () => {
    // "checked … ago" in the side menu reads the last answered look. The
    // Rescan button's check is a look like any other, and confirms as much.
    const live = { total: 3, albums: [al("A", "x"), al("B", "y"), al("C", "z")] };
    const h = probeHarness(live, { count: 3, declared: 3, albums: live.albums });
    await h.F.libraryChangedSince();
    await h.F.libraryLook({ full: true });
    assert.deepEqual(h.reads, [false, false], "a look at Roon's list did not note that it looked");
  });

  await t.test("a changed FIRST album answers without the last", async () => {
    const live = { total: 3, albums: [al("NEW", "x"), al("B", "y"), al("C", "z")] };
    const h = probeHarness(live, { count: 3, declared: 3, albums: [al("A", "x"), al("B", "y"), al("C", "z")] });
    assert.equal(await h.F.libraryChangedSince(), true);
    assert.deepEqual(h.loads, [0], "the last album was read after the first had already answered");
  });
});
