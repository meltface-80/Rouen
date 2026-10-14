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
