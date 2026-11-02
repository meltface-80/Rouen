// @ts-check
"use strict";
/*
 * zones.js — the catch-up player's zone, kept out of Rouen's own (dev/design/android-app.md §4.22, v1.9.72-t56). Roon
 * lists "Rouen catch-up" among its zones, as it must to count its plays, but it is Rouen's bookkeeping, not a room: it
 * never enters index.js's `zones`, so nothing in Rouen lists it, takes it as a default zone, runs Random Album Radio on
 * it, scrobbles it or shows it to Shortcuts. It is kept apart here, for the catch-up alone (the owner, 2026-10-31:
 * "invisible to the Rouen App").
 */
const { isCatchupZone } = require("./player");

function createCatchupZones() {
  /** @type {any} */
  let zone = null;
  return {
    /**
     * Whether Roon's zone [z] goes into Rouen's zones: false for the catch-up's, which is kept apart. A zone with the
     * catch-up's id under another name (renamed in Roon) is an ordinary zone from then on.
     * @param {any} z
     */
    keep(z) {
      if (isCatchupZone(z)) { zone = z; return false; }
      if (zone && z && z.zone_id === zone.zone_id) zone = null;
      return true;
    },
    /** Roon removed the zone [zid]. @param {string} zid */
    removed(zid) { if (zone && zone.zone_id === zid) zone = null; },
    /** The Core went, or Roon's zones are read afresh. */
    reset() { zone = null; },
    /** The catch-up's zone as Roon last gave it, or null (not joined, or not enabled in Roon yet). */
    current() { return zone; },
  };
}

module.exports = { createCatchupZones };
