"use strict";
// ---------------------------------------------------------------------------
// The Qobuz sign-in routes (lib/routes/qobuz-oauth.js), moved out of index.js unchanged in v1.9.72-t54. The URL
// building and the code parsing are lib/qobuz-oauth.js's, used here as they are; only the exchange, the one call that
// goes to Qobuz, is a fake. What is checked is what index.js is told: the token set, the settings saved, the app_id
// resynced, the favourites read started and the said-once log cleared, in that order, and nothing of it on a refusal.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const QOA = require("../../lib/qobuz-oauth");
const { mountQobuzOAuth } = require("../../lib/routes/qobuz-oauth");

function rig({ exchange, displayName = "Ada" } = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  const did = [];
  const wave = { token: "old", user: "u0", name: "Old" };
  const saidOnce = new Set(["noid:Blue"]);
  const exchanged = [];
  mountQobuzOAuth(app, {
    qoa: { ...QOA, exchangeCode: async (code) => { exchanged.push(code); return exchange(code); } },
    displayName: () => displayName,
    setWave: (token, user, name) => { did.push("set"); Object.assign(wave, { token, user, name }); },
    save: (patch) => { did.push(["save", patch]); return true; },
    syncAppId: () => { did.push("sync:" + wave.token); },
    refreshStreamAlbumKeys: (reason) => { did.push("refresh:" + reason); return Promise.resolve(); },
    saidOnce,
  });
  const call = async (key, req) => {
    const res = { code: 200, body: null, html: null,
      status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(h) { this.html = h; return this; } };
    await routes[key]({ headers: {}, query: {}, ...req }, res);
    return res;
  };
  return { call, did, wave, saidOnce, exchanged, routes };
}

const quiet = (t) => t.mock.method(console, "log", () => {});

test("all four routes are mounted, under the paths the settings screen calls", () => {
  const w = rig({ exchange: async () => ({}) });
  assert.deepEqual(Object.keys(w.routes).sort(), ["GET /api/qobuz/oauth/callback", "GET /api/qobuz/oauth/start",
    "POST /api/qobuz/oauth/disconnect", "POST /api/qobuz/oauth/paste"]);
});

test("/start: Qobuz's sign-in page, sent back to the address this request came in on", async () => {
  const w = rig({ exchange: async () => ({}) });
  const r = await w.call("GET /api/qobuz/oauth/start", { headers: { host: "192.168.1.50:3399", "x-forwarded-proto": "https" } });
  assert.equal(r.code, 200);
  assert.equal(r.body.redirect_url, "https://192.168.1.50:3399/api/qobuz/oauth/callback");
  assert.equal(r.body.url, QOA.buildAuthorizeUrl("https://192.168.1.50:3399/api/qobuz/oauth/callback"));
});

test("/start: no address to send the browser back to is a 400, said plainly", async () => {
  const w = rig({ exchange: async () => ({}) });
  const r = await w.call("GET /api/qobuz/oauth/start", { headers: {} });
  assert.equal(r.code, 400);
  assert.deepEqual(r.body, { error: "could not work out this server's address" });
});

test("/callback: the code traded, the token kept and saved, then the app_id, the favourites and the log, in order", async (t) => {
  quiet(t);
  const w = rig({ exchange: async () => ({ token: "tok1", userId: "u42" }) });
  const r = await w.call("GET /api/qobuz/oauth/callback",
    { originalUrl: "/api/qobuz/oauth/callback?code_autorisation=abc123" });
  assert.equal(r.code, 200);
  assert.match(r.html, /^<!doctype html>/);
  assert.match(r.html, /<title>Connected<\/title>/);
  assert.match(r.html, /<h2>Qobuz connected\.<\/h2>/);
  assert.deepEqual(w.exchanged, ["abc123"]);
  assert.deepEqual(w.wave, { token: "tok1", user: "u42", name: "Ada" });
  assert.deepEqual(w.did, ["set", ["save", { qobuzWaveToken: "tok1", qobuzWaveUser: "u42", qobuzWaveName: "Ada" }],
    "sync:tok1", "refresh:qobuz sign-in"]);
  assert.equal(w.saidOnce.size, 0, "the declines logged under the old sign-in are forgotten");
});

test("/callback: no code is a 400 page and nothing changes; a failed exchange is a 400 page with the reason, escaped", async (t) => {
  quiet(t);
  const w = rig({ exchange: async () => { throw new Error("code <expired> & spent"); } });
  const none = await w.call("GET /api/qobuz/oauth/callback", { originalUrl: "/api/qobuz/oauth/callback?error=cancelled" });
  assert.equal(none.code, 400);
  assert.match(none.html, /<title>Sign-in incomplete<\/title>/);
  assert.deepEqual(w.exchanged, [], "no code, no call to Qobuz");

  const bad = await w.call("GET /api/qobuz/oauth/callback", { originalUrl: "/cb?code_autorisation=zz" });
  assert.equal(bad.code, 400);
  assert.match(bad.html, /<title>Sign-in failed<\/title>/);
  assert.match(bad.html, /<p>code expired  spent<\/p>/, "the message reaches the page with < > & taken out");
  assert.deepEqual(w.did, [], "a refusal sets, saves and resyncs nothing");
  assert.deepEqual(w.wave, { token: "old", user: "u0", name: "Old" });
  assert.equal(w.saidOnce.size, 1);
});

test("/paste: the address pasted from another device signs in the same way, answering JSON", async () => {
  const w = rig({ exchange: async () => ({ token: "tok2", userId: "u7" }), displayName: "" });
  const r = await w.call("POST /api/qobuz/oauth/paste", { body: { url: "http://nowhere.invalid/cb?code_autorisation=xyz" } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, connected: true });
  assert.deepEqual(w.exchanged, ["xyz"]);
  assert.deepEqual(w.did, ["set", ["save", { qobuzWaveToken: "tok2", qobuzWaveUser: "u7", qobuzWaveName: "" }],
    "sync:tok2", "refresh:qobuz sign-in"]);
  assert.equal(w.saidOnce.size, 0);
});

test("/paste: no code in the address, no body, or a failed exchange is a 400 and nothing changes", async () => {
  const w = rig({ exchange: async () => { throw new Error("expired"); } });
  const none = await w.call("POST /api/qobuz/oauth/paste", { body: { url: "http://nowhere.invalid/cb?error=1" } });
  assert.equal(none.code, 400);
  assert.deepEqual(none.body, { error: "no sign-in code found in that address" });
  const nobody = await w.call("POST /api/qobuz/oauth/paste", {});
  assert.equal(nobody.code, 400);
  assert.deepEqual(w.exchanged, []);

  const bad = await w.call("POST /api/qobuz/oauth/paste", { body: { url: "abc" } });
  assert.equal(bad.code, 400);
  assert.deepEqual(bad.body, { error: "expired" });
  const blank = rig({ exchange: async () => { throw new Error(""); } });
  assert.deepEqual((await blank.call("POST /api/qobuz/oauth/paste", { body: { url: "abc" } })).body, { error: "sign-in failed" });
  assert.deepEqual(w.did, []);
  assert.equal(w.wave.token, "old");
});

test("/disconnect: the token, user and name cleared and saved empty, the app_id resynced, the log cleared", async () => {
  const w = rig({ exchange: async () => ({}) });
  const r = await w.call("POST /api/qobuz/oauth/disconnect", {});
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, connected: false });
  assert.deepEqual(w.wave, { token: "", user: "", name: "" });
  assert.deepEqual(w.did, ["set", ["save", { qobuzWaveToken: "", qobuzWaveUser: "", qobuzWaveName: "" }], "sync:"]);
  assert.equal(w.saidOnce.size, 0);
});
