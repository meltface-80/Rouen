// @ts-check
"use strict";
/*
 * signal-path.js — the signal path on Now playing (dev/design/signal-path.md, v2.0.3-t15): a zone's SignalPath as the
 * connection holds it, said in plain terms — its quality, Roon's processing speed and each step in
 * playing order with its own quality, a name and what it does. Read only: nothing is asked of the server.
 *
 * The shape is the one the owner's reads of 2026-11-10 showed (native-remote.md §16.7): Zone.SignalPath, an object of
 * Quality, ProcessingSpeed, at times IsClipping, and Elements, a list object of SignalPathElement objects; each element
 * its Quality, a UniqueId and one part, an object hung on the member that names its kind (Source, Raat, Output, …).
 * The part's members are the catalogue's; one left out is left out here too, never guessed.
 *
 * Not said: IsClipping. A member back at its default is not sent, and the graph keeps what an object was last sent
 * (objects.js: only the types in IDENTITY are taken whole), so a clip once seen would be said for good; how Roon sends a
 * clip ending is not yet read (signal-path.md §5). Quality and ProcessingSpeed are sent with every path the reads saw.
 */
const { field, isRef, shortType, fullNameOf } = require("./objects");
const { readList } = require("./focus");
const { zoneById } = require("./zone-settings");

/** SignalPathQuality (the catalogue's): Inactive 0, LowQuality 1, HighQuality 2, Lossless 3, Enhanced 4, None 5. */
const QUALITY = Object.freeze(/** @type {Record<number, string>} */ ({ 1: "low", 2: "high", 3: "lossless", 4: "enhanced" }));
/** MediaSource (the catalogue's), as a source step names where its audio comes from. */
const SOURCES = Object.freeze(/** @type {Record<number, string>} */ ({ 1: "Library", 128: "TIDAL", 256: "Qobuz", 1024: "Hiro", 2048: "KKBOX", 4096: "nugs.net", 32: "iHeartRadio" }));
/** SignalPathElement's parts (the catalogue's, all 45): the member an element's one part hangs on names its kind. */
const PARTS = new Set(["Source", "UpgradeBitDepth", "VolumeNormalization", "CrossFade", "SampleRateConversion", "DsdSampleRateConversion",
  "MonoToStereo", "Truncate", "MQBRestore", "MQBPreserve", "Dither", "DigitalVolume", "HeadroomGain", "AnalogVolume", "Output", "DsdToPcm",
  "PcmToDsd", "DsdEncapsulate", "Raat", "HQPlayer", "DevialetAir", "SpeakerSetup", "ParametricEQ", "ProceduralEQ", "OpenHeadphones",
  "Loudness", "Upmixing", "Convolution", "ChannelMapping", "ChannelMixing", "Crossfeed", "EQ", "AudioDistribution", "InvertPhase",
  "DownmixToMono", "Balance", "Delay", "DSP", "WirelessTransmission", "WiredTransmission", "Amplifier", "MQA", "Wisa", "MultiBandEQ",
  "SpeakerPlacement"]);
/** OutputSignalPathElementType (the catalogue's), said as a person would. */
const OUTPUTS = Object.freeze(/** @type {Record<number, string>} */ ({ 0: "Meridian", 1: "AirPlay", 2: "Songcast", 3: "Roon Speakers",
  4: "Core Audio (shared)", 5: "Core Audio (exclusive)", 6: "WASAPI (shared)", 7: "WASAPI (exclusive)", 8: "Android (shared)",
  9: "Android (exclusive)", 10: "Local (lossless)", 11: "ASIO", 12: "Sonavox", 13: "RAAT", 14: "Squeezebox", 15: "ALSA", 16: "Digital",
  17: "Analogue", 18: "Analogue and digital", 19: "USB", 20: "Local", 21: "HQPlayer", 22: "AES", 23: "I2S", 24: "Sonos",
  25: "Ravenna", 26: "Speakers", 27: "Headphones", 28: "BluOS", 29: "Devialet", 30: "KEF", 31: "Core Audio (iOS)",
  32: "Songcast Direct", 33: "Chromecast", 34: "Android (exclusive)", 35: "Android (shared)", 36: "Bluetooth", 37: "MSB Pro ISL" }));
/** Formats heard as lossy: their bit rate says them, not a rate and depth. */
const LOSSY = /^(mp3|aac|m4a|ogg|vorbis|opus|wma|mqa-?lossy)$/i;

/** A finite number, or null. @param {any} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : null);
/** A non-empty string, or null. @param {any} v */
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A rate in kHz, as Roon says it: 44100 "44.1kHz", 192000 "192kHz"; under 1 kHz not a rate, so nothing. @param {number | null} hz */
const khz = (hz) => (hz && hz >= 1000 ? (hz >= 1e6 ? `${+(hz / 1e6).toFixed(1)}MHz` : `${+(hz / 1000).toFixed(1)}kHz`) : null);
/** Bits: "24-bit". @param {number | null} b */
const bits = (b) => (b && b > 0 ? `${b}-bit` : null);
/** A gain: "−0.8 dB", "+2.0 dB", rounded before its sign is chosen ("0.0 dB", never "−0.0"). @param {number | null} db */
const gain = (db) => { if (db === null) return null; const r = Math.round(db * 10) / 10; return `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toFixed(1)} dB`; };
/** "a → b", or what of it there is. @param {string | null} a @param {string | null} b */
const arrow = (a, b) => (a && b ? `${a} → ${b}` : a || b);
/** The parts said, those left out dropped. @param {(string | null)[]} parts */
const line = (parts) => parts.filter(Boolean).join(" · ") || null;
/** A member's name spaced: SpeakerSetup "Speaker Setup". @param {string} k */
const spaced = (k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

/**
 * What a source plays, as Roon says it: "FLAC 44.1kHz 16-bit"; a lossy one its bit rate, "AAC 256kbps"; DSD its rate,
 * "DSD 2.8MHz" (a DSD file's 1 bit not said).
 * @param {(name: string) => any} m  the part's member by name
 */
function sourceFormat(m) {
  const fmt = str(m("Format"));
  const name = fmt ? (fmt.length <= 4 ? fmt.toUpperCase() : fmt) : null;
  const rate = num(m("BitRate"));
  if (fmt && LOSSY.test(fmt)) return line([name && rate ? `${name} ${rate}kbps` : name]);
  const hz = num(m("SampleRate"));
  if ((fmt && /^(dsd|dsf|dff)$/i.test(fmt)) || (hz !== null && hz >= 1e6)) return hz && hz >= 1e6 ? `DSD ${khz(hz)}` : "DSD";
  return [name, khz(num(m("SampleRate"))), bits(num(m("BitsPerSample")))].filter(Boolean).join(" ") || null;
}

/**
 * Each kind of step: its name and what it says (signal-path.md §3.2). m reads the part's members; dev reads an object
 * the part names (a RAAT step's Device) by member.
 * @type {Record<string, (m: (k: string) => any, dev: (k: string, member: string) => any) => { name: string, text: string | null }>}
 */
const KINDS = {
  Source: (m) => {
    const ch = num(m("Channels"));
    const src = num(m("ContentSource"));
    return { name: "Source", text: line([sourceFormat(m), ch === 1 ? "Mono" : ch === 2 ? "Stereo" : ch ? `${ch} channels` : null,
      khz(num(m("MQASampleRate"))) ? `MQA ${khz(num(m("MQASampleRate")))}` : null, src !== null ? SOURCES[src] || null : null]) };
  },
  UpgradeBitDepth: (m) => ({ name: "Bit depth", text: arrow(bits(num(m("FromBitsPerSample"))), bits(num(m("ToBitsPerSample")))) }),
  Truncate: (m) => ({ name: "Truncation", text: arrow(bits(num(m("FromBitsPerSample"))), bits(num(m("ToBitsPerSample")))) }),
  MQBRestore: (m) => ({ name: "MQB restore", text: arrow(bits(num(m("FromBitsPerSample"))), bits(num(m("ToBitsPerSample")))) }),
  VolumeNormalization: (m) => ({ name: "Volume levelling", text: gain(num(m("GainDb"))) }),
  HeadroomGain: (m) => ({ name: "Headroom", text: gain(num(m("GainDb"))) }),
  DigitalVolume: (m) => ({ name: "Volume", text: gain(num(m("GainDb"))) }),
  AnalogVolume: (m) => ({ name: "Volume (analogue)", text: gain(num(m("GainDb"))) }),
  SampleRateConversion: (m) => ({ name: "Sample rate conversion", text: arrow(khz(num(m("FromSampleRate"))), khz(num(m("ToSampleRate")))) }),
  DsdSampleRateConversion: (m) => ({ name: "DSD rate conversion", text: arrow(khz(num(m("FromSampleRate"))), khz(num(m("ToSampleRate")))) }),
  PcmToDsd: (m) => ({ name: "PCM to DSD", text: line([arrow(khz(num(m("FromSampleRate"))), khz(num(m("ToSampleRate")))), str(m("Modulator"))]) }),
  DsdToPcm: (m) => ({ name: "DSD to PCM", text: arrow(khz(num(m("FromSampleRate"))), khz(num(m("ToSampleRate")))) }),
  Crossfeed: (m) => ({ name: "Crossfeed", text: str(m("Description")) }),
  ParametricEQ: (m) => { const n = num(m("FilterCount")); return { name: "Parametric EQ", text: line([n !== null ? `${n} filter${n === 1 ? "" : "s"}` : null, str(m("PresetName"))]) }; },
  ProceduralEQ: (m) => { const n = num(m("FilterCount")); return { name: "Procedural EQ", text: n !== null ? `${n} filter${n === 1 ? "" : "s"}` : null }; },
  EQ: (m) => ({ name: "EQ", text: gain(num(m("GainDb"))) }),
  MultiBandEQ: (m) => ({ name: "EQ", text: str(m("PresetName")) }),
  Convolution: (m) => { const t = num(m("TapCount")); return { name: "Convolution", text: t !== null ? `${t} taps` : null }; },
  CrossFade: (m) => { const ms = num(m("Milliseconds")); return { name: "Crossfade", text: ms !== null ? `${ms} ms` : null }; },
  Delay: (m) => { const ms = num(m("DelayMs")); return { name: "Delay", text: ms !== null ? `${ms} ms` : null }; },
  Balance: (m) => ({ name: "Balance", text: str(m("StringValue")) }),
  ChannelMapping: (m) => ({ name: "Channel mapping", text: str(m("Description")) }),
  ChannelMixing: (m) => ({ name: "Channel mixing", text: str(m("Description")) }),
  Dither: (m) => { const b = bits(num(m("SignificantBits"))); return { name: "Dither", text: b ? `to ${b}` : null }; },
  HQPlayer: (m) => ({ name: "HQPlayer", text: line([str(m("Filter")), str(m("Shaper")), khz(num(m("Rate")))]) }),
  Raat: (m, dev) => {
    const name = str(dev("Device", "VendorModel")) || str(dev("Device", "Name"));
    return { name: "RAAT", text: arrow(name, str(dev("Device", "BridgedDeviceName"))) };
  },
  Output: (m) => { const t = num(m("OutputType")); return { name: "Output", text: line([str(m("Model")), t !== null ? OUTPUTS[t] || null : null]) }; },
};

/**
 * One element of the path: its quality and its one part, said by KINDS (any other kind by its member's name alone). A part
 * named and not yet pushed: the step by its name alone (the review: else the step was dropped), its line when it comes.
 * @param {any} graph @param {any} el  a SignalPathElement object
 */
function stepOf(graph, el) {
  const quality = num(field(el, "Quality"));
  for (const k of Object.keys(el.fields)) {
    const v = el.fields[k];
    const kind = k.slice(k.lastIndexOf("::") + 2);
    if (k.startsWith("$") || !isRef(v) || !PARTS.has(kind)) continue;
    const part = graph.get(v.$ref);
    const held = !!part && part.loaded && /SignalPathElement$/.test(shortType(part.typeName));
    const m = (/** @type {string} */ name) => (held ? field(part, name) : undefined);
    const dev = (/** @type {string} */ name, /** @type {string} */ member) => {
      const r = m(name), o = isRef(r) ? graph.get(r.$ref) : null;
      return o && o.loaded ? field(o, member) : undefined;
    };
    const said = KINDS[kind] ? KINDS[kind](m, dev) : { name: spaced(kind), text: null };
    return { kind, quality: quality !== null ? QUALITY[quality] || null : null, name: said.name, text: said.text,
      format: kind === "Source" ? sourceFormat(m) : null };
  }
  return null;
}

/**
 * A zone's signal path in plain terms, or null when it holds none (none sent, never pushed, its elements unread).
 * @param {any} graph @param {any} zone  a Zone object of the graph
 * format: what the source plays, as Now playing's button says it ("FLAC 44.1kHz 16-bit"), or null.
 * @returns {{ quality: string | null, speed: number | null, format: string | null, steps: { kind: string, quality: string | null, name: string, text: string | null }[] } | null}
 */
function pathOf(graph, zone) {
  const sp = field(zone, "SignalPath");
  const path = isRef(sp) ? graph.get(sp.$ref) : null;
  if (!path || !path.loaded) return null;
  const els = field(path, "Elements");
  /** @type {any[] | null} */
  let items = null;
  if (isRef(els)) {
    const list = graph.get(els.$ref);
    if (list && list.loaded && Array.isArray(list.fields.$items)) items = list.fields.$items;
  } else if (Buffer.isBuffer(els)) {
    const list = readList(graph, fullNameOf(path.fields, "Elements"), els);
    if (list) items = list.items;
  }
  if (!items) return null;
  const steps = [];
  let format = null;
  for (const x of items) {
    const el = isRef(x) ? graph.get(x.$ref) : null;
    const step = el && el.loaded ? stepOf(graph, el) : null;
    if (step) steps.push(step);
    if (step && step.kind === "Source" && format === null) format = step.format;
  }
  const q = num(field(path, "Quality"));
  return { quality: q !== null ? QUALITY[q] || null : null, speed: num(field(path, "ProcessingSpeed")),
    format, steps: steps.map(({ kind, quality, name, text }) => ({ kind, quality, name, text })) };
}

/**
 * @param {{ link: { session(): any } | null, on: () => boolean }} deps
 *   link: the connection to the server; on: native mode switched on
 */
function createSignalPath(deps) {
  return {
    /**
     * One zone's signal path, the zone named by the official API's zone_id.
     * @param {string} zoneId
     */
    read(zoneId) {
      if (!deps.on()) return { native: false, why: "Native mode is off." };
      const s = deps.link ? deps.link.session() : null;
      if (!s || !s.graph) return { native: false, why: "Rouen has no connection to your server open now." };
      const want = String(zoneId).toLowerCase();
      const z = zoneById(s.graph, want);
      if (!z) return { native: true, found: false, zone_id: want };
      return { native: true, found: true, zone_id: want, path: pathOf(s.graph, z) };
    },
  };
}

module.exports = { createSignalPath, pathOf, stepOf, sourceFormat, QUALITY, OUTPUTS, SOURCES };
