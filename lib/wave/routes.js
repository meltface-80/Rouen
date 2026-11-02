// @ts-check
"use strict";
/*
 * routes.js — GET /api/waveform (a track's peaks: a local file's, else Qobuz's, else TIDAL's) and the waveform
 * settings (GET and POST /api/settings/waveform: the switch, and the older pasted Qobuz secret). Moved out of
 * index.js unchanged in v1.9.72-t61 (dev/quality.md, step 4); index.js mounts the two where it registered them.
 */
const WF = require("../waveform");
// Qobuz request signing, and reading an app_id/secret pair out of whatever the
// user pasted into Settings. Pure — see lib/qobuz-sig.js.
const SIG = require("../qobuz-sig");

/**
 * GET /api/waveform.
 * @param {{ get: Function }} app
 * @param {import("./index").RouteDeps} d
 */
function mountWaveform(app, d) {
  const { wfAlbumKey, wfQobuzTrack, wfTidalTrack, wfCompute } = d;
  const { wfGet, inflight: _wfInflight } = d.store;

  app.get("/api/waveform", async (req, res) => {
    if (!d.waveformEnabled()) return res.json({ peaks: null, reason: "off" });
    const track  = String(req.query.track  || "").trim();
    const album  = String(req.query.album  || "").trim();
    const artist = String(req.query.artist || "").trim();
    if (!track) return res.status(400).json({ error: "track required" });

    const akey = wfAlbumKey(album, artist);
    if (!akey) {
      // No local file. Roon streams Qobuz and TIDAL to the endpoint and no
      // extension can see that audio — but if this is a Qobuz favourite and the
      // user configured a secret, it can be fetched from Qobuz directly.
      // Qobuz first, then TIDAL. Roon does not say which service is playing, so
      // the album's presence in one favourites list is the only signal there is —
      // and an album in neither declines from both, cheaply, without a call.
      const secs = Number(req.query.length) || 0;
      let out = await wfQobuzTrack(album, artist, track, secs);
      if (!out) out = await wfTidalTrack(album, artist, track, secs);
      if (out) {
        res.set("Cache-Control", "public, max-age=604800, immutable");
        return res.json(out);
      }
      return res.json({ peaks: null, reason: "no-local-file" });
    }

    const tkey = WF.trackKey(akey, track);
    const cached = wfGet(tkey);
    if (cached) {
      // Immutable: a waveform is a property of the audio, and the audio for a
      // given track does not change. A week matches the artwork policy.
      res.set("Cache-Control", "public, max-age=604800, immutable");
      return res.json({ peaks: cached.peaks, n: cached.n, cached: true });
    }

    // Busy only means "another TRACK is decoding". A request for the one already
    // in flight joins it below rather than being turned away.
    if (d.wfBusy() && d.wfBusy() !== tkey && !_wfInflight.has(tkey)) {
      return res.json({ peaks: null, reason: "busy" });
    }
    d.setWfBusy(tkey);
    try {
      const out = await wfCompute(akey, track, null, Number(req.query.length) || 0);
      if (!out) return res.json({ peaks: null, reason: "undecodable" });
      res.set("Cache-Control", "public, max-age=604800, immutable");
      res.json({ peaks: out.peaks, n: out.n, cached: false });
    } catch (e) {
      // Not logged, as it was not before the move (v1.9.72-t61 moved this unchanged): the page is told "error" and
      // keeps the plain bar. A log line here would be a change of behaviour, for a build of its own.
      res.json({ peaks: null, reason: "error" });
    } finally {
      d.setWfBusy(null);
    }
  });
}

/**
 * GET and POST /api/settings/waveform.
 * @param {{ get: Function, post: Function }} app
 * @param {import("./index").RouteDeps} d
 */
function mountWaveformSettings(app, d) {
  const { WFD, qobuzReady, savePersistedSettings, wfQobuzSaid } = d;

  app.get("/api/settings/waveform", (req, res) => {
    res.json({
      enabled: d.waveformEnabled(),
      decoder: !!WFD.ffmpegPath(),
      // Whether a secret is SET, never the secret itself — this endpoint is
      // polled by every open client and a credential has no business in it.
      qobuz_secret_set: !!String(d.qobuzAppSecret() || "").trim(),
      // The ID is not a credential and naming it is how a mismatched pair becomes
      // visible: a secret from the web player signed with the Lyrion plugin's id
      // fails exactly like a wrong secret.
      qobuz_sign_app_id: d.qobuzSignAppId() || null,
      // Whether a token came WITH the pair. Not the token — that is a credential,
      // and this endpoint is polled by every open client.
      qobuz_sign_token_set: !!d.qobuzSignToken(),
      // Whether the Qobuz sign-in has been done. Not the token — this endpoint is
      // polled by every open client and a credential has no business in it. The
      // user id is not one: it identifies an account to its owner, who is the only
      // person who can see this page.
      qobuz_connected: !!d.qobuzWaveToken(),
      qobuz_user: d.qobuzWaveToken() ? (d.qobuzWaveName() || d.qobuzWaveUser() || "") : "",
      qobuz_ready: !!(d.qobuzWaveToken() ||
                      (String(d.qobuzAppSecret() || "").trim() && qobuzReady())),
    });
  });
  app.post("/api/settings/waveform", (req, res) => {
    const body = req.body || {};
    // The secret can be set on its own, without touching the switch.
    if (body.qobuz_secret !== undefined) {
      // Accepts a bare secret OR the JSON a Qobuz client stores, so the app_id
      // and the secret cannot be separated on their way in here.
      const pair = SIG.parseSecretInput(body.qobuz_secret);
      d.setQobuzAppSecret(pair.secret);
      d.setQobuzSignAppId(pair.appId);
      // KEEP A WORKING TOKEN WHEN ONLY THE PAIR IS BEING CORRECTED. Updating the
      // app_id and secret while leaving the token out is the ordinary way to fix
      // a mismatch — the token was never the wrong part — and wiping it would
      // destroy the one credential that works, for a paste that never mentioned
      // it. Only a paste that CARRIES an app_id may inherit, so a bare secret
      // (which means "sign as this app itself") still starts clean, and clearing
      // the field clears everything, which is the way to remove one deliberately.
      d.setQobuzSignToken(pair.token || (pair.appId ? d.qobuzSignToken() : ""));
      // A token minted BY THIS APP, though, belongs to the app_id it was minted
      // under. Keeping that across a change would sign as one app with another's
      // token — the very failure this path exists to avoid. It costs one login to
      // rebuild, unlike a pasted one, which cannot be rebuilt here at all.
      d.setQobuzSignTok(null);
      d.setQobuzSignTokAt(0);
      savePersistedSettings({ qobuzAppSecret: d.qobuzAppSecret(), qobuzSignAppId: d.qobuzSignAppId(),
                              qobuzSignToken: d.qobuzSignToken() });
      // The reasons logged so far were about the old state. Forget them, so the
      // next play says what is true now rather than staying quiet about it.
      wfQobuzSaid.clear();
      if (body.enabled === undefined) {
        return res.json({ ok: true, enabled: d.waveformEnabled(),
                          qobuz_secret_set: !!d.qobuzAppSecret(),
                          qobuz_sign_app_id: d.qobuzSignAppId() || null,
                          qobuz_sign_token_set: !!d.qobuzSignToken() });
      }
    }
    if (body.enabled === undefined) return res.status(400).json({ error: "enabled required" });
    d.setWaveformEnabled(!!body.enabled);
    savePersistedSettings({ waveformEnabled: d.waveformEnabled() });
    // Switched off mid-decode: stop the prefetch rather than letting it finish
    // for a feature nobody is looking at.
    if (!d.waveformEnabled()) d.stopPrefetch();
    res.json({ ok: true, enabled: d.waveformEnabled(),
               qobuz_secret_set: !!String(d.qobuzAppSecret() || "").trim(),
               qobuz_sign_app_id: d.qobuzSignAppId() || null,
               qobuz_sign_token_set: !!d.qobuzSignToken() });
  });
}

module.exports = { mountWaveform, mountWaveformSettings };
