"use strict";
// ---------------------------------------------------------------------------
// Profiles, P1a (2.0.7-t2, dev/design/profiles.md; lib/profiles/, lib/listening/store.js). The owner (2026-11-26):
// "Each profile would then have the capacity to record that profile's listening habits", chosen from the side menu;
// a play started outside Rouen counts for the zone's profile; Guest; a removed profile's listening moved. Each test was
// broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProfileStore, GUEST } = require("../../lib/profiles/store");
const { createAttribution, IDLE_MS } = require("../../lib/profiles/attribution");
const { createProfileContext, cookieValue } = require("../../lib/profiles/context");
const { mountProfiles, playStarts } = require("../../lib/profiles/routes");
const { createListeningStore } = require("../../lib/listening/store");
const { createProfiles } = require("../../lib/profiles");

let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s; without it the database's tests skip, as a better-sqlite3 test does without its build
}
const PLAYS = `CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
  artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);`;

/** A database with plays, the listening store and the profiles, as index.js opens them. */
function world(account = "Alex") {
  const db = new Database(":memory:");
  db.exec(PLAYS);
  const plays = createListeningStore({ db: () => db });
  plays.migrate(db);
  const profiles = createProfileStore({ db: () => db, accountName: () => account, now: () => 1 });
  profiles.migrate(db);
  return { db, plays, profiles };
}
const row = (id, legacy = false) => ({ id, legacy });

test("the first profile is made at the first start, named after the account; again, nothing more is made", { skip: !Database }, () => {
  const w = world("Alex");
  assert.deepEqual(w.profiles.list().map((p) => [p.name, p.first]), [["Alex", true]]);
  w.profiles.migrate(w.db);
  assert.equal(w.profiles.list().length, 1, "THE one: a second first profile at the next start");
  assert.equal(world("").profiles.first().name, "Me", "accounts off: no account's name");
});

test("profiles: added, renamed, recoloured; a name taken, empty, or Guest's refused; a bad colour refused", { skip: !Database }, () => {
  const { profiles } = world();
  const sam = profiles.add("  Sam  ");
  assert.equal(sam.name, "Sam");
  assert.throws(() => profiles.add("sam"), /already/);
  assert.throws(() => profiles.add(""), /needs a name/);
  assert.throws(() => profiles.add("Guest"), /always in the list/);
  assert.throws(() => profiles.update(sam.id, { colour: "red" }), /colours/);
  assert.throws(() => profiles.update(sam.id, { name: "Alex", colour: profiles.COLOURS[3] }), /already/);
  assert.equal(profiles.get(sam.id).colour, sam.colour, "a refused change half taken");
  assert.equal(profiles.update(sam.id, { name: "Samira", colour: profiles.COLOURS[3] }).name, "Samira");
});

test("plays are read for a profile: its own counts; Recently played its own and no one's; the plays before profiles the first's", { skip: !Database }, () => {
  const { plays, profiles } = world();
  const alex = profiles.first().id;
  const sam = profiles.add("Sam").id;
  const play = (ts, album, key, profile) => {
    const id = plays.startPlay({ ts, zone: "Study", track: "t", artist: "a", album, image_key: "", duration: 100, album_key: key, profile });
    plays.endPlay(id, 100, true);
  };
  play(10, "Old", "old", undefined);   // before profiles: NULL
  play(20, "Mine", "mine", alex);
  play(30, "Theirs", "theirs", sam);
  play(40, "Party", "party", "");      // Guest: no one
  plays.addAlbumPlay({ ts: 50, zone: "Study", key: "theirs", title: "Theirs", image_key: null, tracks: 3, profile: sam });
  const keys = (who) => [...plays.playedKeysSince(0, who)].sort();
  assert.deepEqual(keys(row(alex, true)), ["mine", "old"], "THE one: another profile's plays counted, or the old ones lost");
  assert.deepEqual(keys(row(sam)), ["theirs"]);
  assert.deepEqual(keys(row("")), ["party"], "Guest sees what counted for no one");
  assert.deepEqual(keys(null), ["mine", "old", "theirs"], "everyone's (Radio): every profile's, never Guest's (the owner)");
  assert.deepEqual(plays.playedArtistRows(0).length, 3, "Discover and the share card shaped by Guest's plays");
  assert.deepEqual(plays.albumPlayRows().map((r) => r.key), ["theirs"]);
  assert.deepEqual(plays.trackPlaysAlone().map((r) => r.ts).sort(), [10, 20, 30], "THE one (the owner): Smart Picks shaped by a party on Guest");
  assert.deepEqual([...plays.albumStats(row(sam)).count], [["theirs", 1]]);
  assert.equal(plays.albumStats(row(alex, true)).count.size, 0);
  assert.deepEqual(plays.recentAlbums(0, 10, row(sam)).map((r) => r.album), ["Party", "Theirs"], "Recently played: own and no one's (§10.1)");
  assert.deepEqual(plays.recentAlbums(0, 10, row(alex, true)).map((r) => r.album), ["Party", "Mine", "Old"]);
  assert.equal(plays.firstPlay(row(sam)), 30);
  assert.equal(plays.firstPlay(row("nobody")), null, "no plays: no history yet");
  assert.equal(plays.anyPlayed(row("nobody")), false);
  assert.equal(plays.albumPlayedSince("theirs", 0, row(alex, true)), false);
  assert.equal(plays.albumPlayedSince("theirs", 0, row(sam)), true);
});

test("a profile removed: its plays (the old ones too, if it was first) and its zones go to the one chosen", { skip: !Database }, () => {
  const { db, plays, profiles } = world();
  const alex = profiles.first().id;
  const sam = profiles.add("Sam").id;
  plays.startPlay({ ts: 1, zone: "z", track: "t", artist: "a", album: "x", image_key: "", duration: 1, album_key: "x", profile: undefined });
  plays.startPlay({ ts: 2, zone: "z", track: "t", artist: "a", album: "y", image_key: "", duration: 1, album_key: "y", profile: alex });
  plays.addAlbumPlay({ ts: 3, zone: "z", key: "y", title: "y", image_key: null, tracks: 1, profile: alex });
  plays.startPlay({ ts: 4, zone: "z", track: "t", artist: "a", album: "g", image_key: "", duration: 1, album_key: "g", profile: "" });
  profiles.setZoneProfile("zone-1", "Kitchen", alex);
  assert.throws(() => profiles.remove(alex, alex, ["plays", "album_plays"]), /choose the profile/);
  assert.throws(() => profiles.remove(alex, "99", ["plays", "album_plays"]), /choose the profile/);
  const kim = profiles.add("Kim").id;
  const moved = [];
  profiles.remove(alex, kim, ["plays", "album_plays"], [(d, from, to) => moved.push(from + ">" + to)]);
  assert.deepEqual(moved, [alex + ">" + kim], "Smart Picks' rows not moved with the profile (2.0.7-t3)");
  const owners = db.prepare("SELECT profile FROM plays ORDER BY ts").all().map((r) => r.profile);
  assert.deepEqual(owners, [kim, kim, ""], "THE one: the plays from before profiles stranded with no first profile, or Guest's moved");
  assert.equal(db.prepare("SELECT profile FROM album_plays").get().profile, kim);
  assert.equal(profiles.zoneProfile("zone-1"), kim, "the zone left on a removed profile");
  assert.equal(profiles.first().id, kim, "THE one (the review): the first's role went to the next id, not where its plays went");
  assert.equal(profiles.zoneProfile("zone-never-set"), kim, "a zone never given one");
  assert.deepEqual(profiles.list().map((p) => p.name), ["Kim", "Sam"], "the first listed first");
  profiles.remove(kim, sam, []);
  assert.throws(() => profiles.remove(sam, "x", []), /choose the profile/, "the last can't go: nowhere to move it");
});

test("a zone counts for the first profile until set; Guest is no one; a removed or bad profile can't be set", { skip: !Database }, () => {
  const { profiles } = world();
  const first = profiles.first().id;
  assert.equal(profiles.zoneProfile("z"), first);
  profiles.setZoneProfile("z", "Kitchen", GUEST);
  assert.equal(profiles.zoneProfile("z"), GUEST);
  assert.throws(() => profiles.setZoneProfile("z", "Kitchen", "42"), /no such profile/);
});

test("whose a play is: the device that started the zone, until another starts it or it's idle 30 minutes; then the zone's", () => {
  let t = 0;
  const zoneOwn = new Map([["z", "1"]]);
  const a = createAttribution({ guest: GUEST, now: () => t, zoneProfile: (z) => zoneOwn.get(z) || "1" });
  assert.equal(a.whose("z"), "1", "nobody started it: the zone's own");
  a.start("z", "2");
  t += 1000;
  assert.equal(a.whose("z"), "2", "THE one: started from a device, counted for the zone's");
  a.start("z", GUEST);
  assert.equal(a.whose("z"), "", "Guest counts for no one");
  a.start("z", "3");
  for (let i = 0; i < 90; i++) { t += 60 * 1000; a.playing("z"); }   // an hour and a half of one long work, playing
  assert.equal(a.whose("z"), "3", "a long album, still the device's");
  t += IDLE_MS + 1;           // paused overnight: no report of it playing
  a.playing("z");             // resumed from Roon's own app
  assert.equal(a.whose("z"), "1", "THE one (the review): paused half an hour, then resumed, and still the device's");
  a.start("z", "4");
  a.forgetProfile("4");
  assert.equal(a.whose("z"), "1", "a removed profile kept the zone, and its plays were no one's to read");
  zoneOwn.set("z", GUEST);
  assert.equal(a.whose("z"), "", "a zone counting for no one");
  const before = a.start("y", "5");
  a.undo("y", before);
  assert.equal(a.whose("y"), "1", "a refused start given back");
});
test("each device's profile, by its cookie; none, or a removed one, is the first; reads in a request are its", { skip: !Database }, () => {
  const { profiles } = world();
  const ctx = createProfileContext({ store: profiles, guest: GUEST });
  const sam = profiles.add("Sam").id;
  assert.equal(cookieValue("a=1; rouen_profile=" + sam + "; rouen_session=x"), sam);
  assert.equal(cookieValue("rouen_profile=%E0%A4%A"), "", "a cookie no one could have set reads as none");
  const req = (c) => ({ headers: { cookie: c } });
  assert.equal(ctx.deviceProfile(req("rouen_profile=" + sam)), sam);
  assert.equal(ctx.deviceProfile(req("rouen_profile=guest")), GUEST);
  assert.equal(ctx.deviceProfile(req("rouen_profile=99")), profiles.first().id, "a removed profile: the first");
  assert.equal(ctx.deviceProfile(req("")), profiles.first().id);
  assert.equal(ctx.viewer(), null, "outside a request (a build, the radio): everyone's");
  const r = req("rouen_profile=" + sam);
  let seen = null;
  ctx.middleware(r, {}, () => { seen = ctx.viewer(); });
  assert.deepEqual(seen, { id: sam, legacy: false }, "THE one: a screen's reads were everyone's");
  assert.equal(r.profile, sam);
  ctx.middleware(req("rouen_profile=guest"), {}, () => { seen = ctx.viewer(); });
  assert.deepEqual(seen, { id: "", legacy: false });
  ctx.middleware(req(""), {}, () => { seen = ctx.viewer(); });
  assert.deepEqual(seen, { id: profiles.first().id, legacy: true }, "the first profile reads the plays from before profiles");
});

/** A fake app with the routes mounted, and a call that answers like Express. */
function routes(w, roonProfiles) {
  const r = {};
  const app = { get: (p, fn) => { r["GET " + p] = fn; }, post: (p, fn) => { r["POST " + p] = fn; } };
  const changed = [];
  const ctx = createProfileContext({ store: w.profiles, guest: GUEST });
  const zones = { z1: { zone_id: "z1", display_name: "Kitchen" } };
  mountProfiles(app, { store: w.profiles, context: ctx, guest: GUEST, listeningTables: ["plays", "album_plays"],
    zone: (id) => zones[id] || Object.values(zones).find((z) => z.display_name === id) || null, changed: () => changed.push(1),
    removed: (id) => changed.push("removed " + id), roonProfiles });
  const call = (key, { body, params, query, profile } = {}) => {
    let status = 200, out, headers = {};
    const res = { status: (s) => { status = s; return res; }, json: (b) => { out = b; }, setHeader: (k, v) => { headers[k] = v; } };
    r[key]({ body, params: params || {}, query: query || {}, profile, secure: false }, res);
    return { status, body: out, headers };
  };
  return { call, changed };
}

test("routes: list, choose this device's (a cookie), add, rename, remove; mistakes are 400s with their words", { skip: !Database }, () => {
  const w = world();
  const { call, changed } = routes(w);
  const first = w.profiles.first().id;
  let r = call("POST /api/profiles", { body: { name: "Sam" } });
  const sam = r.body.added;
  assert.deepEqual(r.body.profiles.map((p) => p.name), ["Alex", "Sam"]);
  assert.equal(call("POST /api/profiles", { body: { name: "sam" } }).status, 400);
  r = call("POST /api/profiles/current", { body: { id: sam } });
  assert.match(r.headers["Set-Cookie"], new RegExp("^rouen_profile=" + sam + "; Path=/; Max-Age=31536000; SameSite=Lax$"));
  assert.equal(r.body.current, sam);
  assert.equal(call("POST /api/profiles/current", { body: { id: "guest" } }).body.current, "guest");
  assert.equal(call("POST /api/profiles/current", { body: { id: "77" } }).status, 400);
  assert.equal(call("POST /api/profiles/:id", { params: { id: sam }, body: { name: "Samira" } }).body.profiles[1].name, "Samira");
  r = call("POST /api/profiles/:id/remove", { params: { id: sam }, body: { moveTo: first }, profile: sam });
  assert.deepEqual([r.status, r.body.profiles.length, r.body.current, changed], [200, 1, first, ["removed " + sam, 1]],
    "THE one: plays moved without the screens told, or the device left on a removed profile");
});

test("routes: a zone's \"Listening here counts for\", by its id or its name", { skip: !Database }, () => {
  const w = world();
  const { call } = routes(w);
  assert.deepEqual(call("GET /api/zone-profile", { query: { zone: "Kitchen" } }).body, { zone: "z1", profile: w.profiles.first().id });
  assert.deepEqual(call("POST /api/zone-profile", { body: { zone: "z1", profile: "guest" } }).body, { zone: "z1", profile: "guest" });
  assert.equal(call("POST /api/zone-profile", { body: { zone: "z1", profile: "9" } }).status, 400);
  assert.equal(call("GET /api/zone-profile", { query: { zone: "Attic" } }).status, 404);
});

test("a play started from Rouen claims the zone before the route acts, given back if refused; queueing and radio off claim nothing", () => {
  const log = [];
  const held = new Map();
  const attribution = { start: (z, p) => { const b = held.get(z); held.set(z, p); log.push("start " + z + ":" + p); return b; },
    undo: (z, b) => { if (b) held.set(z, b); else held.delete(z); log.push("undo " + z); } };
  const mw = playStarts(attribution, (id) => (id === "out-1" || id === "z1" ? { zone_id: "z1" } : null));
  const run = (path, body, status, profile = "2") => {
    const handlers = {};
    const res = { statusCode: status, on: (ev, fn) => { handlers[ev] = fn; } };
    let claimedBeforeRoute = null;
    mw({ method: "POST", path, body, profile }, res, () => { claimedBeforeRoute = held.get("z1") || null; });
    if (handlers.finish) handlers.finish();
    return claimedBeforeRoute;
  };
  assert.equal(run("/api/play", { zone_or_output_id: "out-1", kind: "play_now" }, 200), "2",
    "THE one (the review): the zone claimed only after the route answered, when its first track had begun");
  run("/api/play", { zone_or_output_id: "out-1" }, 503, "3");
  assert.equal(held.get("z1"), "2", "a refused start kept the zone");
  run("/api/roon-smart/play", { zone_or_output_id: "z1" }, 409, "4");
  assert.equal(held.get("z1"), "4", "a play that may have started (Roon didn't show it) is kept");
  held.clear(); log.length = 0;
  run("/api/play", { zone_or_output_id: "z1", kind: "queue" }, 200);
  run("/api/play-track", { zone_or_output_id: "z1", kind: "play_next" }, 200);
  run("/api/queue/history-multi", { zone_or_output_id: "z1", kind: "queue" }, 200);
  run("/api/radio", { zone: "z1", enabled: false }, 200);
  run("/api/library/albums", { zone_or_output_id: "z1" }, 200);
  assert.deepEqual(log, [], "THE one (the review): queueing a track took someone else's zone");
  run("/api/radio", { zone: "z1", enabled: true }, 200, "guest");
  run("/api/transfer-zone", { from_zone: "x", to_zone: "z1" }, 200, "3");
  assert.deepEqual(log, ["start z1:guest", "start z1:3"]);
});
test("a track begun is written for whose the zone's listening is; the zone said playing before it is written", () => {
  const { createScrobbler } = require("../../lib/listening/scrobble");
  const rows = [], said = [];
  let clock = 0;
  const store = { startPlay: (p) => { said.push("write"); rows.push(p); return rows.length; }, endPlay() {} };
  const s = createScrobbler({ state: new Map(), history: new Map(), historyEntry: () => null, pushHistory: (l) => l,
    store: () => /** @type {any} */ (store), match: () => ({ key: "a", al: { title: "A" } }), libraryReady: () => true,
    runs: /** @type {any} */ ({ noteTrack() {}, end() {} }), changed() {}, now: () => clock,
    whose: (zid) => (zid === "z" ? "7" : ""), playing: (zid) => said.push("playing " + zid) });
  const push = (state, track, pos) => { clock += 1000; s.update({ zone_id: "z", display_name: "Study", state,
    now_playing: { seek_position: pos, length: 200, image_key: "i", three_line: { line1: track, line2: "X", line3: "A" } } }); };
  push("playing", "One", 0);
  push("paused", "One", 1);
  push("playing", "Two", 0);
  assert.deepEqual(rows.map((r) => r.profile), ["7", "7"], "THE one: a play written for no profile");
  assert.deepEqual(said, ["playing z", "write", "playing z", "write"], "a paused report said playing, or said after the play was written");
});

test("an album played is whose its tracks were, not whoever holds the zone when the run settles", { skip: !Database }, () => {
  const { createListening } = require("../../lib/listening/listening");
  const db = new Database(":memory:");
  db.exec(PLAYS);
  let who = "1", clock = 0;
  const canon = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const LIB = [{ title: "Kind of Blue", subtitle: "Miles Davis", image_key: "kob", offset: 1 }];
  const l = createListening({ db: () => db, albums: () => LIB, version: () => 1,
    albumKey: (t, c) => canon(t) + "||" + canon(c), canonText: canon, canonArtist: canon, splitCredit: (s) => [s],
    plainCredit: (c) => c, trackKeys: (t) => [canon(t)], openAlbum: async () => ({ tracks: [] }),
    state: new Map(), history: new Map(), historyEntry: () => null, pushHistory: (x) => x, zoneName: (z) => z,
    changed() {}, albumPlayed() {}, log() {}, debug() {}, whose: () => who, playing() {} });
  l.migrate(db);
  l.keepTrackList("Kind of Blue", "Miles Davis", ["So What", "Blue in Green"]);
  const _now = Date.now;
  Date.now = () => clock;
  try {
    const play = (track, album, artist) => { for (let p = 0; p <= 300; p += 1) { clock += 1000; l.update({ zone_id: "z", display_name: "z", state: "playing",
      now_playing: { seek_position: p, length: 300, image_key: album === "Kind of Blue" ? "kob" : "x", three_line: { line1: track, line2: artist, line3: album } } }); } };
    play("So What", "Kind of Blue", "Miles Davis");
    play("Blue in Green", "Kind of Blue", "Miles Davis");
    who = "2";   // another device takes the zone as the album ends
    play("Something Else", "Elsewhere", "Nobody");
  } finally { Date.now = _now; }
  const rows = db.prepare("SELECT profile FROM album_plays").all().map((r) => r.profile);
  assert.deepEqual(rows, ["1"], "THE one (the review): the album credited to whoever took the zone as it settled");
});

test("a playlist's Shuffle takes the zone over, as Play now does", () => {
  const held = [];
  const mw = playStarts({ start: (z, p) => { held.push(p); }, undo() {} }, () => ({ zone_id: "z1" }));
  mw({ method: "POST", path: "/api/playlist/play", body: { zone_or_output_id: "z1", kind: "shuffle" }, profile: "2" }, { on() {} }, () => {});
  assert.deepEqual(held, ["2"], "THE one (the review): Shuffle on a playlist left the zone to its last listener");
});

test("no database: the readers answer as nothing played (index.js's first play, the screens)", () => {
  const none = createListeningStore({ db: () => null });
  assert.equal(none.firstPlay({ id: "1", legacy: true }), null);
  assert.equal(none.anyPlayed(null), false);
  assert.deepEqual(none.recentAlbums(0, 5, null), []);
});

test("every screen's read in index.js asks for the device's profile", () => {
  const src = require("../lib/extract").indexSource();
  const body = (start) => { const i = src.indexOf(start); assert.ok(i > -1, start); return src.slice(i, src.indexOf("\n});", i)); };
  for (const [route, read] of [
    ['app.get("/api/home/unplayed"', "playedAlbumKeysSince(cutoff, profiles.viewer())"],
    ['app.get("/api/home/history"', "listening.recentAlbums(cutoff, count, profiles.viewer())"],
    ['app.get("/api/library/facets"', "listening.anyPlayed(profiles.viewer())"],
  ]) assert.ok(body(route).includes(read), route + " reads everyone's plays");
  for (const read of ["function firstPlayTs() { return listening.firstPlay(profiles.viewer()); }",
    "return listening.albumStats(profiles.viewer());",
    "listening.albumPlayedSince(listenKey(al), aotdDayStart(), profiles.viewer())",
    "playedAlbumKeysSince(0, profiles.viewer())",
    'readsPlays ? "n" + playsVersion + "@" + profiles.viewerKey() : ""',
    "profiles: labelsDb ? profiles.store.exportAll() : null", "profiles.store.restoreAll(p.profiles)",
    // P1b (2.0.7-t3): each profile's Smart Picks, Why these picks, seeds and the share card's taste.
    "const mine = profiles.picksOf(req.profile);", "if (mine === null) return res.json({ error: \"Guest has no Smart Picks.",
    "const rows = readSmartPicks(day, mine);",
    'why: (req) => { const p = profiles.picksOf(req.profile); return p === null ? null : smartCacheGet("why:" + p, smartSimilarTtlMs()); }',
    "return (p !== null && tastes.get(p)) ||",
    "whoOf: (p) => profiles.who(p)", "AND profile = ?\").all(p)",
    "listening.playedArtistRows(Date.now() - TASTE_SEED_DAYS * DAY_MS, profiles.who(profile))",
    "movers: [picksTables.moveProfile]", "picksTables.migrate(labelsDb, profiles.store.first().id)"]) {
    assert.ok(src.includes(read), "not asked for the device's profile: " + read);
  }
  const unheard = body("async function pickUnheardAlbum()");
  assert.ok(unheard.includes("playedAlbumKeysSince(cutoff, profiles.viewer())"), "Pick unheard reads everyone's plays");
});

test("backups carry the profiles and the zones' settings, never their plays; a restore keeps a profile made since", { skip: !Database }, () => {
  const BACKUP = require("../../lib/backup");
  const w = world("Alex");
  const sam = w.profiles.add("Sam", w.profiles.COLOURS[2]).id;
  w.profiles.setZoneProfile("z1", "Kitchen", sam);
  const b = BACKUP.parse(JSON.stringify(BACKUP.build({ settings: {}, profiles: w.profiles.exportAll(), version: "2.0.7-t2" }, ["profiles"])));
  assert.deepEqual(b.parts, ["profiles"], "THE one (the owner): no profiles part");
  assert.equal(JSON.stringify(b).includes("plays"), false);
  // Since the backup: Sam renamed, Kim made, the zone changed.
  w.profiles.update(sam, { name: "Samira" });
  const kim = w.profiles.add("Kim").id;
  w.profiles.setZoneProfile("z1", "Kitchen", kim);
  const p = BACKUP.plan(b, ["profiles"], {});
  w.profiles.restoreAll(p.profiles);
  assert.deepEqual(w.profiles.list().map((x) => [x.id, x.name]), [[w.profiles.first().id, "Alex"], [sam, "Sam"], [kim, "Kim"]],
    "a restore lost a profile made since (its plays name it), or didn't put Sam back under the same id");
  assert.equal(w.profiles.get(sam).colour, w.profiles.COLOURS[2]);
  assert.equal(w.profiles.zoneProfile("z1"), sam, "the zone's setting as it was");
  w.profiles.add("Lee");
  w.profiles.restoreAll({ profiles: [{ id: 99, name: "lee", colour: "x", first: false }], zones: [{ zone_id: "z2", profile: "404" }] });
  assert.equal(w.profiles.get("99").name, "lee (restored)", "two profiles of one name");
  assert.equal(w.profiles.get("99").colour, w.profiles.COLOURS[0]);
  assert.equal(w.profiles.zoneProfile("z2"), w.profiles.first().id, "a zone naming no profile there now kept");
});

// P2 (2.0.7-t4, §5): a profile linked to one of the Roon server's profiles; a device acts in Roon for its profile's.
test("P2: a profile linked to one of your server's Roon profiles, and only one it has; none is the Native mode choice", { skip: !Database }, () => {
  const w = world();
  const roon = { profiles: [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "Guest" }], chosen: "cafebabe" };
  let server = roon;
  const { call } = routes(w, () => server);
  const sam = w.profiles.add("Sam").id;
  let r = call("GET /api/profiles");
  assert.deepEqual(r.body.roon, roon, "the server's Roon profiles, for the select");
  assert.equal(r.body.profiles[1].roonProfile, null);
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: "DEADBEEF" } });
  assert.equal(r.body.profiles[1].roonProfile, "deadbeef", "THE one: the link was not kept");
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: "00ff00" } });
  assert.deepEqual([r.status, r.body.error], [400, "not one of your server's profiles"]);
  server = null;
  assert.equal(call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: "cafebabe" } }).status, 400,
    "native mode not in use: no list to check against, so no link");
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: null } });
  assert.equal(r.body.profiles[1].roonProfile, null, "a link taken off, even with native mode not in use");
  assert.equal(call("POST /api/profiles/:id", { params: { id: "77" }, body: { roonProfile: null } }).status, 400);
  assert.throws(() => w.profiles.setRoon(sam, "not hex"), /not one of your server's profiles/);
});

test("P2: the Roon profile a request acts for is its device's profile's link; Guest, none, outside a request: null", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(PLAYS);
  const p = createProfiles({ db: () => db, accountName: () => "Alex", zone: () => null, changed() {} });
  p.migrate(db);
  const sam = p.store.add("Sam").id;
  p.store.setRoon(sam, "deadbeef");
  const inReq = (cookie) => { let out; p.middleware({ headers: { cookie } }, {}, () => { out = p.roonOfRequest(); }); return out; };
  assert.equal(inReq("rouen_profile=" + sam), "deadbeef", "THE one: the device's link not read");
  assert.equal(inReq("rouen_profile=guest"), null, "Guest acts as the Native mode choice");
  assert.equal(inReq(""), null, "the first, not linked");
  assert.equal(p.roonOfRequest(), null, "outside a request (a build, the nightly read)");
});

test("P2: a backup carries each profile's Roon link; one from before keeps the link the profile has", { skip: !Database }, () => {
  const w = world();
  const sam = w.profiles.add("Sam").id;
  w.profiles.setRoon(sam, "deadbeef");
  const b = w.profiles.exportAll();
  assert.equal(b.profiles[1].roonProfile, "deadbeef");
  w.profiles.setRoon(sam, null);
  w.profiles.restoreAll(b);
  assert.equal(w.profiles.get(sam).roon_profile, "deadbeef", "the backup's link not put back");
  w.profiles.setRoon(sam, "cafebabe");
  w.profiles.restoreAll({ profiles: [{ id: Number(sam), name: "Sam" }], zones: [] });
  assert.equal(w.profiles.get(sam).roon_profile, "cafebabe", "a backup from before took the link away");
  w.profiles.restoreAll({ profiles: [{ id: Number(sam), name: "Sam", roonProfile: "<script>" }], zones: [] });
  assert.equal(w.profiles.get(sam).roon_profile, "cafebabe", "a link that is no Roon id restored");
});
