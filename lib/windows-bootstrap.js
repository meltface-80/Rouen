// @ts-check
"use strict";
/*
 * windows-bootstrap.js — the script inside Rouen.exe (v1.9.67-t5).
 *
 * The Windows build is a Node single-executable application: node.exe with
 * this file, the build's payload (the app and its node_modules built for
 * Windows, as a tar.gz; lib/windows-release.js) and its version inside,
 * made by tools/windows/build.js. Run, it
 *
 *   1. unpacks the payload into %LOCALAPPDATA%\Rouen\app the first time, and
 *      again when the executable holds a newer version than the install —
 *      never an older one, so an in-app update stays — with data/ and
 *      config.json (the pairing, the account, the history) left as they are;
 *   2. runs launcher.js from there in a second Rouen.exe, which supervises
 *      index.js in a third, as `npm start` does on Linux. The one-tap update
 *      then downloads the release's Windows payload, stages it, and the
 *      launcher applies it between two runs (lib/updater.js,
 *      lib/relaunch.js): a Windows install is offered every release the
 *      moment every other install is, and installs it the same way;
 *   3. keeps the console open when Rouen stops with an error, so the reason
 *      can be read before the window goes.
 *
 * A single executable always runs the script inside it, whatever the command
 * line says, so a copy started with RRA_ENTRY set runs that file instead
 * (launcher.js, then index.js): one executable, three programs. The
 * launcher could run in this process; it runs in its own so that nothing
 * the install's code does — an exception, a process.exit — takes this
 * process, which holds the console, with it.
 *
 * Only Node's own modules are used here: a single executable's `require`
 * reaches nothing else, and an install on disk — the previous version's, or
 * a broken one this run is about to repair — is not something to run before
 * deciding whether to replace it. So two small things are kept in step with
 * lib/updater.js by test rather than shared: the order of versions, and
 * which tar to run.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { createRequire } = require("module");

// ---- versions, in the updater's order (lib/updater.js parseVer / cmpVer) ----
/** @param {string | null | undefined} tag */
function parseVer(tag) {
  if (tag == null) return null;
  const m = String(tag).trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null };
}
/** @param {string} a @param {string} b */
function cmpVer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  if (!pa || !pb) return 0;
  for (const k of /** @type {const} */ (["major", "minor", "patch"])) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) {
    const ta = /^t(\d+)$/i.exec(pa.pre), tb = /^t(\d+)$/i.exec(pb.pre);
    if (ta && tb) return Math.sign(+ta[1] - +tb[1]);
    return pa.pre > pb.pre ? 1 : (pa.pre < pb.pre ? -1 : 0);
  }
  return 0;
}
/** Whether a is a newer version than b. @param {string} a @param {string} b */
function newer(a, b) { return cmpVer(a, b) > 0; }

/** The tar to unpack with: Windows' own in System32, else the one on PATH (lib/updater.js tarBin). */
function tarBin(platform, env) {
  if (platform === "win32") {
    const sys = path.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (fs.existsSync(sys)) return sys;
  }
  return "tar";
}

/**
 * Where Rouen lives: %LOCALAPPDATA%\Rouen on Windows, ~/.rouen elsewhere,
 * RRA_HOME anywhere.
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @param {string} homedir
 */
function homeDir(env, platform, homedir) {
  if (env.RRA_HOME) return env.RRA_HOME;
  if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "Rouen");
  return path.join(homedir, ".rouen");
}

/** The version installed in appDir, or null when there is none. @param {string} appDir */
function installedVersion(appDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;
    return typeof v === "string" && v ? v : null;
  } catch (e) {
    return null; // no app there yet, or no readable package.json: the payload is unpacked
  }
}

/**
 * What to do with the payload: "install" when nothing is there, or the last
 * unpack never finished (its marker is still there: the console closed
 * part-way, say, with package.json copied and node_modules not — which
 * would otherwise read as a finished install of this version); "update"
 * when the executable is newer than the install; "keep" otherwise (the
 * install is this version, or a newer one an in-app update put there).
 * @param {string} embedded  the executable's version
 * @param {string | null} installed
 * @param {boolean} [unfinished]  an unpack was started and not completed
 */
function plan(embedded, installed, unfinished) {
  if (!installed || unfinished) return "install";
  return newer(embedded, installed) ? "update" : "keep";
}

/** The marker of an unpack in progress: written first, removed last. @param {string} home */
function unpackingMarker(home) { return path.join(home, "unpacking"); }

/**
 * Unpack the payload over the app: into a staging directory first, then
 * applied with the updater's own overlay — the staged copy's, since the one
 * on disk, if any, is the old version's — which leaves data/ and config.json
 * alone and copies node_modules whole.
 * @param {Buffer} payload  the tar.gz
 * @param {string} home
 * @param {{ log: (...a: any[]) => void, platform: string, env: Record<string, string | undefined> }} d
 */
function unpack(payload, home, d) {
  const stage = path.join(home, "unpack");
  const tgz = path.join(home, "payload.tar.gz");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(unpackingMarker(home), "");
  try {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(tgz, payload);
    const ex = spawnSync(tarBin(d.platform, d.env), ["-xzf", tgz, "-C", stage], { stdio: "ignore" });
    if (ex.status !== 0) throw new Error("could not unpack the payload (tar exited " + ex.status + "; Windows 10 1803 and later have it)");
    // The payload is the app itself, packed at its top (tools/windows/build.js).
    const root = stage;
    const updaterFile = path.join(root, "lib", "updater.js");
    if (!fs.existsSync(updaterFile)) throw new Error("the payload holds no lib/updater.js");
    const updater = createRequire(updaterFile)(updaterFile);
    const app = path.join(home, "app");
    fs.mkdirSync(app, { recursive: true });
    updater.applyStaged(root, app, { log: d.log, modules: true });
    fs.rmSync(unpackingMarker(home), { force: true });
    return app;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(tgz, { force: true });
  }
}

/**
 * Open the page in the default browser — on the first run only, when the
 * person has nothing else telling them where Rouen is.
 * @param {typeof spawn} spawnFn
 * @param {string} url
 * @param {(...a: any[]) => void} log
 */
function openBrowser(spawnFn, url, log) {
  try {
    spawnFn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch (e) {
    log("could not open the browser (" + e.message + "): open " + url + " yourself");
  }
}

/**
 * @param {{ env: Record<string, string | undefined>, execPath: string, platform: string, homedir: string,
 *   getAsset: (name: string) => ArrayBuffer, log: (...a: any[]) => void, spawn: typeof spawn,
 *   stdin: { isTTY?: boolean, once: (ev: string, fn: () => void) => any, resume: () => any },
 *   exit: (code: number) => void }} d
 */
function main(d) {
  // The second and third process: run the file named, nothing else.
  if (d.env.RRA_ENTRY) {
    const entry = d.env.RRA_ENTRY;
    createRequire(entry)(entry);
    return;
  }

  // Stop with the reason on screen: a double-clicked executable's console
  // closes with it, and the reason with the console.
  const stop = (/** @type {number} */ code, /** @type {string} */ why) => {
    if (code !== 0 && d.stdin.isTTY) {
      d.log(why + " Press Enter to close this window.");
      d.stdin.once("data", () => d.exit(code));
      d.stdin.resume();
      return;
    }
    d.exit(code);
  };

  const home = homeDir(d.env, d.platform, d.homedir);
  const app = path.join(home, "app");
  let what, embedded, installed;
  try {
    embedded = Buffer.from(d.getAsset("version.txt")).toString("utf8").trim();
    installed = installedVersion(app);
    what = plan(embedded, installed, fs.existsSync(unpackingMarker(home)));
    if (what === "install") d.log((installed ? "the last unpack did not finish: " : "first run: ") + "unpacking Rouen v" + embedded + " into " + app);
    else if (what === "update") d.log("this is Rouen v" + embedded + " and the install is v" + installed + ": unpacking the newer");
    else if (installed !== embedded) d.log("keeping the install, v" + installed + " (this executable holds v" + embedded + ")");
    if (what !== "keep") unpack(Buffer.from(d.getAsset("app.tgz")), home, { log: d.log, platform: d.platform, env: d.env });
  } catch (e) {
    stop(1, "Rouen could not be unpacked: " + e.message + ".");
    return;
  }

  const url = "http://localhost:" + (d.env.PORT || "3399") + "/";
  d.log("Rouen v" + (what === "keep" ? installed : embedded) + " runs from " + app + " — open " + url + " — close this window to stop it");
  const child = d.spawn(d.execPath, [], { stdio: "inherit", env: Object.assign({}, d.env, {
    RRA_ENTRY: path.join(app, "launcher.js"), RRA_WINDOWS_EXE: d.execPath,
  }) });
  if (what === "install" && d.platform === "win32") setTimeout(() => openBrowser(d.spawn, url, d.log), 4000);
  child.on("exit", (code) => {
    // Killed (code null): no waiting on a console nobody is reading.
    if (code == null) d.exit(1);
    else stop(code, "Rouen stopped (exit code " + code + ").");
  });
}

module.exports = { cmpVer, newer, tarBin, homeDir, installedVersion, plan, unpackingMarker, unpack, main };

// Inside the executable this is the main script, and runs. Anywhere else —
// a test, node given this file — it only exports.
let sea = null;
try { sea = require("node:sea"); }
catch (e) { sea = null; /* Node before 20.12 has no node:sea, and is never a single executable */ }
if (sea && sea.isSea()) {
  main({
    env: process.env, execPath: process.execPath, platform: process.platform, homedir: os.homedir(),
    getAsset: (name) => sea.getAsset(name), log: (...a) => console.log("[rouen]", ...a),
    spawn, stdin: process.stdin, exit: (c) => process.exit(c),
  });
}
