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
  assert.throws(() => profiles.add("Guest"), /always there/);
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
  assert.deepEqual(keys(null), ["mine", "old", "party", "theirs"], "everyone's (Discover, the share card)");
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
  profiles.remove(alex, kim, ["plays", "album_plays"]);
  const owners = db.prepare("SELECT profile FROM plays ORDER BY ts").all().map((r) => r.profile);
  assert.deepEqual(owners, [kim, kim, ""], "THE one: the plays from before profiles stranded with no first profile, or Guest's moved");
  assert.equal(db.prepare("SELECT profile FROM album_plays").get().profile, kim);
  assert.equal(profiles.zoneProfile("zone-1"), kim, "the zone left on a removed profile");
  assert.equal(profiles.first().id, sam, "the next is first");
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
  t += IDLE_MS - 1;
  a.touch("z");               // a track ended: the zone is playing
  t += IDLE_MS - 1;
  assert.equal(a.whose("z"), "3", "a long album, still the device's");
  t += IDLE_MS + 1;
  assert.equal(a.whose("z"), "1", "half an hour of nothing: the zone's own again");
  zoneOwn.set("z", GUEST);
  assert.equal(a.whose("z"), "", "a zone counting for no one");
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
function routes(w) {
  const r = {};
  const app = { get: (p, fn) => { r["GET " + p] = fn; }, post: (p, fn) => { r["POST " + p] = fn; } };
  const changed = [];
  const ctx = createProfileContext({ store: w.profiles, guest: GUEST });
  const zones = { z1: { zone_id: "z1", display_name: "Kitchen" } };
  mountProfiles(app, { store: w.profiles, context: ctx, guest: GUEST, listeningTables: ["plays", "album_plays"],
    zone: (id) => zones[id] || Object.values(zones).find((z) => z.display_name === id) || null, changed: () => changed.push(1) });
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
  assert.deepEqual([r.status, r.body.profiles.length, r.body.current, changed.length], [200, 1, first, 1],
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

test("a play started from Rouen: the zone is the device's profile's once the route answers success; radio off starts nothing", () => {
  const starts = [];
  const mw = playStarts({ start: (z, p) => starts.push(z + ":" + p) }, (id) => (id === "out-1" || id === "z1" ? { zone_id: "z1" } : null));
  const run = (path, body, status, profile = "2") => {
    const handlers = {};
    const res = { statusCode: status, on: (ev, fn) => { handlers[ev] = fn; } };
    mw({ method: "POST", path, body, profile }, res, () => {});
    if (handlers.finish) handlers.finish();
  };
  run("/api/play", { zone_or_output_id: "out-1" }, 200);
  run("/api/play", { zone_or_output_id: "out-1" }, 503);
  run("/api/radio", { zone: "z1", enabled: false }, 200);
  run("/api/radio", { zone: "z1", enabled: true }, 200, "guest");
  run("/api/library/albums", { zone_or_output_id: "z1" }, 200);
  run("/api/transfer-zone", { from_zone: "x", to_zone: "z1" }, 200, "3");
  assert.deepEqual(starts, ["z1:2", "z1:guest", "z1:3"], "THE one: a failed play, radio switched off, or a non-play route counted as a start");
});

test("a track begun is written for whose the zone's listening is; a track ended keeps the zone current", () => {
  const { createScrobbler } = require("../../lib/listening/scrobble");
  const rows = [], touched = [];
  let clock = 0;
  const store = { startPlay: (p) => { rows.push(p); return rows.length; }, endPlay() {} };
  const s = createScrobbler({ state: new Map(), history: new Map(), historyEntry: () => null, pushHistory: (l) => l,
    store: () => /** @type {any} */ (store), match: () => ({ key: "a", al: { title: "A" } }), libraryReady: () => true,
    runs: /** @type {any} */ ({ noteTrack() {}, end() {} }), changed() {}, now: () => clock,
    whose: (zid) => (zid === "z" ? "7" : ""), touch: (zid) => touched.push(zid) });
  const push = (track, pos) => { clock += 1000; s.update({ zone_id: "z", display_name: "Study", state: "playing",
    now_playing: { seek_position: pos, length: 200, image_key: "i", three_line: { line1: track, line2: "X", line3: "A" } } }); };
  push("One", 0);
  push("Two", 0);
  assert.deepEqual(rows.map((r) => r.profile), ["7", "7"], "THE one: a play written for no profile");
  assert.deepEqual(touched, ["z"], "the end of One said");
});
