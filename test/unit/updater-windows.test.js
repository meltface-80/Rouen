"use strict";
// ---------------------------------------------------------------------------
// The Windows build's one-tap update (v1.9.67-t5, lib/updater.js `windows`).
//
// A Windows install is offered every release the moment every other install
// is — the same check, the same release — and installs it from the release's
// Windows payload (lib/windows-release.js): the app with node_modules built
// for Windows, which the build carries and has no npm to install. So:
//   * the payload is the asset it downloads, never the source tarball;
//   * until the payload is on the release (windows.yml attaches it a few
//     minutes after the tarball) an install asked to update says so, and
//     installs nothing;
//   * a staged build's node_modules are applied with it, whole, and npm is
//     not run; without `modules` nothing of that changes;
//   * tar runs without a shell, so an install under a user name with a
//     space in it (C:\Users\A Name\…) unpacks at all.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createUpdater, applyStaged } = require("../../lib/updater");
const { windowsAssetNames, isWindowsPayload } = require("../../lib/windows-release");

const LATEST = "/repos/meltface-80/Rouen/releases/latest";
const TAGS = "/repos/meltface-80/Rouen/tags";
const DL = "https://github.com/meltface-80/Rouen/releases/download/v1.9.67/";
const names = windowsAssetNames("1.9.67");
const SOURCE = "MusicD-Remote-v1.9.67.tar.gz";

/** A release's assets, by name. */
const release = (assets) => ({ [LATEST]: { tag_name: "v1.9.67", html_url: "x", body: "notes",
  tarball_url: "https://api.github.com/repos/meltface-80/Rouen/tarball/v1.9.67",
  assets: assets.map((name) => ({ name, browser_download_url: DL + name })) } });

const { withGitHub } = require("../lib/fake-github");

test("the names a release carries for Windows", () => {
  assert.deepEqual(names, { exe: "Rouen-v1.9.67-windows-x64.exe", payload: "Rouen-v1.9.67-windows-x64.tar.gz" });
  assert.deepEqual(windowsAssetNames("v1.9.67-t5"), { exe: "Rouen-v1.9.67-t5-windows-x64.exe", payload: "Rouen-v1.9.67-t5-windows-x64.tar.gz" });
  assert.equal(isWindowsPayload(names.payload), true);
  assert.equal(isWindowsPayload(names.payload.toUpperCase()), true);
  assert.equal(isWindowsPayload(names.exe), false);
  assert.equal(isWindowsPayload(SOURCE), false, "the source tarball is not the payload");
  assert.equal(isWindowsPayload(null), false);
});

test("the Windows build updates from the release's Windows payload, every other install from the tarball", async (t) => {
  const all = release([SOURCE, names.exe, names.payload]);
  await t.test("THE one: the payload is what a Windows install downloads", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-upd-"));
    try {
      const w = await withGitHub(all, () => createUpdater({ owner: "meltface-80", repo: "Rouen", currentVersion: "1.9.66", dir, windows: true }).apply());
      assert.deepEqual(w.downloads, [DL + names.payload]);
      assert.equal(w.result.windows, true, "the status says which build this is");
      assert.equal(w.result.apply.error, "download HTTP 404", "the download was attempted (and 404s here)");
      const n = await withGitHub(all, () => createUpdater({ owner: "meltface-80", repo: "Rouen", currentVersion: "1.9.66", dir }).apply());
      assert.deepEqual(n.downloads, [DL + SOURCE], "every other install is exactly as it was");
      assert.equal(n.result.windows, false);
      // Whatever order GitHub lists them in: a re-upload of the tarball by hand puts the payload first.
      const flipped = await withGitHub(release([names.payload, names.exe, SOURCE]),
        () => createUpdater({ owner: "meltface-80", repo: "Rouen", currentVersion: "1.9.66", dir }).apply());
      assert.deepEqual(flipped.downloads, [DL + SOURCE], "a Linux install took the Windows payload because it was listed first");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await t.test("no payload on the release yet: the update is seen, and installing it says why not", async () => {
    for (const [what, answers] of [["only the tarball", release([SOURCE])], ["a bare tag, no release", { [TAGS]: [{ name: "v1.9.67" }] }]]) {
      const w = await withGitHub(answers, async () => {
        const u = createUpdater({ owner: "meltface-80", repo: "Rouen", currentVersion: "1.9.66", dir: "/nonexistent", windows: true });
        const st = await u.checkNow();
        assert.equal(st.available, true, what + ": the release is seen — the check is the same as everyone's");
        assert.equal(st.latest, "1.9.67");
        return u.apply();
      });
      assert.deepEqual(w.downloads, [], what + ": nothing downloaded — a source tarball cannot carry Windows' node_modules");
      assert.equal(w.result.apply.phase, "error");
      assert.match(w.result.apply.error, /Windows build of v1\.9\.67 is not on the release yet/, what);
    }
  });
});

/** A fake npm on PATH that records it ran. */
function withFakeNpm(fn) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-npm-"));
  const marker = path.join(bin, "ran");
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\necho \"$@\" > \"" + marker + "\"\n", { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + savedPath;
  try { return fn(() => fs.existsSync(marker)); }
  finally { process.env.PATH = savedPath; fs.rmSync(bin, { recursive: true, force: true }); }
}

/** An install and a staged build whose dependencies differ from it. */
function stagedPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-apply-"));
  const target = path.join(root, "app"), staged = path.join(root, "staged");
  fs.mkdirSync(path.join(target, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ version: "1", dependencies: { dep: "1" } }));
  fs.writeFileSync(path.join(target, "node_modules", "dep", "index.js"), "old");
  fs.mkdirSync(path.join(target, "node_modules", "dropped"), { recursive: true });
  fs.writeFileSync(path.join(target, "node_modules", "dropped", "index.js"), "a package the new release no longer has");
  fs.mkdirSync(path.join(staged, "node_modules", "dep", "cache"), { recursive: true });
  fs.writeFileSync(path.join(staged, "package.json"), JSON.stringify({ version: "2", dependencies: { dep: "2" } }));
  fs.writeFileSync(path.join(staged, "node_modules", "dep", "index.js"), "new");
  fs.writeFileSync(path.join(staged, "node_modules", "dep", "cache", "x"), "kept");
  fs.writeFileSync(path.join(staged, "index.js"), "new app");
  return { root, target, staged };
}

test("a staged build's node_modules: applied whole with `modules`, installed by npm without", async (t) => {
  await t.test("modules: swapped in whole, cache directories and all, a dropped package gone, and npm is not run", () => {
    const p = stagedPair();
    try {
      withFakeNpm((npmRan) => {
        applyStaged(p.staged, p.target, { modules: true });
        assert.equal(fs.readFileSync(path.join(p.target, "node_modules", "dep", "index.js"), "utf8"), "new");
        assert.equal(fs.readFileSync(path.join(p.target, "node_modules", "dep", "cache", "x"), "utf8"), "kept");
        assert.equal(fs.readFileSync(path.join(p.target, "index.js"), "utf8"), "new app");
        assert.ok(!fs.existsSync(path.join(p.target, "node_modules", "dropped")), "npm prunes on Linux; nothing else would here");
        assert.ok(!fs.existsSync(path.join(p.target, "node_modules.old")), "the old tree is removed");
        assert.equal(npmRan(), false, "npm must not run: the Windows build has none");
      });
    } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
  });
  await t.test("without: node_modules untouched, npm install run for the changed dependencies (as before)", () => {
    const p = stagedPair();
    try {
      withFakeNpm((npmRan) => {
        applyStaged(p.staged, p.target, {});
        assert.equal(fs.readFileSync(path.join(p.target, "node_modules", "dep", "index.js"), "utf8"), "old");
        assert.ok(fs.existsSync(path.join(p.target, "node_modules", "dropped")));
        assert.equal(npmRan(), true);
      });
    } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
  });
});

/** A real tar.gz of a build with index.js and package.json, as a release carries. */
function buildTarball(dir, version) {
  const src = path.join(dir, "build");
  fs.mkdirSync(path.join(src, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(src, "package.json"), JSON.stringify({ version }));
  fs.writeFileSync(path.join(src, "index.js"), "new");
  fs.writeFileSync(path.join(src, "node_modules", "dep", "index.js"), "new dep");
  const tgz = path.join(dir, "build.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", tgz, "-C", src, "."]).status, 0);
  return tgz;
}

test("an install under a path with a space in it unpacks, and stages what the launcher must apply", async (t) => {
  // apply() ends by exiting 75 for the launcher: held here.
  const savedExit = process.exit;
  const exits = [];
  process.exit = (c) => { exits.push(c); };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rouen space "));
  try {
    const tgz = buildTarball(work, "1.9.67");
    for (const windows of [true, false]) {
      await t.test(windows ? "the Windows build: READY says modules" : "any other install: READY says no modules", async () => {
        const dir = path.join(work, windows ? "win app" : "other app");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.9.66" }));
        const files = { [DL + names.payload]: tgz, [DL + SOURCE]: tgz };
        const u = createUpdater({ owner: "meltface-80", repo: "Rouen", currentVersion: "1.9.66", dir, windows, viaLauncher: true });
        const { result } = await withGitHub(release([SOURCE, names.exe, names.payload]), () => u.apply(), files);
        assert.equal(result.apply.error, null, "apply failed: " + result.apply.error);
        assert.equal(result.apply.phase, "restarting");
        const ready = JSON.parse(fs.readFileSync(path.join(dir, ".update", "READY"), "utf8"));
        assert.equal(ready.version, "1.9.67");
        assert.equal(ready.modules, windows);
        assert.equal(fs.readFileSync(path.join(ready.staged, "index.js"), "utf8"), "new", "the build is staged where READY says");
        assert.equal(fs.readFileSync(path.join(dir, "package.json"), "utf8"), JSON.stringify({ version: "1.9.66" }),
          "nothing applied yet: that is the launcher's, between two runs");
      });
    }
    await new Promise((r) => { setTimeout(r, 600); });
    assert.deepEqual(exits, [75, 75], "each apply asks the launcher for the restart");
  } finally { process.exit = savedExit; fs.rmSync(work, { recursive: true, force: true }); }
});
