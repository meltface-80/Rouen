"use strict";
// ---------------------------------------------------------------------------
// N2c-0 (lib/streaming-browse-probe.js, v1.9.36, native-remote.md §10.1): what
// Roon's official browse offers for TIDAL and Qobuz, against a fake browse
// tree (test/lib/fake-roon-browse.js). The fake is not evidence of a real
// Core's tree; it holds the walk to its one rule: only lists and menus are
// opened, nothing is carried out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { walkStreaming, safeToOpen, mountStreamingBrowseProbe } = require("../../lib/streaming-browse-probe");
const { fakeBrowse, streamingTree } = require("../lib/fake-roon-browse");

test("THE one for N2c-0's browse half: each service's levels, and the menus its pages open with, with nothing carried out", async () => {
  const f = fakeBrowse(streamingTree());
  const out = await walkStreaming(f);
  assert.deepEqual(out.root.map((i) => i.title), ["Library", "TIDAL", "Qobuz", "Settings"]);
  const tidal = out.services.find((s) => s.service === "TIDAL");
  assert.equal(tidal.found, true);
  assert.deepEqual(tidal.levels[0].items.map((i) => [i.title, i.hint]),
    [["Search TIDAL", "input"], ["Play My Mix", "action"], ["What's New", "list"], ["Artists", "list"], ["My Albums", "list"]]);
  // Each page's menu by its own name: two albums' (the third album's page met but not opened), and an artist's.
  assert.deepEqual(tidal.menus.map((m) => [m.menu, m.path.slice(-1)[0]]),
    [["Play Album", "Selected Ambient Works 85-92"], ["Play Album", "Kid A"], ["Play Artist", "Aphex Twin"]]);
  assert.deepEqual(tidal.menus[0].actions.map((a) => a.title), ["Play Now", "Add Next", "Queue", "Start Radio", "Add to Library"]);
  // Every list the walk may open, opened: the artist's own Albums, and My Albums after it.
  assert.ok(tidal.levels.some((l) => l.path.join("/") === "TIDAL/Artists/Aphex Twin/Albums"), "a list under an artist's page was not walked");
  assert.ok(tidal.levels.some((l) => l.path.join("/") === "TIDAL/My Albums"), "the walk never came back up for the next list");
  assert.equal(tidal.stopped, null);
  const qobuz = out.services.find((s) => s.service === "Qobuz");
  assert.deepEqual(qobuz.menus.map((m) => m.path), [["Qobuz", "New Releases", "Homogenic"]]);
  // THE rule: nothing in the tree was carried out.
  assert.deepEqual(f.done, []);
  // No key from a level ever answers to it: what is recorded is what a person reads.
  assert.ok(!JSON.stringify(out).includes("item_key"), "an item key in the answer");
});

test("only lists and menus may be opened: never an action, an input, or an item without a key", () => {
  assert.equal(safeToOpen({ hint: "list", item_key: "k" }), true);
  assert.equal(safeToOpen({ hint: "action_list", item_key: "k" }), true);
  assert.equal(safeToOpen({ hint: "action", item_key: "k" }), false);
  assert.equal(safeToOpen({ hint: "input", item_key: "k" }), false);
  assert.equal(safeToOpen({ hint: null, item_key: "k" }), false);
  assert.equal(safeToOpen({ hint: "list" }), false);
});

test("a service Roon is not signed in to is said so, and nothing of it walked", async () => {
  const tree = streamingTree();
  tree.items = tree.items.filter((i) => i.title !== "Qobuz");
  const out = await walkStreaming(fakeBrowse(tree));
  assert.deepEqual(out.services.find((s) => s.service === "Qobuz"), { service: "Qobuz", found: false });
});

test("a tree too big for one run stops at its budget and says so, rather than walking on", async () => {
  const wide = { title: "Explore", items: [{ title: "TIDAL", hint: "list", items: Array.from({ length: 8 }, (_, i) => ({
    title: "List " + i, hint: "list", items: Array.from({ length: 5 }, (__, j) => ({ title: "Sub " + j, hint: "list", items: Array.from({ length: 5 }, (___, k) => ({ title: "Deep " + k, hint: "list", items: [] })) })) })) }] };
  const f = fakeBrowse(wide);
  const out = await walkStreaming(f, { calls: 40 });
  const tidal = out.services[0];
  assert.equal(tidal.stopped, "stopped at 40 calls");
  assert.ok(f.calls.browse + f.calls.load <= 40 + 2, "the fake saw more calls than the budget: " + (f.calls.browse + f.calls.load));
  assert.deepEqual(f.done, []);
});

test("a Core that stops answering stops the walk after three errors in a row, rather than each path waiting its turn", async () => {
  // Every list below TIDAL's own level fails to open; TIDAL itself, the way back, still does.
  const f = fakeBrowse(streamingTree(), { failOpen: (title) => !["TIDAL", "Qobuz"].includes(title) });
  const out = await walkStreaming(f);
  const tidal = out.services.find((s) => s.service === "TIDAL");
  assert.equal(tidal.stopped, "stopped after 3 errors in a row: Roon did not answer in time");
  assert.equal(tidal.levels.filter((l) => l.error).length, 3, "tried past the third");
});

test("the route: nothing without run=1; one run at a time; an error is an answer", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  let release;
  const walked = [];
  mountStreamingBrowseProbe(app, { hasCore: () => true, withBrowseSession: async () => { throw new Error("unused"); }, browse: null, load: null,
    walk: async () => { walked.push(1); await new Promise((r) => { release = r; }); return { root: [], services: [] }; } });
  const call = async (q) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/debug/streaming-browse"]({ query: q }, res);
    return res;
  };
  const idle = await call({});
  assert.deepEqual([idle.code, idle.body.ran, walked.length], [200, false, 0]);
  const first = call({ run: "1" });
  const second = await call({ run: "1" });
  assert.equal(second.code, 409);
  release();
  assert.equal((await first).body.ran, true);
  mountStreamingBrowseProbe(app, { hasCore: () => true, walk: async () => { throw new Error("Core gone"); } });
  const broke = await call({ run: "1" });
  assert.deepEqual([broke.code, broke.body.error], [500, "Core gone"]);
});
