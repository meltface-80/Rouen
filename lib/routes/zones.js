// @ts-check
"use strict";
/*
 * zones.js — the zone reads the screens poll, through the official API: moved out of index.js unchanged in v1.9.64
 * (dev/quality.md; native-remote.md §14: the official-API code native transport will stand beside).
 *
 *   GET /api/zones        every zone, its settings and outputs
 *   GET /api/outputs      every output, for the zone-grouping sheet
 *   GET /api/zone-state   one zone's state, now playing and volume, polled by every open client
 */

// One output as the client sees it. `can_group_with_output_ids` is Roon's own
// answer to "what may this be grouped with" — it isn't in the vendored SDK's
// JSDoc but it is part of the Output object on the wire. When the Core doesn't
// send it we return null, which the client reads as "unknown, offer everything"
// rather than "nothing is groupable".
/** @param {any} o */
function outputInfo(o) {
  return {
    output_id:    o.output_id,
    zone_id:      o.zone_id || null,
    display_name: o.display_name || "",
    can_group_with_output_ids: Array.isArray(o.can_group_with_output_ids)
      ? o.can_group_with_output_ids.slice()
      : null,
    source_controls: sourceControls(o)
  };
}

// An output's source controls — Roon's handle on the physical device behind it:
// the amp or DAC that can be put into standby, or switched to its Roon input.
//
// Only controls we can actually DO something with are returned. A control with
// no `control_key` can't be addressed individually, and Roon's toggle_standby
// is defined per control, so a keyless control would render a power button that
// silently does nothing. `supports_standby` is Roon's own answer for the power
// half; the convenience-switch half needs no capability flag.
/** @param {any} o @returns {any[]} */
function sourceControls(o) {
  const list = Array.isArray(o && o.source_controls) ? o.source_controls : [];
  return list
    .filter((/** @type {any} */ sc) => sc && sc.control_key)
    .map((/** @type {any} */ sc) => ({
      control_key:      sc.control_key,
      display_name:     sc.display_name || o.display_name || "",
      // 'selected' | 'deselected' | 'standby' | 'indeterminate'. Anything we
      // don't recognise reads as indeterminate: the UI then offers the action
      // without claiming to know the current state.
      status:           ["selected", "deselected", "standby"].includes(sc.status)
        ? sc.status : "indeterminate",
      supports_standby: !!sc.supports_standby
    }));
}

/**
 * @param {{ get: Function }} app
 * @param {{ core: () => any, zones: () => Record<string, any>, outputs: () => Record<string, any>,
 *           zoneSettings: (zone: any) => { shuffle: boolean, loop: string, auto_radio: boolean },
 *           noteLibraryClient: () => void, creditLinks: (credit: string) => any,
 *           phoneFormat?: (zone: any) => ({ kind: "opus" | "lossless", text: string } | null) }} d
 *   phoneFormat: what a phone's zone is hearing (lib/phone/devices.js formatFor), for Now playing's badge
 *   zones, outputs: index.js's, replaced whole when the Core goes or comes, so read anew on every request
 */
function mountZoneReads(app, d) {
  app.get("/api/zones", (/** @type {any} */ req, /** @type {any} */ res) => {
    const list = Object.values(d.zones()).map(z => ({
      zone_id:      z.zone_id,
      display_name: z.display_name,
      state:        z.state,
      settings:     d.zoneSettings(z),
      outputs: (z.outputs || []).map(outputInfo)
    })).sort((a, b) => a.display_name.localeCompare(b.display_name));
    res.json({ zones: list });
  });

  // Every output the Core knows about, for the zone-grouping sheet. Served from
  // the outputs cache (subscribe_outputs), falling back to the outputs carried by
  // the zone feed so this still answers on a Core that never subscribed us.
  app.get("/api/outputs", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    const src = Object.keys(d.outputs()).length
      ? Object.values(d.outputs())
      : Object.values(d.zones()).reduce((acc, z) => acc.concat(z.outputs || []), []);
    const zoneName = (zid) => (d.zones()[zid] && d.zones()[zid].display_name) || "";
    const list = src.map(o => Object.assign(outputInfo(o), { zone_name: zoneName(o.zone_id) }))
                    .sort((a, b) => a.display_name.localeCompare(b.display_name));
    res.json({ outputs: list });
  });

  app.get("/api/zone-state", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    // The wall display polls this, and only this, every 2 s — and its library
    // grids play by snapshot offset, so a display on the wall counts as someone
    // looking (the library watch; the app itself is noticed via /api/live).
    d.noteLibraryClient();
    const zoneId = req.query.zone;
    const zone   = zoneId && d.zones()[zoneId];
    if (!zone) return res.json({ zone: null });

    const np = zone.now_playing || null;
    const tl = (np && np.three_line) || {};
    const ol = (np && np.one_line)   || {};

    res.json({
      zone: {
        zone_id:             zone.zone_id,
        display_name:        zone.display_name,
        state:               zone.state,  // "playing" | "paused" | "loading" | "stopped"
        is_play_allowed:     !!zone.is_play_allowed,
        is_pause_allowed:    !!zone.is_pause_allowed,
        is_next_allowed:     !!zone.is_next_allowed,
        is_previous_allowed: !!zone.is_previous_allowed,
        is_seek_allowed:     !!zone.is_seek_allowed,
        // Shuffle / repeat / Roon Radio, so the now-playing screen can show the
        // zone's real state instead of guessing from its own last write.
        settings:            d.zoneSettings(zone),
        // How much is queued behind the current track. With the track itself
        // and shuffle, this is how an open Queue tab knows its list has changed
        // (v1.8.65) — a track ending, something queued from Roon's own app,
        // Roon Radio topping up — without subscribing to the queue on every
        // 1.5s poll. null when the Core does not say.
        queue_items_remaining: Number.isFinite(zone.queue_items_remaining) ? zone.queue_items_remaining : null,
        outputs: (zone.outputs || []).map(o => ({
          output_id:    o.output_id,
          display_name: o.display_name,
          is_muted:     !!o.is_muted,
          volume:       o.volume ? {
            value:      o.volume.value,
            min:        o.volume.min,
            max:        o.volume.max,
            step:       o.volume.step,
            soft_limit: o.volume.soft_limit,
            type:       o.volume.type
          } : null
        })),
        now_playing: np ? {
          line1:     tl.line1 || ol.line1 || "",   // track
          line2:     tl.line2 || "",               // artist
          line3:     tl.line3 || "",               // album
          // line2 split into individually linkable artists, the same
          // library-validated way /api/album splits an album credit — so the
          // now-playing screen can offer the artist links the album view has.
          // Memoised (creditLinks), because this endpoint is polled every 1.5s by
          // every open client and the same credit repeats for a whole album.
          //
          // `linkable` says whether the library can actually open a screen for
          // that name. It matters here and not on the album view because line2 is
          // the TRACK artist: on a compilation most track artists have no album
          // of their own, and linking them all would be a row of dead ends.
          artists:   d.creditLinks(tl.line2),
          image_key: np.image_key || null,
          length:    np.length || null,
          seek_position: np.seek_position || null,
          // What a phone's zone is hearing (v1.9.72-t11, Mandarin's badge): { kind: "opus" | "lossless", text } or null.
          format:    d.phoneFormat ? d.phoneFormat(zone) : null
        } : null
      }
    });
  });
}

module.exports = { mountZoneReads, outputInfo, sourceControls };
