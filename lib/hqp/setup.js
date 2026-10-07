"use strict";
// ---------------------------------------------------------------------------
// "Your setup": what the modulator and dither guide needs to know and
// HQPlayer cannot tell it — how the DAC takes DSD and converts PCM, the
// amplifier, the volume, the connection. Kept per HQPlayer on the data volume
// (hqp-setup.json). The questions and their wording are hqpweb's
// (apps/web/src/lib/setup-questions.ts, setup-answers.ts, and
// apps/server/src/setup.ts, main at 525f8d7), MIT, (c) 2026 statelycurmudgeon —
// see ./LICENSE.
// ---------------------------------------------------------------------------

const { HttpError, loadList, saveJson } = require("./store");
const { RULES } = require("./advice");

/** The answers each question allows, in the order they are offered. */
const SETUP_ANSWERS = {
  dsd: ["older-ess", "remodulates", "direct", "converts"],
  pcm: ["delta-sigma", "ladder"],
  amp: ["class-d-or-tube", "other", "unsure"],
  link: ["usb", "spdif", "i2s"],
  volume: ["hqplayer", "fixed"],
};

function question(key, q, labels) {
  return Object.assign({ key }, q, {
    options: SETUP_ANSWERS[key].map((value) => Object.assign({ value }, labels[value])),
  });
}

const SETUP_QUESTIONS = {
  dsd: question("dsd", {
    title: "How your DAC takes DSD",
    question: "What does your DAC do with DSD?",
    help: "This sets the order and the rate.",
    notSet: "Modulator advice stays off until you choose.",
  }, {
    "older-ess": { label: "An older ESS chip", description: "ES9018, ES9028, ES9038 (any version) or ES9068. Fifth order; DSD512 suits it." },
    remodulates: {
      label: "A newer ESS chip, or another DAC that re-processes DSD",
      description: "ES9039 and later, the AK4191 pair, PS Audio. Seventh order; DSD512 for ESS.",
    },
    direct: {
      label: "DSD goes straight to the converter",
      description: "Burr-Brown/TI, ROHM, Holo and other discrete DSD, AKM in DSD Direct mode. Seventh order; DSD256, or DSD1024 with AHM.",
    },
    converts: {
      label: "It converts or filters DSD, or doesn't take it",
      description: "Chord, Denafrips, Weiss, Schiit multibit. PCM output suits it better.",
    },
  }),
  pcm: question("pcm", {
    title: "How your DAC converts PCM",
    question: "How does your DAC convert PCM?",
    help: "This decides whether noise shaping helps.",
    notSet: "Dither advice stays off until you choose.",
  }, {
    "delta-sigma": {
      label: "Delta-sigma",
      description: "A converter chip from ESS, AKM, Burr-Brown or Cirrus, or a design that resamples everything, like Chord or dCS.",
    },
    ladder: { label: "Ladder (R2R) or multibit", description: 'A resistor-ladder design; makers say so prominently, often as "R2R".' },
  }),
  amp: question("amp", {
    title: "Your amplifier",
    question: "Is your power amplifier class-D or tube?",
    help: "Class-D and tube amplifiers cope less well with ultrasonic noise, so Signalyst suggests fifth order with them.",
    source: RULES.ampFifth,
    notSet: "",
  }, {
    "class-d-or-tube": { label: "Yes", description: "Class-D or tube power amplifier." },
    other: { label: "No", description: "Any other kind." },
    unsure: { label: "Not sure", description: "Keeps HQPlayer's default." },
  }),
  volume: question("volume", {
    title: "Your volume",
    question: "Do you set the volume in HQPlayer?",
    help: "Signalyst suggests gain optimisation: HQPlayer at −3 dB, the amplifier at the loudest you'd ever want, then turn down " +
          "in HQPlayer or Roon. That keeps you safe from too-loud accidents. Never above −3 dB.",
    source: RULES.gainOpt,
    notSet: "",
  }, {
    hqplayer: { label: "Yes", description: "HQPlayer is my volume control (Roon's slider included), ideally with gain optimisation." },
    fixed: { label: "No", description: "I keep HQPlayer at about −3 dB, or on its fixed volume." },
  }),
  link: question("link", {
    title: "How the DAC connects",
    question: "How does the signal reach your DAC?",
    help: "USB is best where the DAC has it. S/PDIF and AES carry 24 bits and top out around 192 kHz; I2S is rarely worth it over USB.",
    notSet: "Used for dither advice.",
  }, {
    usb: { label: "USB or network", description: "Into the DAC's USB input, or over the network to an NAA." },
    spdif: { label: "S/PDIF, AES or optical", description: "Including a USB-to-S/PDIF bridge." },
    i2s: { label: "I2S", description: "Over HDMI-style or RJ45 I2S links." },
  }),
};

/** The questions in Settings' order. */
const SETUP_QUESTION_LIST = ["dsd", "pcm", "amp", "volume", "link"].map((k) => SETUP_QUESTIONS[k]);

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A change to the answers: a value sets one, null clears it, a missing key leaves it alone. Strict. */
function parseSetupPatch(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!own(SETUP_ANSWERS, k)) throw new HttpError(400, 'unknown setup question "' + k + '"');
    if (v !== null && !SETUP_ANSWERS[k].includes(v))
      throw new HttpError(400, '"' + k + '" must be one of ' + SETUP_ANSWERS[k].join(", ") + ", or null");
    out[k] = v;
  }
  return out;
}

/** The answers, per HQPlayer. file null = memory only (tests). */
class SetupStore {
  constructor(file) {
    this.file = file || null;
    this.rows = this.file ? loadList(this.file, "setups") : [];
    // Anything a later version (or a hand edit) left that this one does not
    // know is dropped on load, so the guide never reads a value it cannot handle.
    this.rows = this.rows.filter((r) => r && typeof r.instance === "string" && r.setup && typeof r.setup === "object")
      .map((r) => ({ instance: r.instance, setup: clean(r.setup) }));
  }
  get(instance) {
    const r = this.rows.find((x) => x.instance === instance);
    return r ? Object.assign({}, r.setup) : {};
  }
  update(instance, patch) {
    const next = this.get(instance);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    this.rows = this.rows.filter((x) => x.instance !== instance);
    if (Object.keys(next).length) this.rows.push({ instance, setup: next });
    this.save();
    return Object.assign({}, next);
  }
  /** Every answer kept for one HQPlayer or DAC (it is being removed). */
  forget(instance) {
    const before = this.rows.length;
    this.rows = this.rows.filter((x) => x.instance !== instance);
    if (this.rows.length !== before) this.save();
  }
  save() {
    if (this.file) saveJson(this.file, { setups: this.rows });
  }
}

function clean(setup) {
  const out = {};
  for (const k of Object.keys(SETUP_ANSWERS)) if (own(setup, k) && SETUP_ANSWERS[k].includes(setup[k])) out[k] = setup[k];
  return out;
}

module.exports = { SETUP_ANSWERS, SETUP_QUESTIONS, SETUP_QUESTION_LIST, parseSetupPatch, SetupStore };
