// @ts-check
"use strict";
/*
 * downloads.js — Rouen's side of the Android app's downloads (dev/design/android-app.md §4.6, §4.19; v1.9.72-t27): an
 * album's files from its folder in /music, the one the label scan kept (as the album's credits find it,
 * lib/credits/files.js), each as stored or as Opus 256. Local files only (the owner): an album not in /music — TIDAL,
 * Qobuz, or a folder the scan did not keep — can't be downloaded, and says so.
 *
 *   GET /api/phone/album       ?title&artist                 → {title, artist, tracks: [{n, title, disc, track, length, bytes, ext}]}
 *   GET /api/phone/album/file  ?title&artist&n&quality       → track n: the file as stored (Range answered, so a download
 *                                                                resumes), or Opus 256 in Ogg, made by ffmpeg as it is sent
 *
 * Both need Rouen's login, as every route does; nothing here opens a route. n is the track's place through the album
 * (1, 2, …), in the album's order: disc, then track tag, then file name. An Opus track that breaks off is fetched again
 * from its start (it is made as it is sent, so it has no length to resume within).
 */
const path = require("node:path");
const { AUDIO_RE } = require("../credits/files");

/** What a file says it is, by its ending. */
const TYPES = /** @type {Record<string, string>} */ ({
  flac: "audio/flac", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg",
  wv: "audio/x-wavpack", ape: "audio/x-ape", wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff",
  dsf: "audio/x-dsf", dff: "audio/x-dff",
});
const QUALITIES = new Set(["original", "opus"]);
/** An album's tracks are read again after this long (a folder changed under it is seen within a minute). */
const KEEP_MS = 60 * 1000;
const NOT_HERE = "Not one of the albums found in /music: only your own files can be downloaded, not streamed ones.";

/**
 * @typedef {{ n: number, title: string, disc: number, track: number, length: number, bytes: number, ext: string, file: string }} Track
 */

/**
 * @param {{ dirOf: (title: string, artist: string) => string | null, readdir: (dir: string) => string[],
 *   parseFile: (file: string, opts: object) => Promise<any>, size: (file: string) => number, now?: () => number }} d
 *   dirOf: the folder the label scan kept for the album, or null; size: a file's bytes
 */
function createDownloads(d) {
  const now = d.now || Date.now;
  /** @type {Map<string, { at: number, tracks: Track[] }>} */
  const kept = new Map();

  /**
   * The album's tracks in its order, or why there are none.
   * @param {string} title @param {string} artist
   * @returns {Promise<{ tracks: Track[], why: string | null }>}
   */
  async function tracks(title, artist) {
    const dir = d.dirOf(title, artist);
    if (!dir) return { tracks: [], why: NOT_HERE };
    const k = kept.get(dir);
    if (k && now() - k.at < KEEP_MS) return { tracks: k.tracks, why: null };
    let names;
    try { names = d.readdir(dir).filter((n) => AUDIO_RE.test(n)).sort(); }
    catch (e) { return { tracks: [], why: "Its folder couldn't be read: " + String(e && /** @type {any} */ (e).message) }; }
    /** @type {Array<any>} */
    const files = [];
    for (const name of names) {
      const file = path.join(dir, name);
      let meta = null;
      try { meta = await d.parseFile(file, { duration: true, skipCovers: true }); }
      catch (e) { meta = null; /* a file whose tags can't be read is still the album's: it goes by its name */ }
      const c = (meta && meta.common) || {};
      const ext = path.extname(name).slice(1).toLowerCase();
      let bytes = 0;
      try { bytes = d.size(file); } catch (e) { bytes = 0; /* gone since the listing: its size is unknown, the fetch says the rest */ }
      files.push({ name, file, ext, bytes, disc: Number(c.disk && c.disk.no) || 1, track: Number(c.track && c.track.no) || 0,
        title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : name.replace(/\.[^.]+$/, ""),
        length: Math.round(Number(meta && meta.format && meta.format.duration) || 0) });
    }
    if (!files.length) return { tracks: [], why: "No audio file in its folder." };
    files.sort((a, b) => a.disc - b.disc || (a.track || Infinity) - (b.track || Infinity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Numbered in the album's order, so n is its place through the album.
    const list = files.map((f, i) => ({ n: i + 1, title: f.title, disc: f.disc, track: f.track, length: f.length, bytes: f.bytes, ext: f.ext, file: f.file }));
    kept.set(dir, { at: now(), tracks: list });
    return { tracks: list, why: null };
  }

  /** The ffmpeg arguments that make a track Opus 256 in Ogg, at 48 kHz, as the phone's player has it. @param {string} file */
  const opusArgs = (file) => ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-vn",
    "-af", "aresample=resampler=soxr:precision=28:osr=48000", "-ac", "2", "-ar", "48000",
    "-c:a", "libopus", "-b:a", "256k", "-vbr", "on", "-f", "ogg", "pipe:1"];

  return { tracks, opusArgs };
}

/**
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof createDownloads>} downloads
 * @param {{ ffmpeg: () => string, spawn: Function }} run
 */
function mountDownloads(app, downloads, run) {
  /** @param {any} q */
  const album = (q) => {
    const title = typeof q.title === "string" ? q.title.trim() : "", artist = typeof q.artist === "string" ? q.artist.trim() : "";
    return title ? { title, artist } : null;
  };

  app.get("/api/phone/album", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const a = album(req.query);
    if (!a) return res.status(400).json({ error: "title (and artist), please" });
    const { tracks, why } = await downloads.tracks(a.title, a.artist);
    if (why) return res.status(404).json({ error: why });
    res.json({ title: a.title, artist: a.artist,
      tracks: tracks.map((t) => ({ n: t.n, title: t.title, disc: t.disc, track: t.track, length: t.length, bytes: t.bytes, ext: t.ext })) });
  });

  app.get("/api/phone/album/file", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const a = album(req.query);
    const n = /^\d{1,4}$/.test(String(req.query.n)) ? Number(req.query.n) : NaN;
    const quality = String(req.query.quality || "original");
    if (!a || !(n >= 1) || !QUALITIES.has(quality)) return res.status(400).json({ error: "title, artist, n (1, 2, …) and quality (original or opus), please" });
    const { tracks, why } = await downloads.tracks(a.title, a.artist);
    if (why) return res.status(404).json({ error: why });
    const t = tracks.find((x) => x.n === n);
    if (!t) return res.status(404).json({ error: "The album has " + tracks.length + " tracks." });
    if (quality === "original") {
      // Express answers Range (a download resumes where it stopped) and a file gone since the listing (404).
      return res.sendFile(t.file, { dotfiles: "allow", headers: { "Content-Type": TYPES[t.ext] || "application/octet-stream" } },
        (/** @type {any} */ err) => { if (err && !res.headersSent) res.status(err.status || 500).json({ error: "The file couldn't be sent: " + err.message }); });
    }
    res.set({ "Content-Type": "audio/ogg", "Cache-Control": "no-store" });
    const enc = run.spawn(run.ffmpeg(), downloads.opusArgs(t.file), { stdio: ["ignore", "pipe", "ignore"] });
    let failed = false;
    enc.on("error", () => { failed = true; /* no ffmpeg: "close" says so */ });
    // Not ended by the pipe: with nothing made, the answer is why, not an empty 200.
    enc.stdout.pipe(res, { end: false });
    enc.on("close", (/** @type {number | null} */ code) => {
      if (res.headersSent) return res.end();
      res.status(500).json({ error: failed ? "Rouen couldn't make Opus (no ffmpeg)." : "Rouen couldn't make Opus of the track" + (code ? " (ffmpeg " + code + ")." : ".") });
    });
    // The phone gone mid-track: the encoder is stopped, rather than left making what no one will read.
    res.on("close", () => { if (enc.exitCode === null) enc.kill("SIGKILL"); });
  });
}

module.exports = { createDownloads, mountDownloads, TYPES, NOT_HERE };
