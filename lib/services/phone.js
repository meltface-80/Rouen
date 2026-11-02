// @ts-check
"use strict";
/*
 * phone.js — TIDAL albums on This phone (dev/design/android-app.md §4.22, "TIDAL and Qobuz", slices 1 and 3;
 * v1.9.72-t64). This phone plays through Rouen's own TIDAL sign-in, never through Roon: Rouen fetches each track's
 * audio itself and serves it to the app with the library file route's contract (lib/phone/downloads.js), so the app's
 * player plays it exactly as it plays a library album.
 *
 *   GET /api/phone/service/album  ?title&artist                     → {service, id, title, artist, tracks: [{n, title,
 *                                                                     disc, track, length}]}; 404 when it isn't one
 *   GET /api/phone/service/file   ?service&album&n&quality           → track n: FLAC (original) or Opus 256 in Ogg, made
 *                                                                     by ffmpeg as it is sent
 *
 * The album is the library album's TIDAL counterpart (the waveform's own lookup, from your TIDAL favourites); its
 * tracks are TIDAL's. The audio is asked of TIDAL per track (playbackinfo): one address, or MPEG-DASH's pieces in
 * order, fed to ffmpeg as they come; protected audio is refused, never read (lib/tidal-manifest.js manifestFrom).
 * Original asks TIDAL for hi-res and falls back to lossless when that is refused; Opus asks for lossless. Qobuz
 * follows in its own build. Every route needs Rouen's login, as every route does.
 */
const { manifestFrom } = require("../tidal-manifest");

const QUALITIES = new Set(["original", "opus"]);
/** A track list asked of TIDAL is kept this long, so an album's tracks aren't asked again for each one. */
const ALBUM_MS = 10 * 60 * 1000;
/** Albums whose track lists are kept at most. */
const ALBUMS_KEPT = 50;

/**
 * @typedef {{ id: any, title: string, duration: number | null, number: number | null, disc?: number }} TidalTrack
 * @typedef {{
 *   tidalAlbumId: (title: string, artist: string) => string | null,
 *   tidalWithToken: (fn: (token: string, cc: string) => Promise<any>) => Promise<any>,
 *   tidal: { getAlbumTracks: Function, getPlaybackInfo: Function },
 *   ffmpeg: () => string | null, spawn?: Function, fetch?: typeof fetch, now?: () => number,
 *   log?: (line: string) => void }} PhoneServiceDeps
 */

/** The ffmpeg arguments for [quality], reading the audio from stdin. @param {string} quality */
function ffmpegArgs(quality) {
  const head = ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-vn"];
  if (quality === "original") return head.concat(["-c:a", "flac", "-f", "flac", "pipe:1"]);
  // As the library's Opus (lib/phone/downloads.js opusArgs): 256k, 48 kHz, stereo.
  return head.concat(["-af", "aresample=resampler=soxr:precision=28:osr=48000", "-ac", "2", "-ar", "48000",
    "-c:a", "libopus", "-b:a", "256k", "-vbr", "on", "-f", "ogg", "pipe:1"]);
}

/** @param {{ get: Function }} app @param {PhoneServiceDeps} d */
function mountPhoneServices(app, d) {
  const now = d.now || Date.now;
  const log = d.log || ((/** @type {string} */ line) => console.log(line));
  const get = d.fetch || fetch;
  const spawn = d.spawn || require("node:child_process").spawn;
  /** @type {Map<string, { at: number, tracks: TidalTrack[] }>} */
  const albums = new Map();

  /** The TIDAL album's tracks, kept a while. @param {string} id @returns {Promise<TidalTrack[] | null>} */
  async function tracksOf(id) {
    const have = albums.get(id);
    if (have && now() - have.at < ALBUM_MS) return have.tracks;
    const r = await d.tidalWithToken((t, cc) => d.tidal.getAlbumTracks(t, cc, id));
    if (!r || !Array.isArray(r.tracks) || !r.tracks.length) return null;
    albums.delete(id);
    albums.set(id, { at: now(), tracks: r.tracks });
    if (albums.size > ALBUMS_KEPT) albums.delete(String(albums.keys().next().value));
    return r.tracks;
  }

  /**
   * Where track [trackId]'s audio is, in order (the one address, or DASH's pieces), at the best tier [quality] allows
   * that TIDAL gives unprotected. @param {any} trackId @param {string} quality @returns {Promise<string[]>}
   */
  async function where(trackId, quality) {
    const tiers = quality === "original" ? ["HI_RES_LOSSLESS", "LOSSLESS"] : ["LOSSLESS"];
    let why = "";
    for (const tier of tiers) {
      const j = await d.tidalWithToken((t, cc) => d.tidal.getPlaybackInfo(t, cc, trackId, tier));
      const m = manifestFrom(j);
      if ("reason" in m) { why = m.reason; continue; }
      return m.pieces || [m.url];
    }
    throw Object.assign(new Error(why || "TIDAL gave no stream for this track"), { status: 502 });
  }

  /**
   * ffmpeg's stdin ready for more: drained — or closed, failed, or the play given up ([signal]), so a feed waiting on a
   * stdin that will never drain (ffmpeg gone) is let go rather than held for ever. @param {any} into @param {AbortSignal} signal
   */
  function drained(into, signal) {
    return new Promise((resolve) => {
      const done = () => {
        into.off("drain", done); into.off("close", done); into.off("error", done); signal.removeEventListener("abort", done);
        resolve(undefined);
      };
      into.on("drain", done); into.on("close", done); into.on("error", done); signal.addEventListener("abort", done);
    });
  }

  /**
   * Each piece's bytes, in order, into ffmpeg's stdin; stops when [signal] aborts (the phone gone). A piece that can't
   * be fetched ends the input there: ffmpeg finishes what it has.
   * @param {string[]} urls @param {any} into @param {AbortSignal} signal
   */
  async function feed(urls, into, signal) {
    try {
      for (const u of urls) {
        const r = await get(u, { signal });
        if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
        for await (const chunk of /** @type {any} */ (r.body)) {
          if (signal.aborted) return;
          if (!into.write(chunk)) await drained(into, signal);
          if (signal.aborted) return;
        }
      }
    } catch (e) {
      if (!signal.aborted) log("[phone] tidal: the audio stopped coming: " + /** @type {Error} */ (e).message);
    } finally {
      try { into.end(); } catch (e) { /* ffmpeg already gone: nothing left to end */ }
    }
  }

  app.get("/api/phone/service/album", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
    const artist = typeof req.query.artist === "string" ? req.query.artist.trim() : "";
    if (!title) return res.status(400).json({ error: "title (and artist), please" });
    const id = d.tidalAlbumId(title, artist);
    if (!id) return res.status(404).json({ error: "Not one of your TIDAL albums." });
    try {
      const tracks = await tracksOf(String(id));
      if (!tracks) return res.status(404).json({ error: "TIDAL couldn't list this album's tracks." });
      res.json({ service: "tidal", id: String(id), title, artist,
        tracks: tracks.map((t, i) => ({ n: i + 1, title: t.title, disc: t.disc || 1, track: t.number || i + 1, length: t.duration || 0 })) });
    } catch (e) {
      res.status(502).json({ error: "TIDAL couldn't be asked: " + /** @type {Error} */ (e).message });
    }
  });

  app.get("/api/phone/service/file", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const service = String(req.query.service || ""), album = String(req.query.album || "");
    const n = /^\d{1,4}$/.test(String(req.query.n)) ? Number(req.query.n) : NaN;
    const quality = String(req.query.quality || "original");
    if (service !== "tidal" || !/^[A-Za-z0-9_-]{1,64}$/.test(album) || !(n >= 1) || !QUALITIES.has(quality)) {
      return res.status(400).json({ error: "service (tidal), album, n (1, 2, …) and quality (original or opus), please" });
    }
    const exe = d.ffmpeg();
    if (!exe) return res.status(500).json({ error: "Rouen can't make the audio: no ffmpeg." });
    // The phone gone at any point from here (a skip, cache-ahead cancelled, the app closed): nothing more is started,
    // and what was started is let go.
    const stop = new AbortController();
    /** @type {any} */
    let enc = null;
    res.on("close", () => { stop.abort(); if (enc) enc.kill("SIGKILL"); });
    /** @type {string[]} */
    let urls;
    try {
      const tracks = await tracksOf(album);
      const t = tracks && tracks[n - 1];
      if (!t) return res.status(404).json({ error: "That album has no track " + n + "." });
      urls = await where(t.id, quality);
    } catch (e) {
      const err = /** @type {any} */ (e);
      log("[phone] tidal: album " + album + " track " + n + ": " + err.message);
      if (!stop.signal.aborted) res.status(err.status || 502).json({ error: "TIDAL: " + err.message });
      return;
    }
    if (stop.signal.aborted) return;
    enc = spawn(exe, ffmpegArgs(quality), { stdio: ["pipe", "pipe", "ignore"] });
    let failed = false, started = false;
    enc.on("error", () => { failed = true; /* "close" says what came of it */ });
    // ffmpeg stopped reading (it ended, or failed): what is still being fed has nowhere to go.
    enc.stdin.on("error", () => { stop.abort(); });
    // The answer starts with ffmpeg's first bytes, never before: until then a failure (TIDAL's address refused, ffmpeg
    // rejecting what came) is still an error the phone is told, not an empty track. ffmpeg's output is paused while the
    // phone takes what it has, and the TIDAL fetch with it (through stdin).
    enc.stdout.on("data", (/** @type {Buffer} */ chunk) => {
      if (!started) {
        started = true;
        res.set({ "Content-Type": quality === "original" ? "audio/flac" : "audio/ogg", "Cache-Control": "no-store" });
      }
      if (!res.write(chunk)) { enc.stdout.pause(); res.once("drain", () => enc.stdout.resume()); }
    });
    enc.on("close", (/** @type {number | null} */ code) => {
      stop.abort();
      if (res.writableEnded || res.destroyed) return;
      if (started) { res.end(); return; }
      log("[phone] tidal: album " + album + " track " + n + ": ffmpeg made nothing" + (code ? " (exit " + code + ")" : ""));
      res.status(failed ? 500 : 502).json({ error: failed ? "Rouen couldn't run ffmpeg." : "TIDAL's audio for this track couldn't be read" + (code ? " (ffmpeg " + code + ")." : ".") });
    });
    feed(urls, enc.stdin, stop.signal);
  });
}

module.exports = { mountPhoneServices, ffmpegArgs, QUALITIES };
