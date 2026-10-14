"use strict";
// ---------------------------------------------------------------------------
// Rouen's account (lib/login.js, dev/design/login.md; v1.9.26, the owner,
// 2026-10-14): mandatory, a username and a password, guarding all of /api/.
// Until it is made everything asks for it; once made, nothing goes without
// its login; a login lasts, survives a restart, and ends when the password
// changes; wrong tries are slowed; the hash, never the password, is kept; a
// v1.9.22 password becomes the account only with that password.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLogin, COOKIE } = require("../../lib/login");

const USER = "Lewis";
const PW = "correct horse";

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
  w.make = (user = USER, password = PW, o = {}) => w.call("POST", "/api/login/setup", Object.assign({ body: { user, password } }, o));
  return w;
}
function routes(login) {
  const r = {};
  login.mount({ get: (p, h) => { r["GET " + p] = h; }, post: (p, h) => { r["POST " + p] = h; } });
  return r;
}
test("THE one: no account yet — everything asks for one to be made, playing included", async (t) => {
  const w = rig(t);
  for (const [m, p] of [["POST", "/api/play"], ["GET", "/api/zones"], ["GET", "/api/image/k"], ["POST", "/api/settings/discogs-token"]]) {
    const r = await w.call(m, p);
    assert.equal(r.code, 401, `${m} ${p} went through with no account`);
    assert.deepEqual(r.body, { error: "Rouen's account has to be made first.", setup: true });
  }
  assert.deepEqual((await w.call("GET", "/api/login")).body, { account: false, setup: true, legacy: false, loggedIn: false });
  assert.equal((await w.call("GET", "/app.js")).body.reached, true, "a page's own file needs no account");
});

test("making it: a username and a password; this device is logged in; nothing goes without a login after", async (t) => {
  const w = rig(t);
  assert.equal((await w.make("", PW)).code, 400, "no username");
  assert.equal((await w.make(USER, "short")).code, 400, "too short a password");
  const made = await w.make();
  assert.equal(made.code, 200);
  assert.ok(made.cookie, "the device that made it is logged in");
  assert.deepEqual((await w.call("GET", "/api/login", { cookie: made.cookie })).body,
    { account: true, setup: false, legacy: false, loggedIn: true, user: USER });
  assert.equal((await w.call("POST", "/api/play", { cookie: made.cookie })).body.reached, true);
  const out = await w.call("POST", "/api/play");
  assert.equal(out.code, 401, "THE one: another device played without logging in");
  assert.deepEqual(out.body, { error: "Log in to Rouen first.", login: true });
  assert.deepEqual((await w.call("GET", "/api/login")).body, { account: true, setup: false, legacy: false, loggedIn: false },
    "a device not logged in is not told the username");
});

test("THE one for the owner: once it is made, nobody makes another", async (t) => {
  const w = rig(t);
  await w.make();
  const again = await w.make("someone", "their own password", { ip: "10.0.0.9" });
  assert.equal(again.code, 409, "a second device replaced the account");
  assert.equal(again.cookie, null);
  assert.equal(w.settings.login.user, USER);
});

test("the password is kept as a salted hash only", async (t) => {
  const w = rig(t);
  await w.make();
  const s = JSON.stringify(w.settings.login);
  assert.ok(!s.includes(PW), "THE one: the password itself was stored");
  assert.match(w.settings.login.hash, /^[0-9a-f]{128}$/);
  assert.match(w.settings.login.salt, /^[0-9a-f]{32}$/);
  const other = rig(t);
  await other.make();
  assert.notEqual(other.settings.login.hash, w.settings.login.hash, "the same password, another salt");
});

test("logging in: the right username and password give this device a lasting login; anything else does not", async (t) => {
  const w = rig(t);
  await w.make();
  const wrongPw = await w.call("POST", "/api/login", { body: { user: USER, password: "nope nope" } });
  const wrongUser = await w.call("POST", "/api/login", { body: { user: "someone", password: PW } });
  assert.deepEqual([wrongPw.code, wrongUser.code], [401, 401]);
  assert.equal(wrongPw.body.error, wrongUser.body.error, "THE one: the answer says which of the two was wrong");
  assert.equal((await w.call("POST", "/api/login", { body: { password: PW } })).code, 401, "no username");
  const ok = await w.call("POST", "/api/login", { body: { user: "  lewis ", password: PW } });
  assert.equal(ok.code, 200, "the username is not case- or space-sensitive");
  assert.match(ok.setCookie, /HttpOnly; SameSite=Lax; Max-Age=34560000/);
  w.restart();
  assert.equal((await w.call("GET", "/api/zones", { cookie: ok.cookie })).body.reached, true, "THE one: a restart logged every device out");
  w.clock += 401 * 24 * 60 * 60 * 1000;
  assert.equal((await w.call("GET", "/api/zones", { cookie: ok.cookie })).code, 401, "400 days, then log in again");
});

test("five wrong tries in a minute: that address waits a minute, others do not", async (t) => {
  const w = rig(t);
  await w.make();
  for (let i = 0; i < 5; i++) {
    const body = i % 2 ? { user: "x" + i, password: PW } : { user: USER, password: "wrong " + i };
    assert.equal((await w.call("POST", "/api/login", { body })).code, 401);
  }
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW } })).code, 429, "THE one: the sixth try was tried");
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW }, ip: "10.0.0.9" })).code, 200);
  w.clock += 61 * 1000;
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW } })).code, 200, "a minute on, it may try again");
});

test("changing the password: logged in, with the current one; every other login ends", async (t) => {
  const w = rig(t);
  const a = await w.make();
  const b = await w.call("POST", "/api/login", { body: { user: USER, password: PW }, ip: "10.0.0.7" });
  assert.equal((await w.call("POST", "/api/login/password", { body: { current: PW, password: "another one" } })).code, 401,
    "changed by a device not logged in");
  assert.equal((await w.call("POST", "/api/login/password", { body: { current: "guess guess", password: "another one" }, cookie: a.cookie })).code, 401,
    "THE one: changed without the current password");
  const c = await w.call("POST", "/api/login/password", { body: { current: PW, password: "another one" }, cookie: a.cookie });
  assert.equal(c.code, 200);
  assert.equal((await w.call("GET", "/api/zones", { cookie: b.cookie })).code, 401, "the other device's login outlived the change");
  assert.equal((await w.call("GET", "/api/zones", { cookie: c.cookie })).body.reached, true);
  assert.equal(w.settings.login.user, USER, "the username went with the change");
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: "another one" }, ip: "10.0.0.8" })).code, 200);
  assert.equal((await w.call("POST", "/api/login/password", { body: { current: "another one", password: "short" }, cookie: c.cookie })).code, 400);
});

test("changing the username: logged in, with the current password; logins stay", async (t) => {
  const w = rig(t);
  const a = await w.make();
  assert.equal((await w.call("POST", "/api/login/username", { body: { current: "wrong wrong", user: "Mo" }, cookie: a.cookie })).code, 401);
  const r = await w.call("POST", "/api/login/username", { body: { current: PW, user: " Mo " }, cookie: a.cookie });
  assert.deepEqual([r.code, r.body.user, w.settings.login.user], [200, "Mo", "Mo"]);
  assert.equal((await w.call("GET", "/api/zones", { cookie: a.cookie })).body.reached, true);
  assert.equal((await w.call("POST", "/api/login", { body: { user: "mo", password: PW }, ip: "10.0.0.3" })).code, 200);
});

test("THE one for an update: a v1.9.22 password becomes the account only with that password", async (t) => {
  const old = rig(t);
  await old.make();
  const legacyLogin = Object.assign({}, old.settings.login);
  delete legacyLogin.user;                                    // as v1.9.22 kept it
  const w = rig(t, { login: legacyLogin });
  assert.deepEqual((await w.call("GET", "/api/login")).body, { account: false, setup: true, legacy: true, loggedIn: false });
  assert.equal((await w.call("GET", "/api/zones")).body.setup, true);
  const stranger = await w.call("POST", "/api/login/setup", { body: { user: "someone", password: "their own password" } });
  assert.equal(stranger.code, 401, "THE one: the first device to arrive took an install that had a password");
  const made = await w.call("POST", "/api/login/setup", { body: { user: USER, current: PW } });
  assert.equal(made.code, 200);
  assert.equal(w.settings.login.hash, legacyLogin.hash, "the password stays the one it was");
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW }, ip: "10.0.0.2" })).code, 200);
});

test("ROUEN_RESET_PASSWORD: the account and every login gone; the next device makes a new one", async (t) => {
  const w = rig(t);
  const a = await w.make();
  w.login.reset("1");
  assert.equal(w.login.state(), "none");
  assert.equal((await w.call("GET", "/api/zones", { cookie: a.cookie })).body.setup, true, "a login from before the reset still worked");
  assert.equal((await w.make("Someone", "a new one!")).code, 200);
  assert.match(w.logs.join("\n"), /account removed \(ROUEN_RESET_PASSWORD\)/);
});

test("ROUEN_RESET_PASSWORD acts once for each value: a restart with it still set keeps an account made since", async (t) => {
  const w = rig(t);
  await w.make();
  assert.equal(w.login.reset("1"), true);
  await w.make(USER, "the new one");
  w.restart();
  assert.equal(w.login.reset("1"), false);
  assert.equal(w.login.state(), "ready", "THE one: the restart after an update removed the account made since the reset");
  assert.equal(w.login.reset("2"), true, "a new value resets again");
});

test("only the token's hash is kept on disk", async (t) => {
  const w = rig(t);
  const a = await w.make();
  const disk = fs.readFileSync(path.join(w.dir, "sessions.json"), "utf8");
  assert.ok(!disk.includes(a.cookie.split("=")[1]), "THE one: the login's token itself is on disk");
});

test("an account that cannot be saved changes nothing, not even in memory", async (t) => {
  const w = rig(t);
  const a = await w.make();
  w.saveFails = true;
  const change = await w.call("POST", "/api/login/password", { body: { current: PW, password: "another one" }, cookie: a.cookie });
  assert.equal(change.code, 500);
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW }, ip: "10.0.0.4" })).code, 200,
    "THE one: the old password stopped working, the new one only in memory");
  const rename = await w.call("POST", "/api/login/username", { body: { current: PW, user: "Mo" }, cookie: a.cookie });
  assert.equal(rename.code, 500);
  assert.equal(w.settings.login.user, USER);
  const fresh = rig(t);
  fresh.saveFails = true;
  assert.equal((await fresh.make()).code, 500);
  assert.equal(fresh.login.state(), "none", "an account was made in memory alone");
});

test("five wrong in a minute: a whole minute's wait from the fifth, however they were spread", async (t) => {
  const w = rig(t);
  await w.make();
  for (let i = 0; i < 5; i++) { await w.call("POST", "/api/login", { body: { user: USER, password: "wrong" } }); w.clock += 14000; }
  w.clock -= 14000;                       // the fifth was at +56 s
  w.clock += 30000;                       // +86 s: the first is long out of the minute
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW } })).code, 429, "THE one: the wait ended with the first try's minute");
  w.clock += 31000;
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW } })).code, 200);
});

test("behind a proxy that says https (first of a list), the login cookie is Secure", async (t) => {
  const w = rig(t);
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status() { return this; }, json() { return this; } };
  const routesOf = {};
  w.login.mount({ get() {}, post: (p, h) => { routesOf[p] = h; } });
  await routesOf["/api/login/setup"]({ body: { user: USER, password: PW }, headers: { "x-forwarded-proto": "https, http" }, ip: "1" }, res);
  assert.match(res.headers["Set-Cookie"], /; Secure$/);
});
