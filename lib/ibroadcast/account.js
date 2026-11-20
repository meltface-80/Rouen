// @ts-check
"use strict";
/*
 * account.js — the iBroadcast account (2.0.6-t1, dev/design/ibroadcast.md §3.1), ported from Mandarin's IBroadcast.cs:
 * signed in with a code shown on the plugin's page and approved on iBroadcast; what the account is (its name, whether
 * it is Premium, the file types iBroadcast takes); and signed out again, the sign-in let go at iBroadcast too.
 *
 * Kept in Rouen's settings under one key, ibroadcastToken: { token: { access, refresh, expires, life, scope },
 * user: { id, name }, premium, formats, checked, since }. One key, so a backup's keys part carries the sign-in and the
 * account it is for together (lib/backup.js sends any key named like a token there). The tokens are never logged or
 * sent to the page. A sign-in under way lives here, in memory: iBroadcast asked at the interval it gave until the code
 * is approved, turned down or expired, or the sign-in is let go (close(): the plugin removed).
 */
const { createIBroadcastApi, str, IBroadcastError } = require("./api");

const KEY = "ibroadcastToken";
/** File types iBroadcast lists that are playlists, not audio. */
const PLAYLISTS = new Set(["m3u", "m3u8", "pls", "kpl", "pcast", "xspf", "wpl", "asx"]);

/**
 * @typedef {import("./api").Token} Token
 * @typedef {{ code: import("./api").DeviceCode, expires: number, interval: number, timer: any, error: string | null }} Pending
 * @typedef {{ token: Token, user?: { id: any, name: string | null }, premium?: boolean | null, formats?: string[],
 *             checked?: number, since?: number }} Kept
 */

/**
 * @param {{ load: () => Record<string, any>, save: (patch: Record<string, any>) => boolean, version: string,
 *           base?: string | null, log?: (line: string) => void, now?: () => number, fetch?: typeof fetch,
 *           onSignedIn?: () => void }} o
 *   onSignedIn: the sign-in completed (the library is read then)
 */
function createIBroadcastAccount(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  /** @returns {Kept | null} */
  const kept = () => { const k = (o.load() || {})[KEY]; return k && typeof k === "object" && k.token && k.token.access ? k : null; };
  /** @param {Kept | null} k */
  const store = (k) => { if (!o.save({ [KEY]: k || undefined })) throw new IBroadcastError("Rouen couldn't save the sign-in", 500); };

  const api = createIBroadcastApi({ base: o.base, version: o.version, now: o.now, fetch: o.fetch,
    token: () => { const k = kept(); return k ? k.token : null; },
    keep: (t) => { const k = kept(); if (k) store(Object.assign({}, k, { token: t })); },
    // A refresh token iBroadcast no longer takes: signed out here, so the page offers Sign in again (the review).
    lost: () => { if (kept()) { store(null); log("iBroadcast refused the sign-in's renewal: signed out, to sign in again"); } } });

  /** The account's reading under way, and when one was last tried: one at a time, and not again at every look. */
  /** @type {Promise<void> | null} */
  let describing = null;
  let triedAt = 0;

  /** @type {Pending | null} */
  let pending = null;

  function cancel() {
    if (pending && pending.timer) clearTimeout(pending.timer);
    pending = null;
  }

  /** @param {Pending} p */
  function later(p) {
    if (pending !== p) return;
    p.timer = setTimeout(() => { ask(p); }, p.interval * 1000);
  }

  /** The account read again from iBroadcast: its name, Premium, the formats it takes; kept. */
  async function describe() {
    const j = await api.json("status", { supported_types: true });
    const k = kept();
    if (!k) throw new IBroadcastError("Not signed in to iBroadcast", 401);
    const user = j.user && typeof j.user === "object" ? j.user : {};
    const name = ["username", "user_name", "email_address", "email", "name"].map((n) => str(user[n])).find(Boolean) || null;
    store(Object.assign({}, kept() || k, { user: { id: user.id === undefined ? null : user.id, name }, premium: premium(user),
      formats: formats(j), checked: now() }));
  }

  /** describe(), one at a time: a second asker waits for the one under way. */
  function describeOnce() {
    if (!describing) {
      triedAt = now();
      describing = describe().finally(() => { describing = null; });
    }
    return describing;
  }

  /** iBroadcast asked once: not yet, asked again; approved, kept; refused or expired, said on the page. @param {Pending} p */
  async function ask(p) {
    try {
      if (pending !== p) return;
      if (now() > p.expires) { p.error = "The code expired: sign in again for a new one"; return; }
      const r = await api.pollDevice(p.code.code);
      if (pending !== p) return;
      if (!r.token) {
        if (r.slower) p.interval += 5;
        later(p);
        return;
      }
      store({ token: r.token, since: now() });
      cancel();
      log("signed in");
      // The library's reading begun beside the account's: the page goes on asking while either runs.
      if (o.onSignedIn) o.onSignedIn();
      try { await describeOnce(); }
      catch (e) { log("the account couldn't be read: " + String(/** @type {any} */ (e).message)); }
    } catch (e) {
      // iBroadcast out of reach for a moment (the review): asked again, so an approval made meanwhile is still found.
      if (pending === p && e instanceof IBroadcastError && e.status === 502) { later(p); log("sign-in: " + e.message + "; asking again"); return; }
      if (pending === p) p.error = e instanceof IBroadcastError ? e.message : "The sign-in failed: " + String(/** @type {any} */ (e).message);
      log("sign-in: " + String(/** @type {any} */ (e).message));
    }
  }

  /** The audio file types iBroadcast takes, as extensions without the dot. @param {any} j @returns {string[]} */
  function formats(j) {
    const all = (Array.isArray(j.supported) ? j.supported : [])
      .map((/** @type {any} */ f) => str(f && typeof f === "object" ? f.extension : f))
      .filter(Boolean).map((/** @type {string} */ e) => e.replace(/^\./, "").toLowerCase())
      .filter((/** @type {string} */ e) => e.length && !PLAYLISTS.has(e));
    return [...new Set(all)].sort();
  }

  /** Premium as the account answer says it (a flag or 0/1); null where it doesn't. @param {any} user */
  function premium(user) {
    const v = user && user.premium;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v === "1" || v === "true";
    return null;
  }

  const self = {
    api,
    /** Signed in: a token kept. */
    connected: () => !!kept(),
    /** iBroadcast's id for the account; null signed out or not yet read. */
    userId: () => { const k = kept(); return k && k.user ? str(k.user.id) : null; },

    /** A sign-in begun: a code to approve on iBroadcast; one under way that hasn't failed or expired, as it is. */
    async beginSignIn() {
      if (kept()) return self.status();
      if (pending && !pending.error && now() < pending.expires) return self.status();
      cancel();
      const code = await api.beginDevice();
      /** @type {Pending} */
      const p = { code, expires: now() + code.expiresIn * 1000, interval: code.interval, timer: null, error: null };
      pending = p;
      later(p);
      log("sign-in begun: waiting for the code to be approved on iBroadcast");
      return self.status();
    },

    cancelSignIn() { cancel(); return self.status(); },

    describe: describeOnce,

    /**
     * The account read again when it is due: six hours since it was read, and five minutes since it was last tried (a
     * reading that fails is not tried again at every look of the page: the review); none while one is under way.
     */
    refreshIfDue() {
      const k = kept();
      if (!k || describing || now() - triedAt < 5 * 60 * 1000) return;
      if (typeof k.checked === "number" && now() - k.checked < 6 * 3600 * 1000) return;
      describeOnce().catch((e) => { log("the account couldn't be read: " + String(e.message)); });
    },

    /** The state as the page reads it: signed in or not, the account, a sign-in under way. Never a token. */
    status() {
      const k = kept();
      if (k) {
        // describing: the account being read, so the page goes on asking until it has it (the review).
        return { connected: true, user: { name: k.user ? k.user.name : null }, premium: k.premium === undefined ? null : k.premium,
          formats: k.formats || [], since: k.since || null, describing: !!describing };
      }
      /** @type {Record<string, any>} */
      const out = { connected: false };
      if (pending) out.pending = { url: pending.code.url, code: pending.code.userCode, expires_at: pending.expires, error: pending.error };
      return out;
    },

    /** Signed out: forgotten here, and the sign-in let go at iBroadcast. */
    async signOut() {
      cancel();
      const k = kept();
      store(null);
      if (k && k.token.refresh) await api.revoke(k.token.refresh);
      log("signed out");
      return self.status();
    },

    /** The plugin removed: a sign-in under way stops asking. The account stays, for when it is installed again. */
    close() { cancel(); },
  };
  return self;
}

module.exports = { createIBroadcastAccount, KEY };
