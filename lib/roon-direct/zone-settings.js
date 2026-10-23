// @ts-check
"use strict";
/*
 * zone-settings.js — N3-3b (dev/design/native-remote.md §15.6, v1.9.66-t6): a zone's own settings, read from the
 * server's Zone as the connection holds it — crossfade, volume levelling and the sleep timer, which the official API
 * does not carry at all. Read only: nothing is asked of the server, nothing is changed.
 *
 * Each is a member of the whole Zone, absent at its default (§15.4, §15.5): CrossFade in seconds (absent: off);
 * VolumeLeveling (absent: off; 2 is Album, the owner's server; any other value is said as Roon's number, not named
 * by guess) with its target and default adjustment; the sleep timer as IsSleepTimerEnabled, the length last chosen
 * (SleepTimerDurationMinutes, kept when cancelled) and when it ends (SleepTimerExpiration, a .NET DateTime.ToBinary of
 * a UTC time). The graph drops what a whole Zone leaves out (objects.js), so what it holds is the zone as last sent.
 */
const { field } = require("./objects");

/** VolumeLeveling's values, by what the owner's server has shown (§15.5): only those proven are named. */
const LEVELING = Object.freeze(/** @type {Record<number, string>} */ ({ 2: "album" }));
/** .NET's ticks (100 ns) at 1970-01-01. */
const EPOCH_TICKS = 621355968000000000n;

/** A Sooid's bytes as the official API's id: hex, as transport finds a zone (§14.2). @param {any} v */
const hex = (v) => (Buffer.isBuffer(v) ? v.toString("hex") : null);
/** A finite number, or null. @param {any} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : null);

/**
 * A .NET DateTime.ToBinary() of a UTC time (bits 62–63 the Kind, 1 for UTC; the rest 100 ns ticks from 0001-01-01)
 * as an ISO time, or null for anything else: a local or unspecified time can't be placed without the server's zone.
 * @param {any} v  a bigint (as the graph reads a DateTime), or its decimal string
 */
function utcFromBinary(v) {
  let b;
  try { b = BigInt(v); } catch (e) { return null; }   // not a number: said as no time, never thrown into a read
  if (b < 0n || (b >> 62n) !== 1n) return null;
  const ms = (b & ((1n << 62n) - 1n)) - EPOCH_TICKS;
  return new Date(Number(ms / 10000n)).toISOString();
}

/**
 * A zone's settings as its Zone object holds them.
 * @param {any} z  a Zone object of the graph
 */
function settingsOf(z) {
  const fade = num(field(z, "CrossFade"));
  const lev = num(field(z, "VolumeLeveling"));
  const sleepOn = field(z, "IsSleepTimerEnabled") === true;
  const ends = sleepOn ? utcFromBinary(field(z, "SleepTimerExpiration")) : null;
  return {
    crossfade: { on: !!fade && fade > 0, seconds: fade && fade > 0 ? fade : 0 },
    leveling: { on: lev !== null && lev !== 0, mode: lev === null || lev === 0 ? "off" : LEVELING[lev] || null, value: lev ?? 0,
      target: num(field(z, "VolumeLevelingTargetLevel")), adjustment: num(field(z, "VolumeLevelingDefaultAdjustment")) },
    sleep: { on: sleepOn, minutes: num(field(z, "SleepTimerDurationMinutes")), ends },
  };
}

/**
 * @param {{ link: { session(): any } | null, on: () => boolean }} deps
 *   link: the connection to the server; on: native mode switched on
 */
function createZoneSettings(deps) {
  return {
    /**
     * One zone's settings, the zone named by the official API's zone_id.
     * @param {string} zoneId
     */
    read(zoneId) {
      if (!deps.on()) return { native: false, why: "Native mode is off." };
      const s = deps.link ? deps.link.session() : null;
      if (!s || !s.graph) return { native: false, why: "Rouen has no connection to your server open now." };
      const want = String(zoneId).toLowerCase();
      // A zone remade comes as a new object with the same ZoneId, and the old one is never forgotten (§15.5): the
      // newest is the last the graph took in (its objects keep the order they first came in), so the last match.
      const z = s.graph.ofType("Zone").filter((/** @type {any} */ o) => o.loaded && hex(field(o, "ZoneId")) === want).pop();
      if (!z) return { native: true, found: false, zone_id: want };
      return Object.assign({ native: true, found: true, zone_id: want }, settingsOf(z));
    },
  };
}

module.exports = { createZoneSettings, settingsOf, utcFromBinary, LEVELING };
