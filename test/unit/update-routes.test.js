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
    image: "ghcr.io/meltface-80/musicd-remote", debug: false });
  const bare = updaterOptions({ pkg: { version: "1" }, dir: "/a", debug: true, env: {} });
  assert.equal(bare.viaLauncher, false);
  assert.equal(bare.token, null);
  assert.equal(bare.image, "");
});

/** An app that records its routes, and a request to one of them. */
function rig(status) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  const calls = { check: 0, apply: 0, changed: 0 };
  const updater = {
    getStatus: () => status,
    checkNow: async () => { calls.check++; return status; },
    apply: async () => { calls.apply++; },
  };
  mountUpdateRoutes(app, { updater, isDocker: () => true, changed: () => { calls.changed++; } });
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
