// @ts-check
"use strict";
/*
 * dsp-parts.js — N3-5a (dev/design/native-remote.md §15.12, v1.9.66-t12): a DSP item's settings, read from its part as
 * the graph holds it — Headroom (HeadroomAdjustmentItem), Crossfeed (BS2BItem), Sample rate conversion
 * (SampleRateConversionItem and its SampleRateConversionRules) — and the table of what each setting sends and how it
 * is checked. Pure: no call, nothing sent (dsp-settings.js sends).
 *
 * Each part is pushed whole, a setting at its default left out (§15.12, the owner's recording): a gain absent is 0 dB,
 * a clipping indicator absent is off, a rule's output absent is the input's own rate.
 */
const { BinaryWriter } = require("./wire");
const { field, isRef } = require("./objects");

/** The object a member names, held, or null. @param {any} graph @param {any} o @param {string} name */
function named(graph, o, name) {
  const v = field(o, name);
  const x = isRef(v) ? graph.get(v.$ref) : null;
  return x && x.loaded ? x : null;
}
/**
 * A list member's items, as the graph holds the list; the value alone when the list isn't held, so it can still be
 * shown (and kept), never a choice guessed.
 * @param {any} graph @param {any} o @param {string} name @param {any} current
 */
function listOf(graph, o, name, current) {
  const l = named(graph, o, name);
  const items = l && Array.isArray(l.fields.$items) ? l.fields.$items.filter((/** @type {any} */ x) => typeof x === "string" || typeof x === "number") : [];
  if (current !== undefined && current !== null && !items.includes(current)) items.push(current);
  return items;
}
/** A number, or the default the server leaves out. @param {any} v @param {number} d */
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * An item's settings, by its part, as held; null for a part this build has none for (or not held).
 * @param {any} graph @param {any} item  the DspConfigItem
 * @returns {any}
 */
function settingsOf(graph, item) {
  const head = named(graph, item, "HeadroomAdjustment");
  if (head) {
    return { kind: "headroom", part: String(head.oid),
      gain: num(field(head, "GainDb"), 0), min: num(field(head, "MinGainDb"), -30), max: 0, canGain: field(head, "SupportsGainDb") === true,
      clipping: field(head, "ClippingIndicator") === true, canClipping: field(head, "SupportsClippingIndicator") === true };
  }
  const bs2b = named(graph, item, "BS2B");
  if (bs2b) {
    const preset = field(bs2b, "Preset");
    return { kind: "crossfeed", part: String(bs2b.oid),
      preset: typeof preset === "string" ? preset : null, presets: listOf(graph, bs2b, "SupportedPresets", preset), canPreset: field(bs2b, "SupportsPreset") === true,
      cut: num(field(bs2b, "CutFrequency"), 0), cutMin: num(field(bs2b, "MinCutFrequency"), 0), cutMax: num(field(bs2b, "MaxCutFrequency"), 0),
      canCut: field(bs2b, "SupportsCutFrequency") === true,
      feed: num(field(bs2b, "FeedLevelDb"), 0), feedMin: num(field(bs2b, "MinFeedLevelDb"), 0), feedMax: num(field(bs2b, "MaxFeedLevelDb"), 0),
      canFeed: field(bs2b, "SupportsFeedLevelDb") === true };
  }
  const src = named(graph, item, "SampleRateConversion");
  if (src) {
    const s = (/** @type {string} */ k) => { const v = field(src, k); return typeof v === "string" ? v : null; };
    const canRules = field(src, "SupportsSampleRateConversionRules") === true;
    const rulesList = named(graph, src, "SampleRateConversionRules");
    // every rule, or none: a list cut short (fewer items than its count) or a rule not yet held is not all of them
    // (the review), said as rulesComplete false rather than shown as if it were
    const held = canRules && rulesList && Array.isArray(rulesList.fields.$items) && rulesList.fields.$items.length === rulesList.fields.$count
      ? rulesList.fields.$items.map((/** @type {any} */ r) => (isRef(r) ? graph.get(r.$ref) : null)) : null;
    const rulesComplete = !!held && held.every((/** @type {any} */ o) => o && o.loaded);
    const rules = rulesComplete ? /** @type {any[]} */ (held).map((/** @type {any} */ o) => {
      const out = field(o, "OutputSampleRate");
      return { id: String(o.oid), input: num(field(o, "InputSampleRate"), 0), output: typeof out === "number" ? out : null,
        outputs: listOf(graph, o, "SupportedOutputSampleRates", typeof out === "number" ? out : undefined) };
    }) : [];
    return { kind: "src", part: String(src.oid),
      mode: s("SampleRateConversionMode"), modes: listOf(graph, src, "SupportedSampleRateConversionModes", s("SampleRateConversionMode")),
      canMode: field(src, "SupportsSampleRateConversionMode") === true,
      filter: s("SRCFilterType"), filters: listOf(graph, src, "SupportedSRCFilterType", s("SRCFilterType")), canFilter: field(src, "SupportsSRCFilterType") === true,
      dsdToPcm: s("DsdToPcmFilter"), dsdToPcms: listOf(graph, src, "SupportedDsdToPcmFilterValues", s("DsdToPcmFilter")),
      canDsdToPcm: field(src, "SupportsDsdToPcmFilter") === true, canRules, rulesComplete: canRules && rulesComplete, rules };
  }
  return null;
}

/** A number on the 0.1 grid, within bounds. @param {any} v @param {number} lo @param {number} hi */
const onGrid = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9 && Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
const w = () => new BinaryWriter();

/**
 * Each setting: the part it is on, what it sends, whether a value may be sent (from what is held), and whether the
 * part, as held, shows it.
 * @type {Record<string, { kind: string, sig: string, args: (v: any) => Buffer, ok: (st: any, v: any) => string | null, shows: (st: any, v: any) => boolean }>}
 */
const SETTINGS = Object.freeze({
  "headroom.gain": { kind: "headroom", sig: "dspHeadroomGain", args: (v) => w().double(v).toBuffer(),
    ok: (st, v) => (!st.canGain ? "Your server doesn't let the gain be changed." : onGrid(v, st.min, st.max) ? null : `The gain is ${st.min} to ${st.max} dB.`),
    shows: (st, v) => Math.abs(st.gain - v) < 0.05 },
  "headroom.clipping": { kind: "headroom", sig: "dspHeadroomClipping", args: (v) => w().boolean(v).toBuffer(),
    ok: (st, v) => (!st.canClipping ? "Your server doesn't let the clipping indicator be changed." : typeof v === "boolean" ? null : "On or off."),
    shows: (st, v) => st.clipping === v },
  "crossfeed.preset": { kind: "crossfeed", sig: "dspCrossfeedPreset", args: (v) => w().string(v).toBuffer(),
    ok: (st, v) => (!st.canPreset ? "Your server doesn't let the preset be changed." : st.presets.includes(v) ? null : "Not one of your server's presets."),
    shows: (st, v) => st.preset === v },
  "crossfeed.cut": { kind: "crossfeed", sig: "dspCrossfeedCut", args: (v) => w().integer(v).toBuffer(),
    ok: (st, v) => (!st.canCut ? "The cut frequency can be changed with the custom preset only." : Number.isInteger(v) && v >= st.cutMin && v <= st.cutMax ? null : `The cut frequency is ${st.cutMin} to ${st.cutMax} Hz.`),
    shows: (st, v) => st.cut === v },
  "crossfeed.feed": { kind: "crossfeed", sig: "dspCrossfeedFeed", args: (v) => w().double(v).toBuffer(),
    ok: (st, v) => (!st.canFeed ? "The feed level can be changed with the custom preset only." : onGrid(v, st.feedMin, st.feedMax) ? null : `The feed level is ${st.feedMin} to ${st.feedMax} dB.`),
    shows: (st, v) => Math.abs(st.feed - v) < 0.05 },
  "src.mode": { kind: "src", sig: "dspSrcMode", args: (v) => w().string(v).toBuffer(),
    ok: (st, v) => (!st.canMode ? "Your server doesn't let the mode be changed." : st.modes.includes(v) ? null : "Not one of your server's modes."),
    // custom shown with its rules, all of them, so the answer can offer them (the review)
    shows: (st, v) => st.mode === v && (v !== "custom" || !st.canRules || st.rulesComplete) },
  "src.filter": { kind: "src", sig: "dspSrcFilter", args: (v) => w().string(v).toBuffer(),
    ok: (st, v) => (!st.canFilter ? "Your server doesn't let the filter be changed." : st.filters.includes(v) ? null : "Not one of your server's filters."),
    shows: (st, v) => st.filter === v },
  "src.dsdToPcm": { kind: "src", sig: "dspSrcDsdToPcm", args: (v) => w().string(v).toBuffer(),
    ok: (st, v) => (!st.canDsdToPcm ? "Your server doesn't let the DSD to PCM filter be changed." : st.dsdToPcms.includes(v) ? null : "Not one of your server's DSD to PCM filters."),
    shows: (st, v) => st.dsdToPcm === v },
});

/**
 * A rule's output sample rate (custom mode): an int, or null for the input's own rate — a nullable int, a presence byte
 * and the int (§15.12; §15.7's sleep timer, the same form).
 * @param {any} rule  as settingsOf reads it @param {any} v
 */
const RULE = Object.freeze({
  sig: "dspSrcRule",
  args: (/** @type {any} */ v) => (v === null ? w().integer(0) : w().integer(1).integer(v)).toBuffer(),
  ok: (/** @type {any} */ rule, /** @type {any} */ v) => (v === null || (Number.isInteger(v) && rule.outputs.includes(v)) ? null : "Not one of your server's rates for it."),
  shows: (/** @type {any} */ rule, /** @type {any} */ v) => rule.output === v,
});

module.exports = { settingsOf, SETTINGS, RULE };
