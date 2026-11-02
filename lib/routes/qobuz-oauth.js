// @ts-check
"use strict";
/*
 * qobuz-oauth.js — the Qobuz sign-in routes, moved out of index.js unchanged in v1.9.72-t54 (dev/quality.md, step 5).
 * lib/qobuz-oauth.js holds the URL building, the code parsing and the exchange; this holds the routes, and index.js
 * keeps the token the sign-in produces (it is read by every Qobuz call, so it lives where they do).
 *
 *   GET  /api/qobuz/oauth/start        → { url, redirect_url }   400 when this server's address cannot be worked out
 *   GET  /api/qobuz/oauth/callback     → an HTML page            400 with no code, or when the exchange fails
 *   POST /api/qobuz/oauth/paste        body: { url } → { ok, connected: true }   400 with no code, or on failure
 *   POST /api/qobuz/oauth/disconnect   → { ok, connected: false }
 */

/*
 * Signing in to Qobuz for waveforms.
 *
 * Three routes, and the whole point of them is that no credential is ever typed
 * into this app: /start hands back a qobuz.com URL, the user signs in THERE, and
 * Qobuz redirects their browser to /callback with a one-time code that trades
 * for a token. The password never comes near this process.
 *
 * The redirect address is taken from the request that asked for it, so whatever
 * the user reached this page on — a LAN IP, a hostname, a reverse proxy — is
 * where Qobuz sends them back. Nothing to configure, and it works unchanged
 * inside Docker, which has no idea what address it is reached on.
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ qoa: { callbackUrlFrom: (req: any, path: string) => string | null, buildAuthorizeUrl: (redirectUrl: string, appId?: string) => string,
 *             extractCode: (urlOrCode: any) => string, exchangeCode: (code: string, opts?: any) => Promise<{ token: string, userId: string }> },
 *           displayName: () => string,
 *           setWave: (token: string, user: string, name: string) => void,
 *           save: (patch: Record<string, any>) => any,
 *           syncAppId: () => void,
 *           refreshStreamAlbumKeys: (reason: string) => any,
 *           saidOnce: Set<string> }} d
 *   qoa: lib/qobuz-oauth.js
 *   displayName: the Qobuz display name index.js holds now (it changes at runtime, so it is read, never copied)
 *   setWave: index.js's qobuzWaveToken, qobuzWaveUser and qobuzWaveName, set together
 *   save: savePersistedSettings
 *   syncAppId: qobuzSyncAppId — lib/qobuz's default app_id in step with the token now in play
 *     (lib/services/qobuz-session.js)
 *   refreshStreamAlbumKeys: the favourites read, started and not waited for
 *   saidOnce: the streaming waveform's said-once log (_wfQobuzSaid), cleared when the sign-in changes
 */
function mountQobuzOAuth(app, d) {
  app.get("/api/qobuz/oauth/start", (/** @type {any} */ req, /** @type {any} */ res) => {
    const cb = d.qoa.callbackUrlFrom(req, "/api/qobuz/oauth/callback");
    if (!cb) return res.status(400).json({ error: "could not work out this server's address" });
    res.json({ url: d.qoa.buildAuthorizeUrl(cb), redirect_url: cb });
  });

  // Where Qobuz sends the browser back. Answers HTML, not JSON: a person is
  // looking at this, having just come from a sign-in page.
  app.get("/api/qobuz/oauth/callback", async (/** @type {any} */ req, /** @type {any} */ res) => {
    /** @param {string} title @param {string} body */
    const page = (title, body) =>
      "<!doctype html><meta charset=utf-8>" +
      "<meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>" + title + "</title>" +
      "<body style=\"font:16px/1.5 system-ui,sans-serif;max-width:34em;margin:12vh auto;padding:0 24px\">" +
      body + "</body>";

    const code = d.qoa.extractCode(req.originalUrl || "");
    if (!code) {
      return res.status(400).send(page("Sign-in incomplete",
        "<h2>Qobuz did not send a sign-in code back.</h2><p>The sign-in may have been " +
        "cancelled. Close this tab and try Connect again.</p>"));
    }
    try {
      const got = await d.qoa.exchangeCode(code);
      const qobuzWaveToken = got.token;
      const qobuzWaveUser  = got.userId;
      const qobuzWaveName  = d.displayName() || "";
      d.setWave(qobuzWaveToken, qobuzWaveUser, qobuzWaveName);
      d.save({ qobuzWaveToken, qobuzWaveUser, qobuzWaveName });
      // The whole Qobuz session moves to this token now, so every call has to
      // present its app_id, and the favourites read under the old one is stale.
      d.syncAppId();
      d.refreshStreamAlbumKeys('qobuz sign-in');
      // The declines logged so far were about the old state; forget them so the
      // next play reports what is true now instead of staying quiet about it.
      d.saidOnce.clear();
      console.log("[waveform] qobuz: signed in for waveforms (user " + got.userId + ")");
      res.send(page("Connected",
        "<h2>Qobuz connected.</h2><p>Waveforms will now be drawn for Qobuz tracks. " +
        "You can close this tab and go back to Rouen.</p>"));
    } catch (e) {
      console.log("[waveform] qobuz: sign-in failed — " + (e && e.message));
      res.status(400).send(page("Sign-in failed",
        "<h2>Could not finish signing in.</h2><p>" +
        String((e && e.message) || "Unknown error").replace(/[<>&]/g, "") +
        "</p><p>Close this tab and try Connect again.</p>"));
    }
  });

  // The fallback for a sign-in done on a device that cannot reach this server —
  // a phone on mobile data, say. The user lands on an address that fails to load
  // and pastes it here instead. Same exchange, different way in.
  app.post("/api/qobuz/oauth/paste", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const code = d.qoa.extractCode((req.body && req.body.url) || "");
    if (!code) return res.status(400).json({ error: "no sign-in code found in that address" });
    try {
      const got = await d.qoa.exchangeCode(code);
      const qobuzWaveToken = got.token;
      const qobuzWaveUser  = got.userId;
      const qobuzWaveName  = d.displayName() || "";
      d.setWave(qobuzWaveToken, qobuzWaveUser, qobuzWaveName);
      d.save({ qobuzWaveToken, qobuzWaveUser, qobuzWaveName });
      // The whole Qobuz session moves to this token now, so every call has to
      // present its app_id, and the favourites read under the old one is stale.
      d.syncAppId();
      d.refreshStreamAlbumKeys('qobuz sign-in');
      d.saidOnce.clear();
      res.json({ ok: true, connected: true });
    } catch (e) {
      res.status(400).json({ error: (e && e.message) || "sign-in failed" });
    }
  });

  app.post("/api/qobuz/oauth/disconnect", (/** @type {any} */ req, /** @type {any} */ res) => {
    d.setWave("", "", "");
    d.save({ qobuzWaveToken: "", qobuzWaveUser: "", qobuzWaveName: "" });
    d.syncAppId();
    d.saidOnce.clear();
    res.json({ ok: true, connected: false });
  });
}

module.exports = { mountQobuzOAuth };
