"use strict";
// 2.0.6-t8 (dev/design/rouen-lite.md §4; the owner: "Remove hqpweb as without a server this feature doesn't work"):
// Rouen Lite registers no HQPWeb, so the Plugins page lists nothing and its entry goes (public/plugins.js); every
// other install registers it as before.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { mountPlugins } = require("../../lib/plugins-mount");

function listed(lite) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; }, use() {} };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-plugins-"));
  mountPlugins(app, { dataDir, loadPersistedSettings: () => ({}), savePersistedSettings: () => true, zones: () => ({}), version: "0", lite });
  let body;
  routes["GET /api/plugins"]({}, { set() {}, json(b) { body = b; } });
  fs.rmSync(dataDir, { recursive: true, force: true });
  return body.map((x) => x.id);
}

test("Rouen Lite registers no HQPWeb; every other install does", () => {
  assert.deepEqual(listed(true), []);
  assert.deepEqual(listed(false), ["hqplayer"]);
});
