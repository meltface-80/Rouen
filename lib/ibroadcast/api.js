// @ts-check
"use strict";
/*
 * api.js — iBroadcast's servers as Rouen asks them (2.0.6-t1, dev/design/ibroadcast.md §3.1), ported from Mandarin's
 * IBroadcastApi.cs (its dev branch, 2026-11-19):
 *   - OAuth 2.0 on oauth.ibroadcast.com, by its device flow: a code shown on Rouen's page, approved by the person on
 *     iBroadcast, asked after at the interval iBroadcast gives. No address of Rouen's to register, so a server at home
 *     signs in as a TV app does. The access token is renewed before it expires, and once more when an answer says
 *     "authenticated": false; the refresh token kept when none comes back.
 *   - the JSON API on api.ibroadcast.com: POST /<mode>, the mode, the client, its version, the device's name and the
 *     user agent in the body, Bearer <access token>. Not REST: "result": false is a failure, in iBroadcast's words.
 * `base` (the tests' stand-in, test/lib/fake-ibroadcast.js) puts every server under one address: <base>/oauth, /api,
 * /library.
 */

/** Mandarin's app at iBroadcast (the owner's answer, 2026-11-20: Rouen signs in as it); not a secret. */
const CLIENT_ID = "15389a47e1c211f1b50eb49691aa2236";
/** Read only: the account and the library (§3.1). */
const SCOPES = "user.account:read user.library:read";

/** A failure said in words the page can show, with the status Rouen answers it with. */
class IBroadcastError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.status = status; }
}

/**
 * @typedef {{ access: string, refresh: string | null, expires: number, life: number, scope: string | null }} Token
 * @typedef {{ code: string, userCode: string, url: string, expiresIn: number, interval: number }} DeviceCode
 */

/**
 * Whether a token expiring at `expires` (lasting `life` in all, where known) is renewed `now` (each in ms): with ten
 * minutes left, or half its life for one shorter-lived, so a fresh one is never renewed at once; its life not known,
 * the last minute.
 * @param {number} now @param {number} expires @param {number | null | undefined} life
 */
function renewDue(now, expires, life) {
  return now > expires - (typeof life === "number" ? Math.min(10 * 60 * 1000, life / 2) : 60000);
}

/** A JSON value as text; null where there is none. @param {any} v @returns {string | null} */
function str(v) {
  if (v === null || v === undefined || typeof v === "object") return null;
  const s = String(v);
  return s.length ? s : null;
}

/** @param {any} v @param {number} or */
const num = (v, or) => { const n = typeof v === "number" ? v : Number.parseFloat(String(v)); return Number.isFinite(n) ? n : or; };

/** What iBroadcast said of a failure. @param {any} j @param {string} or */
const said = (j, or) => str(j && j.message) || str(j && j.error_description) || str(j && j.error) || or;

/** @param {string} text @returns {any} */
function parse(text) {
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }   // not JSON: no answer to read, said as such by the caller
}

/**
 * @param {{ base?: string | null, version: string, token: () => Token | null, keep: (t: Token) => void,
 *           lost?: () => void, now?: () => number, fetch?: typeof fetch }} o
 *   token: the tokens kept; keep: keeps renewed ones; lost: iBroadcast refused the refresh token (the review): the
 *   sign-in is no good, and is to be made again
 */
function createIBroadcastApi(o) {
  const b = o.base ? o.base.replace(/\/+$/, "") : null;
  const oauth = b ? b + "/oauth" : "https://oauth.ibroadcast.com";
  const api = b ? b + "/api" : "https://api.ibroadcast.com";
  const library = b ? b + "/library" : "https://library.ibroadcast.com";
  const now = o.now || Date.now;
  const doFetch = o.fetch || fetch;
  const agent = "rouen/" + o.version;
  /** The renewal under way: each caller waits for the one. @type {Promise<Token> | null} */
  let renewing = null;

  /**
   * A request, its status and text; not answering, said so.
   * @param {string} url @param {{ method?: string, headers?: Record<string, string>, body?: string, timeoutMs?: number }} [r]
   */
  async function call(url, r = {}) {
    try {
      const res = await doFetch(url, { method: r.method || "GET", headers: Object.assign({ "User-Agent": agent }, r.headers || {}),
        body: r.body, signal: AbortSignal.timeout(r.timeoutMs || 15000) });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      throw new IBroadcastError("iBroadcast couldn't be reached (" + String((e && /** @type {any} */ (e).message) || e) + ")", 502);
    }
  }

  /** @param {string} path @param {Record<string, string>} form */
  const post = (path, form) => call(oauth + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString() });

  /** @param {any} j @param {string | null} oldRefresh @returns {Token} */
  const tokenOf = (j, oldRefresh) => ({
    access: String(j.access_token),
    refresh: str(j.refresh_token) || oldRefresh,
    expires: now() + num(j.expires_in, 3600) * 1000,
    life: num(j.expires_in, 3600) * 1000,
    scope: Array.isArray(j.scope) ? j.scope.join(" ") : str(j.scope),
  });

  /** @param {string} refused  the access token an answer refused: a renewal since is the one to use */
  async function renew(refused) {
    const t = o.token();
    if (!t || !t.refresh) throw new IBroadcastError("Not signed in to iBroadcast", 401);
    if (refused && t.access !== refused) return t;
    const r = await post("/token", { grant_type: "refresh_token", refresh_token: t.refresh, client_id: CLIENT_ID });
    const j = parse(r.text);
    if (!str(j && j.access_token)) {
      // iBroadcast failing is not iBroadcast refusing: the sign-in stays, for the next try.
      if (r.status >= 500) throw new IBroadcastError(said(j, "iBroadcast answered " + r.status), 502);
      if (o.lost) o.lost();
      throw new IBroadcastError(said(j, "iBroadcast refused a new sign-in token (" + r.status + "): sign in again"), 401);
    }
    const next = tokenOf(j, t.refresh);
    o.keep(next);
    return next;
  }

  const self = {
    oauth, api, library,

    /** A code to sign in with, from iBroadcast. @returns {Promise<DeviceCode>} */
    async beginDevice() {
      const r = await call(oauth + "/device/code?client_id=" + CLIENT_ID + "&scope=" + encodeURIComponent(SCOPES));
      const j = parse(r.text);
      const code = str(j && j.device_code);
      if (r.status >= 400 || !code) throw new IBroadcastError(said(j, "iBroadcast answered " + r.status), 502);
      return { code, userCode: str(j.user_code) || "", url: str(j.verification_uri_complete) || str(j.verification_uri) || "https://media.ibroadcast.com",
        expiresIn: num(j.expires_in, 600), interval: Math.max(1, num(j.interval, 5)) };
    },

    /**
     * One ask whether `deviceCode` is approved: its tokens once it is; null while not (slower: iBroadcast asks to be
     * asked less often).
     * @param {string} deviceCode @returns {Promise<{ token: Token | null, slower: boolean }>}
     */
    async pollDevice(deviceCode) {
      const r = await post("/token", { grant_type: "device_code", client_id: CLIENT_ID, device_code: deviceCode });
      const j = parse(r.text);
      if (r.status < 400 && str(j && j.access_token)) return { token: tokenOf(j, null), slower: false };
      // iBroadcast failing for a moment is not an answer: asked again at the interval (the review).
      if (r.status >= 500) return { token: null, slower: false };
      let error = str(j && j.error);
      // Said "Unauthorized client: `grant_type` is invalid" to a real account (Mandarin's item 444), whatever its code.
      if (said(j, "").includes("nauthorized client")) error = "unauthorized_client";
      switch (error) {
        case "authorization_pending": return { token: null, slower: false };
        case "slow_down": return { token: null, slower: true };
        case "expired_token": throw new IBroadcastError("The code expired: sign in again for a new one", 410);
        case "access_denied": throw new IBroadcastError("The sign-in was turned down on iBroadcast", 401);
        case "unauthorized_client": throw new IBroadcastError("iBroadcast doesn't let this app sign in with a code: on media.ibroadcast.com, Apps → Developers, edit the app and allow the device code sign-in", 401);
        default: throw new IBroadcastError(said(j, "iBroadcast answered " + r.status), 401);
      }
    },

    /**
     * A new access token from the refresh token, kept; one renewal at a time.
     * @param {string} [refused] @returns {Promise<Token>}
     */
    refresh(refused = "") {
      if (!renewing) renewing = renew(refused).finally(() => { renewing = null; });
      return renewing;
    },

    /** The sign-in let go at iBroadcast too, whatever it answers. @param {string} refresh */
    async revoke(refresh) {
      try { await post("/revoke", { refresh_token: refresh, client_id: CLIENT_ID }); }
      catch (e) { /* forgotten here all the same: iBroadcast's copy lapses when it is never renewed */ }
    },

    /** The access token, renewed first where it is due. @returns {Promise<string>} */
    async access() {
      const t = o.token();
      if (!t || !t.access) throw new IBroadcastError("Not signed in to iBroadcast", 401);
      if (typeof t.expires === "number" && renewDue(now(), t.expires, t.life)) return (await self.refresh(t.access)).access;
      return t.access;
    },

    /**
     * The JSON API's `mode`, with `extra` in the body; `url` another server's address (the library's).
     * @param {string} mode @param {Record<string, any>} [extra] @param {string} [url] @returns {Promise<any>}
     */
    async json(mode, extra, url) {
      const body = JSON.stringify(Object.assign({ client: "rouen", version: o.version, device_name: "Rouen", user_agent: agent, mode }, extra || {}));
      let access = await self.access();
      for (let again = false; ; again = true) {
        const r = await call(url || api + "/" + mode, { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
          body, timeoutMs: 60000 });
        const j = parse(r.text);
        const refused = r.status === 401 || (j && j.authenticated === false);
        if (refused && !again) { access = (await self.refresh(access)).access; continue; }
        if (refused) throw new IBroadcastError("iBroadcast turned the sign-in down: sign in again", 401);
        if (r.status >= 400 || !j || typeof j !== "object") throw new IBroadcastError(said(j, "iBroadcast answered " + r.status), 502);
        if (j.result === false) throw new IBroadcastError(said(j, "iBroadcast refused it"), 502);
        return j;
      }
    },
  };
  return self;
}

module.exports = { createIBroadcastApi, renewDue, str, IBroadcastError, CLIENT_ID, SCOPES };
