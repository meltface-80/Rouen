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
const { createListening } = require("../../lib/listening/listening");
const { loadIndexFunctions } = require("../lib/extract");
// index.js's own keys: an album's (albumKey) and a track title's (trackTitleKeys, which a remaster suffix does not hide).
const K = loadIndexFunctions(["albumKey", "canonText", "canonArtist", "normalize", "albumTitleVariants", "trackTitleKeys"], {});

let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s; without it the store's tests skip, as a better-sqlite3 test does without its build
}

// Index.js's own keys, as they key the library (a simplified canon: lower case, letters and digits).
const canon = (/** @type {string} */ s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keyOf = (/** @type {any} */ al) => (al.title ? canon(al.title) + "||" + canon(al.subtitle) : null);
const splitCredit = (/** @type {string} */ s) => String(s || "").split(/\s*(?:\/|,|&)\s*/).filter(Boolean);
const trackKeys = (/** @type {string} */ t) => K.trackTitleKeys(t);

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
  const list = (titles || Array.from({ length: n }, (_, i) => "Track " + (i + 1))).map((t, i) => ({ n: i, title: t }));
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

test("two tracks of one title (a reprise, a movement) need hearing twice; a remaster suffix hides nothing", () => {
  const list = ["Song", "Middle", "Song (Reprise)"].map((title, n) => ({ n, title }));
  assert.equal(allHeard(list, ["Song", "Middle"], trackKeys), false, "THE one (the review): the reprise never heard");
  assert.equal(allHeard(list, ["Song (Reprise)", "Middle"], trackKeys), false, "nor the song");
  assert.equal(allHeard(list, ["Song (Reprise)", "Middle", "Song"], trackKeys), true);
  const allegro = ["I. Allegro", "II. Adagio", "I. Allegro"].map((title, n) => ({ n, title }));
  assert.equal(allHeard(allegro, ["I. Allegro", "II. Adagio"], trackKeys), false);
  assert.equal(allHeard(list, ["Song (2021 Remaster)", "Middle - 2021 Remaster", "Song (Reprise)"], trackKeys), true,
    "the stream's remaster suffix on each");
});

test("an album whose track list Rouen hasn't kept is read once, when its first track is played, then counted", async () => {
  let list = [];
  const reads = [];
  const played = [];
  const runs = createRuns({ tracksOf: () => list, trackKeys, onAlbumPlay: (p) => played.push(p),
    readTracks: async (al) => { reads.push(al.title); list = [{ n: 0, title: "One" }, { n: 1, title: "Two" }]; } });
  const al = { title: "New", subtitle: "Y" };
  runs.noteTrack("z", { key: "n", al, title: "One", played: false, ts: 1 });
  assert.deepEqual(reads, [], "a track sampled below 95% costs no read");
  runs.noteTrack("z", { key: "n", al, title: "One", played: true, ts: 2 });
  runs.noteTrack("z", { key: "n", al, title: "Two", played: true, ts: 3 });
  await new Promise((r) => { setImmediate(r); });
  assert.deepEqual(reads, ["New"], "read once");
  assert.equal(played.length, 1);
  // A read that fails leaves the album unplayed, and is not asked again on the next track.
  const never = createRuns({ tracksOf: () => [], trackKeys, onAlbumPlay: () => assert.fail("played with no track list"),
    readTracks: async () => { reads.push("again"); throw new Error("busy"); } });
  never.noteTrack("z", { key: "m", al, title: "One", played: true, ts: 1 });
  never.noteTrack("z", { key: "m", al, title: "Two", played: true, ts: 2 });
  await new Promise((r) => { setImmediate(r); });
  assert.deepEqual(reads, ["New", "again"]);
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
  const play = (track, from, to, length = 200) => { for (let p = from; p <= to; p++) push("playing", track, p, length); };
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

test("a short track first reported at 1 is heard from its start (the review: a 15-second interlude never counted)", () => {
  const z = zoneOf();
  z.play("Skit", 1, 14, 15);
  z.play("Next", 0, 2);
  assert.deepEqual(z.ends[0], { id: 1, heard: 14, ok: true });
  // A track Rouen first sees half way (Rouen restarted mid-track) is not credited with what it never saw.
  const y = zoneOf();
  y.play("Long", 100, 120);
  y.push("stopped", "Long", 120);
  assert.equal(y.ends[0].heard, 20);
});

test("repeat one through Roon's loading, or a restart while paused, is a play of its own", () => {
  const z = zoneOf();
  z.play("One", 0, 199);
  z.push("loading", "One", 0);
  z.play("One", 0, 199);
  z.push("stopped", "One", 199);
  assert.deepEqual(z.ends.map((e) => [e.heard, e.ok]), [[199, true], [199, true]], "THE one: merged into one play");
  const y = zoneOf();
  y.play("One", 0, 100);
  y.push("paused", "One", 100);
  y.push("paused", "One", 0);   // back to the start while paused, not yet played through: a seek, nothing more
  y.play("One", 0, 100);
  y.push("stopped", "One", 100);
  assert.equal(y.rows.length, 1);
});

test("a length Roon sends late is taken when it comes", () => {
  const z = zoneOf();
  z.push("playing", "One", 0, 0);
  for (let p = 1; p <= 200; p++) z.push("playing", "One", p, 200);
  z.push("stopped", "One", 200);
  assert.deepEqual(z.ends[0], { id: 1, heard: 200, ok: true });
});

test("a zone gone, or the Core: the track ends as far as it was heard", () => {
  const z = zoneOf();
  z.play("One", 0, 199);
  z.s.zoneGone("z");
  assert.deepEqual(z.ends, [{ id: 1, heard: 199, ok: true }]);
});

// ---------------------------------------------------------------------------
const OLD_PLAYS = `CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
  artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);`;

/** Listening as index.js puts it together, over a database and LIB, with Roon's album opener faked. */
function listeningOver(db, lists, opened) {
  return createListening({
    db: () => db, albums: () => LIB, version: () => 1,
    albumKey: (t, c) => keyOf({ title: t, subtitle: c }), canonText: canon, canonArtist: canon, splitCredit,
    plainCredit: (c) => c.replace(/\[\[\d+\|([^\]]*)\]\]/g, "$1"), trackKeys,
    openAlbum: async (al) => { opened.push(al.title + " / " + al.subtitle); if (!lists[al.title]) throw new Error("gone"); return { tracks: lists[al.title].map((title) => ({ title })) }; },
    state: new Map(), history: new Map(), historyEntry: () => null, pushHistory: (l) => l, zoneName: (z) => z,
    changed() {}, albumPlayed() {}, log() {}, debug() {}, pauseMs: 0, sleep: async () => {},
  });
}

test("the history: old rows by the rule they were recorded under; the lists read in the background; album plays found once", { skip: !Database }, async () => {
  const db = new Database(":memory:");
  db.exec(OLD_PLAYS);
  const ins = db.prepare("INSERT INTO plays (ts, zone, track, artist, album, image_key, duration, completed) VALUES (?,?,?,?,?,?,?,?)");
  // Kind of Blue through, three tracks of Diana Ross's Greatest Hits sampled (two finished), a stream, one Köln track.
  ["So What", "Freddie Freeloader", "Blue in Green"].forEach((t, i) => ins.run(100 + i, "Study", t, "Miles Davis", "Kind of Blue", "img-kob", 300, 1));
  ["Track 1", "Track 2", "Track 3"].forEach((t, i) => ins.run(200 + i, "Study", t, "Diana Ross", "Greatest Hits", "img-ross", 200, i < 2 ? 1 : 0));
  ins.run(300, "Study", "News", "", "", "", 0, 0);
  ins.run(400, "Study", "Part I", "Keith Jarrett", "Köln Concert", "img-koln", 1500, 1);
  const opened = [];
  const L = listeningOver(db, { "Kind of Blue": ["So What", "Freddie Freeloader", "Blue in Green"],
    "Greatest Hits": ["Track 1", "Track 2", "Track 3", "Track 4"] }, opened);
  L.migrate(db);
  L.migrate(db);   // every start
  assert.equal(db.prepare("SELECT COUNT(*) n FROM plays WHERE played = 1").get().n, 6, "completed old rows are track plays");
  assert.equal(L.fillKeys((p) => matcher().match(p)), 7, "every row named but the stream");

  assert.equal(await L._readHistory(), undefined);
  assert.deepEqual(opened.sort(), ["Greatest Hits / Diana Ross", "Kind of Blue / Miles Davis"],
    "the albums with a run of two played tracks, read once each; never Michael Bolton's, never one track of Köln");
  const stats = L.albumStats();
  assert.deepEqual([...stats.count], [["kind of blue||miles davis", 1]], "Kind of Blue played through: one album play");
  assert.equal(stats.count.get("greatest hits||michael bolton"), undefined, "THE one: Michael Bolton's Greatest Hits was never played");
  assert.deepEqual([...L.playedKeysSince(0)].sort(), ["greatest hits||diana ross", "kind of blue||miles davis", keyOf(LIB[3])].sort());
  assert.equal(L.albumPlayedSince("greatest hits||diana ross", 0), false, "sampled, not played");
  await L._readHistory();
  assert.equal(L.albumStats().count.get("kind of blue||miles davis"), 1, "read once, never again");
  assert.equal(opened.length, 2);
});

test("the history waits when Roon can't be read, and reads when it can", { skip: !Database }, async () => {
  const db = new Database(":memory:");
  db.exec(OLD_PLAYS);
  const ins = db.prepare("INSERT INTO plays (ts, zone, track, artist, album, image_key, duration, completed) VALUES (?,?,?,?,?,?,?,?)");
  for (const [i, al] of LIB.entries()) {
    ins.run(i * 10, "Study", "A", al.subtitle, al.title, al.image_key, 100, 1);
    ins.run(i * 10 + 1, "Study", "B", al.subtitle, al.title, al.image_key, 100, 1);
  }
  const lists = {};
  const opened = [];
  const L = listeningOver(db, lists, opened);
  L.migrate(db);
  L.fillKeys((p) => matcher().match(p));
  await L._readHistory();
  assert.equal(opened.length, 3, "three failures in a row stop it");
  assert.equal(L.historyRead(), false, "the history is not read without the lists");
  for (const al of LIB) lists[al.title] = ["A", "B"];
  await L._readHistory();
  assert.equal(L.historyRead(), true);
  assert.equal(L.albumStats().count.size, 4, "Diana Ross's and Michael Bolton's Greatest Hits share a title, not a key: each its own");
});

test("the real album key: two \"Greatest Hits\" are two albums, and a catalogue credit's links are read as names", () => {
  const L = createListening({ db: () => null, albums: () => [], version: () => 0, albumKey: K.albumKey,
    canonText: K.canonText, canonArtist: K.canonArtist, splitCredit, plainCredit: (c) => c, trackKeys,
    openAlbum: async () => ({ tracks: [] }), state: new Map(), history: new Map(), historyEntry: () => null,
    pushHistory: (l) => l, zoneName: (z) => z, changed() {}, albumPlayed() {}, log() {}, debug() {} });
  assert.notEqual(L.listenKey({ title: "Greatest Hits", subtitle: "Diana Ross" }), L.listenKey({ title: "Greatest Hits", subtitle: "Michael Bolton" }));
  assert.equal(L.listenKey({ title: "Greatest Hits", subtitle: "Diana Ross" }), K.albumKey("Greatest Hits", "Diana Ross"),
    "the key album_tracks and Listen later use");
  assert.match(L.listenKey({ title: "÷", subtitle: "x" }) || "", /^raw\|/, "a title albumKey can't key still counts as itself");
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

test("Smart Picks' inputs: every album play with its time; the tracks played on their own, never a sampled run's", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(OLD_PLAYS);
  const store = createListeningStore({ db: () => db });
  store.migrate(db);
  const play = (ts, album, key, artist, ok, zone = "Study") => {
    const id = store.startPlay({ ts, zone, track: "t" + ts, artist, album, image_key: "", duration: 100, album_key: key });
    store.endPlay(id, ok ? 100 : 10, ok);
  };
  // Two tracks of one album in a row (an album sampled: a run), then a playlist: one track each of three albums.
  play(1000, "Sampled", "s||x", "X", true); play(2000, "Sampled", "s||x", "X", true);
  play(3000, "One", "1||a", "A", true); play(4000, "Two", "2||b", "B", false); play(5000, "Three", "", "C", true);
  play(6000, "Sampled", "s||x", "X", true, "Kitchen");   // alone on another zone
  assert.deepEqual(store.trackPlaysAlone().map((r) => [r.artist, r.key, r.ts]), [["X", "s||x", 6000], ["A", "1||a", 3000], ["C", null, 5000]],
    "THE one: a sampled album's tracks counted as taste, or a skipped one");
  store.addAlbumPlay({ ts: 7000, zone: "Study", key: "1||a", title: "One", image_key: null, tracks: 1 });
  assert.deepEqual(store.albumPlayRows(), [{ key: "1||a", ts: 7000 }]);
});
