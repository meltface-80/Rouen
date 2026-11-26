"use strict";
// ---------------------------------------------------------------------------
// Profiles, P1b (2.0.7-t3, dev/design/profiles.md §3, §10.9-10.10): each profile's Smart Picks, "Not for me", artists
// already shown and Tune; which profiles get a daily build; what a removed profile's picks and Tune do. Each test was
// broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const tables = require("../../lib/smart-picks/tables");
const { createTunes, defaultTune } = require("../../lib/smart-picks/tune");
const { createProfileStore } = require("../../lib/profiles/store");
const { createListeningStore } = require("../../lib/listening/store");
const { buildEach, createDaily } = require("../../lib/smart-picks/daily");
const { createProfiles, GUEST } = require("../../lib/profiles");
const SMART_CACHE = "CREATE TABLE IF NOT EXISTS smart_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, ts INTEGER NOT NULL);";

let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s; without it the database's tests skip, as a better-sqlite3 test does without its build
}
const canon = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

test("an install from before profiles: Smart Picks' tables made again with the profile in their keys, rows the first's", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(SMART_CACHE);
  db.prepare("INSERT INTO smart_cache (key, body, ts) VALUES ('why', '{\"day\":\"d\"}', 1)").run();
  // The schema as 2.0.7-t2 shipped it (index.js, before this version moved it to lib/smart-picks/tables.js).
  db.exec(`CREATE TABLE smart_picks (day TEXT NOT NULL, kind TEXT NOT NULL, rank INTEGER NOT NULL, mbid TEXT, artist TEXT NOT NULL,
    canon TEXT NOT NULL, album TEXT, album_id TEXT, service TEXT, image TEXT, reason TEXT, genre TEXT, ts INTEGER NOT NULL,
    PRIMARY KEY (day, kind, rank));
    CREATE TABLE smart_pick_seen (canon TEXT PRIMARY KEY, ts INTEGER NOT NULL);
    CREATE TABLE smart_pick_blocks (canon TEXT PRIMARY KEY, name TEXT, ts INTEGER NOT NULL);`);
  db.prepare("INSERT INTO smart_picks (day, kind, rank, artist, canon, ts) VALUES ('d', 'adjacent', 0, 'A', 'a', 1)").run();
  db.prepare("INSERT INTO smart_pick_seen (canon, ts) VALUES ('a', 1)").run();
  db.prepare("INSERT INTO smart_pick_blocks (canon, name, ts) VALUES ('b', 'B', 1)").run();
  tables.migrate(db, "7");
  tables.migrate(db, "7");   // again: nothing more
  assert.deepEqual(db.prepare("SELECT profile, artist FROM smart_picks").all().map((r) => ({ ...r })), [{ profile: "7", artist: "A" }],
    "THE one: the picks kept before profiles lost, or no one's");
  assert.equal(db.prepare("SELECT profile FROM smart_pick_seen").get().profile, "7");
  assert.equal(db.prepare("SELECT profile FROM smart_pick_blocks").get().profile, "7");
  // Two profiles can now each have the same day's rank 0, and each block the same artist.
  db.prepare("INSERT INTO smart_picks (profile, day, kind, rank, artist, canon, ts) VALUES ('8', 'd', 'adjacent', 0, 'Z', 'z', 1)").run();
  db.prepare("INSERT INTO smart_pick_blocks (profile, canon, name, ts) VALUES ('8', 'b', 'B', 1)").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM smart_picks").get().n, 2);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%before_profiles'").get(), undefined, "the old table left behind");
  assert.deepEqual(db.prepare("SELECT key FROM smart_cache").all().map((r) => r.key), ["why:7"], "the last Why these picks lost at the update");
});

test("a profile removed: its Not for me and artists shown go to the other (whose own are kept); its picks go", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(SMART_CACHE);
  tables.migrate(db, "1");
  const block = db.prepare("INSERT INTO smart_pick_blocks (profile, canon, name, ts) VALUES (?, ?, ?, ?)");
  block.run("2", "x", "X", 1); block.run("2", "shared", "S", 5); block.run("1", "shared", "S", 9);
  db.prepare("INSERT INTO smart_picks (profile, day, kind, rank, artist, canon, ts) VALUES ('2', 'd', 'adjacent', 0, 'A', 'a', 1)").run();
  tables.moveProfile(db, "2", "1");
  assert.deepEqual(db.prepare("SELECT profile, canon, ts FROM smart_pick_blocks ORDER BY canon").all().map((r) => ({ ...r })),
    [{ profile: "1", canon: "shared", ts: 9 }, { profile: "1", canon: "x", ts: 1 }], "THE one: a removed profile's Not for me lost, or doubled");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM smart_picks").get().n, 0);
});

test("each profile's Tune: the one kept before profiles is the first's; one profile's change is its own; removal", () => {
  let settings = { smartPicksTune: { window: 0 } };
  const tunes = createTunes({ settings: () => settings, save: (p) => { settings = { ...settings, ...p }; return true; }, first: () => "1", canonArtist: canon });
  assert.equal(tunes.get("1").window, 0, "THE one: the Tune kept before profiles lost");
  assert.deepEqual(tunes.get("2"), defaultTune(), "a new profile untuned");
  tunes.set("2", { ...defaultTune(), window: 4 });
  assert.equal(tunes.get("1").window, 0, "one profile's Tune changed another's");
  assert.equal(tunes.get("2").window, 4);
  tunes.set("3", defaultTune());
  tunes.move("2", "3");
  assert.equal(tunes.get("3").window, 4, "removed into an untuned profile: its Tune goes with its listening");
  tunes.set("4", { ...defaultTune(), adventure: 0 });
  tunes.move("3", "4");
  assert.equal(tunes.get("4").adventure, 0, "removed into a tuned profile: that one's own kept");
  assert.equal(Object.prototype.hasOwnProperty.call(settings.smartPicksTunes, "3"), false, "a removed profile's Tune left");
});

test("which profiles get a daily build: the first, and each with plays or chosen on a device in 30 days", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
    artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);`);
  createListeningStore({ db: () => db }).migrate(db);
  let t = 1000;
  const store = createProfileStore({ db: () => db, accountName: () => "Alex", now: () => t });
  store.migrate(db);
  const sam = store.add("Sam").id, kim = store.add("Kim").id, lee = store.add("Lee").id;
  db.prepare("INSERT INTO album_plays (ts, zone, album_key, profile) VALUES (?, 'z', 'k', ?)").run(900, sam);
  db.prepare("INSERT INTO plays (ts, zone, track, profile) VALUES (?, 'z', 't', ?)").run(100, kim);   // too long ago
  db.prepare("INSERT INTO plays (ts, zone, track, profile) VALUES (?, 'z', 't', '')").run(950);       // Guest's
  store.markSeen(lee);
  assert.deepEqual(store.activeIds(500, ["plays", "album_plays"]), [store.first().id, sam, lee],
    "THE one (the owner: active ones): a profile nobody uses built, or one in use left out");
  t += 30 * 60 * 1000;
  store.markSeen(kim);   // within the hour since Lee's: still written, it's Kim's first
  assert.ok(store.activeIds(500, []).includes(kim));
});

test("the Tune kept before profiles is the first's once; removing first profiles later never brings it back", () => {
  let settings = { smartPicksTune: { window: 0 } };
  let first = "1";
  const tunes = createTunes({ settings: () => settings, save: (p) => { settings = { ...settings, ...p }; return true; }, first: () => first, canonArtist: canon });
  tunes.set("1", { ...defaultTune(), window: 3 });   // A's own, after the update
  assert.equal(settings.smartPicksTune, undefined, "the old key kept, to come back later");
  tunes.set("2", defaultTune());
  first = "2";                                        // A removed into B (never tuned)
  tunes.move("1", "2");
  assert.equal(tunes.get("2").window, 3, "THE one (the review): B got the old pre-profiles Tune, not A's");
});

test("each active profile built in turn; one profile's failure stops no other's and is thrown after", async () => {
  const built = [];
  const d = { profiles: () => ["1", "2", "3", "4"], has: (day, p) => p === "2", tried: (day, p) => p === "4",
    build: async (day, p) => { built.push(p); if (p === "1") throw new Error("one failed"); } };
  await assert.rejects(buildEach("d", {}, d), /one failed/);
  assert.deepEqual(built, ["1", "3"], "THE one (the review): a profile after a failing one never built, or one with today's set rebuilt");
  built.length = 0;
  await buildEach("d", { profile: "2" }, d);
  assert.deepEqual(built, ["2"], "a profile's own Rebuild skipped because it had a set");
});

test("a value built once a day for each profile, the last answered while today's builds", async () => {
  let day = "d1", n = 0;
  const daily = createDaily({ day: () => day, build: async (p) => p + ":" + (++n) });
  assert.equal(daily.get("1"), null);
  await daily.rebuild("1");
  assert.equal(daily.get("1"), "1:1", "asked twice while building: built twice");
  assert.equal(daily.get("2"), null, "one profile's value given to another");
  day = "d2";
  assert.equal(daily.get("1"), "1:1", "yesterday's not answered while today's builds");
  await daily.rebuild("1");
  assert.equal(daily.get("1"), "1:3", "today's not built, or built twice");
});

test("whose Smart Picks: the device's; none, the first's; Guest nobody's; no database, no build and no throw", { skip: !Database }, () => {
  let db = new Database(":memory:");
  db.exec(`CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
    artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);`);
  createListeningStore({ db: () => db }).migrate(db);
  const p = createProfiles({ db: () => db, accountName: () => "Alex", zone: () => null, changed() {} });
  p.migrate(db);
  const first = p.store.first().id;
  assert.equal(p.picksOf("5"), "5");
  assert.equal(p.picksOf(undefined), first);
  assert.equal(p.picksOf(GUEST), null, "THE one (the owner: nothing personal): Guest shown someone's picks");
  assert.equal(p.owner({ profile: GUEST }), null);
  assert.equal(p.owner({ profile: "5" }), "5");
  assert.deepEqual(p.picksProfiles(), [first]);
  db = null;
  assert.deepEqual(p.picksProfiles(), [], "THE one (the review): no database threw from the build's timer");
  assert.equal(p.picksOf(undefined), "");
});

test("a profile's seeds read its own plays: another's (and no one's) are a gap, not part of its runs", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
    artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);`);
  const st = createListeningStore({ db: () => db });
  st.migrate(db);
  const play = (ts, album, artist, profile) => st.endPlay(st.startPlay({ ts, zone: "z", track: "t", artist, album, image_key: "", duration: 100, album_key: album, profile }), 100, true);
  play(1000, "k", "Jarrett", "1");
  play(2000, "k", "Jarrett", "2");   // another's track of the same album, right after: not a run of profile 1's
  play(9e9, "m", "Garbarek", "1");
  st.addAlbumPlay({ ts: 5, zone: "z", key: "k", title: "K", image_key: null, tracks: 2, profile: "2" });
  const one = { id: "1", legacy: false };
  assert.deepEqual(st.trackPlaysAlone(one).map((r) => r.artist), ["Jarrett", "Garbarek"], "THE one: another profile's play joined this one's run");
  assert.deepEqual(st.albumPlayRows(one), [], "another profile's album play seeded this one");
  assert.deepEqual(st.playedArtistRows(0, one).map((r) => r.artist), ["Jarrett", "Garbarek"]);
  assert.equal(st.playedArtistRows(0, null).length, 3, "everyone's (Discover)");
});
