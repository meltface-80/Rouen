"use strict";
// ---------------------------------------------------------------------------
// v1.9.48: Roon's own Listen Later kept read while it is looked at rides on
// every open app's live poll (lib/routes/listen-later.js registers a
// GET /api/live that passes on to index.js's own). Express runs routes in the
// order they are registered, and index.js's /api/live answers without passing
// on — so the module must be mounted BEFORE it, or the reads stop without a
// word (the owner's report: a removal in Roon showed only once the screen was
// left and opened again). This holds that order.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../index.js"), "utf8");

test("Listen later's routes are mounted before index.js's GET /api/live", () => {
  const mount = SRC.indexOf("mountListenLater(app,");
  const live = SRC.indexOf('app.get("/api/live"');
  assert.ok(mount > 0, "index.js no longer mounts lib/routes/listen-later.js as this test expects");
  assert.ok(live > 0, "index.js's GET /api/live is gone or renamed: say where the app's live poll is now");
  assert.ok(mount < live, "mountListenLater comes after GET /api/live: Roon's Listen Later would no longer be read while looked at");
});

test("the module's live hook passes the poll on", () => {
  const mod = fs.readFileSync(path.join(__dirname, "../../lib/routes/listen-later.js"), "utf8");
  const hook = mod.slice(mod.indexOf('app.get("/api/live"'));
  assert.match(hook.slice(0, hook.indexOf("\n  });")), /next\(\);/, "the hook answers the poll itself: index.js's live revisions would stop");
});
