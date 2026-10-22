// @ts-check
"use strict";
/*
 * choices.js — the one-time choice (dev/design/login.md §5, the owner, 2026-10-20; v1.9.32):
 * whether this Rouen has user accounts, and whether it has native mode. Made once — at install,
 * or at the first start after v1.9.32 — and never again: only removing Rouen's data volume
 * (with every other setting) undoes it.
 *
 *   settings.choices = { accounts, native, at, version }, written by POST /api/choices alone,
 *   never backed up or restored (lib/backup.js NEVER_KEYS).
 *
 * Its guard stands in front of the login's: until the choice is made every guarded request is
 * refused ({ choose: true }, or { login: true } on an install with an account whose device is
 * not logged in — the choice is the account owner's, not the first device's to arrive); made with
 * accounts off, every request goes through; made with accounts on, the login's guard decides.
 */
const { needsLogin } = require("./login-routes");

/**
 * @typedef {{ accounts: boolean, native: boolean, at: number, version: string }} Choice
 * @typedef {{ optIn(): void, optOut(): void }} NativeSwitch
 */

/**
 * The choice in these settings, or null while it is not made: the one definition, which
 * login.js uses too (the review). @param {any} settings @returns {Choice | null}
 */
function madeOf(settings) {
  const c = (settings || {}).choices;
  return c && typeof c.accounts === "boolean" && typeof c.native === "boolean" ? c : null;
}

/**
 * @param {{ getSettings: () => any, saveSettings: (patch: any) => boolean,
 *           login: ReturnType<typeof import("./login").createLogin>, version: string,
 *           log?: (line: string) => void, now?: () => number }} o
 */
function createChoices(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  /** Native mode's own switch, told the choice (stage1.js), once it exists. @type {NativeSwitch | null} */
  let nativeSwitch = null;

  /** The choice, or null while it is not made. */
  const made = () => madeOf(o.getSettings());

  return {
    made,
    /** Whether native mode was chosen: true, false, or null while the choice is not made. */
    native() { const c = made(); return c ? c.native : null; },
    /** Whether this Rouen has accounts: true, false, or null while the choice is not made. */
    accounts() { const c = made(); return c ? c.accounts : null; },
    /** @param {NativeSwitch} s */
    nativeWith(s) { nativeSwitch = s; },

    /** Express middleware, in place of the login's own guard. */
    guard(/** @type {any} */ req, /** @type {any} */ res, /** @type {Function} */ next) {
      if (!needsLogin(req.method, req.path)) return next();
      const c = made();
      if (!c) {
        if (o.login.state() === "ready" && !o.login.loggedIn(req)) return res.status(401).json({ error: "Log in to Rouen first.", login: true });
        // `legacy`: the sheet must ask for the v1.9.22 password, whichever answer reaches the page first (the review).
        return res.status(401).json({ error: "Choose how Rouen works first.", choose: true, legacy: o.login.state() === "legacy" });
      }
      if (!c.accounts) return next();
      return o.login.guard(req, res, next);
    },

    /** @param {{ get: Function, post: Function }} app */
    mount(app) {
      app.get("/api/choices", (/** @type {any} */ req, /** @type {any} */ res) => {
        res.set("Cache-Control", "no-store");
        const c = made(), st = o.login.state();
        res.json(c ? { made: true, accounts: c.accounts, native: c.native }
          : { made: false, account: st === "ready", legacy: st === "legacy", loginFirst: st === "ready" && !o.login.loggedIn(req) });
      });

      app.post("/api/choices", async (/** @type {any} */ req, /** @type {any} */ res) => {
        try {
          if (made()) return res.status(409).json({ error: "This Rouen's choices are made already. They change only by removing Rouen and its data, and installing it again." });
          const b = req.body || {};
          if (typeof b.accounts !== "boolean" || typeof b.native !== "boolean" || b.understood !== true) {
            return res.status(400).json({ error: "Answer both, and tick that you understand they can't be changed later." });
          }
          const st = o.login.state();
          if (st === "ready" && !o.login.loggedIn(req)) return res.status(401).json({ error: "Log in to Rouen first.", login: true });
          if (st === "legacy") {
            const bad = await o.login.check(req, b.current);
            if (bad) return res.status(bad.status).json({ error: bad.status === 401 ? "That isn't the password this Rouen already had." : bad.error });
          }
          // Two devices at once: the password check took a moment, and the other may have won.
          if (made()) return res.status(409).json({ error: "This Rouen's choices were made just now, on another device." });
          /** @type {Choice} */
          const choice = { accounts: b.accounts, native: b.native, at: now(), version: o.version };
          const settings = o.getSettings() || {};
          const before = { choices: settings.choices, login: settings.login };
          // One write: the choice, and with no accounts the account gone with it — or nothing.
          if (!o.saveSettings(b.accounts ? { choices: choice } : { choices: choice, login: null })) {
            Object.assign(settings, before);   // the store changed its copy first; nothing changed on disk
            return res.status(500).json({ error: "Couldn't save your choices; nothing changed." });
          }
          if (!b.accounts) o.login.endAll();
          log(`made: accounts ${b.accounts ? "on" : "off"}${!b.accounts && st !== "none" ? " (the account removed, every login ended)" : ""}, native mode ${b.native ? "chosen" : "not chosen"}`);
          if (nativeSwitch) {
            try { if (b.native) nativeSwitch.optIn(); else nativeSwitch.optOut(); }
            catch (e) { log("native mode could not be told the choice now: " + (e && /** @type {any} */ (e).message) + "; it is at the next start"); }
          }
          res.json({ ok: true, accounts: b.accounts, native: b.native });
        } catch (e) {
          log("choice route failed: " + (e && /** @type {any} */ (e).message));
          if (!res.headersSent) res.status(500).json({ error: "Couldn't save your choices: " + (e && /** @type {any} */ (e).message) });
        }
      });
    },
  };
}

module.exports = { createChoices, madeOf };
