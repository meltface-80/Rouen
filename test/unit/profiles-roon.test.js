"use strict";
// ---------------------------------------------------------------------------
// Profiles and Roon's, both ways (dev/design/profiles.md §13.2-13.3, 2.0.8-t2; lib/profiles/roon-sync.js). The owner,
// 2026-11-26: "A Roon profile becomes a Rouen profile. A Rouen profile becomes a Roon profile. Each profile has its own
// hearted albums, own playlists (unless shared), own play counts". Moved out of profiles.test.js; each test was broken
// on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProfiles } = require("../../lib/profiles");
const { createRoonSync } = require("../../lib/profiles/roon-sync");
const { NOBODY, household, setHousehold } = require("../../lib/roon-direct/session");
const { Database, PLAYS, world, routes } = require("../lib/profiles-world");

// §13.2 (2.0.8-t2, the owner, 2026-11-26: "Link each one", "Two way", "Pair once"): each Rouen profile paired with one of
// the Roon server's profiles, one each; Roon's others show up as Rouen profiles once every Rouen profile is paired.
test("§13.2: each profile paired with one of your server's Roon profiles, one each; a refused pairing writes nothing", { skip: !Database }, () => {
  const w = world();
  const roon = { profiles: [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "test123" }] };
  let server = /** @type {any} */ (roon);
  const { call } = routes(w, () => server);
  const first = w.profiles.first().id;
  const sam = w.profiles.add("Sam").id;
  let r = call("GET /api/profiles");
  assert.deepEqual(r.body.roon, { profiles: roon.profiles }, "the server's Roon profiles, for the select");
  assert.equal(r.body.pairing, true, "two profiles paired with none: the pairing not said");
  assert.deepEqual(r.body.profiles.map((p) => [p.name, p.roonState]), [["Alex", "none"], ["Sam", "none"]], "a Roon profile added while the pairing was open");
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: "DEADBEEF" } });
  assert.equal(r.body.profiles[1].roonProfile, "deadbeef", "the pairing was not kept");
  r = call("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "deadbeef", name: "Me" } });
  assert.deepEqual([r.status, r.body.error], [400, "already paired with Sam"], "THE one: two Rouen profiles on one Roon profile");
  assert.equal(w.profiles.first().name, "Alex", "a refused pairing still renamed");
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: "00ff00" } });
  assert.deepEqual([r.status, r.body.error], [400, "not one of your server's profiles"]);
  server = null;
  assert.equal(call("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "cafebabe" } }).status, 400,
    "native mode not in use: no list to check against, so no pairing");
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: null } });
  assert.equal(r.body.profiles[1].roonProfile, null, "a pairing taken off, even with native mode not in use");
  assert.equal(call("POST /api/profiles/:id", { params: { id: "77" }, body: { roonProfile: null } }).status, 400);
  server = roon;
  r = call("POST /api/profiles/:id", { params: { id: sam }, body: { roonProfile: "deadbeef", colour: "not a colour" } });
  assert.equal(r.status, 400);
  assert.equal(w.profiles.get(sam).roon_profile, null, "the review: a refused change still saved the pairing");
  assert.throws(() => w.profiles.setRoon(sam, "not hex"), /not one of your server's profiles/);
});

test("§13.2-13.3: Roon's profiles show up once the pairing is done; one removed from Rouen stays out; one gone from Roon is kept", { skip: !Database }, () => {
  const w = world();
  const owner = { id: "cafebabe", name: "Owner" }, t123 = { id: "deadbeef", name: "test123" }, kid = { id: "0abc", name: "Alex" };
  let server = /** @type {any} */ ({ profiles: [owner, t123] });
  const { call } = routes(w, () => server);
  const first = w.profiles.first().id;
  call("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "cafebabe" } });
  let r = call("GET /api/profiles");
  assert.equal(r.body.pairing, false);
  assert.deepEqual(r.body.profiles.map((p) => [p.name, p.roonProfile, p.roonState]), [["Alex", "cafebabe", "paired"], ["test123", "deadbeef", "paired"]],
    "THE one for the owner's report: test123, added in Roon, didn't come through");
  r = call("GET /api/profiles");
  assert.equal(r.body.profiles.length, 2, "added twice");
  server = { profiles: [owner, t123, kid] };
  r = call("GET /api/profiles");
  assert.deepEqual(r.body.profiles.map((p) => p.name), ["Alex", "test123", "Alex 2"], "a Roon profile named like a Rouen one, numbered");
  const kidId = r.body.profiles[2].id;
  call("POST /api/profiles/:id/remove", { params: { id: kidId }, body: { moveTo: first } });
  r = call("GET /api/profiles");
  assert.deepEqual(r.body.profiles.map((p) => p.name), ["Alex", "test123"], "removed from Rouen only (§13.3), and added back by the next read");
  // Paired again by hand, it is no longer one removed on purpose.
  const lee = call("POST /api/profiles", { body: { name: "Lee" } }).body.added;
  assert.equal(call("GET /api/profiles").body.pairing, true);
  call("POST /api/profiles/:id", { params: { id: lee }, body: { roonProfile: "0abc" } });
  assert.equal(w.profiles.get(lee).roon_profile, "0abc");
  call("POST /api/profiles/:id", { params: { id: lee }, body: { roonProfile: null } });
  call("POST /api/profiles/:id/remove", { params: { id: lee }, body: { moveTo: first } });
  assert.deepEqual(call("GET /api/profiles").body.profiles.map((p) => p.name), ["Alex", "test123", "Alex 2"], "paired again, it stayed hidden");
  // A Roon profile deleted in Roon's app: its Rouen profile kept, with its listening, "Not in Roon now" (§13.3).
  server = { profiles: [owner, kid] };
  r = call("GET /api/profiles");
  assert.deepEqual(r.body.profiles.map((p) => [p.name, p.roonState]), [["Alex", "paired"], ["test123", "gone"], ["Alex 2", "paired"]]);
  server = null;
  assert.deepEqual(call("GET /api/profiles").body.profiles.map((p) => p.roonState), ["paired", "paired", "paired"], "native mode not read: nothing said gone");
});

test("§13.2: Read Roon's profiles again asks native mode for one reconnect; not in use, said so", { skip: !Database }, () => {
  const w = world();
  let asked = 0;
  let server = /** @type {any} */ ({ profiles: [], reread: () => { asked++; } });
  const { call } = routes(w, () => server);
  assert.deepEqual(call("POST /api/profiles/roon-reread").body, { rereading: true });
  assert.equal(asked, 1);
  server = null;
  assert.deepEqual(call("POST /api/profiles/roon-reread"), { status: 409, body: { error: "Native mode isn't connected to your server right now." }, headers: {} });
  assert.equal(asked, 1);
});

test("§13.2: a device acts in Roon as its paired profile in its own routes only; Guest and one paired with none as nobody; other routes: the household's", { skip: !Database }, (t) => {
  const db = new Database(":memory:");
  db.exec(PLAYS);
  const p = createProfiles({ db: () => db, accountName: () => "Alex", zone: () => null, changed() {} });
  t.after(() => setHousehold(() => null));
  p.migrate(db);
  const sam = p.store.add("Sam").id;
  p.store.setRoon(sam, "deadbeef");
  const inReq = (cookie, path) => { let out; p.middleware({ headers: { cookie }, path }, {}, () => { out = p.roonOfRequest(); }); return out; };
  for (const path of ["/api/hearts/album", "/api/hearts/tracks", "/api/library/add", "/api/listen-later", "/api/album", "/api/shelf/albums", "/api/smart-picks"]) {
    assert.equal(inReq("rouen_profile=" + sam, path), "deadbeef", "the device's pairing not read on " + path);
  }
  for (const path of ["/api/smart-picks/rebuild", "/api/roon-playlists", "/api/live", "/api/listen-later/x", "/api/hearts"]) {
    assert.equal(inReq("rouen_profile=" + sam, path), null, "the device's pairing reached " + path);
  }
  assert.equal(inReq("rouen_profile=guest", "/api/hearts/album"), NOBODY, "THE one: Guest acts as another profile");
  assert.equal(inReq("", "/api/hearts/album"), NOBODY, "THE one for the owner's report: the first, paired with none, acts as another profile");
  assert.equal(p.roonOfRequest(), null, "outside a request (a build, the nightly read)");
  assert.equal(p.asRoonOf(p.store.first().id, () => p.roonOfRequest()), NOBODY, "a build for a profile paired with none acts as another");
  assert.equal(p.asRoonOf(sam, () => p.roonOfRequest()), "deadbeef");
  // The household's (§13.2): Rouen's first profile's pairing, for what is no one's own.
  assert.equal(household(), null);
  p.store.setRoon(p.store.first().id, "cafebabe");
  assert.equal(household(), "cafebabe");
  assert.equal(inReq("", "/api/hearts/album"), "cafebabe");
});

test("§13.2, the review: a Roon profile with a name Rouen can't take is added under another, and nothing it does stops the page; a removal refused hides nothing", { skip: !Database }, () => {
  const w = world();
  const owner = { id: "cafebabe", name: "Owner" };
  let server = /** @type {any} */ ({ profiles: [owner, { id: "0a", name: "Guest" }, { id: "0b", name: "   " }, { id: "0c", name: "Alex" }] });
  const { call } = routes(w, () => server);
  const first = w.profiles.first().id;
  call("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "cafebabe" } });
  let r = call("GET /api/profiles");
  assert.equal(r.status, 200, "THE one: a Roon profile named Guest stopped Settings → Profiles");
  assert.deepEqual(r.body.profiles.map((p) => [p.name, p.roonProfile]), [["Alex", "cafebabe"], ["Guest (Roon)", "0a"], ["Roon profile", "0b"], ["Alex 2", "0c"]]);
  // A removal refused (its plays moved to itself) leaves its Roon profile to come back: nothing was removed.
  const g = r.body.profiles[1].id;
  assert.equal(call("POST /api/profiles/:id/remove", { params: { id: g }, body: { moveTo: g } }).status, 400);
  call("POST /api/profiles/:id", { params: { id: g }, body: { roonProfile: null } });
  call("POST /api/profiles/:id/remove", { params: { id: g }, body: { moveTo: first } });
  assert.deepEqual(call("GET /api/profiles").body.profiles.map((p) => p.name), ["Alex", "Roon profile", "Alex 2", "Guest (Roon)"],
    "THE one: a removal of an unpaired profile hid the Roon profile it was paired with before a refusal");
  // A database the sync can't write to: the page still answers.
  server = { profiles: [owner, { id: "0d", name: "Kid" }] };
  const broken = routes(Object.assign({}, w, { db: { prepare: () => { throw new Error("database is locked"); } } }), () => server);
  assert.equal(broken.call("GET /api/profiles").status, 200);
});

test("§13.2, the review: one Roon profile that can't be added (its write failed) leaves the others added, and says so in the log", { skip: !Database }, () => {
  const w = world();
  const logged = [];
  w.profiles.setRoon(w.profiles.first().id, "cafebabe");
  const store = Object.assign({}, w.profiles, { add: (n) => { if (/^Kid|^Roon profile/.test(n)) throw new Error("disk full"); return w.profiles.add(n); } });
  const sync = createRoonSync({ store, db: () => w.db, log: (l) => logged.push(l),
    roon: () => ({ profiles: [{ id: "cafebabe", name: "Owner" }, { id: "0a", name: "Kid" }, { id: "0b", name: "Lee" }] }) });
  assert.deepEqual(sync.sync(), ["Lee"], "THE one: the first that failed stopped the rest");
  assert.match(logged.join("\n"), /Roon's "Kid" not added: no name Rouen can take for "Kid"/);
});

test("THE one for the owner's 'Unable to heart albums': the Roon profile Native mode was set to is carried once to the first profile, before any device's heart", { skip: !Database }, (t) => {
  const db = new Database(":memory:");
  db.exec(PLAYS);
  let former = "cafebabe";
  const roon = { profiles: [{ id: "cafebabe", name: "MENZIES" }, { id: "deadbeef", name: "test123" }] };
  const p = createProfiles({ db: () => db, accountName: () => "Me", zone: () => null, changed() {}, roonProfiles: () => Object.assign({ former }, roon) });
  t.after(() => setHousehold(() => null));
  p.migrate(db);
  const first = p.store.first().id;
  const inReq = (path) => { let out; p.middleware({ headers: { cookie: "" }, path }, {}, () => { out = p.roonOfRequest(); }); return out; };
  assert.equal(inReq("/api/live"), null, "carried on a route that isn't a device's own");
  assert.equal(p.store.first().roon_profile, null);
  assert.equal(inReq("/api/hearts/album"), "cafebabe", "THE one: the first profile, unpaired after the update, had no hearts");
  assert.equal(household(), "cafebabe");
  // Once, ever: unpaired by hand, it stays so, whatever Native mode's old choice says.
  p.store.setRoon(first, null);
  assert.equal(inReq("/api/hearts/album"), NOBODY);
  assert.equal(p.store.first().roon_profile, null, "paired again after being unpaired by hand");
  former = null;
});

test("§13.2 carry: not to a Roon profile the server no longer has, nor one another profile has; nothing chosen, nothing done", { skip: !Database }, () => {
  const mk = (former, pre) => {
    const w = world();
    if (pre) pre(w);
    const sync = createRoonSync({ store: w.profiles, db: () => w.db, roon: () => ({ profiles: [{ id: "cafebabe", name: "MENZIES" }, { id: "deadbeef", name: "test123" }], former }) });
    return { w, ok: sync.carry(), again: sync.carry() };
  };
  assert.deepEqual([mk("00ff").ok, mk(null).ok], [false, false]);
  const taken = mk("cafebabe", (w) => w.profiles.setRoon(w.profiles.add("Sam").id, "cafebabe"));
  assert.deepEqual([taken.ok, taken.w.profiles.first().roon_profile], [false, null], "two Rouen profiles on one Roon profile");
  const done = mk("cafebabe");
  assert.deepEqual([done.ok, done.again, done.w.profiles.first().roon_profile], [true, false, "cafebabe"]);
  const paired = mk("cafebabe", (w) => w.profiles.setRoon(w.profiles.first().id, "deadbeef"));
  assert.deepEqual([paired.ok, paired.w.profiles.first().roon_profile], [false, "deadbeef"], "a pairing made by hand replaced");
});

test("§13.2 carry: once across restarts too — a first profile unpaired by hand isn't paired again when Rouen starts anew", { skip: !Database }, () => {
  const w = world();
  const roon = () => ({ profiles: [{ id: "cafebabe", name: "MENZIES" }], former: "cafebabe" });
  assert.equal(createRoonSync({ store: w.profiles, db: () => w.db, roon }).carry(), true);
  w.profiles.setRoon(w.profiles.first().id, null);
  assert.equal(createRoonSync({ store: w.profiles, db: () => w.db, roon }).carry(), false, "THE one: paired again at the next start");
  assert.equal(w.profiles.first().roon_profile, null);
});
