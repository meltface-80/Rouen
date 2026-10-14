"use strict";
// ---------------------------------------------------------------------------
// A plugin whose files cannot all be loaded (v1.9.19, dev/design/plugins.md
// §4): switching it on loads them before the switch is saved, so it is not
// left on for every device and working on none. Run against a copy of
// public/ with one of HQPlayer's files missing — so this file sets
// MUSICD_PUBLIC_DIR before the harness reads it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-public-"));
fs.cpSync(path.join(__dirname, "..", "..", "public"), copy, { recursive: true });
fs.rmSync(path.join(copy, "hqp", "render.js"));
process.env.MUSICD_PUBLIC_DIR = copy;
const harness = require("./harness");

test("one of its files missing: switching it on saves nothing, and the switch goes back", async (t) => {
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  const r = harness.renderPage({ name: "plugins-load-fail", windowSize: "390x844", budgetMs: 20000, stub: `
window.__posts = [];
window.__installFetch(function (u, opts) {
  var m = (opts && opts.method) || "GET";
  if (m !== "GET") window.__posts.push(u);
  if (u.indexOf("/api/plugins") > -1) return window.__json(u.indexOf("/api/plugins/") > -1 ? { enabled: true } : [{ id: "hqplayer", name: "HQPlayer", enabled: false }]);
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`, driver: `
    await window.__sleep(500);
    await window.RouenPlugins.ready;
    var box = document.getElementById("hqp-enabled");
    box.checked = true; box.dispatchEvent(new Event("change"));
    await window.__sleep(1500);
    T("posts", window.__posts);
    T("checked", box.checked);
    T("menu", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
  ` });
  assert.deepEqual(r.posts, [], "THE one: switched on although it could not load");
  assert.equal(r.checked, false);
  assert.equal(r.menu, false);
});
