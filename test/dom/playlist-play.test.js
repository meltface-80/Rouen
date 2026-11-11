"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t11: Play now and Queue on a playlist's page follow its Sort (public/playlist-play.js,
// dev/design/playlist-artists.md §7).
//
// The owner, 2026-11-09: "Sort-by order doesnt change the playback order. Roon doesn't have this so the reverse code
// cannot be used. Anyway to get around this". With the rows sorted, a Roon playlist's tracks are given to the server
// in the order on the screen, and it sends them one at a time (lib/ordered-play.js, test/unit/ordered-play.test.js);
// the page shows how far it has got and the button pressed is its Stop. A playlist made in Rouen is sent from the page,
// in the order on the screen. The shipping page; the server, and its run, a stand-in the driver moves on by hand
// (playlist-play-kit.js). The states a run and its page can be in beside these: playlist-play-states.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK } = require("./playlist-play-kit");

const ROON = HELPERS + LOOK + `
  await menu("playlists");
  await open("Session Work");
  T("asks_open", window.__asks.slice());

  // Playlist order: Roon's own single action, as before.
  await press(0);
  T("plain", { whole: clone(window.__whole), ordered: window.__ordered.length, btns: btns() });

  // Sorted by artist: the tracks, in the order on the screen, to the server's run.
  await sort("artist");
  said();
  await press(0);
  T("sorted", { whole: window.__whole.length, ordered: clone(window.__ordered), btns: btns(), said: said() });
  window.__run.sent = 2; window.__run.queued = 2;
  await poll();
  T("moving", btns());

  // The longest it gets: a playlist's whole read, nearly sent.
  window.__run.total = 1000; window.__run.sent = 999; window.__run.queued = 999;
  await poll();
  T("long", btns());
  window.__run.total = 5; window.__run.sent = 3; window.__run.queued = 3;

  // Left and come back to while it runs: the page's buttons are the run's again. Another playlist's are not. The
  // playlist's place in Roon's list has moved meanwhile (one added above it): it is known by its name.
  window.__run.offset = 9;
  await back();
  await open("Other List");
  T("elsewhere", btns());
  await back();
  await open("Session Work");
  T("back_to_it", btns());

  // Stop.
  said();
  document.querySelectorAll(".playlist-detail .playlist-actions > .action-btn")[0].focus();
  await press(0);
  T("stopped", { stops: clone(window.__stops), btns: btns(), said: said() });

  // Queue, by title; one track Roon could not find; it finishes by itself.
  await sort("title");
  await press(1);
  T("queue_sent", { last: clone(window.__ordered[window.__ordered.length - 1]), btns: btns() });
  said();
  Object.assign(window.__run, { sent: 5, queued: 4, failed: 1, first_error: "Playlist changed — reopen it", done: true });
  await poll();
  T("finished", { btns: btns(), said: said() });
  await window.__sleep(5000);
  T("still_up", !toastEl.classList.contains("hidden"));

  // All of them sent.
  await window.__sleep(7000);
  await press(0);
  said();
  Object.assign(window.__run, { done: true, sent: 5, queued: 5 });
  await poll();
  T("all_sent", { btns: btns(), said: said() });

  // Ended by a Play now on the zone (a row tapped, or from another device): how far it had got.
  await press(0);
  said();
  Object.assign(window.__run, { done: true, stopped: "other", sent: 1, queued: 1 });
  await poll();
  T("taken_over", { btns: btns(), said: said() });

  // Roon refused every one; and five in a row after some had gone.
  await press(0);
  said();
  Object.assign(window.__run, { done: true, stopped: "failures", sent: 5, queued: 0, failed: 5, first_error: "Playlist changed — reopen it" });
  await poll();
  T("refused", { btns: btns(), said: said() });
  await press(0);
  window.__run.total = 40;
  said();
  Object.assign(window.__run, { done: true, stopped: "failures", sent: 12, queued: 7, failed: 5, first_error: "Roon did not answer in time" });
  await poll();
  T("gave_up", { btns: btns(), said: said() });

  // A tap on a row is still that track alone.
  document.querySelectorAll(".playlist-tracks .track-row")[0].click();
  await window.__sleep(300);
  T("tap", { taps: window.__taps.map(function (p) { return [p.track_index, p.kind]; }), ordered: window.__ordered.length });
`;

const BY_ARTIST = [[2, "Lowdown"], [1, "Billie Jean"], [4, "Roxanne"], [0, "Rosanna"], [3, "Another Day"]];
const BY_TITLE = [[3, "Another Day"], [1, "Billie Jean"], [2, "Lowdown"], [0, "Rosanna"], [4, "Roxanne"]];
const pairs = (/** @type {any} */ body) => body.tracks.map((/** @type {any} */ t) => [t.index, t.title]);
const texts = (/** @type {any[]} */ b) => b.map((x) => x.text);

test("a Roon playlist: Play now and Queue follow the Sort (v2.0.3-t11)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: ROON, name: "playlist-play-roon", windowSize: "390x844", chromeArgs: TOUCH, budgetMs: 60000 });
  harness.assertNoPageError(assert, R);
  await t.test("in Playlist order: Roon's own action for the whole playlist, nothing sent track by track", () => {
    assert.deepEqual(R.plain.whole, [{ zone_or_output_id: "z1", offset: 0, title: "Session Work", kind: "play_now" }]);
    assert.equal(R.plain.ordered, 0);
    assert.deepEqual(texts(R.plain.btns), ["Play now", "Queue"]);
  });
  await t.test("THE one: sorted, the tracks go in the order on the screen", () => {
    assert.equal(R.sorted.ordered.length, 1);
    const sent = R.sorted.ordered[0];
    assert.deepEqual([sent.offset, sent.title, sent.zone_or_output_id, sent.kind], [0, "Session Work", "z1", "play_now"]);
    assert.deepEqual(pairs(sent), BY_ARTIST);
    assert.equal(R.sorted.whole, 1, "and Roon's whole-playlist action is not sent as well");
    assert.deepEqual(R.sorted.said, ["Sending 5 tracks in the order shown…"]);
  });
  await t.test("the button pressed is the run's Stop and says how far it has got; the other waits", () => {
    assert.deepEqual(R.sorted.btns.map((/** @type {any} */ b) => [b.text, b.off]), [["Stop · 0 of 5", false], ["Queue", true]]);
    assert.equal(R.sorted.btns[0].label, "Stop sending tracks: 0 of 5 sent");
    assert.deepEqual(texts(R.moving), ["Stop · 2 of 5", "Queue"]);
    // say()'s forms: "Stop · 999 of 1000", "Stop · 999/1000", "Stop" — the longest that fits. 2.0.4-t4: Shuffle beside
    // Queue left the shorter form at 390px; 2.0.4-t10's 36px round buttons give the long one room again.
    assert.equal(R.long[0].text, "Stop · 999 of 1000");
    assert.equal(R.long[0].fits, true, "on a phone, the longest it gets is not cut short");
  });
  await t.test("the page left and come back to shows its run again; another playlist's page does not", () => {
    assert.equal(R.asks_open.length, 1, "asked once as the page opens");
    assert.deepEqual(R.elsewhere.map((/** @type {any} */ b) => [b.text, b.off]), [["Play now", false], ["Queue", false]]);
    assert.deepEqual(R.back_to_it.map((/** @type {any} */ b) => [b.text, b.off]), [["Stop · 3 of 5", false], ["Queue", true]]);
  });
  await t.test("Stop ends it: the buttons back, and what was sent said", () => {
    assert.deepEqual(R.stopped.stops, [{ zone_or_output_id: "z1", id: "run1" }], "by its id: another device's run there since is not this page's to stop");
    assert.deepEqual(R.stopped.btns.map((/** @type {any} */ b) => [b.text, b.off, b.label, b.stop]), [["Play now", false, null, false], ["Queue", false, null, false]]);
    assert.deepEqual(R.stopped.said, ["Stopped after 3 of 5 tracks"]);
    assert.equal(R.stopped.btns[0].focus, true, "a keyboard's place on the page is not lost to the button being switched off");
  });
  await t.test("Queue, by title; a run that finishes says so, and names what Roon could not find", () => {
    assert.equal(R.queue_sent.last.kind, "queue");
    assert.deepEqual(pairs(R.queue_sent.last), BY_TITLE);
    assert.deepEqual(R.queue_sent.btns.map((/** @type {any} */ b) => [b.text, b.off]), [["Play now", true], ["Stop · 0 of 5", false]]);
    assert.deepEqual(R.finished.said, ["Sent 4 of 5 tracks (1 couldn't be found: Playlist changed — reopen it)"]);
    assert.deepEqual(R.finished.btns.map((/** @type {any} */ b) => [b.text, b.off]), [["Play now", false], ["Queue", false]]);
    assert.equal(R.still_up, true, "read later than it lands: it stays longer than a toast does");
  });
  await t.test("each way a run ends is said: all sent, ended by a Play now on the zone, refused throughout, given up", () => {
    assert.deepEqual(R.all_sent.said, ["Sent all 5 tracks in the order shown"]);
    assert.deepEqual(R.taken_over.said, ["Stopped after 1 of 5 tracks"]);
    assert.deepEqual(texts(R.taken_over.btns), ["Play now", "Queue"]);
    assert.deepEqual(R.refused.said, ["Playlist changed — reopen it"]);
    assert.deepEqual(R.gave_up.said, ["Stopped after 12 of 40 tracks: Roon refused 5 (Roon did not answer in time)"]);
    assert.deepEqual(texts(R.gave_up.btns), ["Play now", "Queue"]);
  });
  await t.test("a tap on a row is still that track alone", () => {
    assert.deepEqual(R.tap.taps, [[3, "play_now"]]);
    assert.equal(R.tap.ordered, 6);
  });
});

const MINE = HELPERS + LOOK + `
  var sentOwn = function () { var s = window.__own.map(function (b) { return [b.title, b.kind, b.offset, b.track]; }); window.__own.length = 0; return s; };
  await menu("playlists");
  await open("Own Mix");
  await press(1);
  await window.__sleep(600);
  T("in_order", { sent: sentOwn(), said: said().pop() });

  await sort("title");
  window.__refuse = { Alpha: 1 };
  await press(0);
  await window.__sleep(600);
  T("by_title", { sent: sentOwn(), said: said().pop(), btns: btns(), asks: window.__asks.length, ordered: window.__ordered.length });
`;

test("a playlist made in Rouen: sent in the order on the screen (v2.0.3-t11)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: MINE, name: "playlist-play-own", budgetMs: 30000 });
  harness.assertNoPageError(assert, R);
  await t.test("in Playlist order, as it always was", () => {
    assert.deepEqual(R.in_order.sent, [["Delta", "queue", 10, 3], ["Alpha", "queue", 11, 0], ["Charlie", "queue", 12, 2], ["Bravo", "queue", 13, 1]]);
    assert.equal(R.in_order.said, "Queued 4 tracks");
  });
  await t.test("sorted by title: in that order, and Play now goes to the first track Roon accepts", () => {
    assert.deepEqual(R.by_title.sent, [["Alpha", "play_now", 11, 0], ["Bravo", "play_now", 13, 1], ["Charlie", "queue", 12, 2], ["Delta", "queue", 10, 3]]);
    assert.equal(R.by_title.said, "Playing 3 tracks (1 couldn't be found: Not in the library)");
    assert.deepEqual(texts(R.by_title.btns), ["Play now", "Queue"]);
    assert.deepEqual([R.by_title.asks, R.by_title.ordered], [0, 0], "nothing of this goes through the Roon playlist's run");
  });
});
