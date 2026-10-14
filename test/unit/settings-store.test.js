"use strict";
// ---------------------------------------------------------------------------
// Rouen's settings as stored (lib/settings.js, moved out of index.js in
// v1.9.22, behaviour unchanged): one object for every reader, saved in place,
// its version moved by every save, and no write once a restore has frozen it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSettingsStore } = require("../../lib/settings");

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "cache", "settings.json");
  return { file, s: createSettingsStore({ file, dir: path.join(dir, "cache"), warn() {}, error() {} }) };
}

test("none saved yet: the defaults; a save writes the whole object and moves the version", (t) => {
  const { file, s } = store(t);
  assert.deepEqual(s.load(), {});
  assert.equal(s.save({ a: 1 }), true);
  assert.equal(s.save({ b: 2 }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 1, b: 2 });
  assert.equal(s.version(), 2);
});

test("every reader holds the one object: a save is seen by a copy read before it", (t) => {
  const { s } = store(t);
  const before = s.load();
  s.save({ homeRows: [] });
  assert.equal(s.load(), before, "THE one: a reader kept an old copy");
  assert.deepEqual(before.homeRows, []);
});

test("read back from disk by a new store (a restart)", (t) => {
  const { file, s } = store(t);
  s.save({ roonDirect: { on: true } });
  const again = createSettingsStore({ file, dir: path.dirname(file) });
  assert.deepEqual(again.load(), { roonDirect: { on: true } });
});

test("frozen after a restore: every write refused, nothing on disk moves", (t) => {
  const { file, s } = store(t);
  s.save({ a: 1 });
  s.freeze();
  assert.equal(s.frozen(), true);
  assert.equal(s.save({ a: 2 }), false, "THE one: a write after a restore put back an old value");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 1 });
  s.bump();
  assert.equal(s.version(), 2, "a restore moves the version the screens follow");
});

test("a save that cannot be written: false, and the version stays", (t) => {
  const { s } = store(t);
  const broken = createSettingsStore({ file: "/x", dir: "/x", error() {},
    fs: { readFileSync() { throw new Error("none"); }, mkdirSync() {}, writeFileSync() { throw new Error("disk full"); } } });
  assert.equal(broken.save({ a: 1 }), false);
  assert.equal(broken.version(), 0);
  assert.equal(s.version(), 0);
});

// v1.9.26 (the review): the account lives in the settings, and a file cut
// short reads as no settings — no account — so a save is whole or nothing.
test("a save is written whole or not at all: a failed rename leaves the file as it was", (t) => {
  const { file, s } = store(t);
  s.save({ login: { user: "Lewis", hash: "h" } });
  const before = fs.readFileSync(file, "utf8");
  const real = fs.renameSync;
  const failing = createSettingsStore({ file, dir: path.dirname(file), warn() {}, error() {},
    fs: { readFileSync: fs.readFileSync, mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync,
          renameSync: () => { throw new Error("power cut"); } } });
  failing.load();
  assert.equal(failing.save({ other: 1 }), false);
  assert.equal(fs.readFileSync(file, "utf8"), before, "THE one: the settings file was written in place, and is cut short by a crash");
  assert.equal(typeof real, "function");
});
