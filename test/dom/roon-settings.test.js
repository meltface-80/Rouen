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
  checked: { after: "Roon Core updated from 2.0 (1500) to 2.0 (1600)", at: DAY },
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
  T("nav", { there: !!nav, after: nav && nav.previousElementSibling && nav.previousElementSibling.getAttribute("data-pane") });
  nav.click();
  await window.__sleep(500);
  var pane = document.querySelector('.settings-pane[data-pane="roon"]');
  var box = document.getElementById("roon-direct-enabled");
  var info = pane.querySelector(".settings-info-btn");
  var notice = pane.querySelector(".roon-direct-notice");
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

  await t.test("a Roon page in the Settings list, after Services", () => {
    assert.equal(r.nav.there, true, "THE one: no way to reach the switch");
    assert.equal(r.nav.after, "streaming");
  });

  await t.test("Read this first: above the switch, with its links (v1.9.20)", () => {
    assert.match(r.notice.text, /^Read this first\. Roon direct is unofficial: it is not made, endorsed or supported by Roon Labs\./);
    assert.match(r.notice.text, /“not hardened for 3rd party use”/);
    assert.match(r.notice.text, /Keep port 9332 on your own network, never forward it to the internet\./);
    assert.match(r.notice.text, /With Roon direct switched off \(the switch below\) only Roon's official extension API is used\.$/);
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
    assert.equal(r.opened.info, "About Roon direct");
  });

  await t.test("turned on: posted, and the match shown", () => {
    assert.deepEqual(r.toggled.posts, [true]);
    assert.equal(r.toggled.checked, true);
    assert.match(r.toggled.line, /^Matched 12,961 of 12,968 albums — Local 19 · Qobuz 12,937 · TIDAL 5\./);
    assert.match(r.toggled.line, /TIDAL 5\.\n/);
    assert.match(r.toggled.line, /\n7 not matched, so shown with no source \(2 listed by Roon under two sources\)\./);
    assert.match(r.toggled.which || "", /\/api\/roon-direct\/unmatched$/, "no way to see which albums were not matched");
    assert.match(r.toggled.line, /\nLast read .+, in 1 min 35 s\./);
    assert.match(r.toggled.line, /\nChecked after Roon Core updated from 2\.0 \(1500\) to 2\.0 \(1600\), .+: passed\.\n/);
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
