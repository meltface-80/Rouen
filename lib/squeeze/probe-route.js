// @ts-check
"use strict";
/*
 * probe-route.js — /api/debug/squeeze, the Squeezebox probe run by hand (dev/design/android-app.md §6 step 1,
 * v1.9.72-t1; the player is probe-player.js). Without a parameter it says how; nothing runs until ?start=1.
 *
 *   ?start=1 [&minutes=N, 1 to 60, 15 if not given] [&formats=flc,pcm | flc | pcm] [&rate=48000 | 96000 | 192000]
 *            [&host=<the Core's IPv4 address>, if not the paired Core's]
 *            [&lead=N, 0 to 600 seconds, 30 if not given | close] (v1.9.72-t3: when "decoder done" is said)
 *            [&early=N, 1 to 120 seconds, 10 if not given | off] (v1.9.72-t4: when "ran dry" is said)
 *   ?read=1                     what the run saw, so far
 *   ?stop=1                     end it early
 *   ?listen=N [&lossless=1]     a kept track: its Opus 256, or the FLAC Roon sent
 */
const { createProbePlayer } = require("./probe-player");

/**
 * What Roon's own zone for the player shows (v1.9.72-t2): the official API's zone named so, or holding an output named
 * so. The t1 run's FLAC said no length, and only Roon knows which track a stream is.
 * @param {Record<string, any>} zones @param {string} name
 */
function nowPlayingOf(zones, name) {
  const z = Object.values(zones || {}).find((x) => x && (x.display_name === name
    || (x.outputs || []).some((/** @type {any} */ o) => o && o.display_name === name)));
  if (!z) return null;
  const np = z.now_playing, l = (np && np.three_line) || {};
  return { state: z.state || null, title: l.line1 || null, artist: l.line2 || null, album: l.line3 || null,
    length: np && typeof np.length === "number" ? np.length : null,
    seek: np && typeof np.seek_position === "number" ? np.seek_position : null };
}


const HOW = "First, in Roon: Settings → Setup → turn Squeezebox support on if it is off. Then add ?start=1 to join " +
  "your Roon Core as a Squeezebox player called \"Rouen probe\" for 15 minutes (&minutes=N, 1 to 60); it keeps trying " +
  "to reach Roon for as long as it runs. In Roon: Settings → Audio → find \"Rouen probe\" and enable it. Play an " +
  "album to it: let a track end on its own, skip, pause and " +
  "resume, seek, change the volume. Then open ?read=1 for everything Roon did. The last 4 tracks it received are " +
  "kept: each has a listen link (Opus 256, what the phone would get away from home) and, for FLAC, a lossless one. " +
  "Rouen plays no sound and changes nothing in your library. ?stop=1 ends it early. Add &formats=flc or &formats=pcm " +
  "to offer Roon only that format, and &rate=48000, 96000 or 192000 for the highest rate offered (192000 if not given). " +
  "&lead=N says \"decoder done\" N seconds before a stream's audio runs out (30 if not given), as a player reading " +
  "Roon's stream a little ahead would; &lead=close says it as the stream closes, as 1.9.72-t1 and t2 did. " +
  "&early=N says \"ran dry\" N seconds before a stream's audio runs out (10 if not given), for Roon to send the next " +
  "stream in time; &early=off says it only when it does.";

const FORMATS = new Set(["flc,pcm", "flc", "pcm"]);
const MAX_RATES = new Set([48000, 96000, 192000]);

/**
 * @param {{ get: Function }} app
 * @param {{ host: () => string | null, zones?: () => Record<string, any>, dir: string, ffmpeg: () => string,
 *   player?: ReturnType<typeof createProbePlayer> }} deps
 */
function mountSqueezeProbe(app, deps) {
  const zones = deps.zones;
  const player = deps.player || createProbePlayer({ dir: deps.dir, ffmpeg: deps.ffmpeg,
    // Roon names the zone itself: "Rouen" (the player's ModelName) on the owner's Core, not the name the player gives.
    nowPlaying: zones ? (name) => nowPlayingOf(zones(), name) || nowPlayingOf(zones(), "Rouen") : undefined });
  app.get("/api/debug/squeeze", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const q = req.query;
    if (q.listen !== undefined) {
      const n = /^\d{1,4}$/.test(String(q.listen)) ? Number(q.listen) : NaN;
      if (!(n >= 1)) return res.status(400).json({ error: "listen takes a track's number from ?read=1" });
      const lossless = q.lossless === "1";
      const file = player.file(n, lossless);
      if (!file) return res.status(404).json({ error: "No such track kept" + (lossless ? " as FLAC" : " as Opus (yet)") + ": see ?read=1." });
      res.type(lossless ? "audio/flac" : "audio/ogg");
      return res.sendFile(file);
    }
    if (q.stop === "1") { player.stop("stopped by hand"); return res.json(player.read()); }
    if (q.read === "1") return res.json(player.read());
    if (q.start !== "1") return res.json({ readOnly: true, design: "dev/design/android-app.md §6", how: HOW, last: player.read() });

    const minutes = q.minutes === undefined ? 15 : /^\d{1,2}$/.test(String(q.minutes)) ? Number(q.minutes) : NaN;
    if (!(minutes >= 1 && minutes <= 60)) return res.status(400).json({ error: "minutes takes whole minutes, 1 to 60" });
    const formats = q.formats === undefined ? "flc,pcm" : String(q.formats);
    if (!FORMATS.has(formats)) return res.status(400).json({ error: "formats takes flc,pcm or flc or pcm" });
    const maxRate = q.rate === undefined ? 192000 : Number(q.rate);
    if (!MAX_RATES.has(maxRate)) return res.status(400).json({ error: "rate takes 48000, 96000 or 192000" });
    // Decoder done is said this many seconds before a stream's audio runs out (30 if not given), or as it closes.
    const lead = q.lead === undefined ? 30 : q.lead === "close" ? null : /^\d{1,3}$/.test(String(q.lead)) ? Number(q.lead) : NaN;
    if (lead !== null && !(lead >= 0 && lead <= 600)) return res.status(400).json({ error: "lead takes whole seconds, 0 to 600, or close" });
    // Ran dry (STMu) is said this many seconds before a stream's audio runs out (10 if not given), or only when it does.
    const early = q.early === undefined ? 10 : q.early === "off" ? null : /^\d{1,3}$/.test(String(q.early)) ? Number(q.early) : NaN;
    if (early !== null && !(early >= 1 && early <= 120)) return res.status(400).json({ error: "early takes whole seconds, 1 to 120, or off" });
    let host = deps.host();
    if (q.host !== undefined) {
      const h = String(q.host);
      const parts = h.split(".");
      if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
        return res.status(400).json({ error: "host takes the Core's IPv4 address" });
      }
      host = h;
    }
    if (!host) return res.status(503).json({ error: "Rouen is not paired with a Core, so there is no address to join. Add &host=<the Core's address>." });
    res.json(Object.assign(player.start({ host, minutes, formats, maxRate, lead, early }), { next: "Enable \"Rouen probe\" in Roon (Settings → Audio), play to it, then open ?read=1." }));
  });
  return player;
}

module.exports = { mountSqueezeProbe, nowPlayingOf };
