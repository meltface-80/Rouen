"use strict";
// ---------------------------------------------------------------------------
// Whose each album on Listen later is (lib/listen-later/owners.js, dev/design/profiles.md §12, 2.0.7-t5). The owner
// (2026-11-26): "Roon's list, tagged"; albums no profile put aside are everyone's; Guest sees the shared ones; played
// through hides, never writes to Roon. Each test broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLaterOwners } = require("../../lib/listen-later/owners");

let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s; without it the database's tests skip
}

function world() {
  const db = new Database(":memory:");
  let t = 100;
  const o = createLaterOwners({ db: () => db, now: () => t++ });
  o.migrate(db);
  return { db, o };
}
const BLUE = { key: "blue||joni mitchell", albumId: "700", title: "Blue", artist: "Joni Mitchell" };
const DUMMY = { key: "dummy||portishead", albumId: null, title: "Dummy", artist: "Portishead" };

test("who sees an album: untagged is everyone's; a tag is its profile's; shared is everyone's; Guest sees only the shared", { skip: !Database }, () => {
  const { o } = world();
  assert.equal(o.viewFor("1")(BLUE), true, "an album no one put aside (everything before 2.0.7-t5) hidden");
  assert.equal(o.viewFor("")(BLUE), true, "Guest doesn't see the household's");
  o.claim("1", BLUE);
  assert.deepEqual(["1", "2", ""].map((v) => o.viewFor(v)(BLUE)), [true, false, false], "THE one: one profile's album shown to another");
  assert.equal(o.viewFor(null)(BLUE), true, "outside a request: everything, as before profiles");
  assert.equal(o.viewFor("2")({ key: "other key", albumId: "700" }), false, "Roon's AlbumId names the same album");
  o.claim("", DUMMY);
  assert.deepEqual(["1", "2", ""].map((v) => o.viewFor(v)(DUMMY)), [true, true, true], "what Guest puts aside is shared");
});

test("taken off by hand: shared or no one else's leaves the list; another profile's stays for it", { skip: !Database }, () => {
  const { o } = world();
  o.claim("1", BLUE);
  o.claim("2", BLUE);
  assert.equal(o.release("1", BLUE), false, "THE one: taken off Roon's list while another profile has it");
  assert.deepEqual(["1", "2"].map((v) => o.viewFor(v)(BLUE)), [false, true]);
  assert.equal(o.release("2", BLUE), true, "the last one's: off the list");
  assert.equal(o.viewFor("1")(BLUE), false, "its tags gone before the caller took it off");
  o.forget(BLUE);
  assert.equal(o.viewFor("1")(BLUE), true, "its tags not gone with it (the album, if put back, would stay hidden)");
  assert.equal(o.release("1", DUMMY), true, "the household's: off the list for everyone");
  o.claim("", DUMMY);
  o.claim("2", DUMMY);
  assert.equal(o.release("2", DUMMY), true, "shared is everyone's: off the list");
});

test("played through hides it from its profile and keeps it; put aside again shows it; the household's is the caller's", { skip: !Database }, () => {
  const { o } = world();
  o.claim("1", BLUE);
  assert.equal(o.hide("1", BLUE), false, "no one else sees it now");
  assert.deepEqual(["1", "2", ""].map((v) => o.viewFor(v)(BLUE)), [false, false, false],
    "THE one: played through and shown again, or made everyone's");
  o.claim("1", BLUE);
  assert.equal(o.viewFor("1")(BLUE), true, "put aside again");
  o.claim("2", BLUE);
  assert.equal(o.hide("1", BLUE), true, "the other profile still has it");
  assert.equal(o.hide("1", DUMMY), null, "untagged: the household's rule, not this one");
  assert.deepEqual(o.open("2").map((r) => r.key), [BLUE.key]);
  assert.deepEqual(o.open("1"), []);
});

test("a profile removed: its tags to the one chosen, that one's own kept; backups carry them", { skip: !Database }, () => {
  const { o } = world();
  o.claim("1", BLUE);
  o.claim("3", BLUE);
  o.claim("3", DUMMY);
  o.hide("1", BLUE);
  o.moveProfile("3", "1");
  assert.deepEqual(o.exportAll().map((r) => [r.key, r.profile, r.done]).sort(), [[BLUE.key, "1", 1], [DUMMY.key, "1", 0]]);
  const saved = o.exportAll();
  o.claim("2", BLUE);
  o.restoreAll(saved);
  assert.deepEqual(o.exportAll().map((r) => [r.key, r.profile, r.done]).sort(), [[BLUE.key, "1", 1], [DUMMY.key, "1", 0]]);
  o.restoreAll([{ key: "", profile: "1" }, null, { key: "x", profile: 4 }]);
  assert.deepEqual(o.exportAll(), [], "a malformed row restored");
});

test("no database: everything is everyone's and nothing is kept", () => {
  const o = createLaterOwners({ db: () => null });
  o.claim("1", BLUE);
  assert.equal(o.viewFor("2")(BLUE), true);
  assert.equal(o.release("2", BLUE), true);
  assert.equal(o.hide("1", BLUE), null);
});

test("the review of 2.0.7-t5: a tag matches by the album's own key too; a restore leaves out profiles not here", { skip: !Database }, () => {
  const { o } = world();
  // Put aside under a pick's strings, then the library got the album under another key: still the same album.
  o.claim("1", { key: "pick key", alt: "pick key", albumId: null, title: "Quique (Redux)", artist: "Seefeel" });
  assert.equal(o.viewFor("2")({ key: "library key", alt: "pick key", albumId: null }), false, "THE one: a pick made everyone's once the library had it");
  o.claim("1", { key: "library key", alt: "pick key", albumId: null });
  assert.deepEqual(o.exportAll().map((r) => r.key).sort(), ["library key", "pick key"]);
  o.restoreAll([{ key: "a", profile: "1" }, { key: "b", profile: "99" }, { key: "c", profile: "" }], (id) => id === "1");
  assert.deepEqual(o.exportAll().map((r) => r.key).sort(), ["a", "c"], "a tag naming a profile not here restored: its album hidden from everyone");
  assert.equal(o.prune((t) => t.key === "a"), 1);
  assert.deepEqual(o.exportAll().map((r) => r.key), ["a"]);
});
