// @ts-check
"use strict";
/*
 * login.js — Rouen's account (dev/design/login.md).
 *
 *  - Mandatory since v1.9.26 (the owner, 2026-10-14): one account per
 *    install, a username and a password, and every request under /api/ but
 *    the account's own four needs its login (login-routes.js). Until the
 *    account is made, those answer 401 { setup: true, legacy } and the page asks for
 *    one; a v1.9.22 password with no username (legacy) is made into the
 *    account by giving a username and that password.
 *  - The password is kept only as a scrypt hash with its own salt, in the
 *    settings (`login`), compared in constant time. Backups never hold it
 *    (lib/backup.js NEVER_KEYS).
 *  - A login is a random 32-byte token in an HttpOnly cookie, kept server-side
 *    only as its SHA-256 (data/sessions.json, so a restart keeps every device
 *    logged in), for 400 days. Changing the password ends them all.
 *  - Five wrong tries in a minute from one address: that address waits a
 *    minute from the fifth, then starts afresh. A wrong username counts, and
 *    is answered, the same as a wrong password. (Behind a reverse proxy every
 *    device is the proxy's address, and they share the one count.)
 *  - The hash is worked out off the event loop (crypto.scrypt), so a guess
 *    never holds up the zones, the volume or anything else Rouen is serving.
 *  - Forgotten: ROUEN_RESET_PASSWORD at start (index.js calls reset()) removes
 *    the account. Once for each value: Docker keeps -e in the container, and
 *    the restart after an update or a restore must not remove an account made
 *    since.
 *
 *   GET  /api/login                       { account, setup, legacy, loggedIn, user? }
 *   POST /api/login {user, password}      a login for this device
 *   POST /api/logout                      this device's login ended
 *   POST /api/login/setup {user, password} or, legacy, {user, current}   the account made
 *   POST /api/login/password {current, password}   the password changed (logged in)
 *   POST /api/login/username {current, user}       the username changed (logged in)
 */
const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const { needsLogin } = require("./login-routes");

const COOKIE = "rouen_session";
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const MIN_LENGTH = 8;
const MAX_LENGTH = 256;
const MAX_USER = 64;
const WINDOW_MS = 60 * 1000;
const MAX_FAILS = 5;
/** Password checks running at once, from everyone (v1.9.26, the review): scrypt runs on
 *  libuv's pool, which gzip and file reads share — a flood of guesses must not hold them up. */
const MAX_CHECKING = 2;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const WRONG = "Wrong username or password.";

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

/** A username as compared: trimmed, NFC, lower-cased. @param {unknown} u */
const userKey = (u) => (typeof u === "string" ? u.trim().normalize("NFC").toLowerCase() : "");

/** Why a username will not do, or null. @param {unknown} u */
function badUser(u) {
  if (typeof u !== "string" || !u.trim()) return "A username, please.";
  if (u.trim().length > MAX_USER) return `At most ${MAX_USER} characters for the username, please.`;
  // Control characters (below 32, and 127), by code point: a regex for them trips no-control-regex.
  for (const ch of u.trim()) { const c = ch.codePointAt(0) || 0; if (c < 32 || c === 127) return "The username has a character that can't be typed."; }
  return null;
}

/** Why a password will not do, or null. @param {unknown} password */
function badPassword(password) {
  if (typeof password !== "string" || password.length < MIN_LENGTH) return `At least ${MIN_LENGTH} characters for the password, please.`;
  if (password.length > MAX_LENGTH) return `At most ${MAX_LENGTH} characters for the password, please.`;
  return null;
}

/** The cookie's value, from a Cookie header. @param {string | undefined} header */
function tokenFrom(header) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * @typedef {{ user?: string, salt: string, hash: string, N: number, r: number, p: number, setAt: number }} Stored
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
  /** Wrong tries, by address: when each was made, in the minute that counts. @type {Map<string, number[]>} */
  const fails = new Map();
  /** Addresses waiting, until when. @type {Map<string, number>} */
  const waitUntil = new Map();
  /** Tries still being checked, by address: counted before the hash, so parallel guesses cannot all pass. @type {Map<string, number>} */
  const pending = new Map();
  let checking = 0;
  /** Moves whenever every login ends: a login checked against the old password, still in flight then, is not issued. */
  let generation = 0;

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
  /** "none": no account; "legacy": a v1.9.22 password with no username; "ready": the account. */
  function state() {
    const s = stored();
    if (!s) return "none";
    return typeof s.user === "string" && s.user.trim() ? "ready" : "legacy";
  }

  /** @param {unknown} password */
  async function passwordMatches(password) {
    const s = stored();
    if (!s || typeof password !== "string" || password.length > MAX_LENGTH) return false;
    const got = Buffer.from(await hashOf(password, s.salt, s), "hex");
    const want = Buffer.from(s.hash, "hex");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  /**
   * The settings' `login` replaced, or put back as it was if it cannot be
   * saved: the store changes its copy in memory before it writes, and an
   * account must never change in memory alone.
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

  function endAll() { generation++; sessions.clear(); persist(); }

  /** Whether this address must wait, after too many wrong tries. @param {string} ip */
  function waiting(ip) {
    const until = waitUntil.get(ip);
    if (until === undefined) return false;
    if (now() < until) return true;
    waitUntil.delete(ip);
    return false;
  }
  /** The wrong tries of the last minute from this address. @param {string} ip */
  const recent = (ip) => (fails.get(ip) || []).filter((t) => now() - t < WINDOW_MS);
  /** @param {string} ip */
  function failed(ip) {
    // Addresses that never come back are swept now and then, so many addresses cannot grow the maps for ever.
    if (fails.size > 1000) for (const [k, v] of fails) if (!v.some((t) => now() - t < WINDOW_MS)) fails.delete(k);
    if (waitUntil.size > 1000) for (const [k, until] of waitUntil) if (now() >= until) waitUntil.delete(k);
    const list = recent(ip);
    list.push(now());
    if (list.length < MAX_FAILS) { fails.set(ip, list); return; }
    // The fifth in a minute: a minute's wait from now, then a fresh count.
    fails.delete(ip);
    waitUntil.set(ip, now() + WINDOW_MS);
    log("five wrong tries in a minute from " + ip + ": it waits a minute");
  }

  /**
   * Whom the limiter counts: the address, or for IPv6 its /64 — one home network's
   * hosts can take as many addresses in their /64 as they like (v1.9.26, the review).
   * @param {any} req
   */
  const ipOf = (req) => {
    const a = String(req.ip || (req.socket && req.socket.remoteAddress) || "?").replace(/^::ffff:(?=\d+\.)/i, "");
    if (!a.includes(":")) return a;
    const parts = a.split("%")[0].split("::");
    const head = parts[0] ? parts[0].split(":") : [];
    const tail = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
    const full = parts.length > 1 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
    return full.slice(0, 4).map((h) => (h || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
  };

  /**
   * The password — and, when `user` is given, the username — checked, with the
   * limiter: null when right, else the answer to send. The hash is worked out
   * whatever the username, so a wrong one takes as long as a wrong password.
   * @param {any} req @param {unknown} password @param {unknown} [user]
   */
  async function verify(req, password, user) {
    const ip = ipOf(req);
    const busy = { status: 429, error: "Too many wrong tries. Wait a minute and try again." };
    if (waiting(ip)) return busy;
    // Counted before the hash (v1.9.26, the review): tries in flight take their
    // place in the five, so a burst sent at once cannot all be checked.
    const inFlight = pending.get(ip) || 0;
    if (recent(ip).length + inFlight >= MAX_FAILS) return busy;
    if (checking >= MAX_CHECKING) return { status: 429, error: "Rouen is checking other passwords. Try again in a moment." };
    pending.set(ip, inFlight + 1);
    checking++;
    try {
      const s = stored();
      const userOk = user === undefined || (!!s && typeof s.user === "string" && userKey(user) === userKey(s.user));
      const passOk = await passwordMatches(password);
      // The account changed while this was checked (a new password): the old one no longer counts.
      const same = stored() === s || (!!s && !!stored() && /** @type {Stored} */ (stored()).hash === s.hash);
      if (userOk && passOk && same) { fails.delete(ip); return null; }
      failed(ip);
      return { status: 401, error: user === undefined ? "That isn't the current password." : WRONG };
    } finally {
      checking--;
      const left = (pending.get(ip) || 1) - 1;
      if (left > 0) pending.set(ip, left); else pending.delete(ip);
    }
  }

  /** The 401 until the account is made; `legacy` says which sheet, on every one (v1.9.26, the review). */
  const needsSetup = () => ({ error: "Rouen's account has to be made first.", setup: true, legacy: state() === "legacy" });

  /** @param {string} user @param {string} password @returns {Promise<Stored>} */
  async function account(user, password) {
    const salt = crypto.randomBytes(16).toString("hex");
    return { user: user.trim(), salt, hash: await hashOf(password, salt, SCRYPT), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, setAt: now() };
  }

  return {
    state,
    loggedIn,

    /** Express middleware: a request under /api/ but the account's own goes no further without the account's login. */
    guard(/** @type {any} */ req, /** @type {any} */ res, /** @type {Function} */ next) {
      if (!needsLogin(req.method, req.path)) return next();
      if (state() !== "ready") return res.status(401).json(needsSetup());
      if (loggedIn(req)) return next();
      res.status(401).json({ error: "Log in to Rouen first.", login: true });
    },

    /**
     * ROUEN_RESET_PASSWORD=<value>: the account and every login gone — once
     * for each value (`loginReset` remembers the last one acted on), so the
     * variable left in a container's settings does not remove an account made
     * after it on every restart.
     * @param {string} value
     */
    reset(value) {
      // "0", "false", "off", "no": a variable set to turn it OFF must not remove the account (v1.9.26, the review).
      if (/^(0|false|off|no)?$/i.test(String(value).trim())) {
        log("ROUEN_RESET_PASSWORD=" + value + " reads as off: nothing was removed. Remove the variable.");
        return false;
      }
      if ((o.getSettings() || {}).loginReset === value) {
        log("ROUEN_RESET_PASSWORD=" + value + " was acted on already: the account made since stays. Remove the variable.");
        return false;
      }
      const had = state() !== "none";
      const settings = o.getSettings() || {};
      const before = { login: settings.login, loginReset: settings.loginReset };
      if (!o.saveSettings({ login: null, loginReset: value })) {
        Object.assign(settings, before);   // the store changed its copy first; the account stays as it is on disk
        log("ROUEN_RESET_PASSWORD=" + value + ": the settings could not be saved, so the account was NOT removed");
        return false;
      }
      endAll();
      log(had ? "account removed (ROUEN_RESET_PASSWORD), and every login ended: the next device to open Rouen makes a new one"
        : "ROUEN_RESET_PASSWORD: there was no account");
      return true;
    },

    /** @param {{ get: Function, post: Function }} app */
    mount(app) {
      /** An async route whose failure (the hash itself failing) is an answer, not an unhandled rejection. @param {Function} fn */
      const safe = (fn) => (/** @type {any} */ req, /** @type {any} */ res) => Promise.resolve(fn(req, res)).catch((/** @type {any} */ e) => {
        log("login route failed: " + (e && e.message));
        if (!res.headersSent) res.status(500).json({ error: "Couldn't check the password: " + (e && e.message) });
      });
      /** For the routes that change the account: logged in, and the account there. @param {any} req @param {any} res */
      const mustBeIn = (req, res) => {
        if (state() !== "ready") { res.status(401).json(needsSetup()); return false; }
        if (!loggedIn(req)) { res.status(401).json({ error: "Log in to Rouen first.", login: true }); return false; }
        return true;
      };

      app.get("/api/login", (/** @type {any} */ req, /** @type {any} */ res) => {
        res.set("Cache-Control", "no-store");
        const st = state(), inNow = st === "ready" && loggedIn(req);
        /** @type {Record<string, any>} */
        const body = { account: st === "ready", setup: st !== "ready", legacy: st === "legacy", loggedIn: inNow };
        if (inNow) body.user = /** @type {Stored} */ (stored()).user;
        res.json(body);
      });

      app.post("/api/login", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        if (state() !== "ready") return res.status(401).json(needsSetup());
        const body = req.body || {};
        const gen = generation;
        const bad = await verify(req, body.password, typeof body.user === "string" ? body.user : "");
        if (bad) return res.status(bad.status).json({ error: bad.error });
        // Every login ended while this one was checked (the password changed, or a reset): it is not issued.
        if (gen !== generation) return res.status(401).json({ error: "The password has just changed. Log in again." });
        issue(req, res);
        res.json({ ok: true });
      }));

      app.post("/api/logout", (/** @type {any} */ req, /** @type {any} */ res) => {
        const token = tokenFrom(req.headers && req.headers.cookie);
        if (token && sessions.delete(digest(token))) persist();
        clearCookie(res);
        res.json({ ok: true });
      });

      app.post("/api/login/setup", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        const body = req.body || {};
        const st = state();
        if (st === "ready") return res.status(409).json({ error: "Rouen already has an account. Log in with it." });
        const whyUser = badUser(body.user);
        if (whyUser) return res.status(400).json({ error: whyUser });
        /** @type {Stored} */
        let next;
        if (st === "legacy") {
          // The v1.9.22 password proves the install is the owner's: the
          // account is the username given with that password, as it is.
          const bad = await verify(req, body.current);
          if (bad) return res.status(bad.status).json({ error: bad.status === 401 ? "That isn't the password this Rouen already had." : bad.error });
          next = Object.assign({}, /** @type {Stored} */ (stored()), { user: String(body.user).trim(), setAt: now() });
        } else {
          const whyPass = badPassword(body.password);
          if (whyPass) return res.status(400).json({ error: whyPass });
          next = await account(String(body.user), body.password);
        }
        // Two devices making it at once: the hash took a moment, and the other may have won.
        if (state() === "ready") return res.status(409).json({ error: "Rouen already has an account. Log in with it." });
        if (!saveLogin(next)) return res.status(500).json({ error: "Couldn't save the account; nothing changed." });
        endAll();
        issue(req, res);
        log("account made (" + (st === "legacy" ? "from the password set before" : "new") + "); this device is logged in");
        res.json({ ok: true });
      }));

      app.post("/api/login/password", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        if (!mustBeIn(req, res)) return;
        const body = req.body || {};
        const bad = await verify(req, body.current);
        if (bad) return res.status(bad.status).json({ error: bad.error });
        const why = badPassword(body.password);
        if (why) return res.status(400).json({ error: why });
        const next = await account("-", body.password);
        // The username as it is now, after the hash: a rename saved meanwhile is kept.
        const now_ = stored();
        if (!now_ || typeof now_.user !== "string") return res.status(409).json({ error: "The account changed meanwhile; nothing changed." });
        next.user = now_.user;
        if (!saveLogin(next)) return res.status(500).json({ error: "Couldn't save the password; nothing changed." });
        endAll();          // every other device logs in with the new one
        issue(req, res);   // this one stays logged in
        log("password changed; every other login ended");
        res.json({ ok: true });
      }));

      app.post("/api/login/username", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
        if (!mustBeIn(req, res)) return;
        const body = req.body || {};
        const bad = await verify(req, body.current);
        if (bad) return res.status(bad.status).json({ error: bad.error });
        const why = badUser(body.user);
        if (why) return res.status(400).json({ error: why });
        const next = Object.assign({}, /** @type {Stored} */ (stored()), { user: String(body.user).trim() });
        if (!saveLogin(next)) return res.status(500).json({ error: "Couldn't save the username; nothing changed." });
        log("username changed");
        res.json({ ok: true, user: next.user });
      }));
    },
  };
}

module.exports = { createLogin, tokenFrom, userKey, COOKIE, MIN_LENGTH };
