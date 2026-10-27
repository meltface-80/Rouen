"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t1 (lib/roon-direct/credits.js, dev/design/album-credits.md §2.1):
// an album's credits as your server holds them — the album-wide ones from its
// AlbumEditInfo (the call t3 proved), every track's from
// Library::GetTrackEditInfo(AlbumBase), new to the allowlist. End to end
// against the fake server (test/lib/fake-roon-edit-info.js), which reads the
// album argument strictly and pushes each performer as a PerformerLite before
// the answer that names it. The fakes are not evidence of the real server:
// the owner's run of /api/debug/album-credits is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
// Kind of Blue: a producer for the whole album; two tracks, Miles on both, Coltrane on the second, a composer with no
// Role; one performer pushed without a name.
const EDIT = [{
  type: 0, labels: ["Columbia"],
  credits: [{ role: "Producer", type: 6, name: "Teo Macero" }],
  trackCredits: [
    [{ role: "Trumpet", type: 4, name: "Miles Davis" }, { type: 1, name: "Bill Evans" }],
    [{ role: "Trumpet", type: 4, name: "Miles Davis" }, { role: "Tenor Saxophone", type: 4, name: "John Coltrane" }, { role: "Piano", type: 4, name: "Nobody" }],
  ],
}];

async function rig(t, faults = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, editInfo: EDIT, faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.70-t1",
    records: () => [], keyOf, link, minGapMs: 0, roonRelease: (records) => ({ kept: records.length }),
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1 };
}

test("THE one: the album's credits and every track's, in the album's order, each named by the PerformerLite the server sent", async (t) => {
  const w = await rig(t, { unnamedPerformer: "Nobody" });
  const got = await w.s1.credits.album("Kind of Blue", "Miles Davis");
  assert.equal(got.read, true, JSON.stringify(got));
  assert.deepEqual(got.album, [{ role: "Producer", type: 6, name: "Teo Macero" }]);
  // Sent last track first: put back in the album's order by their numbers.
  assert.deepEqual(got.tracks.map((x) => [x.disc, x.number, x.credits.map((c) => c.name)]), [
    [1, 1, ["Miles Davis", "Bill Evans"]], [1, 2, ["Miles Davis", "John Coltrane"]]]);
  assert.deepEqual(got.tracks[0].credits[1], { role: null, type: 1, name: "Bill Evans" }, "no Role sent: none, the Type says what");
  assert.equal(got.unnamed, 1, "a performer pushed without its Name: left out, and counted");
  assert.deepEqual([got.how.albumEditInfo, got.how.trackEditInfo, got.how.trackForm], ["Success", "Success", "LengthPrefixed collection of inline structs"]);
  // The album asked by its own object, the one call each; nothing off the allowlist; nothing written.
  assert.deepEqual(w.core.rec.trackEditInfoAsks.length, 1);
  assert.equal(w.core.rec.signatures.filter((s) => s === SIG.trackEditInfo).length, 1);
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.deepEqual(w.core.rec.hearts, []);
});

test("the track read refused: the album's own credits stand, and why is said", async (t) => {
  const w = await rig(t, { refuseTrackEditInfo: true });
  const got = await w.s1.credits.album("Kind of Blue", "Miles Davis");
  assert.equal(got.read, true);
  assert.deepEqual([got.album.map((c) => c.name), got.tracks], [["Teo Macero"], []]);
  assert.equal(got.how.trackEditInfo, "InvalidArguments");
});

test("an album your server's library hasn't, and native mode off, say so and ask nothing", async (t) => {
  const w = await rig(t);
  const before = w.core.rec.trackEditInfoAsks.length;
  const none = await w.s1.credits.album("Not An Album", "Nobody");
  assert.deepEqual([none.read, /no album of that title/.test(none.why)], [false, true]);
  assert.equal(w.core.rec.trackEditInfoAsks.length, before);
  w.s1.turnOff();
  const off = await w.s1.credits.album("Kind of Blue", "Miles Davis");
  assert.equal(off.read, false);
  assert.equal(w.core.rec.trackEditInfoAsks.length, before);
});
