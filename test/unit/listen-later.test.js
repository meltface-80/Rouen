"use strict";
// ---------------------------------------------------------------------------
// v1.8.67: the Listen later list — how it is stored, matched and emptied.
//
// Built against the REAL schema and the REAL statements: the table definition
// is read out of index.js, and the functions are the shipping ones (see
// test/lib/extract.js). Only the library lookup is injected, because it reads
// the snapshot, and that is the part each test has to arrange.
//
// What each group pins:
//
//   1. ONE ENTRY PER ALBUM, IN EITHER SPELLING. A Smart Pick is put aside under
//      the service's title ("Album (Deluxe)") and later reached from Roon's
//      ("Album"). Both directions have to find it, or the album view offers
//      "Listen later" for an album already on the list and Remove leaves a
//      twin behind.
//   2. "PLAYED THROUGH" MEANS EVERY TRACK, AFTER IT WAS PUT ASIDE. A play from
//      before, a sampled track, or an album whose track list was never seen
//      must all leave the entry where it is. Taking an album off the list on a
//      guess loses something the user asked to keep.
//   3. "NOT FOR ME" TAKES A PICK'S ENTRIES, NEVER THE USER'S OWN.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { indexSource, loadIndexFunctions } = require("../lib/extract");
const { createExactIndex } = require("../../lib/library-exact");
const { createListening } = require("../../lib/listening/listening");
const SRC = indexSource();

let Database = null;
try { Database = require("better-sqlite3"); } catch (e) {
  // Optional in environments without the native build; the suite skips below
  // rather than failing for a reason unrelated to the code under test.
}

// Smart Picks' own tables moved to lib/smart-picks/tables.js with each profile's key (2.0.7-t3): read from there.
const PICKS_DDL = require("../../lib/smart-picks/tables").DDL;
function ddl(table) {
  if (PICKS_DDL[table]) return PICKS_DDL[table];
  const re = new RegExp("CREATE TABLE IF NOT EXISTS " + table + "\\s*\\([\\s\\S]*?\\n\\s*\\);", "m");
  const m = re.exec(SRC);
  if (!m) throw new Error("no CREATE TABLE for " + table + " found in index.js");
  return m[0];
}

const FNS = [
  "listenLaterServices", "listenLaterSources", "listenLaterRows", "listenLaterRecord",
  "listenLaterLibraryRecord",
  "listenLaterKeysFor", "listenLaterMatches", "listenLaterAdd",
  "listenLaterRemove", "listenLaterForgetPickArtist", "listenLaterPlayedThrough",
  "listenLaterNoticePlay", "listenLaterServiceUrl", "listenLaterForgetPicksOfDay",
  "albumKey", "canonText", "canonArtist", "normalize", "trackTitleKeys", "albumTitleVariants", "listenKey",
];

// Whether the album is on Rouen's own list (the route module's has(), native mode off).
const has = (h, title, artist) => h.F.listenLaterMatches(title, artist).length > 0;

// `library`: the albums Roon has, as { title, subtitle, offset }. Matched the
// way smartLibraryRecord matches — any albumKeys identity in common — using the
// shipping key builder, so the test cannot be looser than production.
function harness(library) {
  const db = new Database(":memory:");
  db.exec(ddl("listen_later"));
  db.exec(ddl("plays"));
  db.exec(ddl("album_tracks"));
  db.exec(ddl("smart_picks"));
  const keysF = loadIndexFunctions(["albumKeys", "albumKey", "albumTitleVariants", "canonText", "canonArtist", "normalize"], {});
  // The plays as 2.0.6-t20 keeps them (lib/listening/): albums played, which Listen later reads, by index.js's album key.
  const listening = createListening({ db: () => db, albums: () => [], version: () => 0, albumKey: keysF.albumKey,
    canonText: keysF.canonText, canonArtist: keysF.canonArtist, splitCredit: (c) => [c], plainCredit: (c) => c,
    trackKeys: (t) => [t], openAlbum: async () => ({ tracks: [] }), state: new Map(), history: new Map(),
    historyEntry: () => null, pushHistory: (l) => l, zoneName: (z) => z, changed() {}, albumPlayed() {}, log() {}, debug() {} });
  listening.migrate(db);
  const lib = (library || []).map(a => Object.assign({ keys: new Set(keysF.albumKeys(a.title, a.subtitle)) }, a));
  // liveRevisions is loaded alongside, so the `later` counter these functions
  // bump is the one the app polls — the only way to observe a module-level
  // `let` from outside (the same arrangement as live.test.js).
  const F = loadIndexFunctions(FNS.concat(["liveRevisions"]), {
    labelsDb: db,
    listening,
    laterVersion: 0,
    settingsStore: { frozen: () => false, version: () => 0 },   // lib/settings.js since v1.9.22
    // lib/library-exact.js since v1.9.49 (the exact step, moved out of index.js): over the same library and key.
    libraryExact: createExactIndex({ index: () => ({ builtAt: 1, albums: lib }), albumKey: (t, a) => keysF.albumKey(t, a) }),
    albumIndex: { builtAt: 1, albums: lib }, libraryMetaVersion: 0, libraryDateVersion: 0,
    playsVersion: 0, picksVersion: 0, discoverVersion: 0,
    labelsEnabled: false, labelsIndex: { builtAt: 0, map: new Map() },
    smartDayKey: () => "2026-10-02", aotdDayKey: () => "2026-10-02",
    console: { log() {}, error() {} },
    qobuzDeep: { deepLink: (id) => "https://open.qobuz.com/album/" + id },
    smartLibraryRecord: (title, artist) => {
      if (!title) return null;
      for (const k of keysF.albumKeys(title, artist || "")) {
        const hit = lib.find(a => a.keys.has(k));
        if (hit) return hit;
      }
      return null;
    },
  });
  return { db, F, listening };
}

function setAddedAt(h, ts) { h.db.prepare("UPDATE listen_later SET ts = ?").run(ts); }

test("an album is on the list once, found from either spelling", { skip: !Database }, async (t) => {
  await t.test("added under Roon's title, found and removed under Roon's title", () => {
    const h = harness([{ title: "Blue", subtitle: "Joni Mitchell", offset: 3 }]);
    assert.equal(h.F.listenLaterAdd({ title: "Blue", artist: "Joni Mitchell" }), true);
    assert.equal(has(h, "Blue", "Joni Mitchell"), true);
    assert.equal(h.F.listenLaterRemove("Blue", "Joni Mitchell"), 1);
    assert.equal(h.F.listenLaterRows().length, 0);
  });

  await t.test("a pick stored under the service's title is found from Roon's, and the other way", () => {
    // Roon has imported the pick under its own, cleaner title.
    const h = harness([{ title: "Further", subtitle: "Flying Saucer Attack", offset: 9 }]);
    h.F.listenLaterAdd({ title: "Further (Remastered)", artist: "Flying Saucer Attack",
                         service: "qobuz", album_id: "q3", source: "picks" });
    assert.equal(has(h, "Further", "Flying Saucer Attack"), true,
      "the album view would offer Listen later for an album already on the list");
    // A second add from the album view must not create a twin.
    h.F.listenLaterAdd({ title: "Further", artist: "Flying Saucer Attack" });
    assert.equal(h.F.listenLaterRows().length, 1, "the same album went on the list twice");
    // And Remove from Roon's spelling takes the service-spelled row.
    assert.equal(h.F.listenLaterRemove("Further", "Flying Saucer Attack"), 1);
    assert.equal(h.F.listenLaterRows().length, 0);
  });

  await t.test("adding again keeps the date it was first put aside", () => {
    const h = harness([]);
    h.F.listenLaterAdd({ title: "Beat", artist: "Bowery Electric" });
    setAddedAt(h, 1000);
    h.F.listenLaterAdd({ title: "Beat", artist: "Bowery Electric" });
    assert.equal(h.F.listenLaterRows()[0].ts, 1000, "a second tap moved it to the front");
  });

  await t.test("an unknown service and a non-http image are not stored", () => {
    const h = harness([]);
    h.F.listenLaterAdd({ title: "Quique", artist: "Seefeel", service: "napster",
                         album_id: "x", image: "javascript:alert(1)", source: "bogus" });
    const r = h.F.listenLaterRows()[0];
    assert.equal(r.service, null);
    assert.equal(r.album_id, null, "an album id without a service it belongs to");
    assert.equal(r.image, null);
    assert.equal(r.source, "album");
  });

  await t.test("a title with no letters or digits is refused, not keyed", () => {
    const h = harness([]);
    assert.equal(h.F.listenLaterAdd({ title: "!!!", artist: "X" }), false);
    assert.equal(h.F.listenLaterRows().length, 0);
  });
});

// 2.0.6-t20 (dev/design/listening.md): an entry leaves once its album has been played — every track of it, 95% each,
// in one run (test/unit/listening.test.js tests that rule: a sampled album, a skipped track heard later, a remaster
// suffix, another album between, an album with no track list never played). Here: which album plays take an entry off.
test("an album leaves the list once it has been played since it was put aside",
  { skip: !Database }, async (t) => {
    const LIB = [{ title: "Blue", subtitle: "Joni Mitchell", offset: 3 }];
    /** An album played, as noteAlbumPlay records it: under the library record's key. */
    const albumPlay = (h, ts, title, artist) =>
      h.listening.addAlbumPlay({ ts, zone: "Z", key: h.F.listenKey({ title, subtitle: artist }), title, image_key: null, tracks: 3 });

    await t.test("played after it was put aside: off the list", () => {
      const h = harness(LIB);
      h.F.listenLaterAdd({ title: "Blue", artist: "Joni Mitchell" });
      setAddedAt(h, 1000);
      albumPlay(h, 2000, "Blue", "Joni Mitchell");
      h.F.listenLaterNoticePlay("Blue");
      assert.equal(h.F.listenLaterRows().length, 0);
    });

    await t.test("tracks played but no album play (sampled, or a track skipped): it stays", () => {
      const h = harness(LIB);
      h.F.listenLaterAdd({ title: "Blue", artist: "Joni Mitchell" });
      setAddedAt(h, 1000);
      for (const tr of ["All I Want", "My Old Man", "Little Green"]) {
        h.db.prepare("INSERT INTO plays (ts, zone, track, artist, album, image_key, duration, played, album_key) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(2000, "Z", tr, "Joni Mitchell", "Blue", "", 200, 1, h.F.listenKey({ title: "Blue", subtitle: "Joni Mitchell" }));
      }
      h.F.listenLaterNoticePlay("Blue");
      assert.equal(h.F.listenLaterRows().length, 1, "THE one: track plays alone took it off");
    });

    await t.test("played BEFORE it was put aside does not count", () => {
      const h = harness(LIB);
      h.F.listenLaterAdd({ title: "Blue", artist: "Joni Mitchell" });
      setAddedAt(h, 5000);
      albumPlay(h, 2000, "Blue", "Joni Mitchell");
      h.F.listenLaterNoticePlay("Blue");
      assert.equal(h.F.listenLaterRows().length, 1, "last month's listen emptied an album put aside today");
    });

    await t.test("another album of the same title played: it stays", () => {
      const h = harness(LIB);
      h.F.listenLaterAdd({ title: "Blue", artist: "Joni Mitchell" });
      setAddedAt(h, 1000);
      albumPlay(h, 2000, "Blue", "Weezer");
      h.F.listenLaterNoticePlay("Blue");
      assert.equal(h.F.listenLaterRows().length, 1);
    });
  });

test("\"Not for me\" takes the artist's picks off the list and nothing else",
  { skip: !Database }, async (t) => {
    await t.test("picks by the artist go, the user's own albums by them stay", () => {
      const h = harness([]);
      h.F.listenLaterAdd({ title: "Depths", artist: "Windy & Carl", service: "qobuz",
                           album_id: "q5", source: "picks" });
      h.F.listenLaterAdd({ title: "Antarctica", artist: "Windy & Carl" });   // put aside by hand
      h.F.listenLaterAdd({ title: "Further", artist: "Flying Saucer Attack", service: "qobuz",
                           album_id: "q3", source: "picks" });
      const n = h.F.listenLaterForgetPickArtist(h.F.canonArtist("Windy & Carl"));
      assert.equal(n, 1);
      const left = h.F.listenLaterRows().map(r => r.title).sort();
      assert.deepEqual(left, ["Antarctica", "Further"]);
    });

    await t.test("a pick credited jointly by the service still goes", () => {
      // The entry carries the SERVICE's credit; "Not for me" names the act.
      const h = harness([]);
      h.F.listenLaterAdd({ title: "Texas Sun", artist: "Khruangbin & Leon Bridges", service: "qobuz",
                           album_id: "q9", source: "picks" });
      assert.equal(h.F.listenLaterForgetPickArtist(h.F.canonArtist("Khruangbin")), 1,
        "the blocked act's joint record stayed on the list");
    });
  });

test("a service entry knows where it can be opened", { skip: !Database }, () => {
  const h = harness([]);
  assert.equal(h.F.listenLaterServiceUrl("qobuz", "123"), "https://open.qobuz.com/album/123");
  assert.equal(h.F.listenLaterServiceUrl("tidal", "456"), "https://tidal.com/browse/album/456");
  assert.equal(h.F.listenLaterServiceUrl(null, "456"), null);
  assert.equal(h.F.listenLaterServiceUrl("qobuz", null), null);
});

test("every change to the list moves the `later` revision the screens follow",
  { skip: !Database }, () => {
    const h = harness([]);
    const rev = () => h.F.liveRevisions().later;
    const r0 = rev();
    h.F.listenLaterAdd({ title: "Beat", artist: "Bowery Electric" });
    const r1 = rev();
    assert.notEqual(r1, r0, "putting an album aside did not move the revision — other devices keep the old row");
    h.F.listenLaterAdd({ title: "Beat", artist: "Bowery Electric" });
    assert.equal(rev(), r1, "adding an album already on the list moved the revision");
    h.F.listenLaterRemove("Beat", "Bowery Electric");
    const r2 = rev();
    assert.notEqual(r2, r1, "taking an album off did not move the revision");
    h.F.listenLaterRemove("Beat", "Bowery Electric");
    assert.equal(rev(), r2, "removing an album not on the list moved the revision");
  });

test("a rebuilt day takes the discarded set's entries with it", { skip: !Database }, () => {
  const h = harness([]);
  h.db.prepare("INSERT INTO smart_picks (profile, day, kind, rank, artist, canon, album, album_id, service, ts) " +
               "VALUES ('1','2026-10-02','adjacent',0,'Seefeel','seefeel','Quique','q4','qobuz',1)").run();
  // Another profile's pick of the same day (2.0.7-t3): its entry is not this profile's to take away.
  h.db.prepare("INSERT INTO smart_picks (profile, day, kind, rank, artist, canon, album, album_id, service, ts) " +
               "VALUES ('2','2026-10-02','adjacent',0,'Loscil','loscil','Sea','q5','qobuz',1)").run();
  h.F.listenLaterAdd({ title: "Sea", artist: "Loscil", service: "qobuz", album_id: "q5", source: "picks" });
  h.F.listenLaterAdd({ title: "Quique", artist: "Seefeel", service: "qobuz", album_id: "q4", source: "picks" });
  // Yesterday's pick, and an album put aside by hand: neither is today's set.
  h.F.listenLaterAdd({ title: "Further", artist: "Flying Saucer Attack", service: "qobuz",
                       album_id: "q3", source: "picks" });
  h.F.listenLaterAdd({ title: "Blue", artist: "Joni Mitchell" });
  assert.equal(h.F.listenLaterForgetPicksOfDay("2026-10-02", "1"), 1);
  assert.deepEqual(h.F.listenLaterRows().map(r => r.title).sort(), ["Blue", "Further", "Sea"],
    "THE one (the review): one profile's Rebuild took another's picks off Listen later");
});

test("an entry resolves to ITS edition, not to another sharing a stripped title", { skip: !Database }, () => {
  // The tolerant lookup files "rumours||fleetwood mac" under whichever album
  // came first — here the deluxe edition, standing first in the library.
  const deluxe = { title: "Rumours (Deluxe Edition)", subtitle: "Fleetwood Mac", offset: 1 };
  const plain  = { title: "Rumours", subtitle: "Fleetwood Mac", offset: 2 };
  const h = harness([deluxe, plain]);
  h.F.listenLaterAdd({ title: "Rumours", artist: "Fleetwood Mac" });
  assert.equal(h.F.listenLaterRecord(h.F.listenLaterRows()[0]).offset, 2,
    "the plain record's entry resolved to the deluxe edition");
  assert.equal(has(h, "Rumours (Deluxe Edition)", "Fleetwood Mac"), false,
    "the deluxe album view would offer to remove the plain edition's entry");
  assert.equal(h.F.listenLaterRemove("Rumours (Deluxe Edition)", "Fleetwood Mac"), 0);
});
