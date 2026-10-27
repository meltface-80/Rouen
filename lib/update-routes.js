// @ts-check
"use strict";
/*
 * update-routes.js — the self-updater's wiring: what it is built with, its
 * scheduled check and its three HTTP routes. Moved out of index.js unchanged in v1.9.18
 * (dev/quality.md, "Splitting the monoliths", 1: the updater); the updater
 * itself is lib/updater.js. How often it checks stays in index.js, with the
 * owner's decision beside it.
 */

/**
 * Where releases are looked for: the package's own repository, else the
 * original one.
 * @param {{ repository?: { url?: string }, homepage?: string }} pkg
 */
function repoOf(pkg) {
  const src = (pkg.repository && pkg.repository.url) || pkg.homepage || "";
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/i.exec(src);
  return m ? { owner: m[1], repo: m[2] }
           : { owner: "meltface-80", repo: "MusicD-Remote" };
}

/**
 * createUpdater's options for this install.
 *
 * The published image (v1.8.70) names itself: the workflows build it with
 * MUSICD_IMAGE=ghcr.io/<owner>/<name>. Every install keeps the one-tap update
 * (v1.8.71); set, this one is also shown how to pull its image instead — see
 * lib/updater.js. Unset: a native install, or one built locally from a tarball.
 *
 * The Windows executable (v1.9.67-t5) names itself in RRA_WINDOWS_EXE
 * (lib/windows-bootstrap.js): that install updates from the release's Windows
 * payload, node_modules and all, never from the source tarball.
 * @param {{ pkg: any, env: Record<string, string | undefined>, dir: string, debug: boolean }} o
 */
function updaterOptions(o) {
  const repo = repoOf(o.pkg);
  return {
    owner: repo.owner, repo: repo.repo,
    currentVersion: o.pkg.version,
    dir: o.dir,
    viaLauncher: o.env.RRA_VIA_LAUNCHER === "1",
    token: o.env.RRA_GITHUB_TOKEN || null,
    image: (o.env.MUSICD_IMAGE || "").trim(),
    windows: isWindowsBuild(o.env),
    debug: o.debug,
  };
}

/**
 * Whether this install is the Windows executable.
 * @param {Record<string, string | undefined>} env
 */
function isWindowsBuild(env) {
  return !!(env.RRA_WINDOWS_EXE || "").trim();
}

/**
 * Self-update endpoints (they do not need a paired Core).
 * @param {{ get: Function, post: Function }} app
 * @param {{ updater: ReturnType<typeof import("./updater").createUpdater>, isDocker: () => boolean, changed: () => void }} deps
 *   changed: the Roon status line and Roon's Settings page follow a check or an install
 */
function mountUpdateRoutes(app, deps) {
  const { updater } = deps;
  // is_docker is read by one thing: the web app's "Switch to Docker" banner,
  // shown to every install that reports false. The banner is for the Linux
  // install that ran as a systemd service, with its commands; the Windows
  // executable (v1.9.67-t5, `windows` in the updater's status) is a native
  // install of its own with nothing to switch to, so it is spared the banner
  // the way the image is. So the field reads "no banner" rather than "runs in
  // Docker"; `windows` beside it says which it is.
  app.get("/api/update/status", (/** @type {any} */ req, /** @type {any} */ res) => {
    const st = updater.getStatus();
    res.json({ ...st, is_docker: deps.isDocker() || !!st.windows });
  });

  app.post("/api/update/check", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const s = await updater.checkNow();
    deps.changed();
    res.json(s);
  });

  app.post("/api/update/apply", async (/** @type {any} */ req, /** @type {any} */ res) => {
    let st = updater.getStatus();
    if (!st.available) {
      st = await updater.checkNow();
      if (!st.available) return res.status(409).json({ error: "No update available", status: st });
    }
    // Respond first; apply() downloads + stages, then exits with code 75 so the
    // launcher (or a process supervisor) restarts into the new version.
    res.json({ ok: true, status: updater.getStatus() });
    updater.apply().then(() => { deps.changed(); }).catch(() => { /* apply records its error in the updater's status, which /api/update/status and the status line read */ });
  });
}

/**
 * The check: once now, at startup, then every `everyMs` (index.js says how
 * often, and why).
 * @param {{ updater: ReturnType<typeof import("./updater").createUpdater>, everyMs: number, pushStatus: () => void, refreshSettings: () => void }} o
 */
function startUpdateChecks(o) {
  const tick = async () => {
    try { await o.updater.checkNow(); } catch (e) { /* network failure — no status to update, skip silently */ }
    o.pushStatus();
  };
  tick();
  const timer = setInterval(() => { tick(); o.refreshSettings(); }, o.everyMs);
  if (timer.unref) timer.unref();
}

module.exports = { repoOf, updaterOptions, mountUpdateRoutes, startUpdateChecks };
