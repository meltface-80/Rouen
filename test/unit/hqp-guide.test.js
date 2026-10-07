"use strict";
// ---------------------------------------------------------------------------
// v1.8.78: hqpweb main at 525f8d7 — the modulator and dither guide — on the
// server side: the pair order, the failure history, the setup answers, and the
// /guide and /dacs routes the sheet reads. Adapted from hqpweb's compat,
// change and learned tests (MIT, (c) 2026 statelycurmudgeon —
// lib/hqp/LICENSE); the guide's own rules are hqp-guide-upstream.test.js.
// ---------------------------------------------------------------------------

require("../lib/no-real-hqplayer");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeHqp, loadProfile } = require("../../lib/hqp/fake");
const { createHqpService } = require("../../lib/hqp/service");
const { shaperBeforeRate } = require("../../lib/hqp/compat");
const { LearnedStore } = require("../../lib/hqp/store");
const { SetupStore, parseSetupPatch, SETUP_ANSWERS, SETUP_QUESTION_LIST } = require("../../lib/hqp/setup");
const { MAJOR_TIMING } = require("../../lib/hqp/watch");

const FAST = { graceMs: 50, healthyMs: 150, maxMs: 600, sampleMs: 20, minSpeed: 0.85, stoppedMs: 150 };
const TIMING = { quick: FAST, major: Object.assign({}, FAST, { maxMs: 800 }) };
const DSD256 = 11289600, DSD512 = 22579200, DSD1024 = 45158400;
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "rouen-hqp-guide-"));

async function setup(tt, extra) {
  const x = extra || {};
  const fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  let saved = { hqpEnabled: true, hqpHost: "127.0.0.1", hqpPort: fake.port };
  const svc = createHqpService({
    dataDir: x.dataDir || null,
    getSettings: () => saved,
    saveSettings: (patch) => { saved = Object.assign({}, saved, patch); return true; },
    timing: TIMING,
    pollMs: 20,
  });
  const call = async (method, p, body) => {
    const r = await svc.dispatch({ method, path: p, headers: { "content-type": "application/json" }, body });
    return { status: r.status, json: r.body };
  };
  tt.after(async () => { await svc.close(); await fake.close(); });
  return { fake, call };
}

test("rate and modulator changed together (hqpweb compat test)", async (t) => {
  await t.test("going up to AHM: rate first, since AHM at the old rate can't play", () => {
    assert.equal(shaperBeforeRate({ fromRate: DSD256, toRate: DSD1024, fromShaper: "ASDM7EC-fast", toShaper: "AHM7EC4B" }), false);
  });
  await t.test("coming down from AHM: modulator first, since AHM at the new rate can't play", () => {
    assert.equal(shaperBeforeRate({ fromRate: DSD1024, toRate: DSD256, fromShaper: "AHM7EC4B", toShaper: "ASDM7EC-fast" }), true);
  });
  await t.test("keeps the usual order (rate first) when either order is fine", () => {
    assert.equal(shaperBeforeRate({ fromRate: DSD256, toRate: DSD512, fromShaper: "ASDM7EC-fast", toShaper: "ASDM7EC-light" }), false);
  });
  await t.test("keeps rate first when the rate was auto and unknown", () => {
    assert.equal(shaperBeforeRate({ fromRate: 0, toRate: DSD1024, fromShaper: "ASDM7EC-fast", toShaper: "AHM7EC4B" }), false);
  });
});

test("the engine sends them in that order, and playback survives (hqpweb change test)", async (t) => {
  const sent = (fake) => fake.received.map((x) => (/<(SetRate|SetShaping)\b/.exec(x) || [])[1]).filter(Boolean);
  await t.test("THE one: coming down from AHM at DSD1024, the modulator goes before the rate", async (tt) => {
    const s = await setup(tt);
    await s.call("POST", "/change", { rate: DSD1024, shaper: "AHM7EC8B" });
    s.fake.received.length = 0;
    const r = (await s.call("POST", "/change", { rate: DSD256, shaper: "ASDM7EC" })).json;
    assert.deepEqual(sent(s.fake), ["SetShaping", "SetRate"]);
    assert.deepEqual(r.playback, { kind: "playing" }, "the change passed through AHM at DSD256 and stopped");
  });
  await t.test("going up to AHM at DSD1024, the rate goes first", async (tt) => {
    const s = await setup(tt);
    await s.call("POST", "/change", { rate: DSD256, shaper: "ASDM7EC" });
    s.fake.received.length = 0;
    const r = (await s.call("POST", "/change", { rate: DSD1024, shaper: "AHM7EC8B" })).json;
    assert.deepEqual(sent(s.fake), ["SetRate", "SetShaping"]);
    assert.deepEqual(r.playback, { kind: "playing" });
  });
});

test("a rate or mode change waits longer before judging playback (hqpweb, 2026-10-06)", () => {
  // DSD1024 + AHM7EC8B, measured at 1.0×, was rolled back at 72% judged from 2.5 s.
  assert.deepEqual([MAJOR_TIMING.graceMs, MAJOR_TIMING.healthyMs, MAJOR_TIMING.maxMs], [5000, 3000, 15000]);
});

test("failure history, per HQPlayer, engine and combination (hqpweb learned test)", async (t) => {
  const f = (o) => Object.assign({
    instance: "hqp", engine: "5.35.10", mode: "SDM (DSD)", rateHz: DSD1024,
    filterNx: "poly-sinc-gauss-hires-lp", filter1x: "poly-sinc-gauss-xla", shaper: "ASDM7EC",
    reason: "playing at 53% of real time", at: "2026-10-01T10:00:00.000Z",
  }, o || {});
  await t.test("counts repeat failures of one combination, keeping the first and last dates", () => {
    const s = new LearnedStore(null);
    s.record(f());
    s.record(f({ at: "2026-10-03T10:00:00.000Z", reason: "playing at 60% of real time" }));
    const all = s.all("hqp");
    assert.equal(all.length, 1);
    assert.deepEqual([all[0].count, all[0].first, all[0].at, all[0].reason],
      [2, "2026-10-01T10:00:00.000Z", "2026-10-03T10:00:00.000Z", "playing at 60% of real time"]);
  });
  await t.test("keeps different combinations, and other HQPlayers, apart", () => {
    const s = new LearnedStore(null);
    s.record(f());
    s.record(f({ shaper: "ASDM7EC-light" }));
    s.record(f({ instance: "office" }));
    assert.deepEqual([s.all("hqp").length, s.all("office").length], [2, 1]);
  });
  await t.test("reads failures saved before counts existed as one each", () => {
    const file = path.join(tmpDir(), "hqp-learned.json");
    fs.writeFileSync(file, JSON.stringify({ failures: [f()] }));
    const got = new LearnedStore(file).all("hqp")[0];
    assert.deepEqual([got.count, got.first], [1, "2026-10-01T10:00:00.000Z"]);
  });
});

test("Your setup: the answers, checked, kept per HQPlayer", async (t) => {
  await t.test("a value sets an answer, null clears it, anything else is refused", () => {
    assert.deepEqual(parseSetupPatch({ dsd: "direct", amp: null }), { dsd: "direct", amp: null });
    assert.throws(() => parseSetupPatch({ dsd: "chord" }), /must be one of/);
    assert.throws(() => parseSetupPatch({ colour: "red" }), /unknown setup question/);
    assert.throws(() => parseSetupPatch([]), /JSON object/);
  });
  await t.test("every question offers exactly the answers the server accepts, in order", () => {
    for (const q of SETUP_QUESTION_LIST) assert.deepEqual(q.options.map((o) => o.value), SETUP_ANSWERS[q.key]);
    assert.deepEqual(SETUP_QUESTION_LIST.map((q) => q.key), ["dsd", "pcm", "amp", "volume", "link"]);
  });
  await t.test("kept on disk, each HQPlayer's apart, and an unknown value dropped on load", () => {
    const file = path.join(tmpDir(), "hqp-setup.json");
    const s = new SetupStore(file);
    s.update("hqp", { dsd: "direct", pcm: "ladder" });
    s.update("office", { dsd: "older-ess" });
    s.update("hqp", { pcm: null });
    const again = new SetupStore(file);
    assert.deepEqual([again.get("hqp"), again.get("office")], [{ dsd: "direct" }, { dsd: "older-ess" }]);
    fs.writeFileSync(file, JSON.stringify({ setups: [{ instance: "hqp", setup: { dsd: "direct", link: "carrier-pigeon" } }] }));
    assert.deepEqual(new SetupStore(file).get("hqp"), { dsd: "direct" });
  });
  await t.test("through the routes: JSON in, the answers back", async (tt) => {
    const s = await setup(tt);
    assert.deepEqual((await s.call("GET", "/setup")).json.setup, {});
    const r = await s.call("POST", "/setup", { dsd: "direct", volume: "fixed" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.setup, { dsd: "direct", volume: "fixed" });
    assert.equal((await s.call("POST", "/setup", { dsd: "nonsense" })).status, 400);
    assert.equal((await s.call("GET", "/setup")).json.questions.length, 5);
  });
});

test("/guide: the modulator sheet's List and Guide, for this HQPlayer now", async (t) => {
  await t.test("before any answer: the list grouped, no starting point, the DAC question asked", async (tt) => {
    const s = await setup(tt);
    const g = (await s.call("GET", "/guide")).json;
    assert.equal(g.isSdm, true);
    assert.equal(g.current, "AHM7EC8B");
    assert.equal(g.modulator.status, "needs-dac");
    assert.deepEqual(Object.keys(g.questions), ["dsd", "amp", "volume"]);
    assert.equal(g.sections[0].title, "Newest EC line");
    assert.ok(g.sections.reduce((n, x) => n + x.names.length, 0) >= 36 - 0, "a modulator HQPlayer lists is missing from the list");
    assert.deepEqual(g.badges, {});
  });
  await t.test("THE one: answered, it starts where the rules say, and offers rate-and-modulator pairs", async (tt) => {
    const s = await setup(tt);
    await s.call("POST", "/setup", { dsd: "direct", amp: "other", volume: "fixed" });
    const g = (await s.call("GET", "/guide")).json;
    assert.equal(g.modulator.status, "ok");
    // The Mac plays at DSD1024 (auto), so AHM is the start there.
    assert.equal(g.modulator.start.name, "AHM7EC8B");
    assert.deepEqual(g.modulator.pairs.map((p) => [p.label, p.start.name, p.suitsDac]),
      [["DSD256", "ASDM7EC-fast", true], ["DSD1024", "AHM7EC8B", true], ["DSD512", "ASDM7EC-fast", false]]);
    assert.ok(g.modulator.pairs.every((p) => p.check && p.check.invalid === null), "a pair the rules allow was marked invalid");
    // Every rule carries its citation for the page to link.
    assert.match(g.modulator.start.rules[0].cite, /^Jussi, \w+ \d{4}$/);
    assert.match(g.modulator.start.rules[0].url, /^https:\/\/community\.roonlabs\.com\/t\//);
    assert.deepEqual(g.badges, { AHM7EC8B: { text: "For your answers", kind: "yours" } });
  });
  await t.test("a DAC that converts DSD is told PCM suits it", async (tt) => {
    const s = await setup(tt);
    await s.call("POST", "/setup", { dsd: "converts" });
    assert.equal((await s.call("GET", "/guide")).json.modulator.status, "use-pcm");
  });
  await t.test("in PCM: the dither guide, its two questions, and never none", async (tt) => {
    const s = await setup(tt);
    await s.call("POST", "/change", { mode: "PCM" });
    await s.call("POST", "/setup", { pcm: "delta-sigma", link: "usb" });
    const g = (await s.call("GET", "/guide")).json;
    assert.equal(g.isSdm, false);
    assert.deepEqual(Object.keys(g.questions), ["pcm", "link"]);
    assert.equal(g.dither.status, "ok");
    assert.ok(!g.dither.group.includes("none"));
    assert.equal(g.sections[g.sections.length - 1].title, "Not for listening");
  });
});

test("/dacs: Find your DAC, as the page draws it", async (tt) => {
  const s = await setup(tt);
  const d = (await s.call("GET", "/dacs")).json;
  assert.equal(d.checked, "5 Oct 2026");
  assert.ok(d.chips.length >= 8 && d.groups.length >= 10);
  const chord = d.groups.find((g) => g.maker === "Chord").models[0];
  assert.deepEqual(chord.dsd, { label: "Converts / none", tone: "dim" });
  assert.match(chord.search, /chord.*qutest/);
  assert.match(d.issues, /^https:\/\/github\.com\/statelycurmudgeon\/hqpweb\/issues\/new/);
});

test("the AHM safety net: a modulator below its floor is offered with a rate it plays at", async (tt) => {
  const s = await setup(tt);
  await s.call("POST", "/change", { rate: DSD512, shaper: "ASDM7EC" });
  const h = (await s.call("GET", "/capabilities")).json.hints.shaper;
  assert.equal(h.AHM7EC8B.cantPlay, true);
  assert.equal(h.AHM7EC8B.pairRate, DSD1024, "the lowest listed rate AHM plays at");
  assert.equal(h.ASDM7EC.cantPlay, undefined);
});

test("/now names a recent risky change, for the overload warning", async (tt) => {
  const s = await setup(tt);
  assert.equal((await s.call("GET", "/now")).json.recentChangeAt, null);
  await s.call("POST", "/change", { shaper: "ASDM7EC" });
  const at = (await s.call("GET", "/now")).json.recentChangeAt;
  assert.ok(at && Math.abs(Date.parse(at) - Date.now()) < 60000, String(at));
  assert.ok((await s.call("GET", "/now")).json.restart.steps.length >= 1);
});
