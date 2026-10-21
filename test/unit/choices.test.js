"use strict";
// ---------------------------------------------------------------------------
// The one-time choice (lib/choices.js, dev/design/login.md §5; v1.9.32, the
// owner, 2026-10-20): accounts and native mode, chosen once — at install or
// the first start after this update — and never changed after. Until it is
// made nothing guarded goes through; on an install with an account only a
// logged-in device can make it; "no accounts" removes the account in the same
// write; native mode is told the choice.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLogin, COOKIE } = require("../../lib/login");
const { createChoices } = require("../../lib/choices");

const USER = "Lewis", PW = "correct horse";
const YES = { accounts: true, native: true, understood: true };

function rig(t, start) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-choices-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = { settings: Object.assign({}, start), logs: [], native: [] };
  w.login = createLogin({ getSettings: () => w.settings, saveSettings: (p) => { Object.assign(w.settings, p); return !w.saveFails; },
    sessionsFile: path.join(dir, "sessions.json"), log: (l) => w.logs.push(l) });
  w.choices = createChoices({ getSettings: () => w.settings, saveSettings: (p) => { Object.assign(w.settings, p); return !w.saveFails; },
    login: w.login, version: "1.9.32", log: (l) => w.logs.push(l), now: () => 42 });
  w.choices.nativeWith({ optIn: () => w.native.push("in"), optOut: () => w.native.push("out") });
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  w.login.mount(app);
  w.choices.mount(app);
  w.call = async (method, p, o = {}) => {
    const res = { code: 200, body: null, headers: {}, set() {}, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; },
      status(c) { this.code = c; return this; } };
    const req = { method, path: p, body: o.body || {}, headers: { cookie: o.cookie || "" }, ip: o.ip || "10.0.0.5" };
    let passed = false;
    w.choices.guard(req, res, () => { passed = true; });
    if (passed) { const h = routes[method + " " + p]; if (h) await h(req, res); else res.json({ reached: true }); }
    const set = res.headers["Set-Cookie"];
    const m = set && new RegExp(COOKIE + "=([0-9a-f]*)").exec(set);
    return { code: res.code, body: res.body, cookie: m ? `${COOKIE}=${m[1]}` : null };
  };
  return w;
}
const PLAY = ["POST", "/api/play"];

test("THE one: a new install — nothing until the choice; then the account it chose; never chosen twice", async (t) => {
  const w = rig(t);
  for (const [m, p] of [PLAY, ["GET", "/api/zones"], ["POST", "/api/login/password"]]) {
    const r = await w.call(m, p);
    assert.deepEqual([r.code, r.body.choose], [401, true], m + " " + p + " went through before the choice");
  }
  assert.deepEqual((await w.call("GET", "/api/choices")).body, { made: false, account: false, legacy: false, loginFirst: false });
  const made = await w.call("POST", "/api/choices", { body: { accounts: true, native: false, understood: true } });
  assert.deepEqual([made.code, made.body], [200, { ok: true, accounts: true, native: false }]);
  assert.deepEqual(w.settings.choices, { accounts: true, native: false, at: 42, version: "1.9.32" });
  assert.deepEqual(w.native, ["out"], "native mode was not told it wasn't chosen");
  // Accounts chosen: now the account is made, as before.
  assert.equal((await w.call(...PLAY)).body.setup, true);
  const acct = await w.call("POST", "/api/login/setup", { body: { user: USER, password: PW } });
  assert.equal(acct.code, 200);
  assert.equal((await w.call(...PLAY, { cookie: acct.cookie })).body.reached, true);
  assert.equal((await w.call(...PLAY)).body.login, true, "with accounts, a device not logged in went through");
  // Never again, whoever asks.
  const again = await w.call("POST", "/api/choices", { body: { accounts: false, native: true, understood: true }, cookie: acct.cookie });
  assert.equal(again.code, 409);
  assert.equal(w.settings.choices.accounts, true);
  assert.deepEqual((await w.call("GET", "/api/choices")).body, { made: true, accounts: true, native: false });
});

test("no accounts: everything goes through, for ever; nothing to make or log in to", async (t) => {
  const w = rig(t);
  assert.equal((await w.call("POST", "/api/choices", { body: { accounts: false, native: true, understood: true } })).code, 200);
  assert.deepEqual(w.native, ["in"]);
  assert.equal((await w.call(...PLAY)).body.reached, true);
  assert.equal((await w.call("GET", "/api/login")).body.accounts, false);
  assert.equal((await w.call("POST", "/api/login/setup", { body: { user: USER, password: PW } })).code, 409);
  assert.equal((await w.call("POST", "/api/login", { body: { user: USER, password: PW } })).code, 409);
  assert.equal(w.login.reset("1"), false, "ROUEN_RESET_PASSWORD acted on an install without accounts");
});

test("THE one for an install with an account: only a logged-in device makes the choice; 'no' removes the account and every login", async (t) => {
  const w = rig(t, { choices: { accounts: true, native: true, at: 1, version: "x" } });
  const acct = await w.call("POST", "/api/login/setup", { body: { user: USER, password: PW } });   // as v1.9.26 made it
  delete w.settings.choices;                                                                       // and now the update
  assert.equal((await w.call("GET", "/api/choices")).body.loginFirst, true);
  for (const r of [await w.call(...PLAY), await w.call("POST", "/api/choices", { body: { accounts: false, native: false, understood: true } })]) {
    assert.deepEqual([r.code, r.body.login], [401, true], "a device not logged in reached past the account");
  }
  assert.equal(w.settings.choices, undefined, "the choice was made by a device that wasn't logged in");
  assert.equal((await w.call(...PLAY, { cookie: acct.cookie })).body.choose, true, "logged in, the choice was skipped");
  assert.equal((await w.call("GET", "/api/choices", { cookie: acct.cookie })).body.loginFirst, false);
  const no = await w.call("POST", "/api/choices", { body: { accounts: false, native: false, understood: true }, cookie: acct.cookie });
  assert.equal(no.code, 200);
  assert.equal(w.settings.login, null, "the account stayed");
  assert.equal(w.login.loggedIn({ headers: { cookie: acct.cookie } }), false, "a login outlived the account");
  assert.equal((await w.call(...PLAY)).body.reached, true);
});

test("a v1.9.22 password only: the choice needs it", async (t) => {
  const w = rig(t, { choices: { accounts: true, native: true, at: 1, version: "x" } });
  await w.call("POST", "/api/login/setup", { body: { user: USER, password: PW } });
  delete w.settings.login.user;                     // a v1.9.22 password: no username
  delete w.settings.choices;
  assert.equal((await w.call("GET", "/api/choices")).body.legacy, true);
  const wrong = await w.call("POST", "/api/choices", { body: Object.assign({ current: "not it at all" }, YES) });
  assert.equal(wrong.code, 401);
  assert.equal(w.settings.choices, undefined);
  assert.equal((await w.call("POST", "/api/choices", { body: Object.assign({ current: PW }, YES) })).code, 200);
});

test("what it takes: both answers and the understanding, or nothing changes; a failed save changes nothing", async (t) => {
  const w = rig(t);
  for (const body of [{}, { accounts: true, native: true }, { accounts: "yes", native: true, understood: true }, { accounts: true, understood: true }]) {
    assert.equal((await w.call("POST", "/api/choices", { body })).code, 400, JSON.stringify(body));
  }
  w.saveFails = true;
  const r = await w.call("POST", "/api/choices", { body: { accounts: false, native: true, understood: true } });
  assert.equal(r.code, 500);
  assert.equal(w.settings.choices, undefined, "a choice not saved was kept in memory");
  assert.deepEqual(w.native, [], "native mode was told a choice that wasn't saved");
});

test("never in a backup: a restore cannot make, change or remove the choice", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "backup.js"), "utf8");
  assert.match(/const NEVER_KEYS = \[([^\]]*)\]/.exec(src)[1], /"choices"/);
});

test("the review: one definition of 'made' — a half-written choice is no choice, to the login as to the guard", async (t) => {
  const w = rig(t, { choices: { accounts: false } });
  assert.equal((await w.call(...PLAY)).body.choose, true);
  assert.notEqual((await w.call("GET", "/api/login")).body.accounts, false, "the login took a half-written choice as 'no accounts'");
});

test("the review: the guard's 401 says when the sheet must ask for a v1.9.22 password", async (t) => {
  const w = rig(t, { choices: { accounts: true, native: true, at: 1, version: "x" } });
  await w.call("POST", "/api/login/setup", { body: { user: USER, password: PW } });
  delete w.settings.login.user;
  delete w.settings.choices;
  assert.deepEqual((await w.call(...PLAY)).body, { error: "Choose how Rouen works first.", choose: true, legacy: true });
});
