// @ts-check
"use strict";
/*
 * tidal-routes.js — the TIDAL connection in Settings, moved out of index.js unchanged in v1.9.72-t63
 * (dev/quality.md, step 5):
 *
 *   GET  /api/settings/tidal             → { connected, displayName }   never a token
 *   POST /api/settings/tidal/start       → { user_code, verification_uri, verification_uri_complete, expires_in }:
 *                                        the OAuth device flow, polled here until approved; 409 when a newer
 *                                        attempt superseded it, 502 when TIDAL refuses
 *   GET  /api/settings/tidal/status      → { state: "connected" | "pending" | "error" | "idle", ... }
 *   POST /api/settings/tidal/disconnect  → { ok }: the stored connection and any login in progress cleared
 *
 * TIDAL's catalogue routes (new releases, an artist's albums, the featured lists) served Rouen's own TIDAL browser
 * and went with it in v1.9.72-t77. index.js mounts these where it registered them. The device login in progress
 * lives here, the only place that reads it.
 */

/**
 * What the TIDAL routes use: index.js's own, by the same names (a getter for each value index.js may replace, and a
 * setter for each the routes replace), and the session's.
 * @typedef {object} TidalRouteDeps
 * @property {boolean} DEBUG
 * @property {any} tidal  lib/tidal.js, the TIDAL client
 * @property {() => string} tidalRefreshToken
 * @property {(v: string) => void} setTidalRefreshToken
 * @property {(v: string) => void} setTidalUserId
 * @property {(v: string) => void} setTidalCountryCode
 * @property {() => string} tidalDisplayName
 * @property {(v: string) => void} setTidalDisplayName
 * @property {() => string} tidalUserId
 * @property {() => string} tidalCountryCode
 * @property {(v: string) => void} setTidalAccessToken  the session's
 * @property {(v: number) => void} setTidalAccessTokenExpiry  the session's
 * @property {{ clear: () => void }} tidalFavIds  the favourite album ids cache
 * @property {(reason: string) => Promise<any>} refreshStreamAlbumKeys
 * @property {(which: string) => void} clearStreamAlbumKeys
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 */

/**
 * The TIDAL routes, made once by lib/services/index.js.
 * @param {TidalRouteDeps} d
 */
function createTidalRoutes(d) {
  const { DEBUG, tidal, tidalFavIds, refreshStreamAlbumKeys, clearStreamAlbumKeys, savePersistedSettings } = d;

  // Device-flow login in progress, or null. `timer` drives the server-side poll
  // loop; `error` holds the terminal failure for GET /api/settings/tidal/status.
  /** @type {{ deviceCode: string, interval: number, expiresAt: number, netFails: number, timer: any, error: string | null } | null} */
  let tidalPendingAuth = null; // { deviceCode, interval, expiresAt, netFails, timer, error }
  let tidalAuthGen = 0; // /start generation counter — a newer login attempt supersedes an older one racing it

  /**
   * GET /api/settings/tidal, POST /api/settings/tidal/start, GET /api/settings/tidal/status and
   * POST /api/settings/tidal/disconnect, in that order.
   * @param {{ get: Function, post: Function }} app
   */
  function mountTidalSettings(app) {
    // Connection status (never returns tokens).
    app.get("/api/settings/tidal", (/** @type {any} */ req, /** @type {any} */ res) => {
      res.json({ connected: !!d.tidalRefreshToken(), displayName: d.tidalDisplayName() || "" });
    });

    // Start the OAuth device flow: respond immediately with the code/URL the user
    // must approve on tidal.com, then poll the token endpoint server-side until
    // approval, a terminal error, or code expiry. GET /api/settings/tidal/status
    // reports the outcome. Starting a new flow supersedes a previous pending one.
    app.post("/api/settings/tidal/start", async (/** @type {any} */ req, /** @type {any} */ res) => {
      try {
        if (tidalPendingAuth && tidalPendingAuth.timer) clearTimeout(tidalPendingAuth.timer);
        tidalPendingAuth = null;
        // Guard the gap across the await: a second /start racing this one must
        // win outright — without this, the server could poll flow A's deviceCode
        // while the UI displays flow B's user code (approval would never land).
        const gen = ++tidalAuthGen;
        const flow = await tidal.startDeviceAuth();
        if (gen !== tidalAuthGen) {
          return res.status(409).json({ ok: false, error: "superseded by a newer Tidal login attempt" });
        }
        const pending = {
          deviceCode: flow.deviceCode,
          interval:   Math.max(flow.interval, 2) * 1000,
          expiresAt:  Date.now() + flow.expiresIn * 1000,
          netFails:   0,    // consecutive network failures — a blip must not kill the login
          timer:      null,
          error:      null
        };
        tidalPendingAuth = pending;
        const poll = async () => {
          if (tidalPendingAuth !== pending) return; // superseded or cancelled
          pending.timer = null;
          try {
            if (Date.now() >= pending.expiresAt) {
              pending.error = "Login timed out — the Tidal code expired before it was approved";
              console.error("[tidal] device login expired before approval");
              return;
            }
            const r = await tidal.pollDeviceToken(pending.deviceCode);
            if (tidalPendingAuth !== pending) return; // superseded while awaiting
            if (r.pending) {
              pending.netFails = 0;
              // RFC 8628 slow_down: stretch the polling interval by 5s and keep going.
              if (r.slowDown) pending.interval += 5000;
              pending.timer = setTimeout(poll, pending.interval);
              return;
            }
            // Approved — persist the connection and prime the access token.
            d.setTidalRefreshToken(r.refreshToken);
            d.setTidalUserId(r.userId);
            d.setTidalCountryCode(r.countryCode);
            d.setTidalDisplayName(r.displayName);
            d.setTidalAccessToken(r.accessToken);
            d.setTidalAccessTokenExpiry(Date.now() + Math.max(r.expiresIn - 300, 60) * 1000);
            savePersistedSettings({ tidalRefreshToken: d.tidalRefreshToken(), tidalUserId: d.tidalUserId(),
                                    tidalCountryCode: d.tidalCountryCode(), tidalDisplayName: d.tidalDisplayName() });
            tidalFavIds.clear();       // account may have changed — drop cached favourite ids
            tidalPendingAuth = null;
            // Newly connected account — read its favourites now so Tidal badges
            // appear without waiting for the next library sync.
            refreshStreamAlbumKeys("tidal connected").catch(e => {
              if (DEBUG) console.error("[stream] refresh:", e.message);
            });
            console.log("[settings] tidal connected as " + d.tidalDisplayName());
          } catch (e) {
            if (tidalPendingAuth !== pending) return;
            // A structured OAuth error (access_denied, expired_token, …) is a
            // definitive outcome; a network blip mid-approval is not — retry up
            // to 3 consecutive times before declaring the login dead.
            if (!e.oauthError && pending.netFails < 3) {
              pending.netFails++;
              console.error("[tidal] device login poll failed (retry " + pending.netFails + "/3):", e.message);
              pending.timer = setTimeout(poll, pending.interval);
              return;
            }
            pending.error = e.message; // terminal (denied/expired code) — surfaced via /status
            console.error("[tidal] device login failed:", e.message);
          }
        };
        pending.timer = setTimeout(poll, pending.interval);
        res.json({
          user_code:                 flow.userCode,
          verification_uri:          flow.verificationUri,
          verification_uri_complete: flow.verificationUriComplete,
          expires_in:                flow.expiresIn
        });
      } catch (e) {
        res.status(502).json({ ok: false, error: e.message });
      }
    });

    // Device-flow progress for the settings UI to poll.
    app.get("/api/settings/tidal/status", (/** @type {any} */ req, /** @type {any} */ res) => {
      if (d.tidalRefreshToken()) return res.json({ state: "connected", displayName: d.tidalDisplayName() || "" });
      if (tidalPendingAuth) {
        if (tidalPendingAuth.error) return res.json({ state: "error", error: tidalPendingAuth.error });
        return res.json({ state: "pending" });
      }
      res.json({ state: "idle" });
    });

    // Disconnect: clear all stored Tidal tokens/identity and any pending login.
    app.post("/api/settings/tidal/disconnect", (/** @type {any} */ req, /** @type {any} */ res) => {
      if (tidalPendingAuth && tidalPendingAuth.timer) clearTimeout(tidalPendingAuth.timer);
      tidalPendingAuth = null;
      d.setTidalDisplayName("");
      d.setTidalUserId("");
      d.setTidalRefreshToken("");
      d.setTidalCountryCode("US");
      d.setTidalAccessToken("");
      d.setTidalAccessTokenExpiry(0);
      tidalFavIds.clear();
      clearStreamAlbumKeys("tidal");   // badges go with the account
      savePersistedSettings({ tidalRefreshToken: "", tidalUserId: "", tidalCountryCode: "US", tidalDisplayName: "" });
      res.json({ ok: true });
    });
  }

  return { mountTidalSettings };
}

module.exports = { createTidalRoutes };
