"use strict";
/*
 * iBroadcast's library as Rouen keeps it for the drive (2.0.6-t1, dev/design/ibroadcast.md §3.2), as Mandarin's
 * IBroadcastLibrary.cs reads it: an album kept a disc an entry joined again, the trash left out, a track listed twice
 * kept once under the album its own entry names; kept on the data volume, and read again only once iBroadcast says it
 * changed (or when asked to).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeIBroadcast } = require("../lib/fake-ibroadcast");
const { createIBroadcastAccount } = require("../../lib/ibroadcast/account");
const { createIBroadcastLibrary, albumsOf, summary } = require("../../lib/ibroadcast/library");

const INXS = { id: 10, name: "INXS" };
const ALBUMS = [
  // A double album iBroadcast keeps as two entries, disc 2 first in its list.
  { id: 21, name: "The Very Best", artist: INXS, disc: 2, year: 2011, tracks: [{ id: 2101, title: "Need You Tonight", track: 1 }] },
  { id: 20, name: "The Very Best", artist: INXS, disc: 1, year: 2011, tracks: [{ id: 2001, title: "Original Sin", track: 1 },
    // On a live album's entry too (below): kept here, where its own entry names it.
    { id: 2002, title: "Never Tear Us Apart", track: 2 }] },
  { id: 30, name: "Live Baby Live", artist: INXS, tracks: [{ id: 3001, title: "Suicide Blonde", track: 1, size: 2000 },
    { id: 2002, title: "Never Tear Us Apart", track: 2, album_id: 20 },
    { id: 3003, title: "Deleted", track: 3, trashed: true }] },
  { id: 40, name: "Binned", artist: { id: 11, name: "Nobody" }, trashed: true, tracks: [{ id: 4001, title: "Gone", track: 1 }] },
  { id: 50, name: "Duets", artist: { id: 12, name: "Various Artists" }, tracks: [{ id: 5001, title: "Together", track: 1, artist: { id: 13, name: "Kenny G" }, type: "audio/mpeg" }] },
];

test("the library's tables read as albums: discs joined, the trash left out, a track listed twice kept once", async (t) => {
  const ib = await new FakeIBroadcast({ albums: ALBUMS }).start();
  t.after(() => ib.stop());
  const k = albumsOf({ library: ib.library(), status: { lastmodified: "2026-11-16 12:00:00" },
    settings: { streaming_server: "https://streaming.example", artwork_server: "https://art.example" } }, 1234);
  assert.equal(k.lastmodified, "2026-11-16 12:00:00");
  assert.equal(k.streaming_server, "https://streaming.example");
  assert.equal(k.at, 1234);
  assert.deepEqual(k.albums.map((a) => a.title), ["The Very Best", "Live Baby Live", "Duets"], "the binned album is not kept");
  const best = k.albums[0];
  assert.equal(best.id, "20", "under its first disc's id");
  assert.equal(best.year, 2011);
  assert.deepEqual(best.tracks.map((x) => [x.disc, x.title]), [[1, "Original Sin"], [1, "Never Tear Us Apart"], [2, "Need You Tonight"]], "disc 1 first");
  assert.deepEqual(k.albums[1].tracks.map((x) => x.title), ["Suicide Blonde"], "the live album keeps neither the studio track nor the deleted one");
  const duet = k.albums[2].tracks[0];
  assert.equal(duet.artist, "Kenny G", "a track's own artist");
  assert.equal(k.albums[2].artist, "Various Artists");
  assert.equal(duet.file, "/128/a/b/5001", "iBroadcast's file path, for the drive's reads");
  assert.equal(duet.type, "audio/mpeg");
  assert.deepEqual(summary(k), { albums: 3, tracks: 5, lossless: 4, bytes: 2000 + 4 * 1000, at: 1234 });
  assert.deepEqual(summary(null), { albums: null, tracks: null, lossless: null, bytes: null, at: null });
});

test("kept on the data volume, and read again only once iBroadcast says it changed", async (t) => {
  const ib = await new FakeIBroadcast({ albums: ALBUMS }).start();
  t.after(() => ib.stop());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ib-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  // Signed in already: the tokens as the sign-in keeps them.
  const store = { ibroadcastToken: { token: { access: ib.access, refresh: ib.refreshToken, expires: Date.now() + 3600e3, life: 3600e3, scope: null } } };
  const account = createIBroadcastAccount({ load: () => store, save: (p) => { Object.assign(store, p); return true; }, version: "t", base: ib.base });
  let clock = 5000;
  const lib = createIBroadcastLibrary({ account, dataDir, now: () => clock });
  assert.deepEqual(lib.state(), { albums: null, tracks: null, lossless: null, bytes: null, at: null, reading: false, error: null });

  const first = lib.read(false);
  assert.equal(lib.state().reading, true);
  assert.equal(lib.read(false), first, "one reading at a time: a second asker waits for it");
  await first;
  assert.equal(ib.libraryReads, 1);
  // Read library now during the ten minutes' look, which reads nothing when nothing changed: it reads after it (the review).
  const look = lib.read(false);
  const now = lib.read(true);
  assert.notEqual(now, look);
  assert.equal(lib.read(true), now, "a second Read library now waits for the first");
  await now;
  assert.equal(ib.libraryReads, 2, "the look read nothing; Read library now did");
  const file = path.join(dataDir, "ibroadcast", "library.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).albums.length, 3);

  clock = 9000;
  await lib.read(false);
  assert.equal(ib.libraryReads, 2, "unchanged at iBroadcast: not read again");
  assert.equal(lib.state().at, 5000);
  ib.changed();
  await lib.read(false);
  assert.equal(ib.libraryReads, 3, "changed: read again");
  assert.equal(lib.state().at, 9000);
  await lib.read(true);
  assert.equal(ib.libraryReads, 4, "Read library now: whatever iBroadcast says");

  // A new library object (a restart) finds what was kept.
  const again = createIBroadcastLibrary({ account, dataDir });
  assert.equal(again.state().albums, 3);

  // A failure is kept for the page, and cleared by the next reading that works.
  ib.expire();
  ib.refreshToken = "rt-other";
  await assert.rejects(lib.read(true), /refresh token is no good/);
  assert.match(lib.state().error, /refresh token is no good/);
  assert.equal(lib.state().albums, 3, "what was read before stays");
  lib.forget();
  assert.ok(!fs.existsSync(file));
  assert.equal(lib.state().albums, null);
});

test("a track whose own entry names an album that doesn't list it is kept where it is listed (the review)", () => {
  const lib = { albums: { map: { name: 0, tracks: 1, artist_id: 2 }, 1: ["A", ["300"], 9], 2: ["B", [], 9] },
    artists: { map: { name: 0 }, 9: ["X"] }, tracks: { map: { title: 0, album_id: 1 }, 300: ["Kept", 2] } };
  const k = albumsOf({ library: lib }, 0);
  assert.deepEqual(k.albums.map((a) => [a.title, a.tracks.map((t) => t.title)]), [["A", ["Kept"]]]);
});

test("signed out while iBroadcast answers: the answer is not kept (the review)", async (t) => {
  const ib = await new FakeIBroadcast({ albums: ALBUMS }).start();
  t.after(() => ib.stop());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ib-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = { ibroadcastToken: { token: { access: ib.access, refresh: ib.refreshToken, expires: Date.now() + 3600e3, life: 3600e3, scope: null } } };
  const account = createIBroadcastAccount({ load: () => store, save: (p) => { Object.assign(store, p); return true; }, version: "t", base: ib.base });
  const lib = createIBroadcastLibrary({ account, dataDir });
  // iBroadcast's answer held until the sign-out has happened, as a slow library server's would be.
  const handle = ib.handle.bind(ib);
  /** @type {() => void} */
  let answer = () => {};
  let asked = false;
  ib.handle = (req, res, body) => {
    if (req.url !== "/library") return handle(req, res, body);
    asked = true;
    answer = () => handle(req, res, body);
    return undefined;
  };
  const reading = lib.read(true);
  for (let i = 0; i < 100 && !asked; i++) await new Promise((r) => { setTimeout(r, 20); });
  assert.ok(asked, "the library asked for");
  delete store.ibroadcastToken;                // Sign out: the sign-in forgotten, then the library
  lib.forget();
  answer();
  assert.equal(await reading, null);
  assert.ok(!fs.existsSync(path.join(dataDir, "ibroadcast", "library.json")), "nothing written back after the sign-out");
  assert.equal(lib.state().albums, null);
});
