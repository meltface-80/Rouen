"use strict";
// ---------------------------------------------------------------------------
// v1.9.5: Shelf's two side panes, and two things drawn off-centre.
//
// Asked: "The left hand lane with the genres etc, make it so it can close to
// the left side of the screen and then open back up. Click/tap on a small
// tab" — and "On the right side of the screen, add a similar pane for the
// current playing queue", closing to the right the same way. And, from a
// screenshot: "the x on the popup play option box isn't centred", and "the
// spin button, the animated spinner isn't centred".
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

const RECORDS = [
  ["Air", "Moon Safari"], ["Burial", "Untrue"], ["Daft Punk", "Discovery"], ["Depeche Mode", "Violator"],
  ["Kraftwerk", "Trans-Europe Express"], ["Massive Attack", "Mezzanine"], ["Pink Floyd", "The Wall"], ["Portishead", "Dummy"],
  // enough of a shelf that a wider stage has more of it to show
  ...Array.from({ length: 22 }, (_, i) => ["Zeta Band " + String(i + 1).padStart(2, "0"), "Record " + (i + 1)]),
];
const SHELF = buildShelf(
  RECORDS.map(([artist, title], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i })),
  { genresOf: () => ["Rock"], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF) }, SHELF);
const ZONES = [{ zone_id: "z1", display_name: "Lounge", state: "playing" }, { zone_id: "z2", display_name: "Kitchen", state: "paused" }];
// Playing Violator in the Lounge, so the shelf opens on Violator (the record
// on the platter); the drivers move it away before asking for it back.
const ZONE = { zone_id: "z1", display_name: "Lounge", state: "playing", queue_items_remaining: 5,
  outputs: [{ output_id: "o1", display_name: "Lounge", volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Halo", line2: "Depeche Mode", line3: "Violator", image_key: "k3", length: 270, seek_position: 60 } };
const KITCHEN = { zone_id: "z2", display_name: "Kitchen", state: "paused", queue_items_remaining: 1, outputs: [],
  now_playing: { line1: "Teardrop", line2: "Massive Attack", line3: "Mezzanine", image_key: "k5", length: 330, seek_position: 0 } };
const Q = [
  { queue_item_id: 11, title: "Halo", subtitle: "Depeche Mode", image_key: "k3", length: 270 },
  { queue_item_id: 12, title: "Waiting for the Night", subtitle: "Depeche Mode", image_key: "k3", length: 367 },
  { queue_item_id: 13, title: "Enjoy the Silence", subtitle: "Depeche Mode", image_key: "k3", length: 372 },
  { queue_item_id: 14, title: "Policy of Truth", subtitle: "Depeche Mode", image_key: "k3", length: 295 },
  { queue_item_id: 15, title: "Blue Dress", subtitle: "Depeche Mode", image_key: "k3", length: 341 },
  { queue_item_id: 16, title: "Clean", subtitle: "Depeche Mode", image_key: "k3", length: 332 },
];
const KQ = [{ queue_item_id: 51, title: "Teardrop", subtitle: "Massive Attack", image_key: "k5", length: 330 },
            { queue_item_id: 52, title: "Inertia Creeps", subtitle: "Massive Attack", image_key: "k5", length: 356 }];

// window.__zones / window.__queues are the server's state, so a driver can
// change it under the page; __queueStatus fails the queue read, __queueDelay
// holds it.
const stub = (opts) => `
${opts && opts.noResizeObserver ? "window.ResizeObserver = undefined;" : ""}
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
window.__posts = [];
window.__zones = { z1: ${JSON.stringify(ZONE)}, z2: ${JSON.stringify(KITCHEN)} };
window.__queues = { z1: ${JSON.stringify(Q)}, z2: ${JSON.stringify(KQ)} };
window.__queueStatus = 0; window.__queueDelay = {};
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.5", never: true }));
      ${(opts && opts.store) || ""} } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.5" });
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: true });
  if (u.indexOf("/api/zones") > -1) return ${opts && opts.zonesDown ? "Promise.reject(new TypeError('Failed to fetch'))" : "window.__json({ zones: " + (opts && opts.noZones ? "[]" : JSON.stringify(ZONES)) + " })"};
  if (u.indexOf("/api/zone-state") > -1) { var z = decodeURIComponent((u.split("zone=")[1] || "").split("&")[0]); return window.__json({ zone: window.__zones[z] || null }); }
  if (u.indexOf("/api/queue?") > -1) {
    var qz = decodeURIComponent((u.split("zone=")[1] || "").split("&")[0]);
    if (window.__queueStatus) return window.__json({ error: "no" }, window.__queueStatus);
    var ans = window.__json({ items: window.__queues[qz] || [], history: [] });
    var wait = window.__queueDelay[qz];
    return wait ? new Promise(function (res) { setTimeout(function () { res(ans); }, wait); }) : ans;
  }
  if (u.indexOf("/api/play-from-here") > -1) {
    // Roon moves on: the zone the next poll reads has changed
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 3,
      now_playing: Object.assign({}, window.__zones.z1.now_playing, { line1: "Enjoy the Silence", length: 372 }) });
    return window.__json({ ok: true });
  }
  if (u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});
`;

const DRIVE = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(900);
  var screen = document.getElementById("screen");
  function rect(el) { if (typeof el === "string") el = document.querySelector(el); var b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; }
  function noTransitions() { var st = document.createElement("style"); st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"; document.head.appendChild(st); }
  function queueReads() { return window.__callsMatching("/api/queue?"); }
  function qRows() { return Array.prototype.map.call(document.querySelectorAll("#q-list li"), function (li) {
    return li.classList.contains("q-h") ? "# " + li.textContent : (li.classList.contains("now") ? "▶ " : "") + li.querySelector(".q-t").textContent + (li.classList.contains("armed") ? " [Play from here]" : ""); }); }
  function qRow(title) { return Array.prototype.find.call(document.querySelectorAll("#q-list li.q-row"), function (li) { return li.querySelector(".q-t").textContent === title; }); }
  function hit(el) { var c = rect(el); var top = document.elementFromPoint(c.cx, c.cy); return !!top && (top === el || el.contains(top)); }
  function pageScrolls() { var se = document.scrollingElement; return se.scrollWidth > se.clientWidth + 1 || window.scrollX !== 0; }
  function cssS() { return parseFloat(getComputedStyle(document.getElementById("stage")).getPropertyValue("--S")); }
  function drawn() { return Array.prototype.filter.call(document.querySelectorAll("#rig .it"), function (el) { return el.style.display !== "none" && el.style.visibility !== "hidden"; }).length; }
  function toastText() { return document.getElementById("toast").textContent; }
`;

function render(name, driver, opts) {
  return harness.renderPage({ name, page: "shelf", windowSize: (opts && opts.size) || "1366x1024", budgetMs: 40000,
    stub: stub(opts), driver: DRIVE + driver });
}

test("the Spin button's disc turns on the ring's centre (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-disc", `
    var wrap = rect(".spin-btn .disc-wrap"), ring = rect(".spin-btn .count"), rot = document.querySelector(".spin-btn .disc-rot");
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    T("still", { tag: rot ? rot.tagName : null, svgInside: !!(rot && rot.querySelector("svg.disc")),
                 dx: rect(rot).cx - ring.cx, dy: rect(rot).cy - ring.cy, w: rect(rot).w, h: rect(rot).h, want: wrap.w - 0.36 * rem,
                 svgFills: rect(rot.querySelector("svg")).w === rect(rot).w });
    document.getElementById("spin-btn").click();
    await window.__sleep(200);
    var svg = rot.querySelector("svg");
    T("spinning", { rot: getComputedStyle(rot).animationName, svg: getComputedStyle(svg).animationName, origin: getComputedStyle(rot).transformOrigin,
                    spinning: screen.classList.contains("spinning") });
    // the Random tab's big Spin turns the same way
    document.querySelector('.tab[data-tab="random"]').click();
    await window.__sleep(150);
    var big = document.querySelector("#spin-big .disc-rot");
    T("big", big ? { tag: big.tagName, anim: getComputedStyle(big).animationName, svg: getComputedStyle(big.querySelector("svg")).animationName } : null);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("what turns is a plain HTML box holding the disc, not the <svg> itself", () => {
    assert.equal(r.still.tag, "SPAN");
    assert.equal(r.still.svgInside, true);
    assert.equal(r.still.svgFills, true);
  });
  await t.test("THE one: its box is given in full — the ring less its margin, square, and centred on the ring", () => {
    assert.ok(Math.abs(r.still.w - r.still.want) < 0.5, JSON.stringify(r.still));
    assert.ok(Math.abs(r.still.h - r.still.want) < 0.5, JSON.stringify(r.still));
    assert.ok(Math.abs(r.still.dx) < 0.5 && Math.abs(r.still.dy) < 0.5, JSON.stringify(r.still));
  });
  await t.test("spinning: the box turns, about its middle, and the svg inside does not turn as well", () => {
    assert.equal(r.spinning.spinning, true);
    assert.equal(r.spinning.rot, "rot");
    assert.equal(r.spinning.svg, "none");
    const [ox, oy] = r.spinning.origin.split(" ").map(parseFloat);
    assert.ok(Math.abs(ox - r.still.w / 2) < 0.5 && Math.abs(oy - r.still.h / 2) < 0.5, r.spinning.origin);
  });
  await t.test("the Random tab's big Spin is built the same way", () => {
    assert.deepEqual(r.big, { tag: "SPAN", anim: "rot", svg: "none" });
  });
});

test("the × on the chosen-tracks popup is in the middle of its circle (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-x", `
    document.getElementById("tsel").classList.remove("hidden");
    document.getElementById("info").classList.add("choosing");
    var b = document.getElementById("tsel-clear"), mark = b.querySelector("svg");
    T("x", { drawn: !!mark, text: b.textContent.trim(), dx: rect(mark).cx - rect(b).cx, dy: rect(mark).cy - rect(b).cy, label: b.getAttribute("aria-label") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: drawn, not typed, and centred both ways", () => {
    assert.equal(r.x.drawn, true);
    assert.equal(r.x.text, "");
    assert.ok(Math.abs(r.x.dx) < 0.5 && Math.abs(r.x.dy) < 0.5, JSON.stringify(r.x));
  });
  await t.test("still says what it does", () => assert.equal(r.x.label, "Clear the chosen tracks"));
});

test("the choices fold away to the left and come back from a small tab (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-pick", `
    var tab = document.getElementById("pick-tab"), pick = document.getElementById("pick");
    T("open", { pickL: rect(pick).l, pickR: rect(pick).r, tabL: rect(tab).l, tabW: rect(tab).w, tabH: rect(tab).h, hit: hit(tab), S: cssS(), drawn: drawn(), stageW: rect("#stage").w,
                expanded: tab.getAttribute("aria-expanded"), label: tab.getAttribute("aria-label"), pickW: pick.offsetWidth });
    // It SLIDES: the screen moves its columns over time, and the lane keeps
    // its width while its column closes, so it goes off the edge whole rather
    // than squeezing its tiles. (This harness never advances a CSS transition,
    // so the slide is checked by what makes it one, and the end states with
    // transitions off.)
    // At rest nothing on the screen transitions — or a window resize (its
    // widths follow the window) would animate the columns too.
    T("rest", { sliding: screen.classList.contains("sliding"), dur: parseFloat(getComputedStyle(screen).transitionDuration) });
    tab.click();
    var cs = getComputedStyle(screen);
    T("slide", { prop: cs.transitionProperty, dur: parseFloat(cs.transitionDuration), sliding: screen.classList.contains("sliding"),
                 tab: getComputedStyle(tab).transitionProperty });
    noTransitions();
    await window.__sleep(500);
    T("mid", { pickW: pick.offsetWidth, pickR: rect(pick).r });
    T("after", screen.classList.contains("sliding"));
    var remote = rect("#to-remote"), head = document.querySelector(".shelf-head"), first = rect(head.querySelector(".shelf-order"));
    T("shut", { off: screen.classList.contains("pick-off"), pickR: rect(pick).r, tabL: rect(tab).l, hit: hit(tab), S: cssS(), drawn: drawn(), stageW: rect("#stage").w,
                expanded: tab.getAttribute("aria-expanded"), label: tab.getAttribute("aria-label"), stored: localStorage.getItem("rra-shelf-pick"),
                hidden: getComputedStyle(pick).visibility, tabShown: getComputedStyle(tab).visibility, clearOfRemote: first.l >= remote.r + 4,
                scrolls: pageScrolls(), state: S().pick });
    tab.click();
    await window.__sleep(300);
    T("back", { off: screen.classList.contains("pick-off"), pickR: rect(pick).r, tabL: rect(tab).l, stored: localStorage.getItem("rra-shelf-pick"),
                hidden: getComputedStyle(pick).visibility, S: cssS(), state: S().pick });
  `, { noResizeObserver: true });
  harness.assertNoPageError(assert, r);
  await t.test("open: the lane fills its column exactly — nothing of it off the left edge", () => {
    assert.ok(Math.abs(r.open.pickL) < 0.5, JSON.stringify(r.open));
  });
  await t.test("open: the tab hangs off the lane's edge, small, and is what a tap there reaches", () => {
    assert.ok(Math.abs(r.open.tabL - r.open.pickR) < 1.5, JSON.stringify(r.open));
    assert.ok(r.open.tabW < 40 && r.open.tabH < 90, JSON.stringify(r.open));
    assert.equal(r.open.hit, true);
    assert.equal(r.open.expanded, "true");
    assert.equal(r.open.label, "Hide the choices");
  });
  await t.test("THE one: a tap folds the lane off the left edge, the tab stays at the screen's edge, and it says how to bring it back", () => {
    assert.equal(r.shut.off, true);
    assert.ok(r.shut.pickR <= 1, JSON.stringify(r.shut));
    assert.ok(Math.abs(r.shut.tabL) < 1.5, JSON.stringify(r.shut));
    assert.equal(r.shut.hit, true);
    assert.equal(r.shut.expanded, "false");
    assert.equal(r.shut.label, "Show the choices");
    assert.equal(r.shut.state, false);
  });
  // Run with no ResizeObserver: where one is delivered it follows the slide
  // frame by frame, but whether it is delivered in this harness varies run to
  // run, and the shelf must be laid out again for its new room either way.
  await t.test("the shelf takes the room: its stage widens, and it is laid out again for it", () => {
    assert.ok(r.shut.stageW > r.open.stageW + 300, JSON.stringify([r.open.stageW, r.shut.stageW]));
    assert.ok(r.shut.drawn > r.open.drawn, JSON.stringify([r.open.drawn, r.shut.drawn]));
    assert.ok(r.shut.S >= r.open.S, JSON.stringify([r.open.S, r.shut.S]));
  });
  await t.test("it slides — the columns move over time, and the lane keeps its width, so its tiles are never squeezed", () => {
    assert.equal(r.slide.sliding, true);
    assert.match(r.slide.prop, /grid-template-columns/);
    // the tab is the screen's child (v1.9.6): it slides with the column too
    assert.match(r.slide.tab, /\bleft\b/);
    assert.ok(r.slide.dur > 0.1, JSON.stringify(r.slide));
    assert.equal(r.mid.pickW, r.open.pickW);
  });
  await t.test("only while a tab has just been tapped: at rest, and once the slide is over, nothing transitions", () => {
    assert.deepEqual(r.rest, { sliding: false, dur: 0 });
    assert.equal(r.after, false);
  });
  await t.test("gone means gone: the lane cannot be reached by a tab key, but its tab can", () => {
    assert.equal(r.shut.hidden, "hidden");
    assert.equal(r.shut.tabShown, "visible");
  });
  await t.test("the shelf's head clears the Remote pill once the lane is not there to hold it", () => {
    assert.equal(r.shut.clearOfRemote, true);
  });
  await t.test("the page itself never scrolls sideways", () => assert.equal(r.shut.scrolls, false));
  await t.test("a second tap brings it all back, and the choice is kept per device", () => {
    assert.equal(r.shut.stored, "off");
    assert.equal(r.back.off, false);
    assert.equal(r.back.stored, "on");
    assert.equal(r.back.hidden, "visible");
    assert.ok(Math.abs(r.back.pickR - r.open.pickR) < 1, JSON.stringify(r.back));
    assert.equal(r.back.S, r.open.S);
    assert.equal(r.back.state, true);
  });
});

test("a lane left folded is folded when Shelf opens again, without sliding (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-pickstored", `
    T("state", { off: screen.classList.contains("pick-off"), pickR: rect("#pick").r, anim: screen.classList.contains("sliding"),
                 label: document.getElementById("pick-tab").getAttribute("aria-label") });
  `, { store: 'localStorage.setItem("rra-shelf-pick", "off");' });
  harness.assertNoPageError(assert, r);
  await t.test("folded, and put there without a slide", () => {
    assert.deepEqual(r.state, { off: true, pickR: r.state.pickR, anim: false, label: "Show the choices" });
    assert.ok(r.state.pickR <= 1);
  });
});

test("the queue opens from the right and lists what the zone will play (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-queue", `
    noTransitions();
    var tab = document.getElementById("queue-tab"), q = document.getElementById("queue");
    var vw = document.documentElement.clientWidth;
    T("closed", { on: screen.classList.contains("queue-on"), qL: rect(q).l, vw: vw, tabR: rect(tab).r, hit: hit(tab), reads: queueReads(),
                  label: tab.getAttribute("aria-label"), hidden: getComputedStyle(q).visibility, stageW: rect("#stage").w });
    // the zone moves while the pane is shut: still nothing read
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 4 });
    await window.__sleep(4500);
    T("shutReads", queueReads());
    tab.click();
    await window.__sleep(400);
    T("open", { on: screen.classList.contains("queue-on"), qL: rect(q).l, qR: rect(q).r, tabR: rect(tab).r, hit: hit(tab), reads: queueReads(),
                rows: qRows(), sum: document.getElementById("q-sum").textContent, zone: document.getElementById("q-zone").textContent,
                label: tab.getAttribute("aria-label"), stored: localStorage.getItem("rra-shelf-queue"), stageW: rect("#stage").w,
                lens: Array.prototype.map.call(document.querySelectorAll("#q-list .q-len"), function (x) { return x.textContent; }).slice(0, 3),
                pill: (function () { var p = rect("#to-wall"), tt = rect(".q-title"); return tt.r <= p.l; })(), scrolls: pageScrolls(), state: S().queue });
    tab.click();
    await window.__sleep(300);
    T("closedAgain", { on: screen.classList.contains("queue-on"), qL: rect(q).l, stored: localStorage.getItem("rra-shelf-queue") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("shut by default: off the right edge, its tab at the edge, and nothing read from the Core", () => {
    assert.equal(r.closed.on, false);
    assert.ok(r.closed.qL >= r.closed.vw - 1, JSON.stringify(r.closed));
    assert.ok(Math.abs(r.closed.tabR - r.closed.vw) < 1.5, JSON.stringify(r.closed));
    assert.equal(r.closed.hit, true);
    assert.equal(r.closed.label, "Show the queue");
    assert.equal(r.closed.hidden, "hidden");
    assert.equal(r.closed.reads, 0);
    assert.equal(r.shutReads, 0, "the poll saw the queue move, and read it with the pane shut");
  });
  await t.test("THE one: a tap opens it beside the shelf, with the track playing and what comes next", () => {
    assert.equal(r.open.on, true);
    assert.ok(Math.abs(r.open.qR - r.closed.vw) < 0.5 && r.open.qL < r.closed.vw - 200, JSON.stringify(r.open));
    assert.ok(Math.abs(r.open.tabR - r.open.qL) < 1.5, JSON.stringify(r.open));
    assert.equal(r.open.hit, true);
    assert.deepEqual(r.open.rows, ["# Now playing", "▶ Halo", "# Up next", "Waiting for the Night", "Enjoy the Silence", "Policy of Truth", "Blue Dress", "Clean"]);
    assert.equal(r.open.reads, 1);
  });
  await t.test("it says which zone, how many tracks and how long", () => {
    assert.equal(r.open.zone, "Lounge");
    assert.equal(r.open.sum, "6 tracks · 32:57");
    assert.deepEqual(r.open.lens, ["4:30", "6:07", "6:12"]);
  });
  await t.test("the shelf gives it the room (a column, not a sheet over the covers)", () => {
    assert.ok(r.open.stageW < r.closed.stageW - 200, JSON.stringify([r.closed.stageW, r.open.stageW]));
  });
  await t.test("its title sits beside the Wall Display pill, not under it", () => assert.equal(r.open.pill, true));
  await t.test("kept per device, and the page never scrolls sideways", () => {
    assert.equal(r.open.stored, "on");
    assert.equal(r.open.label, "Hide the queue");
    assert.equal(r.open.scrolls, false);
    assert.equal(r.open.state, true);
    assert.equal(r.closedAgain.on, false);
    assert.equal(r.closedAgain.stored, "off");
    assert.ok(r.closedAgain.qL >= r.closed.vw - 1);
  });
});

test("a track to come plays from there — after a second, deliberate tap (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-playfrom", `
    noTransitions();
    qRow("Enjoy the Silence").querySelector(".q-item").click();
    await window.__sleep(80);
    T("armed", { rows: qRows(), posts: window.__posts.length, go: getComputedStyle(qRow("Enjoy the Silence").querySelector(".q-go")).display });
    // another track moves the offer to it
    qRow("Blue Dress").querySelector(".q-item").click();
    await window.__sleep(80);
    T("moved", qRows().filter(function (x) { return x.indexOf("[") > -1; }));
    // the same track again takes the offer away
    qRow("Blue Dress").querySelector(".q-item").click();
    await window.__sleep(80);
    T("taken", qRows().filter(function (x) { return x.indexOf("[") > -1; }));
    qRow("Policy of Truth").querySelector(".q-item").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await window.__sleep(80);
    T("escaped", qRows().filter(function (x) { return x.indexOf("[") > -1; }));
    // and played
    qRow("Enjoy the Silence").querySelector(".q-item").click();
    await window.__sleep(80);
    qRow("Enjoy the Silence").querySelector(".q-go").click();
    await window.__sleep(150);
    T("played", { posts: window.__posts.map(function (p) { return { url: p.url, body: p.body }; }), toast: toastText(), armed: qRows().filter(function (x) { return x.indexOf("[") > -1; }) });
    var reads = queueReads();
    await window.__sleep(1200);
    T("reread", queueReads() - reads);
    // the track playing: its record is brought to the front of the shelf
    var stage = document.getElementById("stage");
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await window.__sleep(2000);
    T("before", S().title);
    qRow("Halo").querySelector(".q-item").click();
    await window.__sleep(2500);
    T("front", { title: S().title, posts: window.__posts.length });
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on");' });
  harness.assertNoPageError(assert, r);
  await t.test("a first tap only offers: nothing is sent, and the offer is a button under the track", () => {
    assert.equal(r.armed.posts, 0);
    assert.ok(r.armed.rows.includes("Enjoy the Silence [Play from here]"), JSON.stringify(r.armed.rows));
    assert.notEqual(r.armed.go, "none");
  });
  await t.test("one offer at a time; the same track again, or Escape, takes it away", () => {
    assert.deepEqual(r.moved, ["Blue Dress [Play from here]"]);
    assert.deepEqual(r.taken, []);
    assert.deepEqual(r.escaped, []);
  });
  await t.test("THE one: Play from here sends that track's queue id for the zone shown, once", () => {
    assert.deepEqual(r.played.posts, [{ url: "/api/play-from-here", body: { zone_or_output_id: "z1", queue_item_id: 13 } }]);
    assert.equal(r.played.toast, "Playing from Enjoy the Silence");
    assert.deepEqual(r.played.armed, []);
  });
  // once, not twice: the player's poll sees the zone move and reads it, and
  // the read after the play is then not repeated (each is a Core subscribe)
  await t.test("then the queue is read again — once — so the list follows the music", () => assert.equal(r.reread, 1));
  await t.test("the track playing is not offered — a tap on it brings its record to the front", () => {
    assert.notEqual(r.before, "Violator");
    assert.equal(r.front.title, "Violator");
    assert.equal(r.front.posts, 1);
  });
});

test("the queue keeps up with the zone, and never shows another zone's (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-follow", `
    noTransitions();
    T("first", { rows: qRows().length, reads: queueReads() });
    // the track ends: the poll sees the queue move, and it is read again
    window.__queues.z1 = window.__queues.z1.slice(1);
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 4,
      now_playing: Object.assign({}, window.__zones.z1.now_playing, { line1: "Waiting for the Night", length: 367 }) });
    await window.__sleep(4600);
    T("moved", { rows: qRows(), reads: queueReads() });
    // nothing moved: no read
    var still = queueReads();
    await window.__sleep(4600);
    T("still", queueReads() - still);
    // a blip while the list is up: the list stays
    window.__queueStatus = 500;
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 3 });
    await window.__sleep(4600);
    T("blip", { rows: qRows().length, msg: document.getElementById("q-msg").classList.contains("hidden") });
    window.__queueStatus = 0;
    // the keyboard on a row: a redraw keeps it there
    qRow("Policy of Truth").querySelector(".q-item").focus();
    var before = queueReads();
    // a different list, so the rows really are built again
    window.__queues.z1 = window.__queues.z1.slice(0, 4);
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 2 });
    await window.__sleep(4600);
    var ae = document.activeElement;
    T("focus", { onRow: !!(ae && ae.classList.contains("q-item")), title: ae && ae.closest("li.q-row") ? ae.closest("li.q-row").querySelector(".q-t").textContent : null,
                 redrawn: queueReads() > before, rows: qRows().length });
    // Roon gone: the list is not kept up as though it could still be played from
    window.__queueStatus = 503;
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 1 });
    await window.__sleep(4600);
    T("gone", { rows: qRows().length, msg: document.getElementById("q-msg").textContent });
    window.__queueStatus = 0;
    // another zone, chosen in the player: the Lounge's list must not stand in
    // for the Kitchen's while the Kitchen's is read (held for a second here)
    window.__queueDelay.z2 = 1500;
    document.getElementById("mt-zone-btn").click();
    await window.__sleep(300);
    document.querySelector('#zones button[data-zone="z2"]').click();
    await window.__sleep(300);
    T("switching", { rows: qRows(), msg: document.getElementById("q-msg").textContent, zone: document.getElementById("q-zone").textContent });
    await window.__sleep(1600);
    T("switched", { rows: qRows(), zone: document.getElementById("q-zone").textContent });
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on");' });
  harness.assertNoPageError(assert, r);
  await t.test("read once on opening", () => assert.deepEqual(r.first, { rows: 8, reads: 1 }));
  await t.test("THE one: a track ending is seen by the poll, and the list moves with it", () => {
    assert.deepEqual(r.moved.rows, ["# Now playing", "▶ Waiting for the Night", "# Up next", "Enjoy the Silence", "Policy of Truth", "Blue Dress", "Clean"]);
    assert.equal(r.moved.reads, 2);
  });
  await t.test("no change, no read — the Core is not asked every poll", () => assert.equal(r.still, 0));
  await t.test("a failed read under a list already shown keeps the list", () => assert.deepEqual(r.blip, { rows: 7, msg: true }));
  await t.test("a redraw keeps the keyboard's place", () => {
    assert.deepEqual(r.focus, { onRow: true, title: "Policy of Truth", redrawn: true, rows: 6 });
  });
  await t.test("Roon gone: the list goes, and it says why", () => assert.deepEqual(r.gone, { rows: 0, msg: "Roon isn’t connected right now." }));
  await t.test("another zone: its name at once, and no list but its own", () => {
    assert.deepEqual(r.switching.rows, []);
    assert.equal(r.switching.msg, "Reading the queue…");
    assert.equal(r.switching.zone, "Kitchen");
    assert.deepEqual(r.switched.rows, ["# Now playing", "▶ Teardrop", "# Up next", "Inertia Creeps"]);
  });
});

test("an answer for a zone already left behind is dropped (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-late", `
    noTransitions();
    // the Lounge's queue moves and its read is slow; the Kitchen is chosen
    // while it is on its way, and answers first
    window.__queueDelay.z1 = 1500;
    window.__queues.z1 = window.__queues.z1.slice(2);
    window.__zones.z1 = Object.assign({}, window.__zones.z1, { queue_items_remaining: 3 });
    await window.__sleep(4300);
    document.getElementById("mt-zone-btn").click();
    await window.__sleep(150);
    document.querySelector('#zones button[data-zone="z2"]').click();
    await window.__sleep(2600);
    T("rows", qRows());
    T("zone", document.getElementById("q-zone").textContent);
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on");' });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the Kitchen's list stays, not the Lounge's that came after it", () => {
    assert.deepEqual(r.rows, ["# Now playing", "▶ Teardrop", "# Up next", "Inertia Creeps"]);
    assert.equal(r.zone, "Kitchen");
  });
});

test("a long queue: the offer scrolls into view by just enough, and a cut-off list says so (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-long", `
    noTransitions();
    var ol = document.getElementById("q-list"), box = ol.getBoundingClientRect();
    var bottom = box.top + ol.clientTop + ol.clientHeight;
    // the first row the list's bottom edge cuts through
    var row = Array.prototype.find.call(ol.querySelectorAll("li.q-row"), function (li) { var b = li.getBoundingClientRect(); return b.bottom > bottom && b.top < bottom; });
    var title = row.querySelector(".q-t").textContent;
    row.querySelector(".q-item").click();
    await window.__sleep(100);
    var go = row.querySelector(".q-go").getBoundingClientRect(), rb = row.getBoundingClientRect();
    T("reveal", { title: title, goShown: go.bottom <= bottom + 0.5 && go.top >= box.top, gap: bottom - rb.bottom, scrolled: ol.scrollTop });
    T("sum", document.getElementById("q-sum").textContent);
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on"); window.__queues.z1 = Array.from({ length: 100 }, function (_, i) { return { queue_item_id: 100 + i, title: "Long track " + (i + 1), subtitle: "Depeche Mode", image_key: "k3", length: 300 }; });' });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the offered row is brought into view, its button whole, without throwing the list past it", () => {
    assert.equal(r.reveal.goShown, true, JSON.stringify(r.reveal));
    assert.ok(r.reveal.gap >= 0 && r.reveal.gap < 20, JSON.stringify(r.reveal));
  });
  await t.test("a list of 100 — all Rouen reads — may be longer, so it does not claim a count or a length", () => {
    assert.equal(r.sum, "100+ tracks");
  });
});

test("no zones, and Rouen not answering, are told apart — and at once (v1.9.5)", { skip: !harness.available }, async (t) => {
  const none = render("shelf195-nozones", `
    T("msg", document.getElementById("q-msg").textContent);
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on");', noZones: true });
  harness.assertNoPageError(assert, none);
  const down = render("shelf195-zonesdown", `
    await window.__sleep(5000);
    T("msg", document.getElementById("q-msg").textContent);
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on");', zonesDown: true });
  harness.assertNoPageError(assert, down);
  await t.test("THE one: no zones is said as soon as Rouen says so, not half a minute later", () => assert.equal(none.msg, "No zones found."));
  await t.test("no answer is not \"no zones\" — nothing is claimed", () => assert.equal(down.msg, "Reading the queue…"));
});

test("the tabs stay off the shelf's buttons, at every portrait size (v1.9.5)", { skip: !harness.available }, async (t) => {
  const drive = `
    noTransitions();
    function grown(el, by) { var b = el.getBoundingClientRect(); return { l: b.left - by, t: b.top - by, r: b.right + by, b: b.bottom + by }; }
    function meets(a, b) { return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b; }
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    var tabs = [document.getElementById("pick-tab"), document.getElementById("queue-tab")];
    var buttons = Array.prototype.slice.call(document.querySelectorAll("#looks button, #spin-btn, .tab, #mt-zone-btn, #mt-vol-btn"));
    var clashes = [];
    tabs.forEach(function (tb) { buttons.forEach(function (b) {
      var r = b.getBoundingClientRect(); if (!r.width) return;
      if (meets(grown(tb, 0.5 * rem), grown(b, 0))) clashes.push(tb.id + " / " + (b.id || b.dataset.look || b.dataset.tab));
    }); });
    T("clashes", clashes);
  `;
  for (const size of ["768x1024", "820x1180", "1024x1366", "390x844", "430x932"]) {
    const r = render("shelf195-clash-" + size, drive, { size });
    harness.assertNoPageError(assert, r);
    await t.test(size + ": neither tab's touch area reaches a button", () => assert.deepEqual(r.clashes, []));
  }
});

test("a narrow shelf column truncates its head rather than running under the buttons (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-narrowhead", `
    noTransitions();
    var order = document.querySelector(".shelf-order"), pos = document.getElementById("shelf-pos"), looks = document.getElementById("looks");
    T("head", { orderR: order.getBoundingClientRect().right, posR: pos.getBoundingClientRect().right, looksL: looks.getBoundingClientRect().left,
                clipped: [order, pos].every(function (el) { return getComputedStyle(el).overflowX === "hidden" && getComputedStyle(el).textOverflow === "ellipsis"; }) });
  `, { size: "1024x768", store: 'localStorage.setItem("rra-shelf-queue", "on");' });
  harness.assertNoPageError(assert, r);
  await t.test("both texts end before the buttons, and are cut with an ellipsis", () => {
    assert.ok(r.head.orderR <= r.head.looksL && r.head.posR <= r.head.looksL, JSON.stringify(r.head));
    assert.equal(r.head.clipped, true);
  });
});

test("a phone on its side: the lane's spill stays under the shelf's buttons (v1.9.5)", { skip: !harness.available }, async (t) => {
  // Its top edge as well as its middle: the spill comes down from above.
  const drive = `
    noTransitions();
    var hits = [];
    Array.prototype.forEach.call(document.querySelectorAll("#looks button, #spin-btn"), function (b) {
      var c = b.getBoundingClientRect(), name = b.id || b.dataset.look;
      [c.top + 2, c.top + c.height / 2].forEach(function (y) {
        var top = document.elementFromPoint(c.left + c.width / 2, y);
        if (!(top && (top === b || b.contains(top)))) hits.push(name + "@" + Math.round(y - c.top) + " → " + (top ? (top.id || top.className || top.tagName) : "none"));
      });
    });
    T("missed", hits);
  `;
  for (const size of ["844x390", "667x375"]) {
    const r = render("shelf195-phoneland-" + size, drive, { size });
    harness.assertNoPageError(assert, r);
    await t.test(size + ": THE one: every look button and Spin is what a tap on it reaches, top edge included", () => assert.deepEqual(r.missed, []));
  }
});

test("a play the player's poll cannot see still brings the queue up to date (v1.9.5)", { skip: !harness.available }, async (t) => {
  // A Core that does not say how many are queued: adding an album to the end
  // moves nothing the poll compares, so the read after the play is the only
  // one there is.
  const r = render("shelf195-unseen", `
    noTransitions();
    var before = queueReads();
    document.querySelector('#actions [data-act="queue"]').click();
    await window.__sleep(2600);
    T("reads", queueReads() - before);
    T("posted", window.__posts.map(function (p) { return p.url; }));
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on"); window.__zones.z1.queue_items_remaining = null;' });
  harness.assertNoPageError(assert, r);
  await t.test("the album went to the queue", () => assert.deepEqual(r.posted, ["/api/play"]));
  await t.test("THE one: the queue was read again, once", () => assert.equal(r.reads, 1));
});

test("portrait, the choices folded: a toast is below the shelf's head, not over the pills (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-toast", `
    noTransitions();
    var tst = document.getElementById("toast"); tst.textContent = "Playing something"; tst.classList.add("on");
    var tb = rect(tst), pills = [rect("#to-remote"), rect("#to-wall")], head = rect(".shelf-head");
    T("toast", { clear: pills.every(function (p) { return tb.t >= p.b; }), belowHead: tb.t >= head.b - 1 });
  `, { size: "390x844", store: 'localStorage.setItem("rra-shelf-pick", "off");' });
  harness.assertNoPageError(assert, r);
  await t.test("clear of both pills and of the head", () => assert.deepEqual(r.toast, { clear: true, belowHead: true }));
});

test("a folded tab clears the safe area at the screen's edge (v1.9.5, device-only, pinned)", () => {
  // No inset exists in the test browser, so this can only be pinned: the
  // rules that move a folded tab clear of the notch / Dynamic Island.
  const css = require("node:fs").readFileSync(require("node:path").join(harness.PUBLIC_DIR, "shelf.css"), "utf8");
  assert.match(css, /\.screen\.pick-off \.edge-tab-l \{ left: calc\(var\(--pick-w\) \+ env\(safe-area-inset-left, 0px\)\); \}/);
  assert.match(css, /\.screen:not\(\.queue-on\) \.edge-tab-r \{ right: calc\(100% \+ env\(safe-area-inset-right, 0px\)\); \}/);
  assert.match(css, /\.screen\.pick-off \.edge-tab-l \{ left: 50%; top: calc\(var\(--pick-h\) \+ env\(safe-area-inset-top, 0px\)\); \}/);
});

test("the portrait lane has a height an older iPad understands (v1.9.5)", () => {
  // iOS 15 and older have no container units: the cqh height is dropped there,
  // and without a height before it the lane grows to all its tiles. Read from
  // the stylesheet the harness serves, so a mutant copy is what is checked.
  const css = require("node:fs").readFileSync(require("node:path").join(harness.PUBLIC_DIR, "shelf.css"), "utf8");
  const rule = /\.pick \{ width: auto; justify-self: stretch;([^}]*)\}/.exec(css);
  assert.ok(rule, "the portrait .pick rule");
  assert.match(rule[1], /height: 46vh;\s*height: 46cqh;/);
});

// v1.9.6, reported from an iPad and a TV: "I cannot see how to close" the
// lane. Its tab lived INSIDE the lane, which is a size container — and an
// engine that gives a container layout or paint containment (as the spec once
// had it, and as browsers have shipped) paints the shelf over a tab hanging
// out of it, or cuts it off. The suite's Chromium does neither, which is why
// v1.9.5 passed here. So the containment is FORCED onto the lane, and the tab
// must still be on top and still work, open and folded, in both layouts.
test("the lane's tab works whatever the browser does to the lane (v1.9.6)", { skip: !harness.available }, async (t) => {
  const drive = `
    var force = document.createElement("style");
    force.textContent = ".pick { contain: layout paint style inline-size !important; }";
    document.head.appendChild(force);
    noTransitions();
    var tab = document.getElementById("pick-tab");
    function reach() {
      var b = tab.getBoundingClientRect(), out = [];
      [[0.5, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8]].forEach(function (f) {
        var top = document.elementFromPoint(b.left + b.width * f[0], b.top + b.height * f[1]);
        out.push(!!top && (top === tab || tab.contains(top)));
      });
      return out.every(Boolean);
    }
    T("inLane", !!tab.closest(".pick"));
    T("open", { reach: reach(), shown: getComputedStyle(tab).visibility, w: tab.getBoundingClientRect().width });
    tab.click();
    await window.__sleep(300);
    T("folded", { off: screen.classList.contains("pick-off"), reach: reach() });
    tab.click();
    await window.__sleep(300);
    T("back", { off: screen.classList.contains("pick-off"), reach: reach() });
  `;
  for (const size of ["1366x1024", "1180x820", "1920x1080", "820x1180"]) {
    const r = render("shelf196-contain-" + size, drive, { size });
    harness.assertNoPageError(assert, r);
    await t.test(size + ": the tab is not inside the lane", () => assert.equal(r.inLane, false));
    await t.test(size + ": THE one: open, it is on top of the shelf and a tap reaches it", () => {
      assert.equal(r.open.reach, true, JSON.stringify(r.open));
      assert.equal(r.open.shown, "visible");
      assert.ok(r.open.w > 10);
    });
    await t.test(size + ": a tap folds the lane, and the tab is still reachable to bring it back", () => {
      assert.deepEqual(r.folded, { off: true, reach: true });
      assert.deepEqual(r.back, { off: false, reach: true });
    });
  }
});

// v1.9.7: "with both lanes closed the albums should increase in size". On a
// landscape iPad the covers were as tall as the stage allowed while one pane
// was still open, so folding the second added only width, and nothing grew.
// Each look now takes more of the stage's height the wider the stage is.
test("every pane folded away makes the covers bigger, and they still fit (v1.9.7)", { skip: !harness.available }, async (t) => {
  const drive = `
    noTransitions();
    var res = {};
    var states = [["both open", false, true], ["lane open", false, false], ["queue open", true, true], ["both folded", true, false]];
    for (var k = 0; k < states.length; k++) {
      if (screen.classList.contains("pick-off") !== states[k][1]) document.getElementById("pick-tab").click();
      if (screen.classList.contains("queue-on") !== states[k][2]) document.getElementById("queue-tab").click();
      await window.__sleep(700);
      var stg = document.getElementById("stage").getBoundingClientRect();
      var Sv = cssS(), out = [];
      document.querySelectorAll("#rig .it").forEach(function (el) {
        if (el.style.display === "none" || el.style.visibility === "hidden") return;
        el.querySelectorAll(".face, .sp-tab").forEach(function (f) {
          if (getComputedStyle(f).display === "none" || getComputedStyle(f).visibility === "hidden") return;
          var b = f.getBoundingClientRect(); if (!b.width) return;
          if (b.top < stg.top - 0.5 || b.bottom > stg.bottom + 0.5) out.push(f.className);
        });
      });
      // the front cover's reflection, in Covers: room below it for the part that shows
      var front = document.querySelector('.it[data-v="' + Math.round(S().p) + '"]');
      var fb = front ? front.querySelector(".front").getBoundingClientRect() : null;
      res[states[k][0]] = { S: Sv, out: out.length, reflection: S().look !== "covers" || (fb && fb.bottom + 0.22 * Sv <= stg.bottom + 0.5) };
    }
    T("res", res);
  `;
  for (const size of ["1180x710", "1920x1080"]) {
    for (const look of ["covers", "spines", "ring"]) {
      const r = render("shelf197-" + size + "-" + look, drive, { size, store: 'localStorage.setItem("rra-shelf-look", "' + look + '");' });
      harness.assertNoPageError(assert, r);
      const s = r.res;
      await t.test(`${size} ${look}: THE one — both folded is bigger than either pane alone, which is bigger than both open`, () => {
        assert.ok(s["both folded"].S > s["lane open"].S && s["both folded"].S > s["queue open"].S, JSON.stringify(s));
        assert.ok(s["lane open"].S > s["both open"].S && s["queue open"].S > s["both open"].S, JSON.stringify(s));
      });
      await t.test(`${size} ${look}: nothing is cut off by the stage, in any of the four`, () => {
        for (const k of Object.keys(s)) {
          assert.equal(s[k].out, 0, k + " " + JSON.stringify(s[k]));
          assert.equal(s[k].reflection, true, k + " " + JSON.stringify(s[k]));
        }
      });
    }
  }
});

test("a stage no wider than it is tall keeps the sizes it always had (v1.9.7)", { skip: !harness.available }, async (t) => {
  // Portrait with the choices folded: the stage is about as tall as it is
  // wide, so there is no room either side to grow into.
  const r = render("shelf197-square", `
    noTransitions();
    var stg = document.getElementById("stage").getBoundingClientRect();
    T("s", { S: cssS(), W: stg.width, H: stg.height });
  `, { size: "820x1180", store: 'localStorage.setItem("rra-shelf-pick", "off"); localStorage.setItem("rra-shelf-look", "covers");' });
  harness.assertNoPageError(assert, r);
  await t.test("Covers: the v1.9.6 formula, exactly", () => {
    assert.ok(r.s.W / r.s.H <= 1.2, JSON.stringify(r.s));
    assert.equal(r.s.S, Math.round(Math.max(110, Math.min(r.s.H * 0.64, r.s.W * 0.44, 600))));
  });
});

test("the queue says so when there is nothing, or no Roon (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-qempty", `
    noTransitions();
    T("empty", { msg: document.getElementById("q-msg").textContent, rows: qRows().length, sum: document.getElementById("q-sum").textContent });
    window.__queueStatus = 503;
    document.getElementById("queue-tab").click();
    await window.__sleep(200);
    document.getElementById("queue-tab").click();
    await window.__sleep(400);
    T("down", document.getElementById("q-msg").textContent);
  `, { store: 'localStorage.setItem("rra-shelf-queue", "on"); window.__queues.z1 = [];' });
  harness.assertNoPageError(assert, r);
  await t.test("an empty queue", () => assert.deepEqual(r.empty, { msg: "Nothing is queued.", rows: 0, sum: "" }));
  await t.test("Roon not connected", () => assert.equal(r.down, "Roon isn’t connected right now."));
});

test("portrait: the choices fold UP, and the queue is a drawer over the shelf (v1.9.5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf195-portrait", `
    noTransitions();
    var tab = document.getElementById("pick-tab"), qtab = document.getElementById("queue-tab"), q = document.getElementById("queue"), pick = document.getElementById("pick");
    var vw = document.documentElement.clientWidth;
    T("open", { pickB: rect(pick).b, tabT: rect(tab).t, tabW: rect(tab).w, stageH: rect("#stage").h, hit: hit(tab) });
    tab.click();
    await window.__sleep(400);
    var remote = rect("#to-remote"), head = rect(document.querySelector(".shelf-head .shelf-pos"));
    T("shut", { pickB: rect(pick).b, tabT: rect(tab).t, stageH: rect("#stage").h, hit: hit(tab), belowPills: head.t >= remote.b, scrolls: pageScrolls() });
    var stageW = rect("#stage").w;
    qtab.click();
    await window.__sleep(400);
    T("drawer", { qR: rect(q).r, qL: rect(q).l, qB: rect(q).b, footT: rect("#mt").t, zoneBtn: hit(document.getElementById("mt-zone-btn")), vw: vw, stageW: rect("#stage").w, before: stageW, tabR: rect(qtab).r, hit: hit(qtab), rows: qRows().length, scrolls: pageScrolls() });
    qtab.click();
    await window.__sleep(400);
    T("drawerShut", { qL: rect(q).l, vw: vw });
  `, { size: "820x1180" });
  harness.assertNoPageError(assert, r);
  await t.test("open: the tab hangs below the choices, wide and short", () => {
    assert.ok(Math.abs(r.open.tabT - r.open.pickB) < 1.5, JSON.stringify(r.open));
    assert.ok(r.open.tabW > 50);
    assert.equal(r.open.hit, true);
  });
  await t.test("THE one: folded up, the shelf takes the height, the tab at the top, the head below the pills", () => {
    assert.ok(r.shut.pickB <= 1, JSON.stringify(r.shut));
    assert.ok(Math.abs(r.shut.tabT) < 1.5, JSON.stringify(r.shut));
    assert.ok(r.shut.stageH > r.open.stageH + 300, JSON.stringify([r.open.stageH, r.shut.stageH]));
    assert.equal(r.shut.hit, true);
    assert.equal(r.shut.belowPills, true);
    assert.equal(r.shut.scrolls, false);
  });
  await t.test("the queue slides over the shelf from the right, without narrowing it", () => {
    assert.ok(Math.abs(r.drawer.qR - r.drawer.vw) < 1.5 && r.drawer.qL < r.drawer.vw - 200, JSON.stringify(r.drawer));
    assert.equal(r.drawer.stageW, r.drawer.before);
    assert.ok(Math.abs(r.drawer.tabR - r.drawer.qL) < 1.5);
    assert.equal(r.drawer.hit, true);
    assert.equal(r.drawer.rows, 8);
    assert.equal(r.drawer.scrolls, false);
    assert.ok(r.drawerShut.qL >= r.drawerShut.vw - 1);
  });
  await t.test("it stops at the player, so the zone button stays within reach", () => {
    assert.ok(Math.abs(r.drawer.qB - r.drawer.footT) < 1.5, JSON.stringify(r.drawer));
    assert.equal(r.drawer.zoneBtn, true);
  });
});
