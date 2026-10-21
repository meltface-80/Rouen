"use strict";
// ---------------------------------------------------------------------------
// Settings → Roon (v1.9.18, dev/design/roon-native.md §10.4): Roon direct's
// switch and its status line, in the real page — that the page is in the
// Settings list and opens, says what the server's status says, and turns
// it on and off through the API.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const DAY = Date.UTC(2026, 9, 14, 9, 30);
const ON = { on: true, active: true, reading: false, checking: null, offReason: null, offAt: null,
  lastRead: { at: DAY, ms: 95000, albums: 12968, pages: 130 },
  checked: { after: "Your server updated from 2.0 (1500) to 2.0 (1600)", at: DAY },
  report: { albums: 12968, matched: 12961, bySource: { local: 19, qobuz: 12937, tidal: 5 }, twoSources: 2, noSource: 0, notListed: 5,
    left: 7, coverSame: 0, unmatched: [] } };
const OFF_FAILED = { on: false, active: false, reading: false, checking: null, offReason: "The Core refused page 3: Busy.", offAt: DAY,
  lastRead: null, checked: null, report: null };

function stub(first) {
  return `
window.__posts = [];
window.__state = ${JSON.stringify(first)};
window.__installFetch(function (u, init) {
  if (u.indexOf("/api/roon-direct") > -1) {
    if (init && init.method === "POST") {
      var on = JSON.parse(init.body).on;
      window.__posts.push(on);
      window.__state = on ? ${JSON.stringify(ON)} : { on: false, active: false, reading: false, checking: null, offReason: null, offAt: null, lastRead: null, checked: null, report: null };
    }
    return window.__json(window.__state);
  }
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
}

const DRIVER = `
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  var nav = document.querySelector('.settings-nav-item[data-pane="roon"]');
  T("nav", { there: !!nav, after: nav && nav.previousElementSibling && nav.previousElementSibling.getAttribute("data-pane"),
             title: nav && nav.querySelector(".settings-nav-title").textContent });
  nav.click();
  await window.__sleep(500);
  var pane = document.querySelector('.settings-pane[data-pane="roon"]');
  var box = document.getElementById("roon-direct-enabled");
  var info = pane.querySelector(".settings-info-btn");
  var notice = pane.querySelector(".roon-direct-notice");
  // Everything the page shows but its notice (v1.9.23: Roon is named once, there).
  var rest = pane.cloneNode(true); var rn = rest.querySelector(".roon-direct-notice"); if (rn) rn.remove();
  var infoBtn = rest.querySelector(".settings-info-btn");
  T("names", { rest: rest.textContent + " " + (infoBtn ? infoBtn.getAttribute("data-info") + infoBtn.getAttribute("aria-label") : "") + " " + box.getAttribute("aria-label"),
               notice: notice ? (notice.textContent.match(/Roon/g) || []).length : -1 });
  T("notice", { text: notice ? notice.textContent.replace(/\\s+/g, " ").trim() : "",
                links: notice ? Array.prototype.map.call(notice.querySelectorAll("a"), function (a) { return a.href; }) : [],
                before_switch: !!notice && !!(notice.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) });
  T("opened", { shown: !pane.classList.contains("hidden"), checked: box.checked,
                line: document.getElementById("roon-direct-status").textContent,
                info: info && info.getAttribute("aria-label") });
  box.click();
  await window.__sleep(500);
  T("toggled", { posts: window.__posts, checked: box.checked, line: document.getElementById("roon-direct-status").textContent,
                which: (document.querySelector("#roon-direct-status a") || {}).href || null });
`;

const render = (name, first) => harness.renderPage({ name, windowSize: "390x844", budgetMs: 15000, driver: DRIVER, stub: stub(first) });

test("Settings → Roon: off after a failure, says why; turned on, says what it matched", async (t) => {
  const r = render("roon-settings", OFF_FAILED);
  harness.assertNoPageError(assert, r);

  await t.test("a Native mode page in the Settings list, after Services", () => {
    assert.equal(r.nav.there, true, "THE one: no way to reach the switch");
    assert.equal(r.nav.after, "streaming");
    assert.equal(r.nav.title, "Native mode");
  });

  // The owner, v1.9.23: the page names Roon once — in its notice, to say Rouen is not affiliated.
  await t.test("Roon is named in the notice only, and once", () => {
    assert.doesNotMatch(r.names.rest, /Roon/, "THE one: the page names Roon outside its notice");
    assert.equal(r.names.notice, 1);
  });

  await t.test("Read this first: above the switch, with its links (v1.9.20)", () => {
    assert.match(r.notice.text, /^Read this first\. Native mode is an unofficial development\. Rouen is not affiliated with Roon Labs, and native mode is not made, endorsed or supported by them — this is the only place Rouen names them\./);
    assert.match(r.notice.text, /“not hardened for 3rd party use”/);
    assert.match(r.notice.text, /Keep port 9332 on your own network, never forward it to the internet\./);
    assert.match(r.notice.text, /With native mode switched off \(the switch below\) only the official extension API is used\.$/);
    assert.deepEqual(r.notice.links, [
      "https://github.com/arthursoares/roon-api-reverse-engineering",
      "https://community.roonlabs.com/t/reverse-engineering-the-roon-desktop-clients-local-protocol-typescript-client-docs/321731",
      "https://github.com/meltface-80/Rouen/blob/main/LICENSE",
      "https://github.com/meltface-80/Rouen/issues",
    ]);
    assert.equal(r.notice.before_switch, true, "THE one: the notice is not read before the switch");
  });

  await t.test("off by a failure: the reason, and that it can be turned on again", () => {
    assert.equal(r.opened.shown, true);
    assert.equal(r.opened.checked, false);
    assert.match(r.opened.line, /^Turned itself off .+: The Core refused page 3: Busy\.\nTurn it on again to try once more\.$/);
    assert.equal(r.opened.info, "About native mode");
  });

  await t.test("turned on: posted, and the match shown", () => {
    assert.deepEqual(r.toggled.posts, [true]);
    assert.equal(r.toggled.checked, true);
    assert.match(r.toggled.line, /^Matched 12,961 of 12,968 albums — Local 19 · Qobuz 12,937 · TIDAL 5\./);
    assert.match(r.toggled.line, /TIDAL 5\.\n/);
    assert.match(r.toggled.line, /\n7 not matched, so shown with no source \(2 listed by your server under two sources\)\./);
    assert.match(r.toggled.which || "", /\/api\/roon-direct\/unmatched$/, "no way to see which albums were not matched");
    assert.match(r.toggled.line, /\nLast read .+, in 1 min 35 s\./);
    assert.doesNotMatch(r.toggled.line, /Roon/, "the status names Roon (v1.9.23: only the notice does)");
    assert.match(r.toggled.line, /\nChecked after Your server updated from 2\.0 \(1500\) to 2\.0 \(1600\), .+: passed\.\n/);
  });
});

test("Settings → Roon: on, turned off by hand", async (t) => {
  const r = render("roon-settings-off", ON);
  harness.assertNoPageError(assert, r);
  await t.test("starts on, posts off, says Off", () => {
    assert.equal(r.opened.checked, true);
    assert.deepEqual(r.toggled.posts, [false]);
    assert.equal(r.toggled.checked, false);
    assert.equal(r.toggled.line, "Off.");
  });
});

// v1.9.21 (dev/design/native-remote.md §3.3, §4): Native status — the one
// connection, and the library the screens were given from Roon's own list.
const NATIVE = Object.assign({}, ON, { report: null,
  link: { running: true, up: true, session: 3, since: DAY, objects: 486, reconnects: 2, lastDown: { at: DAY, why: "the nightly reconnect" },
    keepalive: { sent: 6, answered: 5, missed: 1 } },
  library: { albums: 12968, paired: 12965, unpaired: 3, bySource: { local: 19, qobuz: 12944, tidal: 5, none: 0 } } });
const KA_SILENT = Object.assign({}, NATIVE, { link: Object.assign({}, NATIVE.link, { keepalive: { sent: 9, answered: 5, missed: 4 } }) });
// v1.9.27: hearts — album hearts fallen back, tracks working.
const HEARTS = Object.assign({}, NATIVE, { hearts: { album: { on: false, why: "Your server refused an album heart (\"Refused\")." },
  track: { on: true }, albumSet: 2, albumConfirmed: 1, awaiting: 1, trackSet: 3 } });
const FELL_BACK = Object.assign({}, ON, { report: null, library: null,
  link: { running: true, up: false, session: null, since: null, objects: null, reconnects: 0, lastDown: null },
  fellBack: { at: DAY, why: "The Core refused page 3: Busy." } });

test("Settings → Roon: Native status — the connection, Roon's list, and a fallback", async (t) => {
  const r = render("roon-settings-native", NATIVE);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the connection and the library, as the server says", () => {
    assert.match(r.opened.line, /^Connected to your server since .+ · 486 objects held · reconnected 2×\.\n/);
    assert.match(r.opened.line, /\nLast reconnect .+: the nightly reconnect\.\n/);
    assert.match(r.opened.line, /\nYour library is your server's own list: 12,968 albums — Local 19 · Qobuz 12,944 · TIDAL 5\.\n/);
    assert.match(r.opened.line, /\n3 of them the official API lists under another name: those open through your server's search\.\n/);
    assert.doesNotMatch(r.opened.line, /Matched/, "the old match shown beside Roon's own list");
    assert.doesNotMatch(r.opened.line, /Roon/, "the status names Roon (v1.9.23: only the notice does)");
  });
  const k = render("roon-settings-keepalive", KA_SILENT);
  harness.assertNoPageError(assert, k);
  await t.test("v1.9.24: keepalives the server stopped answering (three in a row) are said; one missed is not", () => {
    assert.match(k.opened.line, /\nYour server is not answering Rouen's keepalives\.\n/);
    assert.doesNotMatch(r.opened.line, /keepalives/);
  });
  const h = render("roon-settings-hearts", HEARTS);
  harness.assertNoPageError(assert, h);
  await t.test("v1.9.27: hearts — a kind that fell back says why; what was sent is counted", () => {
    assert.match(h.opened.line, /\nAlbum hearts are off until the next reconnect: Your server refused an album heart \("Refused"\)\./);
    assert.doesNotMatch(h.opened.line, /Track hearts are off/);
    assert.match(h.opened.line, /\nHearts sent to your server: 2 albums \(1 seen in its next read\), 3 tracks\./);
    assert.doesNotMatch(r.opened.line, /hearts/i, "hearts said when the status had none");
  });
  const f = render("roon-settings-fellback", FELL_BACK);
  harness.assertNoPageError(assert, f);
  await t.test("a failed read: why, and that the official API's list is back meanwhile", () => {
    assert.match(f.opened.line, /^Connecting to your server…\nThe last read failed .+: The Core refused page 3: Busy\. Until a read succeeds, your library is the official API's list\./);
    assert.doesNotMatch(f.opened.line, /Roon/);
  });
});

// v1.9.27: the hearts block — off until turned on, with the favourites read to check first;
// whose, when the server has several profiles.
const HEARTS_OFF = Object.assign({}, NATIVE, { hearts: { album: { on: true }, track: { on: true }, albumSet: 0, albumConfirmed: 0, awaiting: 0, trackSet: 0,
  enabled: false, off: "Hearts are off.", profiles: [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "Guest" }], profile: null, favourites: 1234 } });
const HEARTS_DRIVER = `
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="roon"]').click();
  await window.__sleep(500);
  var block = document.getElementById("roon-hearts-block");
  var pick = document.getElementById("roon-hearts-profile");
  T("seen", { shown: !block.classList.contains("hidden"), on: document.getElementById("roon-hearts-enabled").checked,
    picker: !document.getElementById("roon-hearts-profile-row").classList.contains("hidden"),
    options: Array.prototype.map.call(pick.options, function (o) { return o.textContent; }),
    line: document.getElementById("roon-hearts-status").textContent,
    info: document.querySelector('.settings-pane[data-pane="roon"] .settings-info-btn').getAttribute("data-info") });
  var box = document.getElementById("roon-hearts-enabled");
  box.checked = true; box.dispatchEvent(new Event("change"));
  await window.__sleep(200);
  pick.value = "deadbeef"; pick.dispatchEvent(new Event("change"));
  await window.__sleep(200);
  T("posts", window.__hposts);
`;
const HEARTS_STUB = `
window.__hposts = [];
window.__installFetch(function (u, init) {
  if (init && init.method === "POST" && u.indexOf("/api/roon-direct/") > -1) { window.__hposts.push([u, JSON.parse(init.body)]); return window.__json(${JSON.stringify(HEARTS_OFF)}); }
  if (u.indexOf("/api/roon-direct") > -1) return window.__json(${JSON.stringify(HEARTS_OFF)});
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

test("Settings → Native mode: hearts — off until turned on, the favourites read shown first, whose when there are several", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "roon-settings-hearts-block", windowSize: "390x844", budgetMs: 15000, driver: HEARTS_DRIVER, stub: HEARTS_STUB });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.seen.shown, r.seen.on, r.seen.picker], [true, false, true]);
  assert.deepEqual(r.seen.options, ["Choose…", "Owner", "Guest"]);
  assert.equal(r.seen.line, "Your server's list, as Rouen read it, has 1,234 favourite albums for Owner. Check that against your server's own before turning hearts on.");
  assert.doesNotMatch(r.seen.info, /Read only: nothing in your library is changed/, "the page still says nothing is ever changed");
  assert.deepEqual(r.posts, [["/api/roon-direct/hearts", { on: true }], ["/api/roon-direct/profile", { id: "deadbeef" }]]);
});

// v1.9.32 (native-remote.md §9.1): Add to library — the check, read only. It asks the server's search
// about the Smart Picks and Listen Later albums on TIDAL or Qobuz not in the library, each once.
// v1.9.33 (the review): begun by a POST, then followed — a GET while it runs, then its findings; the
// limit and the services from the server. o.max: the server's limit; o.lost: a GET answered with a page
// once the check runs; o.page: every GET so; o.raced: the POST refused, a check begun elsewhere first.
const FIND_STUB = (status, o = {}) => `
window.__finds = [];
window.__gets = 0;
var check = { running: false, total: 0, findings: [], error: null, max: ${o.max || 20}, services: { tidal: "TIDAL", qobuz: "Qobuz" } };
window.__installFetch(function (u, init) {
  if (init && init.method === "POST" && u.indexOf("/api/roon-direct/find") > -1) {
    var asked = JSON.parse(init.body).albums; window.__finds.push(asked);
    var v = ["found", "not-found", "other-source"];
    if (${!!o.raced}) {
      check = Object.assign({}, check, { running: true, total: 1, later: [{ title: "Blue", artist: "Joni Mitchell", service: "qobuz", verdict: "found", hits: [] }] });
      return window.__json({ error: "A check is already running." }, 409);
    }
    check = Object.assign({}, check, { running: true, total: asked.length, later: asked.map(function (a, i) { return { title: a.title, artist: a.artist, service: a.service, verdict: v[i % 3],
      hits: i % 3 === 2 ? [{ title: a.title, artist: a.artist, source: "Qobuz", inLibrary: false }] : [] }; }) });
    return window.__json({ running: true, total: asked.length });
  }
  if (u.indexOf("/api/roon-direct/find") > -1) {
    window.__gets++;
    if (${!!o.page}) return Promise.resolve(new Response("<html>Log in</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    if (check.running && ${!!o.lost}) return Promise.resolve(new Response("<html>Log in</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    // Running on the first look after the POST, done on the next.
    if (check.running && check.seen) check = Object.assign({}, check, { running: false, findings: check.later });
    else if (check.running) check.seen = true;
    return window.__json(check);
  }
  if (u.indexOf("/api/roon-direct") > -1) return window.__json(${JSON.stringify(status)});
  // o.none: every album in the library or on no service the check takes — nothing to ask.
  if (u.indexOf("/api/smart-picks") > -1 && ${!!o.none}) return window.__json({ picks: [
    { album: "Mezzanine", artist: "Massive Attack", service: "tidal", offset: 12 },
    { album: "Dummy", artist: "Portishead", service: "qobuz", offset: 40 },
    { album: "Untitled", artist: "Someone", service: "spotify", offset: null } ] });
  if (u.indexOf("/api/listen-later") > -1 && ${!!o.none}) return window.__json({ albums: [] });
  if (u.indexOf("/api/smart-picks") > -1) return window.__json({ picks: [
    { album: "Mezzanine", artist: "Massive Attack", service: "tidal", offset: 12 },
    { album: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal", offset: null },
    { album: "Untitled", artist: "Someone", service: "spotify", offset: null } ] });
  if (u.indexOf("/api/listen-later") > -1) return window.__json({ albums: [
    { title: "selected ambient works 85-92", artist: "aphex twin", service: "tidal", offset: null },
    { title: "Homogenic", artist: "Björk", service: "qobuz", offset: null },
    { title: "Blue", artist: "Joni Mitchell", service: "", offset: null } ] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
const FIND_DRIVER = `
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="roon"]').click();
  await window.__sleep(500);
  var block = document.getElementById("roon-find-block");
  T("shown", !block.classList.contains("hidden"));
  if (!block.classList.contains("hidden")) {
    // The button's words, all of them on screen at a phone's width (v1.9.35: they were cut at both ends).
    var run = document.getElementById("roon-find-run");
    T("button_fits", run.scrollWidth <= run.clientWidth);
    document.getElementById("roon-find-run").click();
    await window.__sleep(400);
    T("running", document.getElementById("roon-find-status").textContent);
    await window.__sleep(1300);
    T("asked", window.__finds);
    T("line", document.getElementById("roon-find-status").textContent);
    T("items", Array.prototype.map.call(document.querySelectorAll("#roon-find-list li"), function (li) { return li.textContent; }));
  }
`;

test("Settings → Native mode: Add to library — the check asks only about albums on TIDAL or Qobuz not in the library, once each, and says what was found", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "roon-settings-find", windowSize: "390x844", budgetMs: 15000, driver: FIND_DRIVER, stub: FIND_STUB(NATIVE) });
  harness.assertNoPageError(assert, r);
  assert.equal(r.shown, true, "no check offered with native mode in force");
  assert.equal(r.button_fits, true, "the button's words are cut off at 390px");
  assert.deepEqual(r.asked, [[
    { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" },
    { title: "Homogenic", artist: "Björk", service: "qobuz" }]], "asked about an album in the library, not on a service, or twice");
  assert.equal(r.running, "Asking your server's search about 2 albums, one at a time: 0 so far…");
  assert.equal(r.line, "Your server's search found 1 of 2 on their service, ready to add. Nothing was changed.");
  assert.deepEqual(r.items, ["Selected Ambient Works 85-92 — Aphex Twin: ✓ found on TIDAL: your server could add it", "Homogenic — Björk: not found"]);
  const off = harness.renderPage({ name: "roon-settings-find-off", windowSize: "390x844", budgetMs: 15000, driver: FIND_DRIVER,
    stub: FIND_STUB(Object.assign({}, NATIVE, { active: false })) });
  harness.assertNoPageError(assert, off);
  assert.equal(off.shown, false, "the check offered with native mode not in force");
});

test("Settings → Native mode: Add to library — the check asks no more than the server takes, and a reply that isn't the check says it may still be running", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "roon-settings-find-lost", windowSize: "390x844", budgetMs: 15000, driver: FIND_DRIVER, stub: FIND_STUB(NATIVE, { max: 1, lost: true }) });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.asked, [[{ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" }]], "asked about more than the server's limit");
  assert.equal(r.line, "Rouen stopped answering during the check; it may still be running there. Press the button again in a while to see it.");
});

test("Settings → Native mode: Add to library — nothing to check says what it looked at, and why each was left out", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "roon-settings-find-none", windowSize: "390x844", budgetMs: 15000, driver: FIND_DRIVER, stub: FIND_STUB(NATIVE, { none: true }) });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.asked, []);
  assert.equal(r.line, "Nothing to check. Of your 3 Smart Picks and Listen Later albums, 2 are in your library already and 1 isn't on TIDAL or Qobuz.");
});

test("Settings → Native mode: Add to library — a first reply that isn't the check is said so, and a check begun elsewhere meanwhile is followed", async () => {
  if (!harness.available) return;
  const page = harness.renderPage({ name: "roon-settings-find-page", windowSize: "390x844", budgetMs: 15000, driver: FIND_DRIVER, stub: FIND_STUB(NATIVE, { page: true }) });
  harness.assertNoPageError(assert, page);
  assert.deepEqual([page.line, page.asked], ["Rouen answered with something other than the check (200).", []]);
  const raced = harness.renderPage({ name: "roon-settings-find-raced", windowSize: "390x844", budgetMs: 15000, driver: FIND_DRIVER, stub: FIND_STUB(NATIVE, { raced: true }) });
  harness.assertNoPageError(assert, raced);
  assert.equal(raced.line, "Your server's search found 1 of 1 on their service, ready to add. Nothing was changed.");
  assert.deepEqual(raced.items, ["Blue — Joni Mitchell: ✓ found on Qobuz: your server could add it"]);
});
