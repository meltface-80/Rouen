"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t5 (dev/design/shelf-focus.md §2–§3): the Shelf's genres, formats and favourites from Roon itself, with
// native mode's library in force — the owner: "Genres must come from Roon using reverse code". Each album record
// carries its server album (lib/roon-direct/library.js, not enumerable); the Shelf's answer (lib/shelf-routes.js)
// takes the genres from it, sends its format facts and favourite, and says how many albums carried each.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountShelf } = require("../../lib/shelf-routes");
const { nativeView } = require("../../lib/roon-direct/library");
const { adopt } = require("../../lib/roon-direct/album-facts");

const makeRecord = (it, offset) => ({ offset, title: it.title, subtitle: it.subtitle, image_key: it.image_key,
  nTitle: it.title.toLowerCase(), nArtist: it.subtitle.toLowerCase() });
const roon = (title, artist, o = {}) => Object.assign({ oid: "1", title, artist, contentSource: 1, imageKey: null, albumId: "9", favorite: false,
  format: null, genres: null }, o);
const PUB = { albums: [makeRecord({ title: "Paranoid", subtitle: "Black Sabbath", image_key: "p" }, 0)], count: 1 };

test("each native record carries its server album, not enumerable: read live, never saved with the snapshot", () => {
  const a = roon("Paranoid", "Black Sabbath", { genres: ["Rock", "Heavy Metal"], favorite: true });
  const v = nativeView([a], PUB, makeRecord);
  const rec = /** @type {any} */ (v.albums[0]);
  assert.equal(rec.roon, a);
  assert.ok(!Object.keys(rec).includes("roon"));
  assert.ok(!JSON.stringify(rec).includes("Heavy Metal"), "kept out of anything the record is saved as");
});

function shelfWith(records, genresOf, key = () => "k", heartOf, whose) {
  const routes = new Map();
  mountShelf({ get: (p, h) => routes.set(p, h) }, { publicDir: "/p", canServe: () => true, ensureIndex: async () => {}, isIndexBuilt: () => true,
    stateKey: key, libraryRev: () => "1", libraryView: () => records, genresOf: genresOf || ((al) => al.g || []), firstOf: (al) => al.subtitle.toLowerCase(),
    yearOf: () => null, heartOf, whose });
  return (query = {}) => new Promise((resolve) => { routes.get("/api/shelf/albums")({ query }, { status() { return this; }, json: resolve }); });
}

test("THE one: Roon's own genres, formats and favourites on the Shelf, with how many albums carried each", async () => {
  const hearted = roon("Paranoid", "Black Sabbath", { genres: ["Rock", "Heavy Metal"], favorite: true,
    format: { file: 1, rate: 96000, bits: 24, channels: 2, mqa: null, lossy: null, streaming: false, mixed: false, text: null } });
  const plain = roon("Blue", "Joni Mitchell", { genres: ["Folk"] });
  const v = nativeView([hearted, plain], { albums: [], count: 1 }, makeRecord);
  let factsRev = 0;   // stage1.js's, in index.js's state key
  const get = shelfWith(v.albums, () => ["From the official API"], () => "k." + factsRev);
  const j = await get();
  assert.deepEqual(j.genres.map((g) => g.name).sort(), ["Folk", "Heavy Metal", "Rock"], "Roon's genres, not the official API's");
  const p = j.albums.find((a) => a.t === "Paranoid"), b = j.albums.find((a) => a.t === "Blue");
  assert.deepEqual([p.fx, p.fv, b.fx, b.fv], [[1, 96000, 24, 2, null, null, 0, 0], 1, null, 0]);
  assert.deepEqual(j.facts, { native: true, albums: 2, withFormat: 1, withGenres: 2, favourites: 1 });
  // A heart changed where the native list keeps it, and counted (stage1.js): the next answer says so.
  plain.favorite = true;
  factsRev++;
  assert.equal((await get()).albums.find((a) => a.t === "Blue").fv, 1, "never a copy gone stale");
});

// P2 (2.0.7-t4, profiles.md §5): the Shelf's hearts are the asking device's Roon profile's, and the state key holds
// whose they are (index.js), so one device's answer is never another's.
test("P2: the Shelf's favourites are the asking device's Roon profile's, and each profile's answer is kept", async () => {
  const a = roon("Paranoid", "Black Sabbath", { favorite: true, favBy: { cafebabe: true, deadbeef: false } });
  const b = roon("Blue", "Joni Mitchell", { favorite: false, favBy: { cafebabe: false, deadbeef: true } });
  const v = nativeView([a, b], { albums: [], count: 1 }, makeRecord);
  let acting = "deadbeef", rev = 0, built = 0;
  // As index.js wires it: the state key holds factsRev and whose hearts; heartOf as stage1.js's.
  // heartOf is asked only when an answer is made: how many times one was made.
  const get = shelfWith(v.albums, null, () => "k." + rev + "." + acting,
    (r) => { built++; return acting === "cafebabe" ? r.favorite : r.favBy[acting] === true; }, () => acting);
  let j = await get();
  assert.deepEqual([j.albums.find((x) => x.t === "Paranoid").fv, j.albums.find((x) => x.t === "Blue").fv], [0, 1],
    "THE one: the chosen profile's hearts shown to a linked device");
  b.favBy.deadbeef = false;
  rev++;   // the heart counted (stage1.js), as factsRev moves
  j = await get();
  assert.equal(j.facts.favourites, 0, "the favourites counted the chosen profile's");
  acting = "cafebabe";
  j = await get();
  assert.deepEqual([j.albums.find((x) => x.t === "Paranoid").fv, j.albums.find((x) => x.t === "Blue").fv, j.facts.favourites], [1, 0, 1]);
  // The review: devices on two profiles, asking in turn, are each answered from their own kept answer.
  const was = built;
  for (const p of ["deadbeef", "cafebabe", "deadbeef", "cafebabe"]) { acting = p; await get(); }
  assert.equal(built, was, "each profile's answer thrown away by the other's");
  // A read that gives another profile's heart moved is a change the screens must hear of (album-facts.js).
  const held = [roon("Blue", "Joni Mitchell", { favBy: { deadbeef: false } })];
  assert.equal(adopt(held, [roon("Blue", "Joni Mitchell", { favBy: { deadbeef: true } })]), true, "another profile's heart not a change");
  assert.equal(adopt(held, [roon("Blue", "Joni Mitchell", { favBy: { deadbeef: true } })]), false);
  assert.equal(held[0].favBy.deadbeef, true);
});

test("the official list's records (native mode off): its own genres, no format or favourite, and said so", async () => {
  const get = shelfWith([{ offset: 1, title: "Blue", subtitle: "Joni Mitchell", image_key: null, g: ["Folk"] }]);
  const j = await get();
  assert.deepEqual([j.genres.map((g) => g.name), j.albums[0].fx, j.albums[0].fv], [["Folk"], null, 0]);
  assert.equal(j.facts.native, false);
});

test("the review: genres sent empty are no genres in the tally; the facts are in the signature, so a page holding the shelf is told they moved", async () => {
  const rec = { offset: 1, title: "Blue", subtitle: "Joni Mitchell", image_key: null, g: [] };
  const native = Object.defineProperty(Object.assign({}, rec), "roon", { value: roon("Blue", "Joni Mitchell", { genres: [] }) });
  const records = [native];
  let key = "k1";
  const get = shelfWith(records, undefined, () => key);
  const j = await get();
  assert.deepEqual([j.facts.native, j.facts.withGenres], [true, 0], "THE one: the page says the server sent no genres");
  records.splice(0, 1, rec); key = "k2";   // native mode off: the same shelf drawn, from the official list
  const k = await get({ sig: j.sig });
  assert.notEqual(k.same, true, "the page is sent the new facts, not told the shelf is the same");
  assert.equal(k.facts.native, false);
});
