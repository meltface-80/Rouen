"use strict";
// v2.0.1-t3: Rouen's built-in Tailscale is off until it is wanted (lib/tailscale/opt-in.js, mount.js, node.js;
// dev/design/android-app.md §4.7). The owner, 2026-11-04, after a user's firewall showed Rouen 2.0 beta2 reaching
// Tailscale's control server, its log server and its relays though they had never set up Away from home. Until then it
// was on unless switched off, so every install started the engine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { signedIn, enabledFrom } = require("../../lib/tailscale/opt-in");
const { createTailscaleNode } = require("../../lib/tailscale/node");

/** tsnet's FileStore: a JSON map of state keys to base64 bytes; `_profiles` the JSON map of login profiles. */
function stateDir(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-optin-"));
  const state = { _machinekey: Buffer.from("privkey:00").toString("base64") };
  if (profiles !== undefined) state._profiles = Buffer.from(JSON.stringify(profiles)).toString("base64");
  fs.writeFileSync(path.join(dir, "tailscaled.state"), JSON.stringify(state, null, "  "));
  return dir;
}

test("THE one: a new install, its switch never set, does not run it", () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-optin-"));
  assert.equal(enabledFrom(undefined, { dir: fresh }), false, "no state at all: off");
  assert.equal(enabledFrom(undefined, { dir: stateDir(undefined) }), false, "an engine that ran and was never signed in: off");
  assert.equal(enabledFrom(undefined, { dir: stateDir({}) }), false, "no profile: off");
  assert.equal(enabledFrom(undefined, { dir: stateDir({ a1: { ID: "a1", Name: "", NodeID: "" } }) }), false, "a profile with no node: off");
});

test("an install signed in already stays on through the update; TS_AUTHKEY signs it in by itself", () => {
  const dir = stateDir({ a1: { ID: "a1", Name: "owner@example.com", NodeID: "nXyZ123CNTRL" } });
  assert.equal(signedIn(dir), true);
  assert.equal(enabledFrom(undefined, { dir }), true);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-optin-"));
  assert.equal(enabledFrom(undefined, { dir: fresh, authKey: "tskey-auth-x" }), true);
});

test("its switch decides once it is set, either way", () => {
  const dir = stateDir({ a1: { NodeID: "n1" } });
  assert.equal(enabledFrom(false, { dir, authKey: "tskey-auth-x" }), false, "switched off: off, signed in or not");
  assert.equal(enabledFrom(true, { dir: fs.mkdtempSync(path.join(os.tmpdir(), "rouen-optin-")) }), true);
});

test("a state file it cannot read is taken as never signed in", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-optin-"));
  fs.writeFileSync(path.join(dir, "tailscaled.state"), "{ not json");
  assert.equal(signedIn(dir), false);
});

test("Sign in switches it on: off, asking for a sign-in link starts it and stores the switch on", async (t) => {
  const saved = { tailscaleEnabled: undefined };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-optin-"));
  const bin = path.join(dir, "musicdnet");
  // An engine that answers /start, /status (waiting to be signed in) and /login.
  fs.writeFileSync(bin, `#!/usr/bin/env node
const http = require("http");
const srv = http.createServer((q, r) => { r.setHeader("Content-Type", "application/json");
  r.end(JSON.stringify({ ok: true, state: "NeedsLogin", auth_url: "https://login.tailscale.com/a/x" })); });
srv.listen(0, "127.0.0.1", () => { console.log("CONTROL " + srv.address().port); });
process.stdin.on("end", () => process.exit(0)); process.stdin.resume();
`, { mode: 0o755 });
  const node = createTailscaleNode({ bin, dir: path.join(dir, "tailscale"), port: 3399, version: "9.9.9",
    env: { PATH: process.env.PATH },
    enabled: () => enabledFrom(saved.tailscaleEnabled, { dir: path.join(dir, "tailscale") }),
    setEnabled: (on) => { saved.tailscaleEnabled = on; } });
  t.after(() => node.stop());
  await node.start();
  assert.equal(node.status().running, false, "off: start() starts nothing");
  assert.equal(node.status().enabled, false);
  const st = await node.login();
  assert.equal(saved.tailscaleEnabled, true, "Sign in did not switch it on");
  assert.equal(st.enabled, true);
  assert.equal(st.running, true);
});
