"use strict";
// ---------------------------------------------------------------------------
// What counts as a play (2.0.6-t20, dev/design/listening.md; the owner, 2026-11-26: "Play 95% of a track should count
// as a play count so if all tracks of an album have been played 95% or more than the album would be marked as a play
// count increase. Someone who skips through tracks within an album should not count").
//
// A user's report, the same day: Smart Picks kept to 1980s pop and soul, under a tenth of their listening. Until this
// version every started track counted, and plays were matched to albums by title, so one play of any "Greatest Hits"
// counted for every "Greatest Hits" in the library. Each test here was broken on purpose once (the rule at 50%, the
// match by title alone, a run that does not end on another album, a pause that ends the track) and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { trackPlayed } = require("../../lib/listening/rule");
const { createAlbumMatcher } = require("../../lib/listening/album-match");
const { createRuns, allHeard } = require("../../lib/listening/runs");
const { createScrobbler } = require("../../lib/listening/scrobble");
const { createListeningStore } = require("../../lib/listening/store");

let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s; without it the store's tests skip, as a better-sqlite3 test does without its build
}

// Index.js's own keys, as they key the library (a simplified canon: lower case, letters and digits).
const canon = (/** @type {string} */ s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keyOf = (/** @type {any} */ al) => (al.title ? canon(al.title) + "||" + canon(al.subtitle) : null);
const splitCredit = (/** @type {string} */ s) => String(s || "").split(/\s*(?:\/|,|&)\s*/).filter(Boolean);
const trackKeys = (/** @type {string} */ t) => [canon(t)];

const LIB = [
  { title: "Greatest Hits", subtitle: "Diana Ross", image_key: "img-ross", offset: 1 },
  { title: "Greatest Hits", subtitle: "Michael Bolton", image_key: "img-bolton", offset: 2 },
  { title: "Kind of Blue", subtitle: "Miles Davis", image_key: "img-kob", offset: 3 },
  { title: "Köln Concert", subtitle: "Keith Jarrett", image_key: "img-koln", offset: 4 },
];
const matcher = () => createAlbumMatcher({ albums: () => LIB, version: () => 1, keyOf, canonText: canon, canonArtist: canon, splitCredit });

// ---------------------------------------------------------------------------
test("a track play is 95% of it heard; less, a seek to the end, or a stream with no length is not", () => {
  assert.equal(trackPlayed(285, 300), true, "95% heard");
  assert.equal(trackPlayed(284, 300), true, "Roon's last second, never reported, allowed for");
  assert.equal(trackPlayed(270, 300), false, "THE one: 90% is not a play (the old rule took half)");
  assert.equal(trackPlayed(150, 300), false);
  assert.equal(trackPlayed(600, 0), false, "no length: a stream");
});

test("THE user's case: a play belongs to its own album, never to every album of its title", () => {
  const m = matcher();
  assert.equal(m.match({ album: "Greatest Hits", artist: "Diana Ross", image_key: "img-ross" }).key, "greatest hits||diana ross");
  assert.equal(m.match({ album: "Greatest Hits", artist: "Diana Ross", image_key: "" }).key, "greatest hits||diana ross",
    "by the title and the track's artist when the cover says nothing");
  assert.equal(m.match({ album: "Greatest Hits", artist: "The Supremes", image_key: "" }), null,
    "two albums of that title and neither credits the artist: no album, never both");
  assert.equal(m.match({ album: "Kind of Blue", artist: "John Coltrane", image_key: "" }).key, "kind of blue||miles davis",
    "a title only one album has: that album (a sideman's track)");
  assert.equal(m.match({ album: "Blue Train", artist: "John Coltrane", image_key: "" }), null, "not in the library");
});

// ---------------------------------------------------------------------------
/** An album of `n` tracks, and a run tracker that records album plays. */
function album(n, titles) {
  const list = (titles || Array.from({ length: n }, (_, i) => "Track " + (i + 1))).map((t, i) => ({ n: i, tkey: canon(t) }));
  const played = [];
  const runs = createRuns({ tracksOf: (k) => (k === "a" ? list : []), trackKeys, onAlbumPlay: (p) => played.push(p) });
  const al = { title: "A", subtitle: "X" };
  const hear = (zone, title, ok = true, ts = 1000, key = "a") => runs.noteTrack(zone, { key, al, title, played: ok, ts });
  return { runs, played, hear };
}

test("an album play: every track to 95% in one run; three of ten sampled is none", () => {
  const { played, hear } = album(10);
  for (let i = 1; i <= 3; i++) hear("z", "Track " + i);
  assert.equal(played.length, 0, "THE one: sampling three tracks is not an album play");
  for (let i = 4; i <= 10; i++) hear("z", "Track " + i);
  assert.equal(played.length, 1, "the rest heard in the same run: one album play");
  assert.equal(played[0].tracks, 10);
});

test("a run survives a skipped track heard later, a repeat and any order; twice through counts two", () => {
  const { played, hear } = album(4);
  hear("z", "Track 2"); hear("z", "Track 1", false); hear("z", "Track 2"); hear("z", "Track 4"); hear("z", "Track 3");
  assert.equal(played.length, 0, "track 1 skipped, so not yet");
  hear("z", "Track 1");
  assert.equal(played.length, 1);
  for (let i = 1; i <= 4; i++) hear("z", "Track " + i);
  assert.equal(played.length, 2, "twice through");
});

test("a track of another album, or twelve hours, ends the run; zones are their own", () => {
  const a = album(3);
  a.hear("z", "Track 1"); a.hear("z", "Track 2");
  a.hear("z", "Other", false, 1000, "b");   // a track of another album, skipped
  a.hear("z", "Track 3");
  assert.equal(a.played.length, 0, "THE one: another album between ends it");
  const b = album(2);
  b.hear("z", "Track 1", true, 0); b.hear("z", "Track 2", true, 13 * 60 * 60 * 1000);
  assert.equal(b.played.length, 0, "thirteen hours later is another listening");
  const c = album(2);
  c.hear("z1", "Track 1"); c.hear("z2", "Track 2");
  assert.equal(c.played.length, 0, "half on one zone, half on another");
});

test("two tracks of one title (a reprise) need hearing twice", () => {
  assert.equal(allHeard([{ n: 0, tkey: "intro" }, { n: 1, tkey: "song" }, { n: 2, tkey: "intro" }], ["Intro", "Song"], trackKeys), false);
  assert.equal(allHeard([{ n: 0, tkey: "intro" }, { n: 1, tkey: "song" }, { n: 2, tkey: "intro" }], ["Intro", "Song", "Intro"], trackKeys), true);
});

test("an album whose track list Rouen hasn't kept is read once, when its first track is played, then counted", async () => {
  let list = [];
  const reads = [];
  const played = [];
  const runs = createRuns({ tracksOf: () => list, trackKeys, onAlbumPlay: (p) => played.push(p),
    readTracks: async (al) => { reads.push(al.title); list = [{ n: 0, tkey: "one" }, { n: 1, tkey: "two" }]; } });
  const al = { title: "New", subtitle: "Y" };
  runs.noteTrack("z", { key: "n", al, title: "One", played: false, ts: 1 });
  assert.deepEqual(reads, [], "a track sampled below 95% costs no read");
  runs.noteTrack("z", { key: "n", al, title: "One", played: true, ts: 2 });
  runs.noteTrack("z", { key: "n", al, title: "Two", played: true, ts: 3 });
  await new Promise((r) => { setImmediate(r); });
  assert.deepEqual(reads, ["New"], "read once");
  assert.equal(played.length, 1);
});

// ---------------------------------------------------------------------------
/** Zone pushes, as Roon sends them, through the scrobbler, with the store's calls recorded. */
function zoneOf() {
  const rows = [], ends = [], runsSeen = [];
  let clock = 0;
  const store = { startPlay: (p) => { rows.push(p); return rows.length; }, endPlay: (id, heard, ok) => ends.push({ id, heard: Math.round(heard), ok }) };
  const s = createScrobbler({ state: new Map(), history: new Map(), historyEntry: () => null, pushHistory: (l) => l,
    store: () => /** @type {any} */ (store), match: () => ({ key: "a", al: { title: "A" } }), libraryReady: () => true,
    runs: /** @type {any} */ ({ noteTrack: (z, t) => runsSeen.push(t), end() {} }), changed() {}, now: () => clock });
  const push = (state, track, pos, length = 200) => {
    clock += 1000;
    s.update({ zone_id: "z", display_name: "Study", state,
      now_playing: { seek_position: pos, length, image_key: "i", three_line: { line1: track, line2: "X", line3: "A" } } });
  };
  /** Play `track` from `from` to `to`, a report a second. */
  const play = (track, from, to) => { for (let p = from; p <= to; p++) push("playing", track, p); };
  return { s, rows, ends, runsSeen, push, play };
}

test("a pause half way keeps the track: heard before and after adds up to a play (it used to be two half plays)", () => {
  const z = zoneOf();
  z.play("One", 0, 100);
  z.push("paused", "One", 100);
  z.push("paused", "One", 100);
  z.play("One", 100, 200);
  z.play("Two", 0, 3);
  assert.equal(z.rows.length, 2, "THE one: one row for One, not one per side of the pause");
  assert.deepEqual(z.ends[0], { id: 1, heard: 200, ok: true });
});

test("a seek to the end is not listening; a stop ends the track as far as it was heard", () => {
  const z = zoneOf();
  z.play("One", 0, 10);
  z.push("playing", "One", 195);   // a seek forward
  z.play("One", 196, 200);
  z.play("Two", 0, 50);
  z.push("stopped", "Two", 50);
  assert.deepEqual(z.ends.map((e) => [e.heard, e.ok]), [[15, false], [50, false]]);
  assert.deepEqual(z.runsSeen.map((t) => [t.title, t.played]), [["One", false], ["Two", false]]);
});

test("the same track again (repeat one) is a play of its own", () => {
  const z = zoneOf();
  z.play("One", 0, 200);
  z.play("One", 0, 200);
  z.push("stopped", "One", 200);
  assert.equal(z.rows.length, 2);
  assert.deepEqual(z.ends.map((e) => e.ok), [true, true]);
});

test("a zone gone, or the Core: the track ends as far as it was heard", () => {
  const z = zoneOf();
  z.play("One", 0, 199);
  z.s.zoneGone("z");
  assert.deepEqual(z.ends, [{ id: 1, heard: 199, ok: true }]);
});

// ---------------------------------------------------------------------------
const OLD_PLAYS = `CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
  artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);
  CREATE TABLE album_tracks (akey TEXT NOT NULL, tkey TEXT NOT NULL, title TEXT NOT NULL, n INTEGER NOT NULL,
  ts INTEGER NOT NULL, PRIMARY KEY (akey, tkey));`;

test("the store: an old database's rows read by the rule they were recorded under; album plays found once", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(OLD_PLAYS);
  const ins = db.prepare("INSERT INTO plays (ts, zone, track, artist, album, image_key, duration, completed) VALUES (?,?,?,?,?,?,?,?)");
  // Kind of Blue through, then three tracks of Diana Ross's Greatest Hits sampled, then a stream.
  ["So What", "Freddie Freeloader", "Blue in Green"].forEach((t, i) => ins.run(100 + i, "Study", t, "Miles Davis", "Kind of Blue", "img-kob", 300, 1));
  ["Track 1", "Track 2", "Track 3"].forEach((t, i) => ins.run(200 + i, "Study", t, "Diana Ross", "Greatest Hits", "img-ross", 200, i < 2 ? 1 : 0));
  ins.run(300, "Study", "News", "", "", "", 0, 0);
  for (const [i, t] of ["So What", "Freddie Freeloader", "Blue in Green"].entries()) {
    db.prepare("INSERT INTO album_tracks VALUES (?,?,?,?,?)").run("kind of blue||miles davis", canon(t), t, i, 1);
  }
  const store = createListeningStore({ db: () => db });
  store.migrate(db);
  store.migrate(db);   // every start
  assert.equal(db.prepare("SELECT COUNT(*) n FROM plays WHERE played = 1").get().n, 5, "completed old rows are track plays");

  const m = matcher();
  assert.equal(store.fillKeys((p) => m.match(p)), 6);
  const history = { tracksOf: (k) => db.prepare("SELECT n, tkey FROM album_tracks WHERE akey = ?").all(k), trackKeys,
    titleOf: () => ({ title: "Kind of Blue", image_key: "img-kob" }) };
  assert.equal(store.readHistoryOnce(history), 1, "Kind of Blue played through: one album play");
  assert.equal(store.readHistoryOnce(history), null, "once");

  const stats = store.albumStats();
  assert.deepEqual([...stats.count], [["kind of blue||miles davis", 1]]);
  assert.equal(stats.count.get("greatest hits||michael bolton"), undefined, "THE one: Michael Bolton's Greatest Hits was never played");
  assert.deepEqual([...store.playedKeysSince(0)].sort(), ["greatest hits||diana ross", "kind of blue||miles davis"]);
  assert.equal(store.albumPlayedSince("kind of blue||miles davis", 0), true);
  assert.equal(store.albumPlayedSince("greatest hits||diana ross", 0), false, "sampled, not played");
});

test("the store: new rows, heard and played; artists of track plays only; album plays pruned with plays", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(OLD_PLAYS);
  const store = createListeningStore({ db: () => db });
  store.migrate(db);
  const a = store.startPlay({ ts: 10, zone: "Study", track: "One", artist: "Nubya Garcia", album: "Source", image_key: "",
    duration: 300, album_key: "source||nubya garcia" });
  const b = store.startPlay({ ts: 20, zone: "Study", track: "Two", artist: "Taylor Dayne", album: "Tell It", image_key: "",
    duration: 300, album_key: "" });
  store.endPlay(a, 290, true);
  store.endPlay(b, 40, false);
  assert.deepEqual(store.playedArtistRows(0).map((r) => r.artist), ["Nubya Garcia"], "a sampled track says nothing of taste");
  assert.equal(store.anyPlayed(), true);
  store.addAlbumPlay({ ts: 5, zone: "Study", key: "source||nubya garcia", title: "Source", image_key: null, tracks: 9 });
  assert.equal(store.prune(6), 1);
  assert.equal(store.readHistoryOnce({ tracksOf: () => [], trackKeys, titleOf: () => null }), 0, "a new database has no history");
});
