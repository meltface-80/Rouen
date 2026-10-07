"use strict";
// ---------------------------------------------------------------------------
// The modulator and dither guide's advice. Ported from hqpweb
// (apps/web/src/lib/advice/{policy,catalogue,modulator,dither,pairs,variants,
// list-notes}.ts, main at 525f8d7), MIT, (c) 2026 statelycurmudgeon — see
// ./LICENSE. hqpweb works this out in the browser; here it is worked out on
// the server beside the rules it reads, as the picker hints are, and the page
// only shows the answer.
//
// THE RULES ARE DATA. Every piece of advice cites a post by Jussi Laako
// (Signalyst's developer) or HQPlayer's manual, paraphrased, 2025–26 posts
// preferred (hqpweb's review: 5 Oct 2026, across his 2025–26 posts in five Roon
// threads). The logic below only reads RULES and POLICY, so a correction from
// Signalyst is an edit to them, never to the logic. Names are always resolved
// against the HQPlayer's own list, never assumed.
// ---------------------------------------------------------------------------

const roon = (topicPost) => "https://community.roonlabs.com/t/" + topicPost;

/** { text, url?, source?, date: "YYYY-MM" } per rule. */
const RULES = {
  // ---- Modulators ----
  default: { text: "HQPlayer's default is Signalyst's general-purpose choice.", url: roon("322881/64"), date: "2026-08" },
  olderEssFifth: { text: "Fifth order for older ESS chips; a guide, not absolute.", url: roon("261032/1422"), date: "2026-09" },
  ampFifth: { text: "Fifth order with a class-D or tube amplifier.", url: roon("132298/2953"), date: "2025-10" },
  p512Volume: {
    text: "512+fs is an option at DSD512 and up when HQPlayer's volume is turned well down: more headroom, less bandwidth.",
    url: roon("292696/10"),
    date: "2025-07",
  },
  gainOpt: {
    text: "Gain optimisation: HQPlayer at −3 dB, the amplifier at the loudest you'd ever want, then turn down in HQPlayer or Roon. Safe from too-loud accidents.",
    url: roon("308411/22"),
    date: "2025-10",
  },
  dsd1024Ahm: {
    text: "If you run DSD1024, use AHM; neither it nor the EC line at DSD256/512 is clearly better.",
    url: roon("132298/2731"),
    date: "2025-07",
  },
  ahm4b: { text: "On HQPlayer 6.1, start with the new 4B versions.", url: roon("325365/6"), date: "2026-09" },
  variantsEqual: {
    text: "The four EC variants are one quality tier; they differ in character.",
    url: roon("166213/2101"),
    date: "2026-01",
  },
  rateEss: { text: "DSD512 suits ESS chips best.", url: roon("304268/153"), date: "2026-06" },
  // ---- What each modulator variant is like (variants.ts) ----
  ulPi: { text: "Ultralight: a Raspberry Pi 5 runs it at DSD256.", url: roon("244327/2165"), date: "2025-09" },
  ulEss: { text: "To Signalyst's ear, it has something of an ESS-like character.", url: roon("261032/1034"), date: "2025-07" },
  lightDesign: {
    text: "Designed to use as little CPU as possible with no compromise in technical performance.",
    url: roon("166213/730"),
    date: "2023-05",
  },
  fastTransients: { text: 'Think "fast transients"; only a bit heavier than -light.', url: roon("166213/2099"), date: "2026-01" },
  superDesign: { text: "Made as good as possible without regard to CPU load.", url: roon("166213/730"), date: "2023-05" },
  superFit: { text: "Signalyst sees it suiting some systems, or classical music.", url: roon("261032/1034"), date: "2025-07" },
  ahm4bNew: {
    text: "Newest AHM, made to get the most out of DSD1024 and up.",
    source: "HQPlayer 6.1 release notes",
    date: "2026-09",
  },
  ecAt1024: {
    text: "At DSD1024, modulators other than AHM need a high-clock CPU; AHM is a lighter way there.",
    url: roon("306780/13"),
    date: "2025-09",
  },
  ahm8bLight: { text: "AHM7EC8B isn't heavy to process, even at DSD1024.", url: roon("132298/2650"), date: "2025-06" },
  akmPairRate: {
    text: "The AK4191 pair (AK4499EX) runs at DSD128 or DSD256; higher rates only hurt.",
    url: roon("244358/1306"),
    date: "2025-12",
  },
  ampRate: {
    text: "DSD512 cuts leftover ultrasonic noise further, for class-D amplifiers.",
    url: roon("301074/8"),
    date: "2025-06",
  },
  olderGen: {
    text: "The older EC versions use more CPU for less; the newest EC line is the one to use.",
    url: roon("261032/976"),
    date: "2025-06",
  },
  basicGen: {
    text: "The newest EC line is a big step up in quality from these, and not much heavier.",
    url: roon("166213/2165"),
    date: "2026-06",
  },
  rateDirect: {
    text: "DSD256 is the sweet spot for direct-DSD DACs, or DSD1024 with AHM.",
    url: roon("304268/174"),
    date: "2026-08",
  },
  usePcm: { text: "This DAC converts or filters DSD, so PCM output suits it better.", url: roon("304268/29"), date: "2025-08" },
  // ---- Dither ----
  ladderShapers: {
    text: "For a ladder DAC: LNS15, NS9 or NS5; Signalyst lists them as equals.",
    url: roon("278907/31"),
    date: "2025-02",
  },
  ladderAt384: { text: "At 352.8 and 384 kHz, NS5 or NS9.", url: roon("244327/2505"), date: "2026-03" },
  ladderRate: { text: "Ladder DACs do best at 705.6 kHz or higher.", url: roon("278907/31"), date: "2025-02" },
  flatDither: { text: "TPDF or Gauss1, as equals.", url: roon("261032/1070"), date: "2025-08" },
  i2sBits: { text: "Over I2S, set DAC Bits to what the DAC takes.", source: "HQPlayer manual 5.13, §4.4", date: "2025-05" },
  ladderBits: {
    text: "DAC Bits low for a ladder: 20 for Holo and Denafrips; 18 or less without a measurement. Round down.",
    url: roon("172052/19"),
    date: "2025-01",
  },
  neverNone: { text: 'Never "none": PCM output distorts without dither.', url: roon("289922/253"), date: "2026-02" },
  dsdBetter: {
    text: "On delta-sigma DACs that take DSD well, DSD output usually beats PCM.",
    url: roon("311401/28"),
    date: "2025-12",
  },
  holoDsd: {
    text: "With Holo, DSD output gives the best results; PCM at 705.6k and up is 10–20 dB behind.",
    url: roon("166213/2023"),
    date: "2025-09",
  },
  // ---- Both ----
  headroom: { text: "Keep HQPlayer's volume at −3 dB or lower.", url: roon("289536/11"), date: "2025-01" },
  speed: {
    text: "Judge the machine by HQPlayer's processing speed: above 1×, though that's no guarantee.",
    url: roon("244327/2454"),
    date: "2026-03",
  },
};

/** The numbers and mappings the rules use. */
const POLICY = {
  /** Answers that move the order to fifth. Everything else gets seventh. */
  fifthOrderFor: { dsd: ["older-ess"], amp: ["class-d-or-tube"] },
  /** The DSD rate that suits each DSD answer (null: use PCM). */
  rateFor: { "older-ess": "DSD512", remodulates: "DSD512", direct: "DSD256", converts: null },
  /** 512+fs versions are suggested from this rate up (DSD512, 44.1k or 48k family). */
  p512FromHz: 22_579_200,
  /** AHM from this rate up (the manual's floor, 40.96 MHz: DSD1024 in either family). */
  ahmFromHz: 40_960_000,
  /** Which AHM to start with, in order of preference, by suffix. 6.1 lists 4B; 5.x lists 8B. */
  ahmPreference: ["EC4B", "EC8B"],
  /** The EC line's variants, lightest first. "fast" is HQPlayer's default. */
  variants: ["ul", "light", "fast", "super"],
  defaultVariant: "fast",
  /** Dither: noise shaping helps a ladder DAC from this rate up; LNS15 from the second. */
  ladderShapingFromHz: 352_800,
  lns15FromHz: 705_600,
  /** Processing speed: below `behind` it's falling behind; below `tight` it's only just keeping up. */
  speed: { behind: 1, tight: 1.5 },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
/** "2025-08" → "Aug 2025". */
function monthLabel(yyyyMm) {
  const [y, m] = String(yyyyMm).split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y ? name + " " + y : String(yyyyMm);
}
/** "2026-10-05" → "5 Oct 2026". */
function dayLabel(yyyyMmDd) {
  const day = Number(String(yyyyMmDd).slice(8, 10));
  return day ? day + " " + monthLabel(String(yyyyMmDd).slice(0, 7)) : String(yyyyMmDd);
}
/** A rule as the page shows it: its text, and who said it when ("Jussi, Aug 2025"), linked. */
const cite = (r) => Object.assign({}, r, { cite: r.url ? "Jussi, " + monthLabel(r.date) : r.source || "" });

const includes = (list, v) => v !== undefined && list.includes(v);

// ---- the lists, grouped (catalogue.ts) --------------------------------------
// By family, newest first, the older series folded. A name the rules do not
// know goes in a section of its own, so nothing HQPlayer offers is ever hidden.

const FAMILY_TESTS = [
  ["new", /^ASDM[57]EC-(ul|light|fast|super)( 512\+fs)?$/],
  ["ahm", /^AHM[57]EC(5L|8B|4B)$/],
  ["amsdm", /^AMSDM7(EC)? 512\+fs$/],
  ["olderEc", /^(DSD5EC|ASDM[57]EC(v[23])?)$/],
  ["basic", /^(DSD[57](v2)?( 256\+fs)?|ASDM[57])$/],
];
const FAMILY_TITLES = {
  new: "Newest EC line",
  ahm: "AHM, for DSD1024 and up",
  amsdm: "AMSDM, pseudo-multi-bit",
  olderEc: "Older EC series",
  basic: "Basic",
};
const FAMILY_OPEN = { new: true, ahm: true, amsdm: false, olderEc: false, basic: false };
const FAMILY_NOTES = { olderEc: RULES.olderGen, basic: RULES.basicGen };

function modulatorFamily(name) {
  const hit = FAMILY_TESTS.find(([, re]) => re.test(name));
  return hit ? hit[0] : null;
}
/** A modulator's order, from its name (ASDM7…, AHM5…); null when the name does not say. */
function orderOf(name) {
  const m = /^[A-Z]+([57])/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Sections for the modulator list: [{ key, title, names, open, note? }]. With
 * an order from the setup answers, each family shows that order and the other
 * order goes in its own folded section at the end; AHM shows both, since the
 * DSD1024 choice differs by amplifier.
 */
function groupModulators(names, order) {
  const mine = (n) => order === null || modulatorFamily(n) === "ahm" || orderOf(n) === order;
  const sections = Object.keys(FAMILY_TITLES).map((f) => Object.assign({
    key: f,
    title: FAMILY_TITLES[f],
    names: names.filter((n) => modulatorFamily(n) === f && mine(n)),
    open: FAMILY_OPEN[f],
  }, FAMILY_NOTES[f] ? { note: FAMILY_NOTES[f] } : {}));
  const unknown = names.filter((n) => modulatorFamily(n) === null);
  if (unknown.length) sections.push({ key: "unknown", title: "Newer than the guide's advice", names: unknown, open: true });
  if (order !== null) {
    const other = names.filter((n) => modulatorFamily(n) !== null && !mine(n));
    sections.push({ key: "other", title: order === 7 ? "Fifth order" : "Seventh order", names: other, open: false });
  }
  return sections.filter((s) => s.names.length);
}

const DITHER_GROUPS = [
  ["flat", "Flat dither", ["TPDF", "Gauss1"], true],
  ["shape", "Noise shaping, for ladder DACs", ["LNS15", "NS9", "NS5"], true],
  ["more", "More", ["NS4", "shaped", "NS1", "RPDF"], false],
  ["never", "Not for listening", ["none"], true],
];

/** Sections for the dither list; names HQPlayer lists but the guide does not know go in "More". */
function groupDithers(names) {
  const known = new Set([].concat(...DITHER_GROUPS.map((g) => g[2])));
  return DITHER_GROUPS.map(([key, title, ns, open]) => ({
    key,
    title,
    names: ns.filter((n) => names.includes(n)).concat(key === "more" ? names.filter((n) => !known.has(n)) : []),
    open,
  })).filter((s) => s.names.length);
}

// ---- modulator advice (modulator.ts) ----------------------------------------

/** Names the rules know: the EC line, AHM, AMSDM, and the older series. */
const KNOWN =
  /^(DSD[57](v2)?( 256\+fs)?|DSD5EC|ASDM[57](EC(v[23])?)?|ASDM[57]EC-(ul|light|fast|super)( 512\+fs)?|AMSDM7(EC)? 512\+fs|AHM[57]EC(5L|8B|4B))$/;

function machineState(speed) {
  if (speed === null || speed === undefined || !Number.isFinite(speed) || speed <= 0) return null;
  const state = speed < POLICY.speed.behind ? "behind" : speed < POLICY.speed.tight ? "tight" : "keeps-up";
  return { state, rule: RULES.speed };
}

/**
 * Modulator advice from the setup answers, the rate (Hz) and the modulators
 * this HQPlayer lists. status: needs-dac (the DSD question is unanswered),
 * use-pcm (the DAC converts DSD), ok. See hqpweb's ModulatorAdvice for every field.
 */
function modulatorAdvice(input) {
  const setup = input.setup || {};
  const rateHz = input.rateHz || 0;
  const modulators = input.modulators;
  const has = (n) => modulators.includes(n);
  const order = includes(POLICY.fifthOrderFor.dsd, setup.dsd) || includes(POLICY.fifthOrderFor.amp, setup.amp) ? 5 : 7;
  const unknown = modulators.filter((n) => !KNOWN.test(n));
  const machine = machineState(input.processSpeed === undefined ? null : input.processSpeed);
  const empty = {
    order, suggestedRate: null, start: null, alternatives: [],
    p512: { offered: false, suggested: false }, unknown, machine, rateKnown: rateHz > 0,
  };
  if (!setup.dsd) return Object.assign({ status: "needs-dac" }, empty);

  const rate = POLICY.rateFor[setup.dsd];
  const direct = setup.dsd === "direct";
  const ampRate = direct && includes(POLICY.fifthOrderFor.amp, setup.amp);
  const rateRules = direct
    ? [RULES.rateDirect].concat(ampRate ? [RULES.ampRate] : [])
    : [RULES.rateEss].concat(setup.dsd === "remodulates" ? [RULES.akmPairRate] : []);
  // A DAC that converts DSD: PCM suits it better, but anyone staying in DSD
  // still gets a starting point (informing, not refusing).
  const suggestedRate = rate ? { label: rate, orDsd1024: direct, orDsd512: ampRate, rules: rateRules } : null;

  const rules = [];
  if (setup.dsd === "older-ess") rules.push(RULES.olderEssFifth);
  if (includes(POLICY.fifthOrderFor.amp, setup.amp)) rules.push(RULES.ampFifth);

  const p512Offered = rateHz >= POLICY.p512FromHz;
  const p512Suggested = p512Offered && setup.volume === "hqplayer";
  const base = "ASDM" + order + "EC";
  const ec = (v, p512) => base + "-" + v + (p512 ? " 512+fs" : "");
  // The EC family at this rate, in its regular versions. 512+fs is offered,
  // never the start: HQPlayer's volume as the main control is not a setup to
  // steer people to (RULES.gainOpt).
  const p512Option = p512Suggested ? [ec(POLICY.defaultVariant, true)].filter(has) : [];
  const family = POLICY.variants.map((v) => ec(v, false)).filter(has);

  let start = null;
  if (rateHz >= POLICY.ahmFromHz) {
    const ahm = POLICY.ahmPreference.map((s) => "AHM" + order + s).find(has);
    if (ahm) start = { name: ahm, isDefault: false, rules: [RULES.dsd1024Ahm].concat(ahm.endsWith("EC4B") ? [RULES.ahm4b] : [], rules) };
  }
  if (!start) {
    const name = ec(POLICY.defaultVariant, false);
    if (has(name)) {
      const isDefault = name === "ASDM7EC-" + POLICY.defaultVariant;
      start = { name, isDefault, rules: isDefault ? [RULES.default] : rules };
    }
  }
  let alternatives;
  if (start && start.name.startsWith("AHM")) {
    const other = order === 5 ? 7 : 5;
    const ahm = [].concat(...[order, other].map((o) => POLICY.ahmPreference.map((s) => "AHM" + o + s)));
    alternatives = ahm.filter((n) => n !== start.name && has(n)).map((name) => ({ name }));
  } else {
    alternatives = p512Option.concat(family.filter((n) => !start || n !== start.name)).map((name) => ({ name }));
  }
  return {
    status: setup.dsd === "converts" ? "use-pcm" : "ok",
    order, suggestedRate, start, alternatives,
    p512: { offered: p512Offered, suggested: p512Suggested },
    unknown, machine, rateKnown: rateHz > 0,
  };
}

// ---- dither advice (dither.ts) ------------------------------------------------
// A ladder DAC at the shaping rate and up gets noise shaping (NS5 or NS9 at
// 352.8/384k; LNS15, NS9 or NS5 from 705.6k, LNS15 being built for those
// rates); everything else gets TPDF or Gauss1 as equals. Never "none".

function ditherAdvice(input) {
  const setup = input.setup || {};
  const rateHz = input.rateHz || 0;
  const listed = (names) => names.filter((n) => input.shapers.includes(n));
  const takesDsd = setup.dsd === "older-ess" || setup.dsd === "remodulates" || setup.dsd === "direct";
  const tryDsd = setup.pcm === "delta-sigma" && takesDsd ? RULES.dsdBetter
    : setup.pcm === "ladder" && setup.dsd === "direct" ? RULES.holoDsd : null;
  if (!setup.pcm) return { status: "needs-dac", group: [], start: null, rules: [], bits: null, raiseRate: false, tryDsd: null };

  const ladder = setup.pcm === "ladder";
  const bits = ladder ? { kind: "ladder", rule: RULES.ladderBits }
    : setup.link === "spdif" ? { kind: "24", rule: null }
    : setup.link === "i2s" ? { kind: "match", rule: RULES.i2sBits }
    : { kind: "default", rule: null };

  if (ladder && rateHz <= 0) return { status: "needs-rate", group: [], start: null, rules: [], bits, raiseRate: false, tryDsd };
  if (ladder && setup.link !== "spdif" && rateHz >= POLICY.ladderShapingFromHz) {
    const high = rateHz >= POLICY.lns15FromHz;
    const group = listed(high ? ["LNS15", "NS9", "NS5"] : ["NS5", "NS9"]);
    return { status: "ok", group, start: group[0] || null, rules: [high ? RULES.ladderShapers : RULES.ladderAt384], bits, raiseRate: false, tryDsd };
  }
  const group = listed(["TPDF", "Gauss1"]);
  // Not over S/PDIF: it tops out around 192k, so there is no higher rate to go to.
  const raiseRate = ladder && setup.link !== "spdif" && rateHz < POLICY.ladderShapingFromHz;
  return {
    status: "ok", group, start: group[0] || null,
    rules: [raiseRate ? RULES.ladderRate : RULES.flatDither], bits, raiseRate, tryDsd,
  };
}

// ---- rate and modulator together (pairs.ts) -----------------------------------
// For each DSD rate this HQPlayer lists, the starting point the guide gives at
// that rate, and whether the rate suits the DAC: rate and modulator are one
// decision (AHM only at DSD1024 and up), so the guide offers them as pairs and
// applies each as one change.

const DSD_RATES = [
  { label: "DSD256", hz: 11289600 },
  { label: "DSD512", hz: 22579200 },
  { label: "DSD1024", hz: 45158400 },
];

function modulatorPairs(input) {
  const pairs = [];
  for (const r of DSD_RATES) {
    if (!input.rates.includes(r.hz)) continue;
    const a = modulatorAdvice(Object.assign({}, input, { rateHz: r.hz }));
    if (a.status === "needs-dac" || !a.start) continue;
    // At DSD1024 only AHM: the EC line does not suit that rate (Signalyst).
    if (r.label === "DSD1024" && !a.start.name.startsWith("AHM")) continue;
    const s = a.suggestedRate;
    const suitsDac = !!s && (s.label === r.label || (s.orDsd512 && r.label === "DSD512") || (s.orDsd1024 && r.label === "DSD1024"));
    pairs.push({ label: r.label, rateHz: r.hz, start: a.start, suitsDac });
  }
  // The rates that suit the DAC first; otherwise lowest rate first.
  return pairs.filter((p) => p.suitsDac).concat(pairs.filter((p) => !p.suitsDac));
}

// ---- what each modulator is like (variants.ts) --------------------------------
// CPU load and character as Signalyst has described them, each cited.
// Character choices, not a ranking: all four EC variants are one quality tier.

const EC_NOTES = {
  ul: { load: "lightest", rules: [RULES.ulPi, RULES.ulEss] },
  light: { load: "light", rules: [RULES.lightDesign] },
  fast: { load: "a bit more than -light", rules: [RULES.fastTransients] },
  super: { load: "heaviest", rules: [RULES.superDesign, RULES.superFit] },
};

/** { load, rules } for a modulator, or null where nothing is documented. */
function variantNote(name) {
  const ec = /^ASDM[57]EC-(ul|light|fast|super)( 512\+fs)?$/.exec(name);
  if (ec) return EC_NOTES[ec[1]] || null;
  if (/^AHM[57]EC4B$/.test(name)) return { load: null, rules: [RULES.ahm4bNew] };
  if (/^AHM[57]EC8B$/.test(name)) return { load: "light", rules: [RULES.ahm8bLight] };
  return null;
}

/** AHM's floor (manual): DSD1024 and up. */
const DSD1024_HZ = 40960000;

/**
 * Heavy by Signalyst's word, not by this machine: the EC line at DSD1024
 * needs a high-clock CPU. Information shown before the change, never a refusal.
 */
function heavyAt(name, rateHz) {
  return rateHz >= DSD1024_HZ && /^(ASDM|DSD|AMSDM)/.test(name) ? RULES.ecAt1024 : null;
}

// ---- the list's notes (list-notes.ts) -----------------------------------------
// The picker's soft notes paraphrase HQPlayer's manual; the guide follows
// Signalyst's newer posts, and the two can disagree (the manual pairs NS9 with
// 176.4/192k, while a 2026 post offers it for ladder DACs at 384k). On a row
// the guide recommends for your answers, the guide's reason wins over the soft
// note. Warnings (won't play here, failed here before) are never dropped.

const GUIDE_NOTE = "Suits your answers: see Guide";
const NOT_WITH_VOLUME = "Not with HQPlayer's volume (manual §4.5)";
const AHM_5L = /^AHM[57]EC5L$/;

/** On a row the guide recommends, the guide's reason replaces a soft note. */
function withGuideNotes(rows, recommended) {
  return rows.map((r) => (recommended.has(r.name) && !r.warn && r.note ? Object.assign({}, r, { note: GUIDE_NOTE }) : r));
}

/**
 * The manual (5.13 §4.5) does not recommend the five-level AHM versions when
 * HQPlayer's volume is the main control; it says nothing of the kind about 8B
 * or 4B. So when the listener says HQPlayer sets the volume, those rows say
 * so. A warning still wins.
 */
function withVolumeNotes(rows, setup) {
  if (setup.volume !== "hqplayer") return rows.slice();
  return rows.map((r) => (AHM_5L.test(r.name) && !r.warn ? Object.assign({}, r, { note: NOT_WITH_VOLUME }) : r));
}

/**
 * The list as narrowed by a search and the "only what plays here" chip:
 * names that match the query (any case), minus the hidden ones. A search
 * opens the sections it matches in, folded or not; sections left empty go.
 * (The page narrows its own copy as you type; this is the rule it follows.)
 */
function narrowSections(sections, query, hide) {
  const q = String(query || "").trim().toLowerCase();
  if (!q && hide.size === 0) return sections;
  return sections
    .map((s) => Object.assign({}, s, { names: s.names.filter((n) => !hide.has(n) && (!q || n.toLowerCase().includes(q))), open: s.open || !!q }))
    .filter((s) => s.names.length);
}

module.exports = {
  RULES, POLICY, DSD_RATES, monthLabel, dayLabel, cite,
  modulatorFamily, orderOf, groupModulators, groupDithers,
  modulatorAdvice, ditherAdvice, modulatorPairs, variantNote, heavyAt,
  withGuideNotes, withVolumeNotes, narrowSections, GUIDE_NOTE, NOT_WITH_VOLUME,
};
