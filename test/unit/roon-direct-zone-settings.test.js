"use strict";
// ---------------------------------------------------------------------------
// N3-3b (lib/roon-direct/zone-settings.js, v1.9.66-t6, native-remote.md §15.6): a zone's crossfade, volume levelling
// and sleep timer, read from the server's Zone as the graph holds it. The members and values are the owner's
// recordings' (§15.4, §15.5); the frames are built here, so they are not evidence of what a server sends.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { createZoneSettings, utcFromBinary } = require("../../lib/roon-direct/zone-settings");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

const API = "Sooloos.Broker.Api.";
const MEMBERS = [["System.Sooid", "ZoneId", P.Sooid], ["int", "CrossFade", P.Int], ["int", "VolumeLeveling", P.Int],
  ["int", "VolumeLevelingTargetLevel", P.Int], ["int", "VolumeLevelingDefaultAdjustment", P.Int], ["bool", "IsSleepTimerEnabled", P.Bool],
  ["int", "SleepTimerDurationMinutes", P.Int], ["System.DateTime", "SleepTimerExpiration", P.DateTime]];
const ID = "16aa01";

function graph() {
  const g = new ObjectGraph();
  g.types.set(1, { id: 1, name: API + "Zone", members: MEMBERS.map(([t, n, pt]) => ({ name: `${t} ${API}Zone::${n}`, propType: pt })) });
  return g;
}
/** The zone (oid 10) pushed whole, with the members given by name. */
function zone(m) {
  const w = new BinaryWriter().long(10n).flexInt(1).flexInt(1).sooid(Buffer.from(ID, "hex"));
  MEMBERS.forEach(([, n], i) => {
    if (m[n] === undefined) return;
    w.flexInt(i + 1);
    if (n === "IsSleepTimerEnabled") w.boolean(m[n]); else if (n === "SleepTimerExpiration") w.long(BigInt(m[n])); else w.integer(m[n]);
  });
  return { cmd: 5, isResponse: false, body: w.flexInt(0).toBuffer() };
}

test("THE one: crossfade, levelling and the sleep timer, as the owner's server sent them, and each back off", () => {
  const g = graph();
  const zs = createZoneSettings({ link: { session: () => ({ graph: g }) }, on: () => true });
  g.ingest(zone({ VolumeLevelingTargetLevel: -23, VolumeLevelingDefaultAdjustment: -5, SleepTimerDurationMinutes: 30 }));
  assert.deepEqual(zs.read(ID.toUpperCase()), { native: true, found: true, zone_id: ID,
    crossfade: { on: false, seconds: 0 },
    leveling: { on: false, mode: "off", value: 0, target: -23, adjustment: -5 },
    sleep: { on: false, minutes: 30, ends: null } });
  g.ingest(zone({ CrossFade: 10, VolumeLeveling: 2, VolumeLevelingTargetLevel: -14, VolumeLevelingDefaultAdjustment: -5,
    IsSleepTimerEnabled: true, SleepTimerDurationMinutes: 45, SleepTimerExpiration: "5250969802705036672" }));
  const on = zs.read(ID);
  assert.deepEqual([on.crossfade, on.leveling, on.sleep], [{ on: true, seconds: 10 },
    { on: true, mode: "album", value: 2, target: -14, adjustment: -5 },
    { on: true, minutes: 45, ends: "2026-10-23T18:53:47.764Z" }]);
  // cancelled, crossfade off, levelling off: each left out of the whole zone, so each back at its default
  g.ingest(zone({ VolumeLevelingTargetLevel: -14, SleepTimerDurationMinutes: 45 }));
  const off = zs.read(ID);
  assert.deepEqual([off.crossfade.on, off.leveling.mode, off.sleep], [false, "off", { on: false, minutes: 45, ends: null }]);
  // an end time without the timer on is no timer: only IsSleepTimerEnabled says it runs
  g.ingest(zone({ SleepTimerDurationMinutes: 45, SleepTimerExpiration: "5250969802705036672" }));
  assert.deepEqual(zs.read(ID).sleep, { on: false, minutes: 45, ends: null });
  // a levelling value not yet seen is said as Roon's number, not named by guess
  g.ingest(zone({ VolumeLeveling: 3 }));
  assert.deepEqual(zs.read(ID).leveling, { on: true, mode: null, value: 3, target: null, adjustment: null });
});

test("the review: a zone remade under a new object (the iPad's, §15.5) is read from the newest, not the one left behind", () => {
  const g = graph();
  const zs = createZoneSettings({ link: { session: () => ({ graph: g }) }, on: () => true });
  g.ingest(zone({ CrossFade: 10 }));                                     // oid 10
  const w = new BinaryWriter().long(11n).flexInt(1).flexInt(1).sooid(Buffer.from(ID, "hex")).flexInt(0);
  g.ingest({ cmd: 3, isResponse: false, body: w.toBuffer() });          // oid 11: the same ZoneId, crossfade off
  assert.equal(zs.read(ID).crossfade.on, false);
});

test("native mode off, no connection, or no such zone: said, never guessed", () => {
  const g = graph();
  assert.deepEqual(createZoneSettings({ link: { session: () => ({ graph: g }) }, on: () => false }).read(ID), { native: false, why: "Native mode is off." });
  assert.equal(createZoneSettings({ link: { session: () => null }, on: () => true }).read(ID).native, false);
  assert.equal(createZoneSettings({ link: null, on: () => true }).read(ID).native, false);
  assert.deepEqual(createZoneSettings({ link: { session: () => ({ graph: g }) }, on: () => true }).read("ab12"), { native: true, found: false, zone_id: "ab12" });
});

test("a time: a UTC DateTime.ToBinary only; a local or unspecified one, or no number, is no time", () => {
  assert.equal(utcFromBinary(5250969775344768940n), "2026-10-23T18:08:11.738Z", "the owner's LastPlaybackActivity, its update's own second");
  assert.equal(utcFromBinary(639283757228560272n), null, "unspecified (Kind 0)");
  assert.equal(utcFromBinary((2n << 62n) + 639283757228560272n), null, "local (Kind 2)");
  assert.equal(utcFromBinary("not a time"), null);
  assert.equal(utcFromBinary(undefined), null);
});

test("the route: a zone_id or a 400, and the answer as read", async () => {
  const routes = {};
  const asked = [];
  mountRoonDirect({ get: (p, h) => { routes[p] = h; }, post() {} }, /** @type {any} */ ({ status: () => ({}), unmatched: () => [],
    turnOn() {}, turnOff() {}, setProfile: () => ({}), zoneSettings: { read: (id) => (asked.push(id), { native: true, found: false, zone_id: id }) } }));
  const get = async (query) => { const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/roon/zone-settings"]({ query }, res); return [res.code, res.body]; };
  assert.deepEqual(await get({ zone_id: "16aa01" }), [200, { native: true, found: false, zone_id: "16aa01" }]);
  for (const q of [{}, { zone_id: "" }, { zone_id: "zz" }, { zone_id: ["16aa"] }, { zone_id: "a".repeat(65) }]) assert.equal((await get(q))[0], 400, JSON.stringify(q));
  assert.deepEqual(asked, ["16aa01"]);
});
