// @ts-check
"use strict";
/*
 * qobuz.js — a Qobuz track's waveform: which album and which track it is, the signed url of its audio (the
 * credential sets tried in order), and the decode of the download. Self-contained on purpose: everything it
 * reads of index.js's (the settings, the sign-ins, the favourites' album ids, the Qobuz client) is handed in.
 * Moved out of index.js unchanged in v1.9.72-t61 (dev/quality.md, step 4).
 */
const WF = require("../waveform");
const AK = require("../albumkeys");
// Which catalogue search result (if any) is the album that is playing. Pure —
// the decision only; the keying stays in index.js, where the key space lives.
const ABS = require("../albumsearch");
// Picking the right track out of a service's album, by title AND duration. Pure
// — see lib/trackmatch.js, which is where the rule about refusing to guess is.
const TM = require("../trackmatch");

/**
 * @param {import("./index").WaveDeps & { store: import("./index").WaveStore }} d
 */
function createQobuzWaveforms(d) {
  const { WFD, qobuz, QOA, albumKeys, albumKey, canonArtist, favouriteTitleForms, qobuzReady, qobuzWithToken,
    qobuzSigningToken, wfQobuzSayOnce } = d;
  const { wfGet, wfPut, inflight: _wfInflight } = d.store;

  /* ===================== Streaming waveforms (Qobuz) =====================
   *
   * Roon streams Qobuz to the endpoint and never to an extension, so there is no
   * audio here to read. This fetches the track from Qobuz directly, with the
   * user's own account, decodes it to peaks and throws the audio away.
   *
   * OFF BY DEFAULT AND GATED ON A SECRET THE APP DOES NOT SHIP. track/getFileUrl
   * is a signed endpoint; the app_secret is a Settings field the user fills in
   * themselves. With it blank none of this runs. That is deliberate on two
   * counts: the secret rotates whenever Qobuz updates their web player, so baking
   * one in would guarantee a build that quietly stops working; and retrieving
   * audio from an unofficial API is against Qobuz's terms, which should be a
   * decision someone made rather than a default they inherited.
   *
   * NOTHING IS WRITTEN TO DISK. The HTTPS response is piped straight into ffmpeg
   * (see decodeWaveform's `input`), so "no audio is stored" is a fact about how
   * the bytes moved rather than a cleanup promise a crash could break. MP3 320 is
   * requested rather than FLAC: the peaks are resampled to 1000 buckets from an
   * 8 kHz mono decode, where a lossy envelope is indistinguishable — at ~7 MB a
   * track instead of 30-150.
   *
   * Every step can decline, and declining means the plain progress bar:
   *   1. the feature is off, or no secret is set;
   *   2. the album is not confidently ONE Qobuz favourite (locateByTitle);
   *   3. Qobuz will not name a track of that title AND that length (matchTrack);
   *   4. the URL comes back a preview, or not at all;
   *   5. ffmpeg cannot decode what arrives.
   */

  /*
   * The whole streaming path for one track: cache, identify, fetch, store.
   *
   * Keyed "qobuz:<album id> <title>" rather than by the album identity the local
   * path uses. Those keys come from Roon's spelling of an album, which is exactly
   * what is unreliable here — it is why this feature needed a title-only rung at
   * all. The Qobuz album id is stable, and it is what the peaks actually came
   * from.
   */
  /*
   * Say a thing once per reason, not once per request.
   *
   * The clients poll, so a decline that logs every time turns the reason into
   * noise and buries it — which is the same outcome as not logging it. Keyed by
   * reason so a DIFFERENT decline still gets through immediately.
   */
  async function wfQobuzTrack(album, artist, track, seconds) {
    if (!d.waveformEnabled() || !d.labelsDb()) return null;
    // Every decline below says why. v1.8.6 returned from these three in silence,
    // so the one failure that actually happened — no album ids after a restart —
    // produced no waveform, no error and no log line to look at.
    if (!d.qobuzWaveToken() && !String(d.qobuzAppSecret() || "").trim()) {
      // NOT behind DEBUG. This is the likeliest reason of them all — it is the
      // default state — and hiding it behind a flag is what made v1.8.6 look
      // broken rather than switched off. Said ONCE, because the clients poll and
      // a line per request would bury the log it belongs in.
      wfQobuzSayOnce("no-signin",
        "[waveform] qobuz: a Qobuz album is playing and this extension is not " +
        "signed in to Qobuz for waveforms — Settings → Audio Devices → " +
        "Qobuz waveforms → Connect. Local files are unaffected.");
      return null;
    }
    // The favourites first — free, already in memory, and the only source that
    // needs no call. Then the catalogue, which is what makes an album played from
    // a search reachable at all. See wfQobuzSearchAlbumId.
    let albumId = wfQobuzAlbumId(album, artist);
    if (!albumId) albumId = await wfQobuzSearchAlbumId(album, artist);
    if (!albumId) {
      // Keyed by ALBUM: the clients re-ask every poll, and one line per album is
      // the useful amount — enough to see which records are unreachable, not
      // enough to drown the log.
      wfQobuzSayOnce("noid:" + album,
        "[waveform] qobuz: no Qobuz album id for \"" + album + "\" by \"" +
        (artist || "(none)") + "\" — not among the " + d.qobuzAlbumIds().size +
        " favourites and the catalogue search did not identify it either" +
        (d.qobuzAlbumIds().size ? "" : " (favourites not read yet)"));
      return null;
    }

    const tkey = WF.trackKey("qobuz:" + albumId, track);
    if (!tkey) return null;
    const have = wfGet(tkey);
    if (have) return { peaks: have.peaks, n: have.n, cached: true, source: "qobuz" };

    // The same sharing the local decode uses: a phone and the wall display asking
    // together must fetch this once, not twice.
    const already = _wfInflight.get(tkey);
    if (already) {
      const p = await already;
      return p ? { peaks: p.peaks, n: p.n, cached: false, source: "qobuz" } : null;
    }
    const job = (async () => {
      const peaks = await wfQobuzCompute(albumId, track, seconds, null);
      if (!peaks) return null;
      wfPut(tkey, peaks);
      return { peaks: WF.encode(peaks), n: peaks.length };
    })().finally(() => { _wfInflight.delete(tkey); });
    _wfInflight.set(tkey, job);

    const out = await job;
    return out ? { peaks: out.peaks, n: out.n, cached: false, source: "qobuz" } : null;
  }

  /** The Qobuz album id for what Roon is playing, or null. */
  function wfQobuzAlbumId(album, artist) {
    for (const k of albumKeys(album || "", artist || "")) {
      if (d.qobuzAlbumIds().has(k)) return d.qobuzAlbumIds().get(k);
    }
    // The title-only rung, for the albums Roon names without a usable artist —
    // "†††" canonicalises to nothing, so no key can ever match. Only when the
    // title lands on exactly one album in exactly one place.
    if (canonArtist(artist || "")) return null;
    const titles = albumKeys(album || "", "").map(AK.titleOf).filter(Boolean);
    const found = AK.locateByTitle(titles, {
      local: d.localAlbumKeys(), qobuz: d.qobuzAlbumKeys(), tidal: d.tidalAlbumKeys(),
    });
    if (!found.confident || found.source !== "qobuz") return null;
    return d.qobuzAlbumIds().get(found.qobuz[0]) || null;
  }

  /*
   * The Qobuz album id for something that is NOT in the favourites.
   *
   * Until v1.8.55 the favourites were the only place an album id could come from,
   * and that was stated as a hard limit — an album played from a search, an
   * editorial list or Roon's own browser had no waveform and never would. A probe
   * against 11,455 loaded favourites answered `near: []` for the album playing at
   * the time: not spelled differently, not absent by accident, simply never
   * favourited. It could have waited for ever.
   *
   * The catalogue is searchable with the token that already reads the favourites,
   * so the id IS obtainable. Three things make using it safe:
   *
   *   the MATCH is an exact identity, built by favouriteTitleForms — the same
   *     builder the favourites index uses, so a search hit and a favourite are
   *     keyed the same way and cannot disagree;
   *   AMBIGUITY DECLINES (lib/albumsearch.js). Qobuz answers a query it cannot
   *     place with its nearest guess rather than with nothing, so "the first
   *     result" is never an answer here;
   *   and being wrong is survivable anyway: TM.matchTrack gates on title AND
   *     duration, so a different pressing draws nothing rather than putting a
   *     confident picture of another recording under the seek bar.
   *
   * Memoised per identity INCLUDING the misses, so an album that is not on Qobuz
   * costs one search for the life of the process rather than one per poll.
   */
  const _wfQobuzSearched = new Map();    // wanted key -> album id or null
  const _wfQobuzSearching = new Map();   // wanted key -> in-flight promise
  async function wfQobuzSearchAlbumId(album, artist) {
    if (!qobuzReady()) return null;
    const wanted = albumKeys(album || "", artist || "");
    if (!wanted.length) return null;
    // Keyed on the FIRST identity, which is the whole-credit one: it is the same
    // for every call about this album, while the list itself is order-stable but
    // longer than a cache key wants to be.
    const ck = wanted[0];
    if (_wfQobuzSearched.has(ck)) return _wfQobuzSearched.get(ck);
    const already = _wfQobuzSearching.get(ck);
    if (already) return already;

    const job = (async () => {
      let items = [];
      try {
        const r = await qobuzWithToken((t) =>
          qobuz.searchCatalog(t, (album || "") + " " + (artist || ""), 20, 0));
        items = (r && r.albums && r.albums.items) || [];
      } catch (e) {
        // A failed search is NOT cached as "not on Qobuz": a rate limit or a
        // network blip would otherwise switch the fallback off for this album
        // until the container restarts.
        console.log("[waveform] qobuz: catalogue search failed for \"" + album +
                    "\": " + ((e && e.message) || "unknown"));
        return undefined;
      }
      const picked = ABS.pickAlbumId(wanted, ABS.candidatesOf(items, favouriteTitleForms, albumKey, ABS.NAMES_OF.qobuz));
      console.log("[waveform] qobuz: \"" + album + "\" is not a favourite; catalogue " +
                  "search " + (picked.id ? "found album " + picked.id + " — " + picked.reason
                                         : "declined — " + picked.reason));
      return picked.id || null;
    })().finally(() => { _wfQobuzSearching.delete(ck); });

    _wfQobuzSearching.set(ck, job);
    const got = await job;
    // undefined means the search itself failed — try again next time.
    if (got !== undefined) _wfQobuzSearched.set(ck, got);
    return got || null;
  }

  /**
   * Everything up to the audio: which credentials work, which track this is, and
   * the time-limited url for it. Returns { url, stop, detail, tried }.
   *
   * SPLIT OUT OF wfQobuzCompute IN v1.8.52 so /api/debug/waveform can report the
   * chain by RUNNING it rather than by re-implementing it. A probe that walks its
   * own copy of this ladder answers about itself, and the first time the two drift
   * the probe starts lying with total confidence — which is worse than no probe,
   * because it is believed. One body, two callers.
   *
   * `stop` names where it got to: "no-credentials" | "album" | "track" | "audio"
   * | "ok". `detail` is the sentence for a human; `tried` is what each credential
   * set said, which is the difference between a diagnosis and a shrug.
   */
  async function wfQobuzResolveAudio(albumId, track, seconds) {
    const secret = String(d.qobuzAppSecret() || "").trim();
    // Off entirely only when there is neither a sign-in nor a legacy pasted secret.
    if (!secret && !d.qobuzWaveToken()) {
      return { url: null, stop: "no-credentials", tried: [],
               detail: "no Qobuz sign-in and no pasted app secret" };
    }

    // ONE TOKEN, SEVERAL PAIRS — the shape a working Qobuz client actually uses.
    // v1.8.11 swapped the TOKEN along with the app_id and broke the album read,
    // which had been fine: `album/get` is unsigned, and this app's own login is
    // the token known to be live, since it is what read the favourites these
    // album ids came from. The token stays put; what varies is the app_id, which
    // pairs with the secret for the SIGNATURE only.
    //
    // Which combination Qobuz accepts cannot be determined from outside, so the
    // credential sets are tried in order and the first that yields audio wins.
    // The credential sets to try, best first, each resolved LAZILY. Minting costs
    // a login round trip and, for a signing app that does not accept passwords,
    // can only ever fail — so building it up front spent a doomed request and a
    // log line every 60s behind a pasted token that was already working.
    const attempts = [];
    // FIRST: the token from signing in on Qobuz's own page. It is minted by the
    // app whose secret is built in, so this set needs nothing from the user
    // beyond that one sign-in — nothing pasted, no credentials typed in here.
    if (d.qobuzWaveToken()) {
      attempts.push({
        label: "the Qobuz sign-in",
        get: () => d.qobuzWaveToken(),
        readAppId: QOA.APP_ID,
        secret: QOA.APP_SECRET,
      });
    }
    // Then a token supplied with a pasted pair. No UI offers this any more, but
    // an install that already had one keeps working instead of going dark on
    // upgrade.
    if (d.qobuzSignToken()) {
      attempts.push({
        label: "the token saved from a pasted file",
        get: () => d.qobuzSignToken(),
        readAppId: d.qobuzSignAppId() || undefined,
      });
    }
    // Then one minted under the signing app, for a secret whose app DOES accept a
    // password login. Only reached when there is no pasted token or it failed.
    if (d.qobuzSignAppId()) {
      attempts.push({
        label: "a token minted under app " + d.qobuzSignAppId(),
        get: () => qobuzSigningToken(),
        readAppId: d.qobuzSignAppId(),
      });
    }
    // Last, this app's own login — right when the secret belongs to this app's
    // own app_id, which is the case for a bare secret paste.
    attempts.push({
      label: "this app's Qobuz login",
      get: () => null,                   // null = the app's own, via qobuzWithToken
      readAppId: undefined,              // its own app_id, which minted that token
    });
    const signAs = d.qobuzSignAppId() || undefined;

    const reasons = [];
    // Declared here, not with `var` inside the loop: the loop assigns it and the
    // check below reads it, and a hoisted declaration inside a block is the exact
    // shape this project has been bitten by (see the declaration-before-use rule).
    //
    // What the album read produced, if any set got that far. It is how "no
    // credential could read the album" is told apart from "the album read fine
    // and the audio was refused" once the loop has ended.
    let matched = null;
    for (const a of attempts) {
      // Resolved here, not above: reaching this entry is what makes its cost worth
      // paying, and the common case never reaches past the first.
      const tok = await a.get();
      if (tok === undefined || (tok === null && a.readAppId)) {
        // A mint that failed. It logged its own reason; record that this set was
        // unavailable rather than silently trying it as "this app's login".
        reasons.push(a.label + ": could not be obtained");
        continue;
      }
      // An attempt may bring its own signing pair — the built-in sign-in does,
      // and its secret belongs to its app_id and to no other. The rest fall back
      // to whatever is configured.
      const useSecret = a.secret || secret;
      const useSignAs = a.secret ? a.readAppId : signAs;
      const withTok = (fn) => tok ? fn(tok) : qobuzWithToken(fn);

      const got = await withTok((t) => qobuz.getAlbumResult(t, albumId, 12000, a.readAppId))
        .catch((e) => ({ album: null, reason: qobuz.describeQobuzError(e, false) }));
      if (!got || !got.album) {
        reasons.push(a.label + ": " + ((got && got.reason) || "unknown"));
        if (tok && d.qobuzSignTok() && tok === d.qobuzSignTok().token) d.setQobuzSignTok(null);
        continue;
      }

      // The track match does not depend on the credentials, so a failure here is
      // final — retrying with another login would ask the same question twice.
      const m = TM.matchTrack(got.album.tracks, track, seconds);
      if (!m.track) {
        // Final, not a reason to try the next credential set: the track list is
        // the same whoever asks, so retrying would put the identical question a
        // second time. The album's track COUNT rides along because "no track
        // called X" and "no track called X in the 50 of 137 we were sent" are
        // different findings — see the paging fix in lib/qobuz.js.
        return { url: null, stop: "track", tried: reasons, detail: m.reason,
                 album_title: got.album.title || "",
                 album_tracks: got.album.tracks.length };
      }

      const f = await withTok((t) => qobuz.getFileUrlResult(t, m.track.id, useSecret, { appId: useSignAs }))
        .catch((e) => ({ url: null, reason: qobuz.describeFileUrlError(e) }));
      if (f && f.url) {
        return { url: f.url, stop: "ok", tried: reasons, detail: m.reason,
                 album_title: got.album.title || "",
                 album_tracks: got.album.tracks.length,
                 track_id: m.track.id, track_duration: m.track.duration,
                 credentials: a.label };
      }
      reasons.push(a.label + ": " + ((f && f.reason) || "unknown"));
      matched = { title: got.album.title || "", n: got.album.tracks.length,
                  reason: m.reason, duration: m.track.duration };
      // A minted token that stops working has expired. Forget it so the next play
      // mints a fresh one rather than replaying a dead credential forever.
      if (tok && d.qobuzSignTok() && tok === d.qobuzSignTok().token) d.setQobuzSignTok(null);
    }

    // Nothing yielded audio. Whether the track was ever even identified decides
    // which stop this is: an album that could not be READ and a track that could
    // not be STREAMED need different things from the user.
    return { url: null, stop: matched ? "audio" : "album", tried: reasons,
             detail: matched ? matched.reason : "no credential set could read the album",
             album_title: matched ? matched.title : "",
             album_tracks: matched ? matched.n : 0,
             track_duration: matched ? matched.duration : null };
  }

  /**
   * The waveform for a Qobuz track, or null with a logged reason.
   *
   * `reason` is always logged rather than swallowed: "no waveform" with no
   * explanation is what makes this class of feature impossible to diagnose from a
   * user's report, and there are five separate ways to decline here.
   */
  async function wfQobuzCompute(albumId, track, seconds, signal) {
    const got = await wfQobuzResolveAudio(albumId, track, seconds);
    if (!got.url) {
      if (got.stop === "no-credentials") return null;   // already said at the gate
      if (got.stop === "track") { console.log("[waveform] qobuz: " + got.detail); return null; }
      // Every set that was tried, and what Qobuz said to each. One line, because
      // a cause per attempt is the difference between a diagnosis and a shrug.
      console.log("[waveform] qobuz: no audio for \"" + track + "\" — " +
                  (got.tried.length ? got.tried.join(" | ") : got.detail));
      return null;
    }
    const url = got.url;

    const t0 = Date.now();
    let peaks = null;
    try {
      const ctl = new AbortController();
      // The decode's own cancellation reaches the download through this: an
      // overtaken prefetch must stop pulling bytes, not just stop caring.
      const poll = setInterval(() => { if (signal && signal.aborted) ctl.abort(); }, 500);
      if (poll.unref) poll.unref();
      let r;
      try {
        r = await fetch(url, { signal: ctl.signal });
      } finally { clearInterval(poll); }
      if (!r.ok || !r.body) {
        console.log("[waveform] qobuz: stream HTTP " + r.status);
        return null;
      }
      // Node's fetch gives a web ReadableStream; ffmpeg wants a node Readable.
      const input = require("node:stream").Readable.fromWeb(r.body);
      // The length goes with it for the same reason as a local file, and it
      // matters more here: a download cut off halfway looks exactly like a short
      // track, and the shape would be stored as the answer for that recording.
      peaks = await WFD.decodeWaveform(null, { input, signal, expectSeconds: seconds || 0 });
    } catch (e) {
      console.log("[waveform] qobuz: stream failed for \"" + track + "\": " + e.message);
      return null;
    }
    if (!peaks) {
      // WITH the reason. The local path has said why since v1.8.30 and this one
      // did not, so the single most common streaming failure after a successful
      // fetch — a truncated download refused by MIN_COVERAGE, which is
      // indistinguishable from a short track and must be refused — arrived as
      // four words with no cause in them.
      const why = WFD.lastDecodeError();
      console.log("[waveform] qobuz: could not decode \"" + track + "\"" +
                  (why ? " (" + why + ")" : ""));
      return null;
    }
    console.log("[waveform] qobuz: " + track + " in " + (Date.now() - t0) + "ms");
    return peaks;
  }

  return { wfQobuzTrack, wfQobuzAlbumId, wfQobuzSearchAlbumId, wfQobuzResolveAudio, wfQobuzCompute };
}

module.exports = { createQobuzWaveforms };
