#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * build.js — the Windows build (v1.9.67-t7): the executable and the payload
 * that lib/windows-release.js names, from this checkout.
 *
 *   node tools/windows/build.js [--out dist]
 *
 * Run by .github/workflows/windows.yml on a Windows runner after
 * `npm install --omit=dev`, so the node_modules it packs are Windows' own.
 * Run on Linux or macOS it builds the same thing for that platform, which is
 * how the bootstrap is tried without a Windows machine. In order:
 *
 *   1. the payload: a tar.gz of the app with its node_modules, leaving out
 *      what the release tarball leaves out (release.yml: .git, data, old,
 *      tarballs), the development tools' modules, and the output itself —
 *      by naming what goes in, since bsdtar's --exclude reaches every depth;
 *   2. the single-executable blob (node --experimental-sea-config), holding
 *      lib/windows-bootstrap.js as the script, the payload and the version
 *      as its assets;
 *   3. a copy of the node running this, with the blob injected by postject
 *      (installed into the output directory for the purpose) — Rouen.exe.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { windowsAssetNames } = require("../../lib/windows-release");
const { tarBin } = require("../../lib/updater");

const ROOT = path.resolve(__dirname, "..", "..");
const POSTJECT = "postject@1.0.0-alpha.6";
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/**
 * What the payload leaves out at the top of the checkout: the release
 * tarball's list (release.yml), plus what only a checkout has — the build's
 * own output among them. Named entries, NOT --exclude patterns: Windows' tar
 * (bsdtar) matches a pattern at every depth, so `--exclude=./dist` would
 * have taken every package's own dist/ out of node_modules with it (and
 * node-uuid's, which index.js needs before anything else).
 * @param {string} root
 * @param {string} outRel  the output directory relative to the root, "" when outside it
 * @returns {string[]}  the top-level entries to pack, sorted
 */
function payloadEntries(root, outRel) {
  const out = outRel && !outRel.startsWith("..") ? outRel.split(path.sep)[0] : null;
  const skip = new Set([".git", "old", "data", ".update", "config.json", "package-lock.json", out]);
  return fs.readdirSync(root).filter((e) => !skip.has(e) && !/\.tar\.gz$/i.test(e)).sort();
}

/**
 * Left out below the top: harmless when bsdtar also matches them deeper
 * down (another tools/lint/node_modules or node_modules/.cache is as
 * unwanted there as at the top).
 */
const NESTED_EXCLUDES = ["tools/lint/node_modules", "node_modules/.cache"];

/**
 * The tar command line for the payload.
 * @param {string} root
 * @param {string} out  absolute output directory
 * @param {string} target  the payload file
 */
function payloadArgs(root, out, target) {
  const args = ["-czf", target];
  for (const e of NESTED_EXCLUDES) args.push("--exclude=" + e);
  args.push("-C", root, ...payloadEntries(root, path.relative(root, out)));
  return args;
}

/** @param {string} cmd @param {string[]} args @param {import("node:child_process").SpawnSyncOptions} [opts] */
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: "inherit" }, opts || {}));
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(cmd + " exited " + r.status);
}

/**
 * The payload: tar.gz of the checkout with its node_modules.
 * @param {string} out  absolute output directory
 * @param {string} file  the payload's file name
 */
function buildPayload(out, file) {
  const target = path.join(out, file);
  run(tarBin(process.platform, process.env), payloadArgs(ROOT, out, target));
  return target;
}

/**
 * The single-executable config: the bootstrap, the payload and the version.
 * Absolute paths throughout, so it reads the same from any directory.
 * @param {string} out
 * @param {string} payload  absolute path of the payload
 * @param {string} version
 */
function seaConfig(out, payload, version) {
  const versionFile = path.join(out, "version.txt");
  fs.writeFileSync(versionFile, version + "\n");
  const config = {
    main: path.join(ROOT, "lib", "windows-bootstrap.js"),
    output: path.join(out, "sea-prep.blob"),
    disableExperimentalSEAWarning: true,
    assets: { "app.tgz": payload, "version.txt": versionFile },
  };
  const file = path.join(out, "sea-config.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return { file, blob: config.output };
}

/**
 * A copy of this node with the blob inside it. postject is fetched into a
 * package of its own in the output directory — never into the checkout,
 * which a later build would pack; npm installs into the nearest package.json
 * above its directory, so the directory is given one — and used through its
 * API: an npm shim on Windows cannot be started without a shell, and a
 * shell would need every path quoted.
 * @param {string} out
 * @param {string} blob
 * @param {string} exeName
 */
async function inject(out, blob, exeName) {
  const exe = path.join(out, exeName);
  fs.copyFileSync(process.execPath, exe);
  const modules = path.join(out, "postject-install");
  fs.mkdirSync(modules, { recursive: true });
  const pkg = path.join(modules, "package.json");
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: "rouen-postject-install", private: true }) + "\n");
  if (!fs.existsSync(path.join(modules, "node_modules", "postject"))) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    run(npm, ["install", "--no-save", "--no-audit", "--no-fund", "--loglevel=error", POSTJECT],
      { cwd: modules, shell: process.platform === "win32" });
  }
  const postject = createRequire(pkg)("postject");
  await postject.inject(exe, "NODE_SEA_BLOB", fs.readFileSync(blob), { sentinelFuse: SENTINEL });
  return exe;
}

/** @param {string[]} argv */
async function main(argv) {
  let out = "dist";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
    else if (argv[i] === "--out") throw new Error("--out needs a directory (usage: build.js [--out dir])");
    else throw new Error("unknown argument " + argv[i] + " (usage: build.js [--out dir])");
  }
  out = path.resolve(out);
  fs.mkdirSync(out, { recursive: true });
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const names = windowsAssetNames(version);
  // On another platform both files are that platform's, and named so: never
  // mistaken for the Windows ones, never attached to a release.
  const tag = "-" + process.platform + "-" + process.arch;
  const exeName = process.platform === "win32" ? names.exe : "Rouen-v" + version + tag;
  const payloadName = process.platform === "win32" ? names.payload : "Rouen-v" + version + tag + ".tar.gz";
  if (!fs.existsSync(path.join(ROOT, "node_modules", "express"))) {
    throw new Error("node_modules is not installed: run `npm install --omit=dev` first, the payload carries it");
  }
  console.log("[build] payload " + payloadName);
  const payload = buildPayload(out, payloadName);
  console.log("[build] blob from lib/windows-bootstrap.js, v" + version);
  const sea = seaConfig(out, payload, version);
  run(process.execPath, ["--experimental-sea-config", sea.file]);
  console.log("[build] " + exeName + " from " + process.execPath);
  const exe = await inject(out, sea.blob, exeName);
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + " MB";
  console.log("[build] done: " + exe + " (" + mb(exe) + "), " + payload + " (" + mb(payload) + ")");
}

module.exports = { payloadEntries, payloadArgs, NESTED_EXCLUDES, seaConfig, main };

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error("[build] " + e.message); process.exit(1); });
}
