"use strict";
// ---------------------------------------------------------------------------
// Which requests need Rouen's account (lib/login-routes.js,
// dev/design/login.md §3). The owner, 2026-10-14 (v1.9.26): all of Rouen —
// every request under /api/ but the account's own four. The gate: every route
// index.js and lib/ mount is under /api/, one of the four, or an open page, so
// nothing of the user's is served where the login does not reach.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { needsLogin, OPEN, PAGES } = require("../../lib/login-routes");

const ROOT = path.resolve(__dirname, "..", "..");
function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...files(p)); } else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
/** Every route mounted with a literal path, as [METHOD, path with :params made concrete, file]. */
function routes() {
  const out = [];
  for (const f of [path.join(ROOT, "index.js"), ...files(path.join(ROOT, "lib"))]) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:app|router)\.(get|post|put|delete|patch|all)\(\s*["'`]([^"'`]+)["'`]/g)) {
      out.push([m[1].toUpperCase(), m[2].replace(/:[a-zA-Z]+/g, "x1"), path.relative(ROOT, f)]);
    }
  }
  return out;
}

test("THE gate: every route is guarded, the account's own, or an open page", () => {
  const all = routes();
  assert.ok(all.length > 150, "the scan found too few routes (" + all.length + ") to be reading them");
  const open = all.filter(([m, p]) => !needsLogin(m === "ALL" ? "GET" : m, p));
  const allowed = new Set([...OPEN.map(([m, p]) => m + " " + p), ...PAGES.map((p) => "GET " + p)]);
  const stray = open.filter(([m, p]) => !allowed.has(m + " " + p)).map(([m, p, f]) => `${m} ${p} (${f})`);
  assert.deepEqual(stray, [], "a route the login does not reach — put it under /api/, or, if it serves a page and nothing of the user's, in PAGES");
  for (const [m, p] of OPEN) assert.ok(all.some(([rm, rp]) => rm === m && rp === p), `${m} ${p} is open but no longer mounted`);
});

test("the owner's line: all of Rouen — playing, the library and the settings alike", () => {
  for (const [m, p] of [["POST", "/api/play"], ["POST", "/api/control"], ["POST", "/api/volume"], ["GET", "/api/zones"],
    ["GET", "/api/image/abc"], ["GET", "/api/random-albums"], ["GET", "/api/status"], ["GET", "/api/settings/qobuz"],
    ["POST", "/api/settings/discogs-token"], ["GET", "/api/backups/b1/download"], ["POST", "/api/update/apply"],
    ["POST", "/api/update/check"], ["GET", "/api/live"], ["GET", "/api/shelf/albums"], ["POST", "/api/listen-later"],
    ["POST", "/api/login/password"], ["POST", "/api/login/username"], ["GET", "/api"], ["DELETE", "/api/backups/b1"]]) {
    assert.equal(needsLogin(m, p), true, `${m} ${p} is open`);
  }
});

test("…but the account's own four, and the pages and their files", () => {
  for (const [m, p] of [["GET", "/api/login"], ["HEAD", "/api/login"], ["POST", "/api/login"], ["POST", "/api/login/setup"],
    ["POST", "/api/logout"], ["GET", "/"], ["GET", "/index.html"], ["GET", "/app.js"], ["GET", "/login.js"], ["GET", "/style.css"],
    ["GET", "/icons/rouen-touch-icon.png"], ["GET", "/display"], ["GET", "/shelf"]]) {
    assert.equal(needsLogin(m, p), false, `${m} ${p} needs the login`);
  }
  assert.equal(needsLogin("GET", "/api/login/setup"), true, "only the methods named are open");
  assert.equal(needsLogin("DELETE", "/api/login"), true);
});

// The review (v1.9.22): Express routes "/API/zones/" to the route as well;
// the guard must see it as that route.
test("THE one for the review: the path as Express routes it — any case, trailing or doubled slashes, HEAD as GET", () => {
  for (const [m, p] of [["GET", "/API/zones"], ["GET", "/api/zones/"], ["GET", "//api//zones"], ["HEAD", "/api/backups/b1/download"],
    ["POST", "/Api/Play/"], ["GET", "/API"], ["GET", "/api/"]]) {
    assert.equal(needsLogin(m, p), true, `${m} ${p} slipped past`);
  }
  assert.equal(needsLogin("POST", "/API/LOGIN/"), false, "and the account's own stay open, however written");
});
