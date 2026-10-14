"use strict";
// ---------------------------------------------------------------------------
// v1.8.84: Backup & restore.
//
// What each group pins:
//
//   1. EVERY SAVED SETTING HAS A HOME. A key is a preference, a key/sign-in, a
//      playlist, or the server's own bookkeeping — and one nobody classified
//      that is NAMED like a secret goes with the keys, never into the settings
//      part where a person would not expect a token to travel.
//   2. A RESTORE REPLACES. A setting the backup does not hold goes back to its
//      default rather than keeping today's value; a part NOT chosen is left
//      exactly as it is; bookkeeping (caches, stamps) is never touched.
//   3. THE STORE KEEPS 10 + 5, COUNTED APART, BY WHEN EACH WAS STORED. A run of
//      restores never pushes out a backup you made, and an old backup brought
//      in from a file is not pruned on arrival for being old.
//   4. LISTEN LATER ROUND-TRIPS through the shipping code against the real
//      table, re-keyed on the way in.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const B = require("../../lib/backup");
const { indexSource, loadIndexFunctions } = require("../lib/extract");
const SRC = indexSource();

let Database = null;
try { Database = require("better-sqlite3"); } catch (e) {
  // Optional where the native build is missing; group 4 skips rather than
  // failing for a reason unrelated to the code under test.
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rouen-backup-"));

const LIVE = {
  version: "1.8.84",
  settings: {
    homeRows: [{ id: "random", on: true }], labelsEnabled: true, radioZones: ["z1"],
    shareServices: ["qobuz"], hqpHost: "10.0.0.2",
    discogsToken: "dt", fanartKey: "fk", qobuzWaveToken: "qw", tidalRefreshToken: "tr",
    smartPlaylists: [{ id: "s1", name: "Seventies" }],
    playlistArt: { x: 1 }, waveformAnalysis: "rms:44100:2", qobuzPasswordMd5: "nope",
  },
  userPlaylists: [{ id: "up_1", name: "Mine", tracks: [] }],
  later: [{ key: "k", title: "Aja", artist: "Steely Dan", source: "album", ts: 5 }],
  files: { "hqp-presets.json": { v: 1, presets: [{ name: "P" }] } },
};

test("1. every setting the server saves is classified, and unknown secrets go with the keys", () => {
  // Every key index.js writes or reads back as a setting, gathered the same
  // three ways it is spelled there.
  const seen = new Set();
  for (const m of SRC.matchAll(/\b(?:_persisted|st)\.([a-zA-Z]+)\b/g)) seen.add(m[1]);
  for (const m of SRC.matchAll(/savePersistedSettings\(\{([^)]*)\}/g)) {
    for (const k of m[1].matchAll(/([a-zA-Z]+)\s*:/g)) seen.add(k[1]);
  }
  for (const k of ["hqpEnabled", "hqpHost", "hqpPort", "hqpDemo"]) seen.add(k);
  for (const k of seen) {
    const c = B.classify(k);
    if (/token|secret|password|md5|key$/i.test(k)) {
      assert.ok(c === "keys" || c === "never", k + " looks secret and was classified " + c);
    }
  }
  for (const k of B.KEY_KEYS) assert.ok(seen.has(k) || /^qobuz|^tidal/.test(k), "KEY_KEYS names an unknown key " + k);
  assert.equal(B.classify("someFutureApiToken"), "keys");
  assert.equal(B.classify("someFuturePreference"), "settings");
  assert.equal(B.classify("playlistArt"), "never");
  assert.equal(B.classify("smartPlaylists"), "playlists");
});

test("1b. a backup holds each chosen part, and nothing it should not", () => {
  const b = B.build(LIVE, ["settings", "keys", "playlists", "later"], "manual", new Date(2026, 9, 7));
  assert.deepEqual(b.parts, ["settings", "playlists", "later", "keys"]);
  assert.deepEqual(Object.keys(b.settings).sort(), ["homeRows", "hqpHost", "labelsEnabled", "shareServices"]);
  assert.deepEqual(Object.keys(b.keys).sort(), ["discogsToken", "fanartKey", "qobuzWaveToken", "tidalRefreshToken"]);
  assert.deepEqual(b.playlists.smart, LIVE.settings.smartPlaylists);
  assert.deepEqual(b.playlists.user, LIVE.userPlaylists);
  assert.deepEqual(b.settingsFiles, LIVE.files);
  const text = JSON.stringify(b);
  for (const never of ["playlistArt", "waveformAnalysis", "qobuzPasswordMd5", "radioZones"]) assert.ok(!text.includes(never), never + " leaked");

  const only = B.build(LIVE, ["later"], "manual");
  assert.deepEqual(only.parts, ["later"]);
  assert.equal(only.settings, undefined);
  assert.equal(only.keys, undefined);
  assert.ok(!JSON.stringify(only).includes("dt"), "keys must not ride in a backup that did not choose them");
});

test("1c. parse refuses what is not a backup, and a backup from a newer Rouen", () => {
  assert.throws(() => B.parse("not json"), /not a Rouen backup/);
  assert.throws(() => B.parse(JSON.stringify({ app: "Other", format: 1 })), /not a Rouen backup/);
  assert.throws(() => B.parse(JSON.stringify({ app: "Rouen", format: B.FORMAT + 1, settings: {} })), /newer Rouen/);
  assert.throws(() => B.parse(JSON.stringify({ app: "Rouen", format: 1 })), /nothing to restore/);
  // parts come from what the file HOLDS, not from what it claims
  const b = B.parse(JSON.stringify({ app: "Rouen", format: 1, parts: ["settings", "keys"], later: [] }));
  assert.deepEqual(b.parts, ["later"]);
});

test("2. a restore replaces the chosen parts, leaves the rest, and never touches bookkeeping", () => {
  const b = B.parse(JSON.stringify(B.build(LIVE, B.PARTS, "manual")));
  const now = {
    homeRows: [{ id: "picks", on: true }], displayEnabled: true,   // displayEnabled: set since the backup
    discogsToken: "new", qobuzToken: "q-new",
    smartPlaylists: [{ id: "s2", name: "New" }],
    playlistArt: { y: 2 }, waveformAnalysis: "rms:44100:2",
  };
  const p = B.plan(b, ["settings"], now);
  assert.deepEqual(p.parts, ["settings"]);
  assert.deepEqual(p.settings.homeRows, LIVE.settings.homeRows);
  assert.equal(p.settings.displayEnabled, undefined, "a setting the backup lacks goes back to its default");
  assert.equal(p.settings.discogsToken, "new", "keys were not chosen, so they stay");
  assert.equal(p.settings.qobuzToken, "q-new");
  assert.deepEqual(p.settings.smartPlaylists, now.smartPlaylists, "playlists were not chosen, so they stay");
  assert.deepEqual(p.settings.playlistArt, { y: 2 }, "a cache is never restored over");
  assert.equal(p.settings.waveformAnalysis, "rms:44100:2");
  assert.deepEqual(p.files, { "hqp-presets.json": LIVE.files["hqp-presets.json"], "hqp-setup.json": null });
  assert.equal(p.userPlaylists, undefined);
  assert.equal(p.later, undefined);

  const k = B.plan(b, ["keys", "playlists"], now);
  assert.equal(k.settings.discogsToken, "dt");
  assert.equal(k.settings.qobuzToken, undefined, "a sign-in made since the backup is signed out by restoring keys");
  assert.deepEqual(k.settings.smartPlaylists, LIVE.settings.smartPlaylists);
  assert.deepEqual(k.userPlaylists, LIVE.userPlaylists);
  assert.equal(k.settings.displayEnabled, true, "settings were not chosen, so they stay");
  assert.equal(k.files, undefined);

  // Restoring the keys drops the legacy password hash rather than pairing it
  // with a restored username it was never saved with.
  const withHash = B.plan(b, ["keys"], Object.assign({ qobuzPasswordMd5: "h", qobuzUsername: "today" }, now));
  assert.equal(withHash.settings.qobuzPasswordMd5, undefined);
  assert.equal(B.plan(b, ["settings"], { qobuzPasswordMd5: "h" }).settings.qobuzPasswordMd5, "h");
  // Core zone ids never travel, and are never restored over.
  assert.deepEqual(B.plan(b, ["settings"], { radioZones: ["today"] }).settings.radioZones, ["today"]);

  // A part asked for that the backup does not hold is skipped, not emptied.
  const laterOnly = B.parse(JSON.stringify(B.build(LIVE, ["later"], "manual")));
  const q = B.plan(laterOnly, ["settings", "later"], now);
  assert.deepEqual(q.parts, ["later"]);
  assert.deepEqual(q.settings.homeRows, now.homeRows);
});

test("3. the store keeps the last 10 of yours and the last 5 before-restore copies, apart", () => {
  const dir = tmp();
  const store = new B.Store(dir);
  const t0 = new Date(2026, 0, 1, 12, 0, 0);
  const at = i => new Date(t0.getTime() + i * 1000);
  for (let i = 0; i < 12; i++) store.save(B.build(LIVE, ["later"], "manual"), at(i));
  for (let i = 12; i < 19; i++) store.save(B.build(LIVE, B.PARTS, "before-restore"), at(i));
  const list = store.list();
  assert.equal(list.filter(b => b.kind === "manual").length, B.KEEP.manual);
  assert.equal(list.filter(b => b.kind === "before-restore").length, B.KEEP.before);
  assert.ok(list[0].id.startsWith("rouen-before-restore-"), "newest first");
  // the two oldest of yours went, not anything newer
  const mine = list.filter(b => b.kind === "manual").map(b => b.id);
  assert.ok(!mine.includes("rouen-backup-20260101-120000"));
  assert.ok(mine.includes("rouen-backup-20260101-120011"));

  // An old backup brought in from a file is stored NOW, and kept.
  const old = B.build(LIVE, ["later"], "manual", new Date(2019, 0, 1));
  old.kind = "uploaded";
  const id = store.save(old, at(30));
  const after = store.list();
  assert.equal(after[0].id, id);
  assert.equal(after[0].kind, "uploaded");
  assert.equal(after[0].created, new Date(2019, 0, 1).toISOString());
  assert.equal(after.filter(b => b.kind !== "before-restore").length, B.KEEP.manual);

  // Restoring the OLDEST before-restore copy writes a new one — which must
  // not prune the backup being read.
  const befores = store.list().filter(x => x.kind === "before-restore");
  const oldest = befores[befores.length - 1].id;
  store.save(B.build(LIVE, B.PARTS, "before-restore"), at(35), oldest);
  assert.ok(store.list().some(x => x.id === oldest), "the source of a restore survives its own before-restore copy");
  store.prune();

  // two in one second do not overwrite each other
  const a = store.save(B.build(LIVE, ["later"], "manual"), at(40));
  const b2 = store.save(B.build(LIVE, ["later"], "manual"), at(40));
  assert.notEqual(a, b2);
  assert.equal(store.read(b2).backup.parts[0], "later");

  // ids are a closed set: nothing outside the folder can be named
  assert.throws(() => store.read("../settings"), /No such backup/);
  assert.equal(store.remove("../../index"), false);
  assert.ok(store.remove(a));
  assert.ok(!store.list().some(x => x.id === a));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("3b. a broken file is listed as broken, not hidden, so it can be deleted", () => {
  const dir = tmp();
  const store = new B.Store(dir);
  fs.writeFileSync(path.join(dir, "rouen-backup-20260101-120000.json"), "{ half");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a backup");
  const list = store.list();
  assert.equal(list.length, 1);
  assert.ok(list[0].error);
  assert.ok(store.remove(list[0].id));
  fs.rmSync(dir, { recursive: true, force: true });
});

function ddl(table) {
  const m = new RegExp("CREATE TABLE IF NOT EXISTS " + table + "\\s*\\([\\s\\S]*?\\n\\s*\\);", "m").exec(SRC);
  if (!m) throw new Error("no CREATE TABLE for " + table);
  return m[0];
}

test("4. Listen later and settings round-trip through the shipping restore", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(ddl("listen_later"));
  const dataDir = tmp();
  const settings = {
    homeRows: [{ id: "random" }], discogsToken: "dt", playlistArt: { a: 1 },
  };
  const F = loadIndexFunctions(
    ["backupLive", "backupRestoreLater", "backupApply", "backupWriteJson", "listenLaterRows",
     "listenLaterServices", "listenLaterSources", "albumKey", "canonText", "canonArtist", "normalize"],
    {
      BACKUP: B, fs, path, pkg: { version: "1.8.84" }, HQP_DATA_DIR: dataDir,
      labelsDb: db, console: { log() {}, error() {}, warn() {} },
      loadPersistedSettings: () => settings,
      SETTINGS_FILE: path.join(dataDir, "cache", "settings.json"),
      USER_PL_FILE: path.join(dataDir, "cache", "playlists.json"),
      settingsFrozen: false, settingsVersion: 0, laterVersion: 0,
      userPlaylists: [], userPlaylistRecord: x => x, userPlMax: () => 50, userPlVersion: () => 1,
    });
  db.prepare("INSERT INTO listen_later (key, title, artist, service, album_id, image, source, ts) VALUES (?,?,?,?,?,?,?,?)")
    .run(F.albumKey("Aja", "Steely Dan"), "Aja", "Steely Dan", "qobuz", "123", "https://x/y.jpg", "picks", 42);
  fs.writeFileSync(path.join(dataDir, "hqp-presets.json"), JSON.stringify({ v: 1, presets: [{ name: "P" }] }));

  const b = B.parse(JSON.stringify(B.build(F.backupLive(), B.PARTS, "manual")));
  assert.equal(b.later.length, 1);
  assert.deepEqual(b.settingsFiles["hqp-presets.json"], { v: 1, presets: [{ name: "P" }] });

  // Things change after the backup …
  db.prepare("DELETE FROM listen_later").run();
  db.prepare("INSERT INTO listen_later (key, title, artist, service, album_id, image, source, ts) VALUES (?,?,?,?,?,?,?,?)")
    .run("x", "Other", "Someone", null, null, "javascript:alert(1)", "album", 99);
  settings.homeRows = [{ id: "picks" }];
  settings.displayEnabled = true;
  fs.writeFileSync(path.join(dataDir, "hqp-setup.json"), JSON.stringify({ v: 1, setups: [] }));

  // … and come back.
  const done = F.backupApply(b, ["settings", "later"]);
  assert.deepEqual(done, ["settings", "later"]);
  const rows = db.prepare("SELECT * FROM listen_later").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Aja");
  assert.equal(rows[0].key, F.albumKey("Aja", "Steely Dan"), "re-keyed by today's rule");
  assert.equal(rows[0].ts, 42, "the date it was put aside survives");
  assert.equal(rows[0].service, "qobuz");
  assert.deepEqual(settings.homeRows, [{ id: "random" }]);
  assert.equal(settings.displayEnabled, undefined);
  assert.equal(settings.discogsToken, "dt");
  assert.deepEqual(settings.playlistArt, { a: 1 });
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "cache", "settings.json"), "utf8"));
  assert.deepEqual(onDisk, settings, "the file holds what the cache holds");
  assert.ok(!fs.existsSync(path.join(dataDir, "hqp-setup.json")), "a file the backup did not have is removed");
  assert.ok(fs.existsSync(path.join(dataDir, "hqp-presets.json")));

  // A row that is not one is skipped; a bad image is not stored.
  F.backupRestoreLater([null, { title: "", artist: "" }, { title: "T", artist: "A", image: "javascript:x", source: "evil", ts: "x" }]);
  const r2 = db.prepare("SELECT * FROM listen_later").all();
  assert.equal(r2.length, 1);
  assert.equal(r2[0].image, null);
  assert.equal(r2[0].source, "album");
  assert.ok(r2[0].ts > 0);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("4b. a restore whose settings cannot be written changes nothing, and says so", { skip: !Database }, () => {
  const db = new Database(":memory:");
  db.exec(ddl("listen_later"));
  const dataDir = tmp();
  const settings = { homeRows: [{ id: "picks" }] };
  // The settings path is a DIRECTORY, so the write fails.
  const bad = path.join(dataDir, "settings.json");
  fs.mkdirSync(bad);
  fs.mkdirSync(bad + ".tmp");
  const F = loadIndexFunctions(
    ["backupApply", "backupWriteJson", "backupRestoreLater", "listenLaterServices", "listenLaterSources",
     "albumKey", "canonText", "canonArtist", "normalize"],
    {
      BACKUP: B, fs, path, HQP_DATA_DIR: dataDir, labelsDb: db, console: { log() {}, error() {}, warn() {} },
      loadPersistedSettings: () => settings, SETTINGS_FILE: bad, USER_PL_FILE: path.join(dataDir, "pl.json"),
      settingsFrozen: false, settingsVersion: 0, laterVersion: 0,
      userPlaylists: [], userPlaylistRecord: x => x, userPlMax: () => 50, userPlVersion: () => 1,
    });
  db.prepare("INSERT INTO listen_later (key, title, artist, service, album_id, image, source, ts) VALUES (?,?,?,?,?,?,?,?)")
    .run("k", "Today", "Someone", null, null, null, "album", 1);
  const b = B.parse(JSON.stringify(B.build(Object.assign({}, LIVE, { later: [] }), B.PARTS, "manual")));
  const state = {};
  assert.throws(() => F.backupApply(b, B.PARTS, state));
  assert.equal(state.changed, undefined, "nothing was replaced");
  assert.deepEqual(settings, { homeRows: [{ id: "picks" }] }, "the cache is untouched");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM listen_later").get().n, 1, "Listen later is untouched");
  fs.rmSync(dataDir, { recursive: true, force: true });
});
