"use strict";
// ---------------------------------------------------------------------------
// v1.9.2: an offset sent with the wrong list is found by the album's name.
//
// The report: the artist page's albums, opened with a genre filter on, came
// back "Album not found at offset 2527" with a 500. The page sent a
// WHOLE-LIBRARY offset with the genre filter, so the server looked up 2527 in a
// 500-album genre list, found nothing — and threw on the spot, before any of
// the relocation by identity that every other stale offset gets could run.
//
// The page is fixed to send the right list. This is the server's half, for
// any other way an offset arrives with the wrong list — a page from before the
// fix still open on a phone above all: with the album's identity in hand,
// nothing at the offset is the same case as the wrong album there, and both
// look for it in the WHOLE library, where the snapshot can place it, before
// Roon's search and before giving up. Driven through the real
// loadAlbumSession, against a Roon that answers only the calls it makes.
//
// And the offset it hands back. The page adopts that as the album's position
// in the list it SENT — so a genre offset relocated into the whole library
// must come back as the genre offset it was, or the page ends up holding a
// whole-library number beside a genre filter: the reported bug, rebuilt one
// open later.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");

const X = { title: "Concert très très privé RTL2", subtitle: "Jean-Jacques Goldman" };
const GENRE = { type: "genre", value: "International" };
const GENRE_SIZE = 500;
const LIBRARY_SIZE = 3000;
const X_IN_LIBRARY = 2527;

function harness(o) {
  const seen = { nav: [], loads: [], searched: 0, looks: [], opened: null };
  let drilled = false;
  const F = loadIndexFunctions(["loadAlbumSession", "albumIdentityMatches", "normalize",
                                "isTrackItem", "stripTrackNumber"], {
    navigateToAlbumList: async (sk, filter) => {
      seen.nav.push(filter ? filter.type + ":" + filter.value : "library");
      if (!filter && o.wholeFails) throw new Error("Roon refused the browse");
      return filter ? { hierarchy: "genres", total: GENRE_SIZE }
                    : { hierarchy: "albums", total: o.libraryTotal !== undefined ? o.libraryTotal : LIBRARY_SIZE };
    },
    albumIndex: { count: LIBRARY_SIZE, declared: LIBRARY_SIZE },
    // The genre's list holds GENRE_SIZE albums, none of them X; the whole
    // library holds X at X_IN_LIBRARY and other records everywhere else. Once
    // an album has been drilled into, a load reads ITS contents.
    load: async (q) => {
      if (drilled) return { items: [{ title: "Play Album", hint: "action_list", item_key: "p" },
                                    { title: "1. One", subtitle: X.subtitle, hint: "action_list", item_key: "t1" }],
                            list: { count: 2 } };
      seen.loads.push(q.hierarchy + "@" + q.offset);
      if (q.hierarchy === "genres") {
        return { items: q.offset < GENRE_SIZE ? [{ title: "Genre record " + q.offset, subtitle: "Someone", item_key: "g" + q.offset }] : [] };
      }
      if (q.offset >= LIBRARY_SIZE) return { items: [] };
      return { items: [q.offset === X_IN_LIBRARY ? Object.assign({ item_key: "x" }, X)
                                                 : { title: "Library record " + q.offset, subtitle: "Someone", item_key: "l" + q.offset }] };
    },
    relocateAlbumOffset: () => (o.snapshotHas !== undefined ? o.snapshotHas : X_IN_LIBRARY),
    findAlbumViaSearch: async () => { seen.searched++; return o.searchFinds ? { item: Object.assign({ item_key: "s" }, X), hierarchy: "search" } : null; },
    requestLibraryLook: (why) => seen.looks.push(why),
    // The drill into the album it settled on: which one is the question.
    browse: async (q) => { seen.opened = q.hierarchy + ":" + q.item_key; drilled = true; return { action: "list" }; },
    roonBrowseError: (body, what) => new Error("Roon refused " + what),
    rememberAlbumTracks: () => {},
    DEBUG: false, console: { log() {}, warn() {}, error() {} },
  });
  return {
    seen,
    open: async (offset, filter, expect) => {
      try {
        const r = await F.loadAlbumSession("sk", offset, filter, expect, "z1");
        return { ok: true, offset: r.offset, hierarchy: r.hierarchy, title: r.albumItem.title };
      } catch (e) {
        return { ok: false, message: e.message, stale: !!e.stale };
      }
    },
  };
}

test("an offset sent with the wrong list is found by the album's identity (v1.9.2)", async (t) => {
  await t.test("THE one: a whole-library offset past the end of the genre's list opens the album from the library", async () => {
    const h = harness({});
    const r = await h.open(X_IN_LIBRARY, GENRE, X);
    assert.equal(r.ok, true, "it gave up: " + r.message);
    assert.equal(h.seen.opened, "albums:x", "it opened something other than the album asked for");
    assert.deepEqual(h.seen.nav, ["genre:International", "library"]);
    assert.equal(h.seen.searched, 0, "Roon's search was asked for an album the snapshot could place");
    assert.equal(r.title, X.title);
  });
  await t.test("a genre-list offset that holds ANOTHER album is relocated into the library too, before any search", async () => {
    const h = harness({});
    const r = await h.open(231, GENRE, X);
    assert.equal(r.ok, true, r.message);
    assert.equal(h.seen.opened, "albums:x");
    assert.equal(h.seen.searched, 0);
  });
  await t.test("and hands back the offset it was SENT, never the library's: the page pairs it with the genre", async () => {
    const h = harness({});
    const r = await h.open(231, GENRE, X);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.offset, 231,
      "a whole-library offset went back to a page that will send it with the genre filter");
  });
  await t.test("without the album's identity there is nothing to look for: still not found, never a guess", async () => {
    const h = harness({});
    const r = await h.open(X_IN_LIBRARY, GENRE, null);
    assert.equal(r.ok, false);
    assert.match(r.message, /Album not found at offset 2527/);
    assert.equal(h.seen.opened, null);
  });
  await t.test("one the snapshot cannot place goes to Roon's search, and opens what it finds", async () => {
    const h = harness({ snapshotHas: -1, searchFinds: true });
    const r = await h.open(X_IN_LIBRARY, GENRE, X);
    assert.equal(r.ok, true, r.message);
    assert.equal(h.seen.searched, 1);
    assert.equal(h.seen.opened, "search:s");
  });
  await t.test("and one nobody can find is refused as moved (409), not a 500", async () => {
    const h = harness({ snapshotHas: -1, searchFinds: false });
    const r = await h.open(X_IN_LIBRARY, GENRE, X);
    assert.equal(r.ok, false);
    assert.equal(r.stale, true, "an album that cannot be found was reported as a server failure");
  });
  await t.test("a filtered open that never reached the whole library asks for no re-read", async () => {
    const h = harness({ snapshotHas: -1, searchFinds: true });
    await h.open(X_IN_LIBRARY, GENRE, X);
    assert.deepEqual(h.seen.looks, []);
  });
  await t.test("one that did, and found the snapshot wrong about the album, asks for one — as a whole-library open does", async () => {
    // The snapshot places X at 2600; Roon has another record there.
    const h = harness({ snapshotHas: 2600, searchFinds: true });
    const r = await h.open(X_IN_LIBRARY, GENRE, X);
    assert.equal(r.ok, true, r.message);
    assert.equal(h.seen.opened, "search:s");
    assert.equal(h.seen.looks.length, 1, "evidence that the snapshot is stale was thrown away");
    assert.match(h.seen.looks[0], /album open found nothing at offset 2527/);
  });
  await t.test("but not when the library's count has moved: that is a look, not a re-read mid-import", async () => {
    const h = harness({ snapshotHas: 2600, searchFinds: true, libraryTotal: LIBRARY_SIZE + 40 });
    await h.open(X_IN_LIBRARY, GENRE, X);
    assert.equal(h.seen.looks.length, 1);
    assert.match(h.seen.looks[0], /saw 3040 albums/);
  });
  await t.test("a failure reaching the whole library leaves Roon's search to run, rather than a 500", async () => {
    const h = harness({ wholeFails: true, searchFinds: true });
    const r = await h.open(X_IN_LIBRARY, GENRE, X);
    assert.equal(r.ok, true, "the open failed: " + r.message);
    assert.equal(h.seen.opened, "search:s");
  });
  await t.test("control: a whole-library offset past the end is relocated in the same list", async () => {
    const h = harness({});
    const r = await h.open(LIBRARY_SIZE + 10, null, X);
    assert.equal(r.ok, true, r.message);
    assert.equal(h.seen.opened, "albums:x");
    assert.deepEqual(h.seen.nav, ["library"], "it navigated again for an offset already in the whole library");
    assert.equal(r.offset, X_IN_LIBRARY, "the corrected position in the same list must still reach the page");
  });
  await t.test("control: an offset that holds the album opens it with no relocation at all", async () => {
    const h = harness({});
    const r = await h.open(X_IN_LIBRARY, null, X);
    assert.equal(r.ok, true, r.message);
    assert.equal(h.seen.opened, "albums:x");
    assert.deepEqual(h.seen.loads, ["albums@2527"]);
  });
});
