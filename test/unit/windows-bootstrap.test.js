"use strict";
// ---------------------------------------------------------------------------
// lib/windows-bootstrap.js (v1.9.67-t5): the script inside Rouen.exe.
//
// It runs before the app is on disk, from Node's own modules only, so two
// small things it needs are its own copies of the updater's: the order of
// versions and which tar to run. Both are held to the updater's answers
// here. The rest is driven whole, against a real payload made with tar: a
// first run unpacks it and starts the launcher in a second executable; a
// second run of the same version unpacks nothing; an install an in-app update
// made newer is kept; a newer executable unpacks over the install with
// data/ and config.json untouched; a non-zero stop waits for Enter.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const boot = require("../../lib/windows-bootstrap");
const updater = require("../../lib/updater");

const ROOT = path.join(__dirname, "..", "..");

test("versions are ordered as the updater orders them", () => {
  const table = ["1.9.66", "1.9.66-t2", "1.9.66-t10", "1.9.66-t9", "1.9.67-t1", "1.9.65", "v1.9.66", "2.0.0", "1.10.0", "1.9.66-beta", "x", "1.2",
    "1.2.3+5", " 1.2.3 ", "1.9.66-T3"];
  for (const a of table) for (const b of table) {
    assert.equal(boot.cmpVer(a, b), updater.cmpVer(a, b), `cmpVer(${a}, ${b})`);
    assert.equal(boot.newer(a, b), updater.verGt(a, b), `newer(${a}, ${b})`);
  }
  assert.equal(boot.newer("1.9.66", "1.9.66-t16"), true, "the stable release follows its test builds");
  assert.equal(boot.newer("1.9.66-t10", "1.9.66-t9"), true, "test numbers count as numbers");
});

test("the tar to run is the updater's choice: Windows' own in System32, else PATH's", () => {
  const sysRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-sysroot-"));
  try {
    for (const [platform, env] of [["win32", { SystemRoot: sysRoot }], ["win32", {}], ["linux", { SystemRoot: sysRoot }]]) {
      assert.equal(boot.tarBin(platform, env), updater.tarBin(platform, env), platform + " without System32\\tar.exe");
      assert.equal(boot.tarBin(platform, env), "tar");
    }
    fs.mkdirSync(path.join(sysRoot, "System32"));
    fs.writeFileSync(path.join(sysRoot, "System32", "tar.exe"), "");
    const sys = path.join(sysRoot, "System32", "tar.exe");
    assert.equal(boot.tarBin("win32", { SystemRoot: sysRoot }), sys);
    assert.equal(updater.tarBin("win32", { SystemRoot: sysRoot }), sys);
    assert.equal(boot.tarBin("linux", { SystemRoot: sysRoot }), "tar", "Linux never runs a System32 tar");
  } finally { fs.rmSync(sysRoot, { recursive: true, force: true }); }
});

test("where Rouen lives", () => {
  assert.equal(boot.homeDir({ LOCALAPPDATA: "C:\\Users\\A Name\\AppData\\Local" }, "win32", "C:\\Users\\A Name"),
    path.join("C:\\Users\\A Name\\AppData\\Local", "Rouen"));
  assert.equal(boot.homeDir({}, "win32", "/h"), path.join("/h", ".rouen"), "no LOCALAPPDATA: under the home directory");
  assert.equal(boot.homeDir({ LOCALAPPDATA: "C:\\x" }, "linux", "/h"), path.join("/h", ".rouen"), "LOCALAPPDATA is Windows' alone");
  assert.equal(boot.homeDir({ RRA_HOME: "/elsewhere", LOCALAPPDATA: "C:\\x" }, "win32", "/h"), "/elsewhere", "RRA_HOME wins everywhere");
});

test("the plan: install, update, or keep — never a downgrade", () => {
  assert.equal(boot.plan("1.9.67", null), "install");
  assert.equal(boot.plan("1.9.67", "1.9.67"), "keep");
  assert.equal(boot.plan("1.9.67", "1.9.66"), "update");
  assert.equal(boot.plan("1.9.67", "1.9.67-t5"), "update", "the stable release over its test build");
  assert.equal(boot.plan("1.9.67", "1.9.68-t1"), "keep", "an in-app update made the install newer: it stays");
  assert.equal(boot.plan("1.9.67", "garbage"), "keep", "an unreadable version is not overwritten by guesswork");
  assert.equal(boot.plan("1.9.67", "1.9.67", true), "install", "the last unpack did not finish: again, whatever the versions say");
  assert.equal(boot.plan("1.9.67", "1.9.68", true), "install");
});

test("the installed version is read from the app's package.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-app-"));
  try {
    assert.equal(boot.installedVersion(dir), null, "nothing there");
    fs.writeFileSync(path.join(dir, "package.json"), "{ not json");
    assert.equal(boot.installedVersion(dir), null, "unreadable");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.9.67-t5" }));
    assert.equal(boot.installedVersion(dir), "1.9.67-t5");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * A payload like the build's: the app's files, its lib/updater.js (the real
 * one — it does the unpacking) and node_modules, as a tar.gz made from ".".
 * launcher.js and index.js here only record that they ran.
 */
function makePayload(version, dir) {
  const src = path.join(dir, "src-" + version);
  fs.mkdirSync(path.join(src, "lib"), { recursive: true });
  fs.mkdirSync(path.join(src, "node_modules", "dep", "cache"), { recursive: true });
  fs.writeFileSync(path.join(src, "package.json"), JSON.stringify({ version, dependencies: { dep: version } }));
  fs.writeFileSync(path.join(src, "index.js"), "module.exports = 'index';\n");
  fs.writeFileSync(path.join(src, "launcher.js"),
    "require('fs').writeFileSync(process.env.RRA_PROBE, JSON.stringify({ ran: 'launcher', dir: __dirname, exe: process.env.RRA_WINDOWS_EXE }));\n");
  fs.writeFileSync(path.join(src, "config.json"), JSON.stringify({ fromPayload: version }));
  for (const f of ["updater.js", "windows-release.js"]) fs.copyFileSync(path.join(ROOT, "lib", f), path.join(src, "lib", f));
  fs.writeFileSync(path.join(src, "node_modules", "dep", "index.js"), "module.exports = '" + version + "';\n");
  fs.writeFileSync(path.join(src, "node_modules", "dep", "cache", "x"), "a package's own cache directory");
  const tgz = path.join(dir, "payload-" + version + ".tar.gz");
  const r = spawnSync("tar", ["-czf", tgz, "-C", src, "."], { stdio: "inherit" });
  assert.equal(r.status, 0, "tar failed");
  return fs.readFileSync(tgz);
}

/** A run of the executable: fake process, recorded. */
function rig(home, version, payload, tty) {
  const log = [];
  const spawned = [];
  const children = [];
  const exits = [];
  let assets = 0;
  const stdin = Object.assign(new EventEmitter(), { isTTY: !!tty, resume() { this.resumed = true; } });
  const probe = path.join(home, "probe.json");
  const d = {
    env: { RRA_HOME: home, RRA_PROBE: probe, PATH: process.env.PATH, HOME: process.env.HOME, PORT: "3400" },
    execPath: "/opt/Rouen.exe", platform: "linux", homedir: "/nowhere",
    getAsset: (name) => {
      // Fresh ArrayBuffers, as sea.getAsset() gives: a small Buffer's .buffer is Node's shared pool.
      if (name === "version.txt") return Uint8Array.from(Buffer.from(version + "\n")).buffer;
      if (name === "app.tgz") { assets++; return Uint8Array.from(payload).buffer; }
      throw new Error("no asset " + name);
    },
    log: (...a) => log.push(a.join(" ")),
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); const c = new EventEmitter(); children.push(c); return c; },
    stdin, exit: (c) => exits.push(c),
  };
  boot.main(d);
  return { log, spawned, children, exits, stdin, probe, payloadReads: () => assets, app: path.join(home, "app") };
}

test("Rouen.exe: unpack once, run the launcher in a second executable, keep what the person has", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rouen home "));   // a space, as under C:\Users\A Name
  const home = path.join(tmp, "Rouen");
  try {
    const p1 = makePayload("1.9.67", tmp);
    const p2 = makePayload("1.9.68", tmp);

    await t.test("THE one: the first run unpacks the payload, node_modules whole, and starts the launcher", () => {
      const r = rig(home, "1.9.67", p1);
      assert.equal(r.payloadReads(), 1);
      assert.match(r.log.join("\n"), /first run: unpacking Rouen v1\.9\.67/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(r.app, "package.json"), "utf8")).version, "1.9.67");
      assert.equal(fs.readFileSync(path.join(r.app, "node_modules", "dep", "cache", "x"), "utf8"), "a package's own cache directory",
        "the build's node_modules are copied whole — the overlay's `cache` skip is for the app's own");
      assert.ok(!fs.existsSync(path.join(home, "unpack")), "the staging directory is removed");
      assert.ok(!fs.existsSync(path.join(home, "payload.tar.gz")), "the payload file is removed");
      assert.ok(!fs.existsSync(boot.unpackingMarker(home)), "the unpack finished: its marker is gone");
      assert.equal(r.spawned.length, 1);
      const [s] = r.spawned;
      assert.equal(s.cmd, "/opt/Rouen.exe", "the launcher runs in a second copy of the executable");
      assert.deepEqual(s.args, []);
      assert.equal(s.opts.env.RRA_ENTRY, path.join(r.app, "launcher.js"), "told to run launcher.js");
      assert.equal(s.opts.env.RRA_WINDOWS_EXE, "/opt/Rouen.exe", "the app knows it is the Windows build (lib/update-routes.js)");
      assert.equal(s.opts.env.RRA_HOME, home, "the environment is passed on");
      assert.equal(s.opts.stdio, "inherit", "its output is this console's");
      assert.match(r.log.join("\n"), /http:\/\/localhost:3400\//, "says where Rouen is, on PORT");
      // a clean stop
      r.children[0].emit("exit", 0, null);
      assert.deepEqual(r.exits, [0]);
    });

    await t.test("the second copy, told what to run, runs it and nothing else", () => {
      // The file runs in this very process, so it reads the real environment.
      process.env.RRA_PROBE = path.join(home, "probe.json");
      process.env.RRA_WINDOWS_EXE = "/opt/Rouen.exe";
      let r;
      try { r = rigEntry(home, path.join(home, "app", "launcher.js")); }
      finally { delete process.env.RRA_PROBE; delete process.env.RRA_WINDOWS_EXE; }
      const probe = JSON.parse(fs.readFileSync(path.join(home, "probe.json"), "utf8"));
      assert.equal(probe.ran, "launcher");
      assert.equal(probe.dir, path.join(home, "app"), "launcher.js runs from the install, as a file on disk");
      assert.equal(probe.exe, "/opt/Rouen.exe");
      assert.equal(r.spawned.length, 0, "the entry copy unpacks and spawns nothing");
      assert.equal(r.payloadReads(), 0);
    });

    await t.test("the same executable again: nothing unpacked, the install runs", () => {
      fs.mkdirSync(path.join(home, "app", "data"), { recursive: true });
      fs.writeFileSync(path.join(home, "app", "data", "roonstate.json"), "pairing");
      fs.writeFileSync(path.join(home, "app", "config.json"), "the person's");
      const r = rig(home, "1.9.67", p1);
      assert.equal(r.payloadReads(), 0, "the payload is not even read");
      assert.equal(r.spawned.length, 1);
      assert.doesNotMatch(r.log.join("\n"), /unpacking/);
    });

    await t.test("an install an in-app update made newer is kept: the executable never downgrades it", () => {
      const pkg = path.join(home, "app", "package.json");
      fs.writeFileSync(pkg, JSON.stringify({ version: "1.9.68-t1" }));
      const r = rig(home, "1.9.67", p1);
      assert.equal(r.payloadReads(), 0);
      assert.equal(JSON.parse(fs.readFileSync(pkg, "utf8")).version, "1.9.68-t1");
      assert.match(r.log.join("\n"), /keeping the install, v1\.9\.68-t1/);
      assert.match(r.log.join("\n"), /Rouen v1\.9\.68-t1 runs from/, "the version said is the one that runs");
      fs.writeFileSync(pkg, JSON.stringify({ version: "1.9.67" }));
    });

    await t.test("a newer executable unpacks over the install, and data/ and config.json stay", () => {
      const r = rig(home, "1.9.68", p2);
      assert.equal(r.payloadReads(), 1);
      assert.match(r.log.join("\n"), /the install is v1\.9\.67: unpacking the newer/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(r.app, "package.json"), "utf8")).version, "1.9.68");
      assert.equal(fs.readFileSync(path.join(r.app, "node_modules", "dep", "index.js"), "utf8"), "module.exports = '1.9.68';\n",
        "node_modules are updated with the app");
      assert.equal(fs.readFileSync(path.join(r.app, "data", "roonstate.json"), "utf8"), "pairing", "data/ is not in a payload");
      assert.equal(fs.readFileSync(path.join(r.app, "config.json"), "utf8"), "the person's", "config.json is never overlaid");
    });

    await t.test("an unpack that did not finish is done again, whatever package.json says", () => {
      // The console closed part-way: package.json copied, node_modules not.
      fs.writeFileSync(boot.unpackingMarker(home), "");
      fs.rmSync(path.join(home, "app", "node_modules"), { recursive: true });
      const r = rig(home, "1.9.68", p2);
      assert.equal(r.payloadReads(), 1, "the same version was unpacked again");
      assert.match(r.log.join("\n"), /the last unpack did not finish: unpacking Rouen v1\.9\.68/);
      assert.ok(fs.existsSync(path.join(r.app, "node_modules", "dep", "index.js")));
      assert.ok(!fs.existsSync(boot.unpackingMarker(home)));
    });

    await t.test("an unpack that fails says so and holds the console; the marker stays for the next run", () => {
      const r = rig(home, "1.9.69", Buffer.from("not a tar.gz"), true);
      assert.equal(r.spawned.length, 0, "nothing started");
      assert.match(r.log[r.log.length - 1], /could not be unpacked: could not unpack the payload.*Press Enter/);
      assert.ok(fs.existsSync(boot.unpackingMarker(home)));
      assert.deepEqual(r.exits, []);
      r.stdin.emit("data", Buffer.from("\n"));
      assert.deepEqual(r.exits, [1]);
      fs.rmSync(boot.unpackingMarker(home));
    });

    await t.test("a stop with an error holds the console until Enter; a kill does not", () => {
      const r = rig(home, "1.9.68", p2);
      r.stdin.isTTY = true;
      r.children[0].emit("exit", 3, null);
      assert.deepEqual(r.exits, [], "not gone yet");
      assert.match(r.log[r.log.length - 1], /exit code 3.*Press Enter/);
      assert.equal(r.stdin.resumed, true);
      r.stdin.emit("data", Buffer.from("\n"));
      assert.deepEqual(r.exits, [3], "the code is kept");
      const k = rig(home, "1.9.68", p2);
      k.stdin.isTTY = true;
      k.children[0].emit("exit", null, "SIGTERM");
      assert.deepEqual(k.exits, [1], "killed: no waiting on a console nobody is reading");
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

/** A run with RRA_ENTRY set — the second and third copy. */
function rigEntry(home, entry) {
  const spawned = [];
  let assets = 0;
  boot.main({
    env: { RRA_ENTRY: entry, RRA_HOME: home, RRA_PROBE: path.join(home, "probe.json"), RRA_WINDOWS_EXE: "/opt/Rouen.exe" },
    execPath: "/opt/Rouen.exe", platform: "linux", homedir: "/nowhere",
    getAsset: () => { assets++; throw new Error("not read"); },
    log: () => {}, spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return new EventEmitter(); },
    stdin: { isTTY: false, once() {}, resume() {} }, exit: () => {},
  });
  return { spawned, payloadReads: () => assets };
}

test("a payload without the updater is refused, and nothing is half-installed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-bad-"));
  try {
    const src = path.join(tmp, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "package.json"), JSON.stringify({ version: "9.9.9" }));
    spawnSync("tar", ["-czf", path.join(tmp, "p.tgz"), "-C", src, "."]);
    const payload = fs.readFileSync(path.join(tmp, "p.tgz"));
    assert.throws(() => boot.unpack(payload, path.join(tmp, "home"), { log() {}, platform: "linux", env: {} }), /no lib\/updater\.js/);
    assert.ok(!fs.existsSync(path.join(tmp, "home", "app", "package.json")));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
