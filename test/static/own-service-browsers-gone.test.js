"use strict";
/*
 * own-service-browsers-gone.test.js — v1.9.72-t77: Rouen's OWN Qobuz and TIDAL browsers, catalogue routes and search
 * are gone, and stay gone.
 *
 * The owner, 2026-11-02: "Services from tidal and Qobuz logins are still showing in the app. You must remove these and
 * their code"; asked, the owner kept the sign-ins for waveforms only. v1.9.72-t76 took the Services page away; this
 * build took away everything that browsed or searched TIDAL and Qobuz through Rouen's own sign-in: the two overlays
 * and their top-bar buttons, Pitchfork's "Find on Qobuz / Tidal", the global search's Qobuz and TIDAL sections, and
 * the server routes behind them. Browsing TIDAL and Qobuz THROUGH ROON (the side menu's entries, streaming.js) stays,
 * and the last test holds that too, so this one cannot be passed by removing the wrong thing.
 *
 * WHY A GREP: index.js cannot be started here (it pairs with a Roon Core on require), so "the server answers 404" is
 * pinned as "no server file registers or names the route". A path string is the whole of a registration.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Every .js file under dir (relative to the repo root), recursively. */
function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(rel));
    else if (e.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

const GONE_ROUTES = /\/api\/(qobuz|tidal)\/(new-releases|artist-albums|featured|search)\b/;

test("the server: no file registers or names Rouen's own Qobuz/TIDAL catalogue routes", () => {
  for (const f of ["index.js", ...jsFiles("lib")]) {
    const m = read(f).match(GONE_ROUTES);
    assert.equal(m, null, f + " still has " + (m && m[0]));
  }
  for (const f of ["lib/routes/qobuz-releases.js", "lib/routes/service-search.js"]) {
    assert.equal(fs.existsSync(path.join(ROOT, f)), false, f + " is back");
  }
});

test("the server: global search's external route answers Pitchfork only", () => {
  const src = read("index.js");
  const at = src.indexOf('app.get("/api/search/external"');
  assert.ok(at > 0, "the external search route is gone (Pitchfork's part of it stays)");
  const body = src.slice(at, src.indexOf("\n});", at));
  assert.match(body, /searchPitchforkReviews/);
  assert.doesNotMatch(body, /qobuz|tidal/i, "the external search still asks Qobuz or TIDAL");
});

test("the page: no own service browser, no top-bar buttons, no hand-off into them", () => {
  const html = read("public/index.html");
  for (const id of ["qobuz-overlay", "tidal-overlay", "qobuz-toggle", "tidal-toggle", "qobuz-search-input", "tidal-search-input"]) {
    assert.ok(!html.includes('id="' + id + '"'), "index.html still has #" + id);
  }
  for (const f of jsFiles("public")) {
    const src = read(f);
    for (const s of ["qobuz-toggle", "tidal-toggle", "initServiceBrowser", "Find on Qobuz", "Find on Tidal", "extServiceSection"]) {
      assert.ok(!src.includes(s), f + " still has " + s);
    }
    const m = src.match(GONE_ROUTES);
    assert.equal(m, null, f + " still asks " + (m && m[0]));
  }
});

test("what stays: TIDAL and Qobuz through Roon, from the side menu", () => {
  const html = read("public/index.html");
  assert.match(html, /data-target="streaming-qobuz" id="menu-item-qobuz"/);
  assert.match(html, /data-target="streaming-tidal" id="menu-item-tidal"/);
  assert.match(read("public/streaming.js"), /b\.id = "streaming-" \+ service;/, "streaming.js no longer makes the side menu's buttons");
  assert.ok(fs.existsSync(path.join(ROOT, "lib/provider/public/streaming.js")));
});
