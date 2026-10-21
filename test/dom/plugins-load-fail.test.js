"use strict";
// ---------------------------------------------------------------------------
// A plugin whose files cannot all be loaded (v1.9.19, dev/design/plugins.md
// §4; installed from its card since v1.9.34, §7): Install loads them before
// it is saved, so it is not left installed for every device and working on none. Run against a copy of
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
// The copy goes once both tests have run.
test.after(() => fs.rmSync(copy, { recursive: true, force: true }));

test("one of its files missing: Install saves nothing, and it stays under Available", async () => {
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
    document.querySelector('[data-plugin-install="hqplayer"]').click();
    await window.__sleep(1500);
    T("posts", window.__posts);
    T("checked", !!document.querySelector('[data-plugins="installed"] [data-plugin="hqplayer"]'));
    T("menu", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
  ` });
  assert.deepEqual(r.posts, [], "THE one: installed although it could not load");
  assert.equal(r.checked, false);
  assert.equal(r.menu, false);
});

test("the review: installed, but its files won't load — not shown as installed; Install offered again", async () => {
  const r = harness.renderPage({ name: "plugins-load-fail-on", windowSize: "390x844", budgetMs: 20000, stub: `
window.__installFetch(function (u) {
  if (u.indexOf("/api/plugins") > -1) return window.__json([{ id: "hqplayer", name: "HQPlayer", enabled: true }]);
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`, driver: `
    await window.__sleep(500);
    try { await window.RouenPlugins.ready; } catch (e) { /* the loader's own failure is what is tested */ }
    await window.__sleep(800);
    T("installed", !!document.querySelector('[data-plugins="installed"] [data-plugin="hqplayer"]'));
    T("install", !!document.querySelector('[data-plugin-install="hqplayer"]'));
  ` });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.installed, r.install], [false, true], "THE one: shown as installed though nothing of it could load");
});
