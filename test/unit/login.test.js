"use strict";
// ---------------------------------------------------------------------------
// Rouen's optional password (lib/login.js, dev/design/login.md): off until
// set; then what needs it (login-routes.js) goes no further without a login;
// a login lasts, survives a restart, and ends when the password changes;
// wrong guesses are slowed; the hash, never the password, is kept.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLogin, COOKIE } = require("../../lib/login");

function rig(t, start) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-login-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = { settings: Object.assign({}, start), clock: 1000000, logs: [], dir };
  const make = () => createLogin({
    // As the real store does: its copy changed first, then the write, which can fail.
    getSettings: () => w.settings, saveSettings: (p) => { Object.assign(w.settings, p); return !w.saveFails; },
    sessionsFile: path.join(dir, "sessions.json"), now: () => w.clock, log: (l) => w.logs.push(l) });
  w.login = make();
  w.restart = () => { w.login = make(); w.routes = routes(w.login); };
  w.routes = routes(w.login);
  // One request through the guard, then the route (if any).
  w.call = async (method, p, o = {}) => {
    const res = { status: 200, body: null, headers: {}, set() {}, setHeader(k, v) { this.headers[k] = v; },
      json(b) { this.body = b; return this; } };
    res.status = function (code) { this.code = code; return this; };
    res.code = 200;
    const req = { method, path: p, body: o.body || {}, headers: { cookie: o.cookie || "" }, ip: o.ip || "10.0.0.5" };
    let passed = false;
    w.login.guard(req, res, () => { passed = true; });
    if (passed) {
      const h = w.routes[method + " " + p];
      if (h) await h(req, res); else res.json({ reached: true });
    }
    const set = res.headers["Set-Cookie"];
    const m = set && new RegExp(COOKIE + "=([0-9a-f]*)").exec(set);
    return { code: res.code, body: res.body, cookie: m ? `${COOKIE}=${m[1]}` : null, setCookie: set || null };
  };
  return w;
}
function routes(login) {
  const r = {};
  login.mount({ get: (p, h) => { r["GET " + p] = h; }, post: (p, h) => { r["POST " + p] = h; } });
  return r;
}
const PW = "correct horse";

test("off until a password is set: nothing is asked, anything goes", async (t) => {
  const w = rig(t);
  assert.equal((await w.call("POST", "/api/settings/discogs-token")).body.reached, true);
  assert.deepEqual((await w.call("GET", "/api/login")).body, { enabled: false, loggedIn: false });
});

test("set: what needs it is refused without a login; playing is not", async (t) => {
  const w = rig(t);
  const set = await w.call("POST", "/api/login/password", { body: { password: PW } });
  assert.equal(set.code, 200);
  assert.ok(set.cookie, "the device that set it stays logged in");
  const out = await w.call("POST", "/api/settings/discogs-token");
  assert.equal(out.code, 401, "THE one: a setting changed with no password");
  assert.deepEqual(out.body, { error: "This needs Rouen's password.", login: true });
  assert.equal((await w.call("POST", "/api/backups/abc/restore")).code, 401);
  assert.equal((await w.call("GET", "/api/backups/abc/download")).code, 401, "a backup holds the keys");
  assert.equal((await w.call("POST", "/api/play")).body.reached, true, "playing needs no password");
  assert.equal((await w.call("POST", "/api/volume")).body.reached, true);
  assert.equal((await w.call("GET", "/api/settings/qobuz")).body.reached, true, "reading Settings needs none");
  assert.equal((await w.call("POST", "/api/some-new-route")).code, 401, "a write in neither list is guarded");
  assert.equal((await w.call("POST", "/api/settings/discogs-token", { cookie: set.cookie })).body.reached, true);
});

test("the password is kept as a salted hash only", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  const s = JSON.stringify(w.settings.login);
  assert.ok(!s.includes(PW), "THE one: the password itself was stored");
  assert.match(w.settings.login.hash, /^[0-9a-f]{128}$/);
  assert.match(w.settings.login.salt, /^[0-9a-f]{32}$/);
  await w.call("POST", "/api/login/password/remove", { body: { current: PW } });
  const again = rig(t);
  await again.call("POST", "/api/login/password", { body: { password: PW } });
  assert.notEqual(again.settings.login.hash, JSON.parse(s).hash, "the same password, another salt");
});

test("logging in: the right password gives this device a lasting login; a wrong one does not", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  assert.equal((await w.call("POST", "/api/login", { body: { password: "nope nope" } })).code, 401);
  const ok = await w.call("POST", "/api/login", { body: { password: PW } });
  assert.equal(ok.code, 200);
  assert.match(ok.setCookie, /HttpOnly; SameSite=Lax; Max-Age=34560000/);
  assert.deepEqual((await w.call("GET", "/api/login", { cookie: ok.cookie })).body, { enabled: true, loggedIn: true });
  w.restart();
  assert.equal((await w.call("POST", "/api/plugins/hqplayer", { cookie: ok.cookie })).body.reached, true, "THE one: a restart logged every device out");
  w.clock += 401 * 24 * 60 * 60 * 1000;
  assert.equal((await w.call("POST", "/api/plugins/hqplayer", { cookie: ok.cookie })).code, 401, "400 days, then log in again");
});

test("five wrong passwords in a minute: that address waits a minute, others do not", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  for (let i = 0; i < 5; i++) assert.equal((await w.call("POST", "/api/login", { body: { password: "wrong " + i } })).code, 401);
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW } })).code, 429, "THE one: the sixth guess was tried");
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW }, ip: "10.0.0.9" })).code, 200);
  w.clock += 61 * 1000;
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW } })).code, 200, "a minute on, it may try again");
});

test("changing it needs the current one, and ends every other login", async (t) => {
  const w = rig(t);
  const a = await w.call("POST", "/api/login/password", { body: { password: PW } });
  const b = await w.call("POST", "/api/login", { body: { password: PW }, ip: "10.0.0.7" });
  assert.equal((await w.call("POST", "/api/login/password", { body: { password: "another one" } })).code, 401, "THE one: changed without the current password");
  const c = await w.call("POST", "/api/login/password", { body: { current: PW, password: "another one" }, cookie: a.cookie });
  assert.equal(c.code, 200);
  assert.equal((await w.call("POST", "/api/settings/x", { cookie: b.cookie })).code, 401, "the other device's login outlived the change");
  assert.equal((await w.call("POST", "/api/settings/x", { cookie: c.cookie })).body.reached, true);
  assert.equal((await w.call("POST", "/api/login/password", { body: { current: "another one", password: "short" } })).code, 400);
});

test("removing it needs the current one; then nothing is asked again", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  assert.equal((await w.call("POST", "/api/login/password/remove", { body: { current: "guess guess" } })).code, 401);
  assert.equal((await w.call("POST", "/api/login/password/remove", { body: { current: PW } })).code, 200);
  assert.equal(w.login.enabled(), false);
  assert.equal((await w.call("POST", "/api/settings/x")).body.reached, true);
});

test("ROUEN_RESET_PASSWORD: the password and every login gone", async (t) => {
  const w = rig(t);
  const a = await w.call("POST", "/api/login/password", { body: { password: PW } });
  w.login.reset("1");
  assert.equal(w.login.enabled(), false);
  await w.call("POST", "/api/login/password", { body: { password: "a new one!" } });
  assert.equal((await w.call("POST", "/api/settings/x", { cookie: a.cookie })).code, 401, "a login from before the reset still worked");
  assert.match(w.logs.join("\n"), /password removed \(ROUEN_RESET_PASSWORD\)/);
});

test("only the token's hash is kept on disk", async (t) => {
  const w = rig(t);
  const a = await w.call("POST", "/api/login/password", { body: { password: PW } });
  const disk = fs.readFileSync(path.join(w.dir, "sessions.json"), "utf8");
  assert.ok(!disk.includes(a.cookie.split("=")[1]), "THE one: the login's token itself is on disk");
});

// The review's cases (v1.9.22).
test("a password that cannot be saved changes nothing, not even in memory", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  w.saveFails = true;
  const change = await w.call("POST", "/api/login/password", { body: { current: PW, password: "another one" } });
  assert.equal(change.code, 500);
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW } })).code, 200, "THE one: the old password stopped working, the new one only in memory");
  const remove = await w.call("POST", "/api/login/password/remove", { body: { current: PW } });
  assert.equal(remove.code, 500);
  assert.equal(w.login.enabled(), true, "the password was off in memory after a removal that was not saved");
});

test("ROUEN_RESET_PASSWORD acts once for each value: a restart with it still set keeps a password set since", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  assert.equal(w.login.reset("1"), true);
  await w.call("POST", "/api/login/password", { body: { password: "the new one" } });
  w.restart();
  assert.equal(w.login.reset("1"), false);
  assert.equal(w.login.enabled(), true, "THE one: the restart after an update removed the password set since the reset");
  assert.equal(w.login.reset("2"), true, "a new value resets again");
});

test("five wrong in a minute: a whole minute's wait from the fifth, however they were spread", async (t) => {
  const w = rig(t);
  await w.call("POST", "/api/login/password", { body: { password: PW } });
  for (let i = 0; i < 5; i++) { await w.call("POST", "/api/login", { body: { password: "wrong" } }); w.clock += 14000; }
  w.clock -= 14000;                       // the fifth was at +56 s
  w.clock += 30000;                       // +86 s: the first is long out of the minute
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW } })).code, 429, "THE one: the wait ended with the first guess's minute");
  w.clock += 31000;
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW } })).code, 200);
});

test("behind a proxy that says https (first of a list), the login cookie is Secure", async (t) => {
  const w = rig(t);
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status() { return this; }, json() { return this; } };
  const routesOf = {};
  w.login.mount({ get() {}, post: (p, h) => { routesOf[p] = h; } });
  await routesOf["/api/login/password"]({ body: { password: PW }, headers: { "x-forwarded-proto": "https, http" }, ip: "1" }, res);
  assert.match(res.headers["Set-Cookie"], /; Secure$/);
});
