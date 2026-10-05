"use strict";
// ---------------------------------------------------------------------------
// What v1.8.78 brought over from hqpweb 0.1.0-beta.2 (+ 65b3888), MIT, (c)
// 2026 statelycurmudgeon — lib/hqp/LICENSE:
//
//   * the volume guard as a pure function, and a rollback that never raises
//   * the fake's OWN table of stops, and a contract that the app predicts each
//   * Status' processing speed, apodization and clip counters, output bits
//   * HQPlayer 6's filter descriptions: rating, focus, ratio rule
//   * pickers that mark a filter the fixed rate rules out, with the rates that fit
//   * a volume that jumps without this app, flagged and dismissable
//   * "Restart playback" after a rollback
//   * a connection accepted and closed without a reply, said for what it is
// ---------------------------------------------------------------------------

require("../lib/no-real-hqplayer");
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { FakeHqp, loadProfile } = require("../../lib/hqp/fake");
const { createHqpService } = require("../../lib/hqp/service");
const { decideVolume, MAX_RAISE_DB } = require("../../lib/hqp/volume");
const { STOP_RULES } = require("../../lib/hqp/stops");
const C = require("../../lib/hqp/compat");
const P = require("../../lib/hqp/parse");
const H = require("../../lib/hqp/hints");
const { parseDocument } = require("../../lib/hqp/xml");
const { HqpClient } = require("../../lib/hqp/client");

const FAST = { graceMs: 50, healthyMs: 150, maxMs: 600, sampleMs: 20, minSpeed: 0.85, stoppedMs: 150 };
const TIMING = { quick: FAST, major: Object.assign({}, FAST, { maxMs: 800 }) };

async function setup(tt, fakeOpts, profile) {
  const fake = new FakeHqp(loadProfile(profile || "desktop5-mac-sdm"), Object.assign({ timeScale: 0 }, fakeOpts || {}));
  await fake.listen();
  let saved = { hqpEnabled: true, hqpHost: "127.0.0.1", hqpPort: fake.port };
  const svc = createHqpService({
    dataDir: null,
    getSettings: () => saved,
    saveSettings: (patch) => { saved = Object.assign({}, saved, patch); return true; },
    timing: TIMING,
    pollMs: 20,
  });
  const call = async (method, p, body) => {
    const r = await svc.dispatch({ method, path: p, headers: { "content-type": "application/json" }, body });
    return { status: r.status, json: r.body };
  };
  const close = async () => { await svc.close(); await fake.close(); };
  tt.after(close);
  return { fake, call, close };
}
const change = (s, body) => s.call("POST", "/change", body);
// /now until it says what is wanted, rather than after a guessed number of ms.
async function nowUntil(s, cond, what) {
  for (let n = 0; n < 300; n++) {
    const j = (await s.call("GET", "/now")).json;
    if (cond(j)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for " + what);
}

test("the volume guard (volume.js), every case on a grid", async (t) => {
  const range = { min: -60, max: -3, enabled: true };
  const levels = [];
  for (let v = -60; v <= -3; v += 1.5) levels.push(v);
  await t.test("a rollback NEVER raises the volume, from anywhere to anywhere", () => {
    for (const current of levels) for (const requested of levels) for (const untouched of [true, false]) {
      const d = decideVolume({ requested, current, range, kind: "rollback", untouched });
      if (d.set !== undefined) assert.ok(d.set <= current + 0.01, "rollback raised " + current + " → " + d.set);
      assert.equal(d.problem, undefined, "a rollback refused itself over the volume");
    }
  });
  await t.test("a change never raises by more than 6 dB, and a refused raise is a problem, not a silent skip", () => {
    for (const current of levels) for (const requested of levels) {
      const d = decideVolume({ requested, current, range, kind: "change", untouched: false });
      if (d.set !== undefined) assert.ok(d.set - current <= MAX_RAISE_DB + 0.01);
      else assert.match(d.problem, /refusing to raise/);
    }
  });
  await t.test("undo goes back up only if nobody moved the volume since", () => {
    assert.equal(decideVolume({ requested: -10, current: -40, range, kind: "undo", untouched: true }).set, -10);
    const d = decideVolume({ requested: -10, current: -40, range, kind: "undo", untouched: false });
    assert.equal(d.set, undefined);
    assert.match(d.note, /changed elsewhere/);
  });
  await t.test("clamped to the range, and switched off is refused", () => {
    assert.equal(decideVolume({ requested: 0, current: -5, range, kind: "change", untouched: false }).set, -3);
    assert.match(decideVolume({ requested: -20, current: -5, range: Object.assign({}, range, { enabled: false }),
      kind: "change", untouched: false }).problem, /switched off/);
  });
});

test("THE one: a rollback leaves a lowered volume lowered", async (tt) => {
  // A preset that lowers the volume AND picks a rate the modulator cannot play
  // (AHM7EC8B at DSD512). The rate goes back; the volume, which the listener
  // just chose to lower, does not come back up behind their back.
  const s = await setup(tt);
  const p = (await s.call("POST", "/presets", { name: "Quiet DSD512", settings: { volume: -30, rate: 22579200 } })).json;
  const r = (await s.call("POST", "/presets/" + p.id + "/apply", {})).json;
  assert.equal(r.playback.kind, "stopped");
  assert.ok(r.rolledBack, "not rolled back");
  assert.equal(s.fake.volume, -30, "the rollback raised the volume back to where it was");
  const vol = r.rolledBack.results.find((x) => x.field === "volume");
  assert.ok(vol, "the rollback did not say what it did with the volume");
  assert.match(vol.note, /a rollback never raises the volume/);
  assert.equal(r.rolledBack.results.find((x) => x.field === "rate").actual, 0);
});

test("the fake's own stop table, and the contract the app keeps with it", async (t) => {
  await t.test("every stop the fake knows of, the app predicts", () => {
    for (const rule of STOP_RULES) {
      const e = rule.example;
      assert.ok(rule.stops(e), "the rule's own example does not stop: " + rule.evidence);
      const predicted = C.predictedStop({ mode: e.modeName, filter: e.filterName, shaper: e.shaperName,
                                          sourceRate: e.sourceRate, outputRate: e.rateHz });
      assert.ok(predicted, "the app does not predict a measured stop: " + rule.evidence);
    }
  });
  await t.test("the fake no longer asks the app what stops", () => {
    const src = require("node:fs").readFileSync(require.resolve("../../lib/hqp/fake"), "utf8");
    assert.doesNotMatch(src, /require\("\.\/compat"\)/, "a test of the predictions against the fake would agree with itself");
  });
});

test("Status: processing speed, counters and output bits", async (t) => {
  await t.test("parsed when present, null or 0 when not", () => {
    const st = P.parseStatus(parseDocument('<?xml version="1.0"?><Status state="2" active_rate="96000" volume="-20" active_bits="32" process_speed="31.5" apod="12" clips="3" position="1"/>'));
    assert.deepEqual([st.activeBits, st.processSpeed, st.apod, st.clips], [32, 31.5, 12, 3]);
    const old = P.parseStatus(parseDocument('<?xml version="1.0"?><Status state="0" active_rate="0" volume="-20"/>'));
    assert.deepEqual([old.activeBits, old.processSpeed, old.apod, old.clips], [0, null, 0, 0],
      "a version that does not report a speed must read as unknown, not as 0× (falling behind)");
  });
  await t.test("the queued track's rate, from HQPlayer's own playlist", () => {
    const el = parseDocument('<?xml version="1.0"?><PlaylistGet><PlaylistItem index="1" rate="44100"/><PlaylistItem index="2" rate="96000"/></PlaylistGet>');
    assert.equal(P.queuedRate(el, 2), 96000);
    assert.equal(P.queuedRate(el, 0), 44100, "no current track: the first");
    assert.equal(P.queuedRate(parseDocument('<?xml version="1.0"?><PlaylistGet/>'), 1), null);
  });
  await t.test("/now reports HQPlayer's processing speed while playing", async (tt) => {
    const s = await setup(tt);
    const j = await nowUntil(s, (x) => x.health && x.health.processSpeed !== null, "a processing speed");
    assert.equal(j.health.processSpeed, 25);
    assert.equal(j.snapshot.status.activeBits, 1, "SDM is a 1-bit stream");
  });
  await t.test("the apodization counter, against the filter running now", async (tt) => {
    const s = await setup(tt);
    s.fake.apod = 15;
    // The Mac profile plays poly-sinc-gauss-xla, which HQPlayer 6's table calls apodizing.
    const j = await nowUntil(s, (x) => x.snapshot && x.snapshot.status.apod === 15, "the counter");
    assert.equal(j.apodization, "handled");
    assert.equal(H.apodization(15, false), "suggest");
    assert.equal(H.apodization(15, "partial"), "suggest");
    assert.equal(H.apodization(10, false), null, "10 is the manual's threshold, not past it");
  });
});

test("HQPlayer 6's own descriptions", async (t) => {
  await t.test("a filter: rating, focus and ratio rule", () => {
    const d = C.parseFilterDescription("5/5 transients, timbre ⥮ Any up");
    assert.deepEqual([d.rating, d.tags, d.ratio, d.ratioText], [5, ["transients", "timbre"], "any-up", "Any up"]);
    assert.equal(C.parseFilterDescription("not a description"), undefined);
    assert.equal(C.parseFilterDescription("x".repeat(500)), undefined);
  });
  await t.test("HQPlayer's own ratio rule wins over the v5 manual's", () => {
    // sinc-M is "2^x up" in HQPlayer 6 PCM: 2× DOWN, fine on v5, is refused there.
    assert.equal(C.ratioHint("sinc-M", 96000, 48000, false), undefined);
    assert.equal(C.ratioHint("sinc-M", 96000, 48000, false, "pow2-up").level, "hard");
    assert.ok(C.predictedStop({ mode: "PCM", filter: "sinc-M", shaper: "TPDF", sourceRate: 96000, outputRate: 48000,
                                filterDescription: "4/5 space, timbre ⥮ 2^x up" }));
  });
  await t.test("a v5 HQPlayer borrows HQPlayer 6's rating and focus by name, and v5's ratio rule", () => {
    const n = C.filterNotes("sinc-M", undefined, false, false);
    assert.deepEqual([n.rating, n.tags, n.ratio, n.fromHqp], [4, ["space", "timbre"], "pow2", false]);
    assert.equal(C.filterNotes("sinc-M", undefined, false, true), undefined,
      "an HQPlayer that describes its filters was given a borrowed description for one it did not");
    assert.equal(C.modulatorGen("ASDM7ECv3", undefined, false), 6);
    assert.equal(C.modulatorGen("anything", "Gen8", true), 8);
  });
});

test("the pickers: a filter the fixed rate rules out, and the rates that would fit", async (tt) => {
  const s = await setup(tt);
  await change(s, { mode: "PCM" });                          // a 44.1k source: the 1x filter is in use
  await change(s, { filter1x: "poly-sinc-gauss-long", rate: 192000 });
  const c = (await s.call("GET", "/capabilities")).json;
  const h = c.hints.filter1x["sinc-M"];
  assert.match(h.blocked, /^needs a power-of-two ratio; 44\.1k → 192k is 4\.35×$/);
  const fit = h.rates.map((r) => r.rate);
  assert.ok(fit.includes(176400) && !fit.includes(192000), JSON.stringify(h.rates));
  assert.equal(h.rates.filter((r) => r.nearest).length, 1);
  assert.equal(h.rates.find((r) => r.nearest).rate, 176400, "the nearest fit to 192k is 176.4k");
  assert.equal(h.rating, 4);
  assert.equal(h.apodizing, true);
  assert.equal(c.hints.filter1x["poly-sinc-gauss-long"].blocked, undefined, "a filter that plays here was ruled out");
  assert.equal(c.hints.filterNx["sinc-M"] && c.hints.filterNx["sinc-M"].blocked, undefined,
    "the Nx filter is not in use for a 44.1k source, so the fixed rate cannot rule it out");
  assert.deepEqual(c.guards.wedge, null);
  assert.ok(Array.isArray(c.guards.otherSources));
});

test("guards: the next track will not start, and the sources that will not play", () => {
  const caps = {
    mode: { name: "PCM" },
    filters: [{ index: 0, name: "sinc-M" }, { index: 1, name: "poly-sinc-gauss-long" }],
    shapers: [{ index: 0, name: "TPDF" }],
    rates: [{ index: 0, rate: 0, allowed: true }, { index: 1, rate: 176400, allowed: true }, { index: 2, rate: 192000, allowed: true }],
    knownBad: [],
  };
  // Stopped, nothing in Status, but HQPlayer's own playlist holds a 44.1k track.
  const snap = {
    status: { state: 0, source: null, activeRate: 192000 },
    state: { mode: 0, rate: 2, filter1x: 0, filterNx: 1, shaper: 0 },
    queuedRate: 44100,
  };
  const g = H.guards(caps, snap);
  assert.equal(g.wedge.cause, "filter");
  assert.equal(g.wedge.slot, "filter1x");
  assert.match(g.wedge.text, /sinc-M needs a power-of-two ratio/);
  assert.deepEqual(g.wedge.rates.map((r) => r.rate), [176400]);
  assert.deepEqual(g.otherSources, [], "48k → 192k is 4×, which sinc-M plays");
  // At 176.4k the queued 44.1k track is fine (4×), and a 48k album would not be.
  const at176 = H.guards(caps, Object.assign({}, snap, { state: Object.assign({}, snap.state, { rate: 1 }) }));
  assert.equal(at176.wedge, null);
  assert.deepEqual(at176.otherSources, ["sinc-M won't play 48k sources"]);
  // Auto rate: HQPlayer picks one the filter can do, so nothing is wedged.
  assert.equal(H.guards(caps, Object.assign({}, snap, { state: Object.assign({}, snap.state, { rate: 0 }) })).wedge, null);
});

test("a volume that jumps without this app", async (t) => {
  await t.test("is flagged, and Dismiss clears it", async (tt) => {
    const s = await setup(tt);
    await nowUntil(s, (x) => x.snapshot, "a first status");
    s.fake.volume = -8; // from -22: as HQPlayer restarting at its saved level does
    const j = await nowUntil(s, (x) => x.snapshot && x.snapshot.volumeJump, "the jump");
    assert.deepEqual([j.snapshot.volumeJump.from, j.snapshot.volumeJump.to], [-22, -8]);
    assert.equal((await s.call("POST", "/volume-jump/dismiss", {})).status, 200);
    await nowUntil(s, (x) => x.snapshot && !x.snapshot.volumeJump, "the dismissal");
  });
  await t.test("going back down clears it by itself", async (tt) => {
    const s = await setup(tt);
    await nowUntil(s, (x) => x.snapshot, "a first status");
    s.fake.volume = -8;
    await nowUntil(s, (x) => x.snapshot && x.snapshot.volumeJump, "the jump");
    s.fake.volume = -22;
    await nowUntil(s, (x) => x.snapshot && !x.snapshot.volumeJump && x.snapshot.state.volume === -22, "the clear");
  });
  await t.test("this app's own undo back up is not a jump", async (tt) => {
    const s = await setup(tt);
    await change(s, { volume: -40 });
    await nowUntil(s, (x) => x.snapshot && x.snapshot.state.volume === -40, "the lower volume");
    assert.equal((await s.call("POST", "/undo", {})).status, 200);
    const j = await nowUntil(s, (x) => x.snapshot && x.snapshot.state.volume === -22, "the undo");
    assert.equal(j.snapshot.volumeJump, undefined, "the app flagged its own Undo as a jump");
  });
});

test("Restart playback: Stop, then Play", async (tt) => {
  const s = await setup(tt);
  s.fake.playback = 0;
  const r = await s.call("POST", "/restart", {});
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(s.fake.playback, 2);
  const sent = s.fake.received.map((x) => (/<(\w+)/.exec(x.replace(/^<\?xml[^>]*\?>/, "")) || [])[1]);
  assert.ok(sent.lastIndexOf("Stop") < sent.lastIndexOf("Play") && sent.lastIndexOf("Stop") > -1, sent.join(","));
});

test("a connection accepted and closed without a reply is said for what it is", async (tt) => {
  // Measured by hqpweb on an unlicensed HQPlayer 6 Embedded once its trial ran out.
  const server = net.createServer((sock) => sock.destroy());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  tt.after(() => new Promise((r) => server.close(r)));
  const client = new HqpClient("127.0.0.1", { port: server.address().port, timeoutMs: 2000 });
  tt.after(() => client.close());
  await assert.rejects(client.info(), /accepted the connection but closed it without replying.*trial/);
});
