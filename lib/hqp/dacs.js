"use strict";
// ---------------------------------------------------------------------------
// "Find your DAC": which answers a DAC gives to the guide's two questions (how
// it takes DSD, how it converts PCM), with the evidence for each row. Ported
// from hqpweb (apps/web/src/lib/{dacs,dac-models,dac-table}.ts, main at
// 525f8d7), MIT, (c) 2026 statelycurmudgeon — see ./LICENSE. The table is
// hqpweb's, checked on 5 Oct 2026; corrections go to hqpweb, where it is
// kept, and arrive here with the next port.
//
// hqpweb's rules for these rows: a row goes in only when its chip or design
// and its DSD handling are confirmed from a source opened (the maker first,
// else a review or measurement), never guessed. Signalyst's advice is cited
// post by post, paraphrased, with what it is about; modulator advice keeps the
// principle (order, rate, 512+fs), never an older-series modulator's name,
// and is marked as possibly dated when a newer modulator release followed it.
// `ourReading` marks an answer that is hqpweb's judgement, not Signalyst's or
// the maker's.
// ---------------------------------------------------------------------------

const { monthLabel, dayLabel } = require("./advice");

const jussi = (topicPost, date, about, text) => ({ text, url: "https://community.roonlabs.com/t/" + topicPost, date, about });
const src = (url, kind, seen) => ({ url, kind, seen: seen || "opened" });
/** A source seen only in search results, with no page to link yet: a gap to fill. */
const unlinked = (label, kind) => ({ label, kind, seen: "search" });

const CHECKED = "2026-10-05";
const ISSUES = "https://github.com/statelycurmudgeon/hqpweb/issues/new?template=dac-table.md";

/**
 * Oldest first. 5.11.0 (2025-02-03) reworked EC-ul, -light and -super and
 * added EC-fast: any modulator advice before it may predate a better choice,
 * as Signalyst said of older posts. 6.1.0 (2026-09-22) added AHMxEC4B for
 * DSD1024 and up: AHM / DSD1024 advice before it may too.
 */
const CUTOVERS = [
  {
    since: "2025-02",
    label: "before 5.11's modulators",
    title: "Before HQPlayer 5.11 (Feb 2025) reworked the modulators: newer ones may suit better.",
    covers: () => true,
  },
  {
    since: "2026-09",
    label: "before 6.1's AHM 4B",
    title: "Before HQPlayer 6.1 (Sep 2026) added AHM 4B for DSD1024 and up: it may suit better.",
    covers: (a) => /AHM|DSD1024/.test(a.text),
  },
];

/** The release a piece of modulator advice predates (the oldest that applies), or null. */
function datedBy(a) {
  if (a.about !== "modulator") return null;
  return CUTOVERS.find((c) => c.covers(a) && a.date < c.since) || null;
}

const CHIP_FAMILIES = [
  {
    id: "ess-older",
    chips: "ESS ES9018, ES9028, ES9038 (Pro, Q2M), ES9068",
    dsd: "older-ess",
    pcm: "delta-sigma",
    advice: [
      jussi(
        "261032/1422",
        "2026-09",
        "modulator",
        "Up to the ES9038PRO, fifth order; from the ES9039 on, seventh. A guide, not absolute.",
      ),
      jussi(
        "261032/848",
        "2025-03",
        "modulator",
        "The ES9068 is the older generation, so fifth order, though seventh is also fine.",
      ),
    ],
  },
  {
    id: "ess-9039",
    chips: "ESS ES9039 (Pro, SPro, MSPro, Q2M) and newer",
    dsd: "remodulates",
    pcm: "delta-sigma",
    advice: [jussi("261032/1422", "2026-09", "modulator", "From the ES9039 on, seventh order.")],
  },
  {
    id: "akm",
    chips: "AKM AK4490, AK4493, AK4497, AK4499",
    dsd: "direct",
    pcm: "delta-sigma",
    note: "Direct only where the maker enabled DSD Direct mode; otherwise the chip re-modulates DSD.",
    advice: [jussi("160210/676", "2022-02", "modulator", "AKM converts with several elements, so seventh order suits it.")],
  },
  {
    id: "akm-split",
    chips: "AKM AK4191 + AK4499EX",
    dsd: "remodulates",
    pcm: "delta-sigma",
    note: "Direct DSD only at DSD128 or DSD256, and only where the maker implemented it correctly; otherwise the AK4191 re-modulates DSD.",
    advice: [
      jussi("244358/725", "2024-02", "hardware", "These DACs take direct DSD only at DSD128 or DSD256."),
      jussi("321542/67", "2026-06", "hardware", "Gustard A26, with current firmware, passes direct DSD correctly (measured)."),
    ],
  },
  {
    id: "burr-brown",
    chips: 'Burr-Brown (TI) PCM179x, iFi "True Native"',
    dsd: "direct",
    pcm: "delta-sigma",
    note: "When the DAC accepts DSD, it reaches the chip untouched. Some PCM179x DACs are PCM-only.",
    advice: [
      jussi("160210/676", "2022-02", "modulator", "Burr-Brown converts with several elements, so seventh order suits it."),
    ],
  },
  {
    id: "ladder-dsd",
    chips: "Resistor ladder with its own DSD path",
    dsd: "direct",
    pcm: "ladder",
    note: "Holo, Musician, Gustard R26, Topping Centaurus. Not Denafrips: measured filtering DSD (see its rows).",
  },
  {
    id: "ladder-pcm",
    chips: "Resistor ladder, PCM only",
    dsd: "converts",
    pcm: "ladder",
    note: "Schiit multibit, Sonnet Morpheus.",
  },
  {
    id: "resamplers",
    chips: "Designs that resample everything",
    dsd: "converts",
    pcm: "delta-sigma",
    note: "Chord, Weiss, Mola Mola.",
    advice: [
      jussi("239948/18", "2023-04", "hardware", "Chord DACs convert DSD to 705.6 or 768 kHz PCM, so sending DSD doesn't help."),
    ],
  },
];;

const DAC_MODELS = [
  {
    id: "benchmark-dac3",
    maker: "Benchmark",
    models: ["DAC3 B", "DAC3 L", "DAC3 HGC", "DAC3 DX"],
    chip: "ES9028PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    dsdMax: "DSD64 (DoP only)",
    sources: [
      src("https://benchmarkmedia.com/products/benchmark-dac3-b-digital-to-analog-audio-converter", "maker"),
      src("https://benchmarkmedia.com/products/benchmark-dac3-dx-digital-to-analog-audio-converter", "maker"),
    ],
  },
  {
    id: "chord",
    maker: "Chord",
    models: ["Mojo 2", "Hugo 2", "Qutest", "Hugo TT2", "DAVE"],
    chip: "FPGA pulse array",
    dsd: "converts",
    pcm: "delta-sigma",
    note: "Resamples everything.",
    advice: [
      jussi("261032/1070", "2025-08", "dither", "Mojo 2: TPDF or Gauss1 is a good choice; NS5, NS9 or LNS15 can be used too."),
      jussi("169369/27", "2023-03", "hardware", "Chord DACs convert DSD to PCM before their own modulator."),
    ],
    sources: [
      src("https://chordelectronics.co.uk/product/qutest/", "maker"),
      src("https://chordelectronics.co.uk/product/dave/", "maker"),
    ],
  },
  {
    id: "denafrips-ares-pontus-venus",
    maker: "Denafrips",
    models: ["Ares II", "Ares 12th-1", "Pontus II", "Venus II"],
    chip: "R2R ladder, with a separate DSD network",
    dsd: "converts",
    pcm: "ladder",
    dsdMax: "DSD1024 (USB)",
    note: "Accepts DSD up to DSD1024, but filters it: PCM suits it better.",
    advice: [
      jussi(
        "304268/29",
        "2025-08",
        "hardware",
        "Not bit-perfect for DSD: measured on his own Ares II, it filters DSD at about 35 or 60 kHz, so the modulator choice makes little difference.",
      ),
      jussi("172052/19", "2025-01", "dither", "DAC Bits 20, from his Ares II measurements."),
      jussi("6061/2315", "2022-02", "hardware", "His own Ares II plays up to 1.5 MHz PCM and DSD1024."),
    ],
    sources: [
      src(
        "https://www.soundstageaccess.com/index.php/equipment-reviews/1141-denafrips-ares-ii-digital-to-analog-converter",
        "review",
      ),
      src(
        "https://www.hifi-advice.com/blog/review/digital-reviews/spdif-dac-reviews/denafrips-ares-ii-pontus-ii-venus-ii-and-terminator-plus/",
        "review",
      ),
    ],
  },
  {
    id: "denafrips-terminator",
    maker: "Denafrips",
    models: ["Terminator"],
    chip: "R2R ladder, with a separate DSD network",
    dsd: "converts",
    pcm: "ladder",
    dsdMax: "DSD1024 (USB)",
    note: "Same advertised design as the Ares II, which filters DSD: PCM suits it better.",
    advice: [
      jussi(
        "304268/29",
        "2025-08",
        "hardware",
        "The Ares II, measured, filters DSD rather than passing it through; he says Denafrips describes all its models the same way.",
      ),
      jussi("172052/19", "2025-01", "dither", "DAC Bits 20, from his Ares II measurements."),
      jussi("244185/42", "2023-02", "dither", "PCM at the highest rate, with LNS15, NS9 or NS5."),
    ],
    sources: [
      src(
        "https://www.hifi-advice.com/blog/review/digital-reviews/spdif-dac-reviews/denafrips-ares-ii-pontus-ii-venus-ii-and-terminator-plus/",
        "review",
      ),
    ],
  },
  {
    id: "exasound-e32-mk2",
    maker: "exaSound",
    models: ["e32 Mk II"],
    chip: "ES9028PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    dsdMax: "DSD256",
    sources: [src("https://exasound.com/Products/e32MarkIIDAC.aspx", "maker")],
  },
  {
    id: "gustard-x16",
    maker: "Gustard",
    models: ["X16"],
    chip: "2× ES9068AS",
    dsd: "older-ess",
    pcm: "delta-sigma",
    dsdMax: "DSD512 (USB)",
    advice: [jussi("261032/848", "2025-03", "modulator", "The ES9068 is the older generation: fifth order.")],
    sources: [
      src("https://www.linsoul.com/products/gustard-dac-x16", "retailer", "search"),
      src("https://headfonics.com/gustard-x16-review/", "review", "search"),
    ],
  },
  {
    id: "gustard-x26-pro",
    maker: "Gustard",
    models: ["X26 Pro"],
    chip: "2× ES9038PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    dsdMax: "DSD512",
    sources: [
      src(
        "https://www.audiophonics.fr/en/dac-with-volume/gustard-x26-pro-balanced-dac-2x-es9038pro-xmos-bluetooth-50-mqa-32bit-768khz-dsd512-black-p-15096.html",
        "retailer",
        "search",
      ),
    ],
  },
  {
    id: "gustard-r26",
    maker: "Gustard",
    models: ["R26"],
    chip: "R2R ladder, with a separate 1-bit DSD path",
    dsd: "direct",
    pcm: "ladder",
    dsdMax: "DSD512 (USB), DSD1024 (I2S)",
    ourReading: true,
    advice: [jussi("234151/4", "2023-02", "modulator", "To an owner with hiss: fifth order at DSD256, or seventh at DSD512.")],
    sources: [src("https://hifigo.com/products/gustard-dac-r26-discrete-r2r", "retailer")],
  },
  {
    id: "holo-may-spring2",
    maker: "Holo Audio",
    models: ["May", "Spring 2"],
    chip: "R2R ladder, with a separate DSD network",
    dsd: "direct",
    pcm: "ladder",
    dsdMax: "DSD1024 (USB)",
    advice: [
      jussi("132298/2084", "2024-08", "modulator", "Seventh order is a good choice for DSD."),
      jussi("6061/1489", "2021-06", "dither", "For PCM, DAC Bits 20: measured on a Spring 2, advised for the May too."),
    ],
    sources: [
      src(
        "https://www.audiophonics.fr/en/dac-without-volume/holo-audio-may-level-2-balanced-r2r-dac-and-independent-power-supply-32bit-1536khz-dsd1024-p-15777.html",
        "retailer",
      ),
    ],
  },
  {
    id: "holo-spring3-cyan2",
    maker: "Holo Audio",
    models: ["Spring 3", "Cyan 2"],
    chip: "R2R ladder, with a separate DSD network",
    dsd: "direct",
    pcm: "ladder",
    dsdMax: "DSD1024 (USB)",
    note: "Signalyst's manual gives DAC Bits 20 for Holo's ladder DACs (Desktop 5.13, §4.4).",
    advice: [jussi("132298/2084", "2024-08", "modulator", "For Holo DACs, seventh order is a good choice for DSD.")],
    sources: [
      src(
        "https://www.audiophonics.fr/en/dac-without-volume/holo-audio-spring-3-level-2-balanced-r2r-dac-32bit-1536khz-dsd1024-p-15776.html",
        "retailer",
      ),
      src("https://www.audiophonics.fr/en/dac-without-volume/holo-audio-cyan-2-p-18584.html", "retailer"),
    ],
  },
  {
    id: "ifi",
    maker: "iFi",
    models: ["Zen DAC V2", "Zen DAC 3", "Neo iDSD 2", "Pro iDSD"],
    chip: "Burr-Brown, with a separate DSD path",
    dsd: "direct",
    pcm: "delta-sigma",
    dsdMax: "DSD256 (Zen DAC V2), DSD512 (Zen DAC 3, Neo iDSD 2)",
    sources: [
      src("https://ifi-audio.com/products/zen-dac-3/", "maker"),
      src("https://ifi-audio.com/products/neo-idsd-2/", "maker"),
    ],
  },
  {
    id: "matrix-x-sabre-pro",
    maker: "Matrix Audio",
    models: ["X-Sabre Pro"],
    chip: "ES9038PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    sources: [
      src(
        "https://www.audiophonics.fr/en/dac-with-volume/matrix-x-sabre-pro-dac-usb-i2s-es9038pro-32bit768khz-dsd1024-silver-p-11522.html",
        "retailer",
        "search",
      ),
    ],
  },
  {
    id: "matrix-element-x2-pure",
    maker: "Matrix Audio",
    models: ["Element X2 Pure"],
    chip: "2× ES9039PRO",
    dsd: "remodulates",
    pcm: "delta-sigma",
    note: "Some retailers list it as ES9038PRO; the maker says ES9039PRO.",
    sources: [src("https://www.matrix-digi.com/product/87/element_X2_Pure", "maker")],
  },
  {
    id: "merason-dac1-mk2",
    maker: "Merason",
    models: ["DAC-1 Mk II"],
    chip: "2× PCM1794A",
    dsd: "converts",
    pcm: "delta-sigma",
    note: "PCM only, up to 192 kHz.",
    sources: [
      src("https://en.merason.com/dac1", "maker"),
      src("https://pt.audio/2024/01/05/merason-dac-1-mk-ii-review/", "review"),
    ],
  },
  {
    id: "mola-mola-tambaqui",
    maker: "Mola Mola",
    models: ["Tambaqui"],
    chip: "Discrete PWM; resamples everything",
    dsd: "converts",
    pcm: "delta-sigma",
    sources: [src("https://www.mola-mola.nl/tambaqui.php", "maker")],
  },
  {
    id: "musician-pegasus",
    maker: "Musician",
    models: ["Pegasus", "Pegasus II"],
    chip: "R2R ladder, with a separate DSD ladder",
    dsd: "direct",
    pcm: "ladder",
    dsdMax: "DSD1024",
    ourReading: true,
    advice: [jussi("132298/39", "2021-02", "dither", "For PCM, DAC Bits 14 or 15, with a noise shaper at the highest rate.")],
    note: "Whether its DSD path is direct hasn't been measured.",
    sources: [src("https://headfonics.com/musician-audio-pegasus-r2r-dac-review/", "review")],
  },
  {
    id: "mytek-brooklyn-dac-plus",
    maker: "Mytek",
    models: ["Brooklyn DAC+"],
    chip: "ES9028PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    dsdMax: "DSD256",
    advice: [jussi("260730/3", "2023-12", "modulator", "Start with fifth order; seventh is worth a try.")],
    sources: [
      src(
        "https://www.audiophonics.fr/en/devices-hifi-audio-dac/mytek-brooklyn-dac-es9028pro-dac-headphone-amplifier-phono-preamplifier-32bit-384khz-dsd256-mqa-p-14849.html",
        "retailer",
      ),
    ],
  },
  {
    id: "okto-dac8",
    maker: "Okto Research",
    models: ["dac8 Stereo", "dac8 PRO"],
    chip: "ESS Sabre (ES9028PRO, per reviews)",
    dsd: "older-ess",
    pcm: "delta-sigma",
    note: 'Okto names only a "flagship Sabre"; any Sabre of its era is the older generation.',
    sources: [
      src("https://www.oktoresearch.com/dac8stereo.htm", "maker"),
      src("https://www.oktoresearch.com/dac8pro.htm", "maker"),
    ],
  },
  {
    id: "ps-audio-directstream",
    maker: "PS Audio",
    models: ["DirectStream", "DirectStream Mk2"],
    chip: "FPGA; converts everything to DSD",
    dsd: "remodulates",
    pcm: "delta-sigma",
    advice: [jussi("6061/2566", "2022-04", "modulator", "Fairly confident seventh order is fine; it should be measured.")],
    sources: [src("https://www.psaudio.com/products/directstream-dac-mk2", "maker")],
  },
  {
    id: "rme-adi2-dac-akm",
    maker: "RME",
    models: ["ADI-2 DAC FS"],
    chip: "AK4490 or AK4493",
    dsd: "direct",
    pcm: "delta-sigma",
    dsdMax: "DSD256",
    note: "Units with no letter at the end of the serial (AK4490) or a B (AK4493).",
    advice: [
      jussi("241411/37", "2023-05", "hardware", "The purest setup is DSD Direct mode at DSD256."),
      jussi("160210/676", "2022-02", "modulator", "With its AK4493, fifth or seventh order makes little difference."),
    ],
    sources: [src("https://forum.rme-audio.de/viewtopic.php?id=32506", "maker")],
  },
  {
    id: "rme-adi2-dac-ess",
    maker: "RME",
    models: ["ADI-2 DAC FS"],
    chip: "ES9028Q2M",
    dsd: "older-ess",
    pcm: "delta-sigma",
    note: "Current production: the serial ends in C. No DSD Direct mode.",
    sources: [
      src("https://forum.rme-audio.de/viewtopic.php?id=33421", "maker"),
      src("https://rme-audio.de/adi-2-dac.html", "maker"),
    ],
  },
  {
    id: "rme-adi24-pro-se",
    maker: "RME",
    models: ["ADI-2/4 Pro SE"],
    chip: "2× AK4493",
    dsd: "direct",
    pcm: "delta-sigma",
    dsdMax: "DSD256",
    sources: [src("https://forum.rme-audio.de/viewtopic.php?id=32506", "maker")],
  },
  {
    id: "schiit-multibit",
    maker: "Schiit",
    models: ["Bifrost 2/64", "Gungnir", "Yggdrasil"],
    notThese: ["Yggdrasil Singular", "Bifrost 3"],
    chip: "Multibit ladder (TI DAC8812 or DAC11001B; older units AD5781 or AD5791)",
    dsd: "converts",
    pcm: "ladder",
    note: "PCM only.",
    advice: [jussi("6210/64", "2016-01", "hardware", "No DSD: upsample PCM to the highest rate it takes.")],
    sources: [src("https://www.schiit.com/products/bifrost", "maker"), src("https://www.schiit.com/products/yggdrasil", "maker")],
  },
  {
    id: "schiit-modius-e",
    maker: "Schiit",
    models: ["Modius E"],
    chip: "ES9028",
    dsd: "converts",
    pcm: "delta-sigma",
    note: "PCM only, up to 24-bit/192 kHz.",
    sources: [
      src("https://www.audiosciencereview.com/forum/index.php?threads/schiit-modius-e-dac-review.44952/", "review"),
      src("https://addictedtoaudio.com.au/products/schiit-audio-modius-e-balanced-dac", "retailer"),
    ],
  },
  {
    id: "smsl-su9",
    maker: "SMSL",
    models: ["SU-9", "SU-9n"],
    chip: "ES9038PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    sources: [unlinked("audiophonics.fr SU-9 and SU-9n product pages", "retailer")],
  },
  {
    id: "smsl-9039",
    maker: "SMSL",
    models: ["SU-9 Pro", "D400ES"],
    chip: "ES9039MSPRO",
    dsd: "remodulates",
    pcm: "delta-sigma",
    sources: [
      src(
        "https://www.audiophonics.fr/en/dac-with-volume/smsl-d400es-dac-es9039mspro-xmos-xu316-11x-opa1612-bluetooth-50-aptx-hd-ldac-32bit-768khz-dsd512-mqa-p-16966.html",
        "retailer",
        "search",
      ),
    ],
  },
  {
    id: "smsl-d6",
    maker: "SMSL",
    models: ["D-6"],
    chip: "2× AK4493S",
    dsd: "direct",
    pcm: "delta-sigma",
    sources: [unlinked("audiophonics.fr D-6 product page", "retailer")],
  },
  {
    id: "signalyst-dsc1",
    maker: "Signalyst",
    models: ["DSC1"],
    chip: "Discrete 1-bit (open-hardware DIY design)",
    dsd: "direct",
    note: "DSD only; no PCM input.",
    sources: [src("https://www.signalyst.eu/hardware.html", "signalyst")],
  },
  {
    id: "ta",
    maker: "T+A",
    models: ["DAC 8 DSD", "DAC 200"],
    chip: "Burr-Brown for PCM; a separate 1-bit DSD path",
    dsd: "direct",
    pcm: "delta-sigma",
    dsdMax: "DSD512 (DAC 8 DSD), DSD1024 (DAC 200)",
    advice: [
      jussi("132298/2974", "2025-11", "modulator", "DAC 200: ASDM7EC-fast at DSD256, with the DAC's 60 kHz filter on."),
      jussi(
        "132298/2967",
        "2025-11",
        "modulator",
        "DAC 200, measured: DSD1024 with AHM7EC8B is clean; DSD512 shows some intermodulation.",
      ),
      jussi(
        "325365/2",
        "2026-09",
        "modulator",
        "DAC 200 on HQPlayer 6.1: the new AHM 4B is the better choice at DSD1024; keep the 60 kHz filter and the matching DAC correction on.",
      ),
    ],
    sources: [src("https://www.ta-hifi.de/en/audiosystems/series-200/dac-200-d-a-converter/", "maker")],
  },
  {
    id: "topping-centaurus",
    maker: "Topping",
    models: ["Centaurus"],
    chip: "R2R ladder, with a separate DSD network",
    dsd: "direct",
    pcm: "ladder",
    ourReading: true,
    sources: [src("https://www.topping.store/products/topping-centaurus-fully-balanced-high-performance-r2r-dac", "maker")],
  },
  {
    id: "topping-d90-akm",
    maker: "Topping",
    models: ["D90", "D90 MQA"],
    notThese: ["D90SE", "D90LE", "D90 III Sabre", "D90 III Discrete"],
    chip: "AK4499",
    dsd: "direct",
    pcm: "delta-sigma",
    note: "One name, several designs: check your unit's chip. Whether DSD Direct is used hasn't been confirmed.",
    ourReading: true,
    sources: [src("https://www.audiosciencereview.com/forum/index.php?threads/topping-d90-model-history.40072/", "review")],
  },
  {
    id: "topping-d90se",
    maker: "Topping",
    models: ["D90SE", "D90LE"],
    chip: "ES9038PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    sources: [src("http://archimago.blogspot.com/2021/09/measurements-review-topping-d90se-dac.html", "review")],
  },
  {
    id: "topping-d90-iii-sabre",
    maker: "Topping",
    models: ["D90 III Sabre"],
    chip: "2× ES9039SPRO",
    dsd: "remodulates",
    pcm: "delta-sigma",
    sources: [unlinked("audiophonics.fr and hifigo.com D90 III Sabre pages", "retailer")],
  },
  {
    id: "topping-d70-pro-sabre",
    maker: "Topping",
    models: ["D70 Pro Sabre"],
    chip: "ES9039SPRO",
    dsd: "remodulates",
    pcm: "delta-sigma",
    sources: [src("https://www.topping.store/products/topping-d70-pro-sabre-dac", "maker")],
  },
  {
    id: "topping-dx7-pro",
    maker: "Topping",
    models: ["DX7 Pro", "DX7 Pro+"],
    chip: "ES9038PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    sources: [unlinked("audiophonics.fr DX7 Pro product page", "retailer")],
  },
  {
    id: "topping-e70",
    maker: "Topping",
    models: ["E70"],
    notThese: ["E70 Velvet"],
    chip: "ES9028PRO",
    dsd: "older-ess",
    pcm: "delta-sigma",
    sources: [src("https://www.euphonicreview.com/lansdale/topping-e70-dac-full-review", "review")],
  },
  {
    id: "topping-e70-velvet",
    maker: "Topping",
    models: ["E70 Velvet"],
    chip: "AK4191 + AK4499EX",
    dsd: "remodulates",
    pcm: "delta-sigma",
    dsdMax: "DSD512 (USB)",
    note: "No working DSD Direct: the AK4191 re-modulates DSD.",
    ourReading: true,
    advice: [jussi("244358/723", "2024-02", "hardware", "Doubts it supports DSD Direct, at least correctly.")],
    sources: [
      src("https://www.topping.store/products/topping-e70-velvet-with-ak4499ex-high-performance-dac", "maker"),
      src("https://www.euphonicreview.com/blog/lets-settle-this-dsd-bypass-mode-on-akm-chipsets-once-and-for-all", "review"),
    ],
  },
  {
    id: "weiss-dac50x",
    maker: "Weiss",
    models: ["DAC501", "DAC502"],
    chip: "ESS, behind a DSP that resamples everything",
    dsd: "converts",
    pcm: "delta-sigma",
    note: "Converts DSD to PCM at about 195 kHz.",
    sources: [src("https://weiss.ch/wp-content/uploads/2022/06/Stereophile-502-Review.pdf", "review")],
  },
];;

const DSD_LABELS = {
  "older-ess": { label: "Older ESS", tone: "warn" },
  remodulates: { label: "Re-processes", tone: "accent" },
  direct: { label: "Direct", tone: "ok" },
  converts: { label: "Converts / none", tone: "dim" },
};
const PCM_LABELS = {
  ladder: { label: "Ladder", tone: "accent" },
  "delta-sigma": { label: "Delta-sigma", tone: "plain" },
};
const dsdLabel = (d) => DSD_LABELS[d];
/** undefined: a DAC with no PCM input. */
const pcmLabel = (p) => (p ? PCM_LABELS[p] : { label: "No PCM input", tone: "dim" });

const OUR_READING = "The answers here are our reading, not Signalyst's.";

/** A row's note: plain text before and after Signalyst's advice, which the page links. */
function rowNote(row) {
  const lead = [row.note, row.dsdMax && "Native DSD up to " + row.dsdMax + "."].filter(Boolean).join(" ");
  const tail = [row.ourReading && OUR_READING, row.notThese && row.notThese.length && "Not the " + row.notThese.join(", ") + "."]
    .filter(Boolean).join(" ");
  const advice = (row.advice || []).map((a) => {
    const c = datedBy(a);
    return { text: a.text, url: a.url, cite: "Jussi, " + monthLabel(a.date), dated: c ? { label: c.label, title: c.title } : null };
  });
  return { lead, advice, tail };
}

/**
 * The whole table as the page draws it: chip families, then the models grouped
 * by maker (in the order they first appear), each with its labels, its note
 * and the text a filter matches against (maker, model names, chip).
 */
function dacTable() {
  const groups = [];
  for (const m of DAC_MODELS) {
    let g = groups.find((x) => x.maker === m.maker);
    if (!g) { g = { maker: m.maker, models: [] }; groups.push(g); }
    g.models.push({
      id: m.id,
      models: m.models.join(", "),
      chip: m.chip,
      dsd: dsdLabel(m.dsd),
      pcm: pcmLabel(m.pcm),
      note: rowNote(m),
      search: [m.maker].concat(m.models, [m.chip]).join(" ").toLowerCase(),
    });
  }
  return {
    checked: dayLabel(CHECKED),
    issues: ISSUES,
    cutovers: CUTOVERS.map((c) => ({ label: c.label, title: c.title })),
    chips: CHIP_FAMILIES.map((c) => ({ id: c.id, chips: c.chips, dsd: dsdLabel(c.dsd), pcm: pcmLabel(c.pcm), note: rowNote(c) })),
    groups,
  };
}

module.exports = { CHIP_FAMILIES, DAC_MODELS, CUTOVERS, CHECKED, datedBy, dsdLabel, pcmLabel, rowNote, dacTable, jussi, src, unlinked };
