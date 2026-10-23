"use strict";
// ---------------------------------------------------------------------------
// N3-4 (lib/roon-direct/zone-dsp.js, v1.9.66-t9, native-remote.md §15.9): each DSP item of a zone's outputs read, and
// turned on or off — sent once, believed only when the item shows it. The server here is a stand-in that answers as the
// owner's recordings showed (a DspConfigItem pushed whole, off as IsEnabled left out; a DspConfig pushed only the first
// time a connection asks for it), so it is not evidence of what a server does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P, DSP_PARTS } = require("../../lib/roon-direct/objects");
const { BinaryWriter, BinaryReader } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createZoneDsp, itemOf, PARTS } = require("../../lib/roon-direct/zone-dsp");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

const API = "Sooloos.Broker.Api.";
const ID = "16aa01";
const ITEM = [["bool", "SupportsSetEnabled", P.Bool], ["bool", "IsEnabled", P.Bool], ["HeadroomAdjustmentItem", "HeadroomAdjustment", P.Object],
  ["BS2BItem", "BS2B", P.Object], ["ConvolutionItem", "Convolution", P.Object]];

/**
 * A stand-in server: a zone (oid 10), its output (20), the device (30), its CommonConfig (40), the DspConfig (50) with
 * BeforeItems (51) and Items (52), and three items: Headroom on (61), Crossfeed off (62), Convolution that can't be
 * switched (63). Calls recorded.
 */
function server(o = {}) {
  const g = new ObjectGraph();
  const def = (id, name, members) => g.types.set(id, { id, name: API + name, members: members.map(([t, n, pt]) => ({ name: `${t} ${API}${name}::${n}`, propType: pt })) });
  def(1, "Zone", [["System.Sooid", "ZoneId", P.Sooid]]);
  def(2, "Endpoint", [["System.Sooid", "EndpointId", P.Sooid], ["string", "Name", P.String], ["Zone", "Zone", P.Object], ["Device", "Device", P.Object]]);
  def(3, "SonosAudioDevice", [["string", "Name", P.String], ["Config", "CommonConfig", P.Object]]);
  def(4, "AudioDeviceCommonConfig", [["bool", "SupportsDspConfig", P.Bool]]);
  def(5, "DspConfig", [["List", "BeforeItems", P.Object], ["List", "Items", P.Object], ["bool", "IsEnabled", P.Bool]]);
  def(6, "DspConfigItem", ITEM);
  const st = { 61: { can: true, on: true, part: 3 }, 62: { can: true, on: false, part: 4 }, 63: { can: false, on: true, part: 5 } };
  const calls = [];
  const frame = (cmd, oid, t, put) => { const w = new BinaryWriter().long(oid).flexInt(t); put(w); return { cmd, isResponse: false, body: w.flexInt(0).toBuffer() }; };
  // An item pushed whole, as the owner's server sends it: what is off left out.
  const pushItem = (oid) => g.ingest(frame(5, BigInt(oid), 6, (w) => {
    const it = st[oid];
    if (it.can) w.flexInt(1).boolean(true);
    if (it.on) w.flexInt(2).boolean(true);
    w.flexInt(it.part).long(BigInt(900 + oid));
  }));
  const put = (oid, typeName, fields) => g.objects.set(String(oid), { oid: BigInt(oid), typeName, loaded: true, fields });
  let pushed = false;
  const pushDsp = () => {
    if (!o.noLists) {
      put(51, `${API}DataList<${API}DspConfigItem>`, { $count: 1, $items: [{ $ref: 61n }] });
      put(52, `${API}DataList<${API}DspConfigItem>`, { $count: o.cutShort ? -1 : 2, $items: o.fewer ? [{ $ref: 62n }] : [{ $ref: 62n }, { $ref: 63n }] });
    }
    for (const i of [61, 62, 63]) pushItem(i);
    g.ingest(frame(3, 50n, 5, (w) => { w.flexInt(1).long(51n).flexInt(2).long(52n).flexInt(3).boolean(true); }));
  };
  g.ingest(frame(3, 10n, 1, (w) => { w.flexInt(1).sooid(Buffer.from(ID, "hex")); }));
  g.ingest(frame(3, 40n, 4, (w) => { w.flexInt(1).boolean(true); }));
  g.ingest(frame(3, 30n, 3, (w) => { w.flexInt(1).string("TV Speaker (BEAM)"); if (!o.noConfig) w.flexInt(2).long(40n); }));
  g.ingest(frame(3, 20n, 2, (w) => { w.flexInt(1).sooid(Buffer.from("e1", "hex")).flexInt(2).string("TV Speaker").flexInt(3).long(10n).flexInt(4).long(o.noDevice ? 31n : 30n); }));
  const later = (fn) => { if (!o.deaf) setTimeout(fn, 5); };
  const s = { graph: g, g: {
    uncertain: () => "",
    callNoReply() { throw new Error("nothing here is sent without an answer"); },
    async call(oid, sig, args) {
      calls.push([String(oid), sig.slice(sig.indexOf("::") + 2, sig.indexOf("(")), args.toString("hex")]);
      if (o.closed) throw new Error("connection closed: the link went down");
      if (sig === SIG.dspConfig) {
        if (o.refuseRead) return { success: false, status: "NotSupported" };
        // pushed only the first time this connection asks (§15.9)
        if (!pushed) { pushed = true; pushDsp(); }
        return { success: true, payload: new BinaryWriter().long(50n).toBuffer() };
      }
      if (sig === SIG.dspItemEnabled) {
        if (o.refuse) return { success: false, status: "NotSupported" };
        const on = new BinaryReader(args).boolean();
        later(() => { st[Number(oid)].on = on; pushItem(Number(oid)); });
        return { success: true, payload: Buffer.from([0x00]) };
      }
      throw new Error("not this server's call: " + sig);
    },
  } };
  return { s, st, calls, g };
}
const zd = (s, extra = {}) => createZoneDsp(Object.assign({ link: { session: () => s }, inTurn: (fn) => fn(), on: () => true, waitMs: 200, pollMs: 5, heldMs: 60 }, extra));
const ITEMS = [{ id: "61", name: "Headroom management", on: true, can: true }, { id: "62", name: "Crossfeed", on: false, can: true },
  { id: "63", name: "Convolution", on: true, can: false }];

test("THE one: each item read as MUSE names it, turned off and on, each seen — and read again with no push", async () => {
  const { s, calls, g } = server();
  const d = zd(s);
  assert.deepEqual(await d.read(ID.toUpperCase()), { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items: ITEMS }] });
  assert.deepEqual(await d.set(ID, "61", false), { seen: true, item: { id: "61", name: "Headroom management", on: false, can: true } });
  // the whole item's IsEnabled left out is gone from the graph, not the merged graph's stale true (§15.8)
  assert.equal(Object.keys(g.get(61n).fields).some((k) => k.endsWith("::IsEnabled")), false);
  // asked again on the same connection the server pushes nothing: read from the graph, as it now holds it
  assert.deepEqual((await d.read(ID)).outputs[0].items[0].on, false);
  assert.deepEqual(await d.set(ID, "62", true), { seen: true, item: { id: "62", name: "Crossfeed", on: true, can: true } });
  const sets = calls.filter((x) => x[1] === "SetEnabled");
  assert.deepEqual(sets, [["61", "SetEnabled", "00"], ["62", "SetEnabled", "01"]], "on the item, once each, as the catalogue says");
  assert.equal(calls.filter((x) => x[1] === "GetDspConfig").length, 2, "asked at each read; a change finds its item in what the read found (the review)");
  assert.ok(calls.every((x) => x[0] === "40" || x[1] === "SetEnabled"), "GetDspConfig on the device's CommonConfig");
});

test("not shown in time: said, never sent again; refused, off, closed, unknown or locked item: nothing sent", async () => {
  const deaf = server({ deaf: true });
  const r = await zd(deaf.s).set(ID, "61", false);
  assert.equal(r.seen, false);
  assert.match(r.why, /the item didn't show it within/);
  assert.equal(deaf.calls.filter((x) => x[1] === "SetEnabled").length, 1, "sent once, not again");
  const refused = server({ refuse: true });
  assert.match((await zd(refused.s).set(ID, "61", false)).notSent, /refused it \(NotSupported\)/);
  const plain = server();
  assert.deepEqual(await zd(plain.s, { on: () => false }).set(ID, "61", false), { notSent: "Native mode is off." });
  assert.match((await zd(plain.s).set(ID, "99", true)).notSent, /isn't one of this zone's outputs'/);
  assert.match((await zd(plain.s).set(ID, "63", false)).notSent, /doesn't let this item be turned on or off/);
  assert.match((await zd(plain.s).set("ab12", "61", false)).notSent, /doesn't list that zone/);
  for (const [id, on] of [["x", true], ["61", "yes"], [61, true]]) assert.ok("notSent" in (await zd(plain.s).set(ID, /** @type {any} */ (id), /** @type {any} */ (on))));
  assert.equal(plain.calls.filter((x) => x[1] === "SetEnabled").length, 0, "nothing sent for any of them");
  const closed = server({ closed: true });
  assert.match((await zd(closed.s).set(ID, "61", false)).notSent, /connection closed/, "said as closed, not 'not one of this zone's' (the review)");
});

test("an output not read is said, with why; one whose device shares no settings has no items", async () => {
  assert.match((await zd(server({ noLists: true }).s).read(ID)).outputs[0].why, /hasn't sent all of this output's DSP/);
  assert.match((await zd(server({ cutShort: true }).s).read(ID)).outputs[0].why, /hasn't sent all/, "a list cut short");
  assert.match((await zd(server({ fewer: true }).s).read(ID)).outputs[0].why, /hasn't sent all/, "fewer items than its count (the review)");
  assert.match((await zd(server({ refuseRead: true }).s).read(ID)).outputs[0].why, /refused to say \(NotSupported\)/);
  assert.match((await zd(server({ closed: true }).s).read(ID)).outputs[0].why, /didn't say \(connection closed/);
  assert.deepEqual((await zd(server({ noConfig: true }).s).read(ID)).outputs[0].items, []);
  assert.deepEqual(await zd(server().s, { on: () => false }).read(ID), { native: false, why: "Native mode is off." });
  assert.deepEqual(await zd(server().s).read("ab12"), { native: true, found: false, outputs: [] });
});

test("the review: a change with no read before it reads first; a read holds the turn only for each call, never a wait", async () => {
  const { s, calls } = server();
  assert.deepEqual((await zd(s).set(ID, "62", true)).seen, true, "no read on this connection: read first, then sent");
  assert.deepEqual(calls.map((x) => x[1]), ["GetDspConfig", "SetEnabled"]);
  // the lists never come: the read waits for them, outside the turn, so a change asked meanwhile isn't kept waiting
  const slow = server({ noLists: true });
  let inside = 0, turns = 0;
  const timed = (fn) => { turns++; const t = Date.now(); return fn().finally(() => { inside += Date.now() - t; }); };
  const t0 = Date.now();
  await zd(slow.s, { inTurn: timed, heldMs: 120 }).read(ID);
  assert.ok(Date.now() - t0 >= 120, "it waited for the lists");
  assert.ok(inside < 60, `inside the turn ${inside} ms of it`);
  assert.equal(turns, 2, "the zone, then the output's call: each its own turn");
});

test("an output whose device isn't held yet is said, not taken for one with no DSP", async () => {
  assert.match((await zd(server({ noDevice: true }).s).read(ID)).outputs[0].why, /hasn't sent this output's device yet/);
});

test("an item's name is its part's, as MUSE says it; another part by its own name", () => {
  const it = (fields) => itemOf({ oid: 7n, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`x ${API}DspConfigItem::${k}`, v])) });
  assert.equal(it({ SupportsSetEnabled: true, SampleRateConversion: { $ref: 1n } }).name, "Sample rate conversion");
  assert.equal(it({ OpenHeadphoneDatabase: { $ref: 1n } }).name, "Headphone EQ");
  assert.equal(it({ PEQ: { $ref: 1n } }).name, "Procedural EQ");
  assert.equal(it({ ParametricEqualizer: { $ref: 1n } }).name, "Parametric EQ");
  assert.equal(it({ HeadroomAdjustment: { $type: "HeadroomAdjustmentItem" } }).name, "Headroom management", "a part carried inline (the review)");
  assert.deepEqual(Object.keys(PARTS).sort(), [...DSP_PARTS].sort(), "a name for every part the graph takes as whole");
  assert.deepEqual(it({ SupportsSetEnabled: true, NewThing: { $ref: 1n } }), { id: "7", name: "NewThing", on: false, can: true });
});

test("the graph: a DspConfigItem pushed with its part is whole; one without it is laid over what is held", () => {
  const { g } = server();
  const has = (oid) => Object.keys(g.get(oid).fields).some((k) => k.endsWith("::IsEnabled"));
  const f = (oid, put) => { const w = new BinaryWriter().long(oid).flexInt(6); put(w); return { cmd: 5, isResponse: false, body: w.flexInt(0).toBuffer() }; };
  const can = (oid) => Object.keys(g.get(oid).fields).some((k) => k.endsWith("::SupportsSetEnabled"));
  g.ingest(f(70n, (w) => w.flexInt(1).boolean(true).flexInt(2).boolean(true).flexInt(3).long(5n)));
  g.ingest(f(70n, (w) => w.flexInt(1).boolean(true).flexInt(3).long(5n)));
  assert.equal(has(70n), false, "whole: IsEnabled left out is off");
  // one that can't be switched, turned off, and one that stops being switchable: whole too (the review)
  g.ingest(f(72n, (w) => w.flexInt(2).boolean(true).flexInt(5).long(6n)));
  g.ingest(f(72n, (w) => w.flexInt(5).long(6n)));
  assert.equal(has(72n), false, "a part carried, no SupportsSetEnabled: still whole");
  g.ingest(f(70n, (w) => w.flexInt(3).long(5n)));
  assert.equal(can(70n), false, "SupportsSetEnabled left out: gone");
  g.ingest(f(71n, (w) => w.flexInt(2).boolean(true)));
  g.ingest(f(71n, (w) => w.flexInt(1).boolean(true)));
  assert.equal(has(71n), true, "no part carried: not known whole, laid over what is held");
});

test("the routes: 200 seen, 409 sent and not seen, 503 not sent, 400 refused; the read as zone-dsp answers it", async () => {
  const routes = {};
  const answers = { seen: { seen: true, item: {} }, not: { seen: false, why: "x" }, none: { notSent: "y" } };
  let next = "seen";
  const asked = [];
  mountRoonDirect({ get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } }, /** @type {any} */ ({
    status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, setProfile: () => ({}),
    zoneDsp: { set: async (...a) => (asked.push(a), answers[next]), read: async (id) => ({ native: true, found: true, outputs: [], id }) } }));
  const call = async (m, p, o) => { const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[m + " " + p](o, res); return [res.code, res.body]; };
  for (const [k, code] of [["seen", 200], ["not", 409], ["none", 503]]) {
    next = k;
    assert.equal((await call("POST", "/api/roon/zone-dsp", { body: { zone_id: ID, item: "61", on: true } }))[0], code, k);
  }
  for (const body of [{ zone_id: "zz", item: "61", on: true }, { zone_id: ID, item: 61, on: true }, { zone_id: ID, item: "6a", on: true },
    { zone_id: ID, item: "61", on: "yes" }, { zone_id: ID, on: true }]) {
    assert.equal((await call("POST", "/api/roon/zone-dsp", { body }))[0], 400, JSON.stringify(body));
  }
  assert.deepEqual(asked, [[ID, "61", true], [ID, "61", true], [ID, "61", true]], "only well-formed requests reach it");
  assert.equal((await call("GET", "/api/roon/zone-dsp", { query: {} }))[0], 400);
  assert.deepEqual(await call("GET", "/api/roon/zone-dsp", { query: { zone_id: ID } }), [200, { native: true, found: true, outputs: [], id: ID }]);
});
