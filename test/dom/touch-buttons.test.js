"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t15: a round button keeps no grey circle after a tap, and Android's own tap highlight is not drawn — the owner,
// 2026-10-29, with two screenshots of Now playing in the app: next with a grey disc behind it after a tap, play/pause
// under a blue rectangle while touched: "fix the buttons showing the grey circle and stop the Android touch indicator".
//
// Android's WebView keeps :hover on the last thing tapped, so every `:hover { background }` on a button stays after the
// tap. Headless Chromium has no pointer to hover with, so the page's style sheets are read back with each `:hover` made
// a class (`.__h`), and the class put on the button: what a tapped button would look like. A touch screen (headless
// Chromium's default: no hover, a coarse pointer) must look as untouched; a mouse (harness.MOUSE) keeps its hovers,
// which is also what shows the reading-back sees them.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Rouen A142", state: "playing", outputs: [],
  is_play_allowed: true, is_pause_allowed: true, is_next_allowed: true, is_previous_allowed: true, is_seek_allowed: true,
  now_playing: { line1: "On Sunday", line2: "'Til Tuesday", line3: "Welcome Home",
    artists: [{ name: "'Til Tuesday", linkable: false }], length: 247, seek_position: 8 },
};

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
window.__installFetch(function (url) {
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [window.__zone] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(400);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  document.querySelector(".mt-info").click();
  await window.__sleep(800);
  // Every style sheet again, each :hover a class, nothing in transition; the originals switched off.
  var text = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    var sh = document.styleSheets[i];
    var rules = sh.cssRules;
    for (var j = 0; j < rules.length; j++) text.push(rules[j].cssText.replace(/:hover/g, ".__h"));
    sh.disabled = true;
  }
  text.push("*, *::before, *::after { transition: none !important; }");
  var st = document.createElement("style");
  st.textContent = text.join("\\n");
  document.head.appendChild(st);
  function looks(el) { var cs = getComputedStyle(el); return cs.backgroundColor + " / " + cs.filter; }
  var out = {};
  ["np-prev", "np-next", "np-shuffle", "np-loop", "np-playpause", "np-device", "np-volbtn", "mt-playpause", "mt-zone"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) { out[id] = "missing"; return; }
    var before = looks(el);
    el.classList.add("__h");
    var after = looks(el);
    el.classList.remove("__h");
    out[id] = after === before ? "same" : before + " → " + after;
  });
  T("tapped", out);
  T("highlight", [getComputedStyle(document.documentElement).webkitTapHighlightColor,
    getComputedStyle(document.getElementById("np-playpause")).webkitTapHighlightColor]);
`;

const IDS = ["np-prev", "np-next", "np-shuffle", "np-loop", "np-playpause", "np-device", "np-volbtn", "mt-playpause", "mt-zone"];

test("a touch screen: no button keeps a look after a tap, and no tap highlight is drawn", () => {
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "touch-buttons", windowSize: "412x915", budgetMs: 30000 });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.tapped, Object.fromEntries(IDS.map((id) => [id, "same"])), "a tapped button looks as it did");
  assert.deepEqual(r.highlight, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"], "Android's own tap highlight is transparent");
});

test("a mouse keeps its hovers: the grey disc on next and the brightened play button", () => {
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "touch-buttons-mouse", windowSize: "1280x900",
    chromeArgs: harness.MOUSE, budgetMs: 30000 });
  harness.assertNoPageError(assert, r);
  assert.notEqual(r.tapped["np-next"], "same", "next shows its hover under a mouse");
  assert.notEqual(r.tapped["np-playpause"], "same", "play/pause shows its hover under a mouse");
});
