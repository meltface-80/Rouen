"use strict";
// ---------------------------------------------------------------------------
// N3-3c (lib/roon-direct/zone-controls.js, v1.9.66-t7, native-remote.md §15.7): a zone's crossfade, levelling mode,
// target and sleep timer changed on the server's own Zone — each sent once, believed only when the server shows it.
// t7's DSP on/off is gone in t8 (§15.8). The server here is a stand-in that answers as the owner's recordings showed (§15.4,
// §15.5: a zone pushed whole, a member at its default left out), so it is not evidence of what a server does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter, BinaryReader } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createZoneControls, planOf } = require("../../lib/roon-direct/zone-controls");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

const API = "Sooloos.Broker.Api.";
const ID = "16aa01";
const ZONE_MEMBERS = [["System.Sooid", "ZoneId", P.Sooid], ["int", "CrossFade", P.Int], ["int", "VolumeLeveling", P.Int],
  ["double", "VolumeLevelingTargetLevel", P.Double], ["bool", "IsSleepTimerEnabled", P.Bool], ["int", "SleepTimerDurationMinutes", P.Int]];

/** A stand-in server: its graph, its state, and how it answers each call (recorded). */
function server(o = {}) {
  const g = new ObjectGraph();
  const def = (id, name, members) => g.types.set(id, { id, name: API + name, members: members.map(([t, n, pt]) => ({ name: `${t} ${API}${name}::${n}`, propType: pt })) });
  def(1, "Zone", ZONE_MEMBERS);
  const st = { crossfade: 0, leveling: 2, target: -14, sleepOn: false, minutes: 30 };
  const calls = [];
  const frame = (cmd, oid, t, put) => { const w = new BinaryWriter().long(oid).flexInt(t); put(w); return { cmd, isResponse: false, body: w.flexInt(0).toBuffer() }; };
  // The zone pushed whole, a member at its default left out (§15.4).
  const pushZone = () => g.ingest(frame(5, 10n, 1, (w) => {
    w.flexInt(1).sooid(Buffer.from(ID, "hex"));
    if (st.crossfade) w.flexInt(2).integer(st.crossfade);
    if (st.leveling) w.flexInt(3).integer(st.leveling);
    w.flexInt(4).double(st.target);
    if (st.sleepOn) w.flexInt(5).boolean(true);
    w.flexInt(6).integer(st.minutes);
  }));
  pushZone();
  const later = (fn) => { if (!o.deaf) setTimeout(fn, 5); };
  const s = { graph: g, g: {
    uncertain: () => o.uncertain || "",
    callNoReply(oid, sig, args) {
      calls.push([String(oid), sig.slice(sig.indexOf("::") + 2, sig.indexOf("(")), args.toString("hex")]);
      const r = new BinaryReader(args);
      if (sig === SIG.zoneCrossfade) later(() => { st.crossfade = r.integer(); pushZone(); });
      if (sig === SIG.zoneLeveling) later(() => { st.leveling = r.integer(); pushZone(); });
      if (sig === SIG.zoneLevelTarget) later(() => { st.target = r.double(); pushZone(); });
      return true;
    },
    async call(oid, sig, args) {
      calls.push([String(oid), sig.slice(sig.indexOf("::") + 2, sig.indexOf("(")), args.toString("hex")]);
      if (o.refuse) return { success: false, status: "NotSupported" };
      if (o.closed) throw new Error("connection closed: the link went down");
      const r = new BinaryReader(args);
      if (sig === SIG.zoneSleep) { const on = r.optionalBoolean(); const m = r.optionalInteger(); later(() => { st.sleepOn = on === true; if (m !== null) st.minutes = m; pushZone(); }); }
      return { success: true, payload: Buffer.from([0x00]) };
    },
  } };
  return { s, st, calls, g };
}
const zc = (s, extra = {}) => createZoneControls(Object.assign({ link: { session: () => s }, inTurn: (fn) => fn(), on: () => true, waitMs: 200, pollMs: 5 }, extra));

test("THE one: each setting sent once, as the catalogue says, and believed when the zone shows it", async () => {
  const { s, calls } = server();
  const c = zc(s);
  const cf = await c.set(ID, { crossfade: 5 });
  assert.equal(cf.seen, true);
  assert.deepEqual(cf.settings.crossfade, { on: true, seconds: 5 });
  assert.equal((await c.set(ID, { crossfade: 0 })).settings.crossfade.on, false, "off: CrossFade left out of the whole zone");
  assert.equal((await c.set(ID, { leveling: "auto" })).settings.leveling.mode, "auto");
  assert.equal((await c.set(ID, { leveling: "off" })).settings.leveling.mode, "off");
  assert.equal((await c.set(ID, { target: -18 })).settings.leveling.target, -18);
  const on = await c.set(ID, { sleep: 45 });
  assert.deepEqual([on.seen, on.settings.sleep.on, on.settings.sleep.minutes], [true, true, 45]);
  assert.equal((await c.set(ID, { sleep: 0 })).settings.sleep.on, false);
  assert.deepEqual(calls, [
    ["10", "SetCrossFade", "05"], ["10", "SetCrossFade", "00"],
    ["10", "SetVolumeLeveling", "03"], ["10", "SetVolumeLeveling", "00"],
    ["10", "SetVolumeLevelingTargetLevel", Buffer.from(new Float64Array([-18]).buffer).toString("hex")],
    ["10", "SetSleepTimer", "01012d"],   // on (1), minutes present (1), 45
    ["10", "SetSleepTimer", "0000"],     // off (0), no minutes (0)
  ]);
});

test("not shown in time: said, never sent again; refused, off, unsure, no zone or busy: nothing sent", async () => {
  const deaf = server({ deaf: true });
  const r = await zc(deaf.s).set(ID, { crossfade: 5 });
  assert.equal(r.seen, false);
  assert.match(r.why, /^Your server took it, but the zone didn't show it/);
  assert.equal(deaf.calls.length, 1, "sent once");
  assert.match((await zc(server({ refuse: true }).s).set(ID, { sleep: 30 })).notSent, /refused it \(NotSupported\)/);
  assert.deepEqual(await zc(server().s, { on: () => false }).set(ID, { crossfade: 5 }), { notSent: "Native mode is off." });
  assert.match((await zc(server({ uncertain: "x" }).s).set(ID, { crossfade: 5 })).notSent, /being checked/);
  assert.match((await zc(server().s).set("abcd", { crossfade: 5 })).notSent, /doesn't list that zone/);
  const busy = server();
  const late = await zc(busy.s, { inTurn: () => new Promise(() => {}), turnMs: 20 }).set(ID, { crossfade: 5 });
  assert.match(late.notSent, /busy/);
  assert.equal(busy.calls.length, 0);
  // the turn comes after all, too late: given up, so nothing is sent then either
  const slow = server();
  const gaveUp = await zc(slow.s, { inTurn: (fn) => new Promise((res) => { setTimeout(() => res(fn()), 40); }), turnMs: 10 }).set(ID, { crossfade: 5 });
  assert.match(gaveUp.notSent, /busy/);
  await new Promise((res) => { setTimeout(res, 80); });
  assert.equal(slow.calls.length, 0, "not sent when the turn came late");
});

test("the review: failed before sending is not sent", async () => {
  const closed = server({ closed: true });
  const r = await zc(closed.s).set(ID, { sleep: 30 });
  assert.deepEqual(r, { notSent: "connection closed: the link went down" }, "said as not sent, not 'your server took it'");
});

test("only what is offered is sent: one change at a time, in range", () => {
  for (const c of [{}, { crossfade: 5, sleep: 30 }, { crossfade: 2.5 }, { crossfade: -1 }, { crossfade: 31 }, { leveling: "loud" },
    { leveling: 2 }, { target: "x" }, { target: 3 }, { sleep: 721 }, { sleep: "30" }]) {
    assert.ok("notSent" in planOf(c), JSON.stringify(c));
  }
});

test("the routes: 200 seen, 409 sent and not seen, 503 not sent, 400 refused", async () => {
  const routes = {};
  const answers = { seen: { seen: true, settings: {} }, not: { seen: false, why: "x" }, none: { notSent: "y" } };
  let next = "seen";
  mountRoonDirect({ get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } }, /** @type {any} */ ({
    status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, setProfile: () => ({}),
    zoneControls: { set: async () => answers[next] } }));
  const call = async (m, p, o) => { const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[m + " " + p](o, res); return [res.code, res.body]; };
  for (const [k, code] of [["seen", 200], ["not", 409], ["none", 503]]) {
    next = k;
    assert.equal((await call("POST", "/api/roon/zone-settings", { body: { zone_id: ID, crossfade: 5 } }))[0], code, k);
  }
  assert.equal((await call("POST", "/api/roon/zone-settings", { body: { zone_id: "zz", crossfade: 5 } }))[0], 400);
  // t7's DSP master is gone (§15.8): its request, an output and on, is refused before anything is asked; the route is
  // t9's, each item (§15.9, roon-direct-zone-dsp.test.js)
  assert.equal((await call("POST", "/api/roon/zone-dsp", { body: { zone_id: ID, output: "TV Speaker", on: false } }))[0], 400);
});
