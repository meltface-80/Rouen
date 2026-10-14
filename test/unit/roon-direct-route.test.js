"use strict";
// ---------------------------------------------------------------------------
// v1.9.11: GET /api/debug/roon-direct (lib/roon-direct/route.js), and the
// three browse diagnostics moved out of index.js (lib/debug-browse-routes.js),
// driven through a stand-in Express app.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountRoonDirectProbe } = require("../../lib/roon-direct/route");
const { mountBrowseDebug } = require("../../lib/debug-browse-routes");

function fakeApp() {
  const routes = new Map();
  return { routes, get(p, h) { routes.set(p, h); } };
}
function call(handler, query) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body, headers: this.headers }); } };
    Promise.resolve(handler({ query: query || {} }, res)).catch((e) => resolve({ code: "threw", body: e.message }));
  });
}

const CORE = { host: "10.0.0.5", coreId: "01234567-89ab-cdef-0123-456789abcdef", coreName: "Nucleus" };

function probeApp(probe, core = CORE) {
  const app = fakeApp();
  const runs = [];
  mountRoonDirectProbe(app, { core: () => core, rouenAlbums: () => 8, probe: async (o) => { runs.push(o); return probe(o); } });
  return { handler: app.routes.get("/api/debug/roon-direct"), runs };
}

test("roon-direct: without run=1 it says what it would do, and connects to nothing", async () => {
  const { handler, runs } = probeApp(async () => ({ ok: true }));
  const r = await call(handler);
  assert.equal(r.code, 200);
  assert.equal(r.body.ran, false);
  assert.equal(r.body.readOnly, true);
  assert.equal(r.body.host, "10.0.0.5");
  assert.deepEqual(r.body.brokerIdsToTry.map((c) => c.label), ["core_id, .NET Guid order", "core_id, as written"]);
  assert.equal(r.body.rouenAlbums, 8);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(runs.length, 0, "THE one: a preview or prefetch never reaches the Core");
});

test("roon-direct: run=1 runs it against the paired Core, never a host from the URL", async () => {
  const { handler, runs } = probeApp(async () => ({ ok: true, sources: { local: { albums: 2 } } }));
  const r = await call(handler, { run: "1", host: "evil.example", broker: "ab".repeat(16) });
  assert.equal(r.code, 200);
  assert.equal(r.body.ran, true);
  assert.equal(r.body.sources.local.albums, 2);
  assert.deepEqual(runs, [{ host: "10.0.0.5", coreId: CORE.coreId, override: "ab".repeat(16) }]);
});

test("roon-direct: refusals", async (t) => {
  await t.test("a malformed broker id is refused before anything runs", async () => {
    const { handler, runs } = probeApp(async () => ({}));
    const r = await call(handler, { run: "1", broker: "nothex" });
    assert.equal(r.code, 400);
    assert.equal(runs.length, 0);
  });
  await t.test("not paired: 503, nothing run", async () => {
    const { handler, runs } = probeApp(async () => ({}), { host: null, coreId: null, coreName: null });
    const r = await call(handler, { run: "1" });
    assert.equal(r.code, 503);
    assert.equal(runs.length, 0);
  });
  await t.test("one run at a time: a second while the first runs is 409", async () => {
    let release = null;
    // The first run waits until released; any later run answers at once.
    const { handler, runs } = probeApp(() => (release === null ? new Promise((r) => { release = () => r({ ok: true }); }) : Promise.resolve({ ok: true })));
    const first = call(handler, { run: "1" });
    await new Promise((r) => { setImmediate(r); });
    const second = await call(handler, { run: "1" });
    assert.equal(second.code, 409);
    release();
    assert.equal((await first).code, 200);
    assert.equal(runs.length, 1);
    const third = await call(handler, { run: "1" });
    assert.equal(third.code, 200, "the lock is let go after a run");
  });
  await t.test("a probe that throws is a 500 with its message, and the lock is let go", async () => {
    const { handler } = probeApp(async () => { throw new Error("boom"); });
    assert.deepEqual([(await call(handler, { run: "1" })).code, (await call(handler, { run: "1" })).body.error], [500, "boom"]);
  });
});

// ---- the browse diagnostics, moved with behaviour unchanged -------------------

function browseApp(over) {
  const app = fakeApp();
  const level = (titles) => ({ total: titles.length, items: titles.map((t) => ({ title: t, item_key: "k:" + t })) });
  const deps = Object.assign({
    hasCore: () => true,
    withBrowseSession: async (fn) => fn("s1"),
    browse: async () => ({ action: "list" }),
    load: async () => ({ items: [{ title: "Play Album", item_key: "a" }], list: { title: "Kid A" } }),
    loadLevel: async () => level(["Library", "Qobuz", "Settings"]),
    findItemByTitle: async (s, h, title) => (title === "Qobuz" ? { title: "Qobuz", item_key: "q" } : null),
    navigateToAlbumList: async () => ({ hierarchy: "browse", total: 2 }),
    parseFilter: (q) => ({ type: q.type || null }),
  }, over || {});
  mountBrowseDebug(app, deps);
  return app.routes;
}

test("browse diagnostics: the three routes, as they were", async (t) => {
  const routes = browseApp();
  assert.deepEqual([...routes.keys()], ["/api/debug/labels", "/api/debug/filter", "/api/debug/browse-probe"]);
  await t.test("labels: the root's titles", async () => {
    const r = await call(routes.get("/api/debug/labels"));
    assert.deepEqual(r.body.root, ["Library", "Qobuz", "Settings"]);
  });
  await t.test("browse-probe: a path walked, and a missing segment says what is there", async () => {
    const ok = await call(routes.get("/api/debug/browse-probe"), { path: "Qobuz" });
    assert.deepEqual(ok.body.resolved, [{ segment: "Qobuz", matchedTitle: "Qobuz", hint: null }]);
    const missing = await call(routes.get("/api/debug/browse-probe"), { path: "Nope" });
    assert.equal(missing.code, 404);
    assert.deepEqual(missing.body.available_here, ["Library", "Qobuz", "Settings"]);
    const bad = await call(routes.get("/api/debug/browse-probe"), { album: "-1" });
    assert.equal(bad.code, 400);
  });
  await t.test("filter: the navigation's hierarchy and total", async () => {
    const r = await call(routes.get("/api/debug/filter"), { type: "genre" });
    assert.deepEqual([r.body.filter, r.body.hierarchy, r.body.total], [{ type: "genre" }, "browse", 2]);
  });
  await t.test("not paired: every one is 503", async () => {
    const off = browseApp({ hasCore: () => false });
    for (const p of off.keys()) assert.equal((await call(off.get(p))).code, 503, p);
  });
  await t.test("a browse that throws is a 500 with its message", async () => {
    const broken = browseApp({ withBrowseSession: async () => { throw new Error("core gone"); } });
    assert.deepEqual((await call(broken.get("/api/debug/labels"))).body, { error: "core gone" });
  });
});

test("roon-direct: run=1 refused while Roon direct is switched off (v1.9.20)", async () => {
  const app = fakeApp();
  const runs = [];
  mountRoonDirectProbe(app, { core: () => CORE, rouenAlbums: () => 8, enabled: () => false, probe: async (o) => { runs.push(o); return { ok: true }; } });
  const r = await call(app.routes.get("/api/debug/roon-direct"), { run: "1" });
  assert.equal(r.code, 409);
  assert.match(r.body.error, /^Roon direct is off\./);
  assert.equal(runs.length, 0, "THE one: switched off, the internal protocol was used all the same");
});
