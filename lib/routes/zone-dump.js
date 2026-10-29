// @ts-check
"use strict";
/*
 * zone-dump.js — /api/debug/zone-dump: a zone exactly as the official API sends it, its queue's first items, and the
 * now_playing payloads captured as tracks changed (v1.8.1; out of index.js in v1.9.72-t1, behaviour unchanged).
 *
 *   /api/debug/zone-dump               → the zone with the most loaded (playing, then paused, then any track)
 *   /api/debug/zone-dump?zone=<id>     → that zone
 *   /api/debug/zone-dump?items=N       → N queue items (1 to 10, 3 if not given)
 *
 * Read-only: one queue read of the official API, nothing changed.
 */
const SHAPE = require("../objshape");

/**
 * @typedef {object} ZoneDumpDeps  index.js's, each read as the dump is made
 * @property {() => any} core  the paired Core, null when not paired
 * @property {() => Record<string, any>} zones  the official zones by id
 * @property {(zoneId: string, count: number) => Promise<any[]>} peekQueueRaw
 * @property {(album: string, artist: string) => object} identityReport  what Rouen concludes about an album today
 * @property {() => object} qobuz  the Qobuz waveform state, never a credential
 * @property {() => any[]} samples  the captured now_playing payloads
 */

/**
 * @param {{ get: Function }} app
 * @param {ZoneDumpDeps} deps
 */
function mountZoneDump(app, deps) {
  app.get("/api/debug/zone-dump", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!deps.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    const zones = deps.zones();
    const all = Object.values(zones);
    // Prefer a zone that HAS something loaded, not merely one that is playing: a
    // paused zone still carries the now_playing this exists to inspect, and a
    // stopped one carries nothing at all. Falling back to "the first zone" is how
    // the first version of this quietly returned an idle endpoint and an answer
    // that looked complete while saying nothing.
    const rank = (/** @type {any} */ z) => (
      !z.now_playing ? 0 :
      z.state === "playing" || z.state === "loading" ? 3 :
      z.state === "paused" ? 2 : 1
    );
    let zoneId = req.query.zone;
    if (!zoneId) {
      const best = all.slice().sort((a, b) => rank(b) - rank(a))[0];
      zoneId = best && best.zone_id;
    }
    const zone = zoneId && zones[zoneId];
    if (!zone) {
      return res.status(404).json({ error: "no such zone", known: Object.keys(zones) });
    }

    const count = Math.max(1, Math.min(10, parseInt(req.query.items, 10) || 3));
    /** @type {any[]} */
    let queue = [];
    try {
      queue = await deps.peekQueueRaw(zoneId, count);
    } catch (e) {
      // A queue we cannot read is not a reason to withhold the zone, which is the
      // more interesting half.
      queue = [];
    }

    const np = zone.now_playing || null;
    const t3 = (np && np.three_line) || {};
    const album = t3.line3 || "", artist = t3.line2 || "";
    const samples = deps.samples();

    res.json({
      // Said first and said plainly. A dump of a stopped zone has no now_playing
      // and no queue, so it cannot answer anything — and it looks like a full
      // answer if nothing points that out.
      note: np
        ? "OK — this zone has a track loaded."
        : "THIS ZONE IS IDLE (state: " + (zone.state || "?") + "). It carries no " +
          "now_playing and no queue, so this dump cannot show what a playing track " +
          "looks like. Start playback and reload, or use ?zone=<id> from the list " +
          "below. The `samples` further down were captured as tracks changed and " +
          "do not need anything to be playing right now.",
      zones: all.map((z) => ({
        zone_id: z.zone_id,
        name: z.display_name || "",
        state: z.state || "",
        has_now_playing: !!z.now_playing,
        track: ((z.now_playing && z.now_playing.three_line) || {}).line1 || "",
      })),

      // What this app concludes today, so anything Roon turns out to send can be
      // read straight against the inference it would replace.
      app_thinks: Object.assign({ track: t3.line1 || "", album, artist },
                               deps.identityReport(album, artist)),

      /*
       * The captured samples: the last few now_playing payloads, recorded as the
       * track changed. THIS is the part that answers the question — play a Qobuz
       * album and a local one, then read `sample_fields`, where `seen` says how
       * many of the samples carried each field. A field that appears for some
       * tracks and not others is exactly what a source marker would look like.
       */
      // Streaming waveforms need an album id, not just a key. Reported here
      // because zero of them is the difference between "declined for a good
      // reason" and "the favourites have not been read yet".
      qobuz: deps.qobuz(),
      sample_count: samples.length,
      sample_fields: SHAPE.formatPaths(SHAPE.unionPaths(samples.map((x) => x.now_playing))),
      samples: samples.map((x) => ({ at: x.at, zone: x.zone_name, state: x.state,
                                     app_thinks: x.app_thinks })),
      samples_raw: samples.map((x) => x.now_playing),

      zone_shape:  SHAPE.formatPaths(SHAPE.keyPaths(zone)),
      queue_shape: SHAPE.formatPaths(SHAPE.keyPaths(queue[0] || null)),
      zone_raw:  zone,
      queue_raw: queue,
    });
  });
}

module.exports = { mountZoneDump };
