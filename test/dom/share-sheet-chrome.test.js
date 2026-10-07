"use strict";
// ---------------------------------------------------------------------------
// The share sheet's own chrome: what can be reached, and what should not be
// offered.
//
// TWO THINGS, both reported from an installed iOS app.
//
// 1. The sheet's last rows sat under the now-playing pill with no way to get
//    them out. The pill floats over this overlay (z-index 70 against the
//    overlay's 60) and the panel is its own scroller, so once the panel has
//    scrolled to its end, anything inside that last ~106px is simply
//    unreachable. Same class as v1.8.50's album view. Since v1.8.82 (Mandarin
//    v0.7.9) the room is kept OUTSIDE the panel — the overlay centres it in the
//    space above the pill, measured as the sheet opens — so on Now playing,
//    where there is no pill, there is no dead space at the foot of the card.
//
// 2. The Download button does nothing useful there. `<a download>` is not
//    implemented in WebKit on iOS — the attribute is ignored, so the control
//    either navigates to a blob: URL or does nothing, and a standalone app has
//    no browser chrome to come back from. Long-pressing the image is the real
//    Save Image, and the hint already says so.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const EXTRAS = {
  year: 2019,
  album: {
    description: "Western Stars is the nineteenth studio album by Bruce Springsteen.",
    description_source: "Wikipedia",
    year: 2019, label: "Columbia",
    url: "https://pitchfork.com/reviews/albums/x/",
    source: "Pitchfork", score: 7.8, isBestNewMusic: false,
  },
  artist: null,
  // A REALISTIC sheet, because an empty one does not scroll and a panel that
  // does not scroll cannot demonstrate anything about reaching its last row.
  // This is the chip set the screenshots show.
  links: {
    services: [
      { id: "qobuz",  chip: "Qobuz",  url: "https://open.qobuz.com/" },
      { id: "spotify", chip: "Spotify", url: "https://open.spotify.com/" },
      { id: "tidal",  chip: "TIDAL",  url: "https://tidal.com/" },
      { id: "apple",  chip: "Apple Music", url: "https://music.apple.com/" },
      { id: "amazon", chip: "Amazon Music", url: "https://music.amazon.com/" },
      { id: "deezer", chip: "Deezer", url: "https://deezer.com/" },
      { id: "bandcamp", chip: "Bandcamp", url: "https://bandcamp.com/" },
    ],
    reviews: [
      { id: "wikipedia", chip: "Wikipedia", url: "https://en.wikipedia.org/" },
      { id: "pitchfork", chip: "Pitchfork", url: "https://pitchfork.com/" },
      { id: "allmusic",  chip: "AllMusic",  url: "https://allmusic.com/" },
      { id: "wikiartist", chip: "Wikipedia artist", url: "https://en.wikipedia.org/" },
      { id: "amartist",   chip: "AllMusic artist",  url: "https://allmusic.com/" },
    ],
  },
};

const PLAYING = { zone_id: "z1", display_name: "Zone", state: "paused", outputs: [],
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  now_playing: { line1: "Western Stars", line2: "Bruce Springsteen", line3: "Western Stars",
                 image_key: "k0", length: 240, seek_position: 10 } };

function stub(extra, playing) {
  return `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
${extra || ""}
window.__installFetch(function (u) {
  if (u.indexOf("/api/album/extras") > -1) return window.__json(${JSON.stringify(EXTRAS)});
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(PLAYING)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${playing ? JSON.stringify(PLAYING) : "null"} });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;
}

const DRIVER = `
  await window.__sleep(600);
  // When the fixture is playing, the pill must be up before the sheet opens:
  // the sheet measures it as it opens.
  var pill = document.getElementById("mini-transport");
  if (window.__wantPill) for (var p = 0; p < 60 && pill.classList.contains("hidden"); p++) await window.__sleep(100);
  ShareCard.render = function () {
    return Promise.resolve(new Blob([new Uint8Array([1,2,3])], { type: "image/png" }));
  };
  // The card's blob becomes a data: URL through FileReader, and FileReader
  // reads a blob over the browser's blob IPC — REAL time — while every wait in
  // this harness is VIRTUAL time, which fast-forwards whenever the page is
  // idle. On a loaded machine (the DOM files run in parallel) the wait below
  // ran out before the read landed: 12 of 24 runs, eight at once, failed as
  // "never finished building". What the bytes turn into is not what this file
  // tests, so the read is made to answer on the virtual clock.
  window.FileReader = function () {
    var self = this;
    this.readAsDataURL = function () {
      setTimeout(function () {
        self.result = "data:image/png;base64,AQID";
        if (self.onload) self.onload();
      }, 0);
    };
  };
  window.__openShareCard({ title: "Western Stars", artist: "Bruce Springsteen", image_key: "k0" });
  const actions = document.getElementById("share-actions");
  const hintEl  = document.getElementById("share-hint");
  // WAIT ON THE HINT, not on the action count. buildActions() sets the hint
  // last and unconditionally, whereas the number of buttons is exactly what
  // varies here — in headless Chromium there is no Web Share and no clipboard
  // write, so on the standalone-iOS path the actions row ends up EMPTY and a
  // loop waiting for a child never finishes. It then burned six seconds of the
  // virtual time budget and the test passed or failed depending on how loaded
  // the machine was, which is worse than either answer.
  for (var w = 0; w < 80 && !hintEl.textContent; w++) await window.__sleep(50);

  // The stubbed renderer hands back three bytes, which decode to no image and
  // therefore no height — so the frame is given the height a real 1200x1471
  // card would occupy at this width. Without it the panel is short for a
  // reason that has nothing to do with the layout being tested.
  const frame = document.getElementById("share-frame");
  frame.style.minHeight = "480px";
  await window.__sleep(50);

  const panel = document.querySelector(".share-panel");
  const cs = getComputedStyle(panel);

  // Scroll the panel to its very end — the state in which anything inside the
  // reserve is unreachable if the reserve is not there.
  panel.scrollTop = panel.scrollHeight;
  await window.__sleep(50);

  T('reserve', Math.round(parseFloat(cs.paddingBottom) || 0));
  T('scrollable', panel.scrollHeight > panel.clientHeight + 2);
  // Reported so a failure says WHY rather than just that it happened. A panel
  // that did not overflow and a panel whose last row is buried look identical
  // from the assertion alone.
  T('sh', Math.round(panel.scrollHeight));
  T('ch', Math.round(panel.clientHeight));
  T('frame_h', Math.round(frame.getBoundingClientRect().height));
  T('chips', document.querySelectorAll('#share-links .share-link').length);
  T('last_tag', last_tagOf(panel));

  // The LAST thing in the sheet, and where its bottom sits once scrolled to
  // the end. This is the measurement that matters: it is what the reserve is
  // for.
  function last_tagOf(p) {
    let e = p.lastElementChild;
    while (e && e.getBoundingClientRect().height === 0) e = e.previousElementSibling;
    return e ? (e.tagName + '.' + (e.className || '')).slice(0, 40) : 'none';
  }
  // The last VISIBLE child: an empty error line is display:none since v1.8.82,
  // and its zero box would pass any "is it above the pill" check.
  let last = panel.lastElementChild;
  while (last && last.getBoundingClientRect().height === 0) last = last.previousElementSibling;
  const lastBottom = last ? last.getBoundingClientRect().bottom : 0;
  const panelBottom = panel.getBoundingClientRect().bottom;
  T('last_bottom', Math.round(lastBottom));
  T('panel_bottom', Math.round(panelBottom));
  T('clear_by', Math.round(panelBottom - lastBottom));
  T('pill_shown', !pill.classList.contains('hidden'));
  T('pill_top', Math.round(pill.getBoundingClientRect().top));
  T('pad_bottom', Math.round(parseFloat(cs.paddingBottom) || 0));

  T('has_download', !!Array.from(actions.querySelectorAll('a')).some(a => a.hasAttribute('download')));
  T('hint', hintEl.textContent || '');
  // Proof the sheet actually finished, so an assertion about what is absent
  // cannot pass because nothing was ever built.
  T('built', !!hintEl.textContent);
`;

function run(name, extra, playing) {
  const r = harness.renderPage({ stub: stub((playing ? "window.__wantPill = true;" : "") + (extra || ""), playing),
                                 driver: DRIVER, name,
                                 // 60s, matching the other share tests. This
                                 // ran at 25s and passed alone while failing
                                 // under the full suite: the DOM files run in
                                 // parallel, so a tight budget measures how
                                 // loaded the machine is rather than the page.
                                 windowSize: "390x844", budgetMs: 60000 });
  harness.assertNoPageError(assert, r);
  assert.equal(r.built, true,
    "the share sheet never finished building, so nothing below this measures " +
    "what it claims to");
  return r;
}

test("the share sheet keeps clear of the transport pill, and keeps no room when there is none", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }

  await t.test("with the pill showing, scrolled to the end, the last row is above the pill", () => {
    const r = run("share-sheet-reserve", "", true);
    assert.equal(r.pill_shown, true, "the fixture's pill is not showing, so this measures nothing");
    assert.equal(r.scrollable, true,
      `the fixture did not produce a scrolling panel, so this measures nothing ` +
      `(scrollHeight ${r.sh} vs clientHeight ${r.ch}, frame ${r.frame_h}px, ${r.chips} chips)`);
    assert.ok(r.last_bottom <= r.pill_top,
      `with the panel scrolled fully down its last element ends at y=${r.last_bottom}, ` +
      `under the pill's top at y=${r.pill_top} — the last rows cannot be brought into view ` +
      `(panel bottom ${r.panel_bottom}, last is ${r.last_tag})`);
  });

  await t.test("with no pill (Now playing), no dead space at the foot of the card", () => {
    const r = run("share-sheet-no-pill");
    assert.equal(r.pill_shown, false);
    assert.ok(r.pad_bottom <= 24,
      `the panel keeps ${r.pad_bottom}px at its foot with no pill to clear — dead space under the card`);
  });
});

test("the Download button is offered off iOS and withheld in an installed iOS app", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }

  await t.test("a normal browser gets it", () => {
    const r = run("share-sheet-dl-desktop");
    assert.equal(r.has_download, true,
      "the Download button is missing where <a download> works perfectly well");
  });

  await t.test("an installed iOS app does not", () => {
    // Both halves of the detection, because either alone is wrong: the platform
    // test without standalone would strip the button from Safari tabs, where it
    // still has a tab to come back to.
    const r = run("share-sheet-dl-ios", `
      Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
      Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
    `);
    assert.equal(r.has_download, false,
      "the Download button is still offered in a standalone iOS app, where " +
      "<a download> is ignored by WebKit and the control navigates away from " +
      "an app that has no chrome to come back from");
    assert.doesNotMatch(r.hint, /tap Download/i,
      `the hint still reads "${r.hint}" and points at a button that is not there`);
    assert.match(r.hint, /long-press/i,
      "the hint no longer tells the user how to actually save the card");
  });

  await t.test("iOS in a browser tab keeps it", () => {
    const r = run("share-sheet-dl-ios-tab", `
      Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
    `);
    assert.equal(r.has_download, true,
      "the button was removed from a normal iOS Safari tab — there the page can " +
      "be navigated back from, so only the standalone case is the problem");
  });
});
