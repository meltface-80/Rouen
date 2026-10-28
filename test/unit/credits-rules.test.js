"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t1 (dev/design/album-credits.md §2, §3): who played, sang, wrote
// and made an album, read from each source (lib/credits/rules.js). The tags'
// and the release's cases are Mandarin's CreditsTests (its bug list item 129),
// ported with its fixtures: the same albums, the same rows in the same order.
// Roon's are new: a Credit's Role as written, its Type where it has none and
// for a role no list names, and its spelling over the others'.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../lib/credits/rules");

// How Rouen compares artist names (canonArtist): case, punctuation and a leading "the" aside.
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const names = (rows) => rows.map((r) => r.name);
const row = (rows, n) => rows.find((r) => r.name === n);

const Jerome = "6b5b6a7e-6a8b-4a6c-9d5d-6b4d5a8c9e10", Natalie = "4a6c8e1f-2b3d-4e5f-8a9b-0c1d2e3f4a5b", Novi = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const artist = (id, name) => ({ id, name });
// A release as MusicBrainz answers it with its recordings', works' and artists' relations (Mandarin's fixture).
const RELEASE = {
  id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", title: "In My Tribe",
  "artist-credit": [{ name: "Ten Thousand Maniacs", joinphrase: "", artist: { id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", name: "Ten Thousand Maniacs" } }],
  relations: [
    { type: "producer", "target-type": "artist", attributes: [], artist: artist("p1", "Peter Asher") },
    { type: "design/illustration", "target-type": "artist", attributes: [], artist: artist(Jerome, "Jerome Augustyniak"), "target-credit": "" },
    { type: "amazon asin", "target-type": "url", url: { resource: "https://www.amazon.com/" } },
  ],
  media: [{ position: 1, tracks: [
    { position: 2, title: "Hey Jack Kerouac", recording: { id: "r2", relations: [
      { type: "instrument", attributes: ["viola", "guest"], artist: artist(Novi, "Novi Novog") },
      { type: "instrument", attributes: ["drums (drum set)"], artist: artist(Jerome, "Jerome Augustyniak") },
    ] } },
    { position: 1, title: "What's the Matter Here?", recording: { id: "r1", relations: [
      { type: "instrument", attributes: ["drums (drum set)"], artist: artist(Jerome, "Jerome Augustyniak") },
      { type: "vocal", attributes: ["lead vocals"], artist: artist(Natalie, "Natalie Merchant") },
      { type: "performance", "target-type": "work", attributes: [], work: { id: "w1", title: "What's the Matter Here?", relations: [
        { type: "composer", attributes: [], artist: artist(Natalie, "Natalie Merchant") },
        { type: "composer", attributes: [], artist: artist("rb", "Robert Buck") },
      ] } },
    ] } },
  ] }],
};
// music-metadata's native tags: a format's list of { id, value }; an ID3 credit list as an object of role → names.
const vorbis = (o) => ({ vorbis: Object.entries(o).flatMap(([id, vs]) => vs.map((value) => ({ id, value }))) });

test("the files' own tags name the players with their instruments, and those who made the record (Mandarin's case)", () => {
  const credits = [
    ...R.fromTags(1, vorbis({ PERFORMER: ["Jerome Augustyniak (drums, percussion)", "Natalie Merchant (lead vocals)", "Robert Buck (guitar)"],
      PRODUCER: ["Peter Asher"], COMPOSER: ["Natalie Merchant; Robert Buck"], TITLE: ["What's the Matter Here?"] })),
    ...R.fromTags(2, Object.assign(vorbis({ PERFORMER: ["Jerome Augustyniak (drums, percussion)", "Novi Novog (viola)"] }),
      { iTunes: [{ id: "----:com.apple.iTunes:ENGINEER", value: "George Massenburg" }], "ID3v2.4": [{ id: "TMCL", value: { piano: ["Dennis Drew"] } }] })),
  ];
  const rows = R.merge(credits, 2, key);
  // The players first (on every track before those on some), then the writers, then those who made the record.
  assert.deepEqual(names(rows), ["Jerome Augustyniak", "Dennis Drew", "Natalie Merchant", "Novi Novog", "Robert Buck", "George Massenburg", "Peter Asher"]);
  assert.deepEqual(row(rows, "Jerome Augustyniak").roles, ["Drums", "Percussion"]);
  assert.deepEqual(row(rows, "Jerome Augustyniak").tracks, [], "on every track: none listed");
  assert.deepEqual(row(rows, "Natalie Merchant").roles, ["Lead vocals", "Composer"]);
  assert.deepEqual(row(rows, "Natalie Merchant").tracks, [1]);
  assert.deepEqual(row(rows, "Dennis Drew").roles, ["Piano"]);
  assert.deepEqual(row(rows, "George Massenburg").roles, ["Engineer"]);
  assert.deepEqual(row(rows, "Robert Buck").roles, ["Guitar", "Composer"]);
  for (const r of rows) assert.equal(r.source, "tags");
  assert.ok(!credits.some((c) => c.name === "What's the Matter Here?"), "the title names no one");
});

test("a release names who played on each recording, who wrote each work, and who made the record (Mandarin's case)", () => {
  const rows = R.merge(R.fromRelease(RELEASE), 2, key);
  assert.deepEqual(names(rows), ["Jerome Augustyniak", "Natalie Merchant", "Novi Novog", "Robert Buck", "Peter Asher"]);
  // On both tracks (the tracks in their places, not as listed): every track. The sleeve after the playing.
  assert.deepEqual(row(rows, "Jerome Augustyniak").roles, ["Drums", "Design"]);
  assert.deepEqual(row(rows, "Jerome Augustyniak").tracks, []);
  assert.equal(row(rows, "Jerome Augustyniak").mbid, Jerome);
  assert.deepEqual([row(rows, "Natalie Merchant").roles, row(rows, "Natalie Merchant").tracks], [["Lead vocals", "Composer"], [1]]);
  // How it was played is left off ("guest"); the second track is the second, whatever the order MusicBrainz lists them in.
  assert.deepEqual([row(rows, "Novi Novog").roles, row(rows, "Novi Novog").tracks], [["Viola"], [2]]);
  // The release's own relations are the whole album's; a link names no one.
  assert.deepEqual([row(rows, "Peter Asher").roles, row(rows, "Peter Asher").tracks], [["Producer"], []]);
  for (const r of rows) assert.equal(r.source, "musicbrainz");
  assert.deepEqual(R.releaseActs(RELEASE), [{ name: "Ten Thousand Maniacs", mbid: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" }]);
});

test("tags and a release together: one row a name, with MusicBrainz's id and spelling (Mandarin's case)", () => {
  const rows = R.merge([...R.fromRelease(RELEASE), ...R.fromTags(2, vorbis({ PERFORMER: ["novi novog (Viola)", "Dennis Drew (keyboards)"] }))], 2, key);
  assert.equal(rows.filter((r) => r.key === "novi novog").length, 1);
  assert.deepEqual([row(rows, "Novi Novog").name, row(rows, "Novi Novog").mbid, row(rows, "Novi Novog").roles], ["Novi Novog", Novi, ["Viola"]],
    "the same role twice, whatever its case, once");
  assert.equal(row(rows, "Dennis Drew").source, "tags");
});

test("your server's credits: Role as written, its Type's name where it has none and its place for a role no list names; its spelling first", () => {
  const roon = [
    ...R.fromRoon(0, [{ role: "Producer", type: 6, name: "Peter Asher" }, { role: "", type: 6, name: "Sylvia Massy" }, { role: "Tape Op", type: 6, name: "Bill Price" }]),
    ...R.fromRoon(1, [{ role: "Lead Vocals", type: 4, name: "Natalie Merchant" }, { role: null, type: 1, name: "Robert Buck" },
      { role: "Recording Engineer", type: 6, name: "George Massenburg" }, { role: "x", type: 4, name: "" }]),
    ...R.fromRoon(2, [{ role: "Lead Vocals", type: 4, name: "Natalie Merchant" }]),
    // the album's producer, who also played on its first track: credited with the whole album, so on every track
    ...R.fromRoon(1, [{ role: "Piano", type: 4, name: "Peter Asher" }]),
  ];
  assert.ok(!roon.some((c) => c.name === ""), "a credit with no name is none");
  const rows = R.merge([...roon, ...R.fromTags(1, vorbis({ PERFORMER: ["NATALIE MERCHANT (lead vocals)"] }))], 2, key);
  assert.deepEqual(names(rows), ["Natalie Merchant", "Peter Asher", "Robert Buck", "Bill Price", "Sylvia Massy", "George Massenburg"]);
  assert.deepEqual([row(rows, "Peter Asher").roles, row(rows, "Peter Asher").tracks], [["Piano", "Producer"], []],
    "credited with the whole album as well as one track: on every track, none listed");
  assert.deepEqual([row(rows, "Natalie Merchant").roles, row(rows, "Natalie Merchant").source], [["Lead Vocals"], "roon"],
    "Roon's spelling over the tags'; the tag's \"lead vocals\" is the same role");
  assert.deepEqual(row(rows, "Robert Buck").roles, ["Composer"], "no Role: its Type's name, ranked with the writers");
  assert.deepEqual(row(rows, "Sylvia Massy").roles, ["Producer"], "Production with no Role: a producer");
  assert.equal(R.rank("Tape Op", 2), 2, "a role no list names takes Roon's Type's place (Production: those who made the record)");
  assert.equal(R.rank("Recording Engineer"), 2, "compared without regard to case");
  assert.deepEqual(row(rows, "George Massenburg").tracks, [1]);
});

test("rolesOf — the instrument and vocal ones by their attributes, how it was played left off; the producer's kinds; unknown types none", () => {
  assert.deepEqual(R.rolesOf("instrument", ["guest", "solo"]), ["Instruments"]);
  assert.deepEqual(R.rolesOf("vocal", []), ["Vocals"]);
  assert.deepEqual(R.rolesOf("instrument", ["electric guitar", "bass guitar", "electric guitar"]), ["Electric guitar", "Bass guitar"]);
  assert.deepEqual(R.rolesOf("producer", ["executive"]), ["Executive producer"]);
  assert.deepEqual(R.rolesOf("producer", ["co"]), ["Co-producer"]);
  assert.deepEqual(R.rolesOf("mastering", []), ["Mastering"]);
  assert.deepEqual(R.rolesOf("tribute", []), []);
});

test("fromTags — a TXXX name, ID3's lists, a name list split on ; and /, and a PERFORMER without brackets", () => {
  const got = R.fromTags(3, { "ID3v2.3": [{ id: "TXXX:PRODUCER", value: "A / B" }, { id: "TIPL", value: { mix: ["C"], producer: ["D", "E"] } },
    { id: "TCOM", value: "F" }, { id: "TIT2", value: "A song" }], vorbis: [{ id: "PERFORMER", value: "G" }, { id: "performer", value: "H (oboe)" }] });
  assert.deepEqual(got.map((c) => [c.name, c.role, c.track]), [
    ["A", "Producer", 3], ["B", "Producer", 3], ["C", "Mix", 3], ["D", "Producer", 3], ["E", "Producer", 3], ["F", "Composer", 3], ["G", "Performer", 3], ["H", "Oboe", 3]]);
  assert.deepEqual(R.fromTags(1, null), []);
});
