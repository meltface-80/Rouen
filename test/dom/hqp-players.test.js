"use strict";
// ---------------------------------------------------------------------------
// v1.8.85: several HQPlayers and the DACs behind one, on the real page — and
// the credit to hqpweb leading Settings → HQPlayer.
//
// The answers are made by the real /api/hqp handlers (players.js, service.js)
// before the browser starts, so the shapes stubbed here are the server's.
//
//   1. Settings lists the HQPlayers with the one in use marked, and Use sends
//      the choice; the DACs behind it are listed with theirs.
//   2. Find HQPlayers lists what answered, marks one already added, and Add
//      sends its address and HQPlayer's own name.
//   3. The HQPlayer screen shows a picker for each choice there is — and none
//      when there is nothing to choose — and a pick is sent as JSON.
//   4. The credit is the first thing on the page, names statelycurmudgeon and
//      links hqpweb; CrystalGipsy is thanked the same way and linked.
// ---------------------------------------------------------------------------

require("../lib/no-real-hqplayer");
const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { createHqpService } = require("../../lib/hqp/service");

async function fixtures() {
  let saved = { hqpEnabled: true };
  const svc = createHqpService({
    dataDir: null, getSettings: () => saved,
    saveSettings: (p) => { saved = Object.assign({}, saved, p); return true; },
    discover: async () => [{ address: "192.0.2.10", name: "Living room", version: "Signalyst HQPlayer Embedded 6" },
                           { address: "192.0.2.30", name: "Studio", version: "Signalyst HQPlayer Desktop 5" }],
  });
  const call = async (m, p, b) => (await svc.dispatch({ method: m, path: p, headers: { "content-type": "application/json" }, body: b })).body;
  try {
    const fx = {};
    fx.single = await call("POST", "/players", { name: "Living room", host: "192.0.2.10" });
    await call("POST", "/players", { name: "Office", host: "192.0.2.20" });
    fx.settings = await call("POST", "/players/living-room/dacs", { name: "Desk DAC", currentName: "Living room DAC" });
    fx.found = await call("POST", "/discover", {});
    // /now with nothing reachable (no HQPlayer at those addresses): the
    // pickers must still be offered — that is how one gets away from it.
    fx.now = Object.assign(await call("GET", "/settings"), { configured: true, reachable: false, error: "connect ECONNREFUSED" });
    fx.nowOne = { enabled: true, demo: false, configured: true, reachable: false, players: [{ id: "a", name: "A" }],
                  active: "a", dacs: [{ id: "main", name: "" }], dac: "main" };
    return fx;
  } finally {
    await svc.close();
  }
}

function stub(fx, over) {
  return `
window.__fx = ${JSON.stringify(Object.assign({}, fx, over || {}))};
window.__posts = [];
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (u, opts) {
  var m = (opts && opts.method) || "GET";
  if (m !== "GET") {
    var h = (opts && opts.headers) || {};
    window.__posts.push({ url: u, method: m, type: h["Content-Type"] || "", body: opts && opts.body ? JSON.parse(opts.body) : null });
  }
  if (u.indexOf("/api/hqp/discover") > -1) return window.__json(window.__fx.found);
  if (u.indexOf("/api/hqp/now") > -1) return window.__json(window.__fx.nowAnswer || window.__fx.now);
  if (u.indexOf("/api/hqp/settings") > -1 || u.indexOf("/api/hqp/players") > -1) return window.__json(window.__fx.settings);
  if (u.indexOf("/api/hqp/setup") > -1) return window.__json({ setup: {}, questions: [] });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true, available: false });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
}

const SETTINGS = `
  await window.__sleep(700);
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="hqplayer"]').click();
  await window.__sleep(500);
  var pane = document.querySelector('.settings-pane[data-pane="hqplayer"]');
  function rows(sel) {
    return Array.prototype.map.call(document.querySelectorAll(sel + " .hqp-item"), function (r) {
      return { title: r.querySelector(".hqp-item-title").textContent,
               btns: Array.prototype.map.call(r.querySelectorAll("button"), function (b) { return b.textContent; }) };
    });
  }
`;

test("Settings → HQPlayer: your HQPlayers, their DACs, and Find (v1.8.85)", { skip: !harness.available }, async () => {
  const fx = await fixtures();
  const r = harness.renderPage({ name: "hqp-players-settings", windowSize: "390x844", budgetMs: 30000, stub: stub(fx), driver: SETTINGS + `
    // 4. the credit leads the page
    var first = pane.querySelector(".settings-pane-desc").nextElementSibling;
    T("credit_first", first && first.classList.contains("hqp-credit"));
    T("credit_text", first ? first.textContent.replace(/\\s+/g, " ") : "");
    T("credit_links", Array.prototype.map.call(pane.querySelectorAll(".hqp-credit a"), function (a) { return a.href; }));
    var cr = first.getBoundingClientRect();
    T("credit_visible", cr.top < window.innerHeight && cr.height > 60);

    // 1. the list, and the DACs
    T("players", rows("#hqp-players"));
    T("dacs", rows("#hqp-dacs"));
    T("dacs_for", document.getElementById("hqp-dacs-for").textContent);
    document.querySelector('#hqp-players .hqp-item[data-id="office"] button').click();
    await window.__sleep(300);
    document.querySelector('#hqp-dacs .hqp-item:nth-child(2) button').click();
    await window.__sleep(300);

    // 2. Find
    document.getElementById("hqp-find").click();
    await window.__sleep(400);
    T("found", rows("#hqp-found"));
    T("found_note", document.getElementById("hqp-find-note").textContent);
    var add = document.querySelector("#hqp-found .hqp-item:nth-child(2) button");
    if (add) add.click();
    await window.__sleep(400);
    T("posts", window.__posts);
    var sheet = document.querySelector("#settings-overlay .settings-sheet");
    T("overflow_x", sheet.scrollWidth - sheet.clientWidth);
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.credit_first, true, "the credit is the first thing under the page's heading");
  assert.match(r.credit_text, /statelycurmudgeon/);
  assert.match(r.credit_text, /hard work/);
  assert.match(r.credit_text, /CrystalGipsy/);
  assert.ok(r.credit_links.includes("https://github.com/statelycurmudgeon/hqpweb"));
  assert.ok(r.credit_links.includes("https://github.com/SimonArnold002/LMS-HQPlayer-Bridge"));
  assert.equal(r.credit_visible, true);

  assert.deepEqual(r.players.map((x) => x.title), ["Living roomIn use", "Office"]);
  assert.deepEqual(r.players[0].btns, ["Rename", "Remove"]);
  assert.deepEqual(r.players[1].btns, ["Use", "Rename", "Remove"]);
  assert.deepEqual(r.dacs.map((x) => x.title), ["Living room DACIn use", "Desk DAC"]);
  assert.deepEqual(r.dacs[0].btns, ["Rename"], "the first DAC can be renamed, not removed");
  assert.match(r.dacs_for, /Behind Living room/);

  assert.deepEqual(r.found.map((x) => x.title), ["Living room", "Studio"]);
  assert.deepEqual(r.found[0].btns, [], "one already in the list is marked Added, with nothing to tap");
  const posts = r.posts.map((p) => [p.method, p.url.replace(/^.*\/api\/hqp/, ""), p.type, p.body]);
  assert.deepEqual(posts, [
    ["POST", "/players/office/select", "application/json", {}],
    ["POST", "/players/living-room/dac", "application/json", { dac: "desk-dac" }],
    ["POST", "/discover", "application/json", {}],
    ["POST", "/players", "application/json", { name: "Studio", host: "192.0.2.30" }],
  ]);
  assert.equal(r.overflow_x, 0);
});

test("the HQPlayer screen: a picker for each choice there is (v1.8.85)", { skip: !harness.available }, async () => {
  const fx = await fixtures();
  const OPEN = `
    await window.__sleep(700);
    document.getElementById("menu-toggle").click();
    await window.__sleep(300);
    document.getElementById("menu-item-hqplayer").click();
    await window.__sleep(1500);
    function pick(label) {
      var p = Array.prototype.find.call(document.querySelectorAll(".hqp-picker"), function (x) { return x.firstChild.textContent === label; });
      if (!p) return null;
      var hidden = !!p.closest(".hidden");
      var sel = p.querySelector("select");
      return { hidden: hidden, value: sel.value, options: Array.prototype.map.call(sel.options, function (o) { return o.textContent; }) };
    }
  `;
  const two = harness.renderPage({ name: "hqp-players-screen", windowSize: "390x844", budgetMs: 30000, stub: stub(fx), driver: OPEN + `
    T("player", pick("HQPlayer"));
    T("dac", pick("DAC"));
    T("notice", !document.querySelector(".hqp-notice").classList.contains("hidden"));
    var s = document.querySelector('.hqp-picker select[aria-label="Which DAC HQPlayer is using"]');
    s.value = "desk-dac";
    s.dispatchEvent(new Event("change"));
    await window.__sleep(300);
    var p = document.querySelector('.hqp-picker select[aria-label="Which HQPlayer"]');
    p.value = "office";
    p.dispatchEvent(new Event("change"));
    await window.__sleep(300);
    T("posts", window.__posts.map(function (x) { return [x.url.replace(/^.*\\/api\\/hqp/, ""), x.type, x.body]; }));
    var pk = document.querySelector(".hqp-pickers").getBoundingClientRect();
    T("pickers_fit", pk.right <= window.innerWidth + 0.5 && pk.left >= -0.5);
  ` });
  harness.assertNoPageError(assert, two);
  assert.deepEqual(two.player, { hidden: false, value: "living-room", options: ["Living room", "Office"] });
  assert.deepEqual(two.dac, { hidden: false, value: "main", options: ["Living room DAC", "Desk DAC"] });
  assert.equal(two.notice, true, "not answering, and the pickers are still offered above the notice");
  assert.deepEqual(two.posts, [
    ["/players/living-room/dac", "application/json", { dac: "desk-dac" }],
    ["/players/office/select", "application/json", {}],
  ]);
  assert.equal(two.pickers_fit, true);

  const one = harness.renderPage({ name: "hqp-players-screen-one", windowSize: "390x844", budgetMs: 30000,
    stub: stub(fx, { now: fx.nowOne }), driver: OPEN + `
    T("player", pick("HQPlayer"));
    T("dac", pick("DAC"));
    T("row_hidden", document.querySelector(".hqp-pickers").classList.contains("hidden"));
  ` });
  harness.assertNoPageError(assert, one);
  assert.equal(one.player.hidden, true);
  assert.equal(one.dac.hidden, true);
  assert.equal(one.row_hidden, true, "nothing to choose, nothing shown");
});
