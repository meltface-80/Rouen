"use strict";
// ---------------------------------------------------------------------------
// Tune (2.0.7-t1, dev/design/smart-picks.md §5; public/smart-picks-tune.js): on the Smart Picks screen a Tune button
// beside Why these picks opens the sheet — the Listening window and Adventure, the genres and decades each Never / Less
// / As I listen / More, the artists set to More from or Never start from — and Save sends the whole Tune; Reset puts
// the sheet back. Each pick's own Tune button lists the artists it came from, each with More from and Never start from.
// In the real page at phone width, against stubbed routes. Broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const PICKS = [{ kind: "adjacent", artist: "Labradford", album: "Mi Media Naranja", album_id: "q1", service: "qobuz", image: "",
  reason: "Because you play Keith Jarrett", genre: "" }];
const TUNE = { tune: { window: 2, adventure: 2, genres: { "Pop/Rock": "never" }, decades: {}, more: [], never: ["Michael Bolton"] },
  genres: [{ name: "Jazz", share: 0.6 }, { name: "Classical", share: 0.35 }], decades: [{ name: "1970s", share: 0.7 }, { name: "1990s", share: 0.3 }],
  windows: ["Recent", "Last months", "As I listen", "Last year", "All time"], adventures: ["Close", "Closer", "As I listen", "Further", "Far"] };

const STUB = `
window.__posts = [];
var tune = ${JSON.stringify(TUNE)};
window.__installFetch(function (url, opts) {
  if (opts && opts.method === "POST" && url.indexOf("/api/smart-picks/tune") > -1) {
    var body = JSON.parse(opts.body);
    window.__posts.push({ url: url, body: body });
    if (body.tune) tune = Object.assign({}, tune, { tune: Object.assign({ more: [], never: [] }, body.tune) });
    if (body.as === "more") tune.tune.more = [body.name];
    return window.__json(Object.assign({}, tune, { ok: true, rebuilding: true }));
  }
  if (url.indexOf("/api/smart-picks/tune") > -1) return window.__json(tune);
  if (url.indexOf("/api/smart-picks/why") > -1) return window.__json({ why: { day: "2026-11-26", at: 0, slots: [], seeds: [], left: [],
    picks: [{ artist: "Labradford", seeds: ["Keith Jarrett", "Jan Garbarek"] }], numbers: {} } });
  if (url.indexOf("/api/smart-picks") > -1) return window.__json({ day: "2026-11-26", service_ready: true, picks: ${JSON.stringify(PICKS)} });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/library/facets") > -1) return window.__json({ total: 0, facets: [], coverage: {}, hasPlays: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(500);
  document.getElementById("home-picks-title").click();
  await window.__sleep(700);
  var box = function () { return document.querySelector("#tune-picks .confirm-box"); };
  var sheetOpen = function () { var s = document.getElementById("tune-picks"); return !!s && !s.classList.contains("hidden"); };
  // The sheet, from the screen's Tune button.
  document.getElementById("tune-picks-open").click();
  await window.__sleep(400);
  var chip = function (key, level) { return document.querySelector('#tune-picks [data-key="' + key + '"][data-level="' + level + '"]'); };
  T("sheet", { open: sheetOpen(), title: document.getElementById("tune-picks-title").textContent,
    pop_never: !!chip("Pop/Rock", "never") && chip("Pop/Rock", "never").getAttribute("aria-checked"),
    jazz_as: chip("Jazz", "as").getAttribute("aria-checked"), never_listed: box().textContent.indexOf("Michael Bolton") > -1,
    vw: window.innerWidth, wide: Math.round(box().getBoundingClientRect().right), overflow: box().scrollWidth > box().clientWidth + 1 });
  chip("Jazz", "more").click();
  chip("1990s", "never").click();
  var w = document.getElementById("tune-window"); w.value = "4"; w.dispatchEvent(new Event("input"));
  T("label", document.getElementById("tune-window-v").textContent);
  document.querySelector('[data-remove="never"][data-name="Michael Bolton"]').click();
  document.getElementById("tune-picks-save").click();
  await window.__sleep(300);
  T("saved", { posts: window.__posts.map(function (p) { return p.body; }), note: document.getElementById("tune-picks-note").textContent });
  await window.__sleep(1800);
  T("closed", !sheetOpen());
  // Reset puts the sheet back to As I listen without saving.
  document.getElementById("tune-picks-open").click();
  await window.__sleep(400);
  var before = { jazz: chip("Jazz", "more").getAttribute("aria-checked"), nineties: chip("1990s", "never").getAttribute("aria-checked") };
  document.getElementById("tune-window").value = "1";
  document.getElementById("tune-picks-reset").click();
  T("reset", { before: before, jazz: chip("Jazz", "as").getAttribute("aria-checked"), nineties: chip("1990s", "as").getAttribute("aria-checked"),
    window: document.getElementById("tune-window").value, pop: !!chip("Pop/Rock", "as"),
    posts: window.__posts.length, note: document.getElementById("tune-picks-note").textContent });
  document.getElementById("tune-picks-cancel").click();
  // A pick's own Tune: the artists it came from.
  var pickTune = document.querySelector(".pick-list .pick-card-full .pick-tune");
  T("pickButton", !!pickTune && pickTune.textContent);
  pickTune.click();
  await window.__sleep(400);
  var more = document.querySelector('#tune-picks [data-seed="Keith Jarrett"][data-as="more"]');
  T("pick", { title: document.getElementById("tune-picks-title").textContent, text: document.getElementById("tune-picks-body").textContent.replace(/\\s+/g, " "),
    seeds: Array.prototype.map.call(document.querySelectorAll("#tune-picks [data-seed]"), function (b) { return b.textContent; }) });
  more.click();
  await window.__sleep(300);
  var on = document.querySelector('#tune-picks [data-seed="Keith Jarrett"][aria-pressed="true"]');
  T("picked", { post: window.__posts[window.__posts.length - 1], on: !!on && on.textContent, next: on && on.getAttribute("data-as") });
  // From Settings → Setup → Smart Picks → Tune: the sheet above Settings.
  document.getElementById("tune-picks-cancel").click();
  window.__openSettingsPane("smartpicks");
  await window.__sleep(400);
  var tb = document.getElementById("picks-tune");
  if (tb) tb.click();
  await window.__sleep(400);
  var c = box().getBoundingClientRect();
  var hit = document.elementFromPoint(c.left + c.width / 2, c.top + 20);
  T("settings", { button: !!tb, open: sheetOpen(), above: !!hit && !!hit.closest("#tune-picks") });
`;

test("Tune: a sheet from the Smart Picks screen; Save sends the whole Tune; Reset; each pick's More / Never", () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "smart-picks-tune", windowSize: "390x844", budgetMs: 20000, stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.sheet.open, true, "THE one: no Tune sheet");
  assert.equal(r.sheet.title, "Tune Smart Picks");
  assert.equal(r.sheet.pop_never, "true", "a genre's saved level not shown");
  assert.equal(r.sheet.jazz_as, "true");
  assert.equal(r.sheet.never_listed, true);
  assert.ok(r.sheet.wide <= r.sheet.vw && !r.sheet.overflow, "the sheet wider than the screen");
  assert.equal(r.label, "All time");
  assert.deepEqual(r.saved.posts, [{ tune: { window: 4, adventure: 2, genres: { "Pop/Rock": "never", Jazz: "more" },
    decades: { "1990s": "never" }, more: [], never: [] } }], "the Tune sent isn't what was set");
  assert.match(r.saved.note, /being rebuilt/);
  assert.equal(r.closed, true);
  assert.deepEqual(r.reset.before, { jazz: "true", nineties: "true" }, "the saved Tune not shown when the sheet opens again");
  assert.deepEqual([r.reset.jazz, r.reset.nineties, r.reset.window], ["true", "true", "2"], "Reset didn't put everything back to As I listen");
  assert.equal(r.reset.pop, false, "a genre set before but not among yours is listed after Reset");
  assert.equal(r.reset.posts, 1, "Reset saved without Save");
  assert.match(r.reset.note, /Save to keep it/);
  assert.equal(r.pickButton, "Tune");
  assert.equal(r.pick.title, "Tune: Labradford");
  assert.match(r.pick.text, /Labradford was suggested because you play Keith Jarrett and Jan Garbarek/);
  assert.deepEqual(r.pick.seeds, ["More from Keith Jarrett", "Never start from Keith Jarrett", "More from Jan Garbarek", "Never start from Jan Garbarek"]);
  assert.deepEqual(r.picked.post, { url: "/api/smart-picks/tune/artist", body: { name: "Keith Jarrett", as: "more" } });
  assert.equal(r.picked.on, "More from Keith Jarrett", "the choice not shown as on");
  assert.equal(r.picked.next, "none", "tapping it again doesn't take it back");
  assert.deepEqual(r.settings, { button: true, open: true, above: true }, "Tune not opened from Settings, or opened under it");
});
