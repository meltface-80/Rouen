"use strict";
// ---------------------------------------------------------------------------
// N2c-0 (lib/roon-direct/listen-later.js, v1.9.36, native-remote.md §10.1):
// Roon's own Listen Later, read once over native mode's connection, end to
// end against the fake server (test/lib/fake-roon-later.js), which sends each
// object once a connection as the owner's does. The fake is not evidence of
// how the real server answers: the probe exists to find that out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { createListenLaterReader, when } = require("../../lib/roon-direct/listen-later");
const { listenLaterArgs, ALLOWED } = require("../../lib/roon-direct/methods");
const { BinaryReader } = require("../../lib/roon-direct/wire");
const { mountRoonDirect } = require("../../lib/roon-direct/route");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const CATALOG = [
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "tidal" },
  { title: "Homogenic", artist: "Björk", source: "qobuz" },
];
// The owner's case (2026-10-21): a TIDAL album and a Qobuz album, neither in the library — and one that is.
const LATER = [{ catalog: 0 }, { catalog: 1 }, { library: 2 }];

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums,
    catalog: CATALOG, listenLater: LATER, faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.36",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1, link, albums };
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1, link, albums };
}

test("THE one for N2c-0's Listen Later: Roon's own list, for the profile chosen, each album as it is — nothing written", async (t) => {
  const w = await rig(t);
  const out = await w.s1.later.read();
  assert.equal(out.read, true, JSON.stringify(out));
  assert.equal(out.complete, true);
  assert.equal(out.profile, "Owner");
  assert.deepEqual(out.tries, [{ languages: [], status: "Success" }]);
  assert.deepEqual(out.list.items.map((i) => i.album), [
    { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "TIDAL", inLibrary: false },
    { title: "Homogenic", artist: "Björk", source: "Qobuz", inLibrary: false },
    // In the library: sent to the read already, so a bare reference now, and known from it.
    { title: "Mezzanine", artist: "Massive Attack", source: "TIDAL", inLibrary: true },
  ]);
  assert.deepEqual(out.list.items.map((i) => [i.type, i.state]), [["Album", 1], ["Album", 1], ["Album", 1]]);
  assert.equal(out.list.items[0].at, "2026-10-21T00:00:00.000Z");
  assert.deepEqual([out.list.count, out.list.arrived], [3, 3]);
  assert.deepEqual(w.core.rec.laterAsks, [{ profile: "2", languages: [] }], "asked as another profile, or twice");
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "called off the allowlist: " + sig);
  assert.ok(!w.core.rec.signatures.some((s) => /SetListenLaterState|AddToLibrary|FavoriteOrBan/.test(s)), "something was written");
  // What it sent kept (sent once a connection): the albums, and the list.
  assert.ok(w.link.session().graph.get(60000n), "a catalogue album the list named was let go");
});

test("read twice on one connection: the list named again by reference is still read, the server never sending it twice", async (t) => {
  const w = await rig(t, { sameLaterList: true });
  const first = await w.s1.later.read();
  const second = await w.s1.later.read();
  assert.deepEqual([first.complete, second.complete], [true, true], JSON.stringify(second));
  assert.equal(second.list.items.length, 3);
});

test("a library album renamed since the read is shown by its name now: the server's later word laid over the read's", async (t) => {
  const w = await rig(t);
  w.albums[2].title = "Mezzanine (Remastered)";
  w.core.renamed(2);   // its Title alone, as a change of one field is pushed
  assert.ok(await until(() => w.link.session().graph.get(50002n)), "the title was never pushed");
  const out = await w.s1.later.read();
  assert.equal(out.list.items[2].album.title, "Mezzanine (Remastered)");
  assert.equal(out.list.items[2].album.inLibrary, true);
});

test("no read once the connection's copy of what was sent has too little room left — the owner's own 101,006 is not too little", async () => {
  const at = (size) => createListenLaterReader({ inTurn: (fn) => fn(), profile: () => null, known: () => new Map(), off: () => null,
    link: { session: () => ({ g: { uncertain: () => false, call: () => { throw new Error("asked"); } }, root: { profiles: [] }, graph: { objects: { size }, maxObjects: 200000 } }) } });
  const full = await at(180000).read();
  assert.equal(full.status, 409);
  assert.match(full.error, /room/);
  // The owner's numbers (2026-10-21, a fresh read of 12,962 albums): past the room check, to the next ("no profile" here).
  const owner = await at(101006).read();
  assert.doesNotMatch(String(owner.error), /room|full/, JSON.stringify(owner));
});

test("a DateTime as the server may write it: plain ticks, or ToBinary's with its kind in the top bits", () => {
  const ticks = 621355968000000000n + BigInt(Date.UTC(2026, 9, 21)) * 10000n;
  assert.equal(when(ticks), "2026-10-21T00:00:00.000Z");
  assert.equal(when(ticks | (1n << 62n)), "2026-10-21T00:00:00.000Z", "a UTC kind read as a date 12,000 years on");
  assert.equal(when(BigInt.asIntN(64, ticks | (2n << 62n))), "2026-10-21T00:00:00.000 (the server's local time)");
  assert.equal(when(5n), "5");
  assert.equal(when(undefined), null);
});

test("the arguments: the profile by its object, then the languages as a collection of strings", () => {
  const r = new BinaryReader(listenLaterArgs(12n, ["en", "fr"]));
  assert.equal(r.long(), 12n);
  const body = new BinaryReader(r.bytes(r.flexInt()));
  assert.deepEqual([body.flexInt(), body.string(), body.string()], [2, "en", "fr"]);
  assert.equal(r.pos, r.buf.length);
});

test("refused with no languages, it is asked once more with English, and both are said", async (t) => {
  const w = await rig(t, { refuseEmptyLanguages: true });
  const out = await w.s1.later.read();
  assert.deepEqual(out.tries, [{ languages: [], status: "InvalidArguments" }, { languages: ["en"], status: "Success" }]);
  assert.equal(out.list.items.length, 3);
});

test("refused in both forms: said so, with each status, and nothing else asked", async (t) => {
  const w = await rig(t, { refuseLater: true });
  const out = await w.s1.later.read();
  assert.equal(out.read, false);
  assert.deepEqual(out.tries.map((x) => x.status), ["InvalidArguments", "InvalidArguments"]);
  assert.equal(w.core.rec.laterAsks.length, 2);
});

test("an answer that is not a reference is described, never passed on", async (t) => {
  const w = await rig(t, { laterNotRef: true });
  const out = await w.s1.later.read();
  assert.equal(out.read, false);
  assert.equal(out.answer.reference, false);
  assert.equal(typeof out.answer.bytes, "number");
  assert.ok(!JSON.stringify(out).includes("not a reference"), "the answer's own bytes passed on");
});

test("a list pushed after the answer is waited for", async (t) => {
  const w = await rig(t, { lateLater: true });
  const out = await w.s1.later.read();
  assert.equal(out.complete, true, JSON.stringify(out));
  assert.equal(out.list.items.length, 3);
});

test("native mode off, or the library not read on this connection: nothing asked", async (t) => {
  const w = await rig(t, {}, { off: true });
  assert.deepEqual(await w.s1.later.read(), { error: "Native mode is off.", status: 409 });
  const s = { g: { uncertain: () => false, call: () => { throw new Error("asked"); } } };
  const reader = createListenLaterReader({ link: { session: () => s }, inTurn: (fn) => fn(), profile: () => null, known: () => null, off: () => null });
  const out = await reader.read();
  assert.equal(out.status, 409);
  assert.match(out.error, /library hasn't been read on this connection/);
  assert.equal(w.core.rec.laterAsks.length, 0);
});

test("the route: nothing without run=1; with it, the read, and an error as an answer", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  let asked = 0;
  const stage1 = { status: () => ({}), unmatched: () => [], marks: {}, finder: { progress: () => ({}), start: () => ({}) },
    later: { read: async () => { asked++; return asked === 1 ? { read: true, list: { items: [] } } : { error: "Native mode is off.", status: 409 }; } } };
  mountRoonDirect(app, stage1);
  const call = async (q) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["GET /api/debug/roon-listen-later"]({ query: q }, res);
    return res;
  };
  const idle = await call({});
  assert.deepEqual([idle.body.ran, asked], [false, 0]);
  assert.equal((await call({ run: "1" })).body.read, true);
  const off = await call({ run: "1" });
  assert.deepEqual([off.code, off.body], [409, { error: "Native mode is off." }]);
});
