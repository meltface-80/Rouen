"use strict";
// ---------------------------------------------------------------------------
// v1.8.35: a suggestion is somewhere to GO. 2.0.6-t14 (the owner, 2026-11-24): it goes to THE album view — the one
// every grid opens — for the record shown, in the library or not: "You must make the share card and smart pick
// suggestions open to those albums that are shown … The album screens must be the uniform album screen for all albums
// in the grid screens." In the library it had queued it (v1.8.35), and not in it, opened Roon's search (2.0.6-t12),
// which from the card was drawn behind Now playing: "Share card just closes out and returns to the now playing screen".
//
// What matters: a library row opens the album at its place under the LIBRARY's title and artist, not Deezer's (the
// album view's identity check, /api/album); a row not in the library opens it by its title and artist at
// RouenStreaming.UNLISTED, which the server finds by Roon's own search; the card closes over the view; and the
// default service (a per-device preference, set by holding a service chip) is the one it would be added from.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const SERVICES = [
  { id: "qobuz",   name: "Qobuz",   url: "https://www.qobuz.com/gb-en/search/?q=Brian%20Eno" },
  { id: "tidal",   name: "TIDAL",   url: "https://tidal.com/search?q=Brian%20Eno" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/search/Brian%20Eno" },
];

const ACTS = [
  // In the library: the LIBRARY's spelling differs from Deezer's on purpose.
  { name: "Brian Eno", album: "Here Come the Warm Jets", year: 1974,
    in_library: true, offset: 42,
    library_title: "Here Come The Warm Jets", library_subtitle: "Brian Eno", services: [] },
  // Not in the library.
  { name: "Iggy Pop", album: "The Idiot", year: 1977,
    in_library: false, offset: null, library_title: null, library_subtitle: null,
    services: SERVICES },
  // No record could be named — still worth showing, nothing to link to.
  { name: "Kraftwerk", album: null, year: null,
    in_library: false, offset: null, services: [] },
];

const EXTRAS = { year: 1977, album: null, artist: null,
                 links: { services: SERVICES, reviews: [] } };

function stubFor(pref) {
  return `
window.__plays = [];
try {
  localStorage.setItem("rra-zone", "z1");
  localStorage.setItem("zone", "z1");
  ${pref ? `localStorage.setItem("musicd-share-service", ${JSON.stringify(pref)});` : ""}
} catch (e) {}
window.__installFetch(function (u, opts) {
  if (u.indexOf("/api/play") > -1 && opts && opts.method === "POST") {
    window.__plays.push(JSON.parse(opts.body || "{}"));
    return window.__json({ ok: true, action: "Queue", offset: 42 });
  }
  if (u.indexOf("/api/similar") > -1)    return window.__json({ acts: ${JSON.stringify(ACTS)} });
  if (u.indexOf("/api/album?") > -1) {
    var q = new URL(u, location.href).searchParams;
    return window.__json({ album: { title: q.get("title"), subtitle: q.get("subtitle"), image_key: "roon-" + q.get("offset") },
      tracks: [{ title: "Sister Midnight", subtitle: "" }], actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }],
      offset: Number(q.get("offset")) });
  }
  if (u.indexOf("/api/album/extras") > -1) return window.__json(${JSON.stringify(EXTRAS)});
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [{ zone_id: "z1", display_name: "Room", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;
}

const DRIVER = `
  await window.__sleep(700);
  if (document.fonts) document.fonts.load = function () { return Promise.resolve([]); };
  window.FileReader = function () {
    this.readAsDataURL = function () {
      this.result = "data:image/png;base64,AA==";
      var self = this;
      setTimeout(function () { if (self.onload) self.onload(); }, 0);
    };
  };
  ShareCard.render = function () {
    return Promise.resolve(new Blob([new Uint8Array([1])], { type: "image/png" }));
  };
  async function until(what, fn) {
    for (var i = 0; i < 600; i++) { if (fn()) return true; await window.__sleep(25); }
    T("TIMED_OUT_WAITING_FOR", what);
    return false;
  }
  var rowsSel = "#share-similar-list .share-similar-act";
  var modal = document.getElementById("album-modal");
  var overlay = document.getElementById("share-overlay");
  async function openCard() {
    window.__openShareCard({ title: "Low", artist: "David Bowie", image_key: "k0" });
    await until("the suggestions", function () { return document.querySelectorAll(rowsSel).length; });
    return Array.prototype.slice.call(document.querySelectorAll(rowsSel));
  }
  /** A row tapped: what the album view asked the server, and what it shows. */
  async function tap(row, name) {
    var before = window.__calls.length;
    row.click();
    await until(name, function () { return !modal.classList.contains("hidden") && document.querySelector("#album-modal .action-btn"); });
    await window.__sleep(150);
    var asked = window.__calls.slice(before).filter(function (u) { return u.indexOf("/api/album?") > -1; })
      .map(function (u) { var q = new URL(u, location.href).searchParams; return [Number(q.get("offset")), q.get("title"), q.get("subtitle")]; });
    var img = document.getElementById("modal-img");
    T(name, { asked: asked, card_closed: overlay.classList.contains("hidden"), np: modal.classList.contains("np-mode"),
      title: (document.getElementById("modal-title") || {}).textContent || "", cover: img ? img.getAttribute("src") : null,
      pills: [].map.call(document.querySelectorAll("#album-modal .modal-actions .action-btn"), function (b) { return b.textContent; }),
      suggested: window.__currentAlbum && window.__currentAlbum.suggested || null });
  }

  var rows = await openCard();
  // These rows share their builder with the Discover screen, which DOES carry artwork. Carrying none here is an older
  // and separate decision about a compact list inside a sheet.
  T("any_art", !!document.querySelector("#share-similar-list .row-art"));
  T("rows", rows.map(function (r) {
    return { tag: r.tagName, cls: r.className,
             href: r.getAttribute("href"), target: r.getAttribute("target"),
             label: (r.querySelector(".share-similar-name") || {}).textContent || "",
             badge: (r.querySelector(".share-similar-tag") || {}).textContent || null };
  }));
  var chips = Array.prototype.slice.call(document.querySelectorAll("#share-links a[data-service]"));
  T("chip_ids", chips.map(function (c) { return c.dataset.service; }));
  T("ticked", chips.filter(function (c) { return c.classList.contains("is-default"); })
                   .map(function (c) { return c.dataset.service; }));

  await tap(rows[0], "library_open");
  T("plays", window.__plays.length);
  rows = await openCard();
  await tap(rows[1], "service_open");

  // Holding a chip changes the default — the Share Card app's gesture — and the one it would be added from follows.
  rows = await openCard();
  var tidal = Array.prototype.slice.call(document.querySelectorAll("#share-links a[data-service]"))
    .filter(function (c) { return c.dataset.service === "tidal"; })[0];
  tidal.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
  await window.__sleep(250);
  T("stored_after_hold", (function () { try { return localStorage.getItem("musicd-share-service"); } catch (e) { return null; } })());
  T("ticked_after_hold", Array.prototype.slice.call(document.querySelectorAll("#share-links a[data-service]"))
      .filter(function (c) { return c.classList.contains("is-default"); })
      .map(function (c) { return c.dataset.service; }));
  rows = Array.prototype.slice.call(document.querySelectorAll(rowsSel));
  await tap(rows[1], "after_hold");

  // The card over an album: the suggestion's view, and its Back goes back to that album (2.0.6-t14, the review).
  document.querySelector("#album-modal [data-close]").click();
  await window.__sleep(150);
  window.__openAlbum({ offset: 5, title: "Low", subtitle: "David Bowie", image_key: "k0" }, { filter: null });
  await until("album A", function () { return document.querySelector("#album-modal .action-btn"); });
  rows = await openCard();
  await tap(rows[1], "over_album");
  document.querySelector("#album-modal [data-close]").click();
  await window.__sleep(300);
  T("back_to", { shown: !modal.classList.contains("hidden"), title: document.getElementById("modal-title").textContent });
`;

function render(pref) {
  const r = harness.renderPage({ stub: stubFor(pref), driver: DRIVER,
                                 name: "share-similar-actions", windowSize: "390x900",
                                 budgetMs: 60000 });
  harness.assertNoPageError(assert, r);
  assert.equal(r.TIMED_OUT_WAITING_FOR, undefined,
    "the driver gave up waiting for " + r.TIMED_OUT_WAITING_FOR);
  return r;
}

test("a suggestion opens its album view", { concurrency: 1 }, async (t) => {
  await t.test("each row says what a tap will do, before it is tapped", () => {
    const r = render(null);
    assert.equal(r.rows.length, 3);
    // In the library: a button, badged Open.
    assert.equal(r.rows[0].tag, "BUTTON", "a library row should be a button, not a link");
    assert.match(r.rows[0].cls, /is-library/);
    assert.equal(r.rows[0].badge, "Open");
    assert.equal(r.rows[0].href, null, "a library row must not navigate anywhere");
    // Not in the library: a button opening its album view, inside Rouen.
    assert.equal(r.rows[1].tag, "BUTTON");
    assert.match(r.rows[1].cls, /is-service/);
    assert.equal(r.rows[1].href, null, "nothing leaves Rouen");
    assert.equal(r.rows[1].badge, "Open");
    // No record named: not a control at all.
    assert.equal(r.rows[2].tag, "DIV", "a row with nowhere to go must not look tappable");
    assert.equal(r.rows[2].badge, null);
  });

  await t.test("the suggestions carry no artwork", () => {
    // v1.8.39 gave the shared row builder an optional cover for the Discover screen. These rows must not have picked
    // one up with it: they are a compact list inside a sheet, which is why they never had one.
    const r = render(null);
    assert.equal(r.any_art, false, "a suggestion row grew an album cover");
  });

  await t.test("THE one: the library row opens its album view, at its place, with the LIBRARY's identity; the card closes", () => {
    const r = render(null);
    const o = r.library_open;
    // Deezer says "Here Come the Warm Jets", the library says "The": the view's identity check needs the library's.
    assert.deepEqual(o.asked, [[42, "Here Come The Warm Jets", "Brian Eno"]]);
    assert.equal(o.card_closed, true, "the card stayed over the album view");
    assert.equal(o.np, false, "it went to Now playing, not the album");
    assert.equal(o.title, "Here Come The Warm Jets");
    assert.deepEqual(o.pills, ["Play Now", "Queue"]);
    assert.equal(o.suggested, null, "an album of the library is not added from its view");
    assert.equal(r.plays, 0, "a tap queued it: it opens the album now");
  });

  await t.test("THE one: a row not in the library opens ITS album view — by its title and artist, Roon's cover, the card closed", () => {
    const r = render(null);
    const o = r.service_open;
    assert.deepEqual(o.asked, [[999999, "The Idiot", "Iggy Pop"]], "not the album view for this record");
    assert.equal(o.card_closed, true);
    assert.equal(o.np, false);
    assert.equal(o.title, "The Idiot");
    assert.equal(o.cover, "/api/image/roon-999999?size=800", "Roon's cover for it, once Roon named it");
    assert.deepEqual(o.pills, ["Play Now", "Queue"], "Roon's own actions for it");
    assert.deepEqual(o.suggested, { service: "qobuz", album_id: null }, "added from the default service among Roon's own");
    assert.deepEqual(r.ticked, ["qobuz"], "exactly one chip carries the tick");
    // Spotify as the default: not one of Roon's, so it would be added from Roon's first the row names.
    const chosen = render("spotify");
    assert.deepEqual(chosen.service_open.suggested, { service: "qobuz", album_id: null });
    assert.deepEqual(chosen.ticked, ["spotify"]);
  });

  await t.test("holding a chip changes the default, and the album view's add follows", () => {
    const r = render(null);
    assert.equal(r.stored_after_hold, "tidal", "the hold did not record a choice");
    assert.deepEqual(r.ticked_after_hold, ["tidal"], "the tick did not move");
    assert.deepEqual(r.after_hold.asked, [[999999, "The Idiot", "Iggy Pop"]]);
    assert.deepEqual(r.after_hold.suggested, { service: "tidal", album_id: null });
  });

  await t.test("opened from the card over an album, its Back goes back to that album", () => {
    const r = render(null);
    assert.equal(r.over_album.title, "The Idiot");
    assert.deepEqual(r.back_to, { shown: true, title: "Low" }, "Back lost the album the card was over");
  });
});
