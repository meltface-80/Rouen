"use strict";
// ---------------------------------------------------------------------------
// The plugin host (lib/plugins.js, dev/design/plugins.md §3): off, a plugin's
// routes answer 404 before any of its code runs and its service is never
// made; on, made on first use; off again, closed. HQPlayer is described to it
// by lib/hqp/plugin.js, under the switch it has always had.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPluginHost } = require("../../lib/plugins");
const { hqpPlugin } = require("../../lib/hqp/plugin");

/** An app that records its routes, and a way to call them. */
function fakeApp() {
  const gets = new Map(), posts = [], uses = [];
  const app = {
    get: (p, h) => { gets.set(p, h); },
    post: (p, h) => { posts.push([p, h]); },
    use: (p, h) => { uses.push([p, h]); },
  };
  const res = () => ({ code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  async function call(method, url, body) {
    const r = res();
    if (method === "GET" && gets.has(url)) { gets.get(url)({ params: {}, body }, r); return r; }
    for (const [p, h] of posts) {
      const m = new RegExp("^" + p.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$").exec(url);
      if (method === "POST" && m) { h({ params: m.groups || {}, body }, r); return r; }
    }
    for (const [p, h] of uses) {
      if (url === p || url.startsWith(p + "/")) {
        let nexted = false;
        await h({ method, path: url.slice(p.length) || "/", body, headers: { "content-type": "application/json" } }, r, () => { nexted = true; });
        await new Promise((d) => { setImmediate(d); });   // a service answers when its promise settles
        if (nexted) r.code = 404;
        return r;
      }
    }
    r.code = 404;
    return r;
  }
  return { app, call };
}

function rig(initial) {
  const store = Object.assign({}, initial);
  const made = [];
  const host = createPluginHost({ getSettings: () => store, saveSettings: (p) => { Object.assign(store, p); return true; } });
  host.register({
    id: "thing", name: "Thing", prefix: "/api/thing", settingKey: "thingEnabled",
    create: () => {
      const svc = { closed: 0, calls: 0,
        mount(app) { app.use("/api/thing", (req, res) => { svc.calls++; res.json({ path: req.path }); }); },
        close() { svc.closed++; } };
      made.push(svc);
      return svc;
    },
  });
  const { app, call } = fakeApp();
  host.mount(app);
  return { store, made, host, call };
}

test("off: the routes answer 404 before any of the plugin's code runs, and no service is made", async () => {
  const w = rig({});
  const r = await w.call("GET", "/api/thing/now");
  assert.equal(r.code, 404);
  assert.deepEqual(r.body, { error: "Thing is off" });
  assert.equal(w.made.length, 0, "THE one: off, the plugin's service was made");
  // v1.9.34 (plugins.md §7): with what its card shows — none given here, and Rouen's version.
  assert.deepEqual((await w.call("GET", "/api/plugins")).body, [{ id: "thing", name: "Thing", enabled: false,
    version: require("../../package.json").version, summary: "", author: "", credit: null }]);
});

test("on: made on first use, once, and its routes answer", async () => {
  const w = rig({ thingEnabled: true });
  assert.equal(w.made.length, 0, "not before a request");
  assert.deepEqual((await w.call("GET", "/api/thing/now")).body, { path: "/now" });
  await w.call("GET", "/api/thing/x");
  assert.equal(w.made.length, 1);
  assert.equal(w.made[0].calls, 2);
});

test("switched off: saved, the service closed and dropped, its routes 404 again", async () => {
  const w = rig({ thingEnabled: true });
  await w.call("GET", "/api/thing/now");
  const r = await w.call("POST", "/api/plugins/thing", { enabled: false });
  assert.deepEqual(r.body, { id: "thing", name: "Thing", enabled: false });
  assert.equal(w.store.thingEnabled, false);
  await new Promise((d) => { setImmediate(d); });
  assert.equal(w.made[0].closed, 1, "THE one: switched off, the service kept running");
  assert.equal(w.host.running("thing"), false);
  assert.equal((await w.call("GET", "/api/thing/now")).code, 404);
  assert.equal(w.made[0].calls, 1);
  await w.call("POST", "/api/plugins/thing", { enabled: true });
  assert.deepEqual((await w.call("GET", "/api/thing/now")).body, { path: "/now" });
  assert.equal(w.made.length, 2, "on again: a fresh service");
});

test("the switch's setting written another way (a plugin's own old route): off just the same", async () => {
  const w = rig({ thingEnabled: true });
  await w.call("GET", "/api/thing/now");
  w.store.thingEnabled = false;
  assert.equal((await w.call("GET", "/api/thing/now")).code, 404);
  await new Promise((d) => { setImmediate(d); });
  assert.equal(w.made[0].closed, 1);
});

test("the switch's route refuses what is not a switch", async () => {
  const w = rig({});
  assert.equal((await w.call("POST", "/api/plugins/thing", { enabled: "yes" })).code, 400);
  assert.equal((await w.call("POST", "/api/plugins/nothing", { enabled: true })).code, 404);
  assert.equal(w.store.thingEnabled, undefined);
});

test("HQPlayer as a plugin: its switch is hqpEnabled, so a new install is off and an existing one keeps its state", async () => {
  const p = hqpPlugin({ getSettings: () => ({}), saveSettings: () => true, zones: () => ({}) });
  assert.deepEqual([p.id, p.name, p.prefix, p.settingKey], ["hqplayer", "HQPWeb", "/api/hqp", "hqpEnabled"]);
  for (const [settings, on] of [[{}, false], [{ hqpEnabled: true }, true], [{ hqpEnabled: false }, false]]) {
    const host = createPluginHost({ getSettings: () => settings, saveSettings: () => true });
    host.register(p);
    const { app, call } = fakeApp();
    host.mount(app);
    assert.equal((await call("GET", "/api/plugins")).body[0].enabled, on, JSON.stringify(settings));
  }
});

test("HQPlayer as a plugin: off, /api/hqp answers 404; on, the real service answers", async () => {
  const store = {};
  const host = createPluginHost({ getSettings: () => store, saveSettings: (x) => { Object.assign(store, x); return true; } });
  host.register(hqpPlugin({ getSettings: () => store, saveSettings: (x) => { Object.assign(store, x); return true; }, zones: () => ({}) }));
  const { app, call } = fakeApp();
  host.mount(app);
  assert.equal((await call("GET", "/api/hqp/settings")).code, 404);
  await call("POST", "/api/plugins/hqplayer", { enabled: true });
  const r = await call("GET", "/api/hqp/settings");
  assert.equal(r.code, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.credit_hidden, false);
  // "Don't show this again" on the credit box: saved with the rest, for every device.
  const hidden = await call("POST", "/api/hqp/settings", { credit_hidden: true });
  assert.equal(hidden.body.credit_hidden, true);
  assert.equal(store.hqpCreditHidden, true);
  assert.equal(store.hqpEnabled, true, "hiding the credit left the switch alone");
  assert.equal((await call("POST", "/api/hqp/settings", { credit_hidden: "yes" })).code, 400);
  await call("POST", "/api/plugins/hqplayer", { enabled: false });
});

test("switched on again: a service held from before goes, and the next request makes a fresh one", async () => {
  const w = rig({ thingEnabled: true });
  await w.call("GET", "/api/thing/now");
  await w.call("POST", "/api/plugins/thing", { enabled: true });
  await new Promise((d) => { setImmediate(d); });
  assert.equal(w.made[0].closed, 1, "THE one: a service made under older settings was kept");
  await w.call("GET", "/api/thing/now");
  assert.equal(w.made.length, 2);
});

test("a service that mounts anything narrower than its whole prefix is refused, not run for every request", () => {
  const store = { thingEnabled: true };
  const host = createPluginHost({ getSettings: () => store, saveSettings: () => true });
  host.register({ id: "thing", name: "Thing", prefix: "/api/thing", settingKey: "thingEnabled",
    create: () => ({ mount(app) { app.use("/api/thing/presets", () => {}); }, close() {} }) });
  const { app, call } = fakeApp();
  host.mount(app);
  return assert.rejects(call("GET", "/api/thing/presets"), /may mount only use\(\/api\/thing, handler\)/);
});

test("HQPlayer switched off is drained, as a save that switches it off is: a watched change can still roll back", () => {
  const svc = hqpPlugin({ getSettings: () => ({}), saveSettings: () => true, zones: () => ({}) }).create();
  assert.equal(svc.close.name, "retire", "closed outright: a change being watched would be cut off");
});

// v1.9.26: Rouen's account guards every request under /api/; a plugin outside it would not be.
test("a plugin's prefix must be /api/<name>", () => {
  const host = createPluginHost({ getSettings: () => ({}), saveSettings: () => true });
  for (const prefix of ["/hqp", "/", "/api", "/api/", "/api/a/b", "api/x", "/API/x"]) {
    assert.throws(() => host.register({ id: "x", name: "X", prefix, settingKey: "xOn", create: () => ({ mount() {}, close() {} }) }),
      /must be \/api\/<name>/, prefix + " was accepted");
  }
  host.register({ id: "y", name: "Y", prefix: "/api/y-1", settingKey: "yOn", create: () => ({ mount() {}, close() {} }) });
});

test("v1.9.34: HQPlayer's card says what it is, who made it and what it is built on, linked", () => {
  const { hqpPlugin } = require("../../lib/hqp/plugin");
  const p = hqpPlugin(/** @type {any} */ ({}));
  assert.match(p.summary, /HQPlayer/);
  assert.deepEqual(p.credit, { name: "hqpweb", by: "statelycurmudgeon", url: "https://github.com/statelycurmudgeon/hqpweb" });
});
