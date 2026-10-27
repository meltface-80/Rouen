"use strict";
// ---------------------------------------------------------------------------
// lib/update-routes.js (v1.9.18): the self-updater's wiring, moved out of
// index.js unchanged — what it is built with, its check at startup, and its
// three routes. The updater itself is in updater-image.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { repoOf, updaterOptions, mountUpdateRoutes, startUpdateChecks } = require("../../lib/update-routes");

test("releases are looked for in the package's own repository, else the original", () => {
  assert.deepEqual(repoOf({ repository: { url: "git+https://github.com/meltface-80/Rouen.git" } }), { owner: "meltface-80", repo: "Rouen" });
  assert.deepEqual(repoOf({ homepage: "https://github.com/someone/fork" }), { owner: "someone", repo: "fork" });
  assert.deepEqual(repoOf({}), { owner: "meltface-80", repo: "MusicD-Remote" });
});

test("the updater's options, from the package and the environment", () => {
  const o = updaterOptions({ pkg: { version: "1.9.18", repository: { url: "https://github.com/meltface-80/Rouen" } }, dir: "/app", debug: false,
    env: { RRA_VIA_LAUNCHER: "1", RRA_GITHUB_TOKEN: "t", MUSICD_IMAGE: " ghcr.io/meltface-80/musicd-remote " } });
  assert.deepEqual(o, { owner: "meltface-80", repo: "Rouen", currentVersion: "1.9.18", dir: "/app", viaLauncher: true, token: "t",
    image: "ghcr.io/meltface-80/musicd-remote", windows: false, debug: false });
  const bare = updaterOptions({ pkg: { version: "1" }, dir: "/a", debug: true, env: {} });
  assert.equal(bare.viaLauncher, false);
  assert.equal(bare.token, null);
  assert.equal(bare.image, "");
  // The Windows executable names itself (v1.9.67-t7, lib/windows-bootstrap.js).
  assert.equal(updaterOptions({ pkg: { version: "1" }, dir: "/a", debug: true, env: { RRA_WINDOWS_EXE: "C:\\Rouen.exe" } }).windows, true);
  assert.equal(updaterOptions({ pkg: { version: "1" }, dir: "/a", debug: true, env: { RRA_WINDOWS_EXE: " " } }).windows, false);
});

/** An app that records its routes, and a request to one of them. */
function rig(status, deps) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  const calls = { check: 0, apply: 0, changed: 0 };
  const updater = {
    getStatus: () => status,
    checkNow: async () => { calls.check++; return status; },
    apply: async () => { calls.apply++; },
  };
  mountUpdateRoutes(app, { updater, isDocker: () => true, changed: () => { calls.changed++; }, ...(deps || {}) });
  const call = async (key) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key]({}, res);
    await new Promise((r) => { setImmediate(r); });
    return res;
  };
  return { call, calls };
}

test("the three routes: status, check, apply", async () => {
  const r = rig({ available: true, latest: "1.9.19" });
  assert.deepEqual((await r.call("GET /api/update/status")).body, { available: true, latest: "1.9.19", is_docker: true });
  await r.call("POST /api/update/check");
  assert.deepEqual([r.calls.check, r.calls.changed], [1, 1], "a check refreshes the status line and Roon's Settings page");
  const applied = await r.call("POST /api/update/apply");
  assert.equal(applied.body.ok, true);
  assert.equal(r.calls.apply, 1);
  assert.equal(r.calls.changed, 2);
});

// The web app shows "Switch to Docker", with systemd commands, to every
// install whose status says is_docker: false. The Windows executable (which
// the updater's status knows, from updaterOptions) is a native install with
// nothing to switch to, so its status spares it the banner as the image's
// does — the field reads "no banner" — with `windows` beside it saying so.
test("the Windows build is spared the Switch-to-Docker banner, and says it is the Windows build", async () => {
  const w = rig({ available: false, windows: true }, { isDocker: () => false });
  assert.deepEqual((await w.call("GET /api/update/status")).body, { available: false, windows: true, is_docker: true });
  const native = rig({ available: false, windows: false }, { isDocker: () => false });
  assert.deepEqual((await native.call("GET /api/update/status")).body, { available: false, windows: false, is_docker: false },
    "a Linux native install still gets the banner");
});

test("apply with nothing to install: 409, after one more look", async () => {
  const r = rig({ available: false });
  const res = await r.call("POST /api/update/apply");
  assert.equal(res.code, 409);
  assert.equal(res.body.error, "No update available");
  assert.deepEqual([r.calls.check, r.calls.apply], [1, 0]);
});

test("the check runs once at startup, and a failed one still refreshes the status line", async () => {
  let checks = 0, pushed = 0;
  startUpdateChecks({ updater: { checkNow: async () => { checks++; throw new Error("offline"); } }, everyMs: 3600000,
    pushStatus: () => { pushed++; }, refreshSettings: () => {} });
  await new Promise((r) => { setImmediate(r); });
  assert.deepEqual([checks, pushed], [1, 1]);
});
