"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t1 (lib/credits/files.js, dev/design/album-credits.md §2.2): an
// album's own files read for their credits — every audio file in the folder
// the label scan kept, in the album's order (disc, track, then name), the
// release id most of them carry, and an unreadable file counted, not fatal.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAlbumFiles, releaseOf } = require("../../lib/credits/files");

const A = "11111111-2222-4333-8444-555555555555", B = "99999999-2222-4333-8444-555555555555";
const META = {
  "b.flac": { common: { disk: { no: 1 }, track: { no: 2 }, musicbrainz_albumid: A }, native: { vorbis: [{ id: "PERFORMER", value: "X (drums)" }] } },
  "a.flac": { common: { disk: { no: 2 }, track: { no: 1 }, musicbrainz_albumid: A }, native: {} },
  "c.flac": { common: { disk: { no: 1 }, track: { no: 1 }, musicbrainz_albumid: B }, native: {} },
};

test("THE one: the album's files in its order, the release most of them carry; a file that can't be read is counted", async () => {
  const files = createAlbumFiles({ dirOf: () => "/music/Anthrax/Kings", readdir: () => ["c.flac", "cover.jpg", "b.flac", "broken.flac", "a.flac"],
    parseFile: async (f) => { const m = META[f.split("/").pop()]; if (!m) throw new Error("unreadable"); return m; } });
  const got = await files.read("Kings Among Scotland", "Anthrax");
  assert.deepEqual(got.files.map((f) => [f.name, f.disc, f.track]), [["c.flac", 1, 1], ["b.flac", 1, 2], ["a.flac", 2, 1]], "disc 1's, then disc 2's");
  assert.deepEqual([got.unread, got.why, releaseOf(got.files)], [1, null, A]);
  assert.equal(got.files[1].native.vorbis[0].value, "X (drums)");
});

test("not an album in /music, and a folder that can't be read, say so", async () => {
  const none = await createAlbumFiles({ dirOf: () => null, readdir: () => [], parseFile: async () => ({}) }).read("X", "Y");
  assert.deepEqual([none.files, none.why], [[], "Not one of the albums found in /music."]);
  const gone = await createAlbumFiles({ dirOf: () => "/gone", readdir: () => { throw new Error("ENOENT"); }, parseFile: async () => ({}) }).read("X", "Y");
  assert.match(gone.why, /couldn't be read: ENOENT/);
  assert.equal(releaseOf([]), null);
});

test("a file that can't be read leaves its track's number empty: the later tracks keep theirs (the review)", async () => {
  const meta = (disc, track) => ({ common: { disk: { no: disc }, track: { no: track } }, native: { vorbis: [{ id: "PRODUCER", value: "P" + disc + "." + track }] } });
  const M = { "01.flac": meta(1, 1), "03.flac": meta(1, 3), "d2-01.flac": meta(2, 1), "notrack.flac": { common: {}, native: {} } };
  const got = await createAlbumFiles({ dirOf: () => "/m", readdir: () => Object.keys(M).concat(["02.flac"]),
    parseFile: async (f) => { const m = M[f.split("/").pop()]; if (!m) throw new Error("bad"); return m; } }).read("X", "Y");
  assert.deepEqual(got.files.map((f) => [f.name, f.number]), [["01.flac", 1], ["03.flac", 3], ["notrack.flac", 5], ["d2-01.flac", 4]],
    "02 unreadable: 03 is still track 3; disc 2's first is the fourth (disc 1 ran to 3); one with no track tag after them all, not on 3");
  assert.equal(got.unread, 1);
});
