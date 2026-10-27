#!/usr/bin/env node
// @ts-check
// launcher.js — supervises index.js and applies in-app updates across restarts.
//
// Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
// Released under the MIT License. See the LICENSE file for details.
//
// Run the extension with `npm start` (which runs this) to get one-tap updates
// that actually restart cleanly. When index.js exits with code 75 it is asking
// to be updated/restarted: this launcher applies the staged build (overlaying
// files while the app is NOT running, so nothing replaces itself in place) and
// relaunches. Any other exit code stops the launcher too. The Windows
// executable runs this file too (lib/windows-bootstrap.js); what it does
// between two runs is in lib/relaunch.js.

// Timestamp the launcher's own few lines the same way index.js stamps its
// output (the child runs with inherited stdio and stamps itself).
for (const _level of ["log", "warn", "error"]) {
  const _orig = console[_level].bind(console);
  console[_level] = (...args) => _orig(new Date().toISOString(), ...args);
}

const { spawn } = require("child_process");
const { UPDATE_EXIT, applyStagedIfReady, childSpawn } = require("./lib/relaunch");

const DIR = __dirname;
let stopping = false;

function start() {
  const c = childSpawn(DIR, process.env, process.execPath);
  const child = spawn(c.cmd, c.args, { cwd: DIR, stdio: "inherit", env: c.env });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (code === UPDATE_EXIT) {
      console.log("[launcher] update requested; applying and restarting...");
      applyStagedIfReady(DIR, (...a) => console.log("[launcher]", ...a));
      setTimeout(start, 500); // brief gap so the HTTP port is fully released
    } else {
      console.log("[launcher] index.js exited (code=" + code + ", signal=" + signal + "); stopping.");
      process.exit(code == null ? 0 : code);
    }
  });

  const forward = (sig) => { stopping = true; try { child.kill(sig); } catch (e) { /* already gone: nothing left to stop */ } };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
}

console.log("[launcher] starting Roon Random Albums (auto-update enabled)");
start();
