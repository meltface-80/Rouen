"use strict";
/*
 * iBroadcast's sign-in (2.0.6-t1, dev/design/ibroadcast.md §3.1, §3.3), against a stand-in on loopback
 * (test/lib/fake-ibroadcast.js), through the plugin's routes: a code asked for with Mandarin's client id and read-only
 * scopes, shown, and asked after until approved; the account read, never a token in an answer; the library read once
 * signed in; a stale token renewed once and the call made again; signed out here and at iBroadcast; a code turned down,
 * an app not let sign in with a code, and the plugin removed mid-sign-in.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeIBroadcast } = require("../lib/fake-ibroadcast");
const { createIBroadcastService } = require("../../lib/ibroadcast/service");
const { renewDue, CLIENT_ID } = require("../../lib/ibroadcast/api");

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function until(fn, ms = 8000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(50);
  }
}

const ALBUMS = [
  { id: 1, name: "Kick", artist: { id: 10, name: "INXS" }, year: 1987, tracks: [
    { id: 101, title: "Guns in the Sky", track: 1, size: 20e6 }, { id: 102, title: "New Sensation", track: 2, size: 25e6 }] },
  { id: 2, name: "Breakfast", artist: { id: 11, name: "Tina Turner" }, tracks: [{ id: 201, title: "Let's Stay Together", track: 1, type: "audio/mpeg", size: 5e6 }] },
];

/** A service against the fake, with its settings in memory and its data in a folder of its own. */
async function world(t, fakeOpts = {}) {
  const ib = await new FakeIBroadcast(Object.assign({ albums: ALBUMS }, fakeOpts)).start();
  t.after(() => ib.stop());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ib-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  /** @type {Record<string, any>} */
  const store = {};
  const lines = [];
  const svc = createIBroadcastService({ load: () => store, save: (p) => { Object.assign(store, p); return true; }, dataDir, version: "2.0.6-t1",
    base: ib.base, log: (l) => lines.push(l) });
  t.after(() => svc.close());
  const call = async (method, p) => (await svc.dispatch({ method, path: p, headers: method === "GET" ? {} : { "content-type": "application/json" } }));
  return { ib, svc, store, lines, dataDir, call, state: async () => (await call("GET", "/status")).body };
}

test("signed in with a code: the account read, the library read, never a token in an answer", async (t) => {
  const w = await world(t);
  w.ib.slowOnce = false;
  assert.deepEqual(await w.state(), { connected: false }, "signed out, nothing under way");
  const refused = await w.svc.dispatch({ method: "POST", path: "/signin", headers: {} });
  assert.equal(refused.status, 415, "a write that isn't JSON is refused, as HQPWeb's are");

  const begun = await w.call("POST", "/signin");
  assert.equal(begun.status, 200, JSON.stringify(begun.body));
  assert.match(begun.body.pending.url, /^https:\/\/media\.ibroadcast\.com\/device\?code=/);
  assert.match(begun.body.pending.code, /^[0-9A-F]{6}$/);
  const asked = [...w.ib.codes.values()][0];
  assert.equal(asked.clientId, CLIENT_ID, "Mandarin's app (the owner, 2026-11-20)");
  assert.equal(CLIENT_ID, "15389a47e1c211f1b50eb49691aa2236");
  assert.deepEqual(asked.scope.split(" ").sort(), ["user.account:read", "user.library:read"], "read only: no upload, no library write");
  assert.equal((await w.call("POST", "/signin")).body.pending.code, begun.body.pending.code, "one under way: the same code");

  await until(() => w.ib.polls >= 1, 5000, "the first ask");
  assert.equal((await w.state()).connected, false, "not approved yet");
  w.ib.approve();
  const first = await until(async () => { const x = await w.state(); return x.connected && x; }, 8000, "the sign-in");
  assert.ok(first.library.reading || first.user.name, "signed in, the page has something to go on asking after");
  const s = await until(async () => { const x = await w.state(); return x.user.name && x; }, 8000, "the account");
  assert.equal(s.user.name, "tester");
  assert.equal(s.premium, true);
  assert.deepEqual(s.formats, ["flac", "mp3", "wav"], "a playlist type (m3u) is not a format");
  assert.equal(typeof s.since, "number");

  // The library, read once the sign-in completed.
  const lib = await until(async () => { const x = await w.state(); return x.library && x.library.albums === 2 && x.library; }, 8000, "the library");
  assert.equal(lib.tracks, 3);
  assert.equal(lib.lossless, 2, "the MP3 is not lossless");
  assert.equal(lib.bytes, 50e6);
  assert.equal(lib.error, null);

  // Asked as Rouen, never as Mandarin.
  const body = w.ib.apiBodies.find((b) => b.path === "/api/status").body;
  assert.equal(body.client, "rouen");
  assert.equal(body.device_name, "Rouen");
  assert.equal(body.version, "2.0.6-t1");
  assert.equal(w.ib.apiBodies[0].agent, "rouen/2.0.6-t1");

  // Kept under one key, and never sent to the page or the log.
  assert.equal(w.store.ibroadcastToken.token.access, w.ib.access);
  assert.equal(w.store.ibroadcastToken.user.id, 4242);
  const said = JSON.stringify(await w.state()) + w.lines.join("\n");
  for (const secret of [w.ib.access, w.ib.refreshToken, "legacy-token"]) assert.ok(!said.includes(secret), "a token was shown: " + secret);
});

test("a stale token is renewed once and the call made again; a renewal due is made first", async (t) => {
  const w = await world(t);
  w.ib.slowOnce = false;
  await w.call("POST", "/signin");
  w.ib.approve();
  await until(async () => (await w.state()).library?.albums === 2, 8000, "signed in and read");
  w.ib.expire();
  const r = await w.call("POST", "/library");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(w.ib.refreshes, 1);
  assert.equal(w.store.ibroadcastToken.token.access, w.ib.access, "the new token kept");
  assert.equal(w.store.ibroadcastToken.token.refresh, w.ib.refreshToken, "the refresh token kept when none comes back");
  // A refresh token iBroadcast no longer takes: signed out, said so.
  w.ib.expire();
  w.ib.refreshToken = "rt-other";
  const gone = await w.call("POST", "/library");
  assert.equal(gone.status, 401);
  assert.equal(gone.body.connected, false);
  assert.match(gone.body.error, /refresh token is no good/);

  assert.equal(renewDue(0, 3600e3, 3600e3), false, "a fresh hour-long token is not renewed");
  assert.equal(renewDue(3000e3 + 1, 3600e3, 3600e3), true, "with ten minutes left, it is");
  assert.equal(renewDue(30e3 + 1, 60e3, 60e3), true, "a minute-long one at half its life");
  assert.equal(renewDue(30e3 - 1, 60e3, 60e3), false);
  assert.equal(renewDue(0, 60e3 - 1, null), true, "its life not known: the last minute");
});

test("signed out here and at iBroadcast: the sign-in and the library read forgotten", async (t) => {
  const w = await world(t);
  w.ib.slowOnce = false;
  await w.call("POST", "/signin");
  w.ib.approve();
  await until(async () => (await w.state()).library?.albums === 2, 8000, "signed in and read");
  const file = path.join(w.dataDir, "ibroadcast", "library.json");
  assert.ok(fs.existsSync(file), "the library kept on the data volume");
  const refresh = w.ib.refreshToken;
  const r = await w.call("POST", "/signout");
  assert.deepEqual(r.body, { connected: false });
  assert.deepEqual(w.ib.revoked, [{ refresh_token: refresh, client_id: CLIENT_ID }]);
  assert.equal(w.store.ibroadcastToken, undefined);
  assert.ok(!JSON.stringify(w.store).includes(refresh), "nothing of the sign-in left in the settings");
  assert.ok(!fs.existsSync(file), "the library read removed");
  const after = await w.call("POST", "/library");
  assert.equal(after.status, 401);
});

test("a code turned down, or an app iBroadcast won't let sign in with a code, is said on the page", async (t) => {
  const w = await world(t);
  w.ib.slowOnce = false;
  await w.call("POST", "/signin");
  w.ib.deny();
  const s = await until(async () => { const x = await w.state(); return x.pending && x.pending.error && x; }, 5000, "the refusal");
  assert.equal(s.pending.error, "The sign-in was turned down on iBroadcast");
  // Signing in again after a failure: a new code.
  const again = await w.call("POST", "/signin");
  assert.notEqual(again.body.pending.code, s.pending.code);
  assert.equal(again.body.pending.error, null);
  w.ib.refuseGrant = true;
  const r = await until(async () => { const x = await w.state(); return x.pending && x.pending.error && x; }, 5000, "the refusal");
  assert.match(r.pending.error, /allow the device code sign-in/);
  assert.equal((await w.call("POST", "/signin/cancel")).body.pending, undefined, "Cancel lets it go");
});

test("iBroadcast's slow_down is heeded, and a sign-in under way stops asking once the plugin is removed", async (t) => {
  const w = await world(t);
  await w.call("POST", "/signin");
  await until(() => w.ib.polls >= 1, 5000, "the first ask (answered slow_down)");
  await sleep(2500);
  assert.equal(w.ib.polls, 1, "asked again no sooner than five seconds later");
  w.svc.close();
  await sleep(4000);
  assert.equal(w.ib.polls, 1, "removed: nothing asks iBroadcast again");
});
