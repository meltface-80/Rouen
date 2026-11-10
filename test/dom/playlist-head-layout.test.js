"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t9, what its review found: the name of a playlist's page stays on the ‹'s line when the bar changes under it.
//
// The owner, 2026-11-09: "Put the name of the playlist on the same line as the brass < chevron and if two lines place
// the second row under the first without the top line moving position." playlist-head.test.js holds that for a page
// as it opens. Here, the same page while something else is on screen with it, each a case the first build got wrong:
//
//   - albums selected on a Dynamic Playlist: the layout's rules excluded the selection, so the name dropped a row
//     and the page jumped under the finger that had just selected;
//   - the bar's own box changing with no resize of the window (a status bar's inset arriving late, a notice opening
//     in the bar): the ‹ was measured on window resize only;
//   - a larger title size (Settings → Display): a line taller than the ‹ was pushed down by a padding that cannot
//     go negative, so it sat low;
//   - a banner between the name and the page: the line under the name was still indented to the name;
//   - a mouse and a narrow window: the name was cut short with an ellipsis.
//
// Every position compared is read in one pass of the page, from one source (dev/lessons.md). Not shown here: a
// phone's safe areas and a real rotation, which only the device has.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, LONG, STUB, HELPERS, mid } = require("./playlist-head-kit");

const near = (/** @type {number} */ a, /** @type {number} */ b, tol = 0.5) => Math.abs(a - b) <= tol;

test("touch, a selection's menu in the bar: the page does not move, and the name ends short of the menu", { skip: !harness.available }, async () => {
  // touchnav.js reads the selection off #select-menu-wrap, as this shows and hides it (multi-select.js does the same).
  const driver = HELPERS + `
  var sm = document.getElementById("select-menu-wrap");
  var select = async function (on) { sm.classList.toggle("hidden", !on); await window.__sleep(600); };
  await menu("playlists");
  await open("Late Night");
  T("short", read());
  await select(true);
  T("shortSel", read());
  await select(false);
  T("shortAfter", read());
  await back();
  await open(${JSON.stringify(LONG)});
  T("long", read());
  await select(true);
  T("longSel", read());
`;
  const r = harness.renderPage({ name: "playlist-head-select", windowSize: "390x844", budgetMs: 30000, chromeArgs: TOUCH, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  for (const k of ["shortSel", "longSel"]) {
    assert.deepEqual([r[k].selecting, r[k].pl, !!r[k].sel], [true, true, true], k + ": no selection on a playlist's page: the test shows nothing");
  }
  assert.deepEqual([r.short.selecting, r.shortAfter.selecting], [false, false]);
  for (const [a, b] of [["short", "shortSel"], ["short", "shortAfter"], ["long", "longSel"]]) {
    assert.ok(near(r[a].lines[0].top, r[b].lines[0].top), `${b}: the name's first line moved from ${r[a].lines[0].top} to ${r[b].lines[0].top}`);
    assert.ok(near(r[a].back.top, r[b].back.top), `${b}: the ‹ moved from ${r[a].back.top} to ${r[b].back.top}`);
    assert.ok(near(mid(r[b].lines[0]), mid(r[b].back), 1.5), `${b}: the name is centred at ${mid(r[b].lines[0])}, the ‹ at ${mid(r[b].back)}`);
  }
  // Nothing under the name moves either.
  assert.ok(near(r.short.actions.top, r.shortSel.actions.top),
    `selecting moved the page: its buttons from ${r.short.actions.top} to ${r.shortSel.actions.top}`);
  // A long one makes room for the menu, which has the bar's right-hand corner: one line (2.0.4-t10), cut with … short of it.
  // Unselected, the line (the name cut with …, its count at the end) reaches where the menu goes.
  assert.ok(r.long.count && r.long.count.right > r.longSel.sel.left, "the long name's line never reached where the menu goes: the test shows nothing");
  assert.equal(r.longSel.lines.length, 1, "the long name is not on one line");
  for (const l of r.longSel.lines) assert.ok(l.right <= r.longSel.sel.left, `the name ends at ${l.right}, under the menu at ${r.longSel.sel.left}`);
  assert.ok(!r.longSel.count || r.longSel.count.right <= r.longSel.sel.left + 0.5, "the count beside the name runs under the menu");
});

test("touch: the ‹ moved by the bar's own box, no resize of the window — the name follows it", { skip: !harness.available }, async () => {
  // What an iPhone does when the status bar's inset arrives after the page, or a notice opens in the bar: the bar's
  // padding grows and nothing tells the window. A ResizeObserver on the bar is what hears of it, and this harness
  // never delivers one (it draws no frames), so the page is given one that the driver delivers by hand: what is
  // shown is that the bar is watched, border box and all, and that being told is enough. Then a rotation as iOS
  // reports it, the event first and the new size a moment after: the ‹ is read again as the screen settles.
  const stub = `window.__ro = [];
window.ResizeObserver = function (cb) {
  this.observe = function (el, o) { window.__ro.push({ cb: cb, el: el, box: (o && o.box) || "content-box" }); };
  this.unobserve = this.disconnect = function () {};
};\n` + STUB;
  const driver = HELPERS + `
  var bar = document.querySelector(".topbar");
  await menu("playlists");
  await open("Late Night");
  T("before", read());
  bar.style.paddingTop = "40px";
  await window.__sleep(400);
  T("unheard", read());
  var watching = window.__ro.filter(function (o) { return o.el === bar && o.box === "border-box"; });
  T("watching", watching.length);
  watching.forEach(function (o) { o.cb([{ target: bar }]); });
  await window.__sleep(100);
  T("after", read());
  window.dispatchEvent(new Event("orientationchange"));
  await window.__sleep(150);
  bar.style.paddingTop = "70px";
  await window.__sleep(1200);
  T("turned", read());
`;
  const r = harness.renderPage({ name: "playlist-head-bar", windowSize: "390x844", budgetMs: 30000, chromeArgs: TOUCH, stub, driver });
  harness.assertNoPageError(assert, r);
  assert.ok(near(mid(r.before.lines[0]), mid(r.before.back), 1.5));
  assert.ok(r.unheard.back.top - r.before.back.top > 20, `the ‹ did not move (${r.before.back.top} to ${r.unheard.back.top}): the test shows nothing`);
  assert.ok(!near(mid(r.unheard.lines[0]), mid(r.unheard.back), 1.5), "the name followed the ‹ before the bar's observer was told: the test shows nothing of it");
  assert.ok(r.watching >= 2, "the bar's border box is watched by " + r.watching + " (app.js's --topbar-h and the playlist's head)");
  assert.ok(near(mid(r.after.lines[0]), mid(r.after.back), 1.5),
    `the ‹ moved to ${mid(r.after.back)} and the name stayed at ${mid(r.after.lines[0])}`);
  assert.ok(r.after.actions.top >= r.after.lines[0].bottom - 3, "the page is over its name");
  assert.ok(r.turned.back.top - r.after.back.top > 20, "the ‹ did not move after the turn: the test shows nothing");
  assert.ok(near(mid(r.turned.lines[0]), mid(r.turned.back), 1.5),
    `after a turn the ‹ settled at ${mid(r.turned.back)} and the name was left at ${mid(r.turned.lines[0])}`);
});

test("touch, the largest title size: a line taller than the ‹ is still centred on it, and a long name, cut, does not move it", { skip: !harness.available }, async () => {
  const driver = HELPERS + `
  await menu("playlists");
  await open("Late Night");
  T("short", read());
  await back();
  await open(${JSON.stringify(LONG)});
  T("long", read());
`;
  const stub = `try { localStorage.setItem("rra-ui-title", "2"); } catch (e) { /* storage optional */ }\n` + STUB;
  const r = harness.renderPage({ name: "playlist-head-big", windowSize: "390x844", budgetMs: 30000, chromeArgs: TOUCH, stub, driver });
  harness.assertNoPageError(assert, r);
  const line = r.short.lines[0], b = r.short.back;
  assert.ok(line.bottom - line.top > b.bottom - b.top, `the line (${line.bottom - line.top}px) is not taller than the ‹ (${b.bottom - b.top}px): the test shows nothing`);
  assert.ok(near(mid(line), mid(b), 1.5), `the name is centred at ${mid(line)}, the ‹ at ${mid(b)}`);
  assert.ok(line.top >= 0, "the name starts above the screen");
  assert.equal(r.long.lines.length, 1, "the long name is not on one line (2.0.4-t10)");
  assert.ok(near(r.long.lines[0].top, line.top), `the long name sits at ${r.long.lines[0].top}, a short one at ${line.top}`);
  assert.ok(near(r.long.back.top, b.top), "the long name moved the ‹");
  assert.ok(r.short.actions.top >= line.bottom - 3, "the page is over its name");
});

test("touch, a banner under the name: the page's top (its buttons) starts with the page, clear of the banner", { skip: !harness.available }, async () => {
  // The banners are <main>'s own, between the name and the grid; app.js's setBanner shows this one so.
  const driver = HELPERS + `
  await menu("playlists");
  await open("Late Night");
  T("before", read());
  var bn = document.getElementById("status-banner");
  bn.textContent = "Roon is not answering.";
  bn.classList.remove("hidden");
  await window.__sleep(400);
  T("banner", read());
`;
  const r = harness.renderPage({ name: "playlist-head-banner", windowSize: "820x1180", budgetMs: 30000, chromeArgs: TOUCH, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  // "Late Night"'s line is a count, beside the name (2.0.4-t10): what comes under the name is the page's buttons.
  assert.equal(r.before.sub, null, "the count is not beside the name: the test is not of what it says");
  const g = r.banner;
  assert.ok(g.bannerBox && g.bannerBox.top >= g.lines[0].bottom - 3 && g.bannerBox.bottom <= g.actions.top,
    `the banner is not between the name and the buttons: ${JSON.stringify([g.lines[0], g.bannerBox, g.actions])}`);
  assert.ok(near(g.actions.left, g.contentLeft, 1), `under a banner the buttons start at ${g.actions.left}, the page at ${g.contentLeft}`);
  assert.ok(g.actions.top - g.bannerBox.bottom >= 6, `the buttons are ${g.actions.top - g.bannerBox.bottom}px under the banner`);
  assert.ok(near(mid(g.lines[0]), mid(g.back), 1.5), "the banner moved the name off the ‹'s line");
});

test("a mouse, a narrow window: a long name wraps under itself in the bar, whole, and neither its first line nor the ‹ moves", { skip: !harness.available }, async () => {
  const driver = HELPERS + `
  await menu("playlists");
  await open("Late Night");
  T("short", read());
  await back();
  await open(${JSON.stringify(LONG)});
  T("long", read());
`;
  const r = harness.renderPage({ name: "playlist-head-mouse-narrow", windowSize: "520x700", budgetMs: 30000, chromeArgs: harness.MOUSE, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  const g = r.long;
  assert.notEqual(g.titleIn, "tnav-heading", "the bar's title moved out of the bar for a mouse");
  assert.equal(g.title, LONG);
  assert.equal(g.clipped, false, "the name is cut short");
  assert.ok(g.lines.length >= 2, "the long name is on one line in a 520px window: " + JSON.stringify(g.lines));
  assert.ok(near(g.lines[1].left, g.lines[0].left, 1), "the second line doesn't start under the first");
  assert.ok(near(g.lines[0].top, r.short.lines[0].top), `a second line moved the first: ${g.lines[0].top} against ${r.short.lines[0].top}`);
  assert.ok(near(g.back.top, r.short.back.top), `a second line moved the ‹: ${g.back.top} against ${r.short.back.top}`);
  assert.ok(near(mid(r.short.lines[0]), mid(r.short.back), 2), "a short name is not on the ‹'s line");
  const last = g.lines[g.lines.length - 1];
  assert.ok(last.bottom <= g.bar.bottom && last.right <= g.width, "the name runs out of the bar");
  assert.ok(g.sub.top >= g.bar.bottom, `the page starts at ${g.sub.top}, under a bar that ends at ${g.bar.bottom}`);
});
