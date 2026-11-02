// @ts-check
"use strict";
/*
 * tidal-session.js — the TIDAL session: the short-lived access token minted from the stored refresh token, and the
 * call wrapper that refreshes it once on a 401. Moved out of index.js unchanged in v1.9.72-t63 (dev/quality.md,
 * step 5).
 *
 * It owns the access token and its expiry (in memory only, never persisted) and the refresh in flight. The stored
 * connection (the refresh token, the user id, the country code, the display name) stays index.js's settings, read
 * through getters at the points the code read them; a rotated refresh token, and a connection Tidal refused, are
 * written back through setters.
 *
 * TIDAL's API is UNOFFICIAL (see lib/tidal.js): the LMS/Lyrion Tidal plugin's client credentials, against Tidal's
 * terms, the user's own account. Login is via Tidal's OAuth device flow — we never see the user's password. Use at
 * your own risk.
 */

/**
 * What the TIDAL session uses: index.js's own, by the same names (a getter for each value index.js may replace).
 * @typedef {object} TidalSessionDeps
 * @property {any} tidal  lib/tidal.js, the TIDAL client
 * @property {() => string} tidalRefreshToken
 * @property {(token: string) => void} setTidalRefreshToken
 * @property {() => string} tidalUserId
 * @property {(id: string) => void} setTidalUserId
 * @property {() => string} tidalCountryCode
 * @property {(name: string) => void} setTidalDisplayName
 * @property {{ clear: () => void }} tidalFavIds  the favourite album ids cache, cleared with a dead connection
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 */

/**
 * The TIDAL session, created once by lib/services/index.js.
 * @param {TidalSessionDeps} d
 */
function createTidalSession(d) {
  const { tidal, tidalFavIds, savePersistedSettings } = d;

  // In-memory only: short-lived access token minted from the refresh token.
  let tidalAccessToken = "";
  let tidalAccessTokenExpiry = 0; // epoch ms; refresh 5 min early

  // Mint (or reuse) a short-lived access token from the stored refresh token.
  // Refreshes 5 minutes before expiry. Throws a "not connected" error when no
  // refresh token is stored (message matched by the frontend + serviceErrorStatus).
  // Single-flight: concurrent callers (routes fire 2-3 Tidal calls in parallel
  // via Promise.all) share one refresh exchange — Tidal may rotate refresh
  // tokens, and parallel exchanges with the same token could invalidate it.
  /** @type {Promise<string> | null} */
  let tidalRefreshPending = null;
  /** @returns {Promise<string>} */
  async function tidalEnsureAccessToken() {
    if (!d.tidalRefreshToken()) throw new Error("Tidal not connected — connect your Tidal account in Settings");
    if (tidalAccessToken && Date.now() < tidalAccessTokenExpiry) return tidalAccessToken;
    if (tidalRefreshPending) return tidalRefreshPending;
    tidalRefreshPending = (async () => {
      try {
        const r = await tidal.refreshAccessToken(d.tidalRefreshToken());
        // The user may have disconnected while the exchange was in flight —
        // installing the fresh tokens would silently "re-connect" the account.
        if (!d.tidalRefreshToken()) throw new Error("Tidal not connected — connect your Tidal account in Settings");
        tidalAccessToken = r.accessToken;
        tidalAccessTokenExpiry = Date.now() + Math.max(r.expiresIn - 300, 60) * 1000;
        if (r.refreshToken && r.refreshToken !== d.tidalRefreshToken()) {
          d.setTidalRefreshToken(r.refreshToken); // Tidal rotated it — persist the new one
          savePersistedSettings({ tidalRefreshToken: d.tidalRefreshToken() });
        }
        return tidalAccessToken;
      } catch (e) {
        // A definitive rejection (revoked/expired refresh token) means the
        // stored connection is dead: degrade to "not connected" so the UI
        // shows the reconnect prompt instead of an endless 502.
        if (e && e.code === 401 && d.tidalRefreshToken()) {
          console.error("[tidal] refresh token rejected — clearing stored connection");
          d.setTidalDisplayName("");
          d.setTidalUserId("");
          d.setTidalRefreshToken("");
          tidalAccessToken = "";
          tidalAccessTokenExpiry = 0;
          tidalFavIds.clear();
          savePersistedSettings({ tidalRefreshToken: "", tidalUserId: "", tidalDisplayName: "" });
          throw new Error("Tidal not connected — connect your Tidal account in Settings");
        }
        throw e;
      } finally {
        tidalRefreshPending = null;
      }
    })();
    return tidalRefreshPending;
  }

  // Run an authenticated Tidal call as fn(accessToken, countryCode, userId); on
  // a 401 (expired/revoked access token) refresh once and retry. Throws a
  // "not connected" error if no refresh token is stored.
  /**
   * @param {(token: string, countryCode: string, userId: string) => Promise<any>} fn
   * @returns {Promise<any>}
   */
  async function tidalWithToken(fn) {
    const token = await tidalEnsureAccessToken();
    try {
      return await fn(token, d.tidalCountryCode(), d.tidalUserId());
    } catch (e) {
      if (e && e.code === 401 && d.tidalRefreshToken()) {
        tidalAccessToken = "";      // discard the rejected token …
        tidalAccessTokenExpiry = 0; // … and force a fresh refresh
        const fresh = await tidalEnsureAccessToken();
        return await fn(fresh, d.tidalCountryCode(), d.tidalUserId());
      }
      throw e;
    }
  }

  return {
    tidalEnsureAccessToken, tidalWithToken,
    /** Install the access token a device login was approved with (POST /api/settings/tidal/start). @param {string} v */
    setTidalAccessToken: (v) => { tidalAccessToken = v; },
    /** @param {number} v  epoch ms */
    setTidalAccessTokenExpiry: (v) => { tidalAccessTokenExpiry = v; },
  };
}

module.exports = { createTidalSession };
