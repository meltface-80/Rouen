"use strict";
// lib/routes/release-debug.js (v1.9.67-t8): a random hundred of the library, each with what the Shelf shows of its
// catalogue number and kinds and what every source said; a search instead of a sample; the whole library asked for.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountReleaseDebug } = require("../../lib/routes/release-debug");
const { createReleaseFacts } = require("../../lib/release-facts");

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function rig(o = {}) {
  const facts = createReleaseFacts();
  facts.set(norm("Untrue|Burial"), { catno: "HDBCD002", type: "album" }, "file");
  facts.set(norm("Untrue|Burial"), { catno: "HDB 002", types: [] }, "discogs");
  facts.set(norm("Kid A|Radiohead"), { catno: null, types: ["album", "live"] }, "roon");
  const albums = Array.from({ length: o.n || 300 }, (_, i) => ({ title: i === 0 ? "Untrue" : i === 1 ? "Kid A" : "Album " + i, subtitle: i === 0 ? "Burial" : i === 1 ? "Radiohead" : "Artist " + (i % 7) }));
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; } };
  let seed = 7;
  mountReleaseDebug(app, { ready: () => o.ready !== false, albums: () => albums, keysOf: (al) => [norm(al.title + "|" + al.subtitle)], labelOf: (al) => (al.title === "Untrue" ? "Hyperdub" : null), facts,
    random: () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; }, discogs: o.discogs, roon: o.roon });
  return async (query) => {
    const res = { code: 200, headers: {}, body: null, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["GET /api/debug/release-facts"]({ query: query || {} }, res);
    return res;
  };
}

test("THE one: a random hundred by default, each with what is shown and what every source said", async () => {
  const r = await rig()();
  const b = r.body;
  assert.deepEqual([b.albums, b.sample, b.random, b.q], [300, 100, true, null]);
  assert.equal(new Set(b.rows.map((x) => x.title)).size, 100, "an album twice in the sample");
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.deepEqual(b.held, { albums: 2, withCatno: 1, withKinds: 2, catno: { file: 1, discogs: 1 }, kinds: { file: 1, roon: 1 } });
  const again = (await rig()()).body.rows.map((x) => x.title);
  assert.deepEqual(again, b.rows.map((x) => x.title), "the same seed gives the same sample (the shuffle is the test's random)");
});

test("a search: every match, in order, with the sources before the ranking; the whole library with n=0; n capped at 1000", async () => {
  const call = rig();
  const u = (await call({ q: "BURIAL" })).body;
  assert.deepEqual([u.sample, u.random, u.q, u.matched], [1, false, "burial", 1]);
  assert.deepEqual(u.rows[0], { title: "Untrue", artist: "Burial", label: "Hyperdub", key: norm("Untrue|Burial"),
    shown: { catno: "HDBCD002", types: ["album"], src: "file" }, sources: { file: { catno: "HDBCD002", types: ["album"] }, discogs: { catno: "HDB 002", types: [] } } });
  assert.deepEqual(u.inSample, { withNumber: 1, withKinds: 1, withNeither: 0 });
  const byLabel = (await call({ q: "hyperdub" })).body;
  assert.equal(byLabel.sample, 1, "the label searched too");
  const kid = (await call({ q: "kid a" })).body.rows[0];
  assert.deepEqual([kid.shown, kid.sources], [{ catno: null, types: ["album", "live"], src: "roon" }, { roon: { catno: null, types: ["album", "live"] } }]);
  const none = (await call({ q: "album 5" })).body;
  assert.ok(none.sample >= 1 && none.rows.every((x) => x.shown === null && Object.keys(x.sources).length === 0), "an album no source names: shown null, no sources");
  const whole = (await call({ n: "0" })).body;
  assert.deepEqual([whole.sample, whole.random, whole.n], [300, false, null]);
  const capped = (await call({ n: "5000" })).body;
  assert.deepEqual([capped.sample, capped.random], [300, false], "capped at 1000, then everything (fewer than that here): not a sample");
  const firstN = (await call({ q: "artist 3", n: "5" })).body;
  assert.deepEqual([firstN.sample, firstN.random, firstN.n], [5, false, 5], "a search takes the first n matches");
  assert.ok(firstN.matched > 5, "how many matched, said");
  assert.deepEqual(firstN.rows.map((x) => x.title), Array.from({ length: 300 }, (_, i) => i).filter((i) => i > 1 && i % 7 === 3).slice(0, 5).map((i) => "Album " + i), "in the library's order");
  assert.equal((await rig({ n: 1500 })({ n: "5000" })).body.sample, 1000);
  assert.equal((await call({ n: "abc" })).body.sample, 100);
});

test("503 until the library index is built: an empty answer would read as an empty library (the review)", async () => {
  const r = await rig({ ready: false })();
  assert.deepEqual([r.code, r.body], [503, { error: "The library index is not built yet" }]);
});

test("why a source has given nothing, said plainly: Discogs' token and Labels, how many asked; the server's walk (v1.9.68-t3)", async () => {
  const say = async (o) => (await rig(Object.assign({ n: 3 }, o))({})).body.why;
  assert.match((await say({ discogs: () => ({ token: false, labelsOn: true, asked: 0, toAsk: 13000 }) })).discogs.says, /No Discogs token/);
  assert.match((await say({ discogs: () => ({ token: true, labelsOn: false, asked: 0, toAsk: 13000 }) })).discogs.says, /Labels is off/);
  const going = (await say({ discogs: () => ({ token: true, labelsOn: true, asked: 600, toAsk: 12400 }) })).discogs;
  assert.deepEqual([going.asked, going.toAsk], [600, 12400]);
  assert.match(going.says, /^600 albums asked so far; 12,400 still to ask/);
  assert.equal((await say({})).discogs, null, "no state given: none said");
  assert.match((await say({})).roon.says, /Native mode isn't running/);
  const cut = (await say({ roon: () => ({ running: false, last: { whole: false, why: "refused 3 times (Busy)", read: 400, albums: 13000 }, pass: { at: 400, albums: 13000 } }) })).roon;
  assert.equal(cut.says, "Cut short: refused 3 times (Busy); going on where it stopped.");
  assert.deepEqual(cut.pass, { at: 400, albums: 13000 });
});
