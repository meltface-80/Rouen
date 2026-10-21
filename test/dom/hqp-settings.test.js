"use strict";
// ---------------------------------------------------------------------------
// Settings → HQPWeb, in the real page (moved out of test/dom/hqplayer.test.js
// in v1.9.34, with the plugins page's change, plugins.md §7): installed from
// Settings → Plugins, its page holds its settings — the HQPlayer to use, Your
// setup, Find your DAC. The rig is test/lib/hqp-dom.js.
// ---------------------------------------------------------------------------

require("../lib/no-real-hqplayer");
const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { fx, stub } = require("../lib/hqp-dom");

test("Settings → HQPWeb (v1.8.74)", async (t) => {
  const f = await fx();
  const SETTINGS = `
    var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
    document.head.appendChild(st);
    document.getElementById("settings-toggle").click();
    await window.__sleep(300);
    document.querySelector('.settings-nav-item[data-pane="plugins"]').click();
    await window.__sleep(400);
  `;
  const r = harness.renderPage({
    name: "hqp-settings", windowSize: "390x844", budgetMs: 30000,
    stub: stub(f, { pluginOff: true, settings: { enabled: true, host: "", port: 4321, learned_count: 0 } }).replace(
      'window.__installFetch(function (u, opts) {',
      `window.__installFetch(function (u, opts) {
  if (u.indexOf("/api/hqp/test") > -1) {
    window.__posts.push({ url: u, method: "POST", body: JSON.parse(opts.body) });
    return window.__json({ ok: true, name: "music-pc", product: "Signalyst HQPlayer Desktop", engine: "5.35.10", version: "5" });
  }`),
    driver: `
      await window.__sleep(700); await window.RouenPlugins.ready;
      T("menu_before", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
      ${SETTINGS}
      // Installed from Settings → Plugins (v1.9.34, plugins.md §7), then its card's Settings.
      T("enabled_before", !!document.querySelector('[data-plugins="installed"] [data-plugin="hqplayer"]'));
      document.querySelector('[data-plugin-install="hqplayer"]').click();
      await window.__sleep(600);
      T("menu_after", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
      Array.prototype.find.call(document.querySelectorAll('[data-plugin="hqplayer"] button'), function (b) { return b.textContent === "Settings"; }).click();
      await window.__sleep(400);
      T("pane_title", document.querySelector('.settings-pane[data-pane="hqplayer"] h2').textContent);
      document.getElementById("hqp-host").value = "music-pc.local";
      document.getElementById("hqp-port").value = "99999";
      document.getElementById("hqp-save").click();
      await window.__sleep(200);
      T("bad_port", document.getElementById("hqp-conn-note").textContent);
      document.getElementById("hqp-port").value = "4321";
      document.getElementById("hqp-test").click();
      await window.__sleep(300);
      T("tested", document.getElementById("hqp-conn-note").textContent);
      document.getElementById("hqp-save").click();
      await window.__sleep(300);
      T("demo_switch", !!document.getElementById("hqp-demo"));
      await window.__sleep(300);
      T("posts", window.__posts);
      T("notice", document.querySelector('.settings-pane[data-pane="hqplayer"]').textContent.replace(/\\s+/g, " "));
    `,
  });
  harness.assertNoPageError(assert, r);

  await t.test("not installed by default, and no menu entry with it", () => {
    assert.equal(r.pane_title, "HQPWeb");
    assert.equal(r.enabled_before, false);
    assert.equal(r.menu_before, false, "the side menu offers HQPlayer while it is switched off");
  });
  await t.test("THE one: installing it saves it as JSON and puts HQPlayer in the side menu", () => {
    assert.deepEqual(r.posts[0], { url: "/api/plugins/hqplayer", method: "POST", type: "application/json", body: { enabled: true } });
    assert.equal(r.menu_after, true);
  });
  await t.test("a port out of range is caught before anything is sent", () => {
    assert.match(r.bad_port, /whole number from 1 to 65535/);
    assert.equal(r.posts.filter((p) => p.body && p.body.port === 99999).length, 0);
  });
  await t.test("Test asks the address as typed and says what answered", () => {
    const test = r.posts.find((p) => /\/api\/hqp\/test$/.test(p.url));
    assert.deepEqual(test.body, { host: "music-pc.local", port: 4321 });
    assert.match(r.tested, /Found “music-pc” — Signalyst HQPlayer Desktop 5\.35\.10/);
  });
  await t.test("Add sends the address (v1.8.85: to the list of HQPlayers); there is no Demo HQPlayer", () => {
    assert.ok(r.posts.some((p) => /\/api\/hqp\/players$/.test(p.url) && p.type === "application/json" &&
                                  p.body.host === "music-pc.local" && p.body.port === 4321));
    assert.equal(r.demo_switch, false, "the Demo HQPlayer switch is still on the page");
    assert.doesNotMatch(r.notice, /Demo HQPlayer/);
  });
  await t.test("the page carries the credit and the non-affiliation notice", () => {
    // v1.8.85: the credit leads the page now (pinned in hqp-players.test.js).
    assert.match(r.notice, /Built on hqpweb, by statelycurmudgeon/);
    assert.match(r.notice, /statelycurmudgeon's hard work/);
    assert.match(r.notice, /hqpweb's MIT licence/);
    assert.match(r.notice, /Not affiliated with, endorsed by, or supported by Signalyst\. HQPlayer is a trademark of its owner/);
  });
});


test("Settings → HQPWeb → Your setup, and Find your DAC (v1.8.78)", async (t) => {
  const f = await fx();
  const r = harness.renderPage({
    name: "hqp-your-setup", windowSize: "390x844", budgetMs: 30000,
    stub: stub(f, { setupNow: f.setupAnswered }),
    driver: `
      await window.__sleep(700); await window.RouenPlugins.ready;
      var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
      document.head.appendChild(st);
      document.getElementById("settings-toggle").click();
      await window.__sleep(300);
      window.__openSettingsPane("hqplayer");
      await window.__sleep(600);
      var qs = document.querySelectorAll("#hqp-setup .hqp-setup-q");
      T("questions", Array.prototype.map.call(qs, function (q) { return q.querySelector("strong").textContent; }));
      T("checked", Array.prototype.map.call(qs, function (q) { var c = q.querySelector("input:checked"); return c ? c.value : null; }));
      var amp = document.querySelector('#hqp-setup .hqp-setup-q[data-key="amp"] input[value="class-d-or-tube"]');
      amp.checked = true; amp.dispatchEvent(new Event("change"));
      await window.__sleep(400);
      T("post", window.__posts.filter(function (p) { return /\\/api\\/hqp\\/setup$/.test(p.url); }).map(function (p) { return p.body; }));
      var find = document.querySelector("#hqp-setup details.hqp-find");
      T("find_after_pcm", find && find.previousElementSibling && find.previousElementSibling.dataset.key);
      find.open = true; find.dispatchEvent(new Event("toggle"));
      await window.__sleep(500);
      T("chip_rows", find.querySelectorAll("table.hqp-dt")[0].querySelectorAll("tbody tr").length);
      var filter = find.querySelector(".hqp-dq");
      filter.value = "holo"; filter.dispatchEvent(new Event("input"));
      T("filtered_makers", Array.prototype.map.call(find.querySelectorAll(".hqp-mk th"), function (th) { return th.textContent; }));
      filter.value = "zzzz"; filter.dispatchEvent(new Event("input"));
      T("none", find.querySelectorAll("table.hqp-dt")[1].textContent.indexOf("No model matches") > -1);
      T("overflow", document.documentElement.scrollWidth - window.innerWidth);
    `,
  });
  harness.assertNoPageError(assert, r);
  await t.test("the five questions, with the saved answers ticked", () => {
    assert.deepEqual(r.questions, ["How your DAC takes DSD", "How your DAC converts PCM", "Your amplifier", "Your volume", "How the DAC connects"]);
    assert.deepEqual(r.checked, ["direct", "", "other", "fixed", ""]);
  });
  await t.test("THE one: a change is saved as it is made, as JSON", () => {
    assert.deepEqual(r.post, [{ amp: "class-d-or-tube" }]);
  });
  await t.test("Find your DAC sits under the PCM question, and filters the models", () => {
    assert.equal(r.find_after_pcm, "pcm");
    assert.ok(r.chip_rows >= 8, String(r.chip_rows));
    assert.deepEqual(r.filtered_makers, ["Holo Audio"]);
    assert.equal(r.none, true);
    assert.ok(r.overflow <= 0, "the page scrolls sideways by " + r.overflow + "px");
  });
});

