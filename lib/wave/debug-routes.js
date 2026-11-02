// @ts-check
"use strict";
/*
 * debug-routes.js — why a waveform is not drawn (GET /api/debug/waveform: every step of the chain in one request)
 * and which Qobuz credentials sign (GET and POST /api/debug/qobuz-probe). Moved out of index.js unchanged in
 * v1.9.72-t61 (dev/quality.md, step 4).
 */
const fs = require("fs");
const path = require("path");
const WF = require("../waveform");
const WFV = require("../waveform-verdict");
// What the index holds NEAR a key that missed. The difference between "this
// album is not in your favourites" and "it is, spelled differently".
const KM = require("../keymatch");

/**
 * @param {{ get: Function, post: Function }} app
 * @param {import("./index").RouteDeps} d
 */
function mountWaveformDebug(app, d) {
  const { WFD, MUSIC_DIR, qobuz, musicDirMounted, albumKeys, qobuzReady, tidalReady, wfAlbumKey, wfAlbumFiles,
    wfResolveFile, wfQobuzAlbumId, wfQobuzSearchAlbumId, wfQobuzResolveAudio, wfTidalAlbumId } = d;
  const { wfGet, wfAnalysisStamp } = d.store;

  /*
   * GET /api/debug/waveform[?track=&album=&artist=][&zone=<id>]
   *
   * Why a waveform is not being drawn — every step of the chain, in one request.
   *
   * WHY THIS EXISTS: the whole pipeline answers with the same four words. A
   * missing ffmpeg, an unmounted /music, an album the walk never recorded a
   * directory for, a track title that does not match any tag in that folder and
   * a genuinely corrupt file are all `{peaks: null, reason: "undecodable"}` or
   * `"no-local-file"`, and nothing is logged for any of them. "It is switched on
   * and there are no waveforms" is therefore un-actionable from outside, and the
   * only way to tell the five apart was to ship a build with a log line in it and
   * wait. Five versions went that way on the Qobuz signature before a probe
   * endpoint ended it in one; this is that lesson applied before the fact rather
   * than after.
   *
   * Read-only and cheap: it reads the same caches the real route reads, does not
   * decode, and does not touch the Core beyond the zone it is already told about.
   * With no track given it uses whatever the zone is playing, which is the case
   * anybody actually wants to ask about.
   */
  app.get("/api/debug/waveform", async (req, res) => {
    const out = { enabled: d.waveformEnabled(), analysis: wfAnalysisStamp() };

    // 1. ffmpeg. First because it is the one failure that affects every track at
    //    once, and the one that no amount of staring at a library can explain.
    try {
      out.ffmpeg = await WFD.ffmpegProbe();
    } catch (e) {
      out.ffmpeg = { ok: false, error: e.message };
    }

    // 2. The /music mount and what the last walk recorded from it. dirs is the
    //    one the waveform needs: an index written before v1.7.90 carries keys
    //    but no directories, and then nothing local can ever resolve.
    out.music = {
      dir: MUSIC_DIR,
      mounted: musicDirMounted(),
      local_album_keys: d.localAlbumKeys().size,
      local_album_dirs: d.localAlbumDirs().size,
    };

    // 3. The track. Either the one asked about, or whatever the zone is playing.
    let track  = String(req.query.track  || "").trim();
    let album  = String(req.query.album  || "").trim();
    let artist = String(req.query.artist || "").trim();
    // The LENGTH, taken here with the rest of it. The duration gate is what tells
    // this recording from another edition of the same album, so a probe run with
    // no length has the one check that matters switched off — and the zone is
    // holding the number. (?length= still wins, for asking about an album that is
    // not playing.)
    let seconds = Number(req.query.length) || 0;
    if (!track) {
      const zone = req.query.zone ? d.zones()[String(req.query.zone)]
                                  : Object.values(d.zones()).find(z => z && z.state === "playing");
      const np = zone && zone.now_playing;
      const tl = (np && np.three_line) || {};
      if (np) {
        track  = tl.line1 || np.line1 || "";
        artist = tl.line2 || np.line2 || "";
        album  = tl.line3 || np.line3 || "";
        if (!seconds && Number.isFinite(np.length)) seconds = np.length;
        out.from_zone = zone.display_name || zone.zone_id;
      }
    }
    out.track = { track, album, artist, seconds: seconds || null };
    if (!track) {
      out.verdict = "nothing playing and no track given — pass ?track=&album=&artist=";
      return res.json(out);
    }

    /*
     * 3b. THE STREAMING CHAIN, reported for every track and not only when the
     * local one fails.
     *
     * This endpoint used to stop at step 4 with "it is a streamed track" and say
     * nothing else, which left the Qobuz and TIDAL path with exactly the problem
     * the local one was given this endpoint to cure: several ways to fail and one
     * silence between them. It is the same five-versions lesson one path along.
     *
     * Reported in the order wfQobuzTrack and wfTidalTrack actually check, so the
     * first `false` in each row is the thing to fix. Read-only: no audio is
     * fetched, nothing is decoded, no service is called — every value below is
     * already in memory.
     */
    const qId = wfQobuzAlbumId(album, artist);
    const tId = wfTidalAlbumId(album, artist);
    // What the lookup actually asked for, and — when it missed — what the index
    // holds that is CLOSE. Without this a miss is reported as "not in your
    // favourites", which is a guess: an exact-key lookup fails identically
    // whether the record is absent or spelled differently, and those need
    // opposite things from the user. See lib/keymatch.js.
    const wantKeys = albumKeys(album || "", artist || "");
    out.streaming = {
      qobuz: {
        // Either credential is enough: the browser token signs, and a pasted
        // secret is the older route that still works.
        signed_in_for_waveforms: !!d.qobuzWaveToken(),
        signed_in_as: d.qobuzWaveName() || d.qobuzWaveUser() || null,
        has_pasted_secret: !!String(d.qobuzAppSecret() || "").trim(),
        account_connected: qobuzReady(),
        // ALBUMS read vs albums Qobuz states. `identity_keys` is the old
        // `favourite_albums_known` under its real name: it counts KEYS, one album
        // is filed under several, and reporting it as an album count is what hid
        // a ten-thousand-album ceiling behind the number 11455.
        favourite_albums_read: d.qobuzFavouritesRead(),
        favourite_albums_total: d.qobuzFavouritesTotal() || null,
        favourites_complete: !d.qobuzFavouritesTotal() || d.qobuzFavouritesRead() >= d.qobuzFavouritesTotal(),
        identity_keys: d.qobuzAlbumIds().size,
        favourite_albums_known: d.qobuzAlbumIds().size,   // kept: older probes quote it
        album_id: qId || null,
        stored: qId ? !!wfGet(WF.trackKey("qobuz:" + qId, track)) : false,
        keys_tried: qId ? undefined : wantKeys,
        near: qId ? undefined : KM.nearKeys(wantKeys, d.qobuzAlbumIds().keys()),
      },
      tidal: {
        account_connected: tidalReady(),
        favourite_albums_read: d.tidalFavouritesRead(),
        favourite_albums_total: d.tidalFavouritesTotal() || null,
        favourites_complete: !d.tidalFavouritesTotal() || d.tidalFavouritesRead() >= d.tidalFavouritesTotal(),
        identity_keys: d.tidalAlbumIds().size,
        favourite_albums_known: d.tidalAlbumIds().size,
        album_id: tId || null,
        stored: tId ? !!wfGet(WF.trackKey("tidal:" + tId, track)) : false,
        keys_tried: tId ? undefined : wantKeys,
        near: tId ? undefined : KM.nearKeys(wantKeys, d.tidalAlbumIds().keys()),
      },
    };

    // The first thing standing in the way, named. The order matters and is the
    // code's own — see lib/waveform-verdict.js.
    out.streaming.verdict = WFV.streamingVerdict(out.streaming.qobuz, out.streaming.tidal);

    /*
     * 3c. WALK IT (?deep=1). Opt-in, because unlike everything above it CALLS
     * Qobuz — the album read and the signed file-url request, exactly the two the
     * real path makes, through wfQobuzResolveAudio itself rather than a copy. It
     * stops before the audio: no bytes are pulled and nothing is decoded or
     * stored, so it is safe to run repeatedly.
     *
     * WHY IT EXISTS: v1.8.51 fixed the reason NO album had a waveform, and left
     * the harder report — SOME albums do not. Everything static is already above
     * and it is not enough, because the remaining stops (the track list, the
     * duration gate, whether this account may stream this record) can only be
     * seen by asking Qobuz about THAT album. Without this the only instrument is
     * "play it and read the log", which cannot be pointed at an album on request.
     *
     * The url itself is deliberately NOT reported: it is a time-limited signed
     * link to audio, and a diagnostic endpoint is not the place to hand one out.
     * Whether one came back is the whole finding.
     */
    if (String(req.query.deep || "") === "1") {
      // The favourites id if there is one, otherwise the CATALOGUE — which is
      // what the playback path now does, so the probe has to do it too or it
      // reports a dead end the real code walks straight past. (The static section
      // above stays call-free and reports the favourites answer alone; this is
      // the opt-in that is allowed to spend a request.)
      let useId = qId;
      if (!useId) {
        useId = await wfQobuzSearchAlbumId(album, artist);
        out.streaming.qobuz.album_id_from_search = useId || null;
      }
      if (!useId) {
        out.streaming.deep = { ran: false,
          why: "this album is not in your Qobuz favourites AND the catalogue search " +
               "did not identify it either, so there is no id to ask Qobuz about. " +
               "Check the log for '[waveform] qobuz: ... catalogue search' — it says " +
               "whether the search missed or declined for ambiguity" };
      } else {
        const secs = seconds || 0;
        const got = await wfQobuzResolveAudio(useId, track, secs);
        out.streaming.deep = {
          ran: true,
          stop: got.stop,
          detail: got.detail,
          // What each credential set said. Empty on a clean first-try success.
          tried: got.tried,
          album_title_on_qobuz: got.album_title || null,
          album_tracks_on_qobuz: got.album_tracks || 0,
          album_id_used: useId,
          album_id_came_from: qId ? "favourites" : "catalogue search",
          roon_says_seconds: secs || null,
          qobuz_says_seconds: got.track_duration != null ? got.track_duration : null,
          got_audio_url: !!got.url,
          credentials_used: got.credentials || null,
        };
        if (!secs) {
          out.streaming.deep.note =
            "no track length was supplied, and the duration gate is what separates " +
            "this recording from another edition of it — pass &length=<seconds> " +
            "(or run this while the track is playing)";
        }
        out.streaming.verdict = WFV.deepVerdict(out.streaming.deep);
      }
    }

    // 4. Does the walk know a directory for this album?
    const akey = wfAlbumKey(album, artist);
    out.album_key = akey || null;
    if (!akey) {
      // NOT "so it is a streamed track". That was an inference stated as a fact:
      // the local index missing an album means the local index missed it, which
      // happens both because the album really is streamed AND because the walk
      // filed it under a different spelling. The second is a LOCAL waveform bug
      // and the old sentence sent anybody who hit it off to read about Qobuz.
      out.local_near = KM.nearKeys(wantKeys, d.localAlbumDirs().keys());
      out.verdict = !d.localAlbumDirs().size
        ? "the /music walk has recorded no directories at all (see music.local_album_dirs)"
        : out.local_near.length
          ? "no local directory matched, but the /music index holds " +
            out.local_near.length + " near miss" + (out.local_near.length === 1 ? "" : "es") +
            ' — closest is "' + out.local_near[0].key + '" (' + out.local_near[0].why +
            "). This may be a LOCAL album the walk filed under a different spelling, " +
            "not a streamed one: compare it with streaming.qobuz.keys_tried"
          : "no local directory for this album and nothing in the /music index " +
            "resembles it, so it is a streamed track — read streaming.verdict above";
      return res.json(out);
    }
    out.album_dir = d.localAlbumDirs().get(akey) || null;

    // 5. Which files are in it, and does the playing title match one of them?
    //    The titles come from the tags, and Roon's title is what is matched
    //    against them — so a mismatch here is the answer, and it is visible.
    let files = [];
    try { files = await wfAlbumFiles(akey); } catch (e) { out.files_error = e.message; }
    out.files = files.map(f => ({ file: path.basename(f.file), title: f.title }));
    const file = await wfResolveFile(akey, track);
    out.matched_file = file ? path.basename(file) : null;
    if (!file) {
      out.verdict = files.length
        ? "no file in that folder has a title matching \"" + track + "\" — compare it with files[] above"
        : "that folder holds no audio files this build recognises";
      return res.json(out);
    }
    try {
      out.matched_file_bytes = fs.statSync(file).size;
    } catch (e) {
      out.verdict = "the matched file cannot be read: " + e.message;
      return res.json(out);
    }

    // 6. Is it already stored? A stored row is served without decoding, so a
    //    track that is stored AND not drawing is a client-side problem.
    const tkey = WF.trackKey(akey, track);
    const cached = wfGet(tkey);
    out.stored = !!cached;
    out.stored_buckets = cached ? cached.n : 0;

    out.verdict = !out.ffmpeg.ok
      ? "everything resolves, but ffmpeg does not run — no track can ever be decoded (see ffmpeg)"
      : (cached ? "stored and ready: if no waveform is drawn, the problem is in the client"
                : "resolves to a readable file and ffmpeg runs — play this track and it should decode");
    res.json(out);
  });

  /*
   * POST /api/debug/qobuz-probe   {app_id, secret, token?, album?, artist?}
   *
   * POST, not GET, for one reason: the [http] logger records req.originalUrl, and
   * those lines go to the rotating log files on the data volume. A secret in a
   * query string would be written to disk in plaintext and kept for ~88 MB of
   * history. A JSON body is not logged.
   *
   * WHICH COMBINATION DOES QOBUZ ACTUALLY ACCEPT?
   *
   * Five versions have now been spent testing one hypothesis per Docker rebuild,
   * because the only way to try a credential combination was to ship it. That is
   * the wrong loop: the question is empirical, it has a small answer space, and
   * nothing about it needs a release. This tries every token this box can produce
   * against a caller-supplied signing pair and reports what Qobuz said to each.
   *
   * A signature is only valid against the app_id its secret belongs to, AND the
   * token must have been minted by that same app — so the working combination is
   * a PAIR OF PAIRS, and knowing which one it is takes evidence, not reasoning.
   *
   * Nothing here is persisted and no secret or token is ever echoed back: the
   * answer is a grid of labels, HTTP statuses and reasons. Supply the candidate
   * pair yourself — this app ships no secret and this endpoint does not store one.
   */
  // GET answers with how to call it, so a mistyped probe explains itself rather
  // than 404ing — and so nobody puts a secret in a URL to find that out.
  app.get("/api/debug/qobuz-probe", (req, res) => res.status(405).json({
    error: "POST this, do not GET it",
    how: "curl -s -X POST http://<host>:<port>/api/debug/qobuz-probe " +
         "-H 'Content-Type: application/json' " +
         "-d '{\"app_id\":\"...\",\"secret\":\"...\",\"token\":\"optional\"}'",
    why: "a secret in a query string is written to the log files on the data volume",
  }));

  app.post("/api/debug/qobuz-probe", async (req, res) => {
    const body   = req.body || {};
    const secret = String(body.secret || "").trim();
    const given  = String(body.token  || "").trim();
    // app_id is OPTIONAL, and omitting it is the most useful case: it means "this
    // app's own id", which is the LMS plugin's — the same id whose username and
    // md5-password login this app already uses successfully. A secret issued for
    // THAT app therefore completes a set that is already consistent, with no new
    // sign-in flow at all. Requiring an app_id here hid that whole arrangement
    // behind a field nobody would think to leave blank.
    const appId = String(body.app_id || "").trim() || qobuz.APP_ID;
    if (!secret) {
      return res.status(400).json({
        error: "secret is required",
        how: "POST {\"secret\":\"<secret>\"} — app_id defaults to this app's own (" +
             qobuz.APP_ID + "), which is the LMS plugin's, so a secret issued for " +
             "that app needs nothing else. Add \"app_id\" and \"token\" only to " +
             "test a different app's pair.",
        note: "Nothing is saved. The reply carries no secrets, only what Qobuz answered.",
      });
    }

    // Which album to ask about. The playing one if named, else any harvested id —
    // the probe only needs a track id that exists, not a particular record.
    let albumId = null, albumFrom = "";
    const album = String(body.album || "").trim();
    const artist = String(body.artist || "").trim();
    if (album) { albumId = wfQobuzAlbumId(album, artist); albumFrom = "the album named"; }
    if (!albumId && d.qobuzAlbumIds().size) {
      albumId = d.qobuzAlbumIds().values().next().value;
      albumFrom = "the first harvested favourite";
    }
    if (!albumId) {
      return res.status(409).json({ error: "no Qobuz album id available to test with",
                                    hint: "connect Qobuz so favourites are read, or pass album=&artist=" });
    }

    // Every token this box can lay hands on, labelled by where it came from.
    const tokens = [];
    if (d.qobuzToken())      tokens.push({ label: "this app's login (app_id " + qobuz.APP_ID + ")", token: d.qobuzToken() });
    if (given)           tokens.push({ label: "the token in this request",                      token: given });
    if (d.qobuzSignToken())  tokens.push({ label: "the token saved from a pasted file",             token: d.qobuzSignToken() });
    if (d.qobuzUsername() && d.qobuzPasswordMd5()) {
      try {
        const r = await qobuz.login(d.qobuzUsername(), d.qobuzPasswordMd5(), true, appId);
        tokens.push({ label: "minted now by password under app " + appId, token: r.token });
      } catch (e) {
        tokens.push({ label: "minted now by password under app " + appId, token: null,
                      mint_error: qobuz.describeQobuzError(e, false) });
      }
    }
    if (!tokens.length) {
      return res.status(409).json({ error: "no Qobuz token available to test with",
                                    hint: "connect Qobuz under Settings, or pass token=" });
    }

    const results = [];
    for (const t of tokens) {
      if (!t.token) { results.push({ token: t.label, mint: t.mint_error || "could not be obtained" }); continue; }
      const row = { token: t.label };

      // Unsigned catalogue read, signed with nothing — proves the token is alive.
      const alb = await qobuz.getAlbumResult(t.token, albumId, 12000, appId)
        .catch((e) => ({ album: null, reason: qobuz.describeQobuzError(e, false) }));
      row.album_read = alb.album ? "ok (" + (alb.album.tracks || []).length + " tracks)" : alb.reason;
      if (!alb.album || !alb.album.tracks || !alb.album.tracks.length) { results.push(row); continue; }

      // The signed call — the one that actually gates the feature.
      const trackId = alb.album.tracks[0].id;
      const f = await qobuz.getFileUrlResult(t.token, trackId, secret, { appId })
        .catch((e) => ({ url: null, reason: qobuz.describeFileUrlError(e) }));
      // The URL is a time-limited link to audio: report only WHETHER there is one.
      row.stream = f.url ? "OK — this combination works" : f.reason;
      results.push(row);
    }

    // A Qobuz error body is quoted into the reason, and this request carried a
    // secret and possibly a token. Nothing observed echoes them, but "nothing
    // observed" is not a guarantee for a value the caller just handed us.
    const hide = [secret, given].filter((v) => v && v.length >= 8);
    const scrub = (v) => {
      let out = String(v == null ? "" : v);
      for (const h of hide) out = out.split(h).join("<redacted>");
      return out;
    };
    for (const r of results) for (const k of Object.keys(r)) r[k] = scrub(r[k]);

    const winner = results.find((r) => r.stream === "OK — this combination works");
    res.json({
      signing_app_id: appId,          // not a credential — it travels in every URL
      album_id_tested: albumId,
      album_chosen: albumFrom,
      answer: winner
        ? "WORKS with: " + winner.token + ". Paste that app_id, that secret and that " +
          "token together into Settings → Qobuz waveforms."
        : "No combination worked. Every token available here was refused by this pair.",
      results,
    });
  });
}

module.exports = { mountWaveformDebug };
