"use strict";
// ---------------------------------------------------------------------------
// lib/relaunch.js (v1.9.67-t7): what launcher.js does around each run of
// index.js, moved out so the Windows build's two needs are tested — the
// staged node_modules applied when the staged build carries them, and the
// file to run named in the environment for an executable that reads nothing
// else.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { UPDATE_EXIT, applyStagedIfReady, childSpawn } = require("../../lib/relaunch");

test("index.js is started by the running executable, named the file on the command line and in RRA_ENTRY", () => {
  const c = childSpawn("/app", { PATH: "/bin", RRA_WINDOWS_EXE: "C:\\Rouen.exe" }, "C:\\Rouen.exe");
  assert.equal(c.cmd, "C:\\Rouen.exe");
  assert.deepEqual(c.args, [path.join("/app", "index.js")]);
  assert.equal(c.env.RRA_ENTRY, path.join("/app", "index.js"), "the Windows executable runs what RRA_ENTRY names");
  assert.equal(c.env.RRA_VIA_LAUNCHER, "1", "index.js stages updates for the launcher to apply");
  assert.deepEqual([c.env.PATH, c.env.RRA_WINDOWS_EXE], ["/bin", "C:\\Rouen.exe"], "the rest of the environment is kept");
});

test("index.js asks for the update and the restart with exit code 75, as lib/updater.js exits", () => {
  assert.equal(UPDATE_EXIT, 75);
});

// On Windows a file still open cannot be replaced, and an ffmpeg index.js
// left behind keeps its executable open a few seconds after index.js is
// gone. Here a directory where the staged build has a file stands in for it:
// the copy fails the same way, and goes through once it is gone.
test("an apply something still holds is tried again, and given up after three tries", async (t) => {
  await t.test("the second try goes through", () => {
    const dir = stagedInstall({ modules: false });
    try {
      fs.rmSync(path.join(dir, "index.js"));
      fs.mkdirSync(path.join(dir, "index.js"));   // index.js is a directory: the copy onto it fails
      const log = [], waits = [];
      const wait = (ms) => { waits.push(ms); fs.rmSync(path.join(dir, "index.js"), { recursive: true }); };
      assert.equal(applyStagedIfReady(dir, (l) => log.push(l), wait), true);
      assert.deepEqual(waits, [3000], "one wait, then the apply went through");
      assert.equal(fs.readFileSync(path.join(dir, "index.js"), "utf8"), "new");
      assert.match(log.join("\n"), /could not apply yet[\s\S]*update applied/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await t.test("three failures: given up, said, the staging directory removed", () => {
    const dir = stagedInstall({ modules: false });
    try {
      fs.rmSync(path.join(dir, "index.js"));
      fs.mkdirSync(path.join(dir, "index.js"));
      const log = [], waits = [];
      assert.equal(applyStagedIfReady(dir, (l) => log.push(l), (ms) => waits.push(ms)), false);
      assert.deepEqual(waits, [3000, 3000]);
      assert.match(log.join("\n"), /failed to apply staged update/);
      assert.ok(!fs.existsSync(path.join(dir, ".update")));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

/** An install dir with a staged build waiting in .update, as lib/updater.js leaves it. */
function stagedInstall(ready) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-relaunch-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.0.0", dependencies: { dep: "1" } }));
  fs.writeFileSync(path.join(dir, "index.js"), "old");
  fs.mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "dep", "index.js"), "old dep");
  const staged = path.join(dir, ".update", "extract");
  fs.mkdirSync(path.join(staged, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(staged, "package.json"), JSON.stringify({ version: "1.0.1", dependencies: { dep: "1" } }));
  fs.writeFileSync(path.join(staged, "index.js"), "new");
  fs.writeFileSync(path.join(staged, "node_modules", "dep", "index.js"), "new dep");
  if (ready !== null) fs.writeFileSync(path.join(dir, ".update", "READY"), typeof ready === "string" ? ready : JSON.stringify({ staged, version: "1.0.1", ...ready }));
  return dir;
}

test("the staged build is applied between two runs, its node_modules too when it carries them for this platform", async (t) => {
  for (const [modules, dep] of [[true, "new dep"], [false, "old dep"]]) {
    await t.test("READY says modules: " + modules, () => {
      const dir = stagedInstall({ modules });
      try {
        const log = [];
        assert.equal(applyStagedIfReady(dir, (l) => log.push(l)), true);
        assert.equal(fs.readFileSync(path.join(dir, "index.js"), "utf8"), "new");
        assert.equal(fs.readFileSync(path.join(dir, "node_modules", "dep", "index.js"), "utf8"), dep);
        assert.ok(!fs.existsSync(path.join(dir, ".update")), "the staging directory is gone");
        assert.match(log.join("\n"), /applying staged update -> v1\.0\.1[\s\S]*update applied/);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

test("nothing staged, a READY pointing nowhere, or an unreadable one: nothing applied, nothing left behind", async (t) => {
  await t.test("no .update at all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-relaunch-"));
    try { assert.equal(applyStagedIfReady(dir, () => {}), false); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await t.test("staged directory missing", () => {
    const dir = stagedInstall(null);
    fs.writeFileSync(path.join(dir, ".update", "READY"), JSON.stringify({ staged: path.join(dir, ".update", "gone"), version: "1.0.1" }));
    try {
      assert.equal(applyStagedIfReady(dir, () => {}), false);
      assert.equal(fs.readFileSync(path.join(dir, "index.js"), "utf8"), "old");
      assert.ok(!fs.existsSync(path.join(dir, ".update")));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await t.test("READY is not JSON", () => {
    const dir = stagedInstall("{ not json");
    try {
      const log = [];
      assert.equal(applyStagedIfReady(dir, (l) => log.push(l)), false);
      assert.match(log.join("\n"), /failed to apply staged update/);
      assert.ok(!fs.existsSync(path.join(dir, ".update")));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
