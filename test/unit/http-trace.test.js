"use strict";
// ---------------------------------------------------------------------------
// The debug log's request trace (lib/http-trace.js, moved out of index.js in v2.0.3-t11): one line per API request,
// and none for the paths a page asks every second or two.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mountHttpTrace, TRACE_SKIP } = require("../../lib/http-trace");

/** One request through the trace: what was logged once the answer had gone. */
function run(debug, method, url) {
  const lines = [];
  let handler = null;
  mountHttpTrace({ use: (fn) => { handler = fn; } }, { debug, log: (...parts) => lines.push(parts.slice(0, 5).join(" ")) });
  let finish = null, went = false;
  const req = { method, path: url.split("?")[0], originalUrl: url };
  handler(req, { statusCode: 200, on: (ev, fn) => { if (ev === "finish") finish = fn; } }, () => { went = true; });
  if (finish) finish();
  return { lines, went };
}

test("an API request is one line: its method, the address asked, and the status", () => {
  const r = run(true, "POST", "/api/playlist/play?x=1");
  assert.deepEqual(r.lines, ["[http] POST /api/playlist/play?x=1 -> 200"]);
  assert.equal(r.went, true, "and the request goes on to its route");
});

test("nothing is traced with debug off, or for what is not the API", () => {
  assert.deepEqual(run(false, "GET", "/api/playlists"), { lines: [], went: true });
  assert.deepEqual(run(true, "GET", "/app.js"), { lines: [], went: true });
});

test("the steady polls are left out; the actions beside them are not", () => {
  for (const poll of ["/api/zone-state?zone=z", "/api/zones", "/api/live", "/api/image/abc?size=80", "/api/hqp/now",
    "/api/playlist/play-ordered/status?zone=z1"]) {
    assert.deepEqual(run(true, "GET", poll), { lines: [], went: true }, poll);
  }
  // A sorted playlist's sending is asked about every 1.5 s for minutes; its start and its Stop are what a log wants.
  assert.equal(run(true, "POST", "/api/playlist/play-ordered").lines.length, 1);
  assert.equal(run(true, "POST", "/api/playlist/play-ordered/stop").lines.length, 1);
  assert.equal(run(true, "POST", "/api/hqp/change").lines.length, 1);
  assert.ok(!TRACE_SKIP.test("/api/zones/group"), "only the list of zones, not what is done to them");
});

test("index.js mounts it before its routes, and keeps no list of its own", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
  assert.match(src, /\nmountHttpTrace\(app, \{ debug: DEBUG \}\);\n/);
  assert.ok(!/TRACE_SKIP/.test(src));
  assert.ok(src.indexOf("mountHttpTrace(app") < src.indexOf("mountRoonPlaylist(app"), "before the routes it times");
});
