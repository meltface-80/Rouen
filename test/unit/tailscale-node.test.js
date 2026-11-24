"use strict";
// v1.9.72-t7: Tailscale built into Rouen (lib/tailscale/node.js, routes.js; dev/design/android-app.md §4.7), driven
// against a stand-in for the engine that answers its control API as the real one does (the real one, musicdnet/, is
// Mandarin's and tested there). Ported from Mandarin's test/tailscale-builtin.test.js, less its C# server.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { createTailscaleNode } = require("../../lib/tailscale/node");
const { mountTailscale, isAway, inTailnet } = require("../../lib/tailscale/routes");

// The engine's control API, as far as Rouen uses it. It writes down what it was asked, beside itself.
const STUB = `#!/usr/bin/env node
const http = require("http"), fs = require("fs"), path = require("path");
const log = path.join(__dirname, "calls.log");
const secret = process.env.MUSICDNET_SECRET;
let st = { state: "Stopped", ips: [], serving: "" };
const srv = http.createServer((req, res) => {
  if (req.headers["x-secret"] !== secret) { res.writeHead(403); return res.end(); }
  let body = ""; req.on("data", d => body += d); req.on("end", () => {
    fs.appendFileSync(log, req.method + " " + req.url + " " + body + "\\n");
    const reply = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/start") {
      const b = JSON.parse(body || "{}");
      st = b.AuthKey ? { state: "Running", ips: ["100.90.1.2", "fd7a:115c:a1e0::1"], dns_name: "rouen.tail1.ts.net.", serving: "" }
                     : { state: "NeedsLogin", auth_url: "https://login.tailscale.com/a/abc123", ips: [], serving: "" };
      return reply(st);
    }
    if (u.pathname === "/status") return reply(st);
    if (u.pathname === "/login") return reply(Object.assign(st, { auth_url: "https://login.tailscale.com/a/new456" }));
    if (u.pathname === "/logout") { st = { state: "NeedsLogin", ips: [], serving: "" }; return reply(st); }
    if (u.pathname === "/serve") { st.serving = "100.90.1.2:" + u.searchParams.get("port"); if (process.env.TS_STUB_STALE) st.online = false; return reply({ addr: st.serving }); }
    if (u.pathname === "/rebind") return reply({ ok: true });
    if (u.pathname === "/interfaces") return reply({ changed: true });
    reply({ error: "no" }, 404);
  });
});
srv.listen(0, "127.0.0.1", () => { process.stdout.write("CONTROL " + srv.address().port + "\\n"); });
process.stdin.on("end", () => process.exit(0)); process.stdin.resume();
fs.writeFileSync(path.join(__dirname, "args.txt"), process.argv.slice(2).join(" ") + "\\n" + (process.env.TS_AUTHKEY ? "leaked" : "ok"));
`;

/** @param {() => any} fn */
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => { setTimeout(r, 50); });
  }
}

function stubEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ts-"));
  const bin = path.join(dir, "musicdnet");
  fs.writeFileSync(bin, STUB, { mode: 0o755 });
  return { dir, bin, calls: () => { try { return fs.readFileSync(path.join(dir, "calls.log"), "utf8"); } catch (e) { return ""; } },
    args: () => fs.readFileSync(path.join(dir, "args.txt"), "utf8") };
}

/** A node on the stand-in, its switch in memory. */
function nodeOn(bin, env = {}, more = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-tsd-"));
  const saved = { tailscaleEnabled: undefined };
  const node = createTailscaleNode(Object.assign({ bin, dir: path.join(data, "tailscale"), port: 3399, version: "9.9.9",
    env: Object.assign({ PATH: process.env.PATH }, env),
    enabled: () => saved.tailscaleEnabled !== false, setEnabled: (on) => { saved.tailscaleEnabled = on; } }, more));
  return { node, saved, data };
}

test("started from Settings: \"rouen\", waiting to be signed in, a new link on asking; off and on again", async (t) => {
  const eng = stubEngine();
  const { node, saved } = nodeOn(eng.bin, { TS_AUTHKEY: "" });
  t.after(() => node.stop());
  await node.start();
  const st = await until(() => node.status().state === "NeedsLogin" && node.status());
  assert.equal(st.available, true);
  assert.equal(st.enabled, true);
  assert.equal(st.hostname, "rouen");
  assert.equal(st.auth_url, "https://login.tailscale.com/a/abc123");
  assert.equal(st.address, null);
  assert.match(eng.args(), /^-server -dir .*tailscale\nok$/);
  assert.match(eng.calls(), /POST \/start \{"Hostname":"rouen"/);
  assert.doesNotMatch(eng.calls(), /\/interfaces/, "a Docker or Windows Rouen lists its own interfaces: none handed over");
  assert.equal((await node.login()).auth_url, "https://login.tailscale.com/a/new456");
  const off = await node.setEnabled(false);
  assert.equal(off.enabled, false);
  assert.equal(off.state, "Stopped");
  assert.equal(saved.tailscaleEnabled, false);
  await node.setEnabled(true);
  await until(() => node.status().state === "NeedsLogin");
});

test("with TS_AUTHKEY it joins by itself and serves Rouen's port; the key goes through the API, never the engine's environment", async (t) => {
  const eng = stubEngine();
  const { node } = nodeOn(eng.bin, { TS_AUTHKEY: "tskey-auth-test" });
  t.after(() => node.stop());
  await node.start();
  const st = await until(() => node.status().serving && node.status());
  assert.equal(st.state, "Running");
  assert.equal(st.address, "http://100.90.1.2:3399");
  assert.equal(node.address(), "http://100.90.1.2:3399");
  assert.equal(st.dns_name, "rouen.tail1.ts.net");
  assert.match(eng.calls(), /POST \/serve\?port=3399&upstream=http%3A%2F%2F127\.0\.0\.1%3A3399/);
  assert.match(eng.calls(), /"AuthKey":"tskey-auth-test"/);
  assert.match(eng.args(), /\nok$/);
});

test("not in this install, or TAILSCALE=off: it says so and starts nothing", async () => {
  const a = nodeOn("/nonexistent/musicdnet", {}, { platform: "linux", arch: "x64" });
  assert.equal(a.node.status().available, false);
  await a.node.start();
  assert.equal(a.node.status().running, false);
  await assert.rejects(a.node.login(), /isn't in this install/);
  const eng = stubEngine();
  const b = nodeOn(eng.bin, { TAILSCALE: "off" });
  assert.equal(b.node.status().available, false);
});

test("in a container updated in place: the engine of its version's release, checked against its checksums", async (t) => {
  const eng = stubEngine();
  const gz = zlib.gzipSync(fs.readFileSync(eng.bin));
  const sum = crypto.createHash("sha256").update(gz).digest("hex");
  const asked = [];
  /** @param {string} sums */
  const release = (sums) => async (/** @type {string} */ u) => {
    asked.push(u);
    const body = u.endsWith("/musicdnet-SHA256SUMS") ? Buffer.from(sums) : u.endsWith("/musicdnet-linux-amd64.gz") ? gz : null;
    return { ok: !!body, status: body ? 200 : 404, arrayBuffer: async () => body };
  };
  const bad = nodeOn("/nonexistent/musicdnet", { DOCKER: "1" }, { platform: "linux", arch: "x64", fetch: release("0".repeat(64) + "  musicdnet-linux-amd64.gz\n") });
  t.after(() => bad.node.stop());
  await bad.node.start();
  assert.match(bad.node.status().error || "", /checksum mismatch/);
  assert.equal(bad.node.status().running, false);
  const good = nodeOn("/nonexistent/musicdnet", { DOCKER: "1" }, { platform: "linux", arch: "x64", fetch: release(sum + "  musicdnet-linux-amd64.gz\n") });
  t.after(() => good.node.stop());
  await good.node.start();
  await until(() => good.node.status().state === "NeedsLogin");
  assert.ok(asked.includes("https://github.com/meltface-80/Rouen/releases/download/v9.9.9/musicdnet-SHA256SUMS"), asked.join("\n"));
  assert.equal(fs.readFileSync(path.join(good.data, "bin", "musicdnet.version"), "utf8"), "9.9.9");
});

test("the watchdog: Running but not online, it is asked to rebind, then started afresh", async (t) => {
  const eng = stubEngine();
  const lines = [];
  const { node } = nodeOn(eng.bin, { TS_AUTHKEY: "k", TS_STUB_STALE: "1" }, { watchdog: { rebindMs: 1, restartMs: 1 }, pollMs: 50, log: (l) => lines.push(l) });
  t.after(() => node.stop());
  await node.start();
  await until(() => /POST \/rebind/.test(eng.calls()), 20000);
  await until(() => lines.some((l) => /starting the engine afresh/.test(l)), 20000);
});

test("away: a request the engine passed on from the tailnet; Settings' changes refused from there", async () => {
  assert.equal(inTailnet("100.64.0.1"), true);
  assert.equal(inTailnet("100.127.255.254"), true);
  assert.equal(inTailnet("100.128.0.1"), false);
  assert.equal(inTailnet("192.168.1.20"), false);
  assert.equal(inTailnet("fd7a:115c:a1e0::5"), true);
  assert.equal(isAway({ socket: { remoteAddress: "127.0.0.1" }, ip: "100.90.1.7" }), true);
  assert.equal(isAway({ socket: { remoteAddress: "::ffff:127.0.0.1" }, ip: "::ffff:100.90.1.7" }), true);
  assert.equal(isAway({ socket: { remoteAddress: "192.168.1.20" }, ip: "100.90.1.7" }), false, "only the engine, on loopback, is believed");
  assert.equal(isAway({ socket: { remoteAddress: "127.0.0.1" }, ip: "127.0.0.1" }), false);
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  let asked = 0;
  mountTailscale(app, { tailscale: /** @type {any} */ ({ status: () => ({ state: "Running" }), login: async () => { asked++; return {}; },
    logout: async () => { asked++; return {}; }, setEnabled: async () => { asked++; return {}; } }) });
  const call = (key, req) => new Promise((resolve) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    routes[key](Object.assign({ body: {} }, req), res);
  });
  const away = { socket: { remoteAddress: "127.0.0.1" }, ip: "100.90.1.7" };
  const home = { socket: { remoteAddress: "192.168.1.20" }, ip: "192.168.1.20" };
  assert.deepEqual(await call("GET /api/tailscale", away), { code: 200, body: { state: "Running", away: true } });
  for (const k of ["POST /api/tailscale/login", "POST /api/tailscale/logout", "POST /api/tailscale/enable"]) {
    assert.equal((await call(k, away)).code, 403, k);
    assert.equal((await call(k, home)).code, 200, k);
  }
  assert.equal(asked, 3);
});

// 2.0.6-t10 (L4, dev/design/rouen-lite.md §5.1): Rouen Lite runs the engine its APK carries, and hands it the device's
// interfaces as the app wrote them (Android 11+ won't let the engine list them): before /start, and again on change.
test("Rouen Lite: the device's interfaces handed over before /start, and again only when they change", async (t) => {
  const eng = stubEngine();
  const ifFile = path.join(eng.dir, "interfaces.txt");
  fs.writeFileSync(ifFile, "default wlan0\nwlan0 30 1500 up|multicast 192.168.0.64/24\n");
  const { node } = nodeOn(eng.bin, { TS_AUTHKEY: "", TS_HOSTNAME: "rouen-lite", MUSICDNET_INTERFACES: ifFile }, { pollMs: 50 });
  t.after(() => node.stop());
  await node.start();
  await until(() => node.status().state === "NeedsLogin");
  const calls = eng.calls();
  const sent = calls.indexOf("POST /interfaces default wlan0"), started = calls.indexOf("POST /start");
  assert.ok(sent >= 0, calls);
  assert.ok(sent < started, "THE one: before /start, so the engine knows the network it joins from");
  assert.match(calls, /POST \/start \{"Hostname":"rouen-lite"/);
  await new Promise((r) => { setTimeout(r, 300); });
  assert.equal((eng.calls().match(/POST \/interfaces/g) || []).length, 1, "unchanged: not handed over again");
  fs.writeFileSync(ifFile, "default rmnet0\nrmnet0 12 1500 up 10.1.2.3/32\n");
  await until(() => /POST \/interfaces default rmnet0/.test(eng.calls()));
  assert.equal((eng.calls().match(/POST \/interfaces/g) || []).length, 2);
});

test("Rouen Lite: interfaces the engine refuses don't stop it starting", async (t) => {
  const eng = stubEngine();
  fs.writeFileSync(eng.bin, STUB.replace('if (u.pathname === "/interfaces") return reply({ changed: true });', 'if (u.pathname === "/interfaces") return reply({ error: "bad line" }, 400);'), { mode: 0o755 });
  const ifFile = path.join(eng.dir, "interfaces.txt");
  fs.writeFileSync(ifFile, "garbage\n");
  const lines = [];
  const { node } = nodeOn(eng.bin, { TS_AUTHKEY: "", MUSICDNET_INTERFACES: ifFile }, { log: (l) => lines.push(l) });
  t.after(() => node.stop());
  await node.start();
  await until(() => node.status().state === "NeedsLogin");
  assert.ok(lines.some((l) => /couldn't hand the engine the device's interfaces: HTTP 400/.test(l)), lines.join("\n"));
});
