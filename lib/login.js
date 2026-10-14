// @ts-check
"use strict";
/*
 * login.js — Rouen's optional password (dev/design/login.md).
 *
 *  - Off until a password is set: then nothing here stands in any request's way.
 *  - The password is kept only as a scrypt hash with its own salt, in the
 *    settings (`login`), compared in constant time. Backups never hold it
 *    (lib/backup.js NEVER_KEYS).
 *  - A login is a random 32-byte token in an HttpOnly cookie, kept server-side
 *    only as its SHA-256 (data/sessions.json, so a restart keeps every device
 *    logged in), for 400 days. Changing or removing the password ends them all.
 *  - Five wrong passwords in a minute from one address: that address waits a
 *    minute from the fifth, then starts afresh. (Behind a reverse proxy every
 *    device is the proxy's address, and they share the one count.)
 *  - The hash is worked out off the event loop (crypto.scrypt), so a guess
 *    never holds up the zones, the volume or anything else Rouen is serving.
 *  - guard(): a request that needs the password (login-routes.js) and carries
 *    no valid login is answered 401 { error, login: true }; the page asks for
 *    the password and sends the request again.
 *  - Forgotten: ROUEN_RESET_PASSWORD at start (index.js calls reset()). Once
 *    for each value: Docker keeps -e in the container, and the restart after
 *    an update or a restore must not remove a password set since.
 *
 *   GET  /api/login                     { enabled, loggedIn }
 *   POST /api/login {password}          a login for this device
 *   POST /api/logout                    this device's login ended
 *   POST /api/login/password {current?, password}   set or change it (current when one is set)
 *   POST /api/login/password/remove {current}       remove it
 */
const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const { needsLogin } = require("./login-routes");

const COOKIE = "rouen_session";
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const MIN_LENGTH = 8;
const MAX_LENGTH = 256;
const WINDOW_MS = 60 * 1000;
const MAX_FAILS = 5;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

/**
 * @param {string} password @param {string} saltHex @param {{ N: number, r: number, p: number }} cost
 * @returns {Promise<string>}
 */
function hashOf(password, saltHex, cost) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(saltHex, "hex"), KEYLEN, { N: cost.N, r: cost.r, p: cost.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => { if (err) reject(err); else resolve(key.toString("hex")); });
  });
}

/** @param {string} token */
const digest = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** The cookie's value, from a Cookie header. @param {string | undefined} header */
function tokenFrom(header) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * @typedef {{ salt: string, hash: string, N: number, r: number, p: number, setAt: number }} Stored
 * @param {{ getSettings: () => any, saveSettings: (patch: any) => boolean, sessionsFile: string,
 *           now?: () => number, log?: (line: string) => void,
 *           fs?: { readFileSync: Function, writeFileSync: Function, renameSync: Function, rmSync: Function } }} o
 */
function createLogin(o) {
  const now = o.now || Date.now;
  const log = o.log || (() => {});
  const fs = o.fs || nodeFs;
  /** Logins, by their token's SHA-256: when each was made. @type {Map<string, number>} */
  const sessions = new Map();
  /** Wrong passwords, by address: when each was given, in the minute that counts. @type {Map<string, number[]>} */
  const fails = new Map();
  /** Addresses waiting, until when. @type {Map<string, number>} */
  const waitUntil = new Map();

  try {
    const saved = JSON.parse(fs.readFileSync(o.sessionsFile, "utf8"));
    if (saved && typeof saved === "object") {
      for (const [k, made] of Object.entries(saved)) if (/^[0-9a-f]{64}$/.test(k) && typeof made === "number") sessions.set(k, made);
    }
  } catch (e) { /* no logins saved yet, or unreadable: every device logs in again, which is all it costs */ }

  function persist() {
    try {
      fs.writeFileSync(o.sessionsFile + ".tmp", JSON.stringify(Object.fromEntries(sessions)));
      fs.renameSync(o.sessionsFile + ".tmp", o.sessionsFile);
    } catch (e) { log("could not save the logins: " + (e && /** @type {any} */ (e).message)); }
  }

  /** @returns {Stored | null} */
  function stored() {
    const s = (o.getSettings() || {}).login;
    return s && typeof s.hash === "string" && typeof s.salt === "string" ? s : null;
  }
  const enabled = () => !!stored();

  /** @param {unknown} password */
  async function matches(password) {
    const s = stored();
    if (!s || typeof password !== "string" || password.length > MAX_LENGTH) return false;
    const got = Buffer.from(await hashOf(password, s.salt, s), "hex");
    const want = Buffer.from(s.hash, "hex");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  /**
   * The settings' `login` replaced, or put back as it was if it cannot be
   * saved: the store changes its copy in memory before it writes (as it always
   * has), and a password must never change in memory alone.
   * @param {Stored | null} next
   */
  function saveLogin(next) {
    const settings = o.getSettings() || {};
    const had = settings.login;
    if (o.saveSettings({ login: next })) return true;
    settings.login = had;
    return false;
  }

  /** @param {any} req */
  function loggedIn(req) {
    const token = tokenFrom(req.headers && req.headers.cookie);
    if (!token) return false;
    const made = sessions.get(digest(token));
    if (made === undefined) return false;
    if (now() - made > MAX_AGE_MS) { sessions.delete(digest(token)); persist(); return false; }
    return true;
  }

  /** @param {any} req @param {any} res */
  function issue(req, res) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(digest(token), now());
    persist();
    const proto = String(req.headers && req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const secure = !!req.secure || proto === "https";
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}${secure ? "; Secure" : ""}`);
  }

  /** @param {any} res */
  function clearCookie(res) { res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); }

  function endAll() { sessions.clear(); persist(); }

  /** Whether this address must wait, after too many wrong passwords. @param {string} ip */
  function waiting(ip) {
    const until = waitUntil.get(ip);
    if (until === undefined) return false;
    if (now() < until) return true;
    waitUntil.delete(ip);
    return false;
  }
  /** @param {string} ip */
  function failed(ip) {
    const list = (fails.get(ip) || []).filter((t) => now() - t < WINDOW_MS);
    list.push(now());
    if (list.length < MAX_FAILS) { fails.set(ip, list); return; }
    // The fifth in a minute: a minute's wait from now, then a fresh count.
    fails.delete(ip);
    waitUntil.set(ip, now() + WINDOW_MS);
    log("five wrong passwords in a minute from " + ip + ": it waits a minute");
  }

  /** @param {any} req */
  const ipOf = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || "?");

  /**
   * The password checked, with the limiter: null when right, else the answer to send.
   * @param {any} req @param {unknown} password
   */
  async function verify(req, password) {
    const ip = ipOf(req);
    if (waiting(ip)) return { status: 429, error: "Too many wrong passwords. Wait a minute and try again." };
    if (await matches(password)) { fails.delete(ip); return null; }
    failed(ip);
    return { status: 401, error: "That isn't Rouen's password." };
  }

  /** @param {unknown} password */
  function acceptable(password) {
    if (typeof password !== "string" || password.length < MIN_LENGTH) return `At least ${MIN_LENGTH} characters, please.`;
    if (password.length > MAX_LENGTH) return `At most ${MAX_LENGTH} characters, please.`;
    return null;
  }

  return {
    enabled,
    loggedIn,

    /** Express middleware: a request that needs the password, without a login, goes no further. */
    guard(/** @type {any} */ req, /** @type {any} */ res, /** @type {Function} */ next) {
      if (!enabled() || !needsLogin(req.method, req.path) || loggedIn(req)) return next();
      res.status(401).json({ error: "This needs Rouen's password.", login: true });
    },

    /**
     * ROUEN_RESET_PASSWORD=<value>: the password and every login gone — once
     * for each value (`loginReset` remembers the last one acted on), so the
     * variable left in a container's settings does not remove a password set
     * after it on every restart.
     * @param {string} value
     */
    reset(value) {
      if ((o.getSettings() || {}).loginReset === value) {
        log("ROUEN_RESET_PASSWORD=" + value + " was acted on already: the password set since stays. Remove the variable.");
        return false;
      }
      const had = enabled();
      o.saveSettings({ login: null, loginReset: value });
      endAll();
      log(had ? "password removed (ROUEN_RESET_PASSWORD), and every login ended" : "ROUEN_RESET_PASSWORD: no password was set");
      return true;
    },

    /** @param {{ get: Function, post: Function }} app */
    mount(app) {
      /** An async route whose failure (the hash itself failing) is an answer, not an unhandled rejection. @param {Function} fn */
      const safe = (fn) => (/** @type {any} */ req, /** @type {any} */ res) => Promise.resolve(fn(req, res)).catch((/** @type {any} */ e) => {
        log("login route failed: " + (e && e.message));
        if (!res.headersSent) res.status(500).json({ error: "Couldn't check the password: " + (e && e.message) });
      });
      app.get("/api/login", (/** @type {any} */ req, /** @type {any} */ res) => {
        res.set("Cache-Control", "no-store");
        res.json({ enabled: enabled(), loggedIn: enabled() && loggedIn(req) });
      });
      app.post("/api/login", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        if (!enabled()) return res.json({ ok: true, enabled: false });
        const bad = await verify(req, req.body && req.body.password);
        if (bad) return res.status(bad.status).json({ error: bad.error });
        issue(req, res);
        res.json({ ok: true, enabled: true });
      }));
      app.post("/api/logout", (/** @type {any} */ req, /** @type {any} */ res) => {
        const token = tokenFrom(req.headers && req.headers.cookie);
        if (token && sessions.delete(digest(token))) persist();
        clearCookie(res);
        res.json({ ok: true });
      });
      app.post("/api/login/password", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        const body = req.body || {};
        const had = enabled();
        if (had) {
          const bad = await verify(req, body.current);
          if (bad) return res.status(bad.status).json({ error: bad.error });
        }
        const why = acceptable(body.password);
        if (why) return res.status(400).json({ error: why });
        const salt = crypto.randomBytes(16).toString("hex");
        const login = { salt, hash: await hashOf(body.password, salt, SCRYPT), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, setAt: now() };
        if (!saveLogin(login)) return res.status(500).json({ error: "Couldn't save the password; nothing changed." });
        endAll();          // every other device logs in with the new one
        issue(req, res);   // this one stays logged in
        log("password " + (had ? "changed" : "set") + "; every other login ended");
        res.json({ ok: true, enabled: true });
      }));
      app.post("/api/login/password/remove", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        if (!enabled()) return res.json({ ok: true, enabled: false });
        const bad = await verify(req, (req.body || {}).current);
        if (bad) return res.status(bad.status).json({ error: bad.error });
        if (!saveLogin(null)) return res.status(500).json({ error: "Couldn't remove the password; nothing changed." });
        endAll();
        clearCookie(res);
        log("password removed; every login ended");
        res.json({ ok: true, enabled: false });
      }));
    },
  };
}

module.exports = { createLogin, tokenFrom, COOKIE, MIN_LENGTH };
