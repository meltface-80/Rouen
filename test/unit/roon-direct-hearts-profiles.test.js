"use strict";
// ---------------------------------------------------------------------------
// Hearts and profiles (profiles.md §5, §13.2): each Rouen profile's hearts are its own Roon profile's, through its
// pairing; a device with none (Guest, unpaired) sees and writes none; the household's are Rouen's first profile's. Moved
// out of roon-direct-hearts.test.js in 2.0.8-t2, unchanged but for the §13.2 cases. Against the fake Core, which is not
// evidence of what a real Core does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { NOBODY, WHY_NOBODY } = require("../../lib/roon-direct/session");
const { until, tidy, rig } = require("../lib/roon-direct-hearts-rig");

test("THE one for §13.2: several Roon profiles, Rouen's first paired with none — hearts wait for the pairing, then are its Roon profile's", async (t) => {
  let hh = null;
  const w = await rig(t, { twoProfiles: true, household: () => hh });
  assert.deepEqual(w.s1.status().hearts.profiles, [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "Guest" }]);
  assert.match(w.marks.albumState("Blue", "Joni Mitchell").why, /^Pair Rouen's first profile/);
  hh = "deadbeef";
  // The fake gives its second Roon profile the opposite of the owner's: Blue (not the owner's) is its.
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true, "the server's first's heart shown, read before the pairing");
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", false)).ok, true);
  assert.equal(w.core.rec.hearts.at(-1).profile, "deadbeef", "the heart went to another profile than the one paired");
  assert.equal(w.reads(), 1, "every profile's hearts come with one read: none needed again for a pairing");
});

test("THE one for the owner's 2026-11-26 report: a device with no Roon profile of its own (Guest, unpaired) sees no heart and writes none", async (t) => {
  const w = await rig(t, { twoProfiles: true, household: "cafebabe" }, undefined, (albums) => { albums[0].favorite = true; },
    { requestProfile: () => NOBODY });
  assert.equal(w.s1.actingFor(), NOBODY);
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").why, WHY_NOBODY, "the household's heart shown to a device with none");
  assert.equal(w.s1.heartOf({ favorite: true, favBy: { cafebabe: true } }), null, "THE one: the other profile's heart, as Test showed Me's");
  assert.deepEqual(await w.marks.setAlbum("Kind of Blue", "Miles Davis", false), { error: WHY_NOBODY, status: 409 });
  assert.deepEqual(w.core.rec.hearts, [], "a heart written for someone else");
  const one = await rig(t, { household: "cafebabe" }, undefined, undefined, { requestProfile: () => NOBODY });
  assert.equal(one.marks.albumState("Blue", "Joni Mitchell").why, WHY_NOBODY, "one Roon profile: still none of its own");
  assert.deepEqual(await one.marks.setAlbum("Blue", "Joni Mitchell", true), { error: WHY_NOBODY, status: 409 });
  assert.deepEqual(one.core.rec.hearts, []);
});

// profiles.md §13.2: a device whose Rouen profile is paired with another Roon profile hearts as that profile, while the
// library is read as the household's (Rouen's first profile's pairing).
test("THE one for P2: a paired device's hearts are its own Roon profile's; the household's stay as they were", async (t) => {
  let acting = null;
  const w = await rig(t, { twoProfiles: true, household: "cafebabe" }, undefined, (albums) => { albums[0].favorite = true; },
    { requestProfile: () => acting });
  // The owner's: Kind of Blue; the fake gives its second Roon profile (named "Guest" there) the opposite, so Blue.
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, true);
  acting = "deadbeef";
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, false, "the household's heart shown to the paired device");
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true, "the linked profile's own heart, from the same read, not shown");
  assert.deepEqual(await w.marks.setAlbum("Kind of Blue", "Miles Davis", true), { ok: true, favorite: true });
  assert.deepEqual(w.core.rec.hearts.at(-1), { albums: ["7000000000000"], state: 1, profile: "deadbeef" }, "the heart went to the household's");
  assert.equal(w.albums[0].favorite, true, "the owner's heart was touched");
  assert.equal(w.albums[0].favOther, true, "the fake Core did not take it");
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, true);
  // the second Roon profile's heart taken off: the owner's still shows on a device that isn't linked.
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", false)).ok, true);
  assert.notEqual(w.albums[1].favorite, true, "the owner's Blue was hearted");
  acting = null;
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, true);
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, false, "the second Roon profile's heart shown as the owner's");
  assert.equal(w.s1.heartOf({ favorite: true, favBy: { deadbeef: false } }), true, "outside a device's routes: the household's, as read");
  acting = "deadbeef";
  assert.equal(w.s1.heartOf({ favorite: true, favBy: { deadbeef: false } }), false, "a linked device: its profile's");
  assert.equal(w.s1.heartOf({ favorite: true, favBy: null }), null, "a read that said nothing: not made up");
  // The next read confirms both of the second Roon profile's hearts, each against its own value.
  await tidy(w.core.rec);
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  assert.deepEqual([w.marks.status().albumConfirmed, w.marks.status().awaiting, w.marks.status().album.on], [2, 0, true]);
});

test("P2: a heart set in Roon's app for another profile shows at once on its linked devices, and the Shelf asks again", async (t) => {
  let acting = "deadbeef";
  const w = await rig(t, { twoProfiles: true, household: "cafebabe" }, undefined, undefined, { requestProfile: () => acting });
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, true, "the fake gives its second Roon profile the opposite of the owner's");
  const rev = w.s1.factsRev();
  w.core.favoriteElsewhere(0, false, true);                  // the second Roon profile's taken off in Roon's app; the owner's stays off
  assert.ok(await until(() => w.marks.albumState("Kind of Blue", "Miles Davis").favorite === false), "THE one: the second Roon profile's heart stayed");
  assert.ok(w.s1.factsRev() > rev, "the Shelf not told: a linked device kept the old heart");
  acting = null;
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, false);
});

test("P2, the review: Rouen's own heart for a linked profile, shown back by the server, is not a change made elsewhere", async (t) => {
  const w = await rig(t, { twoProfiles: true, household: "cafebabe", albumHeartPushed: "first" }, undefined, undefined,
    { requestProfile: () => "deadbeef" });
  const live = w.s1.status().hearts.live;
  // The fake's second profile has Kind of Blue (the opposite of the owner's): taken off.
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, true);
  assert.equal((await w.marks.setAlbum("Kind of Blue", "Miles Davis", false)).ok, true);
  await until(() => w.marks.status().awaiting === 0);
  assert.equal(w.marks.status().awaiting, 0, "the push didn't confirm it");
  assert.equal(w.s1.status().hearts.live, live, "THE one: Rouen's own heart counted as made in Roon's app");
});

test("§13.2: a device paired with a Roon profile the server no longer has acts for none; on a server of one, its own", async (t) => {
  let acting = "00ff00";
  const w = await rig(t, { twoProfiles: true, household: "cafebabe" }, undefined, undefined, { requestProfile: () => acting });
  assert.equal(w.s1.actingFor(), NOBODY, "THE one: a pairing gone from the server fell back to the household's");
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").why, WHY_NOBODY);
  acting = null;
  assert.equal(w.s1.actingFor(), "cafebabe", "outside a device's routes: the household's");
  const one = await rig(t, {}, undefined, undefined, { requestProfile: () => "cafebabe" });
  assert.equal(one.s1.actingFor(), "cafebabe", "one Roon profile, paired: its own");
  assert.deepEqual(await one.marks.setAlbum("Blue", "Joni Mitchell", true), { ok: true, favorite: true });
  assert.equal(one.albums[1].favorite, true);
});

test("P2: another profile's heart pushed while a read runs is not lost by that read", async (t) => {
  const w = await rig(t, { twoProfiles: true, household: "cafebabe" }, async (n, core, s1) => {
    if (n !== 2) return;
    const rev = s1.factsRev();
    core.favoriteElsewhere(0, false, true);                  // the second Roon profile's Kind of Blue taken off in Roon's app, mid-read
    await until(() => s1.factsRev() > rev);
  }, undefined, { requestProfile: () => "deadbeef" });
  w.s1.linkUp();
  assert.ok(await until(() => w.reads() === 2));
  await w.s1.settled();
  assert.equal(w.marks.albumState("Kind of Blue", "Miles Davis").favorite, false, "THE one: the read's result undid the second Roon profile's push");
});


test("§13.2: NOBODY names no Roon profile, so nothing that takes one falls back to the server's first", () => {
  const { profileFor, profileObjectFor } = require("../../lib/roon-direct/session");
  const P = (id) => ({ fields: { "System.Sooid Sooloos.Broker.Api.Profile::ProfileId": Buffer.from(id, "hex") } });
  const root = { profiles: [P("cafebabe")], profileId: Buffer.from("cafebabe", "hex") };
  assert.equal(profileObjectFor(root, NOBODY), null, "THE one: the server's first profile stood in for none");
  assert.equal(profileFor(root, NOBODY), null);
  assert.equal(profileFor(root, null).toString("hex"), "cafebabe", "the household's, none paired: the server's first, as before");
});

test("the review of §13.2: Rouen's first profile paired with another Roon profile — the next read is as it, and a heart awaiting the last profile's read is not held against it", async (t) => {
  let hh = "cafebabe";
  const w = await rig(t, { twoProfiles: true, household: () => hh });
  assert.deepEqual(await w.marks.setAlbum("Blue", "Joni Mitchell", true), { ok: true, favorite: true });
  // Hearts awaiting a read are of the profile it is read as: a read as another starts them again (marks.reset).
  let resets = 0;
  const reset = w.marks.reset;
  w.marks.reset = () => { resets++; reset(); };
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(resets, 0, "hearts awaiting a read dropped by a read as the same profile");
  hh = "deadbeef";
  assert.equal(w.s1.roonProfiles().chosen, "deadbeef", "index.js reads whose Listen later tags are kept by it");
  w.core.drop();
  assert.ok(await until(() => w.reads() === 3));
  assert.equal(resets, 1, "THE one: hearts awaiting the first Roon profile's read kept for the second's");
  assert.deepEqual([w.marks.status().awaiting, w.marks.status().album.on], [0, true],
    "THE one: the first Roon profile's heart checked against the second's read, and hearts fell back");
  assert.equal(w.s1.heartOf({ favorite: true, favBy: { cafebabe: false, deadbeef: true } }), true, "the read's own is now the second's");
});

test("P3b: a Roon profile made after the connection opened (in Rouen, or in Roon's app) is a device's own at once, without a reconnect", async (t) => {
  const w = await rig(t, { household: "cafebabe" }, undefined, undefined, { requestProfile: () => "0abc" });
  assert.equal(w.s1.actingFor(), NOBODY, "not on the server yet");
  const { graph } = w.link.session();
  const owner = graph.ofType("Profile")[0];
  const P = (oid, id, name) => ({ oid, typeName: "Sooloos.Broker.Api.Profile", loaded: true,
    fields: { "System.Sooid Sooloos.Broker.Api.Profile::ProfileId": Buffer.from(id, "hex"), "string Sooloos.Broker.Api.Profile::Name": name } });
  graph.objects.set("900", P(900n, "0abc", "Test"));
  graph.objects.set("901", { oid: 901n, typeName: "System.Collections.Generic.IList", loaded: true, fields: { $items: [{ $ref: owner.oid }, { $ref: 900n }] } });
  graph.objects.set("902", { oid: 902n, typeName: "Sooloos.Broker.Api.Account", loaded: true, fields: { "x Sooloos.Broker.Api.Account::Profiles": { $ref: 901n } } });
  assert.equal(w.s1.actingFor(), "0abc", "THE one: the profile made since acts as nobody until a reconnect");
  assert.deepEqual(w.s1.roonProfiles().profiles.map((p) => p.name), ["Owner", "Test"]);
});
