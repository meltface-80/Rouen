"use strict";
// ---------------------------------------------------------------------------
// N3-5b (lib/roon-direct/peq-try.js, v1.9.66-t14, native-remote.md §15.14): one Parametric EQ band's gain, tried by
// hand — previewed with the bands Rouen holds, or sent once as the whole spec, written with the members the server
// declared, read back before it is sent, and what came back said. The server's declarations and bands are built here
// as the owner's read showed them (§15.13); they are not evidence of what a real server takes (the owner's try is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createPeqTry } = require("../../lib/roon-direct/peq-try");
const { plainOf } = require("../../lib/roon-direct/peq-spec");

const API = "Sooloos.Broker.Api.";
const B = (m) => `${API}ParametricEqualizerBand::${m}`;
const BANDS = `System.Collections.Generic.IList<${API}ParametricEqualizerBand> ${API}ParametricEqualizerSpec::Bands`;
const BAND_MEMBERS = [[`string ${B("Type")}`, P.String], [`double ${B("Frequency")}`, P.Double], [`double ${B("GainDb")}`, P.Double],
  [`double ${B("Q")}`, P.Double], [`int ${B("Order")}`, P.Int], [`bool ${B("IsEnabled")}`, P.Bool]];
const SPEC_MEMBERS = [[`double ${API}ParametricEqualizerSpec::YAxisMinDb`, P.Double], [`double ${API}ParametricEqualizerSpec::GainDb`, P.Double], [BANDS, P.LengthPrefixed]];

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
const OWNERS = [{ Type: "low_shelf", Q: 1, GainDb: -14.8, Frequency: 99, IsEnabled: true }, { Type: "equalize_frequency", Q: 1, GainDb: -11.8, Frequency: 386, IsEnabled: true },
  { Type: "high_pass", Frequency: 20, Order: 1, IsEnabled: true }];

/** The owner's TV Speaker, as its read showed it: a DspConfigItem (1335852) naming its Parametric EQ (1344111). */
function rig(opts = {}) {
  const g = new ObjectGraph();
  // the same short name in the other namespace, declared first, with other members: never taken for the server's (the review)
  if (opts.decoy) g.types.set(59, { id: 59, name: "Roon.Broker.Api.ParametricEqualizerBand", members: [{ name: "string Roon.Broker.Api.ParametricEqualizerBand::Odd", propType: P.String }] });
  g.types.set(60, { id: 60, name: API + "ParametricEqualizerSpec", members: SPEC_MEMBERS.map(([name, propType]) => ({ name, propType })) });
  g.types.set(61, { id: 61, name: API + "ParametricEqualizerBand", members: BAND_MEMBERS.map(([name, propType]) => ({ name, propType })) });
  const list = opts.bands || OWNERS.map(band);
  const bands = new BinaryWriter().integer(list.length);
  for (const x of list) bands.bytes(x);
  const spec = Object.assign({ $type: API + "ParametricEqualizerSpec", [SPEC_MEMBERS[0][0]]: -24, [SPEC_MEMBERS[1][0]]: -3.1, [BANDS]: bands.toBuffer() }, opts.extra || {});
  g.objects.set("1335852", { oid: 1335852n, typeName: API + "DspConfigItem", loaded: true, fields: { [`x ${API}DspConfigItem::ParametricEqualizer`]: { $ref: 1344111n } } });
  const part = { oid: 1344111n, typeName: API + "ParametricEqualizerItem", loaded: true, fields: { [`x ${API}ParametricEqualizerItem::Spec`]: spec } };
  g.objects.set("1344111", part);
  const declared = new Map();
  const calls = [];
  const s = { graph: g, g: {
    uncertain: () => "",
    defineType(name, members) {
      const schema = JSON.stringify(members.map((m) => [m.name, m.propType]));
      if (!declared.has(name)) declared.set(name, { id: 1000 + declared.size, name, members, schema });
      assert.equal(declared.get(name).schema, schema, "a type declared again with other members");
      return declared.get(name).id;
    },
    async call(oid, sig, args) {
      calls.push({ oid, sig, args });
      if (opts.throws) throw new Error(opts.throws);
      // the server's own update of the part, as it might come back (§15.14 is to say whether it does)
      if (opts.pushBack) setTimeout(() => { for (const w of g.watchers) w(part, { [`x ${API}ParametricEqualizerItem::Spec`]: spec }, 5); }, 5);
      return opts.refuse ? { success: false, status: "InvalidRequest" } : { success: true };
    },
  } };
  const items = opts.twoPeqs ? [{ id: "1335852", name: "Parametric EQ" }, { id: "9", name: "Parametric EQ" }] : [{ id: "1335852", name: "Parametric EQ" }, { id: "5", name: "Crossfeed" }];
  const zoneDsp = { read: async () => opts.read || { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items }] } };
  const peq = createPeqTry({ zoneDsp, link: { session: () => s }, inTurn: (fn) => fn(), on: () => true, waitMs: 40,
    zones: () => [{ zone_id: "16aa01", display_name: "TV Speaker" }] });
  return { g, peq, calls, declared };
}

/** What was sent, read back as our declarations say: the spec as plain data, and the bool after it. */
function sentOf(r, args) {
  const scratch = new ObjectGraph();
  for (const d of r.declared.values()) scratch.types.set(d.id, { id: d.id, name: d.name, members: d.members });
  const rd = new BinaryReader(args);
  const spec = plainOf(scratch, "", scratch.readValue(rd, P.Object));
  return { spec, save: rd.boolean(), left: rd.remaining };
}

test("THE one: previewed with the bands held, nothing sent; then sent once — the whole spec, one band's gain changed, and what came back said", async () => {
  const r = rig({ pushBack: true });
  const pre = await r.peq.run({ zone: "TV Speaker", band: 1, gain: -9, save: true, send: false });
  assert.equal(pre.sent, false);
  assert.equal(r.calls.length, 0, "a preview sends nothing");
  assert.deepEqual(pre.change, { before: { band: 1, type: "low_shelf", frequency: 99, gainDb: -14.8, q: 1, on: true }, gainDb: -9 });
  assert.equal(pre.held.Bands.items.length, 3, "the bands held, to be compared with MUSE");
  assert.match(pre.next, /Compare the bands held with MUSE/);
  assert.equal(r.declared.size, 0, "a preview declares nothing on the connection either (the review)");
  assert.deepEqual(pre.sends.Bands[0], { $type: "ParametricEqualizerBand", Type: "low_shelf", Q: 1, GainDb: -9, Frequency: 99, IsEnabled: true },
    "the spec it would send, to be read beside what is held");

  const out = await r.peq.run({ zone: "16aa01", band: 1, gain: -9, save: true, send: true });
  assert.equal(out.sent, true);
  assert.equal(out.answer, "taken");
  assert.equal(r.calls.length, 1, "sent once");
  assert.equal(r.calls[0].oid, 1344111n, "on the Parametric EQ's own part");
  assert.equal(r.calls[0].sig, SIG.dspPeqSpec);
  const { spec, save, left } = sentOf(r, r.calls[0].args);
  assert.equal(save, true);
  assert.equal(left, 0);
  const bands = spec[BANDS];
  assert.equal(bands[0][`double ${B("GainDb")}`], -9, "band 1's gain as asked");
  assert.deepEqual(bands.slice(1), plainOf(r.g, BANDS, r.g.get(1344111n).fields[`x ${API}ParametricEqualizerItem::Spec`][BANDS]).slice(1), "every other band as held");
  assert.equal(spec[SPEC_MEMBERS[1][0]], -3.1, "the spec's own gain as held");
  assert.equal(r.declared.get(API + "ParametricEqualizerBand").members.length, BAND_MEMBERS.length, "the server's own member list, whole");
  assert.equal(out.cameBack.length, 1, "the part's update that came back, said");
  assert.equal(out.cameBack[0].object, "ParametricEqualizerItem 1344111");
  assert.match(out.next, /Check MUSE/);
  assert.equal(r.g.watchers.size, 0, "the watch let go");

  const quiet = rig();
  const q = await quiet.peq.run({ zone: "TV Speaker", band: 2, gain: 0, save: false, send: true });
  assert.match(q.cameBack, /Nothing came back/);
  assert.equal(sentOf(quiet, quiet.calls[0].args).save, false, "save=0: the bool sent false");
});

test("refused before anything is sent: a band with no gain, past the bands, a gain out of range, no such zone, two EQs, a value it can't write", async () => {
  const r = rig();
  assert.match((await r.peq.run({ zone: "TV Speaker", band: 3, gain: 1, save: true, send: true })).notSent, /A High pass band has no gain/);
  assert.match((await r.peq.run({ zone: "TV Speaker", band: 4, gain: 1, save: true, send: true })).notSent, /has 3 bands/);
  assert.match((await r.peq.run({ zone: "TV Speaker", band: 1, gain: 30, save: true, send: true })).notSent, /Gain is -24 dB to 24 dB/);
  assert.match((await r.peq.run({ zone: "TV Speaker", band: 1, gain: 1.25, save: true, send: true })).notSent, /in 0\.1 dB/);
  assert.match((await r.peq.run({ zone: "TV Speaker", band: 1, gain: NaN, save: true, send: true })).error, /gain takes dB/);
  assert.match((await r.peq.run({ zone: "TV Speaker", band: 0, gain: 1, save: true, send: true })).error, /band takes/);
  assert.match((await r.peq.run({ zone: "Kitchen", band: 1, gain: 1, save: true, send: true })).error, /No zone called Kitchen/);
  assert.equal(r.calls.length, 0);
  const two = rig({ twoPeqs: true });
  assert.match((await two.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: true })).error, /more than one Parametric EQ/);
  // a member of a type the server never declared: refused, never guessed
  const odd = rig({ extra: { [`x ${API}ParametricEqualizerSpec::Odd`]: { $inline: 99 } } });
  assert.match((await odd.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: true })).notSent, /never declared/);
  assert.equal(odd.calls.length, 0);
});

test("sent and refused, or never taken: each said; a connection closed is not sent; neither is waited on, nor said to check", async () => {
  const refused = rig({ refuse: true });
  const rf = await refused.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: true });
  assert.equal(rf.answer, "refused (InvalidRequest)");
  assert.equal(rf.cameBack, undefined, "refused: not waited on (the review)");
  assert.doesNotMatch(rf.next || "", /Check MUSE/);
  assert.equal(refused.g.watchers.size, 0, "the watch let go");
  const closed = rig({ throws: "connection closed: gone" });
  const c = await closed.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: true });
  assert.equal(c.sent, false);
  assert.match(c.notSent, /connection closed/);
  assert.doesNotMatch(c.next || "", /Check MUSE/, "nothing sent: not said to be checked (the review)");
  assert.equal(closed.g.watchers.size, 0);
  const lost = rig({ throws: "no answer in 5 s" });
  const l = await lost.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: true });
  assert.equal(l.sent, true, "an answer that never came: maybe taken, said");
  assert.match(l.maybe, /no answer/);
});

// the review: a band read short is never sent back short; a band empty or without its type said; the zone's DSP not
// read said as such; the server's own declaration taken by its full name
test("the review: bands not read whole, empty or typeless refused; a DSP not read said; the server's declaration by its full name", async () => {
  // a member index the band's type doesn't declare: the reader stops there, so the band would be sent back short
  const odd = new BinaryWriter().flexInt(1).string("low_shelf").flexInt(9).double(1).flexInt(0).toBuffer();
  const short = rig({ bands: [new BinaryWriter().long(1n).integer(61).integer(odd.length).bytes(odd).toBuffer(), band(OWNERS[1])] });
  assert.match((await short.peq.run({ zone: "TV Speaker", band: 2, gain: 1, save: true, send: true })).notSent, /can't read Bands whole/);
  assert.equal(short.calls.length, 0);
  const empty = rig({ bands: [new BinaryWriter().long(0n).toBuffer(), band(OWNERS[1])] });
  assert.match((await empty.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: false })).notSent, /Band 1 is empty/);
  const typeless = rig({ bands: [band({ GainDb: -2, Frequency: 99 }), band(OWNERS[1])] });
  assert.match((await typeless.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: false })).notSent, /Band 1 has no type/);
  const busy = rig({ read: { native: true, found: false, why: "Native mode is busy reading your server; try again in a moment.", outputs: [] } });
  assert.match((await busy.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: false })).error, /busy reading/);
  const unread = rig({ read: { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", why: "Your server sent no DSP for this output." }] } });
  assert.match((await unread.peq.run({ zone: "TV Speaker", band: 1, gain: 1, save: true, send: false })).error, /TV Speaker: Your server sent no DSP/);
  const decoy = rig({ decoy: true });
  const d = await decoy.peq.run({ zone: "TV Speaker", band: 1, gain: -9, save: true, send: true });
  assert.equal(d.answer, "taken", "the band written under its own declaration, not the other namespace's");
  assert.equal(sentOf(decoy, decoy.calls[0].args).spec[BANDS][0][`double ${B("GainDb")}`], -9);
});
