"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t11: the states a sorted playlist's sending and its page can be in (public/playlist-play.js,
// dev/design/playlist-artists.md §7.4), beside the plain course of it in playlist-play.test.js. Each is something the
// review of the first cut found: a double tap that started a run and stopped it; a count cut at both ends on a small
// phone; buttons that stayed another zone's; a run the page could no longer see, said or not said.
// The shipping page; the server and its run a stand-in (playlist-play-kit.js).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK } = require("./playlist-play-kit");

const DRIVER = HELPERS + LOOK + `
  var B = function () { return document.querySelectorAll(".playlist-detail .playlist-actions > .action-btn"); };
  var zoneTo = async function (id) {
    var zs = document.getElementById("zone-select");
    zs.value = id;
    zs.dispatchEvent(new Event("change", { bubbles: true }));
    await window.__sleep(100);
  };
  await menu("playlists");
  await open("Session Work");
  await sort("artist");

  // A double tap on Play now: the second tap lands on what is by then the run's Stop.
  B()[0].click();
  await window.__sleep(200);
  B()[0].click();
  await window.__sleep(300);
  T("double", { stops: window.__stops.length, ordered: window.__ordered.length, btns: btns() });

  // The Stop's look, whichever button it was: read beside the plain button of the same row.
  var paint = function (b) { var c = getComputedStyle(b); return [c.backgroundColor, c.color]; };
  T("look", { stop: paint(B()[0]), plain: paint(B()[1]), edges: [getComputedStyle(B()[0]).borderTopColor, getComputedStyle(B()[1]).borderTopColor],
    live: B()[0].parentElement.getAttribute("aria-live") });

  // Polls that find the count as it was write nothing a screen reader would say again.
  var writes = 0;
  var mo = new MutationObserver(function (m) { writes += m.length; });
  mo.observe(B()[0], { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
  await poll(); await poll();
  T("writes_same", writes);
  window.__run.sent = 1; window.__run.queued = 1;
  await poll();
  T("writes_moved", { some: writes > 0, btns: btns() });
  mo.disconnect();

  // Another zone picked while it runs: the buttons are that zone's. Back, and they are the run's again.
  await zoneTo("z2");
  T("other_zone", btns());
  await zoneTo("z1");
  T("zone_back", btns());

  // Stop, the server slow to answer (it waits for the track in flight): said meanwhile.
  window.__slow.stop = 2500;
  said();
  B()[0].click();
  await window.__sleep(400);
  T("stopping", { btns: btns(), stops: window.__stops.length });
  await window.__sleep(2600);
  T("stopped", { btns: btns(), said: said() });
  window.__slow.stop = 0;

  // The start slow to answer: neither button can start a second meanwhile, and the focus comes back.
  window.__slow.start = 600;
  B()[1].focus();
  B()[1].click();
  await window.__sleep(200);
  T("starting", btns());
  await window.__sleep(700);
  T("started", btns());
  window.__slow.start = 0;

  // The server no longer knows the run (it restarted): the buttons back.
  said();
  window.__run = null;
  await poll();
  T("forgotten", { btns: btns(), said: said() });

  // The server not answering: asked for 30 s, then said, the buttons back.
  await press(0);
  said();
  window.__askFails = true;
  await window.__sleep(27000);
  T("unanswered", btns());
  await window.__sleep(5000);
  T("gave_up", { btns: btns(), said: said() });
  window.__askFails = false;

  // The page opened again, its first look at the server slow: a run started meanwhile is the newer, and is kept.
  await back();
  window.__slow.ask = 1200;
  await open("Session Work");
  await press(1);
  window.__slow.ask = 0;
  await window.__sleep(2600);
  T("newer", { btns: btns(), runs: window.__runs, kind: window.__run.kind });
`;

const SMALL = HELPERS + LOOK + `
  await menu("playlists");
  await open("Session Work");
  await sort("artist");
  await press(0);
  window.__run.total = 1000; window.__run.sent = 999; window.__run.queued = 999;
  await poll();
  T("thousand", btns());
  window.__run.total = 60; window.__run.sent = 7; window.__run.queued = 7;
  await poll();
  T("sixty", btns());
`;

const state = (/** @type {any[]} */ b) => b.map((x) => [x.text, x.off]);

test("a sorted playlist's sending: the states its page can be in (v2.0.3-t11)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "playlist-play-states", windowSize: "390x844", chromeArgs: TOUCH, budgetMs: 90000 });
  harness.assertNoPageError(assert, R);
  await t.test("a double tap starts the run and does not stop it", () => {
    assert.deepEqual([R.double.ordered, R.double.stops], [1, 0]);
    assert.deepEqual(state(R.double.btns), [["Stop · 0 of 5", false], ["Queue", true]]);
  });
  await t.test("the Stop has one look, the plain button's with an edge of its own, and is not read out as it counts", () => {
    assert.deepEqual(R.look.stop, R.look.plain, "not the brass of Play now");
    assert.notEqual(R.look.edges[0], R.look.edges[1]);
    assert.equal(R.look.live, "off");
    assert.equal(R.writes_same, 0, "nothing written while the count stands");
    assert.equal(R.writes_moved.some, true);
    assert.equal(R.writes_moved.btns[0].text, "Stop · 1 of 5");
  });
  await t.test("another zone picked: the buttons are that zone's, and the run's again when its zone is back", () => {
    assert.deepEqual(R.other_zone.map((/** @type {any} */ b) => [b.text, b.off, b.stop]), [["Play now", false, false], ["Queue", false, false]]);
    assert.deepEqual(state(R.zone_back), [["Stop · 1 of 5", false], ["Queue", true]]);
  });
  await t.test("Stop, while the server waits for the track in flight: Stopping…, then what was sent", () => {
    assert.equal(R.stopping.stops, 1);
    assert.deepEqual(state(R.stopping.btns), [["Stopping…", true], ["Queue", true]]);
    assert.deepEqual(R.stopped.said, ["Stopped after 1 of 5 tracks"]);
    assert.deepEqual(state(R.stopped.btns), [["Play now", false], ["Queue", false]]);
  });
  await t.test("while the start is out neither button starts another; then the one pressed is the Stop, the focus still on it", () => {
    assert.deepEqual(state(R.starting), [["Play now", true], ["Queue", true]]);
    assert.deepEqual(R.started.map((/** @type {any} */ b) => [b.text, b.off, b.focus]), [["Play now", true, false], ["Stop · 0 of 5", false, true]]);
  });
  await t.test("a run the server no longer knows: the buttons back, nothing said", () => {
    assert.deepEqual(state(R.forgotten.btns), [["Play now", false], ["Queue", false]]);
    assert.deepEqual(R.forgotten.said, []);
  });
  await t.test("the server not answering: asked for 30 s, then said — and that the tracks may still be going", () => {
    assert.deepEqual(state(R.unanswered), [["Stop · 0 of 5", false], ["Queue", true]], "27 s in, still asking");
    assert.deepEqual(R.gave_up.said, ["Couldn't reach the extension; it may still be sending the tracks"]);
    assert.deepEqual(state(R.gave_up.btns), [["Play now", false], ["Queue", false]]);
  });
  await t.test("the page's first look, answered late, does not take the place of a run started since", () => {
    assert.equal(R.newer.kind, "queue");
    assert.deepEqual(state(R.newer.btns), [["Play now", true], ["Stop · 0 of 5", false]]);
  });
});

test("a small phone at the largest text: the count is shortened, never cut (v2.0.3-t11)", { skip: !harness.available && "no chromium" }, () => {
  const stub = `try { localStorage.setItem("rra-ui-chrome", "1.5"); } catch (e) { /* storage optional */ }` + STUB;
  const R = harness.renderPage({ stub, driver: SMALL, name: "playlist-play-small", windowSize: "320x568", chromeArgs: TOUCH, budgetMs: 30000 });
  harness.assertNoPageError(assert, R);
  // The button centres its text, so what does not fit is cut at both ends: "999 of 1000" read "999 of 100".
  assert.notEqual(R.thousand[0].text, "Stop · 999 of 1000", "there is not the room for it here (or this test proves nothing)");
  assert.ok(["Stop · 999/1000", "Stop"].includes(R.thousand[0].text), R.thousand[0].text);
  assert.equal(R.thousand[0].fits, true);
  assert.equal(R.thousand[0].label, "Stop sending tracks: 999 of 1000 sent", "said in full whatever is shown");
  assert.ok(["Stop · 7 of 60", "Stop · 7/60", "Stop"].includes(R.sixty[0].text), R.sixty[0].text);
  assert.equal(R.sixty[0].fits, true);
});
