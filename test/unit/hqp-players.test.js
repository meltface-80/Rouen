"use strict";
// ---------------------------------------------------------------------------
// v1.8.85: several HQPlayers (after hqpweb's Instances), DACs behind one, and
// finding HQPlayers on the network (hqpweb's discovery).
//
// What each group pins:
//
//   1. NOTHING SAVED BEFORE MOVES. The one address of every earlier version
//      becomes the first HQPlayer under the id "hqp" — the key its answers and
//      learned failures were already kept under — and the keys earlier
//      versions read are still written, so going back a version finds it.
//   2. THE LIST: add (named by HQPlayer itself when no name is given), rename,
//      change the address, remove, choose; strict about names and addresses.
//   3. DACS FOLLOW THE CHOICE. The guide's answers, the learned failures and a
//      DAC's own presets are kept per DAC; switching the DAC switches all three,
//      and the first DAC keeps what was there before any were named.
//   4. DISCOVERY marks what is already in the list, and runs only when asked.
// ---------------------------------------------------------------------------

require("../lib/no-real-hqplayer");
const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeHqp, loadProfile } = require("../../lib/hqp/fake");
const { createHqpService } = require("../../lib/hqp/service");
const PL = require("../../lib/hqp/players");
const { discover } = require("../../lib/hqp/discover");

const JSON_HDR = { "content-type": "application/json" };

async function fakeFor(tt) {
  const fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  tt.after(() => fake.close());
  return fake;
}

function service(tt, initial, extra) {
  let saved = Object.assign({}, initial || {});
  const writes = [];
  const svc = createHqpService(Object.assign({
    dataDir: null,
    getSettings: () => saved,
    saveSettings: (patch) => { writes.push(patch); saved = Object.assign({}, saved, patch); return true; },
    pollMs: 30, leaseMs: 300,
  }, extra || {}));
  const call = async (method, p, body) => {
    const r = await svc.dispatch({ method, path: p, headers: JSON_HDR, body });
    return { status: r.status, json: r.body };
  };
  tt.after(() => svc.close());
  return { svc, call, writes, saved: () => saved };
}

const failure = (instance) => ({ instance, engine: "5.32.5", mode: "SDM (DSD)", rateHz: 22579200,
                                 filterNx: "poly-sinc-gauss-long", filter1x: "poly-sinc-gauss-xla",
                                 shaper: "AHM7EC8B", reason: "playback stopped", at: "2026-10-03T00:00:00.000Z" });

test("1. an install from before keeps its HQPlayer, answers and failures where they were", async (t) => {
  await t.test("the one address becomes HQPlayer 'hqp', and its answers and failures are still its own", async (tt) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-hqp-"));
    tt.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "hqp-learned.json"), JSON.stringify({ failures: [failure("hqp")] }));
    fs.writeFileSync(path.join(dir, "hqp-setup.json"), JSON.stringify({ setups: [{ instance: "hqp", setup: { pcm: "ladder" } }] }));
    const s = service(tt, { hqpEnabled: true, hqpHost: "192.0.2.10", hqpPort: 4322 }, { dataDir: dir });
    const j = (await s.call("GET", "/settings")).json;
    assert.deepEqual(j.players.map((x) => [x.id, x.host, x.port]), [["hqp", "192.0.2.10", 4322]]);
    assert.equal(j.active, "hqp");
    assert.equal(j.learned_count, 1);
    assert.deepEqual((await s.call("GET", "/setup")).json.setup, { pcm: "ladder" });
    assert.equal(s.writes.length, 0, "reading the settings must not write them");
  });

  await t.test("the keys earlier versions read follow the HQPlayer in use", async (tt) => {
    const s = service(tt, { hqpEnabled: true, hqpHost: "192.0.2.10" });
    await s.call("POST", "/players", { name: "Office", host: "192.0.2.20" });
    await s.call("POST", "/players/office/select", {});
    assert.equal(s.saved().hqpHost, "192.0.2.20");
    assert.equal(s.saved().hqpActive, "office");
    assert.deepEqual(PL.readPlayers(s.saved()).players.map((x) => x.id), ["hqp", "office"]);
  });
});

test("2. the list of HQPlayers", async (t) => {
  await t.test("added without a name, it is named by HQPlayer itself", async (tt) => {
    const fake = await fakeFor(tt);
    const s = service(tt, { hqpEnabled: true });
    const r = await s.call("POST", "/players", { host: "127.0.0.1", port: fake.port });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const p = r.json.players[0];
    assert.notEqual(p.name, "127.0.0.1", "named by HQPlayer, not by its address, when it answered");
    assert.equal(r.json.active, p.id, "the first one added is the one in use");
  });

  await t.test("one that doesn't answer is added under its address, and can be renamed", async (tt) => {
    const s = service(tt, { hqpEnabled: true });
    const r = await s.call("POST", "/players", { host: "127.0.0.1", port: 1 });
    assert.equal(r.status, 200);
    const id = r.json.added;
    assert.equal(r.json.players[0].name, "127.0.0.1");
    const r2 = await s.call("PATCH", "/players/" + id, { name: "Living room" });
    assert.equal(r2.json.players[0].name, "Living room");
    assert.equal(r2.json.players[0].id, id, "renaming must not change the id its answers are kept under");
  });

  await t.test("strict, and no duplicates", async (tt) => {
    const s = service(tt, { hqpEnabled: true });
    assert.equal((await s.call("POST", "/players", { name: "A", host: "192.0.2.1" })).status, 200);
    assert.equal((await s.call("POST", "/players", { name: "B", host: "192.0.2.1" })).status, 409);
    for (const body of [{}, { host: "a b" }, { host: "x", port: 0 }, { host: "x", colour: 1 }, { host: "x", name: "y".repeat(65) }]) {
      assert.equal((await s.call("POST", "/players", body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await s.call("PATCH", "/players/nope", { name: "x" })).status, 404);
    assert.equal((await s.call("POST", "/players/nope/select", {})).status, 404);
  });

  await t.test("removing the one in use moves to the next; removing the last leaves none", async (tt) => {
    const s = service(tt, { hqpEnabled: true });
    await s.call("POST", "/players", { name: "A", host: "192.0.2.1" });
    await s.call("POST", "/players", { name: "B", host: "192.0.2.2" });
    let j = (await s.call("DELETE", "/players/a", {})).json;
    assert.equal(j.active, "b");
    j = (await s.call("DELETE", "/players/b", {})).json;
    assert.equal(j.active, "");
    assert.equal((await s.call("GET", "/now")).json.configured, false);
  });

  await t.test("switching HQPlayer switches what the screen talks to", async (tt) => {
    const f1 = await fakeFor(tt);
    const f2 = await fakeFor(tt);
    const s = service(tt, { hqpEnabled: true });
    await s.call("POST", "/players", { name: "One", host: "127.0.0.1", port: f1.port });
    await s.call("POST", "/players", { name: "Two", host: "127.0.0.1", port: f2.port });
    let now = (await s.call("GET", "/now")).json;
    assert.equal(now.name, "One");
    assert.deepEqual(now.players.map((x) => x.name), ["One", "Two"]);
    await s.call("POST", "/settings", { active: "two" });
    now = (await s.call("GET", "/now")).json;
    assert.equal(now.name, "Two");
    assert.equal(now.address, "127.0.0.1:" + f2.port);
  });
});

test("3. DACs behind one HQPlayer", async (t) => {
  await t.test("the first DAC keeps what was there; a second starts empty; switching switches all three", async (tt) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-hqp-"));
    tt.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "hqp-learned.json"), JSON.stringify({ failures: [failure("hqp")] }));
    const fake = await fakeFor(tt);
    const s = service(tt, { hqpEnabled: true, hqpHost: "127.0.0.1", hqpPort: fake.port }, { dataDir: dir });
    // Only one DAC: nothing to pick, and the first has no name.
    let j = (await s.call("GET", "/settings")).json;
    assert.deepEqual(j.dacs, [{ id: "main", name: "" }]);

    j = (await s.call("POST", "/players/hqp/dacs", { name: "Desk DAC", currentName: "Living room DAC" })).json;
    assert.deepEqual(j.dacs.map((d) => d.name), ["Living room DAC", "Desk DAC"]);
    assert.equal(j.dac, "main", "adding a DAC doesn't switch to it");
    assert.equal(j.learned_count, 1);
    assert.equal((await s.call("POST", "/setup", { pcm: "ladder" })).status, 200);
    const shared = (await s.call("POST", "/presets", { name: "Everywhere", settings: { volume: -30 }, dacOnly: false })).json;
    const mine = (await s.call("POST", "/presets", { name: "Living room only", settings: { volume: -20 } })).json;
    assert.equal(shared.scope, undefined);
    assert.equal(mine.scope, "hqp", "with two DACs a new preset is the DAC in use's");

    j = (await s.call("POST", "/players/hqp/dac", { dac: j.dacs[1].id })).json;
    assert.equal(j.learned_count, 0, "the second DAC has learned nothing yet");
    assert.deepEqual((await s.call("GET", "/setup")).json.setup, {}, "the second DAC has no answers yet");
    assert.deepEqual((await s.call("GET", "/presets")).json.map((p) => p.name), ["Everywhere"]);
    const now = (await s.call("GET", "/now")).json;
    assert.equal(now.dac, j.dacs[1].id);
    assert.deepEqual(now.dacs.map((d) => d.name), ["Living room DAC", "Desk DAC"]);

    j = (await s.call("POST", "/players/hqp/dac", { dac: "main" })).json;
    assert.equal(j.learned_count, 1);
    assert.equal((await s.call("GET", "/setup")).json.setup.pcm, "ladder");
    assert.deepEqual((await s.call("GET", "/presets")).json.map((p) => p.name).sort(), ["Everywhere", "Living room only"]);
  });

  await t.test("a DAC removed takes its answers and failures with it, and its presets become shared", async (tt) => {
    const fake = await fakeFor(tt);
    const s = service(tt, { hqpEnabled: true, hqpHost: "127.0.0.1", hqpPort: fake.port });
    const id = (await s.call("POST", "/players/hqp/dacs", { name: "Desk DAC" })).json.added;
    await s.call("POST", "/players/hqp/dac", { dac: id });
    await s.call("POST", "/setup", { pcm: "ladder" });
    await s.call("POST", "/presets", { name: "Desk", settings: { volume: -25 } });
    let j = (await s.call("DELETE", "/players/hqp/dacs/" + id, {})).json;
    assert.equal(j.dac, "main");
    assert.deepEqual(j.dacs, [{ id: "main", name: "" }], "down to one, it is just 'the DAC' again");
    assert.deepEqual((await s.call("GET", "/presets")).json.map((p) => [p.name, p.scope]), [["Desk", undefined]]);
    // Added again under the same name, it starts empty rather than inheriting.
    const again = (await s.call("POST", "/players/hqp/dacs", { name: "Desk DAC" })).json.added;
    await s.call("POST", "/players/hqp/dac", { dac: again });
    assert.deepEqual((await s.call("GET", "/setup")).json.setup, {});
    assert.equal((await s.call("DELETE", "/players/hqp/dacs/main", {})).status, 400, "the first DAC can't be removed");
  });

  await t.test("names are required and unique per HQPlayer", async (tt) => {
    const s = service(tt, { hqpEnabled: true, hqpHost: "192.0.2.10" });
    assert.equal((await s.call("POST", "/players/hqp/dacs", { name: "" })).status, 400);
    const j = (await s.call("POST", "/players/hqp/dacs", { name: "Desk DAC" })).json;
    assert.deepEqual(j.dacs.map((d) => d.name), ["First DAC", "Desk DAC"]);
    assert.equal((await s.call("POST", "/players/hqp/dacs", { name: "desk dac" })).status, 409);
    assert.equal((await s.call("PATCH", "/players/hqp/dacs/main", { name: "Desk DAC" })).status, 409);
    assert.equal((await s.call("POST", "/players/hqp/dac", { dac: "nope" })).status, 404);
    assert.equal((await s.call("POST", "/players/hqp/dacs", { name: "x", colour: "red" })).status, 400);
    assert.equal((await s.call("POST", "/players/demo/dacs", { name: "x" })).status, 404, "the old demo id is no HQPlayer now");
  });

  await t.test("the scope: the first DAC is the HQPlayer's own id", () => {
    assert.equal(PL.scopeOf("hqp", "main"), "hqp");
    assert.equal(PL.scopeOf("hqp", "desk-dac"), "hqp#desk-dac");
  });
});

test("4. finding HQPlayers on the network", async (t) => {
  await t.test("what is found is marked when it is already in the list", async (tt) => {
    const s = service(tt, { hqpEnabled: true, hqpHost: "192.0.2.10" }, {
      discover: async () => [{ address: "192.0.2.10", name: "Living room", version: "Signalyst HQPlayer 5" },
                             { address: "192.0.2.20", name: "Office", version: "Signalyst HQPlayer Embedded 6" }],
    });
    const j = (await s.call("POST", "/discover", {})).json;
    assert.deepEqual(j.found.map((x) => [x.address, x.added]), [["192.0.2.10", "hqp"], ["192.0.2.20", null]]);
    assert.equal(s.writes.length, 0, "finding must not add anything");
  });

  await t.test("the probe itself: hqpweb's discovery, answered by a stand-in on loopback", async (tt) => {
    const sock = dgram.createSocket("udp4");
    tt.after(() => sock.close());
    await new Promise((r) => sock.bind(0, "127.0.0.1", r));
    sock.on("message", (msg, rinfo) => {
      if (!/<discover>hqplayer<\/discover>/.test(msg.toString())) return;
      sock.send('<?xml version="1.0"?><discover name="Studio" result="OK" version="Signalyst HQPlayer Desktop 5">hqplayer</discover>',
                rinfo.port, rinfo.address);
      sock.send("<nonsense/>", rinfo.port, rinfo.address);
    });
    const found = await discover({ target: { address: "127.0.0.1", port: sock.address().port }, timeoutMs: 400 });
    assert.deepEqual(found, [{ address: "127.0.0.1", name: "Studio", version: "Signalyst HQPlayer Desktop 5" }]);
  });
});

test("5. found in review (v1.8.85)", async (t) => {
  await t.test("an address changed by an EARLIER version after the list was saved wins", () => {
    const saved = PL.toSettings(PL.addPlayer(PL.readPlayers({}), { name: "Lounge", host: "192.0.2.10" }).model);
    // The older version knew one address and wrote only these two keys.
    const m = PL.readPlayers(Object.assign({}, saved, { hqpHost: "192.0.2.99", hqpPort: 4400 }));
    assert.deepEqual(m.players.map((x) => [x.id, x.name, x.host, x.port]), [["lounge", "Lounge", "192.0.2.99", 4400]]);
    // A list emptied here, then an address added there: it comes back as the first.
    const empty = PL.toSettings(PL.readPlayers({ hqpPlayers: [] }));
    const m2 = PL.readPlayers(Object.assign({}, empty, { hqpHost: "192.0.2.50" }));
    assert.deepEqual(m2.players.map((x) => [x.id, x.host]), [["hqp", "192.0.2.50"]]);
    assert.equal(m2.active, "hqp");
    // And an untouched list is read as saved.
    assert.deepEqual(PL.readPlayers(saved).players.map((x) => x.host), ["192.0.2.10"]);
  });

  await t.test("two DACs can each have a preset of the same name; a shared one still blocks it", async (tt) => {
    const fake = await fakeFor(tt);
    const s = service(tt, { hqpEnabled: true, hqpHost: "127.0.0.1", hqpPort: fake.port });
    const desk = (await s.call("POST", "/players/hqp/dacs", { name: "Desk DAC" })).json.added;
    assert.equal((await s.call("POST", "/presets", { name: "Reference", settings: { volume: -20 } })).status, 200);
    const shared = await s.call("POST", "/presets", { name: "Quiet", settings: { volume: -40 }, dacOnly: false });
    await s.call("POST", "/players/hqp/dac", { dac: desk });
    assert.equal((await s.call("POST", "/presets", { name: "Reference", settings: { volume: -25 } })).status, 200,
                 "a name kept for the other DAC blocked this one's");
    assert.equal((await s.call("POST", "/presets", { name: "quiet", settings: { volume: -30 } })).status, 409);
    // A preset kept for the OTHER DAC is not there to apply, change or delete.
    await s.call("POST", "/players/hqp/dac", { dac: "main" });
    const list = (await s.call("GET", "/presets")).json;
    await s.call("POST", "/players/hqp/dac", { dac: desk });
    const theirs = list.find((p) => p.name === "Reference");
    assert.equal((await s.call("POST", "/presets/" + theirs.id + "/apply", {})).status, 404);
    assert.equal((await s.call("PATCH", "/presets/" + theirs.id, { name: "x" })).status, 404);
    assert.equal((await s.call("DELETE", "/presets/" + theirs.id, {})).status, 404);
    assert.equal((await s.call("PATCH", "/presets/" + shared.json.id, { dacOnly: true })).status, 200);
  });

  await t.test("with no HQPlayer at all, answers are not kept under a key no HQPlayer reads", async (tt) => {
    const s = service(tt, { hqpEnabled: true });
    assert.deepEqual((await s.call("GET", "/setup")).json.setup, {});
    const r = await s.call("POST", "/setup", { pcm: "ladder" });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /Add an HQPlayer first/);
    assert.deepEqual((await s.call("DELETE", "/learned", {})).json, { forgotten: 0 });
  });

  await t.test("Find knows an HQPlayer added by its host name", async (tt) => {
    const s = service(tt, { hqpEnabled: true, hqpHost: "music-pc.local" }, {
      discover: async () => [{ address: "192.0.2.10", name: "Music PC", version: "" }],
      lookup: async (h) => ({ address: h === "music-pc.local" ? "192.0.2.10" : "0.0.0.0", family: 4 }),
    });
    assert.deepEqual((await s.call("POST", "/discover", {})).json.found.map((x) => x.added), ["hqp"]);
  });

  await t.test("a found name longer than a name may be is cut to fit, so Add works", async (tt) => {
    const sock = dgram.createSocket("udp4");
    tt.after(() => sock.close());
    await new Promise((r) => sock.bind(0, "127.0.0.1", r));
    sock.on("message", (msg, rinfo) => {
      sock.send('<discover name="' + "N".repeat(200) + '" result="OK" version="v">hqplayer</discover>', rinfo.port, rinfo.address);
    });
    const found = await discover({ target: { address: "127.0.0.1", port: sock.address().port }, timeoutMs: 300 });
    assert.equal(found[0].name.length, 64);
  });

  await t.test("a failure is recorded where the change was made, whatever is chosen meanwhile", () => {
    const { Instance } = require("../../lib/hqp/instance");
    const { LearnedStore } = require("../../lib/hqp/store");
    const learned = new LearnedStore(null);
    let current = "hqp";
    const i = new Instance({ id: "hqp", host: "127.0.0.1", port: 1 }, { learned, scope: () => current });
    const combo = { engine: "5", combo: { mode: "SDM", rateHz: 1, filterNx: "a", filter1x: "b", shaper: "c" } };
    const scopeAtStart = i.scope();
    current = "hqp#desk";                         // switched while the change was being watched
    i.recordFailure("stopped", combo, scopeAtStart);
    assert.deepEqual(learned.all("hqp").length, 1);
    assert.deepEqual(learned.all("hqp#desk").length, 0);
    i.client.close();
  });
});
