"use strict";
// ---------------------------------------------------------------------------
// N3-5c (v1.9.66-t15, native-remote.md §15.15): a Parametric EQ in the DSP window — its bands as shown and one band's
// setting changed on them (peq-spec.js), the spec read afresh on a connection of its own (peq-fresh.js), and a change
// made on the spec as it is now, sent once and believed only when a read afterwards shows it (peq.js), and the route.
// The server's declarations and bands are built here as the owner's reads showed them (§15.13–14); not evidence.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { plainOf, bandsOf, check, changed, shows, valueOf } = require("../../lib/roon-direct/peq-spec");
const { createFreshPeq } = require("../../lib/roon-direct/peq-fresh");
const { createPeq } = require("../../lib/roon-direct/peq");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

const API = "Sooloos.Broker.Api.";
const B = (m) => `${API}ParametricEqualizerBand::${m}`;
const BANDS = `System.Collections.Generic.IList<${API}ParametricEqualizerBand> ${API}ParametricEqualizerSpec::Bands`;
const SPEC_KEY = `x ${API}ParametricEqualizerItem::Spec`;
const BAND_MEMBERS = [[`string ${B("Type")}`, P.String], [`double ${B("Frequency")}`, P.Double], [`double ${B("GainDb")}`, P.Double],
  [`double ${B("Q")}`, P.Double], [`int ${B("Order")}`, P.Int], [`bool ${B("IsEnabled")}`, P.Bool]];
const SPEC_MEMBERS = [[`double ${API}ParametricEqualizerSpec::GainDb`, P.Double], [BANDS, P.LengthPrefixed]];
// the owner's TV Speaker, as read (§15.14): band 1 a low shelf, 2 a peak, 3 a band stop, 4 a high pass at its default (off)
const OWNERS = [{ Type: "low_shelf", Q: 1, GainDb: -9, Frequency: 178, IsEnabled: true }, { Type: "equalize_frequency", Q: 1, GainDb: -11.8, Frequency: 386, IsEnabled: true },
  { Type: "band_stop", Q: 3.3, GainDb: -3.6, Frequency: 1703, IsEnabled: true }, { Type: "high_pass", Frequency: 20, Order: 1 }];

/** The server's declarations, under its own ids. */
function declare(g) {
  g.types.set(60, { id: 60, name: API + "ParametricEqualizerSpec", members: SPEC_MEMBERS.map(([name, propType]) => ({ name, propType })) });
  g.types.set(61, { id: 61, name: API + "ParametricEqualizerBand", members: BAND_MEMBERS.map(([name, propType]) => ({ name, propType })) });
  return g;
}
/** A band as the server sends it: an inline value of its type 61, its members sparse. */
function band(fields) {
  const m = new BinaryWriter();
  for (const [k, v] of Object.entries(fields)) {
    const i = BAND_MEMBERS.findIndex(([n]) => n.endsWith("::" + k));
    m.flexInt(i + 1);
    const t = BAND_MEMBERS[i][1];
    if (t === P.String) m.string(v); else if (t === P.Double) m.double(v); else if (t === P.Int) m.integer(v); else m.boolean(v);
  }
  const b = m.flexInt(0).toBuffer();
  return new BinaryWriter().long(1n).integer(61).integer(b.length).bytes(b).toBuffer();
}
/** The spec as a graph holds it: an inline value, its bands a list's bytes. */
function specOf(bands = OWNERS, gain = -3.1) {
  const l = new BinaryWriter().integer(bands.length);
  for (const x of bands) l.bytes(band(x));
  return { $type: API + "ParametricEqualizerSpec", [SPEC_MEMBERS[0][0]]: gain, [BANDS]: l.toBuffer() };
}
/** The same spec as plain data. */
const plain = (bands, gain) => { const g = declare(new ObjectGraph()); return plainOf(g, SPEC_KEY, specOf(bands, gain), true); };

test("peq-spec: the bands as the window shows them — each type's settings, a value left out at its default", () => {
  const v = bandsOf(plain());
  assert.deepEqual(v.map((b) => [b.n, b.label, b.frequency, b.gain, b.q, b.order, b.on]), [[1, "Low shelf", 178, -9, 1, null, true],
    [2, "Peak/dip", 386, -11.8, 1, null, true], [3, "Band stop", 1703, -3.6, 3.3, null, true], [4, "High pass", 20, 0, null, 1, false]]);
  assert.deepEqual(v[2].can, { gain: false, frequency: true, q: true, on: true }, "a band stop: a Q, no gain (as MUSE shows it)");
  assert.deepEqual(v[3].can, { gain: false, frequency: true, q: false, on: true }, "a high pass: its frequency and on, its slope shown");
  assert.equal(valueOf(plain(), 4, "on"), false, "IsEnabled left out: off");
  assert.equal(valueOf(plain(), 9, "gain"), undefined);
});

test("peq-spec: a change within the owner's bounds on its grid, of the band's own type; the member as the server named it", () => {
  const s = plain();
  assert.equal(check(s, 2, "gain", -11), null);
  assert.equal(check(s, 1, "frequency", 189), null);
  assert.equal(check(s, 3, "q", 3.4), null);
  assert.equal(check(s, 4, "on", true), null);
  assert.match(check(s, 2, "gain", 24.5), /Gain is -24 dB to 24 dB/);
  assert.match(check(s, 2, "gain", -11.05), /in 0\.1 dB/);
  assert.match(check(s, 1, "frequency", 19), /Frequency is 20 Hz to 20000 Hz/);
  assert.match(check(s, 1, "frequency", 178.5), /in 1 Hz/);
  assert.match(check(s, 3, "q", 0), /Q is 0\.1 to 10/);
  assert.match(check(s, 3, "gain", 1), /A Band stop band has no gain/);
  assert.match(check(s, 4, "q", 1), /A High pass band has no Q/);
  assert.match(check(s, 5, "gain", 1), /has 4 bands/);
  assert.match(check(s, 1, "on", 1), /On or off/);
  assert.match(check(s, 1, "hue", 1), /Which setting/);
  const g = declare(new ObjectGraph());
  const next = changed(g, s, 4, "on", true);   // IsEnabled left out of band 4: the member the server declared
  assert.equal(next[BANDS][3][`bool ${B("IsEnabled")}`], true);
  assert.equal(s[BANDS][3][`bool ${B("IsEnabled")}`], undefined, "a copy: the spec read is left as it was");
  assert.deepEqual(next[BANDS].slice(0, 3), s[BANDS].slice(0, 3), "every other band as it was");
  assert.equal(shows(next, 4, "on", true), true);
  assert.equal(shows(changed(g, s, 2, "gain", 0), 2, "gain", 0), true);
  assert.equal(shows(plain(OWNERS.map((b, i) => (i === 1 ? Object.assign({}, b, { GainDb: undefined }) : b)).map((b) => JSON.parse(JSON.stringify(b)))), 2, "gain", 0), true,
    "a gain left out reads as 0 dB");
  assert.throws(() => changed(g, s, 3, "gain", 1), /no gain/);
});

/** A stand-in server for a fresh connection: the root's profile and library, the output's settings, its DSP on asking. */
function freshServer(o = {}) {
  const opened = [];
  let open = 0, most = 0;
  const connect = async () => {
    const g = declare(new ObjectGraph());
    const put = (oid, typeName, fields) => { const x = { oid: BigInt(oid), typeName: API + typeName, loaded: true, fields }; g.objects.set(String(oid), x); g.onObject(x); };
    const session = { graph: g, closed: false, remoting: {
      async getService() { put(1, "Profile", { [`x ${API}Profile::ProfileId`]: Buffer.from("aa", "hex") }); put(2, "Library", {}); if (!o.noConfig) put(592148, "AudioDeviceCommonConfig", {}); },
      async call(oid, sig) {
        opened[opened.length - 1].calls.push([String(oid), sig]);
        if (o.refuse) return { success: false, status: "NotSupported" };
        if (!o.noPart) setTimeout(() => put(1344111, "ParametricEqualizerItem", { [SPEC_KEY]: specOf(o.bands || OWNERS, o.gain) }), 5);
        return { success: true, payload: Buffer.from([0]) };
      },
      defineType: () => 1 } };
    session.close = () => { if (!session.closed) open--; session.closed = true; };
    open++; most = Math.max(most, open);
    opened.push({ session, calls: [] });
    if (o.throws) throw new Error(o.throws);
    return { session, tried: [], used: "x" };
  };
  const fresh = createFreshPeq({ core: () => (o.unpaired ? null : { host: "192.168.0.57", coreId: "c0ffee00-0000-0000-0000-000000000000" }), connect, settleMs: 1500 });
  return { fresh, opened, most: () => most };
}

test("peq-fresh: the spec read on a connection of its own — asked for the output's DSP, read whole, then closed", async () => {
  const f = freshServer();
  const r = await f.fresh.read("592148", "1344111");
  assert.deepEqual(bandsOf(r.spec).map((b) => b.gain), [-9, -11.8, -3.6, 0]);
  assert.equal(f.opened.length, 1);
  assert.deepEqual(f.opened[0].calls, [["592148", SIG.dspConfig]], "one read: the output's DSP, on the allowlist");
  assert.equal(f.opened[0].session.closed, true, "closed once read");
  // the same read asked again before it starts: shared, one connection (the review: a panel opened and closed again)
  const a = f.fresh.read("592148", "1344111"), b = f.fresh.read("592148", "1344111");
  assert.equal(a, b, "one read for both");
  await a;
  assert.equal(f.opened.length, 2);
  // asked once one has started: a read of its own, after it — never two open at once
  const c = f.fresh.read("592148", "1344111");
  await new Promise((r) => { setTimeout(r, 10); });
  const d = f.fresh.read("592148", "1344111");
  assert.notEqual(c, d, "started: a new ask is a new read (a read after a change begins after it)");
  assert.ok((await c).spec && (await d).spec);
  assert.equal(f.opened.length, 4);
  assert.equal(f.most(), 1, "never two open at once");
});

test("peq-fresh: a read past its bound is said too slow, its connection closed; the next read goes ahead", async () => {
  const opened = [];
  const connect = async () => {
    const session = { graph: new ObjectGraph(), closed: false, close() { session.closed = true; },
      remoting: { getService: () => new Promise(() => {}), call: async () => ({ success: true }), defineType: () => 1 } };   // the root never comes
    opened.push(session);
    return { session, tried: [], used: "x" };
  };
  const fresh = createFreshPeq({ core: () => ({ host: "h", coreId: "c0ffee00-0000-0000-0000-000000000000" }), connect, settleMs: 1500, totalMs: 60 });
  const r = await fresh.read("592148", "1344111");
  assert.match(r.why, /took more than 0 s to send the EQ|took more than/);
  assert.equal(opened[0].closed, true, "closed when past its bound");
  const r2 = await fresh.read("592148", "1344111");
  assert.match(r2.why, /took more than/);
  assert.equal(opened.length, 2, "the next read ran");
});

test("peq-fresh: not paired, refused, never sent, read short or failing — each said, and the connection closed", async () => {
  assert.match((await freshServer({ unpaired: true }).fresh.read("592148", "1344111")).why, /isn't paired/);
  const refused = freshServer({ refuse: true });
  assert.match((await refused.fresh.read("592148", "1344111")).why, /refused to say \(NotSupported\)/);
  assert.equal(refused.opened[0].session.closed, true);
  assert.match((await freshServer({ noConfig: true }).fresh.read("592148", "1344111")).why, /didn't send this output's settings/);
  assert.match((await freshServer({ noPart: true }).fresh.read("592148", "1344111")).why, /didn't send this Parametric EQ/);
  assert.match((await freshServer({ throws: "the Core refused" }).fresh.read("592148", "1344111")).why, /couldn't read the EQ from your server \(the Core refused\)/);
});

/**
 * peq.js on a stand-in: the link's graph with the server's declarations and the item naming its EQ; fresh reads
 * scripted, before and after; the link's calls recorded.
 */
function rig(o = {}) {
  const g = declare(new ObjectGraph());
  g.objects.set("1335852", { oid: 1335852n, typeName: API + "DspConfigItem", loaded: true, fields: { [`x ${API}DspConfigItem::ParametricEqualizer`]: { $ref: 1344111n } } });
  g.objects.set("5", { oid: 5n, typeName: API + "DspConfigItem", loaded: true, fields: { [`x ${API}DspConfigItem::BS2B`]: { $ref: 6n } } });
  const declared = new Map(), calls = [], reads = [], events = [];
  const s = { graph: g, g: { uncertain: () => "",
    defineType(name, members) { if (!declared.has(name)) declared.set(name, { id: 1000 + declared.size, name, members }); return declared.get(name).id; },
    async call(oid, sig, args) { calls.push({ oid, sig, args }); events.push("send"); if (o.throws) throw new Error(o.throws); return o.refuse ? { success: false, status: "InvalidRequest" } : { success: true }; } } };
  const specs = (o.reads || [plain(), null]).slice();
  const fresh = { read: async (cfg, part) => { reads.push([cfg, part]); events.push("read"); await new Promise((r) => { setTimeout(r, 5); }); const x = specs.shift(); return x ? (x.why ? x : { spec: x }) : { spec: sentSpec() }; } };
  /** What the link sent, read back: the spec the server would then hold. */
  function sentSpec() {
    const scratch = new ObjectGraph();
    for (const d of declared.values()) scratch.types.set(d.id, { id: d.id, name: d.name, members: d.members });
    return plainOf(scratch, "", scratch.readValue(new BinaryReader(calls[calls.length - 1].args), P.Object));
  }
  const zoneDsp = { locate: async () => (o.locate || { here: true, common: "592148" }) };
  const peq = createPeq({ zoneDsp, fresh, link: { session: () => s }, inTurn: (fn) => fn(), on: () => !o.off });
  return { peq, calls, reads, sentSpec, events };
}

test("peq: THE one — read afresh, changed on the spec as it is now, sent once whole, believed only when read afterwards", async () => {
  // MUSE changed band 1 since the link read the EQ: the change is made on the spec read now, so band 1 isn't put back
  const now = plain(OWNERS.map((b, i) => (i === 0 ? Object.assign({}, b, { GainDb: -6 }) : b)));
  const r = rig({ reads: [now, null] });
  const out = await r.peq.set("16aa01", "1335852", 2, "gain", -11);
  assert.equal(out.seen, true);
  assert.deepEqual(out.item.bands.map((b) => b.gain), [-6, -11, -3.6, 0], "band 2 as sent; band 1 as MUSE left it");
  assert.equal(out.item.gain, -3.1, "the EQ's own gain as it was");
  assert.deepEqual(r.reads, [["592148", "1344111"], ["592148", "1344111"]], "read before and after, on the output's settings");
  assert.equal(r.calls.length, 1, "sent once");
  assert.equal(r.calls[0].oid, 1344111n);
  assert.equal(r.calls[0].sig, SIG.dspPeqSpec);
  assert.equal(r.calls[0].args[r.calls[0].args.length - 1], 1, "saved: the bool true (§15.14)");
  // two changes to one EQ close together: one after the other, read to read — the second made on the first's result
  const two = rig({ reads: [plain(), null, null, null] });
  const [x, y] = await Promise.all([two.peq.set("16aa01", "1335852", 2, "gain", -11), two.peq.set("16aa01", "1335852", 1, "gain", -8)]);
  assert.deepEqual(two.events, ["read", "send", "read", "read", "send", "read"], "never both read before either is sent (the review)");
  assert.equal(x.seen && y.seen, true);
  assert.deepEqual(y.item.bands.map((b) => b.gain).slice(0, 2), [-8, -11], "the first change kept by the second");
  const read = await rig().peq.read("16aa01", "1335852");
  assert.deepEqual(read.item.bands.map((b) => b.label), ["Low shelf", "Peak/dip", "Band stop", "High pass"]);
});

test("peq: not shown afterwards, not read, refused, never taken — each said; a bad change or a wrong item never sent", async () => {
  const unchanged = rig({ reads: [plain(), plain()] });
  const u = await unchanged.peq.set("16aa01", "1335852", 2, "gain", -11);
  assert.equal(u.seen, false);
  assert.match(u.why, /doesn't show it/);
  assert.equal(u.item.bands[1].gain, -11.8, "shown as the server holds it");
  const unread = rig({ reads: [plain(), { why: "Your server didn't take a second connection to read the EQ." }] });
  assert.match((await unread.peq.set("16aa01", "1335852", 2, "gain", -11)).why, /Sent, but your server didn't take a second connection/);
  assert.match((await rig({ refuse: true }).peq.set("16aa01", "1335852", 2, "gain", -11)).notSent, /refused it \(InvalidRequest\)/);
  const maybe = await rig({ throws: "no answer in 5 s", reads: [plain(), plain()] }).peq.set("16aa01", "1335852", 2, "gain", -11);
  assert.equal(maybe.seen, false);
  assert.match(maybe.why, /no answer in 5 s/);
  for (const [o, args, why] of [[{}, [2, "gain", 30], /Gain is/], [{}, [3, "gain", 1], /no gain/], [{}, [2, "hue", 1], /Which setting/],
    [{ reads: [{ why: "Rouen isn't paired with your server." }] }, [2, "gain", -11], /isn't paired/], [{ off: true }, [2, "gain", -11], /Native mode is off/],
    [{ locate: { notSent: "That DSP item isn't one of this zone's outputs' now." } }, [2, "gain", -11], /isn't one of this zone's/],
    [{ locate: { here: true } }, [2, "gain", -11], /which output/]]) {
    const r = rig(o);
    const out = await r.peq.set("16aa01", "1335852", ...args);
    assert.match(out.notSent, why);
    assert.equal(r.calls.length, 0, String(why));
    // a request that can't be met is said so (400 at the route), apart from the server being out of reach (the review)
    assert.equal(!!out.invalid, /Gain is|no gain|Which setting/.test(String(why)), String(why));
  }
  const notPeq = rig();
  assert.match((await notPeq.peq.set("16aa01", "5", 1, "gain", 1)).notSent, /isn't a Parametric EQ/);
  assert.match((await notPeq.peq.read("16aa01", "5")).why, /isn't a Parametric EQ/);
  assert.equal((await notPeq.peq.read("16aa01", "5")).invalid, true);
});

test("the route: a read 200 or 503; a change 200 seen, 409 not seen, 503 not sent, 400 refused", async () => {
  const routes = {};
  const answers = { seen: { seen: true, item: {} }, not: { seen: false, why: "x" }, none: { notSent: "y" }, bad: { notSent: "Gain is", invalid: true } };
  let next = "seen";
  const asked = [];
  mountRoonDirect({ get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } }, /** @type {any} */ ({
    status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, setProfile: () => ({}),
    peq: { set: async (...a) => (asked.push(a), answers[next]),
      read: async (z, i) => (i === "1" ? { item: { bands: [] } } : i === "5" ? { why: "That DSP item isn't a Parametric EQ.", invalid: true } : { why: "no" }) } }));
  const res = () => ({ code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const post = async (body) => { const r = res(); await routes["POST /api/roon/zone-dsp/peq"]({ body }, r); return r.code; };
  const get = async (query) => { const r = res(); await routes["GET /api/roon/zone-dsp/peq"]({ query }, r); return r.code; };
  assert.equal(await get({ zone_id: "16aa01", item: "1" }), 200);
  assert.equal(await get({ zone_id: "16aa01", item: "2" }), 503);
  assert.equal(await get({ zone_id: "16aa01" }), 400);
  assert.equal(await get({ zone_id: "16aa01", item: "5" }), 400, "not an EQ: the request's, not the server out of reach");
  for (const [k, code] of [["seen", 200], ["not", 409], ["none", 503], ["bad", 400]]) {
    next = k;
    assert.equal(await post({ zone_id: "16aa01", item: "1335852", band: 2, setting: "gain", value: -11 }), code, k);
  }
  next = "none";
  assert.equal(await post({ zone_id: "16aa01", item: "1335852", band: 4, setting: "on", value: true }), 503);
  for (const body of [{ zone_id: "zz", item: "1", band: 1, setting: "gain", value: 1 }, { zone_id: "16aa01", item: 1, band: 1, setting: "gain", value: 1 },
    { zone_id: "16aa01", item: "1", band: 0, setting: "gain", value: 1 }, { zone_id: "16aa01", item: "1", band: 1.5, setting: "gain", value: 1 },
    { zone_id: "16aa01", item: "1", band: 1, setting: 5, value: 1 }, { zone_id: "16aa01", item: "1", band: 1, setting: "gain", value: "1" },
    { zone_id: "16aa01", item: "1", band: 1, setting: "gain", value: Infinity }]) {
    assert.equal(await post(body), 400, JSON.stringify(body));
  }
  assert.equal(asked.length, 5, "nothing refused reaches the EQ");
});
