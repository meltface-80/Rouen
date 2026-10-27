"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t1 (lib/credits/finder.js, dev/design/album-credits.md §2, §4): an
// album's credits found the first time its page asks, from your server, the
// files and MusicBrainz, merged and kept; given at once while fresh, read
// again after 30 days or, a source having failed, the next day. Which
// MusicBrainz release: the files' own id, else one found by name only when
// its title, artist and track count are the album's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCreditFinder, RECHECK_MS, RETRY_MS } = require("../../lib/credits/finder");
const { createCreditStore } = require("../../lib/credits/store");

const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const albumKey = (t, a) => (t ? nameKey(t) + "||" + nameKey(a) : null);
const REL = "11111111-2222-4333-8444-555555555555", OTHER = "99999999-2222-4333-8444-555555555555";
const vorbis = (o) => ({ vorbis: Object.entries(o).map(([id, value]) => ({ id, value })) });

const RELEASE = {
  "artist-credit": [{ name: "Anthrax", artist: { id: "aaaaaaaa-2222-4333-8444-555555555555", name: "Anthrax" } }],
  relations: [{ type: "producer", attributes: [], artist: { id: "bbbbbbbb-2222-4333-8444-555555555555", name: "Jay Ruston" } }],
  media: [{ position: 1, tracks: [
    { position: 1, recording: { relations: [{ type: "instrument", attributes: ["drums (drum set)"], artist: { id: "cccccccc-2222-4333-8444-555555555555", name: "Charlie Benante" } }] } },
    { position: 2, recording: { relations: [] } },
  ] }],
};

/** A rig: each source scripted; the clock the test's. */
function rig(o = {}) {
  let t = 1_000_000;
  const asked = [], names = [];
  const store = createCreditStore({ db: () => null });
  const files = o.files || [];
  const finder = createCreditFinder({
    store, now: () => t, albumKey, nameKey, onNames: (n) => names.push(n),
    roon: () => (o.roon === undefined ? null : { album: async () => (typeof o.roon === "function" ? o.roon() : o.roon) }),
    files: { read: async () => ({ files, why: files.length ? null : "Not one of the albums found in /music." }) },
    mb: async (p) => { asked.push(p); if (o.mb) return o.mb(p); throw new Error("no MusicBrainz here"); },
  });
  return { finder, asked, names, store, advance: (ms) => { t += ms; } };
}
const ALBUM = { title: "Kings Among Scotland", artist: "Anthrax", tracks: 2 };

test("THE one: three sources, one row a name, your server's spelling; kept and given at once after", async () => {
  const w = rig({
    roon: { read: true, album: [{ role: "Producer", type: 6, name: "Jay Ruston" }], tracks: [{ credits: [{ role: "Drums", type: 4, name: "Charlie Benante" }] }, { credits: [] }], unnamed: 0, how: {} },
    files: [{ native: vorbis({ PERFORMER: "charlie benante (drums)", COMPOSER: "Scott Ian" }), release: REL }, { native: {}, release: REL }],
    mb: (p) => (p.startsWith("release/" + REL) ? RELEASE : null),
  });
  const got = await w.finder.album(ALBUM, 5000);
  assert.equal(got.status, "ok");
  assert.deepEqual(got.kept.rows.map((r) => [r.name, r.roles, r.tracks, r.source]), [
    ["Charlie Benante", ["Drums"], [1], "roon"], ["Scott Ian", ["Composer"], [1], "tags"], ["Jay Ruston", ["Producer"], [], "roon"]]);
  assert.deepEqual(Object.fromEntries(Object.entries(got.kept.sources).map(([k, v]) => [k, v.state])), { roon: "gave", musicbrainz: "gave", tags: "gave" });
  assert.deepEqual(w.asked, [`release/${REL}?inc=artists+recordings+artist-credits+artist-rels+recording-level-rels+work-rels+work-level-rels`],
    "the files' own release asked for, and nothing searched");
  assert.equal(w.names[0].find((n) => n.name === "Charlie Benante").mbid, "cccccccc-2222-4333-8444-555555555555", "MusicBrainz's id handed on for the picture");
  const again = await w.finder.album(ALBUM, 5000);
  assert.equal(again.kept.rows.length, 3);
  assert.equal(w.asked.length, 1, "kept: not asked again");
});

test("no release id in the files: one found by name, only when its title, artist and track count are the album's", async () => {
  const search = (count) => ({ releases: [
    { id: OTHER, title: "Kings Among Scotland", "track-count": 18, "artist-credit": [{ name: "Anthrax", joinphrase: "" }] },
    { id: REL, title: "Kings Among Scotland", "track-count": count, "artist-credit": [{ name: "Anthrax", joinphrase: "" }] }] });
  const ok = rig({ mb: (p) => (p.startsWith("release/?query=") ? search(2) : p.startsWith("release/" + REL) ? RELEASE : null) });
  const got = await ok.finder.album(ALBUM, 5000);
  assert.equal(got.kept.sources.musicbrainz.state, "gave");
  assert.match(got.kept.sources.musicbrainz.why, /by a search by name/);
  assert.ok(ok.asked[1].startsWith("release/" + REL), "the 18-track edition passed over");
  const wrong = rig({ mb: (p) => (p.startsWith("release/?query=") ? search(3) : RELEASE) });
  const none = await wrong.finder.album(ALBUM, 5000);
  assert.deepEqual([none.kept.sources.musicbrainz.state, none.kept.rows], ["none", []], "no edition agrees: nothing taken");
  assert.equal(wrong.asked.length, 1);
  const unknown = rig({ mb: () => { throw new Error("asked"); } });
  const n2 = await unknown.finder.album(Object.assign({}, ALBUM, { tracks: 0 }), 5000);
  assert.deepEqual([n2.kept.sources.musicbrainz.state, unknown.asked], ["none", []], "no track count to search by: not searched");
});

test("a source that failed is asked again the next day, not before; a release gone (404) is nothing, not a failure; 30 days reads again", async () => {
  let down = true;
  const w = rig({ files: [{ native: {}, release: REL }], mb: () => { if (down) throw new Error("HTTP 503"); return RELEASE; } });
  const first = await w.finder.album(ALBUM, 5000);
  assert.equal(first.kept.sources.musicbrainz.state, "failed");
  down = false;
  w.advance(RETRY_MS - 1);
  assert.equal((await w.finder.album(ALBUM, 5000)).kept.sources.musicbrainz.state, "failed", "not yet a day");
  w.advance(2);
  assert.equal((await w.finder.album(ALBUM, 5000)).kept.sources.musicbrainz.state, "gave");
  const gone = rig({ files: [{ native: {}, release: REL }], mb: () => { throw new Error("HTTP 404"); } });
  assert.equal((await gone.finder.album(ALBUM, 5000)).kept.sources.musicbrainz.state, "none");
  const n = gone.asked.length;
  gone.advance(RECHECK_MS - 1);
  await gone.finder.album(ALBUM, 5000);
  assert.equal(gone.asked.length, n, "fresh for thirty days");
  gone.advance(2);
  await gone.finder.album(ALBUM, 5000);
  assert.equal(gone.asked.length, n + 1);
});

test("a read longer than the page waits: pending, the read going on, its answer kept for the next ask; one read at a time", async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const w = rig({ roon: () => slow.then(() => ({ read: true, album: [{ role: "Producer", type: 6, name: "Jay Ruston" }], tracks: [], unnamed: 0, how: {} })) });
  const a = await w.finder.album(ALBUM, 10);
  const b = await w.finder.album(ALBUM, 10);
  assert.deepEqual([a.status, b.status, a.kept], ["pending", "pending", null]);
  release();
  await new Promise((r) => { setTimeout(r, 20); });
  const c = await w.finder.album(ALBUM, 10);
  assert.deepEqual([c.status, c.kept.rows.map((r) => r.name)], ["ok", ["Jay Ruston"]]);
});

test("native mode off, and your server's read refused: said so, the other sources stand", async () => {
  const off = await rig({ files: [{ native: vorbis({ PRODUCER: "Jay Ruston" }) }] }).finder.album(ALBUM, 5000);
  assert.deepEqual([off.kept.sources.roon.state, off.kept.rows.map((r) => r.name)], ["off", ["Jay Ruston"]]);
  const refused = await rig({ roon: { read: false, why: "Your server refused both reads.", how: { trackEditInfo: "InvalidArguments" } } }).finder.album(ALBUM, 5000);
  assert.deepEqual([refused.kept.sources.roon.state, refused.kept.sources.roon.why], ["failed", "Your server refused both reads."]);
  assert.deepEqual(refused.kept.sources.tags, Object.assign({}, refused.kept.sources.tags, { state: "none" }));
});

// ---- the review's (v1.9.70-t1) ----

test("your server not ready then (not connected, native mode off) is asked again once it is, not kept as nothing for a month", async () => {
  let roon = null;
  let t = 1_000_000;
  const store = createCreditStore({ db: () => null });
  const finder = createCreditFinder({ store, now: () => t, albumKey, nameKey, roon: () => roon, files: { read: async () => ({ files: [], why: "no" }) },
    mb: async () => { throw new Error("HTTP 404"); } });
  assert.equal((await finder.album(ALBUM, 5000)).kept.sources.roon.state, "off");
  roon = { album: async () => ({ read: false, wait: true, why: "Native mode isn't connected to your server right now." }) };
  t += 11 * 60 * 1000;
  assert.equal((await finder.album(ALBUM, 5000)).kept.sources.roon.state, "wait", "native mode on: asked after ten minutes");
  roon = { album: async () => ({ read: true, album: [{ role: "Producer", type: 6, name: "Jay Ruston" }], tracks: [], unnamed: 0, how: { trackEditInfo: "Success" } }) };
  t += 60 * 1000;
  assert.equal((await finder.album(ALBUM, 5000)).kept.sources.roon.state, "wait", "not before ten minutes");
  t += 10 * 60 * 1000;
  const got = await finder.album(ALBUM, 5000);
  assert.deepEqual([got.kept.sources.roon.state, got.kept.rows.map((r) => r.name)], ["gave", ["Jay Ruston"]]);
});

test("the tracks' read refused while the album's gave: shown, and asked again the next day", async () => {
  const w = rig({ roon: { read: true, album: [{ role: "Producer", type: 6, name: "Jay Ruston" }], tracks: [], unnamed: 0, how: { albumEditInfo: "Success", trackEditInfo: "InvalidArguments" } } });
  const got = await w.finder.album(ALBUM, 5000);
  assert.deepEqual([got.kept.sources.roon.state, got.kept.rows.map((r) => r.name)], ["failed", ["Jay Ruston"]]);
  assert.match(got.kept.sources.roon.why, /refused the tracks' credits \(InvalidArguments\)/);
});

test("MusicBrainz is asked while your server's read is still going, not after it", async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const w = rig({ roon: () => slow.then(() => ({ read: true, album: [], tracks: [], unnamed: 0, how: { trackEditInfo: "Success" } })),
    files: [{ native: {}, release: REL }], mb: () => RELEASE });
  const p = w.finder.album(ALBUM, 5000);
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(w.asked.length, 1, "the release asked for before your server answered");
  release();
  assert.equal((await p).kept.sources.musicbrainz.state, "gave");
});

test("kept in memory when the database refused it, and read back from there", async () => {
  const db = { exec() {}, prepare: (sql) => ({ run() { throw new Error("SQLITE_READONLY"); }, get: () => (sql.includes("SELECT") ? undefined : undefined) }) };
  const store = createCreditStore({ db: () => db });
  store.saveAlbum("k", { rows: [], sources: {}, at: 1 });
  assert.deepEqual(store.album("k"), { rows: [], sources: {}, at: 1 });
  store.saveAct({ key: "a", name: "A", mbid: null, photo: null, source: null, at: 1, ok: false, members: null });
  assert.equal(store.act("a").name, "A");
});
