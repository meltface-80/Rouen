// @ts-check
"use strict";
/*
 * node.js — Tailscale built into Rouen (dev/design/android-app.md §4.7, v1.9.72-t7): Mandarin's own engine,
 * `musicdnet` (musicdnet/, Go, tailscale.com/tsnet, userspace: no VPN, no Tailscale on the host), started with
 * -server. Signed in once, from Settings → Setup → Away from home or with TS_AUTHKEY, it makes this Rouen a machine
 * on your tailnet: it takes the tailnet's port 3399 and passes each request to Rouen on 127.0.0.1, naming the caller's
 * tailnet address in X-Forwarded-For (believed from loopback only: away.js). Ported from Mandarin's
 * lib/server/tsnode.js (its last Node version, 2026-10-13) rule for rule, less its hand-over to Mandarin's C# server.
 *
 *  - The engine is driven over HTTP on 127.0.0.1 with a secret only the two know (MUSICDNET_SECRET); it stops when
 *    Rouen does (its stdin closes). Its state (this machine's tailnet key) lives in the data folder, so a new container
 *    is the same machine.
 *  - The image carries the engine (/usr/local/bin/musicdnet), the Windows build carries musicdnet.exe beside Rouen.
 *    A container updated in place (the one-tap update brings Rouen's files, not a new image) with no engine in its
 *    image downloads the one of its version's release (musicdnet-linux-<arch>.gz, checked against the release's
 *    musicdnet-SHA256SUMS) into the data folder, and again whenever Rouen is updated.
 *  - TAILSCALE=off leaves it out; TS_HOSTNAME names the machine (default "rouen"); TS_CONTROL_URL another control
 *    server (Headscale).
 *  - The watchdog (Mandarin v0.7.2): a node that says Running but is not online on the tailnet is asked to rebind
 *    after a minute, and started afresh four minutes after that.
 */
const nodeFs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const childProcess = require("node:child_process");

const RELEASES = "https://github.com/meltface-80/Rouen/releases/download";
/** The engine's checksums on a release (release.yml's engine job), named apart from any other checksum file there. */
const SUMS = "musicdnet-SHA256SUMS";
const POLL_MS = 5000;

/**
 * @typedef {object} NodeDeps
 * @property {string} bin  the engine the image or the Windows build carries
 * @property {string} dir  its state folder (data/tailscale)
 * @property {number} port  Rouen's port: the tailnet's port too
 * @property {string} version  Rouen's version: whose release a downloaded engine comes from
 * @property {() => boolean} enabled  Settings → Away from home's switch
 * @property {(on: boolean) => void} setEnabled
 * @property {(line: string) => void} [log]
 * @property {Record<string, string | undefined>} [env]
 * @property {typeof fetch} [fetch]  for the engine's download (the control API is always asked with the real fetch)
 * @property {Function} [spawn]
 * @property {string} [platform]
 * @property {string} [arch]
 * @property {() => number} [now]
 * @property {{ rebindMs?: number, restartMs?: number }} [watchdog]
 * @property {number} [pollMs]  how often the engine is asked how it is (5 s)
 */

/** Whether a file can be run. @param {string} p */
function executable(p) {
  try { nodeFs.accessSync(p, nodeFs.constants.X_OK); return nodeFs.statSync(p).isFile(); } catch (e) { return false; }
}

/**
 * The first line a stream gives, or a failure after `ms`.
 * @param {import("node:stream").Readable} stream @param {number} ms @returns {Promise<string>}
 */
function firstLine(stream, ms) {
  return new Promise((resolve, reject) => {
    let buf = "";
    /** @param {Buffer} d */
    const onData = (d) => {
      buf += String(d);
      const i = buf.indexOf("\n");
      if (i >= 0) { cleanup(); resolve(buf.slice(0, i).trim()); }
    };
    const onEnd = () => { cleanup(); reject(new Error("the engine didn't start")); };
    const t = setTimeout(onEnd, ms);
    function cleanup() { clearTimeout(t); stream.off("data", onData); stream.off("end", onEnd); }
    stream.on("data", onData);
    stream.on("end", onEnd);
  });
}

/** @param {NodeDeps} deps */
function createTailscaleNode(deps) {
  const env = deps.env || process.env;
  const log = deps.log || (() => {});
  const doFetch = deps.fetch || fetch;
  const spawn = deps.spawn || childProcess.spawn;
  const platform = deps.platform || process.platform;
  const arch = ({ x64: "amd64", arm64: "arm64" })[deps.arch || process.arch] || null;
  const now = deps.now || Date.now;
  const watchdog = { rebindMs: (deps.watchdog && deps.watchdog.rebindMs) || 60000, restartMs: (deps.watchdog && deps.watchdog.restartMs) || 240000 };
  const pollMs = deps.pollMs || POLL_MS;
  const downloadedBin = path.join(path.dirname(deps.dir), "bin", platform === "win32" ? "musicdnet.exe" : "musicdnet");

  /** @type {any} */ let proc = null;
  /** @type {number | null} */ let ctl = null;
  /** @type {string | null} */ let secret = null;
  /** @type {Record<string, any> | null} */ let last = null;
  /** @type {string | null} */ let error = null;
  /** @type {string | null} */ let downloadError = null;
  /** @type {Promise<void> | null} */ let downloading = null;
  let stopping = false, restarts = 0, generation = 0;
  /** @type {any} */ let timer = null;
  /** @type {number | null} */ let badSince = null;
  /** @type {number | null} */ let rebound = null;

  const bin = () => (executable(deps.bin) ? deps.bin : downloadedBin);
  const hostname = () => String(env.TS_HOSTNAME || "rouen").trim() || "rouen";

  /** It can run here: carried, or downloadable for this platform (the Docker image's Linux, x64 or arm64). */
  function available() {
    if (String(env.TAILSCALE || "").toLowerCase() === "off") return false;
    if (executable(deps.bin)) return true;
    return (env.DOCKER === "1" || !!env.TS_ENGINE_URL) && platform === "linux" && !!arch;
  }

  /** "http://100.x.y.z:3399" once it is joined and serving, else null. */
  function address() {
    const st = last;
    if (!proc || !st || st.state !== "Running" || !st.serving) return null;
    const ip = (Array.isArray(st.ips) ? st.ips : []).find((/** @type {string} */ a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    return ip ? "http://" + ip + ":" + deps.port : null;
  }

  /** For Settings: what it is doing, and the sign-in link while one is needed. */
  function status() {
    const st = last || {};
    return {
      available: available(),
      enabled: deps.enabled(),
      running: !!proc,
      state: proc ? (st.state || "Starting") : (downloading ? "Downloading" : "Stopped"),
      auth_url: st.auth_url || null,
      ips: Array.isArray(st.ips) ? st.ips : [],
      dns_name: st.dns_name ? String(st.dns_name).replace(/\.$/, "") : null,
      serving: !!st.serving,
      online: st.online === undefined ? null : !!st.online,
      health: Array.isArray(st.health) ? st.health : [],
      address: address(),
      error: error || st.error || downloadError || null,
      version: st.version || null,
      hostname: hostname(),
    };
  }

  /** @param {string} method @param {string} pathQ @param {any} body @param {number} [ms] */
  async function call(method, pathQ, body, ms = 8000) {
    if (!ctl) throw new Error("not running");
    const r = await fetch("http://127.0.0.1:" + ctl + pathQ, {
      method, signal: AbortSignal.timeout(ms),
      headers: Object.assign({ "X-Secret": /** @type {string} */ (secret) }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    /** @type {any} */
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  /** The engine of this version's release, into the data folder, checked against its checksums. */
  async function download() {
    const base = String(env.TS_ENGINE_URL || RELEASES + "/v" + deps.version).replace(/\/+$/, "");
    const name = "musicdnet-linux-" + arch + ".gz";
    log("[tailscale] downloading the Tailscale engine (" + name + ")…");
    /** @param {string} u */
    const get = async (u) => {
      const r = await doFetch(u, { redirect: "follow" });
      if (!r.ok) throw new Error(u.split("/").pop() + ": HTTP " + r.status);
      return Buffer.from(await r.arrayBuffer());
    };
    const sums = (await get(base + "/" + SUMS)).toString("utf8");
    const want = (sums.split("\n").map((l) => l.trim().split(/\s+/)).find((p) => p[1] === name) || [])[0];
    if (!want) throw new Error("no checksum for " + name);
    const gz = await get(base + "/" + name);
    if (crypto.createHash("sha256").update(gz).digest("hex") !== want) throw new Error("the download was damaged (checksum mismatch)");
    nodeFs.mkdirSync(path.dirname(downloadedBin), { recursive: true });
    const tmp = downloadedBin + ".tmp";
    nodeFs.writeFileSync(tmp, zlib.gunzipSync(gz), { mode: 0o755 });
    nodeFs.renameSync(tmp, downloadedBin);
    nodeFs.writeFileSync(downloadedBin + ".version", String(deps.version));
    log("[tailscale] engine ready (" + Math.round(gz.length / 1048576) + " MB download)");
  }

  /** The engine carried, else the downloaded one, fetched when missing or another version's. True when there is one. */
  async function ensureEngine() {
    if (executable(deps.bin)) return true;
    let have = null;
    try { have = nodeFs.readFileSync(downloadedBin + ".version", "utf8").trim(); } catch (e) { /* none downloaded yet */ }
    if (executable(downloadedBin) && have === deps.version) return true;
    if (!downloading) downloading = download().finally(() => { downloading = null; });
    try {
      await downloading;
      downloadError = null;
    } catch (e) {
      downloadError = "Couldn't download Tailscale: " + /** @type {Error} */ (e).message;
      log("[tailscale] " + downloadError);
      return executable(downloadedBin);   // an older one still runs
    }
    return true;
  }

  async function start() {
    if (proc || !available() || !deps.enabled()) return;
    stopping = false;
    if (!(await ensureEngine())) return;
    if (proc || stopping) return;
    nodeFs.mkdirSync(deps.dir, { recursive: true, mode: 0o700 });
    secret = crypto.randomBytes(24).toString("hex");
    const childEnv = Object.assign({}, env, { MUSICDNET_SECRET: secret, HOME: deps.dir });
    delete childEnv.TS_AUTHKEY;   // given to the engine through its API, not inherited
    const p = spawn(bin(), ["-server", "-dir", deps.dir], { env: childEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    proc = p;
    /** @type {string[]} */
    const tail = [];
    p.stderr.on("data", (/** @type {Buffer} */ d) => { tail.push(String(d)); if (tail.length > 20) tail.shift(); });
    p.stdin.on("error", () => { /* the engine gone: its exit says so below */ });
    p.on("error", (/** @type {Error} */ e) => { error = e.message; });
    p.on("exit", (/** @type {number | null} */ code) => {
      if (proc === p) { proc = null; ctl = null; }
      clearTimeout(timer);
      if (stopping) return;
      error = "stopped (" + code + ")" + (tail.length ? ": " + tail.join("").trim().slice(-300) : "");
      log("[tailscale] " + error);
      // Started again, more slowly each time it fails.
      timer = setTimeout(() => { start().catch(() => { /* its error is in status() */ }); }, Math.min(60000, 2000 * 2 ** Math.min(restarts++, 5)));
      if (timer.unref) timer.unref();
    });
    try {
      const line = await firstLine(p.stdout, 10000);
      p.stdout.on("data", () => { /* kept flowing: a full pipe would stall it */ });
      const m = /^CONTROL (\d+)/.exec(/** @type {string} */ (line));
      if (!m) throw new Error("unexpected first line: " + line);
      ctl = Number(m[1]);
      error = null;
      await call("POST", "/start", { Hostname: hostname(), AuthKey: env.TS_AUTHKEY || "", ControlURL: env.TS_CONTROL_URL || "" }, 30000);
      log('[tailscale] built-in Tailscale started as "' + hostname() + '"');
    } catch (e) {
      error = /** @type {Error} */ (e).message;
      log("[tailscale] couldn't start: " + error);
    }
    poll();
  }

  /** Every few seconds: how it is, and once joined, serving Rouen's port. */
  async function poll() {
    clearTimeout(timer);
    if (!proc || stopping) return;
    try {
      const st = await call("GET", "/status", null, 4000);
      const was = last && last.state;
      last = st;
      if (st.state === "Running" && !st.serving) {
        await call("POST", "/serve?port=" + deps.port + "&upstream=" + encodeURIComponent("http://127.0.0.1:" + deps.port), null, 10000);
        last = await call("GET", "/status", null, 4000);
        restarts = 0;
        log("[tailscale] on your tailnet: " + (address() || "(no address yet)") + (last && last.dns_name ? " — " + String(last.dns_name).replace(/\.$/, "") : ""));
      } else if (st.state !== was && st.state === "NeedsLogin") {
        log("[tailscale] waiting to be signed in: Settings → Setup → Away from home");
      }
      if (await watch(st)) return;
    } catch (e) { /* asked again at the next poll */ }
    timer = setTimeout(poll, pollMs);
    if (timer.unref) timer.unref();
  }

  /** The watchdog: true when the engine was started afresh (the poll is then start()'s). @param {Record<string, any>} st */
  async function watch(st) {
    const bad = st.state === "Running" && (st.online === false || (Array.isArray(st.health) && st.health.length > 0));
    if (!bad) { badSince = null; rebound = null; return false; }
    if (!badSince) { badSince = now(); return false; }
    const since = now() - badSince;
    const why = st.online === false ? "not online on the tailnet" : "Tailscale warns: " + st.health.join("; ");
    if (rebound && now() - rebound >= watchdog.restartMs) {
      log("[tailscale] " + why + " for " + Math.round(since / 1000) + " s after a rebind: starting the engine afresh");
      badSince = null; rebound = null;
      await restart();
      return true;
    }
    if (!rebound && since >= watchdog.rebindMs) {
      rebound = now();
      log("[tailscale] " + why + " for " + Math.round(since / 1000) + " s: asking Tailscale to rebind");
      await call("POST", "/rebind", null, 12000).catch((e) => log("[tailscale] rebind: " + e.message));
    }
    return false;
  }

  function stop() {
    stopping = true;
    generation++;
    clearTimeout(timer);
    const p = proc;
    proc = null; ctl = null; last = null;
    if (p) {
      p.stdin.end();
      const t = setTimeout(() => { if (p.exitCode === null) p.kill(); }, 1500);
      if (t.unref) t.unref();
    }
  }

  /** Stopped, and started again shortly — unless it was stopped again meanwhile (Rouen stopping, the switch off). */
  async function restart() {
    stop();
    const g = generation;
    await new Promise((r) => { setTimeout(r, 300); });
    if (g === generation) await start();
  }

  return {
    start, stop, status, address, hostname,
    /** A sign-in link (a new one after signing out, or an expired key). */
    async login() {
      if (!proc) await start();
      if (!proc) throw new Error(available() ? "Tailscale is switched off" : "Tailscale isn't in this install");
      const st = await call("POST", "/login", null, 20000);
      last = Object.assign({}, last, st);
      return status();
    },
    /** This Rouen leaves the tailnet; started afresh, it asks to be signed in again. */
    async logout() {
      if (!proc) return status();
      await call("POST", "/logout", null, 15000);
      await restart();
      return status();
    },
    /** @param {boolean} on */
    async setEnabled(on) {
      deps.setEnabled(!!on);
      if (on) await start(); else stop();
      return status();
    },
  };
}

module.exports = { createTailscaleNode, executable };
