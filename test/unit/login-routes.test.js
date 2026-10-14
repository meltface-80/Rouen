"use strict";
// ---------------------------------------------------------------------------
// Which requests need Rouen's password (lib/login-routes.js,
// dev/design/login.md §3): the gate that every route which is not a GET is
// named — guarded or open — so a new one cannot ship without that decision,
// and the owner's line (settings and the library, not playing) as it falls
// on the routes Rouen has.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classify, needsLogin } = require("../../lib/login-routes");

const ROOT = path.resolve(__dirname, "..", "..");
function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...files(p)); } else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
/** Every route mounted with a literal path, as [METHOD, path with :params made concrete]. */
function routes() {
  const out = [];
  for (const f of [path.join(ROOT, "index.js"), ...files(path.join(ROOT, "lib"))]) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:app|router)\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g)) {
      out.push([m[1].toUpperCase(), m[2].replace(/:[a-zA-Z]+/g, "x1"), path.relative(ROOT, f)]);
    }
  }
  return out;
}

test("THE gate: every route that changes something is named guarded or open", () => {
  const all = routes();
  assert.ok(all.filter(([m]) => m !== "GET").length > 60, "the scan found too few routes to be reading them");
  const unnamed = all.filter(([m, p]) => m !== "GET" && classify(m, p) === "unknown").map(([m, p, f]) => `${m} ${p} (${f})`);
  assert.deepEqual(unnamed, [], "a write route nobody decided about — add it to GUARDED or OPEN in lib/login-routes.js");
});

test("the owner's line: settings, keys, backups, the update, Roon direct, plugins, labels, accounts", () => {
  for (const [m, p] of [["POST", "/api/settings/discogs-token"], ["POST", "/api/settings/tidal/start"], ["POST", "/api/backups"],
    ["POST", "/api/backups/upload"], ["DELETE", "/api/backups/b1"], ["POST", "/api/backups/b1/restore"], ["GET", "/api/backups/b1/download"],
    ["POST", "/api/update/apply"], ["POST", "/api/roon-direct"], ["POST", "/api/plugins/hqplayer"], ["POST", "/api/hqp/settings"],
    ["POST", "/api/labels/merge"], ["DELETE", "/api/labels/merge/k"], ["POST", "/api/labels/rescan-force"], ["POST", "/api/qobuz/favorite"],
    ["POST", "/api/tidal/unfavorite"], ["POST", "/api/qobuz/oauth/paste"], ["GET", "/api/qobuz/oauth/start"], ["GET", "/api/debug/zone-dump"],
    ["GET", "/api/debug/roon-direct"], ["GET", "/api/qobuz/oauth/callback"], ["HEAD", "/api/debug/zone-dump"]]) {
    assert.equal(needsLogin(m, p), true, `${m} ${p} is open`);
  }
});

test("…and not playing: anyone on the network still plays, as with Roon", () => {
  for (const [m, p] of [["POST", "/api/play"], ["POST", "/api/control"], ["POST", "/api/volume"], ["POST", "/api/seek"],
    ["POST", "/api/zone-settings"], ["POST", "/api/transfer-zone"], ["POST", "/api/group-outputs"], ["POST", "/api/queue/play-history-next"],
    ["POST", "/api/user-playlists/add"], ["POST", "/api/listen-later"], ["POST", "/api/login"], ["POST", "/api/update/check"],
    ["GET", "/api/settings/qobuz"], ["GET", "/api/backups"], ["GET", "/api/zones"], ["GET", "/api/image/abc"]]) {
    assert.equal(needsLogin(m, p), false, `${m} ${p} needs the password`);
  }
});

// The review (v1.9.22): Express routes "/API/backups/x/download/" to the
// download as well; the guard must see it as that route, not as an open GET.
test("THE one for the review: the path as Express routes it — any case, trailing or doubled slashes, HEAD as GET", () => {
  for (const [m, p] of [["GET", "/api/backups/b1/download/"], ["GET", "/API/Backups/b1/DOWNLOAD"], ["HEAD", "/api/backups/b1/download"],
    ["GET", "/api/debug/zone-dump/"], ["POST", "/api/settings//discogs-token"], ["POST", "/API/ROON-DIRECT/"], ["GET", "/api/qobuz/oauth/callback/"]]) {
    assert.equal(needsLogin(m, p), true, `${m} ${p} slipped past`);
  }
  assert.equal(needsLogin("POST", "/API/PLAY/"), false, "and the open ones stay open, however written");
});

test("a write in neither list is guarded; a GET in neither is not", () => {
  assert.equal(needsLogin("POST", "/api/brand-new"), true);
  assert.equal(needsLogin("GET", "/api/brand-new"), false);
});
