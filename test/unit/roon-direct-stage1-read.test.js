"use strict";
// ---------------------------------------------------------------------------
// Stage 1's read (lib/roon-direct/albums.js, dev/design/roon-native.md §10.2):
// the whole album list, against a fake Core over real TCP. What a read
// returns, that it is whole or a failure — never part of the library — and
// that every page is released and the query disposed whatever happens. The
// fake is not evidence of a real Core (§6); the owner's run is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { startFakeCore } = require("../lib/fake-roon-core");
const { readAlbums } = require("../../lib/roon-direct/albums");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY, fast, assertTidy } = require("../lib/roon-direct-fixtures");

const SOURCES = ["local", "tidal", "qobuz"];
/** n albums, the sources in turn: more than two pages of 100 at 250. */
const many = (n) => Array.from({ length: n }, (_, i) => ({ title: `Album ${i}`, artist: `Artist ${i % 7}`, source: SOURCES[i % 3], tracks: 1 }));

async function read(t, albums, faults, extra) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, faults });
  t.after(() => core.close());
  const out = await readAlbums(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast, extra));
  await core.idle();
  return { core, out };
}

test("the whole list, every page: each album's title, artist, ContentSource and cover key", async (t) => {
  const albums = many(250);
  albums[4].favorite = true;          // v1.9.27: hearted in Roon, for Rouen's profile (another profile's says no)
  albums[5].favorite = false;         // …and not, though another profile has it
  const { core, out } = await read(t, albums);
  assert.equal(out.ok, true, out.why);
  assert.equal(out.count, 250);
  assert.equal(out.pages, 3);
  assert.equal(out.albums.length, 250, "THE one: every album of the Count, not a page of them");
  const a = out.albums.find((x) => x.title === "Album 4");
  assert.deepEqual(a, { oid: "50004", title: "Album 4", artist: "Artist 4", contentSource: 128, imageKey: "img4",
    albumId: "7000000000004", favorite: true, format: null, genres: null }, "no format or genres sent: null, not guessed (v1.9.70-t5)");
  assert.equal(out.albums.find((x) => x.title === "Album 5").favorite, false, "THE one for v1.9.27: another profile's heart was taken as Rouen's");
  assert.deepEqual([...new Set(out.albums.map((x) => x.contentSource))].sort(), [1, 128, 256]);
  assert.deepEqual(core.rec.albumQueries, ["all"], "one query, with no criterion");
  assertTidy(core.rec, out);
});

test("each page's albums are let go once read: a whole library fits a graph capped below it", async (t) => {
  // 450 albums and their rows are 900 objects; a page of them, under 300.
  const { core, out } = await read(t, many(450), undefined, { maxObjects: 400 });
  assert.equal(out.ok, true, "THE one: the graph kept every page's albums — " + out.why);
  assert.equal(out.albums.length, 450);
  assertTidy(core.rec, out);
});

test("albums with no ContentSource: read, with none (the matching leaves them to Rouen)", async (t) => {
  const { out } = await read(t, LIBRARY, { noContentSource: true });
  assert.equal(out.ok, true, out.why);
  assert.ok(out.albums.every((a) => a.contentSource === null));
});

test("a page that comes short: a failure, and no albums at all", async (t) => {
  const { core, out } = await read(t, many(250), { shortAlbumPages: true });
  assert.equal(out.ok, false);
  assert.match(out.why, /^The album list came short: \d+ of 250 albums arrived/);
  assert.equal("albums" in out, false, "THE one: a partial read must never pass for the library");
  assertTidy(core.rec, out);
});

test("more albums than the Count (the library changed while it was read): a failure", async (t) => {
  const { core, out } = await read(t, many(150), { extraRow: true });
  assert.equal(out.ok, false, "THE one: a list that is not the Count's is not the library");
  assert.match(out.why, /^The album list did not match its count: 151 albums for 150\./);
  assertTidy(core.rec, out);
});

test("albums whose fields never come: a failure, every page still released", async (t) => {
  const { core, out } = await read(t, LIBRARY, { lateAlbumFieldsMs: 5000 });
  assert.equal(out.ok, false);
  assert.match(out.why, /came short/);
  assertTidy(core.rec, out);
});

test("a page the Core refuses: a failure that says so, and nothing released that was not held", async (t) => {
  const { core, out } = await read(t, many(150), { refuseAlbumPages: true });
  assert.equal(out.ok, false);
  assert.match(out.why, /^The Core refused page 0/);
  assert.deepEqual(core.rec.released, []);
  assertTidy(core.rec, out);
});

test("the album query refused: a failure, and the query never opened is not disposed", async (t) => {
  const { core, out } = await read(t, LIBRARY, { refuseAlbumQuery: "all" });
  assert.equal(out.ok, false);
  assert.match(out.why, /refused the unfiltered album query/);
  assert.deepEqual(core.rec.disposed, []);
});

test("a Core that refuses the connection: a failure naming why", async (t) => {
  const core = await startFakeCore({ brokerId: Buffer.alloc(16, 9), albums: LIBRARY });
  t.after(() => core.close());
  const out = await readAlbums(Object.assign({ host: "127.0.0.1", port: core.port, coreId: CORE_ID }, fast));
  assert.equal(out.ok, false);
  assert.match(out.why, /^The Core refused the connection/);
});

test("no core id from pairing: nothing is tried", async () => {
  const out = await readAlbums({ host: "127.0.0.1", coreId: "" });
  assert.equal(out.ok, false);
  assert.match(out.why, /no core id/);
});

test("a Count that never comes, from a Library that holds albums: a failure, never an empty library", async (t) => {
  const { core, out } = await read(t, LIBRARY, { sparseCount: true });
  assert.equal(out.ok, false, "THE one: a missing Count is not a library of nothing");
  assert.match(out.why, /^The album list's count never arrived, though the Library holds 8 albums\./);
  assertTidy(core.rec, out);
});

test("an album with an empty title: arrived once its ContentSource has", async (t) => {
  const { out } = await read(t, [{ title: "", artist: "Nobody", source: "qobuz", tracks: 1 }].concat(LIBRARY));
  assert.equal(out.ok, true, out.why);
  assert.equal(out.albums.length, 9);
});

test("an empty library: a whole read of nothing", async (t) => {
  const { core, out } = await read(t, []);
  assert.equal(out.ok, true, out.why);
  assert.deepEqual(out.albums, []);
  assertTidy(core.rec, out);
});

test("v1.9.70-t5 (shelf-focus.md §2): each album's AlbumFormat and genres as its page carries them, the AlbumFormat let go once read", async (t) => {
  const albums = many(150);
  albums[3].format = { file: 1, rate: 96000, bits: 24, channels: 2 };
  albums[3].genres = ["Rock", "Hard Rock"];
  albums[120].format = { file: 13, rate: 2822400, bits: 1, channels: 6, streaming: true };   // on the second page
  albums[120].genres = ["Rock"];
  const { core, out } = await read(t, albums, undefined, { maxObjects: 2000 });
  assert.equal(out.ok, true, out.why);
  const a3 = out.albums.find((x) => x.title === "Album 3"), a120 = out.albums.find((x) => x.title === "Album 120");
  assert.deepEqual(a3.format, { file: 1, rate: 96000, bits: 24, channels: 2, mqa: null, lossy: null, streaming: false, mixed: false, text: null });
  assert.deepEqual(a3.genres, ["Rock", "Hard Rock"]);
  assert.deepEqual([a120.format.file, a120.format.rate, a120.format.channels, a120.format.streaming], [13, 2822400, 6, true]);
  assert.deepEqual(a120.genres, ["Rock"], "a GenreLite sent once a connection, named again by reference on a later page");
  // THE one for v1.9.70-t7: the genres a DataList by reference, as the owner's server sends them; read, every album came with none.
  assert.deepEqual([out.albums.find((x) => x.title === "Album 4").format, out.albums.find((x) => x.title === "Album 4").genres], [null, null]);
  assertTidy(core.rec, out);
});

test("v1.9.70-t5: every album's AlbumFormat and genres' list let go with it — a whole library with both fits a graph capped below it", async (t) => {
  const albums = many(450).map((a, i) => Object.assign(a, { format: { file: 1, rate: 44100, bits: 16, channels: 2 }, genres: [i % 2 ? "Rock" : "Jazz"] }));
  // A page of 100 holds about 400 objects at once (its rows, albums, formats and genres' lists); kept, the 450 albums'
  // formats or lists alone would take it past 650.
  const { out } = await read(t, albums, undefined, { maxObjects: 650 });
  assert.equal(out.ok, true, "THE one: the AlbumFormats or the genres' lists were kept, one an album — " + out.why);
  assert.equal(out.albums.filter((a) => a.format && a.format.rate === 44100).length, 450);
  assert.deepEqual([out.albums[0].genres, out.albums[1].genres, out.albums[449].genres], [["Jazz"], ["Rock"], ["Rock"]]);
});

test("v1.9.70-t5 (the review): an AlbumFormat the server shares between albums, sent once a connection, is every one's format", async (t) => {
  const albums = many(150);
  for (const i of [2, 3, 120]) albums[i].format = { file: 1, rate: 96000, bits: 24, channels: 2 };   // one object, three albums, two pages
  albums[5].format = { file: 4, rate: 44100, bits: 16, channels: 2 };
  const { out } = await read(t, albums, { sharedFormats: true }, { maxObjects: 2000 });
  assert.equal(out.ok, true, out.why);
  const rateOf = (/** @type {string} */ title) => { const a = out.albums.find((x) => x.title === title); return a.format && a.format.rate; };
  assert.deepEqual(["Album 2", "Album 3", "Album 120", "Album 5"].map(rateOf), [96000, 96000, 96000, 44100],
    "THE one: the shared AlbumFormat, let go after the first album read, is still the later albums' format");
});
