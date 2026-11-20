// @ts-check
"use strict";
/*
 * drive-mount.js — rclone mounting the iBroadcast drive's local server (drive-http.js) as a folder Roon reads
 * (2.0.6-t2, dev/design/ibroadcast.md §4.3): read-only, no cache of rclone's own, reads in 64 KB chunks (so every read
 * passes the read rule, and a read of a file's start is never a megabyte), one try, nothing retried. What it needs, said
 * when missing: rclone, /dev/fuse (--device /dev/fuse), the folder (-v /mnt/ibroadcast:/ibroadcast:rshared), and that
 * folder shared with the host, so a Core outside the container sees what is mounted in it.
 */
const nodeFs = require("node:fs");
const childProcess = require("node:child_process");

/** The container's folder, IBROADCAST_DRIVE's where set. */
const MOUNT = process.env.IBROADCAST_DRIVE || "/ibroadcast";

/** rclone's arguments. @param {string} url @param {string} mountPoint */
function rcloneArgs(url, mountPoint) {
  return ["mount", ":http:", mountPoint, "--http-url", url, "--read-only", "--allow-other",
    "--vfs-cache-mode", "off", "--vfs-read-chunk-size", "64k", "--vfs-read-chunk-size-limit", "64k", "--buffer-size", "0",
    "--low-level-retries", "1", "--retries", "1", "--dir-cache-time", "30s", "--attr-timeout", "30s",
    "--log-level", "NOTICE"];
}

/**
 * The mount point's line in /proc/self/mountinfo: whether something is mounted there, of which type, whether its mount
 * is shared (propagated to the host), and the id of the last mount there (to tell one rclone's mount from another's).
 * @param {string} mountinfo @param {string} mountPoint
 */
function mountState(mountinfo, mountPoint) {
  /** @type {{ mounted: boolean, fuse: boolean, shared: boolean, id: string | null }} */
  const out = { mounted: false, fuse: false, shared: false, id: null };
  for (const line of mountinfo.split("\n")) {
    const parts = line.split(" ");
    if (parts[4] !== mountPoint) continue;
    const dash = parts.indexOf("-");
    out.mounted = true;
    out.id = parts[0];
    // The last mount there wins: rclone's over the bind mount.
    out.fuse = dash > 0 && /^fuse/.test(parts[dash + 1] || "");
    out.shared = out.shared || parts.slice(6, dash).some((f) => f.startsWith("shared:"));
  }
  return out;
}

/**
 * @param {{ mountPoint?: string, fs?: typeof nodeFs, spawn?: typeof childProcess.spawn, log?: (line: string) => void,
 *           platform?: string, sleep?: (ms: number) => Promise<void>, unmount?: (mountPoint: string) => void }} [o]
 *   unmount: lets go of a FUSE mount (fusermount3 -uz)
 */
function createDriveMount(o = {}) {
  const fs = o.fs || nodeFs;
  const spawn = o.spawn || childProcess.spawn;
  const log = o.log || (() => {});
  const sleep = o.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const mountPoint = o.mountPoint || MOUNT;
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  /** @type {string | null} */
  let error = null;
  /** rclone's last lines, for the page. @type {string[]} */
  const said = [];
  /** The id of the mount this rclone made: only that one is let go by stop() (the review). @type {string | null} */
  let madeId = null;

  const info = () => {
    try { return mountState(fs.readFileSync("/proc/self/mountinfo", "utf8"), mountPoint); }
    catch (e) { return { mounted: false, fuse: false, shared: false, id: null }; }   // no /proc (not Linux): nothing can be mounted
  };
  const unmount = o.unmount || ((/** @type {string} */ p) => { childProcess.execFileSync("fusermount3", ["-uz", p], { stdio: "ignore" }); });
  /** Let go of what is mounted there, said when it can't be. */
  const letGo = () => {
    try { unmount(mountPoint); }
    catch (e) { log("drive: the mount couldn't be let go: " + String(/** @type {any} */ (e).message)); }
  };

  /** What is missing for a mount, in words for the page; null when nothing is. */
  function missing() {
    if ((o.platform || process.platform) !== "linux") return "The drive needs Rouen's Docker image on Linux: Windows has no rclone in Rouen.";
    if (!fs.existsSync("/dev/fuse")) return "The container has no /dev/fuse: run it with --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined.";
    if (!fs.existsSync(mountPoint)) return `The container has no ${mountPoint} folder: run it with -v /mnt/ibroadcast:${mountPoint}:rshared.`;
    const st = info();
    if (st.mounted && !st.fuse && !st.shared) return `${mountPoint} isn't shared with the host, so your Core wouldn't see the drive: add :rshared to its -v.`;
    return null;
  }

  return {
    mountPoint,
    missing,
    /** Whether rclone's mount is there now. */
    mounted: () => info().fuse,
    state() { return { mountPoint, mounted: info().fuse, running: !!child, error, said: said.slice(-10) }; },

    /** rclone started on `url`, and the mount seen within ten seconds. @param {string} url @returns {Promise<void>} */
    async start(url) {
      if (child) return;
      error = null;
      const why = missing();
      if (why) { error = why; return; }
      // A mount left from before (Rouen restarted in place after an update, its rclone still serving the old server's
      // address: the review): let go first, so the mount waited for below is this rclone's.
      if (info().fuse) { log("drive: a mount left from before let go"); letGo(); }
      const old = info().fuse ? info().id : null;
      const c = spawn("rclone", rcloneArgs(url, mountPoint), { stdio: ["ignore", "pipe", "pipe"] });
      child = c;
      // Rouen ending (a restart, an update) ends rclone with it, unmounting, rather than leaving it on a dead address.
      const onExit = () => { try { c.kill("SIGTERM"); } catch (e) { /* gone already: nothing to end */ } };
      process.once("exit", onExit);
      /** @param {Buffer} b */
      const hear = (b) => { for (const l of String(b).split("\n")) if (l.trim()) { said.push(l.trim()); if (said.length > 50) said.shift(); log("rclone: " + l.trim()); } };
      if (c.stdout) c.stdout.on("data", hear);
      if (c.stderr) c.stderr.on("data", hear);
      // Not found, it never exits: Node says "error" and "close" only, so "close" is what ends it here (the review).
      c.on("error", (e) => {
        error = /** @type {any} */ (e).code === "ENOENT" ? "rclone isn't in this image: the drive needs 2.0.6-t2's image or later." : "rclone: " + e.message;
      });
      c.on("close", (code) => {
        process.removeListener("exit", onExit);
        if (child === c) { child = null; if (code) error = error || "rclone stopped (" + code + "): " + (said[said.length - 1] || ""); }
      });
      for (let i = 0; i < 40 && child === c; i++) {
        const now = info();
        if (now.fuse && now.id !== old) { madeId = now.id; log("drive mounted at " + mountPoint); return; }
        await sleep(250);
      }
      if (child === c && !madeId) error = error || "rclone started, but the drive didn't appear at " + mountPoint + ".";
    },

    /** rclone stopped (unmounting), and the mount let go if it stayed. @returns {Promise<void>} */
    async stop() {
      const c = child;
      child = null;
      if (c && c.exitCode === null && c.signalCode === null) {
        const gone = new Promise((r) => { c.once("close", r); });
        c.kill("SIGTERM");
        await Promise.race([gone, sleep(5000)]);
      }
      // Only the mount this rclone made: another's (a newer one, the plugin switched off and on) is not this one's to end.
      const now = info();
      if (madeId && now.fuse && now.id === madeId) letGo();
      madeId = null;
    },
  };
}

module.exports = { createDriveMount, rcloneArgs, mountState, MOUNT };
