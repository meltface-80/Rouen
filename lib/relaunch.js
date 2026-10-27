// @ts-check
"use strict";
/*
 * relaunch.js — what launcher.js does around each run of index.js: how the
 * run is started, and the staged update applied between two runs. Moved out
 * of launcher.js in v1.9.67-t5, when the Windows build gave it two more
 * things to get right, so that they are tested:
 *
 *   - a staged build may carry its node_modules (the Windows payload does;
 *     lib/updater.js writes `modules` into .update/READY), and then they are
 *     applied with it — the build has no npm to install them;
 *   - the file to run is named in RRA_ENTRY as well as on the command line.
 *     The Windows executable (lib/windows-bootstrap.js) always runs the script
 *     inside it and reads the environment to run index.js instead; node reads
 *     the command line and ignores the variable.
 */
const fs = require("fs");
const path = require("path");
const updater = require("./updater");

/** index.js exits with this to ask for the staged update to be applied and a restart. */
const UPDATE_EXIT = 75;

/** How often an apply is tried, and the wait between tries. */
const APPLY_TRIES = 3;
const APPLY_WAIT_MS = 3000;

/**
 * Apply the update index.js staged in dir/.update, if there is one, and
 * remove the staging directory either way. True when a build was applied.
 *
 * Tried more than once: on Windows a file still open cannot be replaced,
 * and a child index.js left behind — an ffmpeg decoding a waveform when the
 * update was tapped — keeps its own executable open for a few seconds after
 * index.js has gone. The overlay is safe to run again from the start.
 * @param {string} dir  the install directory (launcher.js's own)
 * @param {(...a: any[]) => void} log
 * @param {(ms: number) => void} [wait]  between tries (a blocking wait: nothing else runs here)
 */
function applyStagedIfReady(dir, log, wait) {
  const readyFile = path.join(dir, ".update", "READY");
  if (!fs.existsSync(readyFile)) return false;
  wait = wait || ((ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });
  let applied = false;
  try {
    const info = JSON.parse(fs.readFileSync(readyFile, "utf8"));
    if (info && info.staged && fs.existsSync(info.staged)) {
      log("applying staged update -> v" + (info.version || "?"));
      for (let attempt = 1; ; attempt++) {
        try {
          updater.applyStaged(info.staged, dir, { log, modules: !!info.modules });
          break;
        } catch (e) {
          if (attempt >= APPLY_TRIES) throw e;
          log("could not apply yet (" + e.message + "); trying again in " + (APPLY_WAIT_MS / 1000) + "s");
          wait(APPLY_WAIT_MS);
        }
      }
      log("update applied.");
      applied = true;
    }
  } catch (e) {
    log("failed to apply staged update: " + e.message);
  } finally {
    try { fs.rmSync(path.join(dir, ".update"), { recursive: true, force: true }); }
    catch (e) { /* a staging directory that will not go is emptied and reused by the next update */ }
  }
  return applied;
}

/**
 * How index.js is started: the running executable, the file, and its environment.
 * @param {string} dir  the install directory
 * @param {Record<string, string | undefined>} env  the launcher's own
 * @param {string} execPath  the launcher's own executable (node, or Rouen.exe)
 */
function childSpawn(dir, env, execPath) {
  const entry = path.join(dir, "index.js");
  return {
    cmd: execPath,
    args: [entry],
    env: Object.assign({}, env, { RRA_VIA_LAUNCHER: "1", RRA_ENTRY: entry }),
  };
}

module.exports = { UPDATE_EXIT, applyStagedIfReady, childSpawn };
