"use strict";
// ---------------------------------------------------------------------------
// What the HQPlayer screen's pickers say beside each choice: "won't play"
// where HQPlayer's own rules predict a stop, "failed here before" where this
// machine learned one, and a softer note where a choice works but is outside
// what the manual recommends — plus, since v1.8.78, HQPlayer's own guide to
// each filter (its rating out of 5, what it favours, its ratio rule, whether
// it apodizes) and each modulator's generation.
//
// Ported from hqpweb's web app (apps/web/src/lib/hints.ts, 0.1.0-beta.2 +
// 65b3888), MIT, (c) 2026 statelycurmudgeon — see ./LICENSE. hqpweb works
// this out in the browser; here it is worked out on the server, beside the
// rules it reads, so the page carries no copy of them to drift.
// ---------------------------------------------------------------------------

const {
  MODULATOR_NOTE, compatibleRates, ditherHint, filterNotes, filterSlot, isApodizing, modulatorGen, modulatorHint, ratioHint,
} = require("./compat");

const nameAt = (list, i) => {
  const hit = (list || []).find((x) => x.index === i);
  return hit ? hit.name : "";
};

/**
 * The context the hints were worked out in. The guards (wedge,
 * otherSourceNotes) are refreshed only when this moves, so anything they read
 * must be in it. The page compares it with each
 * status it receives and asks again when it moves — a new track at another
 * rate, a different filter in effect, another mode, another queued track.
 */
function hintsKey(snap) {
  if (!snap) return "";
  const st = snap.state;
  const source = snap.status.source ? snap.status.source.sampleRate : 0;
  return [st.mode, source, snap.queuedRate || 0, snap.status.activeRate, st.rate, st.filter1x, st.filterNx, st.shaper].join("|");
}

/** The filter slot in use: "1x" below a 50 kHz source, "Nx" above; null when stopped. */
function slotInUse(snap) {
  if (!snap || snap.status.state === 0) return null;
  const sr = snap.status.source ? snap.status.source.sampleRate : 0;
  if (sr) return filterSlot(sr);
  return snap.state.filterInUse === snap.state.filter1x ? "1x" : "Nx";
}

/** What every hint needs to know about this HQPlayer right now. */
function context(caps, snap) {
  const status = snap.status;
  const state = snap.state;
  // A track that cannot start leaves Status blank (measured), so the queue is the only clue.
  const source = (status.source && status.source.sampleRate) || snap.queuedRate || 0;
  const fixedRate = (state.rate || 0) !== 0;
  const fixed = fixedRate ? caps.rates.find((r) => r.index === state.rate) : null;
  const shaperName = nameAt(caps.shapers, state.shaper);
  return {
    caps,
    snap,
    isSdm: caps.mode.name.startsWith("SDM"),
    source,
    fixedRate,
    // The configured rate when fixed (active_rate can be stale while stopped), else what is active.
    outRate: (fixed && fixed.rate) || status.activeRate || 0,
    // HQPlayer 6 describes each filter and modulator; v5 describes nothing.
    described: caps.filters.some((f) => f.description),
    shapersDescribed: caps.shapers.some((s) => s.description),
    combo: {
      mode: caps.mode.name,
      rateHz: status.activeRate,
      filterNx: nameAt(caps.filters, state.filterNx),
      filter1x: nameAt(caps.filters, state.filter1x),
      shaper: shaperName,
    },
    shaperName,
  };
}

/** HQPlayer's own ratio class for a filter when it gives one (v6), else the manual's. */
function ratioOf(c, name) {
  const f = c.caps.filters.find((x) => x.name === name);
  const n = filterNotes(name, f ? f.description : undefined, c.isSdm, c.described);
  return n ? n.ratio : undefined;
}

function learnedWarn(c, field, value) {
  const k = Object.assign({}, c.combo, { [field]: value });
  const f = (c.caps.knownBad || []).find((x) => x.mode === k.mode && x.rateHz === k.rateHz &&
    x.filterNx === k.filterNx && x.filter1x === k.filter1x && x.shaper === k.shaper);
  return f ? "failed here before at these settings (" + f.reason + ")" : undefined;
}

/** Output rates that fit `filter` from the current source, nearest first marked. */
function rateOptions(c, filter) {
  return compatibleRates({
    filter,
    sourceRate: c.source,
    rates: c.caps.rates.filter((r) => r.allowed).map((r) => r.rate),
    sdm: c.isSdm,
    shaper: c.shaperName,
    currentRate: c.outRate,
    given: ratioOf(c, filter),
  });
}

/**
 * { filter1x: {name: hint}, filterNx: {...}, shaper: {...} }, sparse: a name
 * with nothing to say is left out. A hint may carry:
 *   warn       learned failure, or (shapers) a rule that predicts a stop
 *   blocked    (filters) the ratio rule this filter cannot meet at the fixed
 *              rate, with `rates`: the output rates that would fit
 *   note       softer advice
 *   rating, tags, ratioText   HQPlayer's own guide (v6), or v6's for the name (v5)
 *   apodizing  true | false | "partial", from HQPlayer 6's table
 *   gen        (SDM modulators) the design generation
 */
function pickerHints(caps, snap) {
  const out = { filter1x: {}, filterNx: {}, shaper: {} };
  if (!caps || !snap) return out;
  const c = context(caps, snap);
  const put = (bucket, name, h) => {
    for (const k of Object.keys(h)) if (h[k] === undefined || h[k] === "") delete h[k];
    if (Object.keys(h).length) bucket[name] = h;
  };
  for (const slot of ["1x", "Nx"]) {
    const field = slot === "1x" ? "filter1x" : "filterNx";
    for (const f of caps.filters) {
      const info = filterNotes(f.name, f.description, c.isSdm, c.described);
      // Only with a FIXED output rate can a filter choice make the ratio
      // impossible; on auto, HQPlayer picks a rate the filter can do.
      const rule = c.source && c.fixedRate && filterSlot(c.source) === slot
        ? ratioHint(f.name, c.source, c.outRate, c.isSdm, info ? info.ratio : undefined) : undefined;
      const h = {
        warn: learnedWarn(c, field, f.name),
        note: rule && rule.level === "soft" ? rule.text : undefined,
        // Only a yes or a partly is worth sending: the map stays sparse.
        apodizing: isApodizing(f.name) || undefined,
      };
      if (rule && rule.level === "hard") {
        // The row already shows the name: "needs a power-of-two ratio; 44.1k → 192k is 4.35×".
        h.blocked = rule.text.replace(f.name + " ", "");
        h.rates = rateOptions(c, f.name);
      }
      if (info) {
        if (info.rating) h.rating = info.rating;
        if (info.tags.length) h.tags = info.tags;
        h.ratioText = info.ratioText;
      }
      put(out[field], f.name, h);
    }
  }
  for (const s of caps.shapers) {
    const rule = c.isSdm ? modulatorHint(s.name, c.outRate) : ditherHint(s.name, c.outRate);
    const extra = c.isSdm && Object.prototype.hasOwnProperty.call(MODULATOR_NOTE, s.name) ? MODULATOR_NOTE[s.name] : undefined;
    put(out.shaper, s.name, {
      warn: rule && rule.level === "hard" ? "won't play: " + rule.text : learnedWarn(c, "shaper", s.name),
      note: [extra, rule && rule.level === "soft" ? rule.text : undefined].filter(Boolean).join(" · "),
      gen: c.isSdm ? modulatorGen(s.name, s.description, c.shapersDescribed) : undefined,
    });
  }
  return out;
}

/**
 * A queued track that cannot start. Measured (6.2.3): Play is accepted,
 * nothing happens, and Status shows plain idle. null, or { slot, filter,
 * text, cause: "filter"|"modulator", rates? }.
 */
function wedge(c) {
  const snap = c.snap;
  if (snap.status.state === 2 || snap.status.source || !snap.queuedRate || !c.fixedRate) return null;
  const slot = filterSlot(snap.queuedRate) === "1x" ? "filter1x" : "filterNx";
  const filter = nameAt(c.caps.filters, snap.state[slot]);
  const r = ratioHint(filter, snap.queuedRate, c.outRate, c.isSdm, ratioOf(c, filter));
  if (r && r.level === "hard") return { slot, filter, text: r.text, cause: "filter", rates: rateOptions(c, filter) };
  const m = c.isSdm ? modulatorHint(c.shaperName, c.outRate) : undefined;
  if (m && m.level === "hard") return { slot, filter, text: m.text, cause: "modulator" };
  return null;
}

// The next album may be a different rate family. Typical source rates per slot.
const SOURCES = { filter1x: [44100, 48000], filterNx: [88200, 96000, 176400, 192000] };

/** Other source rates the current filters cannot play at a fixed output rate. */
function otherSourceNotes(c) {
  if (!c.fixedRate || !c.outRate) return [];
  const out = [];
  for (const slot of ["filter1x", "filterNx"]) {
    const name = nameAt(c.caps.filters, c.snap.state[slot]);
    // The source playing or queued is covered by the picker and the notice; this is about the others.
    const bad = SOURCES[slot].filter((src) => {
      if (src === c.source) return false;
      const r = ratioHint(name, src, c.outRate, c.isSdm, ratioOf(c, name));
      return !!(r && r.level === "hard");
    });
    if (bad.length) out.push(name + " won't play " + bad.map((b) => b / 1000 + "k").join(", ") + " sources");
  }
  return out;
}

/** The screen's guards, worked out beside the picker hints: { wedge, otherSources }. */
function guards(caps, snap) {
  if (!caps || !snap) return { wedge: null, otherSources: [] };
  const c = context(caps, snap);
  return { wedge: wedge(c), otherSources: otherSourceNotes(c) };
}

/**
 * HQPlayer's apodization counter (manual §2.6, its filter table): an
 * apodizing filter suits a track whose counter passes 10. "suggest" when the
 * filter in use is not one (or only partly), "handled" when it is, null at 10
 * or below.
 */
function apodization(apod, inUseApodizing) {
  if (!(apod > 10)) return null;
  return inUseApodizing === true ? "handled" : "suggest";
}

module.exports = { pickerHints, hintsKey, slotInUse, guards, apodization };
