"use strict";
// ---------------------------------------------------------------------------
// v1.7.31: "Recently added", built from evidence this extension can actually
// get hold of.
//
// Roon's extension API publishes no import date — none, anywhere — so every
// value behind this sort is inferred. That makes the FIRST RUN the dangerous
// case: an established library has no history to recover, and stamping every
// album with the moment the feature was installed would produce a timestamp
// that is technically a date and factually a lie. The whole list would sort
// perfectly and mean nothing.
//
// So the rule is: the first run records NOTHING, existing albums stay undated
// (and are held out of the ordering — see libraryview.test.js), and only albums
// that appear in a LATER rebuild get a real first-seen. Accuracy accrues going
// forward and cannot be back-filled.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions, indexSource } = require("../lib/extract");

function build(seedRows, albums, db) {
  const albumSeenCache = new Map(seedRows || []);
  const albumIndex = { albums: albums || [], builtAt: 1 };
  let bumped = 0;
  const F = loadIndexFunctions(
    ["setAlbumSeen", "seenSourceRank", "recordFirstSeenAlbums"],
    {
      albumSeenCache,
      albumIndex,
      // No SQLite in a unit test: the cache IS the assertion surface, and the
      // write path is a straight mirror of it.
      stmtInsertSeen: (db && db.stmt) || null,
      labelsDb: (db && db.labelsDb) || null,
      bumpLibraryMeta: () => { bumped++; },
      DEBUG: false,
      console: { log: () => {}, error: () => {} },
    });
  return { F, albumSeenCache, bumps: () => bumped };
}

const album = (key) => ({ title: key, subtitle: "x", srcKeys: [key] });

test("setAlbumSeen keeps the best evidence, not the latest write", async (t) => {
  await t.test("a file timestamp outranks 'it turned up in a rebuild'", () => {
    const { F, albumSeenCache } = build();
    assert.equal(F.setAlbumSeen("a", 5000, "first-seen"), true);
    assert.equal(F.setAlbumSeen("a", 1000, "file"), true, "file evidence must win");
    assert.equal(albumSeenCache.get("a").ts, 1000);
    assert.equal(albumSeenCache.get("a").src, "file");
  });

  await t.test("weaker evidence never overwrites stronger", () => {
    const { F, albumSeenCache } = build();
    F.setAlbumSeen("a", 1000, "file");
    assert.equal(F.setAlbumSeen("a", 9000, "first-seen"), false);
    assert.equal(albumSeenCache.get("a").ts, 1000);
  });

  await t.test("within the same source, the EARLIEST date wins", () => {
    // "First seen" means the earliest evidence — not whichever scan most
    // recently noticed the album was still there.
    const { F, albumSeenCache } = build();
    F.setAlbumSeen("a", 5000, "file");
    assert.equal(F.setAlbumSeen("a", 2000, "file"), true);
    assert.equal(albumSeenCache.get("a").ts, 2000);
    assert.equal(F.setAlbumSeen("a", 8000, "file"), false, "a later date adds nothing");
  });

  await t.test("nonsense timestamps are refused", () => {
    const { F, albumSeenCache } = build();
    for (const bad of [0, -1, NaN, null, undefined, "yesterday"]) {
      assert.equal(F.setAlbumSeen("a", bad, "file"), false);
    }
    assert.equal(F.setAlbumSeen("", 1000, "file"), false, "no key, no record");
    assert.equal(albumSeenCache.size, 0);
  });
});

test("the first run must not date the whole library at once", async (t) => {
  await t.test("an empty store records nothing", () => {
    // THE rule. Without it, every album in an established library gets the
    // same timestamp and "Recently added" becomes a perfectly sorted lie.
    // Since 2.0.6-t4 the first run writes each album down as "undated" (known, never a date), so a library with no
    // files of its own can tell what it adds afterwards; still no album is given a date.
    const { F, albumSeenCache, bumps } = build([], [album("a"), album("b"), album("c")]);
    F.recordFirstSeenAlbums();
    assert.deepEqual([...albumSeenCache.values()].map((v) => v.src), ["undated", "undated", "undated"],
      "the first run has nothing to compare against, so it dates nothing");
    assert.equal(bumps(), 0, "and no date changed, so no cache invalidation");
  });

  await t.test("once anything is known, new albums are dated", () => {
    const { F, albumSeenCache } = build([["a", { ts: 1000, src: "file" }]],
                                        [album("a"), album("b")]);
    F.recordFirstSeenAlbums();
    assert.equal(albumSeenCache.size, 2);
    assert.equal(albumSeenCache.get("b").src, "first-seen");
    assert.ok(albumSeenCache.get("b").ts > 1000, "dated now, not at some epoch");
  });

  await t.test("an album already known is left alone", () => {
    // Re-dating on every rebuild would march the whole library's dates forward
    // and make "Recently added" mean "most recently rescanned".
    const { F, albumSeenCache } = build([["a", { ts: 1000, src: "file" }]], [album("a")]);
    F.recordFirstSeenAlbums();
    assert.equal(albumSeenCache.get("a").ts, 1000);
    assert.equal(albumSeenCache.get("a").src, "file");
  });

  await t.test("an album with no keys cannot be dated", () => {
    const { F, albumSeenCache } = build([["a", { ts: 1000, src: "file" }]],
                                        [album("a"), { title: "x", srcKeys: [] }]);
    F.recordFirstSeenAlbums();
    assert.equal(albumSeenCache.size, 1);
  });
});

test("2.0.6-t4: a library with no files of its own (Qobuz alone, Rouen Lite) dates what it adds after the first run", async (t) => {
  // The owner, 2026-11-23, on Rouen Lite with Qobuz alone: "library sort by … date added doesn't work. Same order
  // regardless of ascending or descending". The first run was told apart by an empty store, and only the file scan
  // ever put anything else in it: with no files, every rebuild was the first run, and nothing was ever dated.
  await t.test("the first run is the first run once", () => {
    const albums = [album("a"), album("b")];
    const { F, albumSeenCache } = build([], albums);
    F.recordFirstSeenAlbums();
    const undated = (k) => albumSeenCache.get(k) && albumSeenCache.get(k).src === "undated";
    assert.ok(undated("a") && undated("b"), "the library as it was: known, undated");
    albums.push(album("c"));
    F.recordFirstSeenAlbums();
    assert.equal(albumSeenCache.get("c") && albumSeenCache.get("c").src, "first-seen", "an album added since is dated");
    assert.ok(undated("a") && undated("b"), "and those there at the first run still aren't");
  });

  await t.test("an undated album is never shown with a date; a file's date still outranks it", () => {
    const { F, albumSeenCache } = build([], [album("a")]);
    const added = loadIndexFunctions(["albumAddedOf"], { albumSeenCache }).albumAddedOf;
    F.recordFirstSeenAlbums();
    assert.equal(added(album("a")), null, "known, not dated");
    assert.equal(F.setAlbumSeen("a", 1000, "file"), true, "a file's date replaces it");
    assert.equal(added(album("a")), 1000);
  });

  await t.test("the first run's rows are written in one transaction", () => {
    const writes = [];
    let open = false, transactions = 0;
    const labelsDb = { transaction: (fn) => () => { transactions++; open = true; try { return fn(); } finally { open = false; } } };
    const stmt = { run: (key, ts, src) => writes.push({ key, src, open }) };
    const { F } = build([], [album("a"), album("b"), album("c")], { labelsDb, stmt });
    F.recordFirstSeenAlbums();
    assert.equal(transactions, 1);
    assert.deepEqual(writes.map((w) => [w.key, w.src, w.open]), [["a", "undated", true], ["b", "undated", true], ["c", "undated", true]]);
  });

  await t.test("a store whose rows weren't read is never written (index.js: a failed open drops its statement)", () => {
    const src = indexSource();
    const fail = src.indexOf('console.error("[labels] db open failed:"');
    assert.ok(fail > 0);
    assert.match(src.slice(fail, fail + 400), /\n    stmtInsertSeen = null;   \/\/ /);
  });

  await t.test("a first run that saw no album takes nothing", () => {
    const albums = [];
    const { F, albumSeenCache } = build([], albums);
    F.recordFirstSeenAlbums();
    assert.equal(albumSeenCache.size, 0, "the Core not read yet: no first run taken");
    albums.push(album("a"), album("b"));
    F.recordFirstSeenAlbums();
    assert.deepEqual([albumSeenCache.get("a").src, albumSeenCache.get("b").src], ["undated", "undated"],
      "the library, when it comes, is the first run: undated, not dated now");
  });

});
