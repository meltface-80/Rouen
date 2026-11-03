// @ts-check
"use strict";
/*
 * zone-settings.js — shuffle, repeat and Roon Radio for a zone: the route, moved out of index.js in v1.9.72-t27
 * unchanged. It calls the native-first transport (transport.js) and hands Rouen's own Random Album Radio over to Roon
 * Radio when that is switched on (lib/radio.js).
 *
 *   POST /api/zone-settings   { zone_or_output_id, shuffle?, loop?, auto_radio? }
 *     shuffle:    boolean
 *     loop:       "disabled" | "loop" (whole queue) | "loop_one" (this track)
 *     auto_radio: boolean — Roon Radio, Roon's own keep-playing feature
 *   → { ok, random_album_radio_turned_off, via, radios }
 *
 * Roon's change_settings also accepts loop:"next" to cycle server-side; we
 * deliberately don't expose it. The client already knows the current mode from
 * the zone poll, so it sends the concrete state it wants — which means the
 * request says what it does, and a failed call can't leave the UI out of step
 * with the zone.
 */

const ZONE_LOOP_MODES = ["disabled", "loop", "loop_one"];

/**
 * @param {{ post: Function }} app
 * @param {{ core: () => any, zones: () => Record<string, any>, outputs: () => Record<string, any>,
 *   transport: { change_settings: (id: string, patch: Record<string, any>, cb: (err: any, via: any) => void) => void },
 *   applyAccepted: (zone: any, patch: Record<string, any>) => void,
 *   radio: { toTurnOff: (which: string, on: boolean, ours: boolean) => string | null, isOn: (zoneId: string) => boolean,
 *     stop: (zoneId: string) => void, report: (zoneId: string | null | undefined) => any } }} d
 *   radio.stop: Rouen's own radio off for the zone, its episode forgotten and the change kept
 */
function mountZoneSettings(app, d) {
  app.post("/api/zone-settings", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    const { zone_or_output_id } = req.body || {};
    if (!zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });

    /** @type {Record<string, any>} */
    const patch = {};
    if (req.body.shuffle !== undefined) {
      if (typeof req.body.shuffle !== "boolean") return res.status(400).json({ error: "shuffle must be a boolean" });
      patch.shuffle = req.body.shuffle;
    }
    if (req.body.auto_radio !== undefined) {
      if (typeof req.body.auto_radio !== "boolean") return res.status(400).json({ error: "auto_radio must be a boolean" });
      patch.auto_radio = req.body.auto_radio;
    }
    if (req.body.loop !== undefined) {
      if (!ZONE_LOOP_MODES.includes(req.body.loop)) {
        return res.status(400).json({ error: "invalid loop, allowed: " + ZONE_LOOP_MODES.join(", ") });
      }
      patch.loop = req.body.loop;
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "one of shuffle, loop, auto_radio required" });
    }

    // Turning Roon Radio on makes the Random Album Radio stand down for this zone
    // (lib/radio.js returns null while auto_radio is set), so the two never fight
    // over the same queue. We don't silently switch the user's own setting off —
    // we report it so the UI can say what just happened.
    const zones = d.zones(), outputs = d.outputs();
    const zone = zones[zone_or_output_id]
      || (outputs[zone_or_output_id] && zones[outputs[zone_or_output_id].zone_id])
      || null;
    const ownRadioWasOn = patch.auto_radio === true && zone &&
      d.radio.toTurnOff("roon", true, d.radio.isOn(zone.zone_id)) === "own";

    d.transport.change_settings(zone_or_output_id, patch, (/** @type {any} */ err, /** @type {any} */ via) => {
      if (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        console.warn(`[zone-settings] failed: ${msg}`);
        return res.status(500).json({ error: msg });
      }
      // The zone the Core just changed still reads as it did BEFORE the change
      // until the subscription pushes it back, so the client that asked for this
      // would poll and see its own switch spring back. Mirror what was accepted.
      d.applyAccepted(zone, patch);

      // The other direction of the same rule. Only once the Core has ACCEPTED
      // auto_radio do we switch ours off: doing it first would leave the zone
      // with neither radio on if the change were rejected.
      if (ownRadioWasOn) {
        d.radio.stop(zone.zone_id);
        console.log(`[radio] Roon Radio on for ${zone.display_name || zone.zone_id} — random album radio off`);
      }
      // Both radios as they now stand, in the same shape /api/radio uses, for the
      // same reason: the client paints both switches from this one answer rather
      // than re-reading a cache that lags the write.
      res.json({
        ok: true,
        random_album_radio_turned_off: ownRadioWasOn, via: via && via.via,
        radios: d.radio.report(zone && zone.zone_id),
      });
    });
  });
}

module.exports = { mountZoneSettings, ZONE_LOOP_MODES };
