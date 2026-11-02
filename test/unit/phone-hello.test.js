"use strict";
// v1.9.72-t54: the phone's hello (lib/phone/routes.js; dev/design/android-app.md §4.10, §4.22). Since §4.22 (the owner,
// 2026-10-31: "Scrap Squeezelite") the phone is never a Roon zone: hello no longer starts a Squeezebox player for it,
// and the player's routes are gone. What hello still gives the app is the way to Rouen from away (§4.7): whether this
// hello came over the tailnet, and Rouen's tailnet address.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountPhone } = require("../../lib/phone/routes");

const ID = "0123456789abcdef0123456789abcdef";

/** The routes, called as Express would; `mounted` lists what was mounted. */
function api(deps) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountPhone(app, deps);
  const call = (method, p, { body = {}, ip } = {}) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    routes[method + " " + p]({ body, ip }, res);
  });
  return { call, mounted: Object.keys(routes) };
}

test("THE one: hello says whether the phone came over the tailnet, and gives Rouen's tailnet address (§4.7)", async () => {
  let address = null;
  const { call } = api({ away: (req) => req.ip === "100.90.1.7", awayAddress: () => address });
  const home = await call("POST", "/api/phone/hello", { body: { device_id: ID } });
  assert.deepEqual(home, { code: 200, body: { device_id: ID, away: false, away_address: null } }, "at home, no tailnet address yet");
  address = "http://100.90.1.2:3399";
  const away = await call("POST", "/api/phone/hello", { body: { device_id: ID }, ip: "100.90.1.7" });
  assert.deepEqual(away, { code: 200, body: { device_id: ID, away: true, away_address: "http://100.90.1.2:3399" } });
});

test("hello starts no player: no zone name, no command sequence, no session, no Core address (§4.22)", async () => {
  const { call } = api({});
  const r = await call("POST", "/api/phone/hello", { body: { device_id: ID } });
  for (const k of ["zone_name", "seq", "open", "core_host", "slim_port"]) assert.ok(!(k in r.body), k + " is gone with the player");
  assert.deepEqual(r.body, { device_id: ID, away: false, away_address: null }, "no away hooks given: at home, no address");
});

test("an app from before §4.22, which still sends its name and quality, is answered as any other", async () => {
  const { call } = api({ awayAddress: () => "http://100.90.1.2:3399" });
  const r = await call("POST", "/api/phone/hello", { body: { device_id: ID, name: "Pixel", quality: "opus" } });
  assert.equal(r.code, 200);
  assert.equal(r.body.away_address, "http://100.90.1.2:3399");
});

test("hello refuses a body without a proper device_id", async () => {
  const { call } = api({});
  for (const body of [{}, { device_id: "short" }, { device_id: ID.toUpperCase() + "0" }, { device_id: 42 }]) {
    const r = await call("POST", "/api/phone/hello", { body });
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.match(r.body.error, /device_id/);
  }
});

test("THE one for the teardown: the player's routes are not mounted — only hello is (§4.22)", () => {
  assert.deepEqual(api({}).mounted, ["POST /api/phone/hello"],
    "commands, state, audio, now, control and /api/debug/phones went with the player");
});

test("THE one for the leftovers: the old player's sessions under data/phone go at start; the rest of data stays (§4.22)", () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { removeOldSessions } = require("../../lib/tailscale/mount");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-t54-"));
  try {
    const dev = path.join(root, "data", "phone", ID);
    fs.mkdirSync(dev, { recursive: true });
    fs.writeFileSync(path.join(dev, "s1.flac"), "fLaC");
    fs.writeFileSync(path.join(dev, "s2.ogg"), "OggS");
    fs.mkdirSync(path.join(root, "data", "tailscale"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "tailscale", "state"), "keep");
    const said = [];
    removeOldSessions(root, (l) => said.push(l));
    assert.equal(fs.existsSync(path.join(root, "data", "phone")), false, "the old sessions are gone");
    assert.equal(fs.readFileSync(path.join(root, "data", "tailscale", "state"), "utf8"), "keep", "nothing else in data is touched");
    removeOldSessions(root, (l) => said.push(l));
    assert.deepEqual(said, [], "a folder already gone is no work, and nothing to say");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
