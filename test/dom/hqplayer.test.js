"use strict";
// ---------------------------------------------------------------------------
// v1.8.74: the HQPWeb screen and Settings → HQPWeb, in the real page.
//
// The answers the page is fed are not hand-written: they are produced, before
// the browser starts, by the real /api/hqp handlers driving the fake HQPlayer
// (lib/hqp/fake.js, a Mac in SDM playing at DSD1024). So the shapes these
// tests stub are the shapes the server sends, and a change to one is a change
// to the other.
//
// What is pinned is what the person looking at the screen relies on:
//   * it says what HQPlayer is doing — the output rate, the mode, the source,
//     whether it is keeping up — and what each control is set to, with a tick
//     where HQPlayer reports that choice is the one running;
//   * a pick sends a change BY NAME, as JSON (the server refuses anything
//     else from a page), and what came back is said in words — including a
//     change that was undone because playback stopped;
//   * a choice HQPlayer's rules say will not play is marked before it is
//     tapped, and still allowed: the screen warns, it never blocks;
//   * leaving the screen stops the polling, which is what lets the server stop
//     asking HQPlayer;
//   * not installed (since v1.9.34; switched off before), or not set up, the screen says so.
// ---------------------------------------------------------------------------

require("../lib/no-real-hqplayer");
const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
// The rig: the fake HQPlayer's answers, the stub, the page (test/lib/hqp-dom.js, moved out in v1.9.34).
const { fx, stub, render } = require("../lib/hqp-dom");
test("the screen says what HQPlayer is doing (v1.8.74)", async (t) => {
  const f = await fx();
  const r = render("hqp-screen", stub(f), `
    T("rate", __text(".hqp-rate"));
    T("state", __text(".hqp-state"));
    T("sub", __text(".hqp-sub"));
    T("health", __text(".hqp-health"));
    T("name", __text(".hqp-name"));
    T("track", __shown(".hqp-track") ? __text(".hqp-track-title") + " / " + __text(".hqp-track-sub") : null);
    T("volume_controls", document.querySelectorAll(".hqp-screen input[type=range], .hqp-screen [aria-label*='olume']").length);
    var rows = {};
    document.querySelectorAll(".hqp-row").forEach(function (b) {
      var v = b.querySelector(".hqp-row-value");
      rows[b.dataset.field] = { label: b.querySelector(".hqp-row-label").firstChild.textContent, value: v.textContent,
                                taken: v.dataset.taken || "", inUse: !b.querySelector(".hqp-row-hint").classList.contains("hidden") };
    });
    T("rows", rows);
    T("title", __text("#count-text"));
    T("notice", __shown(".hqp-notice"));
    T("foot", __text(".hqp-foot"));
  `);
  harness.assertNoPageError(assert, r);

  await t.test("THE one: the output rate, the mode, the source and the state", () => {
    assert.equal(r.menu_shown, true, "the side menu has no HQPlayer entry though it is installed");
    assert.equal(r.notice, false, "a notice is covering the screen");
    assert.equal(r.rate, "DSD1024");
    assert.equal(r.state, "Playing");
    assert.equal(r.sub, "SDM (DSD) 1-bit · from 44.1 kHz / 24-bit · fed by Roon");
    // HQPlayer's own processing speed (5.17.2+), as hqpweb 0.1.0-alpha.2 shows it.
    assert.equal(r.health, "Processing 25× · Keeping up with real time ✓");
    assert.equal(r.name, "fake-mac");
  });
  await t.test("the Roon zone playing through it, by name", () => {
    assert.equal(r.track, "So What / Miles Davis · Kind of Blue");
  });
  await t.test("no volume control of its own: Rouen's own slider is the one (v1.8.78)", () => {
    // It set HQPlayer's volume beside the Roon zone's, two sliders for one
    // listener. The jump flag and the never-raise rollback stay.
    assert.equal(r.volume_controls, 0);
  });
  await t.test("each control shows its setting, and which one HQPlayer reports running", () => {
    assert.deepEqual(r.rows.filter1x, { label: "1x filter", value: "poly-sinc-gauss-xla", taken: "yes", inUse: true });
    assert.deepEqual(r.rows.filterNx, { label: "Nx filter", value: "poly-sinc-gauss-hires-lp", taken: "", inUse: false });
    assert.deepEqual(r.rows.shaper, { label: "Modulator", value: "AHM7EC8B", taken: "yes", inUse: false });
    assert.equal(r.rows.presets.value, "✓ DSD1024 xla", "the preset in effect is not named");
  });
  await t.test("the non-affiliation notice and the credit are on the screen", () => {
    assert.match(r.foot, /Built on hqpweb, statelycurmudgeon's hard work — thank you\. MIT licence\./);
    assert.match(r.foot, /Not affiliated with, endorsed by, or supported by Signalyst/);
  });
});

test("a pick sends a change by name, as JSON, and says what happened (v1.8.74)", async (t) => {
  const f = await fx();
  const r = render("hqp-pick", stub(f), `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(400);
    var items = function () { return Array.prototype.slice.call(document.querySelectorAll(".lib-sheet .hqp-pick-item")); };
    T("sheet_title", __text(".lib-sheet-head h3"));
    var search = document.querySelector(".hqp-pick-search");
    T("placeholder", search.placeholder);
    T("groups", Array.prototype.map.call(document.querySelectorAll(".lib-sheet .hqp-group"), function (g) { return g.textContent; }));
    T("current", items().filter(function (b) { return b.classList.contains("is-current"); }).map(function (b) { return b.dataset.name; }));
    T("folded_hides_older", !items().some(function (b) { return b.dataset.name === "ASDM7ECv3"; }));
    search.value = "asdm7ec-fast";
    search.dispatchEvent(new Event("input"));
    T("filtered", items().map(function (b) { return b.dataset.name; }));
    // A search reaches into a folded section (ASDM7EC is in the older EC series).
    search.value = "asdm7ec";
    search.dispatchEvent(new Event("input"));
    items().find(function (b) { return b.dataset.name === "ASDM7EC"; }).click();
    await window.__sleep(1200);
    T("sheet_after", !!document.querySelector(".lib-sheet"));
    T("posts", window.__posts);
    T("msg", __text(".hqp-msg"));
    T("msg_kind", document.querySelector(".hqp-msg").dataset.kind);
    T("undo", __shown(".hqp-undo"));
    T("shaper", __text('.hqp-row[data-field="shaper"] .hqp-row-value'));
    document.querySelector(".hqp-undo").click();
    await window.__sleep(600);
    T("undo_post", window.__posts[window.__posts.length - 1]);
  `);
  harness.assertNoPageError(assert, r);

  await t.test("the picker lists every modulator, grouped by family, ticks the current one, and searches", () => {
    assert.equal(r.sheet_title, "Modulator");
    assert.equal(r.placeholder, "Search 36…");
    assert.equal(r.groups[0], "Newest EC line · 16");
    assert.ok(r.groups.some((x) => /^AHM, for DSD1024 and up/.test(x)), JSON.stringify(r.groups));
    assert.deepEqual(r.current, ["AHM7EC8B"]);
    assert.equal(r.folded_hides_older, true, "the older series is not folded");
    assert.deepEqual(r.filtered, ["ASDM7EC-fast", "ASDM7EC-fast 512+fs"]);
  });
  await t.test("THE one: the change is a JSON POST carrying the NAME, never an index", () => {
    assert.equal(r.sheet_after, false, "the sheet stayed open after a pick");
    const change = r.posts.filter((p) => /\/api\/hqp\/change$/.test(p.url));
    assert.equal(change.length, 1, JSON.stringify(r.posts));
    assert.deepEqual(change[0].body, { shaper: "ASDM7EC" });
    assert.equal(change[0].type, "application/json", "the server refuses a write that is not JSON");
  });
  await t.test("what came back is said in words, with undo on offer", () => {
    assert.equal(r.msg_kind, "ok");
    assert.equal(r.msg, "✓ Modulator → ASDM7EC · playback OK");
    assert.equal(r.undo, true);
    assert.equal(r.shaper, "ASDM7EC", "the row still shows the old modulator");
  });
  await t.test("Undo is a JSON POST too", () => {
    assert.equal(r.undo_post.url, "/api/hqp/undo");
    assert.equal(r.undo_post.type, "application/json");
  });
});

test("a modulator below its floor is marked, and offered with a rate it plays at (v1.8.78)", async (t) => {
  // hqpweb's one refusal: AHM below DSD1024 can only stop playback, so it is
  // offered with the lowest listed rate it plays at, as one change — and the
  // answer to that change is said in words as before.
  const f = await fx();
  const after = Object.assign({}, f.nowDsd512, { undoAvailable: false });
  const r = render("hqp-warn", stub(f, { now: f.nowDsd512, nowAfter: after, caps: f.capsDsd512, guide: f.guideDsd512,
                                         changeAnswer: { status: 200, body: f.rollback } }), `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(400);
    T("current", (document.querySelector(".hqp-pick-item.is-current") || {}).dataset ? document.querySelector(".hqp-pick-item.is-current").dataset.name : null);
    var ahm = document.querySelector('.hqp-pick-item[data-name="AHM7EC8B"]');
    T("ahm_warn", ahm.classList.contains("is-warn"));
    T("ahm_why", ahm.querySelector(".hqp-pick-why") ? ahm.querySelector(".hqp-pick-why").textContent : null);
    var fast = document.querySelector('.hqp-pick-item[data-name="ASDM7EC-fast"]');
    T("fast_why", fast.querySelector(".hqp-pick-why") ? fast.querySelector(".hqp-pick-why").textContent : null);
    var capsBefore = window.__callsMatching("/api/hqp/capabilities");
    ahm.click();
    await window.__sleep(400);
    T("confirm", !document.getElementById("confirm-overlay").classList.contains("hidden") ? document.getElementById("confirm-msg").textContent : null);
    document.getElementById("confirm-yes").click();
    await window.__sleep(1200);
    T("posts", window.__posts.filter(function (p) { return /change$/.test(p.url); }).map(function (p) { return p.body; }));
    T("msg", __text(".hqp-msg"));
    T("msg_kind", document.querySelector(".hqp-msg").dataset.kind);
    T("undo", __shown(".hqp-undo"));
    T("caps_reread", window.__callsMatching("/api/hqp/capabilities") > capsBefore);
  `);
  harness.assertNoPageError(assert, r);

  await t.test("the warning is there before the tap", () => {
    assert.equal(r.current, "ASDM7EC", "precondition: the page is not in the DSD512 context the warning belongs to");
    assert.equal(r.ahm_warn, true);
    assert.match(r.ahm_why, /^⚠ won't play: AHM7EC8B needs ≥ 40\.96 MHz \(DSD1024\); 22\.5792 MHz stops playback$/);
    assert.ok(!r.fast_why || !/^⚠/.test(r.fast_why), "a modulator that plays at DSD512 carries a warning: " + r.fast_why);
  });
  await t.test("THE one: picking it asks to change the rate with it, and sends both as one change", () => {
    assert.match(r.confirm, /AHM7EC8B needs DSD1024 or higher; it can't play at DSD512\.\s+Change the output rate to DSD1024 with it\?/);
    assert.deepEqual(r.posts, [{ shaper: "AHM7EC8B", rate: 45158400 }]);
  });
  await t.test("what came back is said in words; an undone change is reported as undone, and why", () => {
    assert.equal(r.msg_kind, "warn");
    assert.match(r.msg, /^Undone: AHM7EC8B needs/);
    assert.match(r.msg, /Playback resumed\./);
    assert.equal(r.undo, false, "undo offered after a rollback — there is nothing of the user's to undo");
    assert.equal(r.caps_reread, true, "the warnings were not read again after a rollback");
  });
});

test("the screen says when there is nothing it can show (v1.8.74)", async (t) => {
  const f = await fx();
  const states = {
    off: { enabled: false, configured: false },
    unset: { enabled: true, configured: false },
    down: { enabled: true, configured: true, address: "192.0.2.10", reachable: false,
            error: "connect ECONNREFUSED 192.0.2.10:4321", snapshot: null, roon: [] },
  };
  for (const [name, now] of Object.entries(states)) {
    await t.test(name, () => {
      const r = render("hqp-" + name, stub(f, { now }), `
        T("notice", __shown(".hqp-notice") ? __text(".hqp-notice-text") : null);
        T("error", document.querySelector(".hqp-notice").classList.contains("is-error"));
        T("panel", __shown(".hqp-panel"));
        T("button", __shown(".hqp-notice-btn"));
        document.querySelector(".hqp-notice-btn").click();
        await window.__sleep(400);
        var pane = document.querySelector('.settings-pane[data-pane="hqplayer"]');
        T("pane_open", !document.getElementById("settings-overlay").classList.contains("hidden") && !pane.classList.contains("hidden"));
      `);
      harness.assertNoPageError(assert, r);
      assert.equal(r.panel, false, "the controls are on screen with nothing behind them");
      assert.equal(r.button, name !== "off", name === "off" ? "a way into the page of a plugin not installed (v1.9.34)" : "no way into Settings → HQPWeb");
      if (name !== "off") assert.equal(r.pane_open, true, "the button did not open Settings → HQPWeb");
      if (name === "off") assert.match(r.notice, /isn't installed\. Install it in Settings → Plugins/);
      if (name === "unset") {
        assert.match(r.notice, /Add your HQPlayer in Settings → HQPWeb/);
        assert.doesNotMatch(r.notice, /Demo/i, "the Demo HQPlayer is gone (v1.8.85)");
      }
      if (name === "down") {
        assert.match(r.notice, /HQPlayer at 192\.0\.2\.10 isn't answering \(connect ECONNREFUSED/);
        assert.equal(r.error, true);
      } else {
        assert.equal(r.error, false);
      }
    });
  }
});

test("leaving the screen stops the polling (v1.8.74)", async (t) => {
  const f = await fx();
  const r = render("hqp-leave", stub(f), `
    var during = __nowCalls();
    await window.__sleep(3200);
    var later = __nowCalls();
    T("polled", later - during);
    document.getElementById("topbar-back").click();
    await window.__sleep(300);
    var left = __nowCalls();
    await window.__sleep(5000);
    T("after_leaving", __nowCalls() - left);
    T("screen_gone", !document.querySelector(".hqp-screen") || !document.body.contains(document.querySelector(".hqp-screen")) ||
                     document.getElementById("album-grid").classList.contains("hidden"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("it polls every 1.5 s while open", () => {
    assert.ok(r.polled >= 2, "only " + r.polled + " polls in 3.2 s");
  });
  await t.test("THE one: and not at all once it is left — which is what lets the server stop asking HQPlayer", () => {
    assert.equal(r.after_leaving, 0, "the HQPWeb screen kept polling after Back");
    assert.equal(r.screen_gone, true);
  });
});

test("a status asked for before a change, and answered after it, is not shown (v1.8.74)", async (t) => {
  // The screen shows what a change did the moment it is answered. A status
  // already on its way carries HQPlayer from BEFORE the change, and painted
  // over it, it put the old setting back on screen until the next poll.
  const f = await fx();
  const r = render("hqp-crossed", stub(f), `
    window.__fx.nowDelay = 1000;
    await window.__sleep(1700);
    // The sheet reads its list first; open it, then wait for a status to be on its way.
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    for (var w = 0; w < 100 && !document.querySelector('.lib-sheet .hqp-pick-item[data-name="ASDM7EC-fast"]'); w++) await window.__sleep(20);
    var c = __nowCalls();
    for (var i = 0; i < 150 && __nowCalls() === c; i++) await window.__sleep(20);
    T("poll_out", __nowCalls() > c);
    document.querySelector('.lib-sheet .hqp-pick-item[data-name="ASDM7EC-fast"]').click();
    var seen = [];
    for (var k = 0; k < 40; k++) { await window.__sleep(100); seen.push(__text('.hqp-row[data-field="shaper"] .hqp-row-value')); }
    T("seen", seen);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: once the change is on screen, the status from before it never is", () => {
    assert.equal(r.poll_out, true, "precondition: no status was on its way when the change was made");
    const first = r.seen.indexOf("ASDM7EC");
    assert.ok(first > -1, "the change never showed: " + JSON.stringify(r.seen));
    assert.deepEqual(r.seen.slice(first).filter((v) => v !== "ASDM7EC"), [], "the old modulator came back: " + JSON.stringify(r.seen));
  });
});

test("Back from an artist view brings the screen back live (v1.8.74)", async (t) => {
  // Now playing's artist link opens the artist view over whatever screen is
  // up; Back puts that screen's nodes back. The HQPWeb screen came back
  // frozen — leaving it had stopped its poll and nothing started it again.
  const f = await fx();
  const r = render("hqp-artist-back", stub(f), `
    T("rate_before", __text(".hqp-rate"));
    window.__showArtistAlbums("Miles Davis");
    await window.__sleep(800);
    var away = __nowCalls();
    await window.__sleep(3200);
    T("polls_away", __nowCalls() - away);
    // The artist page's Back is the shared ‹ in the top bar since v1.8.74.
    document.getElementById("topbar-back").click();
    await window.__sleep(300);
    T("back", !!document.querySelector("#album-grid .hqp-screen"));
    window.__fx.now = window.__fx.nowDsd512;          // HQPlayer moved on meanwhile
    var back = __nowCalls();
    await window.__sleep(3200);
    T("polls_back", __nowCalls() - back);
    T("rate_after", __text(".hqp-rate"));
    // One artist view opened from another puts this screen back for a moment
    // and takes it away again: its poll must not run on behind the second.
    window.__showArtistAlbums("Miles Davis");
    await window.__sleep(500);
    window.__showArtistAlbums("John Coltrane");
    await window.__sleep(800);
    var chained = __nowCalls();
    await window.__sleep(3200);
    T("polls_chained", __nowCalls() - chained);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("not polled while it is away", () => {
    assert.equal(r.rate_before, "DSD1024");
    assert.equal(r.polls_away, 0);
  });
  await t.test("THE one: polled again once it is back, and showing what HQPlayer does NOW", () => {
    assert.equal(r.back, true, "precondition: Back did not put the HQPWeb screen back");
    assert.ok(r.polls_back >= 2, "only " + r.polls_back + " polls in 3.2 s after Back");
    assert.equal(r.rate_after, "DSD512");
  });
  await t.test("and not behind a second artist view opened from the first", () => {
    assert.equal(r.polls_chained, 0);
  });
});

test("a screen where nothing moves is not rewritten by every poll (v1.8.74)", async (t) => {
  const f = await fx();
  const r = render("hqp-quiet", stub(f), `
    await window.__sleep(1600);
    var root = document.querySelector(".hqp-screen");
    var recs = [];
    var mo = new MutationObserver(function (l) { l.forEach(function (m) {
      recs.push(m.type + ":" + (m.attributeName || "") + ":" + (m.target.className || (m.target.parentNode && m.target.parentNode.className) || ""));
    }); });
    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    var n0 = __nowCalls();
    await window.__sleep(4600);
    mo.disconnect();
    T("polls", __nowCalls() - n0);
    T("mutations", recs.slice(0, 12));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: no node is written — the result line is role=status, re-announced on every write", () => {
    assert.ok(r.polls >= 3, "precondition: only " + r.polls + " polls");
    assert.deepEqual(r.mutations, []);
  });
});

test("lists that cannot be read are asked for again, but not on every poll (v1.8.74)", async (t) => {
  const f = await fx();
  const r = render("hqp-caps-fail", stub(f, { capsAnswer: { status: 502, body: { error: "HQPlayer didn't answer: <VolumeRange> has no min" } } }), `
    var c0 = window.__callsMatching("/api/hqp/capabilities");
    var n0 = __nowCalls();
    await window.__sleep(12000);
    T("polls", __nowCalls() - n0);
    T("caps_calls", window.__callsMatching("/api/hqp/capabilities") - c0);
    T("presets_calls", window.__callsMatching("/api/hqp/presets"));
    T("alert", __shown(".hqp-alert") ? __text(".hqp-alert") : null);
    T("rows_disabled", document.querySelector('.hqp-row[data-field="filter1x"]').disabled);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: a few times in twelve seconds, not once per poll", () => {
    assert.ok(r.polls >= 6, "precondition: only " + r.polls + " polls");
    assert.ok(r.caps_calls >= 1 && r.caps_calls <= 3, r.caps_calls + " reads of the lists in " + r.polls + " polls");
    assert.equal(r.presets_calls, 0, "the presets were asked for though their previews need the lists");
  });
  await t.test("and the screen says why its controls are not there", () => {
    assert.match(r.alert, /Couldn't read HQPlayer's lists of filters and modulators \(HQPlayer didn't answer: <VolumeRange> has no min\); trying again\./);
    assert.equal(r.rows_disabled, true);
  });
});

test("a rollback that could not put everything back says what it left (v1.8.74)", async (t) => {
  const f = await fx();
  const rb = JSON.parse(JSON.stringify(f.rollback));
  rb.rolledBack.skipped = [{ field: "matrixProfile", reason: "\"Headphones\" is not one of this HQPlayer's matrix profiles" }];
  const after = Object.assign({}, f.nowDsd512, { undoAvailable: false });
  const r = render("hqp-rollback-skipped", stub(f, { now: f.nowDsd512, nowAfter: after, caps: f.capsDsd512, guide: f.guideDsd512,
                                                    changeAnswer: { status: 200, body: rb } }), `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(400);
    document.querySelector('.hqp-pick-item[data-name="ASDM7EC-fast"]').click();
    await window.__sleep(1200);
    T("msg", __text(".hqp-msg"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("what went back, then what did not", () => {
    assert.match(r.msg, /^Undone: AHM7EC8B needs .*Modulator back to ASDM7EC\. Couldn't put back: Matrix profile \("Headphones" is not one of this HQPlayer's matrix profiles\)\. Playback resumed\./);
  });
});

test("the presets sheet (v1.8.74)", async (t) => {
  const f = await fx();
  const r = render("hqp-presets", stub(f), `
    document.querySelector('.hqp-row[data-field="presets"]').click();
    await window.__sleep(500);
    var rows = Array.prototype.slice.call(document.querySelectorAll(".hqp-preset"));
    T("rows", rows.map(function (row) {
      var m = row.querySelector(".hqp-preset-main");
      return { name: m.querySelector(".hqp-preset-name").firstChild.textContent, badge: m.querySelector(".hqp-badge").textContent,
               disabled: m.disabled };
    }));
    var name = document.querySelector(".hqp-preset-input");
    name.value = "Late night";
    document.querySelector(".hqp-preset-vol input").checked = true;
    Array.prototype.find.call(document.querySelectorAll(".hqp-preset-foot button"), function (b) { return b.textContent === "Save"; }).click();
    await window.__sleep(400);
    T("save", window.__posts.filter(function (p) { return /\\/api\\/hqp\\/presets$/.test(p.url); }));
    // The major one asks first.
    rows[1].querySelector(".hqp-preset-main").click();
    await window.__sleep(300);
    T("confirm", !document.getElementById("confirm-overlay").classList.contains("hidden") ? document.getElementById("confirm-msg").textContent : null);
    document.getElementById("confirm-no").click();
    await window.__sleep(300);
    T("applied_after_no", window.__posts.filter(function (p) { return /apply$/.test(p.url); }).length);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("each preset with what applying it would mean here", () => {
    assert.deepEqual(r.rows, [
      { name: "DSD1024 xla", badge: "✓ in effect", disabled: true },
      { name: "PCM 384k", badge: "major", disabled: false },
    ]);
  });
  await t.test("saving the current settings, with the volume only when asked", () => {
    assert.equal(r.save.length, 1);
    assert.deepEqual(r.save[0].body, { name: "Late night", fromCurrent: true, includeVolume: true });
    assert.equal(r.save[0].type, "application/json");
  });
  await t.test("a preset that changes the mode or the rate asks first, and No means no", () => {
    assert.match(r.confirm, /changes the mode or the output rate/);
    assert.equal(r.applied_after_no, 0);
  });
});

test("hqpweb 0.1.0-beta.2: counters, the picker's guide, and a filter the rate rules out (v1.8.78)", async (t) => {
  const f = await fx();
  const r = render("hqp-beta2", stub(f, { now: f.nowPcm192, caps: f.capsPcm192 }), `
    T("sub", __text(".hqp-sub"));
    T("counters", __shown(".hqp-counters"));
    T("apod", __text(".hqp-counters .hqp-counter"));
    T("clips", document.querySelectorAll(".hqp-counters .hqp-counter")[1].textContent);
    T("apod_btn", __shown(".hqp-counters .hqp-link"));
    T("handled", __text(".hqp-counter-note"));
    T("other_src", __shown(".hqp-other-src") ? __text(".hqp-other-src") : null);
    document.querySelector('.hqp-row[data-field="filter1x"]').click();
    await window.__sleep(400);
    var item = function (n) { return document.querySelector('.hqp-pick-item[data-name="' + n + '"]'); };
    var visible = function (n) { var e = item(n); return !!e && !e.classList.contains("hidden"); };
    T("chips", Array.prototype.map.call(document.querySelectorAll(".hqp-chip"), function (c) {
      return c.textContent + (c.classList.contains("is-on") ? "*" : ""); }));
    T("sincM_hidden", !visible("sinc-M"));
    T("gauss_stars", item("poly-sinc-gauss-long").querySelector(".hqp-pick-stars").textContent);
    T("gauss_guide", item("poly-sinc-gauss-long").querySelector(".hqp-pick-guide").textContent);
    document.querySelector(".hqp-chip").click();                  // Compatible off: show all
    T("sincM_shown", visible("sinc-M"));
    T("sincM_blocked", item("sinc-M").classList.contains("is-blocked"));
    T("sincM_why", item("sinc-M").querySelector(".hqp-pick-why").textContent);
    item("sinc-M").click();
    await window.__sleep(500);
    T("offer_title", __text(".lib-sheet-head h3"));
    T("offer", Array.prototype.map.call(document.querySelectorAll(".lib-sheet .hqp-pick-item .hqp-pick-name"), function (n) { return n.textContent; }));
    document.querySelector(".lib-sheet .hqp-pick-item").click();   // the nearest rate
    await window.__sleep(800);
    T("posts", window.__posts.filter(function (p) { return /\\/api\\/hqp\\/change$/.test(p.url); }).map(function (p) { return p.body; }));
  `);
  harness.assertNoPageError(assert, r);

  await t.test("the output word's width beside the mode", () => {
    assert.match(r.sub, /^PCM 32-bit · from 44\.1 kHz/);
  });
  await t.test("HQPlayer's apodization and clip counters, and that the filter in use handles it", () => {
    assert.equal(r.counters, true);
    assert.equal(r.apod, "Apod 15");
    assert.equal(r.clips, "Clips 2");
    // poly-sinc-gauss-long is apodizing in HQPlayer 6's own table.
    assert.equal(r.handled, "your filter handles this");
    assert.equal(r.apod_btn, false, "an apodizing filter was suggested over one that already apodizes");
  });
  await t.test("THE one: a filter the fixed rate rules out is hidden, and Compatible is on by default", () => {
    assert.equal(r.chips[0], "Compatible*");
    assert.equal(r.sincM_hidden, true, "sinc-M cannot do 44.1k → 192k and was listed among the compatible");
    assert.equal(r.sincM_shown, true);
    assert.equal(r.sincM_blocked, true);
    assert.match(r.sincM_why, /power-of-two ratio; 44\.1k → 192k is 4\.35×/);
  });
  await t.test("HQPlayer's own guide beside a filter: its rating and its focus", () => {
    assert.equal(r.gauss_stars, "★★★★★");
    assert.match(r.gauss_guide, /transients, timbre, space · ratio Any/);
  });
  await t.test("picking it offers the rates that fit, nearest first — and sends both together", () => {
    assert.equal(r.offer_title, "sinc-M");
    assert.equal(r.offer[0], "176.4 kHz");
    assert.ok(r.offer.includes("Auto") && r.offer.includes("Apply anyway"), JSON.stringify(r.offer));
    assert.deepEqual(r.posts, [{ filter1x: "sinc-M", rate: 176400 }]);
  });
});

test("a volume that rose without this app is flagged, with the way back (v1.8.78)", async (t) => {
  const f = await fx();
  const snap = Object.assign({}, f.now.snapshot, {
    state: Object.assign({}, f.now.snapshot.state, { volume: -3 }),
    volumeJump: { from: -22, to: -3, at: "2026-10-05T10:00:00.000Z", restarted: true },
  });
  const r = render("hqp-jump", stub(f, { now: Object.assign({}, f.now, { snapshot: snap }) }), `
    T("shown", __shown(".hqp-flag:not(.is-bad)"));
    T("text", __text(".hqp-flag:not(.is-bad) .hqp-flag-text"));
    var btns = document.querySelectorAll(".hqp-flag:not(.is-bad) .hqp-flag-btn");
    T("buttons", Array.prototype.map.call(btns, function (b) { return b.textContent; }));
    btns[0].click();
    await window.__sleep(600);
    btns[1].click();
    await window.__sleep(400);
    T("posts", window.__posts.map(function (p) { return [p.url, p.body]; }));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: it says what happened and the likely why", () => {
    assert.equal(r.shown, true);
    assert.match(r.text, /rose from -22\.0 to -3\.0 dB without this app — HQPlayer most likely restarted/);
  });
  await t.test("Back lowers it to where it was; Dismiss tells the server", () => {
    assert.deepEqual(r.buttons, ["Back to -22.0 dB", "Dismiss"]);
    assert.deepEqual(r.posts[0], ["/api/hqp/change", { volume: -22 }]);
    assert.deepEqual(r.posts[r.posts.length - 1], ["/api/hqp/volume-jump/dismiss", {}]);
  });
});

test("a rollback that leaves HQPlayer's own playlist stopped offers Restart playback (v1.8.78)", async (t) => {
  const f = await fx();
  // HQPlayer playing from its own playlist (not fed by Roon), and a rollback
  // after which it did not resume.
  const status = Object.assign({}, f.nowDsd512.snapshot.status, {
    source: Object.assign({}, f.nowDsd512.snapshot.status.source, { song: "track01.flac" }) });
  const now = Object.assign({}, f.nowDsd512, { snapshot: Object.assign({}, f.nowDsd512.snapshot, { status }), undoAvailable: false });
  const answer = Object.assign({}, f.rollback, {
    rolledBack: Object.assign({}, f.rollback.rolledBack, { playback: { kind: "stopped", detail: "state 0" } }) });
  const r = render("hqp-restart", stub(f, { now, nowAfter: now, caps: f.capsDsd512, guide: f.guideDsd512, changeAnswer: { status: 200, body: answer } }), `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(400);
    document.querySelector('.hqp-pick-item[data-name="ASDM7EC-fast"]').click();
    await window.__sleep(1200);
    T("msg", __text(".hqp-msg"));
    var restart = Array.prototype.find.call(document.querySelectorAll(".hqp-result button"), function (b) {
      return b.textContent === "Restart playback"; });
    T("restart_shown", !!restart && !restart.classList.contains("hidden"));
    restart.click();
    await window.__sleep(600);
    T("last_post", window.__posts[window.__posts.length - 1]);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: it says playback stopped and offers to restart it, not \"HQPlayer may need a restart\"", () => {
    assert.match(r.msg, /Playback stopped \(state 0\): restart it below\. If it still won't play, restart HQPlayer\./);
    assert.doesNotMatch(r.msg, /may need a restart/);
    assert.equal(r.restart_shown, true);
  });
  await t.test("Restart playback is a JSON POST", () => {
    assert.equal(r.last_post.url, "/api/hqp/restart");
    assert.equal(r.last_post.type, "application/json");
  });
});

test("the next track won't start: said, with the fixes (v1.8.78)", async (t) => {
  const f = await fx();
  // HQPlayer stopped with a 44.1k track queued in its own playlist that sinc-M
  // cannot play at the fixed 192k (the shape guards() returns; see hqp-beta2).
  const caps = Object.assign({}, f.capsPcm192, { guards: {
    wedge: { slot: "filter1x", filter: "sinc-M", cause: "filter",
             text: "sinc-M needs a power-of-two ratio; 44.1k → 192k is 4.35×",
             rates: [{ rate: 88200, nearest: false }, { rate: 176400, nearest: true }] },
    otherSources: ["sinc-M won't play 48k sources"],
  } });
  const r = render("hqp-wedge", stub(f, { now: f.nowPcm192, caps }), `
    T("text", __shown(".hqp-flag.is-bad") ? __text(".hqp-flag.is-bad .hqp-flag-text") : null);
    var btns = document.querySelectorAll(".hqp-flag.is-bad .hqp-flag-btn");
    T("buttons", Array.prototype.map.call(btns, function (b) { return b.textContent; }));
    T("other", __shown(".hqp-other-src") ? __text(".hqp-other-src") : null);
    btns[0].click();
    await window.__sleep(800);
    T("post", window.__posts.filter(function (p) { return /\\/api\\/hqp\\/change$/.test(p.url); }).map(function (p) { return p.body; }));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: why the next track won't start, before Play is pressed in vain", () => {
    assert.equal(r.text, "The next track won't start: sinc-M needs a power-of-two ratio; 44.1k → 192k is 4.35×. " +
      "HQPlayer ignores Play until this is fixed.");
  });
  await t.test("the nearest rate that fits, Auto, or another filter", () => {
    assert.deepEqual(r.buttons, ["Output 176.4 kHz", "Auto rate", "Choose another filter…"]);
    assert.deepEqual(r.post, [{ rate: 176400 }]);
  });
  await t.test("and the sources the next album might use that would not play", () => {
    assert.equal(r.other, "At this fixed rate: sinc-M won't play 48k sources.");
  });
});

test("a chip from one picker never empties another (v1.8.78)", async (t) => {
  const f = await fx();
  const r = render("hqp-chip-leak", stub(f, { now: f.nowPcm192, caps: f.capsPcm192 }), `
    document.querySelector('.hqp-row[data-field="filter1x"]').click();
    await window.__sleep(400);
    var top = Array.prototype.find.call(document.querySelectorAll(".hqp-chip"), function (c) { return c.textContent === "5/5"; });
    T("had_top", !!top);
    top.click();
    T("filters_shown", document.querySelectorAll(".lib-sheet .hqp-pick-item:not(.hidden)").length);
    document.querySelector(".lib-sheet-close, .lib-sheet [aria-label='Close']") ? document.querySelector(".lib-sheet-close, .lib-sheet [aria-label='Close']").click()
      : document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await window.__sleep(500);
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(400);
    T("shapers_total", document.querySelectorAll(".lib-sheet .hqp-pick-item").length);
    T("shapers_shown", document.querySelectorAll(".lib-sheet .hqp-pick-item:not(.hidden)").length);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: 5/5 chosen among the filters leaves every dither listed", () => {
    assert.equal(r.had_top, true);
    assert.ok(r.filters_shown < 77, "the 5/5 chip narrowed nothing");
    assert.ok(r.shapers_total > 1);
    assert.equal(r.shapers_shown, r.shapers_total, "a filter chip hid the dithers, with no chip there to undo it");
  });
});

test("the picker's search sits above the list, never over it (v1.8.78)", async (t) => {
  const f = await fx();
  const r = render("hqp-pick-pin", stub(f), `
    document.querySelector('.hqp-row[data-field="filter1x"]').click();
    await window.__sleep(500);
    var search = document.querySelector(".lib-sheet .hqp-pick-search");
    var body = document.querySelector(".lib-sheet .lib-sheet-body");
    T("in_scroller", !!search.closest(".lib-sheet-body"));
    body.scrollTop = 600;
    await window.__sleep(100);
    var sb = search.getBoundingClientRect();
    var bt = body.getBoundingClientRect().top;
    T("gap", Math.round(bt - sb.bottom));
    // The topmost point of the list that is visible: whatever is drawn there must be in the list.
    var hit = document.elementFromPoint(sb.left + 20, sb.top + sb.height / 2);
    T("hit_is_search", hit === search);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the search is outside the scrolling list, and the list starts below it", () => {
    assert.equal(r.in_scroller, false, "the search scrolls with the list again");
    assert.ok(r.gap >= 0, "the list starts above the search's bottom edge: " + r.gap);
    assert.equal(r.hit_is_search, true, "a row is drawn over the search");
  });
});

test("an undo that couldn't reach HQPlayer says it tried, not that it did (v1.8.78)", async (t) => {
  // hqpweb af08939: an overloaded HQPlayer can stop answering, and then no undo reaches it.
  const f = await fx();
  const answer = Object.assign({}, f.rollback, { rolledBack: { results: [],
    playback: { kind: "inconclusive", detail: "couldn't roll back: timeout after 5000 ms waiting for 192.0.2.10:4321" } } });
  const now = Object.assign({}, f.nowDsd512, { undoAvailable: false });
  const r = render("hqp-unreached", stub(f, { now, nowAfter: now, caps: f.capsDsd512, guide: f.guideDsd512, changeAnswer: { status: 200, body: answer } }), `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(400);
    document.querySelector('.hqp-pick-item[data-name="ASDM7EC-fast"]').click();
    await window.__sleep(1200);
    T("msg", __text(".hqp-msg"));
    T("restart", Array.prototype.some.call(document.querySelectorAll(".hqp-result button"), function (b) {
      return b.textContent === "Restart playback" && !b.classList.contains("hidden"); }));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: \"Tried to undo it\", why, and what helps", () => {
    assert.match(r.msg, /^Tried to undo it: /);
    assert.doesNotMatch(r.msg, /^Undone/);
    assert.match(r.msg, /HQPlayer didn't answer, so the old settings may not be back \(timeout after 5000 ms/);
    assert.match(r.msg, /restart HQPlayer, and check its volume afterwards/);
    assert.equal(r.restart, false, "Restart playback offered to an HQPlayer that isn't answering");
  });
});

test("the modulator sheet's Guide: questions, then where to start (v1.8.78, hqpweb main 525f8d7)", async (t) => {
  const f = await fx();
  const r = render("hqp-guide", stub(f) + `try { localStorage.removeItem("rra-hqp-advice-tab"); localStorage.removeItem("rra-hqp-guide-intro-seen"); } catch (e) { /* no storage: a fresh page has neither key anyway */ }`, `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(500);
    T("tabs", Array.prototype.map.call(document.querySelectorAll(".lib-sheet .hqp-tab"), function (b) { return b.textContent + ":" + b.getAttribute("aria-selected"); }));
    T("now", __text(".lib-sheet .hqp-now"));
    document.querySelector('.lib-sheet .hqp-tab[data-tab="guide"]').click();
    await window.__sleep(200);
    T("search_hidden_on_guide", !__shown(".lib-sheet .hqp-pick-search"));
    T("intro_full", /No set of rules/.test(__text(".lib-sheet .hqp-intro")));
    T("steps_before", Array.prototype.map.call(document.querySelectorAll(".lib-sheet .hqp-step"), function (s) {
      return s.querySelector(".hqp-step-title").textContent + (s.classList.contains("is-off") ? " (off)" : ""); }));
    T("dsd_choices", document.querySelectorAll(".lib-sheet .hqp-step:first-child .hqp-choice").length);
    document.querySelector('.lib-sheet .hqp-step:first-child .hqp-choice[data-value="direct"]').click();
    await window.__sleep(600);
    T("setup_post", window.__posts.filter(function (p) { return /\\/api\\/hqp\\/setup$/.test(p.url); }).map(function (p) { return [p.type, p.body]; }));
    T("saved_msg", __text(".lib-sheet .hqp-sheet-msg"));
    T("summary", __text(".lib-sheet .hqp-step:first-child .hqp-step-sum"));
    T("pairs", Array.prototype.map.call(document.querySelectorAll(".lib-sheet .hqp-pair .hqp-pair-name strong"), function (s) { return s.textContent; }));
    T("cite", (function () { var a = document.querySelector(".lib-sheet .hqp-pair .hqp-rules a"); return a ? [a.textContent, a.getAttribute("href"), a.target] : null; })());
    var pair = document.querySelector('.lib-sheet .hqp-pair[data-rate="11289600"] .hqp-use');
    pair.click();
    await window.__sleep(800);
    T("pair_post", window.__posts.filter(function (p) { return /change$/.test(p.url); }).map(function (p) { return p.body; }));
    T("sheet_stays", !!document.querySelector(".lib-sheet"));
    T("tab_saved", (function () { try { return localStorage.getItem("rra-hqp-advice-tab"); } catch (e) { return null; } })());
  `);
  harness.assertNoPageError(assert, r);
  await t.test("List and Guide tabs, List first, and what is in use now", () => {
    assert.deepEqual(r.tabs, ["List:true", "Guide Beta:false"]);
    assert.equal(r.now, "Now using AHM7EC8B");
  });
  await t.test("the guide opens with what it is, then the three questions, the later ones waiting on the first", () => {
    assert.equal(r.search_hidden_on_guide, true);
    assert.equal(r.intro_full, true);
    assert.deepEqual(r.steps_before, ["Your DAC", "Your amplifier (off)", "Your volume (off)"]);
    assert.equal(r.dsd_choices, 4);
  });
  await t.test("THE one: an answer is saved as JSON, and the guide offers rate-and-modulator pairs, cited", () => {
    assert.deepEqual(r.setup_post, [["application/json", { dsd: "direct" }]]);
    assert.match(r.saved_msg, /^Saved\./);
    assert.match(r.summary, /^DSD goes straight to the converter: order 7\. Change$/);
    assert.deepEqual(r.pairs, ["DSD256 · ASDM7EC-fast", "DSD1024 · AHM7EC8B", "DSD512 · ASDM7EC-fast"]);
    assert.match(r.cite[0], /^Jussi, \w+ \d{4}$/);
    assert.match(r.cite[1], /^https:\/\/community\.roonlabs\.com\/t\//);
    assert.equal(r.cite[2], "_blank");
  });
  await t.test("a pair is one change, rate and modulator together, and the guide stays open to try another", () => {
    assert.deepEqual(r.pair_post, [{ rate: 11289600, shaper: "ASDM7EC-fast" }]);
    assert.equal(r.sheet_stays, true);
    assert.equal(r.tab_saved, "guide");
  });
});

test("the List keeps its place: Show all and a search don't jump back to the current row (v1.8.78)", async (t) => {
  const f = await fx();
  const r = render("hqp-list-place", stub(f) + `try { localStorage.removeItem("rra-hqp-advice-tab"); } catch (e) { /* no storage: the List is the default */ }`, `
    document.querySelector('.hqp-row[data-field="shaper"]').click();
    await window.__sleep(600);
    var body = document.querySelector(".lib-sheet .lib-sheet-body");
    T("opened_at", Math.round(body.scrollTop));
    body.scrollTop = body.scrollHeight;
    await window.__sleep(100);
    var more = body.querySelectorAll(".hqp-show-all");
    var last = more[more.length - 1];
    var before = Math.round(body.scrollTop);
    last.click();
    await window.__sleep(300);
    T("after_show_all", Math.round(body.scrollTop) - before);
    T("page_scrolled", window.scrollY);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: Show all leaves the list where it was", () => {
    assert.ok(Math.abs(r.after_show_all) <= 2, "the list jumped " + r.after_show_all + "px after Show all");
    assert.equal(r.page_scrolled, 0, "the page under the sheet was scrolled");
  });
});
