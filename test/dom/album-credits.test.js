"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t1 (public/album-credits.js, dev/design/album-credits.md §1, §7):
// the album page's Credits — who played, sang, wrote and made it, in the
// server's order, eight then More, the tracks said when not every one; a tap
// opens that name's artist page — and, on a band's artist page, its members
// now. A phone and a tablet, as the owner's screenshots of Mandarin show.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Lounge", state: "stopped", settings: {}, outputs: [], now_playing: null };
const DETAIL = { title: "Kings Among Scotland", subtitle: "Anthrax", image_key: null, actions: [{ kind: "play_now", title: "Play Now" }],
  tracks: Array.from({ length: 6 }, (_, i) => ({ title: "Track " + (i + 1), subtitle: "Anthrax" })) };
const credit = (name, roles, tracks, photo) => ({ name, roles, tracks, photo: photo || null, source: "roon" });
const CREDITS = [
  credit("Charlie Benante", ["Drums", "Composer", "Lyricist"], [], "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="),
  credit("Frank Bello", ["Bass"], []), credit("Joey Belladonna", ["Lead vocals"], [1, 2, 3, 5]), credit("Scott Ian", ["Rhythm guitar"], [4]),
  credit("Jonathan Donais", ["Lead guitar"], [1, 2]), credit("Dan Spitz", ["Composer"], [1, 2, 3, 4, 6]), credit("Jay Ruston", ["Producer"], []),
  credit("Paul Logus", ["Mastering"], []), credit("Stephen Thrash", ["Design"], []), credit("Rob Caggiano", ["Engineer"], [6]),
];
const MEMBERS = [{ name: "Scott Ian", roles: ["Rhythm guitar"], photo: null }, { name: "Joey Belladonna", roles: ["Lead vocals"], photo: null }];

const STUB = `
window.__creditAsks = 0; window.__artists = [];
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__installFetch(function (url) {
  if (url.indexOf("/api/album/credits") > -1) {
    window.__creditAsks++;
    // the first answer: still being read, two names so far; the next, all of them
    return window.__json(window.__creditAsks === 1 ? { credits: ${JSON.stringify(CREDITS.slice(0, 2))}, status: "pending" } : { credits: ${JSON.stringify(CREDITS)}, status: "ok" });
  }
  if (url.indexOf("/api/artist/members") > -1) return window.__json({ members: ${JSON.stringify(MEMBERS)}, status: "ok" });
  if (url.indexOf("/api/artist-albums") > -1) return window.__json({ primary: [{ offset: 0, title: "Kings Among Scotland", subtitle: "Anthrax", image_key: null }], featured: [] });
  if (url.indexOf("/api/artist-bio") > -1) return window.__json({ bio: { text: "A band from New York.", source: "Wikipedia" } });
  if (url.indexOf("/api/album/more") > -1) return window.__json({ artist: "Anthrax", by: [], appears: [] });
  if (url.indexOf("/api/album/extras") > -1) return window.__json({ album: { description: "A live album.", source: "AllMusic" } });
  if (url.indexOf("/api/album?") > -1) return window.__json(${JSON.stringify(DETAIL)});
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(500);
  var sec = function () { return document.getElementById("album-credits"); };
  var rows = function () { return Array.prototype.slice.call(sec().querySelectorAll(".credit")); };
  var seen = function () { return rows().filter(function (r) { return !r.classList.contains("hidden"); }); };
  var box = function (el) { var b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
  window.__openAlbum({ offset: 3, title: "Kings Among Scotland", subtitle: "Anthrax", image_key: null });
  await window.__sleep(700);
  T("first", { shown: !!sec() && !sec().classList.contains("hidden"), names: rows().map(function (r) { return r.querySelector(".credit-name").textContent; }) });
  await window.__sleep(6500);
  var aside = document.getElementById("modal-aside");
  T("all", { asks: window.__creditAsks, first: aside.firstElementChild === sec(), count: rows().length, seen: seen().length,
    more: sec().querySelector(".more-toggle").textContent, head: sec().querySelector(".section-label").textContent,
    lines: rows().slice(0, 6).map(function (r) { var x = r.querySelector(".credit-roles"); return x ? x.textContent : ""; }),
    pic: !!rows()[0].querySelector("img"), initial: rows()[1].querySelector(".credit-initial").textContent });
  sec().querySelector(".more-toggle").click();
  T("opened", { seen: seen().length, more: sec().querySelector(".more-toggle").textContent });
  var tracks = document.querySelector(".track-list-wrap"), bio = document.getElementById("album-bio-section"), art = document.querySelector(".modal-art");
  T("place", { credits: box(sec()), tracks: box(tracks), bio: box(bio), art: box(art), W: document.documentElement.clientWidth });
  // a tap: that name's artist page
  rows()[2].click();
  await window.__sleep(900);
  T("artist", { active: window.__artistViewActive(), modalHidden: document.getElementById("album-modal").classList.contains("hidden") });
  var grid = document.getElementById("album-grid");
  var members = grid.querySelector(".artist-members");
  T("members", members ? { head: members.querySelector(".section-label").textContent,
    names: Array.prototype.map.call(members.querySelectorAll(".credit-name"), function (x) { return x.textContent; }),
    afterBio: !!members.previousElementSibling && members.previousElementSibling.classList.contains("artist-bio-head"),
    beforeAlbums: !!members.nextElementSibling && members.nextElementSibling.classList.contains("album") } : null);
`;

// A touch screen, as a phone and a tablet are: with no pointer at all (headless Chrome's own default) a screen this
// size is taken for a TV, whose credits are four across (v1.9.70-t12, album-view.css).
const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
for (const [size, what] of [["390x844", "a phone"], ["1180x820", "a tablet"]]) {
  test(`${what}: an album's credits under its tracks, eight then More; a band's members on its artist page (v1.9.70-t1)`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "album-credits-" + size, stub: STUB, driver: DRIVER, windowSize: size, budgetMs: 30000, chromeArgs: TOUCH });
    harness.assertNoPageError(assert, r);
    await t.test("still being read: what there is shows, and the page asks once more", () => {
      assert.deepEqual(r.first, { shown: true, names: ["Charlie Benante", "Frank Bello"] });
      assert.equal(r.all.asks, 2);
    });
    await t.test("THE one: Credits, heading the side column, eight then More, each name's parts and which tracks", () => {
      assert.deepEqual([r.all.first, r.all.head, r.all.count, r.all.seen, r.all.more], [true, "Credits", 10, 8, "More"]);
      assert.deepEqual(r.all.lines, ["Drums, Composer, Lyricist", "Bass", "Lead vocals · tracks 1–3, 5", "Rhythm guitar · track 4",
        "Lead guitar · tracks 1, 2", "Composer · tracks 1–4, 6"]);
      assert.deepEqual([r.all.pic, r.all.initial], [true, "F"], "a picture where there is one, else the initial");
      assert.deepEqual(r.opened, { seen: 10, more: "Less" });
    });
    await t.test("where it sits: after the tracks and before About this album on a phone; under the cover beside them from 720px up", () => {
      const p = r.place;
      if (p.W < 720) {
        assert.ok(p.credits.t >= p.tracks.b - 1, JSON.stringify(p));
        assert.ok(p.bio.t >= p.credits.b - 1, JSON.stringify(p));
      } else {
        assert.ok(p.credits.t >= p.art.b - 1 && p.credits.r <= p.art.r + 1, JSON.stringify(p));
        assert.ok(p.credits.r <= p.tracks.l, JSON.stringify(p));
      }
    });
    await t.test("a tap opens that name's artist page; a band's page shows its members now, after its bio and before its albums", () => {
      assert.deepEqual(r.artist, { active: true, modalHidden: true });
      assert.deepEqual(r.members, { head: "Members", names: ["Scott Ian", "Joey Belladonna"], afterBio: true, beforeAlbums: true });
    });
  });
}
