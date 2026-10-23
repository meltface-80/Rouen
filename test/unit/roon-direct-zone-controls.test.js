"use strict";
// ---------------------------------------------------------------------------
// N3-3c (lib/roon-direct/zone-controls.js, v1.9.66-t7, native-remote.md §15.7): a zone's crossfade, levelling mode,
// target and sleep timer, and each output's DSP, changed on the server's own objects — each sent once, believed only
// when the server shows it. The server here is a stand-in that answers as the owner's recordings showed (§15.4,
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
  def(2, "Endpoint", [["System.Sooid", "EndpointId", P.Sooid], ["string", "Name", P.String], ["Zone", "Zone", P.Object], ["Device", "Device", P.Object]]);
  def(3, "SonosAudioDevice", [["string", "Name", P.String], ["Config", "CommonConfig", P.Object]]);
  def(4, "AudioDeviceCommonConfig", [["bool", "SupportsDspConfig", P.Bool]]);
  def(5, "DspConfig", [["bool", "IsEnabled", P.Bool]]);
  const st = { crossfade: 0, leveling: 2, target: -14, sleepOn: false, minutes: 30, dsp: true };
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
  const pushDsp = () => {
    g.ingest(frame(3, 50n, 5, (w) => { if (st.dsp) w.flexInt(1).boolean(true); }));
    if (o.stubAfter) g.ingest({ cmd: 4, isResponse: false, body: new BinaryWriter().long(50n).flexInt(5).toBuffer() });   // a stub of it after
  };
  pushZone();
  g.ingest(frame(3, 30n, 3, (w) => { w.flexInt(1).string("TV Speaker (BEAM)").flexInt(2).long(40n); }));
  g.ingest(frame(3, 40n, 4, (w) => { w.flexInt(1).boolean(true); }));
  g.ingest(frame(3, 20n, 2, (w) => { w.flexInt(1).sooid(Buffer.from("e1", "hex")).flexInt(2).string("TV Speaker").flexInt(3).long(10n).flexInt(4).long(30n); }));
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
      if (o.dspFails && sig === SIG.dspConfig) throw new Error("call 7 failed: no answer in 15000 ms");
      const r = new BinaryReader(args);
      if (sig === SIG.zoneSleep) { const on = r.optionalBoolean(); const m = r.optionalInteger(); later(() => { st.sleepOn = on === true; if (m !== null) st.minutes = m; pushZone(); }); }
      if (sig === SIG.dspConfig) { pushDsp(); return { success: true, payload: new BinaryWriter().long(50n).toBuffer() }; }
      if (sig === SIG.dspEnabled && !o.deaf) st.dsp = r.boolean();
      return { success: true, payload: Buffer.from([0x00]) };
    },
  } };
  return { s, st, calls, g };
}
const zc = (s, extra = {}) => createZoneControls(Object.assign({ link: { session: () => s }, inTurn: (fn) => fn(), on: () => true, waitMs: 200, pollMs: 5, dspPollMs: 5 }, extra));

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

test("the review: failed before sending is not sent; a stub never stands for the whole; one output's read failing is said", async () => {
  const closed = server({ closed: true });
  const r = await zc(closed.s).set(ID, { sleep: 30 });
  assert.deepEqual(r, { notSent: "connection closed: the link went down" }, "said as not sent, not 'your server took it'");
  const stub = server({ stubAfter: true });
  assert.deepEqual((await zc(stub.s).readDsp(ID)).outputs[0].dsp, true, "the whole push's on, not the stub's nothing");
  const failing = server({ dspFails: true });
  const d = await zc(failing.s).readDsp(ID);
  assert.deepEqual([d.found, d.outputs[0].dsp], [true, null]);
  assert.match(d.outputs[0].why, /didn't say \(call 7 failed/);
});

test("only what is offered is sent: one change at a time, in range", () => {
  for (const c of [{}, { crossfade: 5, sleep: 30 }, { crossfade: 2.5 }, { crossfade: -1 }, { crossfade: 31 }, { leveling: "loud" },
    { leveling: 2 }, { target: "x" }, { target: 3 }, { sleep: 721 }, { sleep: "30" }]) {
    assert.ok("notSent" in planOf(c), JSON.stringify(c));
  }
});

test("DSP: read from the push that came with the answer, turned off, and seen off — not the merged graph's stale on", async () => {
  const { s, st, calls, g } = server();
  const c = zc(s);
  assert.deepEqual(await c.readDsp(ID), { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", dsp: true }] });
  const r = await c.setDsp(ID, "TV Speaker", false);
  assert.deepEqual(r, { seen: true, dsp: false });
  assert.equal(st.dsp, false);
  assert.deepEqual(calls.filter((x) => x[1] === "SetEnabled"), [["50", "SetEnabled", "00"]], "on the DspConfig, once");
  // what the graph merged still says on: the push with the answer left IsEnabled out, so it was not read from there
  assert.equal(Object.keys(g.get(50n).fields).some((k) => k.endsWith("::IsEnabled")), true);
  assert.match((await c.setDsp(ID, "Kitchen", true)).notSent, /couldn't tell which/);
  const deaf = server({ deaf: true });
  assert.match((await zc(deaf.s).setDsp(ID, "TV Speaker", false)).why, /its DSP didn't show it/);
});

test("the routes: 200 seen, 409 sent and not seen, 503 not sent, 400 refused", async () => {
  const routes = {};
  const answers = { seen: { seen: true, settings: {} }, not: { seen: false, why: "x" }, none: { notSent: "y" } };
  let next = "seen";
  mountRoonDirect({ get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } }, /** @type {any} */ ({
    status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, setProfile: () => ({}),
    zoneControls: { set: async () => answers[next], setDsp: async () => answers[next], readDsp: async (id) => ({ native: true, found: true, outputs: [], id }) } }));
  const call = async (m, p, o) => { const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[m + " " + p](o, res); return [res.code, res.body]; };
  for (const [k, code] of [["seen", 200], ["not", 409], ["none", 503]]) {
    next = k;
    assert.equal((await call("POST", "/api/roon/zone-settings", { body: { zone_id: ID, crossfade: 5 } }))[0], code, k);
    assert.equal((await call("POST", "/api/roon/zone-dsp", { body: { zone_id: ID, output: "TV Speaker", on: true } }))[0], code, k);
  }
  assert.equal((await call("POST", "/api/roon/zone-settings", { body: { zone_id: "zz", crossfade: 5 } }))[0], 400);
  assert.equal((await call("POST", "/api/roon/zone-dsp", { body: { zone_id: ID, output: "TV Speaker", on: "yes" } }))[0], 400);
  assert.equal((await call("GET", "/api/roon/zone-dsp", { query: {} }))[0], 400);
  assert.deepEqual(await call("GET", "/api/roon/zone-dsp", { query: { zone_id: ID } }), [200, { native: true, found: true, outputs: [], id: ID }]);
});
