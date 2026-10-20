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

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const CATALOG = [
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "tidal" },
  { title: "Homogenic", artist: "Björk", source: "qobuz" },
  { title: "Kid A", artist: "Radiohead", source: "tidal", noAlbumId: true },
];

async function rig(t, faults, o = {}) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.map((a) => Object.assign({}, a)),
    catalog: CATALOG, faults: Object.assign({ sentOnce: true }, faults) });
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
  if (o.off) return { core, s1, link, reads };
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1, link, reads };
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

test("an album the search sends is kept, and the library read on the same connection still reads whole after a check", async (t) => {
  const w = await rig(t);
  await w.s1.finder.find(ASK.slice(0, 2));
  assert.ok(w.link.session().graph.get(60000n), "the search's album was let go: later in the library, it would never be sent again");
  w.s1.linkUp();
  assert.ok(await until(() => w.reads.length === 2));
  assert.deepEqual(w.reads, ["1:true", "1:true"]);
});

test("a result whose pieces never all arrive is reported so, and still let go", async (t) => {
  const w = await rig(t, { incompleteSearch: true });
  const out = await w.s1.finder.find(ASK.slice(0, 1));
  assert.equal(out.findings[0].verdict, "incomplete");
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
