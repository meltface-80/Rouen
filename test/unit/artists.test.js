"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t6 (dev/design/artists.md §3): the Artists screen's list and routes. Every album artist (each album's lead
// artist, a leading "The" aside), with as many albums as the artist page counts for them (credited whole, or first),
// one of their covers, and the picture the album credits keep for the name. The library's credit identities are
// index.js's (applyCreditIdentities, splitCreditIntoArtists); here plain stand-ins with the same shape.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArtists } = require("../../lib/artists");
const { mountArtists, MAX_NAMES } = require("../../lib/routes/artists");
const { createCreditStore } = require("../../lib/credits/store");

const canon = (s) => { const c = String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); return c.startsWith("the ") ? c.slice(4) : c; };
const leadOf = (credit) => String(credit || "").split(/ & | feat\. |, /)[0];
const ensure = (al) => { if (al.cArtist === undefined) { al.cArtist = canon(al.subtitle); al.cFirst = canon(leadOf(al.subtitle)); } };
const A = (title, subtitle, image_key = null) => ({ title, subtitle, image_key });

const LIB = () => [
  A("Paranoid", "Black Sabbath", "k1"), A("Master of Reality", "Black Sabbath", "k2"),
  A("The Number of the Beast", "Iron Maiden", "k3"),
  A("Blue", "Joni Mitchell"), A("Court and Spark", "Joni Mitchell", "k5"),
  A("Bookends", "Simon & Garfunkel", "k6"),                // lead "Simon": theirs; "Simon & Garfunkel" isn't a lead
  A("Graceland", "Paul Simon"),
  A("Wish You Were Here", "The Pink Floyd", "k8"), A("Animals", "Pink Floyd", "k9"),   // one artist, "The" aside
  A("Kid A", "Radiohead feat. Someone", "k10"),            // lead Radiohead; the guest no name of their own
  A("坂本龍一 Best", "坂本龍一"),                               // no canonical form: no artist page, left out
  A("1999", "2Pac"), A("Joshua Tree", "U2"),
];

test("THE one: every lead artist once, A to Z ('The' aside), digits under # after Z, with their album counts and a cover", () => {
  const out = buildArtists(LIB(), { ensure, leadOf });
  assert.deepEqual(out.map((a) => [a.name, a.albums, a.cover, a.letter]), [
    ["Black Sabbath", 2, "k1", "B"],
    ["Iron Maiden", 1, "k3", "I"],
    ["Joni Mitchell", 2, "k5", "J"],
    ["Paul Simon", 1, null, "P"],
    ["The Pink Floyd", 2, "k8", "P"],   // one each way: the first seen
    ["Radiohead", 1, "k10", "R"],
    ["Simon", 1, "k6", "S"],
    ["U2", 1, null, "U"],
    ["2Pac", 1, null, "#"],
  ]);
});

test("an album credited whole to a name that is also someone's lead counts for that name too, as the artist page counts it", () => {
  const lib = [A("Bridge", "Simon & Garfunkel", "k1"), A("Duets", "Simon & Garfunkel & Friends", "k2"), A("Solo", "Simon & Garfunkel")];
  // The lead of "Simon & Garfunkel & Friends" is "Simon"; give one album a lead equal to another's whole credit.
  const lead = (c) => (c === "Simon & Garfunkel & Friends" ? "Simon & Garfunkel" : leadOf(c));
  const ens = (al) => { if (al.cArtist === undefined) { al.cArtist = canon(al.subtitle); al.cFirst = canon(lead(al.subtitle)); } };
  const out = buildArtists(lib, { ensure: ens, leadOf: lead });
  // "Simon": the lead of Bridge and Solo. "Simon & Garfunkel": the lead of Duets, and the whole credit of Bridge and Solo.
  assert.deepEqual(out.map((a) => [a.name, a.albums]), [["Simon", 2], ["Simon & Garfunkel", 3]]);
  const lib2 = lib.concat([A("Live", "Simon & Garfunkel")]).map((a) => ({ ...a }));
  // One more credited "Simon & Garfunkel", lead "Simon": counted for Simon (lead) and for "Simon & Garfunkel" (whole).
  const out2 = buildArtists(lib2, { ensure: ens, leadOf: lead });
  assert.deepEqual(out2.map((a) => [a.name, a.albums]), [["Simon", 3], ["Simon & Garfunkel", 4]]);
});

test("the name as most of their albums credit it", () => {
  const out = buildArtists([A("a", "The Beatles"), A("b", "Beatles"), A("c", "The Beatles")], { ensure, leadOf });
  assert.deepEqual(out.map((a) => [a.name, a.albums]), [["The Beatles", 3]]);
});

function rig({ ready = true, photos = new Map(), kept = {} } = {}) {
  const routes = new Map();
  const wanted = [];
  const lib = LIB();
  const r = { stamp: "1.0", reads: 0 };
  mountArtists({ get: (p, h) => routes.set(p, h) }, { ready: () => ready, stamp: () => r.stamp, albums: () => { r.reads++; return lib; }, ensure, leadOf, nameKey: canon,
    photos: () => photos, acts: { photo: (n) => kept[n] || null, want: (names) => wanted.push(...names.map((x) => x.name)) } });
  const get = (path, query = {}) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    routes.get(path)({ query }, res);
  });
  return Object.assign(r, { get, wanted, lib });
}

test("GET /api/artists: each artist with the picture kept for their name; nothing while the library is read", async () => {
  const r = rig({ photos: new Map([["iron maiden", "https://img/maiden.jpg"]]) });
  const { body } = await r.get("/api/artists");
  assert.equal(body.ready, true);
  const maiden = body.artists.find((a) => a.name === "Iron Maiden"), sabbath = body.artists.find((a) => a.name === "Black Sabbath");
  assert.deepEqual(maiden, { name: "Iron Maiden", albums: 1, cover: "k3", photo: "https://img/maiden.jpg", letter: "I" });
  assert.equal(sabbath.photo, null);
  assert.deepEqual((await rig({ ready: false }).get("/api/artists")).body, { artists: [], ready: false });
});

test("the review: the list made once for each library revision, the pictures read afresh each time", async () => {
  const photos = new Map();
  const r = rig({ photos });
  await r.get("/api/artists");
  photos.set("blur", "https://img/blur.jpg");
  r.lib.push(A("Parklife", "Blur", "k20"));
  const same = (await r.get("/api/artists")).body.artists;
  assert.equal(r.reads, 1, "THE one: the whole library split again for the same revision");
  assert.equal(same.find((a) => a.name === "Blur"), undefined, "an album added without the revision moving: not yet");
  r.stamp = "1.1";
  const moved = (await r.get("/api/artists")).body.artists;
  assert.equal(r.reads, 2);
  assert.deepEqual(moved.find((a) => a.name === "Blur"), { name: "Blur", albums: 1, cover: "k20", photo: "https://img/blur.jpg", letter: "B" });
});

test("GET /api/artists/photos: the pictures kept, and the names with none queued for a lookup, at most 60, each once", async () => {
  const r = rig({ kept: { "Iron Maiden": "https://img/maiden.jpg" } });
  const { body } = await r.get("/api/artists/photos", { n: ["Iron Maiden", "Black Sabbath", "Black Sabbath", "坂本龍一"] });
  assert.deepEqual(body.photos, { "Iron Maiden": "https://img/maiden.jpg", "Black Sabbath": null, "坂本龍一": null });
  assert.deepEqual(r.wanted, ["Black Sabbath"], "a name with no key is not queued; a kept one is not asked again");
  const many = Array.from({ length: 80 }, (_, i) => "Act " + i);
  const r2 = rig();
  const got = await r2.get("/api/artists/photos", { n: many });
  assert.equal(Object.keys(got.body.photos).length, MAX_NAMES);
  assert.equal((await r2.get("/api/artists/photos", { n: "Solo" })).body.photos.Solo, null, "one name, not a list");
});

let Database = null;
try { Database = require("better-sqlite3"); } catch (e) {
  // Optional in environments without the native build; the test skips rather than failing for a reason unrelated to the code.
}

test("the credit store's pictures in one read: the database's, and those kept in memory over them", { skip: !Database && "better-sqlite3 not built here" }, () => {
  const db = new Database(":memory:");
  let up = true;
  const store = createCreditStore({ db: () => (up ? db : null) });
  const act = (key, photo) => ({ key, name: key, mbid: null, photo, source: photo ? "wikidata" : null, at: 1, ok: true, members: null, wiki: null });
  store.saveAct(act("iron maiden", "https://img/maiden.jpg"));
  store.saveAct(act("black sabbath", null));
  assert.deepEqual([...store.photos()], [["iron maiden", "https://img/maiden.jpg"]]);
  up = false;   // the database gone: a picture found is kept in memory, and read with them
  store.saveAct(act("radiohead", "https://img/rh.jpg"));
  assert.deepEqual([...store.photos()].sort(), [["radiohead", "https://img/rh.jpg"]]);
  up = true;
  assert.deepEqual([...store.photos()].sort(), [["iron maiden", "https://img/maiden.jpg"], ["radiohead", "https://img/rh.jpg"]]);
});
