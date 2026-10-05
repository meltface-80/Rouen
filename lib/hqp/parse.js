"use strict";
// ---------------------------------------------------------------------------
// Typed views over HQPlayer replies. Ported from hqpweb
// (packages/protocol/src/parse.ts), MIT, (c) 2026 statelycurmudgeon — see
// ./LICENSE. Field names and meanings were measured on HQPlayer Desktop
// 5.32.5 (macOS) and 5.35.10 (Linux) unless a comment says otherwise.
// ---------------------------------------------------------------------------

/**
 * A reply's outcome: { kind: "ok" } | { kind: "none" } | { kind: "error", message }.
 * "none" is real: Set20kFilter and SetAdaptiveVolume reply with no `result` at
 * all (measured). An OK is not proof of anything either — read State back.
 */
function outcome(el) {
  const r = el.attrs.result;
  if (r === undefined) return { kind: "none" };
  if (r === "OK") return { kind: "ok" };
  return { kind: "error", message: el.text.trim() || r };
}

function num(el, key) {
  const raw = el.attrs[key];
  if (raw === undefined) throw new Error("<" + el.name + "> has no " + key);
  // Number("") is 0, and for volume that would read as 0 dB: full output.
  const n = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) throw new Error("<" + el.name + "> " + key + '="' + raw + '" is not a number');
  return n;
}

/**
 * Volume is a float in dB. macOS prints "-22", Linux "-28.00000000000000000"
 * (both measured). Never parse it as an integer: a client that did read 0 dB.
 */
const volumeDb = (el, key) => num(el, key || "volume");

/** 0 stopped, 1 paused, 2 playing, 3 stop requested. */
function playback(el) {
  const s = num(el, "state");
  if (s !== 0 && s !== 1 && s !== 2 && s !== 3) throw new Error("unknown playback state " + s);
  return s;
}

const flag = (el, key) => el.attrs[key] !== undefined && el.attrs[key] !== "0";

function parseInfo(el) {
  const a = el.attrs;
  return {
    name: a.name || "",
    product: a.product || "",
    platform: a.platform || "",
    // Major version only.
    version: a.version || "",
    // The real engine version, e.g. "5.32.5".
    engine: a.engine || "",
  };
}

/** Configured settings, as LIST INDICES (State). */
function parseState(el) {
  return {
    mode: num(el, "mode"),                 // index into GetModes
    activeMode: num(el, "active_mode"),    // the mode VALUE (-1 source, 0 PCM, 1 SDM), not an index
    rate: num(el, "rate"),                 // index into GetRates; 0 is auto
    activeRate: num(el, "active_rate"),
    filter1x: num(el, "filter1x"),
    filterNx: num(el, "filterNx"),
    filterInUse: num(el, "filter"),        // the filter running now; not a setting
    shaper: num(el, "shaper"),
    volume: volumeDb(el),
    invert: flag(el, "invert"),
    filter20k: flag(el, "filter_20k"),
    adaptive: flag(el, "adaptive"),
    convolution: flag(el, "convolution"),
    matrixProfile: el.attrs.matrix_profile || "",
    state: playback(el),
  };
}

function sourceOf(el) {
  const m = el.children.find((c) => c.name === "metadata");
  if (!m || m.attrs.samplerate === undefined) return null;
  // song is "Roon" when Roon feeds HQPlayer its stream (measured on both instances).
  return {
    sampleRate: num(m, "samplerate"),
    bits: Number(m.attrs.bits || 0),
    channels: Number(m.attrs.channels || 0),
    song: m.attrs.song || "",
  };
}

/** Live values, BY NAME (Status). */
function parseStatus(el) {
  return {
    state: playback(el),
    activeMode: el.attrs.active_mode || "",
    activeRate: num(el, "active_rate"),
    activeFilter: el.attrs.active_filter || "",
    activeShaper: el.attrs.active_shaper || "",
    // Bits per sample of the OUTPUT stream: measured 32 in PCM (Linux 5.35.10)
    // and 1 in SDM (macOS). The width of the output word, not the "DAC Bits"
    // setting (the dither level), which no control command reads. 0 when absent.
    activeBits: Number(el.attrs.active_bits || 0) || 0,
    volume: volumeDb(el),
    position: Number(el.attrs.position || 0),            // seconds, float
    length: Number(el.attrs.length || 0) || 0,           // 0 when unknown, e.g. a Roon stream (measured)
    // HQPlayer's own processing speed as a multiple of real time (measured on
    // 5.17.2 and 6.2.3: ~30 on light settings, 0 when stopped). null on
    // versions that do not report it (5.13 does not).
    processSpeed: el.attrs.process_speed === undefined ? null : Number(el.attrs.process_speed) || 0,
    // The apodization counter: how often the recording needed what an
    // apodizing filter corrects. The v5 manual (§4.6) advises an apodizing
    // filter once it passes 10 in a track. Per track.
    apod: Number(el.attrs.apod || 0) || 0,
    // The clip counter (inferred: overs it had to clip).
    clips: Number(el.attrs.clips || 0) || 0,
    track: Number(el.attrs.track || 0),
    tracksTotal: Number(el.attrs.tracks_total || 0),
    // From the <metadata> child, present while playing (measured). It decides
    // whether the 1x or the Nx filter is the one in use.
    source: sourceOf(el),
  };
}

const kids = (el, tag) => el.children.filter((c) => c.name === tag);

/**
 * The sample rate of the track HQPlayer would play next from its own
 * playlist: the current entry (Status `track`, 1-based) or else the first.
 * Measured on 6.2.3: a track that cannot start leaves Status with state 0,
 * track 0 and no metadata, while PlaylistGet still lists it with its rate.
 * null when the playlist is empty.
 */
function queuedRate(el, track) {
  const items = kids(el, "PlaylistItem");
  const it = items.find((c) => Number(c.attrs.index) === track) || items[0];
  const r = it ? Number(it.attrs.rate) : NaN;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** A fingerprint of HQPlayer's playlist, to tell when someone changed it. */
const playlistKey = (el) =>
  kids(el, "PlaylistItem").map((c) => (c.attrs.uri || c.attrs.song || "") + "@" + (c.attrs.rate || "")).join("|");

const parseModes = (el) =>
  kids(el, "ModesItem").map((c) => ({ index: num(c, "index"), name: c.attrs.name || "", value: num(c, "value") }));

// `arg` is opaque. It is NOT a reliable 1x/Nx flag: the Mac's active 1x and Nx
// filters both carry arg=1 (measured).
const parseFilters = (el) =>
  kids(el, "FiltersItem").map((c) => ({
    index: num(c, "index"),
    name: c.attrs.name || "",
    value: num(c, "value"),
    arg: Number(c.attrs.arg || 0),
    // HQPlayer 6 describes each filter for control apps, e.g. "5/5 timbre ⥮ Any".
    ...(c.attrs.description ? { description: c.attrs.description } : {}),
  }));

// HQPlayer 6 describes each SDM modulator by its design generation, "Gen8".
const parseShapers = (el) =>
  kids(el, "ShapersItem").map((c) => ({
    index: num(c, "index"),
    name: c.attrs.name || "",
    value: num(c, "value"),
    ...(c.attrs.description ? { description: c.attrs.description } : {}),
  }));

// Rates in Hz; 0 is auto.
const parseRates = (el) => kids(el, "RatesItem").map((c) => ({ index: num(c, "index"), rate: num(c, "rate") }));

/** max is -3 on the Mac and 0 on Linux (both measured). Clamp to it; never assume it. */
function parseVolumeRange(el) {
  return {
    min: volumeDb(el, "min"),
    max: volumeDb(el, "max"),
    enabled: flag(el, "enabled"),
    adaptive: flag(el, "adaptive"),
  };
}

/** <MatrixListProfiles> children are <MatrixProfile name="…"/> (an empty list measured). */
const parseMatrixProfiles = (el) => kids(el, "MatrixProfile").map((c) => c.attrs.name || "").filter(Boolean);

module.exports = {
  outcome, volumeDb, parseInfo, parseState, parseStatus,
  parseModes, parseFilters, parseShapers, parseRates, parseVolumeRange, parseMatrixProfiles,
  queuedRate, playlistKey,
};
