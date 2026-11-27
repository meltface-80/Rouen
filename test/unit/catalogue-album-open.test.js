"use strict";
// ---------------------------------------------------------------------------
// A suggestion not in the library, opened in the album view (2.0.6-t16; the owner, 2026-11-24, "April In Paris" by
// The Count Basie Orchestra: "Roon's search didn't find this album by its title and artist"). Roon's search names a
// catalogue album's artists as links, "[[4707962|Count Basie Orchestra]]" (lib/roon-direct/find.js plainCredit; the
// library's come plain), and the album view's search compared that string with the plain name, so no catalogue album
// ever matched: every suggestion not in the library failed. And a track at the top of a search's answer couldn't be
// played from the search screen ("service, path, pos, title, kind and zone_or_output_id, please").
//
// Against the fake browse tree (test/lib/fake-roon-browse.js), with Roon's search answering as the owner's server did,
// and index.js's own creditHasArtist and normalize (test/lib/extract.js). The fake is not evidence of a real Core.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const { createAlbumSearch } = require("../../lib/provider/public/album-search");
const { createAlbumOpen } = require("../../lib/provider/public/album-open");
const { createStreaming } = require("../../lib/provider/public/streaming");
const { fakeBrowse } = require("../lib/fake-roon-browse");

const F = loadIndexFunctions(["creditHasArtist", "creditIdentities", "canonArtist", "canonText", "splitCreditIntoArtists", "normalize"],
  { knownArtistSet: () => new Set(["sarah vaughan", "count basie orchestra"]) });   // the library's artists, as index.js knows them

const PLAY = [{ title: "Play Now", hint: "action" }, { title: "Queue", hint: "action" }];
/** Roon's answer to a search for April in Paris, as the owner's screens showed it (2026-11-24). */
const answer = () => ({ title: "Search", items: [
  { title: "April In Paris", subtitle: "[[11|Yip Harburg]], [[12|Vernon Duke]], [[13|The Count Basie Orchestra]]", hint: "action_list", items: PLAY },
  { title: "Albums", hint: "list", items: [
    { title: "April In Paris (Expanded Edition)", subtitle: "[[21|Count Basie & His Orchestra]]", hint: "list", items: [] },
    { title: "April In Paris", subtitle: "[[4707962|Count Basie Orchestra]]", hint: "list", items: [] },
    { title: "Send In The Clowns", subtitle: "[[31|Sarah Vaughan]] & [[32|The Count Basie Orchestra]]", hint: "list", items: [] },
  ] },
  { title: "Tracks", hint: "list", items: [] },
] });

function search() {
  const f = fakeBrowse({ title: "root", items: [] }, { search: answer });
  const { findAlbumViaSearch } = createAlbumSearch({ load: f.load, browse: f.browse, normalize: F.normalize,
    creditHasArtist: F.creditHasArtist, zones: () => ({ z1: {} }) });
  return { f, findAlbumViaSearch };
}

test("THE one: a catalogue album whose credit is a link is found by its plain name — the record as titled, not its expanded edition", async () => {
  const { f, findAlbumViaSearch } = search();
  const hit = await findAlbumViaSearch("k1", "April In Paris", "The Count Basie Orchestra", null);
  assert.ok(hit, "no catalogue album found for a credit given as a link");
  assert.equal(hit.hierarchy, "search");
  assert.equal(hit.item.title, "April In Paris", "the expanded edition, not the record as titled");
  assert.equal(hit.item.subtitle, "[[4707962|Count Basie Orchestra]]");
  assert.deepEqual(f.done, [], "finding it carried something out");
});

test("a credit shared through a link still names the artist; one that doesn't credit them is still refused", async () => {
  const { findAlbumViaSearch } = search();
  const clowns = await findAlbumViaSearch("k2", "Send In The Clowns", "Sarah Vaughan", null);
  assert.equal(clowns && clowns.item.title, "Send In The Clowns");
  assert.equal(await findAlbumViaSearch("k3", "April In Paris", "Ella Fitzgerald", null), null, "another artist's record taken");
});

test("the album view shows a catalogue album's credits by their names", async () => {
  const album = { title: "April In Paris", subtitle: "[[4707962|Count Basie Orchestra]]", image_key: "c1", item_key: "a" };
  const items = [{ title: "Play Album", hint: "action_list" },
    { title: "1. April In Paris", subtitle: "[[4707962|Count Basie Orchestra]], [[11|Yip Harburg]]", hint: "action_list" }];
  const { openAlbumByOffset } = createAlbumOpen({
    withBrowseSession: async (fn) => fn("k"),
    loadAlbumSession: async () => ({ hierarchy: "search", albumItem: album, items, playMenu: items[0], offset: 999999,
      libraryMoved: false, shortRead: false, declared: 2 }),
    discsOf: () => ({ count: 1, of: [] }), isTrackItem: (t, menu) => t !== menu, stripTrackNumber: (s) => s.replace(/^\d+\.\s*/, ""),
    browse: async () => ({ action: "list" }), load: async () => ({ items: [] }), normalize: F.normalize,
    noActionError: () => new Error("none"), libraryChangingAdvice: () => "", roonBrowseError: () => new Error("x"),
  });
  const r = await openAlbumByOffset(999999, null, null, null, { title: "April In Paris", subtitle: "The Count Basie Orchestra" });
  assert.equal(r.album.subtitle, "Count Basie Orchestra", "the album's credit shown as Roon's link markup");
  assert.equal(r.tracks[0].subtitle, "Count Basie Orchestra, Yip Harburg");
});

test("the search screen: a track at the top of the answer plays, on the search's own level", async () => {
  const f = fakeBrowse({ title: "root", items: [] }, { search: answer });
  const { drillActionMenu, matchAction } = createAlbumOpen({ browse: f.browse, load: f.load, roonBrowseError: (_d, what) => new Error(what + " didn't open") });
  const s = createStreaming({ browse: f.browse, load: f.load, withBrowseSession: f.withBrowseSession, drillActionMenu, matchAction,
    libraryRecord: () => null, defaultZone: () => "z1", hasCore: () => true });
  const top = await s.level({ service: "search", q: "The Count Basie Orchestra April In Paris", path: "[]" });
  assert.deepEqual(top.items.map((i) => [i.title, i.hint, i.pos]), [["April In Paris", "action_list", 0], ["Albums", "list", 1], ["Tracks", "list", 2]]);
  assert.deepEqual(await s.playTrack({ service: "search", q: "The Count Basie Orchestra April In Paris", path: [], pos: 0, title: "April In Paris",
    kind: "play_now", zone_or_output_id: "z1" }), { invoked: "Play Now", track: "April In Paris" }, "THE one: the top result refused for want of a path");
  assert.deepEqual(f.done, ["Play Now @z1"]);
  // A service's own level is still never played from without a path: the service itself is not a track.
  await assert.rejects(s.playTrack({ service: "qobuz", path: [], pos: 0, title: "x", kind: "play_now", zone_or_output_id: "z1" }), /path/);
});

// 2.0.6-t19 (the owner, 2026-11-24, Eurythmics' "Greatest Hits" from the share card): an album in Roon's search opens a
// level holding that album alone, and only that opens its tracks and Play menu (the owner's server, v1.9.39). The album
// view had stopped at that level: the album itself as its one "track", and "Roon offered no playback options".
test("an album in Roon's search: its one-album level entered once, so its tracks and Play menu are read", async () => {
  const { enterAlbum } = require("../../lib/provider/public/album-search");
  const tracks = [{ title: "Play Album", hint: "action_list", items: PLAY }, { title: "1. Love Is a Stranger", subtitle: "[[1|Eurythmics]]", hint: "action_list", items: PLAY }];
  const tree = () => ({ title: "Search", items: [{ title: "Albums", hint: "list", items: [
    { title: "Greatest Hits", subtitle: "[[1|Eurythmics]]", hint: "list", items: [
      { title: "Greatest Hits", subtitle: "[[1|Eurythmics]]", hint: "list", items: tracks }] },
    { title: "Touch", subtitle: "[[1|Eurythmics]]", hint: "list", items: tracks }] }] });
  const f = fakeBrowse({ title: "root", items: [] }, { search: tree });
  const open = async (title) => {
    await f.browse({ hierarchy: "search", input: "eurythmics", pop_all: true, multi_session_key: "k" });
    const top = await f.load({ hierarchy: "search", offset: 0, count: 10, multi_session_key: "k" });
    await f.browse({ hierarchy: "search", item_key: top.items[0].item_key, multi_session_key: "k" });
    const albums = await f.load({ hierarchy: "search", offset: 0, count: 10, multi_session_key: "k" });
    return enterAlbum({ browse: f.browse, load: f.load }, "search", "k", albums.items.find((a) => a.title === title));
  };
  const gh = await open("Greatest Hits");
  assert.deepEqual(gh.inside.items.map((i) => i.title), ["Play Album", "1. Love Is a Stranger"], "THE one: stopped at the one-album level");
  assert.equal(gh.albumItem.title, "Greatest Hits");
  const touch = await open("Touch");
  assert.deepEqual(touch.inside.items.map((i) => i.title), ["Play Album", "1. Love Is a Stranger"], "an album that opens its tracks at once is opened once");
  assert.deepEqual(f.done, [], "opening carried something out");
});

test("2.0.8-t10, the owner's Pink Flag: Roon's search finds nothing for a title with its edition in brackets, so it is asked again without; the album is still the one titled so", async () => {
  // As the owner's screens showed it (2026-11-26): "Wire Pink Flag (2006 Remastered Version)" — "Roon's search found
  // nothing for that"; "Wire Pink Flag" — Albums: "Pink Flag (2006 Remastered Version)".
  const inputs = [];
  const pink = (input) => {
    inputs.push(input);
    if (/\(/.test(input)) return { title: "Search", items: [] };
    return { title: "Search", items: [
      { title: "Albums", hint: "list", items: [
        { title: "Pink Flag (2006 Remastered Version)", subtitle: "[[501|Wire]]", hint: "list", items: [] },
      ] },
    ] };
  };
  const f = fakeBrowse({ title: "root", items: [] }, { search: pink });
  const { findAlbumViaSearch } = createAlbumSearch({ load: f.load, browse: f.browse, normalize: F.normalize,
    creditHasArtist: F.creditHasArtist, zones: () => ({ z1: {} }) });
  const hit = await findAlbumViaSearch("k9", "Pink Flag (2006 Remastered Version)", "Wire", null);
  assert.ok(hit, "THE one: the album Roon has, not found because its edition was in the search");
  assert.equal(hit.item.title, "Pink Flag (2006 Remastered Version)");
  assert.deepEqual(inputs, ["Pink Flag (2006 Remastered Version) Wire", "Pink Flag Wire"]);
  // A title with nothing to drop is searched once; one Roon has under neither, not found.
  inputs.length = 0;
  assert.equal(await findAlbumViaSearch("k10", "Chairs Missing", "Wire", null), null);
  assert.deepEqual(inputs, ["Chairs Missing Wire"]);
});
