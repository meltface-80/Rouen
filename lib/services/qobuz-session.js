// @ts-check
"use strict";
/*
 * qobuz-session.js — the Qobuz session: which token a call goes out under, the re-login behind it, and the token
 * minted under the signing app_id for the streaming waveform. Moved out of index.js unchanged in v1.9.72-t63
 * (dev/quality.md, step 5).
 *
 * It owns the in-memory state only it reads: the re-login in flight and its backoff, and the minted signing token
 * (_qobuzSignTok, _qobuzSignTokAt), which lib/wave/ reads and forgets through qobuzSignTok / setQobuzSignTok /
 * setQobuzSignTokAt — one place for that credential. The stored credentials (the login, its password hash, the
 * sign-in's token, the signing app_id) stay index.js's settings, read through getters at the points the code read
 * them, and the two a re-login replaces are written back through setters.
 *
 * Qobuz's API is UNOFFICIAL (see lib/qobuz.js): the LMS/Lyrion Qobuz plugin's app_id, against Qobuz's terms, the
 * user's own account. Use at your own risk.
 */

/**
 * What the Qobuz session uses: index.js's own, by the same names (a getter for each value index.js may replace).
 * @typedef {object} QobuzSessionDeps
 * @property {any} qobuz  lib/qobuz.js, the Qobuz client
 * @property {{ APP_ID: string }} QOA  lib/qobuz-oauth.js: the built-in sign-in's app
 * @property {() => string} qobuzSignAppId  the app_id of the pasted secret (the older route), "" for none
 * @property {() => string} qobuzUsername
 * @property {() => string} qobuzPasswordMd5
 * @property {() => string} qobuzToken  this app's own (legacy) login token
 * @property {(token: string) => void} setQobuzToken
 * @property {() => string} qobuzDisplayName
 * @property {(name: string) => void} setQobuzDisplayName
 * @property {() => string} qobuzWaveToken  the browser sign-in's token
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 * @property {(key: string, msg: string) => void} wfQobuzSayOnce  the streaming waveform's said-once log
 */

/**
 * The Qobuz session, created once by lib/services/index.js.
 * @param {QobuzSessionDeps} d
 */
function createQobuzSession(d) {
  const { qobuz, QOA, savePersistedSettings, wfQobuzSayOnce } = d;

  // Re-login with the stored username + md5 password, refreshing the token.
  // In-flight dedup + failure backoff: the global search made this path implicit
  // (typed queries, possibly overlapping) — with STALE stored credentials it
  // would otherwise fire a doomed login POST per search. Concurrent callers
  // share one attempt; after a failure, attempts are refused for 60s with a
  // "not connected" error (mapped to 400 by serviceErrorStatus) instead of
  // hammering Qobuz's login endpoint. The Settings "save credentials" flow
  // calls qobuz.login directly, so an explicit user retry is never blocked.
  /** @type {Promise<void> | null} */
  let qobuzLoginPending  = null;
  let qobuzLoginFailedAt = 0;
  /** @returns {Promise<void>} */
  function qobuzRelogin() {
    if (Date.now() - qobuzLoginFailedAt < 60 * 1000) {
      return Promise.reject(new Error("Qobuz not connected — recent login attempt failed, retrying shortly"));
    }
    if (!qobuzLoginPending) {
      qobuzLoginPending = (async () => {
        try {
          const r = await qobuz.login(d.qobuzUsername(), d.qobuzPasswordMd5(), true);
          d.setQobuzToken(r.token);
          d.setQobuzDisplayName(r.displayName);
          qobuzLoginFailedAt = 0;
          savePersistedSettings({ qobuzToken: d.qobuzToken(), qobuzDisplayName: d.qobuzDisplayName() });
        } catch (e) {
          qobuzLoginFailedAt = Date.now();
          throw e;
        } finally {
          qobuzLoginPending = null;
        }
      })();
    }
    return qobuzLoginPending;
  }

  /*
   * A Qobuz token minted under the SIGNING app_id.
   *
   * THE THING THAT MAKES STREAMING WAVEFORMS POSSIBLE AT ALL. A user_auth_token
   * belongs to the app that issued it, and Qobuz refuses a signed request whose
   * app_id is not that app — HTTP 401, indistinguishable from an expired login.
   * This app's own token is minted under lib/qobuz.js's app_id, for which there is
   * no secret and never will be; the secret the user supplies belongs to a
   * different app. Every pairing of those two therefore fails, which is exactly
   * what v1.8.10-12 kept walking into from different directions.
   *
   * The way out is not another combination of what we already hold: it is to mint
   * a SECOND token under the app the secret belongs to. user/login is unsigned and
   * takes an app_id, and the stored username/password hash is already here for
   * re-login — so this costs one extra login, once, and pairs correctly by
   * construction.
   *
   * Cached in memory only. It is a credential, it is derivable at any time from
   * what is already persisted, and a token on disk is one more thing to leak.
   */
  /** @type {{ appId: string, token: string } | null} */
  let _qobuzSignTok    = null;   // { appId, token }
  let _qobuzSignTokAt  = 0;      // when the last attempt failed, for the backoff
  /** @type {Promise<string | null> | null} */
  let _qobuzSignTokJob = null;
  /** @returns {Promise<string | null | undefined>} */
  async function qobuzSigningToken() {
    const appId = String(d.qobuzSignAppId() || "").trim();
    // No separate app to sign as: the caller should use this app's own token.
    if (!appId) return null;
    if (!d.qobuzUsername() || !d.qobuzPasswordMd5()) {
      // Said once, or it is a line per poll. Without the stored login there is
      // nothing to mint FROM, and the attempt simply would not appear in the
      // decline list below — an absence is not a diagnosis.
      wfQobuzSayOnce("no-login-to-mint",
        "[waveform] qobuz: a signing app_id is set but this app has no stored Qobuz " +
        "username/password to mint a matching token with. Re-enter your Qobuz login " +
        "under Settings → Audio Devices → Waveform (Qobuz waveforms) so it can be saved.");
      return null;
    }
    if (_qobuzSignTok && _qobuzSignTok.appId === appId) return _qobuzSignTok.token;
    // Same 60s backoff qobuzRelogin uses: a wrong password must not become a
    // login attempt per poll, and the clients poll.
    if (Date.now() - _qobuzSignTokAt < 60 * 1000) return null;
    if (!_qobuzSignTokJob) {
      _qobuzSignTokJob = (async () => {
        try {
          const r = await qobuz.login(d.qobuzUsername(), d.qobuzPasswordMd5(), true, appId);
          _qobuzSignTok = { appId, token: r.token };
          _qobuzSignTokAt = 0;
          console.log("[waveform] qobuz: minted a signing token under app " + appId);
          return r.token;
        } catch (e) {
          _qobuzSignTokAt = Date.now();
          console.log("[waveform] qobuz: could not mint a token under app " + appId +
                      " — " + (e && e.message ? e.message : "unknown error"));
          return null;
        } finally { _qobuzSignTokJob = null; }
      })();
    }
    return _qobuzSignTokJob;
  }

  // Run an authenticated Qobuz call; on a 401 (expired token), re-login once and
  // retry. Throws a "not connected" error if no credentials are stored.
  /*
   * ONE QOBUZ LOGIN FOR EVERYTHING.
   *
   * Signing in through the browser (lib/qobuz-oauth.js) produces a token that can
   * do strictly more than the username/password one: it reads the catalogue and
   * the favourites like any other, AND it can sign the streaming call, which the
   * password token can never do because this app holds no secret for the app that
   * mints it. So when it is present it IS the session — favourites, search,
   * artists, waveforms — and the app_id moves with it, because a
   * token presented under another app's id is refused.
   *
   * The password login is still honoured underneath for installs that had one, and
   * as the fallback if a call is ever refused under the sign-in's app. Nothing
   * offers it any more.
   */
  function qobuzActiveToken() {
    return d.qobuzWaveToken() || d.qobuzToken();
  }

  // Keep lib/qobuz's default app_id in step with whichever token is in play.
  // Called at startup and after every connect/disconnect.
  function qobuzSyncAppId() {
    qobuz.setDefaultAppId(d.qobuzWaveToken() ? QOA.APP_ID : qobuz.APP_ID);
  }

  /**
   * @param {(token: string) => Promise<any>} fn
   * @returns {Promise<any>}
   */
  async function qobuzWithToken(fn) {
    if (!qobuzActiveToken() && d.qobuzUsername() && d.qobuzPasswordMd5()) await qobuzRelogin();
    const tok = qobuzActiveToken();
    if (!tok) throw new Error("Qobuz not connected — connect Qobuz in Settings");
    try {
      return await fn(tok);
    } catch (e) {
      if (!e || e.code !== 401) throw e;
      // A 401 under the SIGN-IN's token is not a stale token — it is minted by the
      // browser flow and does not expire the way a password session does. It means
      // that endpoint refused this app, which is a real finding and must be seen,
      // not papered over. There is deliberately no fallback here: swapping the
      // app_id mid-flight would race every other in-flight call, and on an install
      // that only ever signed in there is no password login to fall back to
      // anyway. Say which call it was and let it fail.
      if (d.qobuzWaveToken()) {
        console.log("[qobuz] refused (401) under the sign-in's app " + qobuz.currentAppId() +
                    ". If a screen is empty because of this, it needs reporting.");
        throw e;
      }
      if (d.qobuzUsername() && d.qobuzPasswordMd5()) {
        await qobuzRelogin();
        return await fn(d.qobuzToken());
      }
      throw e;
    }
  }

  return {
    qobuzSigningToken, qobuzActiveToken, qobuzSyncAppId, qobuzWithToken,
    /** The token minted under the signing app_id, or null (lib/wave/ reads it, and forgets one Qobuz refused). */
    qobuzSignTok: () => _qobuzSignTok,
    /** @param {{ appId: string, token: string } | null} v */
    setQobuzSignTok: (v) => { _qobuzSignTok = v; },
    /** When the last mint failed, for its backoff (lib/wave/ zeroes it when the signing pair changes). @param {number} v */
    setQobuzSignTokAt: (v) => { _qobuzSignTokAt = v; },
  };
}

module.exports = { createQobuzSession };
