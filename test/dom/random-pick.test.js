"use strict";
// ---------------------------------------------------------------------------
// v1.9.3: Random Album chooses an album and OFFERS it — Play now, Play next,
// or Queue (to the end) — instead of starting it at once over whatever was
// playing. Asked for on the forum as "it would be great if the Random Album
// could be added as Play Next or Queue".
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Lounge", state: "playing",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Lounge", is_muted: false, volume: null }],
  now_playing: null,
};
const PICK = { offset: 4242, title: "Mezzanine", subtitle: "Massive Attack", image_key: null };

const STUB = `
window.__plays = []; window.__playedAtOnce = 0; window.__picks = 0;
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__installFetch(function (url, opts) {
  if (url.indexOf("/api/pick-unheard") > -1) { window.__picks++; return window.__json({ album: ${JSON.stringify(PICK)} }); }
  if (url.indexOf("/api/play-unheard") > -1) { window.__playedAtOnce++; return window.__json({ ok: true }); }
  if (url.indexOf("/api/play") > -1 && url.indexOf("/api/play-") === -1) {
    window.__plays.push(JSON.parse((opts && opts.body) || "{}"));
    return window.__json({ ok: true, offset: ${PICK.offset} });
  }
  if (url.indexOf("/api/album?") > -1) return window.__json({ title: "Under", subtitle: "Someone", actions: [], tracks: [] });
  if (url.indexOf("/api/album/") > -1) return window.__json({});
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(600);
  var ov = document.getElementById("random-pick-overlay");
  var open = function () { return !ov.classList.contains("hidden"); };
  var choose = async function () {
    document.getElementById("play-unheard-topbar").click();
    await window.__sleep(2600);
  };
  await choose();
  T("shown", open());
  T("title", document.getElementById("random-pick-title").textContent);
  T("artist", document.getElementById("random-pick-artist").textContent);
  T("labels", Array.prototype.map.call(ov.querySelectorAll("[data-kind]"), function (b) { return b.textContent.trim(); }));
  T("queue_icon", !!ov.querySelector('[data-kind="queue"] svg'));
  T("played_before_choice", window.__plays.length + window.__playedAtOnce);
  ov.querySelector('[data-kind="play_next"]').click();
  await window.__sleep(300);
  T("after_next", { closed: !open(), body: window.__plays[window.__plays.length - 1] || null });
  await choose();
  ov.querySelector('[data-kind="queue"]').click();
  await window.__sleep(300);
  T("after_queue", { closed: !open(), kind: (window.__plays[window.__plays.length - 1] || {}).kind });
  await choose();
  ov.querySelector('[data-kind="play_now"]').click();
  await window.__sleep(300);
  T("after_now", (window.__plays[window.__plays.length - 1] || {}).kind);
  await choose();
  document.getElementById("random-pick-close").click();
  await window.__sleep(100);
  T("after_close", { closed: !open(), plays: window.__plays.length });
`;

test("the choice fits a phone held sideways, and Escape closes only it", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "random-pick-landscape", stub: STUB, windowSize: "844x390", budgetMs: 20000, driver: `
    await window.__sleep(600);
    // the album view open underneath, as when the pick lands over it
    window.__openAlbum({ offset: 1, title: "Under", subtitle: "Someone", image_key: null });
    await window.__sleep(300);
    document.getElementById("play-unheard-topbar").click();
    await window.__sleep(2600);
    var box = document.querySelector(".random-pick-box").getBoundingClientRect();
    var x = document.getElementById("random-pick-close").getBoundingClientRect();
    var q = document.querySelector('[data-kind="queue"]');
    var box2 = document.querySelector(".random-pick-box");
    T("fit", { top: Math.round(box.top), bottom: Math.round(box.bottom), h: window.innerHeight, xTop: Math.round(x.top) });
    T("queue_reachable", (function () { q.scrollIntoView({ block: "nearest" }); var b = q.getBoundingClientRect(); var bb = box2.getBoundingClientRect(); return b.bottom <= bb.bottom + 1 && b.top >= bb.top - 1; })());
    // ONE press, where a key press arrives: the focused element's document.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await window.__sleep(200);
    T("after_escape", { pick: !document.getElementById("random-pick-overlay").classList.contains("hidden"),
                        album: !document.getElementById("album-modal").classList.contains("hidden") });
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the box is inside the screen, its × too", () => {
    assert.ok(r.fit.top >= 0, "the box starts above the screen at " + r.fit.top);
    assert.ok(r.fit.bottom <= r.fit.h, "the box ends below the screen at " + r.fit.bottom);
    assert.ok(r.fit.xTop >= 0);
    assert.equal(r.queue_reachable, true);
  });
  await t.test("Escape closes the choice and leaves the album view under it open", () => {
    assert.deepEqual(r.after_escape, { pick: false, album: true });
  });
});

test("Random Album offers Play now, Play next and Queue (v1.9.3)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "random-pick", stub: STUB, driver: DRIVER, windowSize: "390x844", budgetMs: 25000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: the chosen album is shown, and nothing plays until a choice is made", () => {
    assert.equal(r.shown, true);
    assert.equal(r.title, "Mezzanine");
    assert.equal(r.artist, "Massive Attack");
    assert.equal(r.played_before_choice, 0, "it played before anything was chosen");
  });
  await t.test("three choices, Queue with its end-of-queue symbol", () => {
    assert.deepEqual(r.labels, ["Play now", "Play next", "Queue"]);
    assert.equal(r.queue_icon, true);
  });
  await t.test("Play next sends that album, with its identity, as Play next — and closes", () => {
    assert.equal(r.after_next.closed, true);
    assert.equal(r.after_next.body.kind, "play_next");
    assert.equal(r.after_next.body.offset, 4242);
    assert.equal(r.after_next.body.title, "Mezzanine");
    assert.equal(r.after_next.body.subtitle, "Massive Attack");
    assert.equal(r.after_next.body.zone_or_output_id, "z1");
  });
  await t.test("Queue adds it to the end; Play now plays it", () => {
    assert.deepEqual(r.after_queue, { closed: true, kind: "queue" });
    assert.equal(r.after_now, "play_now");
  });
  await t.test("closing it plays nothing", () => {
    assert.deepEqual(r.after_close, { closed: true, plays: 3 });
  });
});
