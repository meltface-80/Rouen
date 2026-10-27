// @ts-check
// lib/updater.js — in-app self-update from GitHub Releases (with a tags fallback).
//
// Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
// Released under the MIT License. See the LICENSE file for details.
//
// Strategy: ask GitHub for the latest release (or, if none, the highest semver
// tag), compare its version to the running one, and — on request — download the
// build tarball, extract it, overlay it onto the install dir, run `npm install`
// if dependencies changed, and restart. Restart is coordinated by launcher.js
// (which sets RRA_VIA_LAUNCHER=1): the running app stages the update and exits
// with code 75; the launcher applies the staged files and relaunches. When run
// without the launcher, the app applies the files itself and exits 75 so a
// process supervisor (systemd/Docker/pm2) restarts it.
//
// The PUBLISHED IMAGE (ghcr.io, `image` below) updates the same way, by one
// tap (v1.8.71 — v1.8.70 refused it, and the user wants one-tap updates kept
// for everyone). What it unpacks lives in that container, so it lasts until
// the container is recreated; the install commands carry `--pull always`, so a
// recreate fetches the current release instead of quietly restarting a stale
// local image. An image install is also given the pull command (`pull`) as an
// alternative, but only for a release that exists as an image (FIRST_IMAGE).
//
// The WINDOWS BUILD (v1.9.67-t5, `windows` below) updates the same way, from
// the release's Windows payload (lib/windows-release.js) rather than the
// source tarball: that payload carries node_modules built for Windows, and
// the build has no npm to install any. The payload is attached to the release
// a few minutes after it is cut (.github/workflows/windows.yml); until it is,
// an install asked to update says so rather than installing nothing.

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { isWindowsPayload } = require("./windows-release");

// ---- version helpers (semver-ish: major.minor.patch, prerelease < release) ----
function parseVer(tag) {
  if (tag == null) return null;
  const m = String(tag).trim().replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null };
}
function cmpVer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  if (!pa || !pb) return 0;
  for (const k of ["major", "minor", "patch"]) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  if (pa.pre && !pb.pre) return -1;   // 1.2.0-beta < 1.2.0
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) {
    // The owner's test builds (X.Y.Z-tN, 2026-10-22): their numbers count as
    // numbers, or "t10" came before "t9". Any other prerelease, as text.
    const ta = /^t(\d+)$/i.exec(pa.pre), tb = /^t(\d+)$/i.exec(pb.pre);
    if (ta && tb) return Math.sign(+ta[1] - +tb[1]);
    return pa.pre > pb.pre ? 1 : (pa.pre < pb.pre ? -1 : 0);
  }
  return 0;
}
function verGt(a, b) { return cmpVer(a, b) > 0; }

// The first version published as an image (ghcr.io, v1.8.70). Nothing older
// was ever pushed there, so an image install is never told to pull a release
// below it: the pull could not fetch that version.
const FIRST_IMAGE = "1.8.70";

// The tar to unpack a build with. Windows has one since 10 (1803): bsdtar, in
// System32, which reads a Windows path as a path. Named outright there rather
// than found on PATH, because a Git for Windows install can put GNU tar first,
// and that one reads "C:\Users\…" as a host called C to connect to
// (lib/windows-bootstrap.js keeps the same rule; it cannot load this file).
function tarBin(platform, env) {
  platform = platform || process.platform;
  env = env || process.env;
  if (platform === "win32") {
    const sys = path.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (fs.existsSync(sys)) return sys;
  }
  return "tar";
}

// Unpack a downloaded build into `dest`, with the server still serving: the
// Windows payload is some 120 MB unpacked, and a tar run synchronously held
// the event loop — the status the page polls, every Roon event — for as
// long as that took. No shell: through one, the arguments are joined
// unquoted, and a path with a space in it (C:\Users\A Name\AppData\Local\
// Rouen\app, every Windows install under a two-word user name) is cut in two.
function extract(file, dest) {
  return new Promise((resolve, reject) => {
    const tar = spawn(tarBin(), ["-xzf", file, "-C", dest], { stdio: "ignore" });
    tar.on("error", (e) => reject(new Error("extraction failed: " + e.message + " (is `tar` installed and on PATH?)")));
    tar.on("exit", (code) => code === 0 ? resolve() : reject(new Error("extraction failed (tar exited " + code + ")")));
  });
}

// A GitHub source tarball wraps everything in one top-level dir
// (owner-repo-sha/); an uploaded asset built by this project wraps it in
// roon-random-albums/. Either way, find that single top dir.
function topLevelDir(root) {
  const entries = fs.readdirSync(root);
  if (entries.length === 1 && fs.statSync(path.join(root, entries[0])).isDirectory()) {
    return entries[0];
  }
  return null;
}

// Recursively copy src over dest, skipping names in `skip` (so we never clobber
// the user's Roon pairing in config.json, node_modules, the staging dir, .git).
function copyOverlay(src, dest, skip) {
  skip = skip || [];
  for (const name of fs.readdirSync(src)) {
    if (skip.includes(name)) continue;
    const s = path.join(src, name), d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyOverlay(s, d, skip);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// ---- GitHub HTTP ----
// Follows redirects: when a repository is RENAMED, GitHub answers the old
// /repos/<owner>/<repo>/… URLs with a 301 to the new location. Without
// following it, every installed copy's update check silently reports
// "up to date" forever after a rename — the exact trap this closes ahead of
// the MusicD Remote repo rename. `apiPath` may be a path on
// api.github.com or (after a redirect) an absolute URL.
function ghGetJson(apiPath, token, redirectsLeft) {
  if (redirectsLeft == null) redirectsLeft = 6;
  return new Promise((resolve, reject) => {
    const u = /^https?:\/\//i.test(apiPath)
      ? new URL(apiPath)
      : new URL("https://api.github.com" + apiPath);
    const headers = {
      "User-Agent": "musicd-remote-updater",
      "Accept": "application/vnd.github+json"
    };
    // Never leak the token to a non-GitHub-API host a redirect may point at.
    if (token && u.hostname === "api.github.com") headers.Authorization = "Bearer " + token;
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
          // Location may be relative — resolve against the current origin.
          const next = new URL(res.headers.location, u.origin).toString();
          return resolve(ghGetJson(next, token, redirectsLeft - 1));
        }
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
            catch (e) { reject(e); }
          } else {
            resolve({ status: res.statusCode, json: null, raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("GitHub API timeout")));
    req.end();
  });
}

function downloadFile(url, dest, token, redirectsLeft) {
  if (redirectsLeft == null) redirectsLeft = 6;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      "User-Agent": "musicd-remote-updater",
      "Accept": "application/octet-stream"
    };
    // Only send the token to GitHub's own API host; never leak it to the
    // redirected storage host (codeload / object store).
    if (token && u.hostname === "api.github.com") headers.Authorization = "Bearer " + token;
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
        return resolve(downloadFile(res.headers.location, dest, token, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("download HTTP " + res.statusCode)); }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on("finish", () => f.close(() => resolve()));
      f.on("error", reject);
    }).on("error", reject);
  });
}

// Put `src` where `dest` is: the old `dest` aside, `src` moved in, the old one
// removed. Falls back to copying `src` over `dest` when a move is refused.
function swapDir(src, dest, log) {
  const old = dest + ".old";
  try {
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    fs.renameSync(src, dest);
  } catch (e) {
    log("could not move node_modules into place (" + e.message + "); copying instead");
    if (!fs.existsSync(dest) && fs.existsSync(old)) fs.renameSync(old, dest);
    fs.mkdirSync(dest, { recursive: true });
    copyOverlay(src, dest, []);
  }
  try { fs.rmSync(old, { recursive: true, force: true }); }
  catch (e) { log("the previous node_modules could not be removed (" + e.message + "); left at " + old); }
}

// Overlay a staged build onto the install dir and `npm install` if deps changed.
// Shared by the in-app updater (no-launcher path), by launcher.js (through
// lib/relaunch.js) and by the Windows executable's first run
// (lib/windows-bootstrap.js).
//
// opts.modules (the Windows build): the staged build carries its node_modules,
// built for the platform, and there is no npm. They are swapped in whole,
// after the rest — the staged tree moved into place, the old one removed, so
// a package the release dropped goes with it (npm prunes on Linux; nothing
// else ever would here) — and nothing is installed. A move that cannot be
// made (another volume) falls back to a copy, every file of it.
function applyStaged(stagedDir, targetDir, opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const readPkg = (p) => {
    try { return JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8")); }
    catch (e) { return {}; }
  };
  const oldDeps = JSON.stringify(readPkg(targetDir).dependencies || {});
  copyOverlay(stagedDir, targetDir, [".git", "node_modules", ".update", "config.json", "cache"]);
  const newDeps = JSON.stringify(readPkg(targetDir).dependencies || {});
  if (opts.modules) {
    const staged = path.join(stagedDir, "node_modules");
    if (fs.existsSync(staged)) {
      log("putting the build's node_modules in place");
      swapDir(staged, path.join(targetDir, "node_modules"), log);
    } else if (oldDeps !== newDeps) {
      log("dependencies changed, but the staged build carries no node_modules and there is no npm here: not installed");
    }
    return;
  }
  if (oldDeps !== newDeps) {
    log("dependencies changed — running npm install");
    const r = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"],
      { cwd: targetDir, stdio: "inherit", shell: true, timeout: 5 * 60 * 1000 });
    if (r.status !== 0) log("npm install exited with status " + r.status + " (continuing)");
  }
}

// ---------------------------------------------------------------------------
// Updater instance
// ---------------------------------------------------------------------------
function createUpdater(o) {
  const { owner, repo, currentVersion, dir } = o;
  const viaLauncher = !!o.viaLauncher;
  // The published image this install runs, if any ("ghcr.io/owner/name"). Set,
  // the status also carries the pull command for the image — the alternative to
  // the one-tap update, never a replacement for it (see the header).
  const image = o.image ? String(o.image).trim() : "";
  const pullCmd = image ? "docker pull " + image + ":latest" : null;
  // The Windows build (see the header): installs from the release's Windows
  // payload, node_modules included, and never from the source tarball.
  const windows = !!o.windows;
  const token = o.token || null;
  const debug = !!o.debug;
  const log = (...a) => { if (debug) console.log("[updater]", ...a); };

  const state = {
    current: currentVersion, latest: null, latestTag: null, available: false,
    isDowngrade: false, pullable: false,
    html_url: null, notes: null, source: null,
    checkedAt: 0, checking: false, error: null,
    _downloadUrl: null,
    apply: { phase: "idle", error: null, version: null }
  };
  let timer = null;

  function getStatus() {
    return {
      current: state.current, latest: state.latest, latestTag: state.latestTag,
      available: state.available, isDowngrade: state.isDowngrade,
      html_url: state.html_url, notes: state.notes,
      source: state.source, checkedAt: state.checkedAt, checking: state.checking,
      error: state.error, viaLauncher, windows,
      // pull: the image install's alternative to apply(), set only when the
      // latest release exists as an image; null everywhere else.
      image: image || null, pull: state.pullable ? pullCmd : null,
      apply: { phase: state.apply.phase, error: state.apply.error, version: state.apply.version }
    };
  }

  async function checkNow() {
    if (state.checking) return getStatus();
    state.checking = true; state.error = null;
    try {
      let rel = null, src = null;
      const r = await ghGetJson(`/repos/${owner}/${repo}/releases/latest`, token);
      if (r.status === 200 && r.json && r.json.tag_name) {
        rel = r.json; src = "release";
      } else if (r.status === 404) {
        // No published release — fall back to the highest semver tag.
        const t = await ghGetJson(`/repos/${owner}/${repo}/tags?per_page=30`, token);
        if (t.status === 200 && Array.isArray(t.json) && t.json.length) {
          let best = null;
          for (const tag of t.json) {
            if (parseVer(tag.name) && (!best || verGt(tag.name, best.name))) best = tag;
          }
          if (best) {
            src = "tags";
            rel = {
              tag_name: best.name,
              html_url: `https://github.com/${owner}/${repo}/releases/tag/${best.name}`,
              body: null, assets: [],
              _tarball: `https://api.github.com/repos/${owner}/${repo}/tarball/${best.name}`
            };
          }
        }
      } else if (r.status === 403) {
        throw new Error("GitHub rate-limited or forbidden (set RRA_GITHUB_TOKEN to raise the limit)");
      } else if (r.status >= 400) {
        throw new Error("GitHub API HTTP " + r.status);
      }

      if (rel) {
        const ver = parseVer(rel.tag_name) ? rel.tag_name.replace(/^v/i, "") : rel.tag_name;
        const assets = rel.assets || [];
        // Every release carries two .tar.gz now: the Windows payload is the
        // one for the Windows build, and for every other install the one
        // that is not it, whatever order GitHub lists them in.
        const tarAsset = windows
          ? assets.find((a) => isWindowsPayload(a.name))
          : assets.find((a) => /\.(tgz|tar\.gz)$/i.test(a.name || "") && !isWindowsPayload(a.name));
        state.latest = ver;
        state.latestTag = rel.tag_name;
        state.html_url = rel.html_url || null;
        state.notes = (rel.body || "").trim().slice(0, 3000) || null;
        state.source = src;
        // The Windows build has nothing to install from until its payload is
        // on the release: a source tarball would overlay code the modules on
        // disk may not fit, with no npm to put that right.
        state._downloadUrl = tarAsset ? tarAsset.browser_download_url
                            : (windows ? null : (rel.tarball_url || rel._tarball || null));
        const diff = parseVer(ver) && parseVer(currentVersion) ? cmpVer(ver, currentVersion) : 0;
        state.available = diff !== 0;
        // `latest` only ever names a release marked Latest, from FIRST_IMAGE
        // on. Anything else — a release from before the images, or a bare
        // tag — has no image a pull could fetch, so no pull is suggested for it
        // (the one-tap update still is: every release carries its tarball).
        state.pullable = !!image && src === "release" && !!parseVer(ver) && cmpVer(ver, FIRST_IMAGE) >= 0;
        state.isDowngrade = diff < 0;
      } else {
        state.latest = null; state.latestTag = null; state.available = false;
        state.source = null; state._downloadUrl = null; state.pullable = false;
      }
      state.checkedAt = Date.now();
      log("checked:", state.latest, "available=" + state.available, "src=" + state.source);
    } catch (e) {
      state.error = e.message; log("check failed:", e.message);
    } finally {
      state.checking = false;
    }
    return getStatus();
  }

  async function apply() {
    const busy = ["downloading", "extracting", "restarting"];
    if (busy.includes(state.apply.phase)) return getStatus();

    state.apply = { phase: "checking", error: null, version: null };
    if (!state.available || !state._downloadUrl) {
      await checkNow();
      if (!state.available || !state._downloadUrl) {
        const why = windows && state.available
          ? "The Windows build of v" + state.latest + " is not on the release yet: it follows the release by a few minutes. Try again shortly."
          : (state.error || "No update available");
        state.apply = { phase: "error", error: why, version: null };
        return getStatus();
      }
    }
    const target = state.latest;
    const upd = path.join(dir, ".update");
    const dlFile = path.join(upd, "download.tgz");
    const exRoot = path.join(upd, "extract");
    try {
      fs.mkdirSync(upd, { recursive: true });
      await fs.promises.rm(exRoot, { recursive: true, force: true });
      fs.mkdirSync(exRoot, { recursive: true });

      state.apply = { phase: "downloading", error: null, version: target };
      log("downloading", state._downloadUrl);
      await downloadFile(state._downloadUrl, dlFile, token);

      state.apply = { phase: "extracting", error: null, version: target };
      await extract(dlFile, exRoot);
      const top = topLevelDir(exRoot);
      const staged = top ? path.join(exRoot, top) : exRoot;
      if (!fs.existsSync(path.join(staged, "index.js")) ||
          !fs.existsSync(path.join(staged, "package.json"))) {
        throw new Error("downloaded build is missing index.js/package.json");
      }

      if (viaLauncher) {
        // `modules`: the launcher (lib/relaunch.js) applies the staged
        // node_modules too — the Windows payload carries them.
        fs.writeFileSync(path.join(upd, "READY"), JSON.stringify({ staged, version: target, modules: windows }));
        state.apply = { phase: "restarting", error: null, version: target };
        log("staged; exiting 75 for launcher to apply + restart");
        setTimeout(() => process.exit(75), 400);
      } else {
        applyStaged(staged, dir, { log, modules: windows });
        try { fs.rmSync(upd, { recursive: true, force: true }); }
        catch (e) { /* a staging directory that will not go is emptied and reused by the next update */ }
        state.apply = { phase: "restarting", error: null, version: target };
        log("applied in place; exiting 75 for supervisor to restart");
        setTimeout(() => process.exit(75), 400);
      }
    } catch (e) {
      state.apply = { phase: "error", error: e.message, version: target };
      log("apply failed:", e.message);
    }
    return getStatus();
  }

  function startAuto(intervalMs) {
    stopAuto();
    checkNow().catch(() => {});
    timer = setInterval(() => checkNow().catch(() => {}), intervalMs);
    if (timer.unref) timer.unref();
  }
  function stopAuto() { if (timer) { clearInterval(timer); timer = null; } }

  return { getStatus, checkNow, apply, startAuto, stopAuto };
}

module.exports = {
  createUpdater, applyStaged, FIRST_IMAGE,
  parseVer, cmpVer, verGt, topLevelDir, copyOverlay, tarBin
};
