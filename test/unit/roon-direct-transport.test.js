"use strict";
// ---------------------------------------------------------------------------
// N3-2, transport through the server itself (lib/roon-direct/transport.js, v1.9.65, native-remote.md §14.3): each
// control on the Zone or Endpoint found by §14.2's proven id match, its arguments as upstream's generated client
// writes them, and believed once the official zone shows it. The session and graph are stubs shaped as objects.js
// and remoting.js keep them; they are not evidence that the owner's server takes these calls (its run is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTransport, shows, look, endpointFor } = require("../../lib/roon-direct/transport");
const { BinaryWriter } = require("../../lib/roon-direct/wire");

const API = "Sooloos.Broker.Api.";
const ZONE_ID = "16012a1ceb2ad0281e9f2a5d889dfe0cd544", OUTPUT_ID = "17012a1ceb2ad0281e9f2a5d889dfe0cd544";
const obj = (oid, type, fields) => ({ oid, typeId: 1, typeName: API + type, fields, loaded: true });

function stubGraph(o = {}) {
  const objects = new Map();
  const add = (x) => { objects.set(String(x.oid), x); return x; };
  add(obj(3618121n, "Zone", { [`System.Sooid ${API}Zone::ZoneId`]: Buffer.from(o.otherZone ? "ff" : ZONE_ID, "hex") }));
  add(obj(3618118n, "Endpoint", { [`System.Sooid ${API}Endpoint::EndpointId`]: Buffer.from(o.endpointIdKnown ? OUTPUT_ID : "aa", "hex"),
    [`string ${API}Endpoint::Name`]: o.otherName ? "Kitchen" : "Stereo Fives", [`${API}Zone ${API}Endpoint::Zone`]: { $ref: 3618121n } }));
  return { objects, get: (oid) => objects.get(String(oid)),
    ofType: (s) => [...objects.values()].filter((x) => x.typeName === s || x.typeName.endsWith("." + s)) };
}

/** The official zone as index.js holds it; `server` changes it as the server would once a call is taken. */
function official() {
  return { zone_id: ZONE_ID, display_name: "Stereo Fives", state: "playing", queue_items_remaining: 5,
    settings: { shuffle: false, loop: "disabled", auto_radio: true },
    now_playing: { seek_position: 40, three_line: { line1: "River", line2: "Joni Mitchell", line3: "Blue" } },
    outputs: [{ output_id: OUTPUT_ID, display_name: "Stereo Fives", is_muted: false, volume: { value: 12, min: 0, max: 100, step: 1 } }] };
}

/** o.takes(sig, args, z): what the server does to the official zone when a call reaches it (nothing when absent). */
function rig(o = {}) {
  const z = official();
  const sent = [];
  const g = {
    uncertain: () => o.uncertain || "",
    callNoReply(oid, sig, args) { if (o.closed) return false; sent.push([oid, sig, args]); if (o.takes) o.takes(sig, args, z); return true; },
    call(oid, sig, args) {
      sent.push([oid, sig, args]);
      if (o.throws) return Promise.reject(new Error("no answer in 15000 ms"));
      if (o.refuses) return Promise.resolve({ success: false, status: "InvalidRequest" });
      if (o.takes) o.takes(sig, args, z);
      return Promise.resolve({ success: true, status: "Success" });
    },
  };
  const session = { graph: stubGraph(o), g };
  const t = createTransport({ link: o.noLink ? null : { session: () => session }, inTurn: (fn) => fn(), on: () => o.off !== true,
    zone: (id) => (id === ZONE_ID || id === OUTPUT_ID ? z : null), waitMs: 40, pollMs: 5 });
  return { t, z, sent };
}
const bytes = (fn) => fn(new BinaryWriter()).toBuffer();

test("THE one: pause on the Zone found by its id, no arguments, believed once the official zone shows paused", async () => {
  const w = rig({ takes: (sig, args, z) => { if (sig.endsWith("::Pause()")) z.state = "paused"; } });
  assert.deepEqual(await w.t.command(ZONE_ID, "pause"), { seen: true });
  assert.deepEqual(w.sent.map(([oid, sig, args]) => [oid, sig, args.length]), [[3618121n, "Sooloos.Broker.Api.Zone::Pause()", 0]]);
  assert.deepEqual(w.t.lastControl().ok, true);
  // By an output's id too (the route's zone_or_output_id): the zone it is in.
  const o = rig({ takes: (sig, args, z) => { if (sig.endsWith("::Next()")) z.now_playing.three_line.line1 = "California"; } });
  assert.deepEqual(await o.t.command(OUTPUT_ID, "next"), { seen: true });
  assert.equal(o.sent[0][1], "Sooloos.Broker.Api.Zone::Next()");
});

test("every call and its arguments, as upstream's generated client writes them", async () => {
  const cases = [
    [(t) => t.command(ZONE_ID, "play"), "Sooloos.Broker.Api.Zone::Play()", Buffer.alloc(0)],
    [(t) => t.command(ZONE_ID, "playpause"), "Sooloos.Broker.Api.Zone::PlayPause()", Buffer.alloc(0)],
    [(t) => t.command(ZONE_ID, "stop"), "Sooloos.Broker.Api.Zone::Stop()", Buffer.alloc(0)],
    [(t) => t.command(ZONE_ID, "previous"), "Sooloos.Broker.Api.Zone::Previous()", Buffer.alloc(0)],
    [(t) => t.seek(ZONE_ID, 95.4), "Sooloos.Broker.Api.Zone::Seek(int, Base.ResultCallback)", bytes((x) => x.integer(95))],
    [(t) => t.volume(OUTPUT_ID, "absolute", 30.5), "Sooloos.Broker.Api.Endpoint::SetVolumeDouble(double, Base.ResultCallback)",
      (() => { const b = Buffer.alloc(8); b.writeDoubleLE(30.5, 0); return b; })()],
    [(t) => t.volume(OUTPUT_ID, "relative", -2), "Sooloos.Broker.Api.Endpoint::IncrementVolumeDouble(double, Base.ResultCallback)",
      (() => { const b = Buffer.alloc(8); b.writeDoubleLE(-2, 0); return b; })()],
    [(t) => t.mute(OUTPUT_ID, true), "Sooloos.Broker.Api.Endpoint::SetMute(bool)", Buffer.from([1])],
    [(t) => t.settings(ZONE_ID, { shuffle: true }), "Sooloos.Broker.Api.Zone::SetShuffle(bool)", Buffer.from([1])],
    [(t) => t.settings(ZONE_ID, { loop: "loop_one" }), "Sooloos.Broker.Api.Zone::SetLoop(Sooloos.Broker.Api.LoopMode)", bytes((x) => x.integer(2))],
    [(t) => t.settings(ZONE_ID, { auto_radio: false }), "Sooloos.Broker.Api.Zone::SetAutoSwim(bool)", Buffer.from([0])],
  ];
  for (const [run, sig, args] of cases) {
    const w = rig();
    await run(w.t);
    assert.equal(w.sent.length, 1, sig);
    assert.equal(w.sent[0][1], sig);
    assert.deepEqual(w.sent[0][2], args, sig + "'s arguments");
    // A volume or a mute on the endpoint; the rest on the zone.
    assert.equal(w.sent[0][0], sig.includes("Endpoint::") ? 3618118n : 3618121n, sig + " on the wrong object");
  }
  const several = rig();
  await several.t.settings(ZONE_ID, { shuffle: true, loop: "loop", auto_radio: true });
  assert.deepEqual(several.sent.map((x) => x[1].split("::")[1]), ["SetShuffle(bool)", "SetLoop(Sooloos.Broker.Api.LoopMode)", "SetAutoSwim(bool)"]);
});

test("not sent — off, not connected, being checked, no zone, a zone or output not matched, refused, closed: nothing reached the server", async () => {
  const notSent = async (o, run = (t) => t.command(ZONE_ID, "pause")) => {
    const w = rig(o);
    const r = await run(w.t);
    assert.ok("notSent" in r, JSON.stringify(o) + " → " + JSON.stringify(r));
    return [r.notSent, w.sent.length];
  };
  assert.deepEqual(await notSent({ off: true }), ["Native mode is off.", 0]);
  assert.deepEqual(await notSent({ noLink: true }), ["Native mode isn't connected to your server right now.", 0]);
  assert.deepEqual(await notSent({ uncertain: "a call went unanswered" }), ["The connection to your server is being checked.", 0]);
  assert.deepEqual(await notSent({}, (t) => t.command("nope", "pause")), ["The official API doesn't list that zone now.", 0]);
  // Neither by id nor through its endpoints' names (smart.js's zoneFor falls back to those).
  assert.deepEqual(await notSent({ otherZone: true, otherName: true }), ["Rouen couldn't tell which of your server's zones is \"Stereo Fives\".", 0]);
  assert.deepEqual(await notSent({ otherName: true }, (t) => t.mute(OUTPUT_ID, true)), ["Rouen couldn't tell which of your server's outputs is \"Stereo Fives\".", 0]);
  assert.deepEqual(await notSent({ refuses: true }, (t) => t.seek(ZONE_ID, 10)), ["Your server refused it (InvalidRequest).", 1]);
  assert.deepEqual(await notSent({ closed: true }), ["The connection closed before it could be sent.", 0]);
  assert.deepEqual(await notSent({}, (t) => t.settings(ZONE_ID, { loop: "sometimes" })), ["\"sometimes\" isn't a repeat mode.", 0]);
});

test("sent, not seen: said with why after the wait — and an answer that never came is watched for, never taken as not sent", async () => {
  const w = rig();
  const r = await w.t.command(ZONE_ID, "next");
  assert.equal(r.seen, false);
  assert.match(r.why, /The zone didn't show it within 0 s\./);
  assert.deepEqual(w.t.lastControl().ok, false);
  const lost = rig({ throws: true });
  const l = await lost.t.seek(ZONE_ID, 10);
  assert.equal(l.seen, false, "a seek whose answer never came was called not sent: the route would send it again");
  assert.match(l.why, /^no answer in 15000 ms The zone/);
  // …and one that was taken all the same is seen.
  const late = rig({ throws: true, takes: () => {} });
  late.z.now_playing.seek_position = 10;
  assert.deepEqual(await late.t.seek(ZONE_ID, 10), { seen: true });
});

test("what counts as seen (§14.3's table)", () => {
  const base = look(official());
  const after = (patch) => Object.assign(look(official()), patch);
  const yes = (c, a) => assert.equal(shows(c, base, after(a)), true, JSON.stringify([c, a]));
  const no = (c, a) => assert.equal(shows(c, base, after(a)), false, JSON.stringify([c, a]));
  yes({ kind: "play" }, { state: "loading" }); no({ kind: "pause" }, { state: "playing" }); yes({ kind: "stop" }, { state: "paused" });
  yes({ kind: "playpause" }, { state: "paused" }); no({ kind: "playpause" }, { state: "playing" });
  yes({ kind: "next" }, { line: "another" }); yes({ kind: "next" }, { left: 4 }); no({ kind: "next" }, {});
  yes({ kind: "previous" }, { seek: 0 }); no({ kind: "previous" }, { seek: 41 });
  yes({ kind: "seek", arg: 100 }, { seek: 102 }); no({ kind: "seek", arg: 100 }, { seek: 40 });
  const out = (v) => ({ outputs: { [OUTPUT_ID]: Object.assign({}, base.outputs[OUTPUT_ID], v) } });
  yes({ kind: "volume", arg: 30, output: OUTPUT_ID }, out({ value: 30 }));
  yes({ kind: "volume", arg: 150, output: OUTPUT_ID }, out({ value: 100 }));   // a target past the limit, clamped
  no({ kind: "volume", arg: 30, output: OUTPUT_ID }, out({ value: 12 }));
  yes({ kind: "volumeBy", arg: 2, output: OUTPUT_ID }, out({ value: 14 })); no({ kind: "volumeBy", arg: -2, output: OUTPUT_ID }, out({ value: 14 }));
  yes({ kind: "mute", arg: true, output: OUTPUT_ID }, out({ muted: true }));
  yes({ kind: "settings", arg: { shuffle: true, loop: "loop" } }, { settings: { shuffle: true, loop: "loop", auto_radio: true } });
  no({ kind: "settings", arg: { shuffle: true, loop: "loop" } }, { settings: { shuffle: true, loop: "disabled", auto_radio: true } });
  // At the top already, a step up is taken as done (nothing to move).
  const top = look(official());
  top.outputs[OUTPUT_ID].value = 100;
  assert.equal(shows({ kind: "volumeBy", arg: 1, output: OUTPUT_ID }, top, top), true);
});

test("the output's endpoint: by its id when the server's is the official output id, else by name in its zone", () => {
  const z = { oid: 3618121n };
  assert.equal(endpointFor(stubGraph({ endpointIdKnown: true }), z, { output_id: OUTPUT_ID, display_name: "Other name" }).by, "id");
  assert.equal(endpointFor(stubGraph(), z, { output_id: OUTPUT_ID, display_name: "Stereo Fives" }).by, "name");
  assert.ok("notSent" in endpointFor(stubGraph(), { oid: 1n }, { output_id: OUTPUT_ID, display_name: "Stereo Fives" }), "an endpoint of another zone");
});

// The review of v1.9.65.
test("the review: a busy turn hands it to the official API at once and sends nothing later; volumes that can't be watched or aren't numbers", async () => {
  const z = official();
  const sent = [];
  let run;
  const held = new Promise((res) => { run = res; });
  const session = { graph: stubGraph(), g: { uncertain: () => "", callNoReply: (...a) => { sent.push(a); return true; }, call: async () => ({ success: true }) } };
  const t = createTransport({ link: { session: () => session }, on: () => true, zone: () => z, waitMs: 20, pollMs: 5, turnMs: 10,
    inTurn: async (fn) => { await held; return fn(); } });   // a library read holds the turn
  assert.deepEqual(await t.command(ZONE_ID, "pause"), { notSent: "Native mode was busy reading your server; the official API took it." });
  run();
  await new Promise((res) => { setTimeout(res, 20); });
  assert.deepEqual(sent, [], "sent natively after the official API had taken it");
  const w = rig();
  assert.deepEqual(await w.t.volume(OUTPUT_ID, "absolute", NaN), { notSent: "That volume isn't a number." });
  w.z.outputs[0].volume = { type: "incremental" };
  assert.deepEqual(await w.t.volume(OUTPUT_ID, "relative", 1), { notSent: "This output's volume can't be watched; the official API takes it." });
  assert.deepEqual(w.sent, []);
});

test("the review: the toggle from loading is seen only once the state changes; one line of now playing is a line; an endpoint of another zone is never one", () => {
  const loading = Object.assign(look(official()), { state: "loading" });
  assert.equal(shows({ kind: "playpause" }, loading, loading), false, "a toggle from loading counted as seen with nothing changed");
  assert.equal(shows({ kind: "playpause" }, loading, Object.assign({}, loading, { state: "paused" })), true);
  const one = official();
  one.now_playing = { one_line: { line1: "River - Joni Mitchell" } };
  assert.equal(look(one).line, "River - Joni Mitchell");
  const g = stubGraph({ endpointIdKnown: true });
  assert.ok("notSent" in endpointFor(g, { oid: 99n }, { output_id: OUTPUT_ID, display_name: "Stereo Fives" }), "an endpoint matched by id in another zone");
});
