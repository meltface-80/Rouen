"use strict";
// ---------------------------------------------------------------------------
// What stops playback in the FAKE HQPlayer: its own small table, written
// apart from the app's predictions (compat.js). If the fake asked the app's
// code, a test of those predictions against the fake would agree with itself
// whatever the rules said. So each rule here cites its own evidence, and
// test/unit/hqp-fake.test.js checks that the app predicts every stop listed.
//
// Ported from hqpweb (packages/fake-hqp/src/stops.ts, 0.1.0-beta.2 +
// 65b3888), MIT, (c) 2026 statelycurmudgeon — see ./LICENSE.
// ---------------------------------------------------------------------------

/** The 1x filter plays a source below 50 kHz, the Nx filter above. Manual §4.6; the fake's own copy. */
const slotFor = (sourceRate) => (sourceRate < 50000 ? "1x" : "Nx");

const isPow2 = (n) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
const sdm = (c) => c.modeName.startsWith("SDM");

const STOP_RULES = [
  {
    evidence:
      "AHM modulators below 40.96 MHz (DSD1024). Measured: AHM7EC8B stopped at DSD256 and DSD512 " +
      "(hqpweb design §2.3, macOS 5.32.5). Inferred for the rest of the family from the manual's floor (§4.5).",
    example: { modeName: "SDM (DSD)", rateHz: 22579200, shaperName: "AHM7EC8B", filterName: "poly-sinc-gauss-xla", sourceRate: 44100 },
    stops: (c) => sdm(c) && c.shaperName.startsWith("AHM") && c.rateHz > 0 && c.rateHz < 40960000,
  },
  {
    evidence:
      "The sinc-M family needs a power-of-two ratio. Measured: sinc-M stopped at 44.1k → 192k " +
      "(hqpweb design §2.3, Linux 5.35.10), refused 3× and played 2× down (Desktop 5.17.2). Inferred for the family.",
    example: { modeName: "PCM", rateHz: 192000, shaperName: "TPDF", filterName: "sinc-M", sourceRate: 44100 },
    stops: (c) => {
      if (!/^sinc-(M|S|L)/.test(c.filterName) || !c.rateHz || !c.sourceRate) return false;
      const r = c.rateHz / c.sourceRate;
      return !isPow2(r) && !isPow2(1 / r);
    },
  },
];

/** The fake's default: stops when any rule here says so. Anything not listed plays. */
const stopsByTable = (c) => STOP_RULES.some((rule) => rule.stops(c));

module.exports = { STOP_RULES, stopsByTable, slotFor };
