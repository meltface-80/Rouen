// @ts-check
"use strict";
/*
 * qobuz-routes.js — the Qobuz connection in Settings, moved out of index.js unchanged in v1.9.72-t63
 * (dev/quality.md, step 5):
 *
 *   GET  /api/settings/qobuz             → { connected, signed_in, username, displayName }   never a credential
 *   POST /api/settings/qobuz             { username, password } → { ok, displayName }; 400 without both, 502 when
 *                                        Qobuz refuses
 *   POST /api/settings/qobuz/disconnect  → { ok }: every stored Qobuz credential and the sign-in cleared
 *
 * The browser sign-in's own routes are lib/routes/qobuz-oauth.js. index.js mounts these where it registered them.
 */

/**
 * What the Qobuz settings routes use: index.js's own, by the same names (a getter for each value index.js may
 * replace, and a setter for each the routes replace), and the session's qobuzSyncAppId.
 * @typedef {object} QobuzRouteDeps
 * @property {boolean} DEBUG
 * @property {any} qobuz  lib/qobuz.js, the Qobuz client
 * @property {() => boolean} qobuzReady  index.js's one spelling of "is Qobuz connected"
 * @property {() => string} qobuzUsername
 * @property {(v: string) => void} setQobuzUsername
 * @property {(v: string) => void} setQobuzPasswordMd5
 * @property {() => string} qobuzPasswordMd5
 * @property {() => string} qobuzToken
 * @property {(v: string) => void} setQobuzToken
 * @property {() => string} qobuzDisplayName
 * @property {(v: string) => void} setQobuzDisplayName
 * @property {() => string} qobuzWaveToken  the browser sign-in's token
 * @property {(v: string) => void} setQobuzWaveToken
 * @property {(v: string) => void} setQobuzWaveUser
 * @property {() => string} qobuzWaveName
 * @property {(v: string) => void} setQobuzWaveName
 * @property {() => void} qobuzSyncAppId
 * @property {{ clear: () => void }} qobuzFavIds  the favourite album ids cache
 * @property {(reason: string) => Promise<any>} refreshStreamAlbumKeys
 * @property {(which: string) => void} clearStreamAlbumKeys
 * @property {Set<string>} wfQobuzSaid  the streaming waveform's said-once log, forgotten with the account
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 */

/**
 * GET and POST /api/settings/qobuz, and POST /api/settings/qobuz/disconnect, in that order.
 * @param {{ get: Function, post: Function }} app
 * @param {QobuzRouteDeps} d
 */
function mountQobuzSettings(app, d) {
  const { DEBUG, qobuz, qobuzReady, qobuzSyncAppId, qobuzFavIds, refreshStreamAlbumKeys, clearStreamAlbumKeys,
    wfQobuzSaid: _wfQobuzSaid, savePersistedSettings } = d;

  // Connection status (never returns credentials).
  app.get("/api/settings/qobuz", (/** @type {any} */ req, /** @type {any} */ res) => {
    // The browser sign-in is a full Qobuz session on its own, so it counts as
    // connected here — this is the one status the Services panel reads.
    res.json({ connected: qobuzReady(),
               signed_in: !!d.qobuzWaveToken(),
               username: d.qobuzUsername() || "",
               displayName: d.qobuzWaveName() || d.qobuzDisplayName() || "" });
  });
  // Connect: log in with email/password, persist token (+ md5 for re-login).
  app.post("/api/settings/qobuz", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const username = ((req.body && req.body.username) || "").trim();
    const password = ((req.body && req.body.password) || "");
    if (!username || !password) return res.status(400).json({ ok: false, error: "username and password required" });
    try {
      const r = await qobuz.login(username, password);
      d.setQobuzUsername(username);
      d.setQobuzPasswordMd5(r.passwordMd5);
      d.setQobuzToken(r.token);
      d.setQobuzDisplayName(r.displayName);
      savePersistedSettings({ qobuzUsername: d.qobuzUsername(), qobuzPasswordMd5: d.qobuzPasswordMd5(),
                              qobuzToken: d.qobuzToken(), qobuzDisplayName: d.qobuzDisplayName() });
      qobuzFavIds.clear(); // account may have changed — drop cached favourite ids
      // Newly connected account — read its favourites now so Qobuz badges appear
      // without waiting for the next library sync.
      refreshStreamAlbumKeys("qobuz connected").catch(e => {
        if (DEBUG) console.error("[stream] refresh:", e.message);
      });
      console.log("[settings] qobuz connected as " + d.qobuzDisplayName());
      res.json({ ok: true, displayName: d.qobuzDisplayName() });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });
  // Disconnect: clear all stored Qobuz credentials/token.
  app.post("/api/settings/qobuz/disconnect", (/** @type {any} */ req, /** @type {any} */ res) => {
    d.setQobuzDisplayName("");
    d.setQobuzToken("");
    d.setQobuzPasswordMd5("");
    d.setQobuzUsername("");
    // One account, one disconnect: the sign-in IS the Qobuz session now, so
    // leaving its token behind would keep the app half-connected — waveforms
    // still fetching audio for an account the user just removed.
    d.setQobuzWaveName("");
    d.setQobuzWaveUser("");
    d.setQobuzWaveToken("");
    qobuzSyncAppId();
    qobuzFavIds.clear();
    clearStreamAlbumKeys("qobuz");   // badges go with the account
    _wfQobuzSaid.clear();
    savePersistedSettings({ qobuzUsername: "", qobuzPasswordMd5: "", qobuzToken: "", qobuzDisplayName: "",
                            qobuzWaveToken: "", qobuzWaveUser: "", qobuzWaveName: "" });
    res.json({ ok: true });
  });
}

module.exports = { mountQobuzSettings };
