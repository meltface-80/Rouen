"use strict";
// ---------------------------------------------------------------------------
// N2b-1 (lib/roon-direct/find.js, v1.9.32, native-remote.md §9.1): the
// server's own search, read only, for albums Rouen would add to the library —
// end to end over the link against the fake server, which sends each object
// once a connection as the owner's does. The fake is not evidence that the
// real server answers this way; N2b-1 is how that is found out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");
const { ALLOWED } = require("../../lib/roon-direct/methods");
const { createFinder } = require("../../lib/roon-direct/find");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const CATALOG = [
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "tidal" },
  { title: "Homogenic", artist: "Björk", source: "qobuz" },
  { title: "Kid A", artist: "Radiohead", source: "tidal", noAlbumId: true },
];

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const live = Object.assign({ sentOnce: true }, faults);   // the fake reads it as it goes: a test may change it
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, catalog: CATALOG, faults: live });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.32",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(s.gen + ":" + r.ok + (r.ok ? "" : " " + r.why)); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1, link, reads, albums, live };
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1, link, reads, albums, live };
}
const ASK = [
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" },   // on TIDAL, not in the library
  { title: "Mezzanine", artist: "Massive Attack", service: "tidal" },                 // in the library: sent once, a bare reference now
  { title: "Homogenic", artist: "Björk", service: "tidal" },                          // on Qobuz, not TIDAL
  { title: "Kid A", artist: "Radiohead", service: "tidal" },                          // on TIDAL, with no AlbumId
  { title: "Nothing Like It", artist: "Nobody", service: "qobuz" },                   // nowhere
];

test("THE one for N2b-1: the server's search, asked of each album, says found, in the library, elsewhere, no id or not found", async (t) => {
  const w = await rig(t);
  const out = await w.s1.finder.find(ASK);
  assert.ok(!("error" in out), JSON.stringify(out));
  assert.deepEqual(out.findings.map((f) => f.verdict), ["found", "in-library", "other-source", "no-id", "not-found"],
    JSON.stringify(out.findings.map((f) => [f.title, f.verdict, f.why || ""])));
  assert.deepEqual(out.findings[2].hits, [{ title: "Homogenic", artist: "Björk", source: "Qobuz", inLibrary: false }]);
  // As the profile chosen, with the title and artist as its terms; every result let go, once.
  assert.deepEqual(w.core.rec.searches.map((x) => [x.terms, x.profile]), ASK.map((a) => [`${a.title} ${a.artist}`, "cafebabe"]));
  // Sent without waiting for an answer: the fake reads it a moment later.
  assert.ok(await until(() => w.core.rec.searchDisposed.length >= ASK.length), "a search result was not let go");
  assert.equal(w.core.rec.searchDisposed.length, ASK.length);
  assert.equal(new Set(w.core.rec.searchDisposed).size, ASK.length, "a search result was let go twice");
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "called off the allowlist: " + sig);
  // Nothing written: no heart, no add.
  assert.deepEqual(w.core.rec.hearts, []);
  assert.ok(!w.core.rec.signatures.some((s) => /AddToLibrary|FavoriteOrBan/.test(s)));
});

test("an album the search sends is kept: added to the library later, the next read on that connection still reads it whole", async (t) => {
  const w = await rig(t);
  await w.s1.finder.find(ASK.slice(0, 2));
  // Added (in Roon's app): the same object, so the next read is given its row alone, the server having sent it once.
  w.albums.push({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "tidal", tracks: 0, oid: 60000n });
  w.s1.linkUp();
  assert.ok(await until(() => w.reads.length === 2));
  assert.deepEqual(w.reads, ["1:true", "1:true"]);
  assert.ok(w.s1.albums().some((a) => a.title === "Selected Ambient Works 85-92"), "the added album was not read");
});

test("a library album the server sent again with one field, after the read let it go, is still known by what the read had", async (t) => {
  const w = await rig(t);
  w.core.favoriteElsewhere(2, true);   // Mezzanine's IsFavorite alone, pushed anew into the graph
  assert.ok(await until(() => w.link.session().graph.get(50002n)), "the favourite was never pushed");
  const out = await w.s1.finder.find([ASK[1]]);
  assert.equal(out.findings[0].verdict, "in-library", JSON.stringify(out.findings[0]));
  assert.deepEqual(out.findings[0].hits.map((h) => h.title), ["Mezzanine"]);
});

test("an album's versions, sent once a connection, are kept: the same album asked about twice is found twice", async (t) => {
  const w = await rig(t, { versions: true });
  const first = await w.s1.finder.find(ASK.slice(0, 1));
  const second = await w.s1.finder.find(ASK.slice(0, 1));
  assert.deepEqual([first.findings[0].verdict, second.findings[0].verdict], ["found", "found"], JSON.stringify(second.findings[0]));
});

test("a search that finds nothing, its empty lists left out, is not found rather than waited on", async (t) => {
  const w = await rig(t, { emptyLeftOut: true });
  const out = await w.s1.finder.find([ASK[4]]);
  assert.equal(out.findings[0].verdict, "not-found", JSON.stringify(out.findings[0]));
});

test("a connection whose library has not been read is not searched: its library albums could not be told", async () => {
  const s = { g: { uncertain: () => false, call: () => { throw new Error("searched"); } } };
  const finder = createFinder({ link: { session: () => s }, inTurn: (fn) => fn(), keyOf, profile: () => null, known: () => null, off: () => null });
  const out = await finder.find(ASK.slice(0, 1));
  assert.equal(out.findings[0].verdict, "error");
  assert.match(out.findings[0].why, /library hasn't been read on this connection/);
});

test("a check pressed as a new connection's library read begins is refused: were that read to fail, its library albums could not be told", async (t) => {
  const w = await rig(t);
  const first = w.link.session();
  w.live.silentPages = true;   // the next read gets no pages, and fails, having seen nothing
  w.link.cycle("the nightly reconnect");
  assert.ok(await until(() => w.link.session() && w.link.session() !== first), "no new connection");
  assert.deepEqual(w.s1.finder.start(ASK.slice(1, 2)),
    { error: "Your library hasn't been read on this connection to your server yet; check again in a minute.", status: 409 });
  assert.ok(await until(() => w.reads.length === 2), "the second read never ended");
  assert.equal(w.core.rec.searches.length, 0);
});

test("a library album renamed since the read is judged by its name now: what the graph has is laid over what the read had", async (t) => {
  const w = await rig(t);
  w.albums[2].title = "Mezzanine (Remastered)";
  w.core.renamed(2);   // its Title alone
  assert.ok(await until(() => w.link.session().graph.get(50002n)), "the new title was never pushed");
  const out = await w.s1.finder.find([{ title: "Mezzanine (Remastered)", artist: "Massive Attack", service: "tidal" }]);
  assert.equal(out.findings[0].verdict, "in-library", JSON.stringify(out.findings[0]));
});

test("an album list sent as a query whose items are still to come is waited for, not read as all there is", async (t) => {
  const w = await rig(t, { shortQuery: true });
  const out = await w.s1.finder.find(ASK.slice(0, 1));
  assert.equal(out.findings[0].verdict, "incomplete", JSON.stringify(out.findings[0]));
});

test("a result of a type the server never declared is waited for, not read as empty", async () => {
  const { ObjectGraph } = require("../../lib/roon-direct/objects");
  const { BinaryWriter } = require("../../lib/roon-direct/wire");
  const graph = new ObjectGraph();
  graph.ingest({ isResponse: false, cmd: 3, body: new BinaryWriter().long(95000n).flexInt(77).flexInt(0).toBuffer() });
  assert.equal(graph.get(95000n).loaded, false, "an object of an unknown type taken as loaded");
});

test("a result whose pieces never all arrive is reported so, and still let go", async (t) => {
  const w = await rig(t, { incompleteSearch: true });
  const out = await w.s1.finder.find(ASK.slice(0, 1));
  assert.equal(out.findings[0].verdict, "incomplete");
  // With what had arrived (§9.1): the top album came, the album list never did.
  assert.deepEqual(out.findings[0].hits, [{ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "TIDAL", inLibrary: false }]);
  assert.ok(await until(() => w.core.rec.searchDisposed.length === 1), "an incomplete result was not let go");
});

test("objects pushed after the answer are waited for", async (t) => {
  const w = await rig(t, { lateSearch: true });
  const out = await w.s1.finder.find(ASK.slice(0, 2));
  assert.deepEqual(out.findings.map((f) => f.verdict), ["found", "in-library"]);
});

test("refused: that album says why, and the next is still asked", async (t) => {
  const w = await rig(t, { refuseSearch: true });
  const out = await w.s1.finder.find(ASK.slice(0, 2));
  assert.deepEqual(out.findings.map((f) => f.verdict), ["error", "error"]);
  assert.match(out.findings[0].why, /refused the search \("Refused"\)/);
  assert.equal(w.core.rec.searches.length, 2);
});

test("native mode off, or the library not read yet: no search at all", async (t) => {
  const w = await rig(t, {}, { off: true });
  const out = await w.s1.finder.find(ASK.slice(0, 1));
  assert.deepEqual(out, { error: "Native mode is off.", status: 409 });
  assert.equal(w.core.rec.searches.length, 0);
});

test("one check at a time", async (t) => {
  const w = await rig(t, { lateSearch: true });
  const first = w.s1.finder.find(ASK.slice(0, 1));
  const second = await w.s1.finder.find(ASK.slice(0, 1));
  assert.deepEqual(second, { error: "A check is already running.", status: 409 });
  assert.equal((await first).findings[0].verdict, "found");
});

test("a check begun runs on its own: followed as it goes, one at a time, its findings and what a check takes given", async (t) => {
  const w = await rig(t, { lateSearch: true });
  assert.deepEqual(w.s1.finder.start(ASK.slice(0, 2)), { running: true, total: 2 });
  assert.deepEqual(w.s1.finder.start(ASK.slice(0, 1)), { error: "A check is already running.", status: 409 });
  const now = w.s1.finder.progress();
  assert.deepEqual([now.running, now.total, now.max, now.services], [true, 2, 20, { tidal: "TIDAL", qobuz: "Qobuz" }]);
  assert.ok(await until(() => !w.s1.finder.progress().running), "the check never finished");
  const done = w.s1.finder.progress();
  assert.deepEqual([done.error, done.findings.map((f) => f.verdict)], [null, ["found", "in-library"]]);
});

test("a check that throws is stopped, and says so, rather than taking the server down", async () => {
  const s = { g: { uncertain: () => false } };
  const finder = createFinder({ link: { session: () => s }, inTurn: () => { throw new Error("turn lost"); }, keyOf, profile: () => null, known: () => new Map(), off: () => null });
  assert.deepEqual(finder.start(ASK.slice(0, 1)), { running: true, total: 1 });
  assert.ok(await until(() => !finder.progress().running));
  assert.equal(finder.progress().error, "The check stopped: turn lost");
});

test("no check on a connection whose copy of what the server sent is half full: what a search sends stays, and a full one fails the library read", async () => {
  const s = { g: { uncertain: () => false }, graph: { objects: { size: 100001 }, maxObjects: 200000 } };
  const finder = createFinder({ link: { session: () => s }, inTurn: (fn) => fn(), keyOf, profile: () => null, known: () => new Map(), off: () => null });
  const out = finder.start(ASK.slice(0, 1));
  assert.equal(out.status, 409);
  assert.match(out.error, /half full/);
  assert.equal(finder.progress().running, false);
});
