"use strict";
// ---------------------------------------------------------------------------
// hqpweb's own tests of the modulator and dither guide (apps/web/src/lib/
// advice/*.test.ts, dacs.test.ts, recovery.test.ts, main at 525f8d7), MIT,
// (c) 2026 statelycurmudgeon — lib/hqp/LICENSE. Converted from TypeScript and
// run on node:test through a vitest-shaped shim, so they say what hqpweb's
// say about the same rules; changes from the originals are marked.
// ---------------------------------------------------------------------------

const { describe, it, expect } = require("../lib/vitest-shim");
const {
  RULES, modulatorAdvice, modulatorPairs, ditherAdvice, groupModulators, groupDithers, narrowSections,
  modulatorFamily, orderOf, variantNote, heavyAt, withGuideNotes, withVolumeNotes, NOT_WITH_VOLUME,
} = require("../../lib/hqp/advice");
const { DAC_MODELS, CHIP_FAMILIES, datedBy } = require("../../lib/hqp/dacs");
const { restartSteps, recentChange, RECENT_MS } = require("../../lib/hqp/guide");
const isDated = (a) => datedBy(a) !== null;

// Lists as HQPlayer reports them (hqpweb advice/recorded-lists.ts): Desktop 5.35
// in SDM and PCM; 6.1 is 5.35 with the 5L AHM removed and the 4B AHM added.
const V5 = [
  ...["DSD5", "DSD5v2", "DSD5v2 256+fs", "DSD5EC", "ASDM5", "ASDM5EC", "ASDM5ECv2", "ASDM5ECv3"],
  ...["ASDM5EC-ul", "ASDM5EC-light", "ASDM5EC-fast", "ASDM5EC-super"],
  ...["ASDM5EC-ul 512+fs", "ASDM5EC-light 512+fs", "ASDM5EC-fast 512+fs", "ASDM5EC-super 512+fs"],
  ...["DSD7", "DSD7 256+fs", "ASDM7", "ASDM7EC", "ASDM7ECv2", "ASDM7ECv3"],
  ...["ASDM7EC-ul", "ASDM7EC-light", "ASDM7EC-fast", "ASDM7EC-super"],
  ...["ASDM7EC-ul 512+fs", "ASDM7EC-light 512+fs", "ASDM7EC-fast 512+fs", "ASDM7EC-super 512+fs"],
  ...["AMSDM7 512+fs", "AMSDM7EC 512+fs", "AHM5EC5L", "AHM7EC5L", "AHM5EC8B", "AHM7EC8B"],
];
const V61 = [...V5.filter((n) => !n.endsWith("5L")), "AHM5EC4B", "AHM7EC4B"];
const SHAPERS = ["none", "NS1", "NS4", "NS5", "NS9", "LNS15", "RPDF", "TPDF", "Gauss1", "shaped"];
const DSD256 = 11289600, DSD512 = 22579200, DSD1024 = 45158400;

// ---- from hqpweb advice/modulator.test.ts --------------------------
{
const advise = (over) =>
  modulatorAdvice({ rateHz: DSD256, modulators: V5, ...over });

describe("modulator advice: the DAC question", () => {
  it("gives no advice until the DSD question is answered", () => {
    expect(advise({ setup: {} }).status).toBe("needs-dac");
  });

  it("starts a direct-DSD DAC on HQPlayer's default, ASDM7EC-fast, citing why the default", () => {
    expect(advise({ setup: { dsd: "direct" } }).start).toEqual({
      name: "ASDM7EC-fast",
      isDefault: true,
      rules: [RULES.default],
    });
  });

  it("starts an older ESS DAC on fifth order, citing the rule", () => {
    expect(advise({ setup: { dsd: "older-ess" } }).start).toEqual({
      name: "ASDM5EC-fast",
      isDefault: false,
      rules: [RULES.olderEssFifth],
    });
  });

  it("suggests DSD512 for ESS chips, old and new", () => {
    const rates = (["older-ess", "remodulates"]).map((dsd) => advise({ setup: { dsd } }).suggestedRate?.label);
    expect(rates).toEqual(["DSD512", "DSD512"]);
  });

  it("suggests DSD256, or DSD1024 with AHM, for a direct-DSD DAC", () => {
    expect(advise({ setup: { dsd: "direct" } }).suggestedRate).toEqual({
      label: "DSD256",
      orDsd1024: true,
      orDsd512: false,
      rules: [RULES.rateDirect],
    });
  });

  it("adds DSD512 for a direct-DSD DAC with a class-D or tube amplifier, to cut ultrasonic noise", () => {
    expect(advise({ setup: { dsd: "direct", amp: "class-d-or-tube" } }).suggestedRate).toMatchObject({
      orDsd512: true,
      rules: [RULES.rateDirect, RULES.ampRate],
    });
  });

  it("warns that the AK4191 pair, which also re-processes DSD, does better below DSD512", () => {
    expect(advise({ setup: { dsd: "remodulates" } }).suggestedRate?.rules).toEqual([RULES.rateEss, RULES.akmPairRate]);
  });

  it("suggests PCM for a DAC that converts DSD, but still gives a DSD start for anyone staying in DSD", () => {
    const a = advise({ setup: { dsd: "converts" } });
    expect([a.status, a.suggestedRate, a.start?.name, a.start?.isDefault]).toEqual(["use-pcm", null, "ASDM7EC-fast", true]);
  });
});

describe("modulator advice: amplifier and volume", () => {
  it("moves to fifth order with a class-D or tube amplifier, citing the rule", () => {
    expect(advise({ setup: { dsd: "direct", amp: "class-d-or-tube" } }).start).toMatchObject({
      name: "ASDM5EC-fast",
      rules: [RULES.ampFifth],
    });
  });

  it("leaves the order alone when the listener isn't sure about the amplifier", () => {
    expect(advise({ setup: { dsd: "direct", amp: "unsure" } }).order).toBe(7);
  });

  // HQPlayer's volume as the main control isn't a setup to steer people to: Signalyst
  // suggests gain optimisation, "safe from too loud accidents" (RULES.gainOpt). So 512+fs
  // is offered, never the starting point.
  it("starts on plain -fast even when HQPlayer sets the volume at DSD512", () => {
    expect(advise({ setup: { dsd: "direct", volume: "hqplayer" }, rateHz: DSD512 }).start?.name).toBe("ASDM7EC-fast");
  });

  it("offers the 512+fs version first among the alternatives when HQPlayer sets the volume", () => {
    const a = advise({ setup: { dsd: "direct", volume: "hqplayer" }, rateHz: DSD512 });
    expect([a.p512.suggested, a.alternatives.map((x) => x.name)]).toEqual([
      true,
      ["ASDM7EC-fast 512+fs", "ASDM7EC-ul", "ASDM7EC-light", "ASDM7EC-super"],
    ]);
  });

  it("doesn't suggest 512+fs at DSD256, even when HQPlayer sets the volume", () => {
    expect(advise({ setup: { dsd: "direct", volume: "hqplayer" } }).start?.name).toBe("ASDM7EC-fast");
  });

  it("doesn't suggest 512+fs when the volume is fixed", () => {
    expect(advise({ setup: { dsd: "direct", volume: "fixed" }, rateHz: DSD512 }).start?.name).toBe("ASDM7EC-fast");
  });
});

describe("modulator advice: DSD1024 and names", () => {
  it("starts on AHM7EC8B at DSD1024 on HQPlayer 5", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: DSD1024 }).start).toMatchObject({
      name: "AHM7EC8B",
      rules: [RULES.dsd1024Ahm],
    });
  });

  it("prefers the 4B AHM when HQPlayer lists it (6.1), citing why", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: DSD1024, modulators: V61 }).start).toMatchObject({
      name: "AHM7EC4B",
      rules: [RULES.dsd1024Ahm, RULES.ahm4b],
    });
  });

  it("uses fifth-order AHM with a class-D or tube amplifier", () => {
    expect(advise({ setup: { dsd: "direct", amp: "class-d-or-tube" }, rateHz: DSD1024, modulators: V61 }).start?.name).toBe(
      "AHM5EC4B",
    );
  });

  it("treats the 48k-family DSD1024 rate as DSD1024", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: 49_152_000 }).start?.name).toBe("AHM7EC8B");
  });

  it("falls back to the EC line at DSD1024 if no AHM is listed", () => {
    const noAhm = V5.filter((n) => !n.startsWith("AHM"));
    expect(advise({ setup: { dsd: "direct" }, rateHz: DSD1024, modulators: noAhm }).start?.name).toBe("ASDM7EC-fast");
  });

  it("starts on nothing rather than a name HQPlayer doesn't list", () => {
    expect(advise({ setup: { dsd: "direct" }, modulators: ["DSD5", "DSD7"] }).start).toBeNull();
  });

  it("offers the rest of the family, lightest first, as alternatives", () => {
    expect(advise({ setup: { dsd: "direct" } }).alternatives.map((x) => x.name)).toEqual([
      "ASDM7EC-ul",
      "ASDM7EC-light",
      "ASDM7EC-super",
    ]);
  });

  it("at DSD1024 offers the other AHM versions, not the EC line", () => {
    const a = advise({ setup: { dsd: "direct" }, rateHz: DSD1024, modulators: V61 });
    expect([a.start?.name, a.alternatives.map((x) => x.name)]).toEqual(["AHM7EC4B", ["AHM7EC8B", "AHM5EC4B", "AHM5EC8B"]]);
  });

  it("never offers AHM 5L as an alternative", () => {
    const names = advise({ setup: { dsd: "direct" }, rateHz: DSD1024 }).alternatives.map((x) => x.name);
    expect(names.filter((n) => n.endsWith("5L"))).toEqual([]);
  });

  it("names modulators the advice doesn't know: newer than our rules", () => {
    expect(advise({ setup: { dsd: "direct" }, modulators: [...V61, "AHM7EC9X"] }).unknown).toEqual(["AHM7EC9X"]);
  });

  it("knows every modulator HQPlayer 5 and 6.1 list", () => {
    expect([...advise({ setup: {}, modulators: V61 }).unknown, ...advise({ setup: {} }).unknown]).toEqual([]);
  });
});

describe("modulator advice: an unknown rate (auto, stopped)", () => {
  it("still gives a starting point, but says the rate isn't known", () => {
    const a = advise({ setup: { dsd: "direct", amp: "other", volume: "fixed" }, rateHz: 0 });
    expect([a.status, a.rateKnown, a.start?.name]).toEqual(["ok", false, "ASDM7EC-fast"]);
  });

  it("knows the rate when HQPlayer reports one", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: 11_289_600 }).rateKnown).toBe(true);
  });
});

describe("modulator advice: the machine", () => {
  it("reads 0.8× processing speed as falling behind", () => {
    expect(advise({ setup: { dsd: "direct" }, processSpeed: 0.8 }).machine?.state).toBe("behind");
  });

  it("reads 1.2× as only just keeping up", () => {
    expect(advise({ setup: { dsd: "direct" }, processSpeed: 1.2 }).machine?.state).toBe("tight");
  });

  it("says nothing about the machine when the speed isn't known", () => {
    expect(advise({ setup: { dsd: "direct" }, processSpeed: null }).machine).toBeNull();
  });
});
}

// ---- from hqpweb advice/pairs.test.ts ------------------------------
{
const ALL = [0, 2_822_400, 5_644_800, 11_289_600, 22_579_200, 45_158_400];
const pairs = (setup, o = {}) =>
  modulatorPairs({ setup, rates: o.rates ?? ALL, modulators: o.modulators ?? V61 });
const brief = (p) => p.map((x) => [x.label, x.start.name, x.suitsDac]);

describe("rate and modulator pairs for the guide", () => {
  it("gives a direct-DSD DAC DSD256 with the default and DSD1024 with AHM first, then DSD512", () => {
    expect(brief(pairs({ dsd: "direct" }))).toEqual([
      ["DSD256", "ASDM7EC-fast", true],
      ["DSD1024", "AHM7EC4B", true],
      ["DSD512", "ASDM7EC-fast", false],
    ]);
  });

  it("gives an older ESS DAC DSD512 first, fifth order throughout", () => {
    expect(brief(pairs({ dsd: "older-ess" }))).toEqual([
      ["DSD512", "ASDM5EC-fast", true],
      ["DSD256", "ASDM5EC-fast", false],
      ["DSD1024", "AHM5EC4B", false],
    ]);
  });

  it("adds DSD512 for a direct DAC with a class-D or tube amplifier", () => {
    expect(pairs({ dsd: "direct", amp: "class-d-or-tube" }).find((p) => p.label === "DSD512")?.suitsDac).toBe(true);
  });

  it("pairs DSD512 with plain -fast even when HQPlayer sets the volume (512+fs is an option)", () => {
    expect(pairs({ dsd: "direct", volume: "hqplayer" }).find((p) => p.label === "DSD512")?.start.name).toBe("ASDM7EC-fast");
  });

  it("offers DSD1024 only with an AHM modulator HQPlayer lists", () => {
    const noAhm = V5.filter((n) => !n.startsWith("AHM"));
    expect(pairs({ dsd: "direct" }, { modulators: noAhm }).map((p) => p.label)).toEqual(["DSD256", "DSD512"]);
  });

  it("offers only rates HQPlayer lists", () => {
    expect(pairs({ dsd: "direct" }, { rates: [0, 11_289_600] }).map((p) => p.label)).toEqual(["DSD256"]);
  });

  it("offers nothing until the DAC question is answered", () => {
    expect(pairs({})).toEqual([]);
  });

  it("still offers pairs when the DAC suits PCM, none of them marked as suiting it", () => {
    const p = pairs({ dsd: "converts" });
    expect([p.length > 0, p.some((x) => x.suitsDac)]).toEqual([true, false]);
  });

  it("gives each pair its rate in Hz, to apply as one change", () => {
    expect(pairs({ dsd: "direct" })[0]).toMatchObject({ rateHz: 11_289_600 });
  });
});
}

// ---- from hqpweb advice/dither.test.ts -----------------------------
{
const advise = (over) =>
  ditherAdvice({ rateHz: 384_000, shapers: SHAPERS, ...over });

describe("dither advice", () => {
  it("gives no advice until the PCM question is answered", () => {
    expect(advise({ setup: {} }).status).toBe("needs-dac");
  });

  it("gives a delta-sigma DAC TPDF or Gauss1, as equals", () => {
    const a = advise({ setup: { pcm: "delta-sigma", link: "usb" } });
    expect([a.group, a.rules]).toEqual([["TPDF", "Gauss1"], [RULES.flatDither]]);
  });

  it("gives a ladder DAC at 384 kHz NS5 or NS9: LNS15 is for 705.6k and up", () => {
    const a = advise({ setup: { pcm: "ladder", link: "usb" } });
    expect([a.group, a.rules]).toEqual([["NS5", "NS9"], [RULES.ladderAt384]]);
  });

  it("gives a ladder DAC at 768 kHz LNS15, NS9 or NS5, LNS15 first", () => {
    const a = advise({ setup: { pcm: "ladder", link: "usb" }, rateHz: 768_000 });
    expect([a.group, a.rules]).toEqual([["LNS15", "NS9", "NS5"], [RULES.ladderShapers]]);
  });

  it("tells a ladder DAC at 192 kHz to raise the rate, with flat dither meanwhile", () => {
    const a = advise({ setup: { pcm: "ladder", link: "usb" }, rateHz: 192_000 });
    expect([a.raiseRate, a.group, a.rules]).toEqual([true, ["TPDF", "Gauss1"], [RULES.ladderRate]]);
  });

  it("asks for the rate before advising a ladder DAC, when it isn't known (auto, stopped)", () => {
    const a = advise({ setup: { pcm: "ladder", link: "usb" }, rateHz: 0 });
    expect([a.status, a.group, a.raiseRate]).toEqual(["needs-rate", [], false]);
  });

  it("advises a delta-sigma DAC without knowing the rate", () => {
    expect(advise({ setup: { pcm: "delta-sigma", link: "usb" }, rateHz: 0 }).group).toEqual(["TPDF", "Gauss1"]);
  });

  it("doesn't tell a ladder DAC over S/PDIF to raise the rate, since S/PDIF tops out near 192k", () => {
    const a = advise({ setup: { pcm: "ladder", link: "spdif" }, rateHz: 192_000 });
    expect([a.raiseRate, a.rules]).toEqual([false, [RULES.flatDither]]);
  });

  it("keeps flat dither for a ladder DAC over S/PDIF", () => {
    expect(advise({ setup: { pcm: "ladder", link: "spdif" } }).group).toEqual(["TPDF", "Gauss1"]);
  });

  it("sets DAC Bits to Default over USB for a delta-sigma DAC", () => {
    expect(advise({ setup: { pcm: "delta-sigma", link: "usb" } }).bits?.kind).toBe("default");
  });

  it("sets DAC Bits to 24 over S/PDIF", () => {
    expect(advise({ setup: { pcm: "delta-sigma", link: "spdif" } }).bits?.kind).toBe("24");
  });

  it("over I2S, says to match what the DAC takes, citing the manual", () => {
    expect(advise({ setup: { pcm: "delta-sigma", link: "i2s" } }).bits).toEqual({ kind: "match", rule: RULES.i2sBits });
  });

  it("keeps a ladder DAC's own low DAC Bits whatever the link, citing the rule", () => {
    expect(advise({ setup: { pcm: "ladder", link: "spdif" } }).bits).toEqual({ kind: "ladder", rule: RULES.ladderBits });
  });

  it("suggests trying DSD for a delta-sigma DAC that takes DSD well", () => {
    expect(advise({ setup: { pcm: "delta-sigma", dsd: "direct" } }).tryDsd).toBe(RULES.dsdBetter);
  });

  it("doesn't suggest DSD for a DAC that converts DSD", () => {
    expect(advise({ setup: { pcm: "delta-sigma", dsd: "converts" } }).tryDsd).toBeNull();
  });

  it("suggests DSD for a ladder DAC with a direct DSD path, like Holo", () => {
    expect(advise({ setup: { pcm: "ladder", dsd: "direct" } }).tryDsd).toBe(RULES.holoDsd);
  });

  it("doesn't suggest DSD for a ladder DAC without a direct DSD path", () => {
    expect(advise({ setup: { pcm: "ladder", dsd: "converts" } }).tryDsd).toBeNull();
  });

  it("never offers none, or a shaper HQPlayer doesn't list", () => {
    const a = advise({ setup: { pcm: "ladder", link: "usb" }, shapers: ["none", "TPDF", "NS9"] });
    expect(a.group).toEqual(["NS9"]);
  });
});
}

// ---- from hqpweb advice/catalogue.test.ts --------------------------
{
const titles = (s) => s.map((x) => x.title);

describe("modulator list grouping", () => {
  it("puts every recorded modulator in a family", () => {
    expect(V5.filter((n) => modulatorFamily(n) === null)).toEqual([]);
  });

  it("reads the order from the name", () => {
    expect([orderOf("ASDM5EC-fast"), orderOf("AHM7EC4B"), orderOf("DSD7"), orderOf("XYZ")]).toEqual([5, 7, 7, null]);
  });

  it("groups by family, newest first, with the older series folded", () => {
    const s = groupModulators(V5, null);
    expect(s.map((x) => [x.title, x.open])).toEqual([
      ["Newest EC line", true],
      ["AHM, for DSD1024 and up", true],
      ["AMSDM, pseudo-multi-bit", false],
      ["Older EC series", false],
      ["Basic", false],
    ]);
  });

  it("shows your order in each family and folds the other order at the end", () => {
    const s = groupModulators(V5, 7);
    expect([s[0].names.every((n) => n.startsWith("ASDM7")), s.at(-1)?.title, s.at(-1)?.open]).toEqual([
      true,
      "Fifth order",
      false,
    ]);
  });

  it("keeps both orders of AHM, since the DSD1024 choice depends on the amplifier", () => {
    expect(groupModulators(V5, 7).find((x) => x.key === "ahm")?.names).toEqual(["AHM5EC5L", "AHM7EC5L", "AHM5EC8B", "AHM7EC8B"]);
  });

  it("never hides a modulator the rules don't know", () => {
    const s = groupModulators([...V5, "AHM7EC9X"], 7);
    expect(s.find((x) => x.key === "unknown")).toEqual({
      key: "unknown",
      title: "Newer than the guide's advice",
      names: ["AHM7EC9X"],
      open: true,
    });
  });

  it("notes on the older series why the newest EC line is the one to use, citing the posts", () => {
    const notes = Object.fromEntries(groupModulators(V5, null).map((x) => [x.key, x.note ?? null]));
    expect([notes.new, notes.ahm, notes.olderEc, notes.basic]).toEqual([null, null, RULES.olderGen, RULES.basicGen]);
  });

  it("loses no name between the sections", () => {
    expect(
      groupModulators(V5, 5)
        .flatMap((x) => x.names)
        .sort(),
    ).toEqual([...V5].sort());
  });
});

describe("dither list grouping", () => {
  it("puts flat dither first, shapers next, the rest under More, and none on its own", () => {
    expect(titles(groupDithers(SHAPERS))).toEqual(["Flat dither", "Noise shaping, for ladder DACs", "More", "Not for listening"]);
  });

  it("folds More by default", () => {
    expect(groupDithers(SHAPERS).find((x) => x.key === "more")?.open).toBe(false);
  });

  it("files a shaper it doesn't know under More rather than dropping it", () => {
    expect(groupDithers([...SHAPERS, "NS99"]).find((x) => x.key === "more")?.names).toContain("NS99");
  });

  it("loses no name between the sections", () => {
    expect(
      groupDithers(SHAPERS)
        .flatMap((x) => x.names)
        .sort(),
    ).toEqual([...SHAPERS].sort());
  });
});

describe("narrowing the list (search, works here)", () => {
  const sections = groupModulators(V5, 7);

  it("keeps every section as it was with no query and nothing hidden", () => {
    expect(narrowSections(sections, "", new Set())).toEqual(sections);
  });

  it("searches across folded sections too, opening the ones that match", () => {
    const s = narrowSections(sections, "ecv3", new Set());
    expect(s.map((x) => [x.key, x.names, x.open])).toEqual([
      ["olderEc", ["ASDM7ECv3"], true],
      ["other", ["ASDM5ECv3"], true],
    ]);
  });

  it("matches without regard to case", () => {
    expect(narrowSections(sections, "AHM7EC8b", new Set()).flatMap((x) => x.names)).toEqual(["AHM7EC8B"]);
  });

  it("drops what's hidden (e.g. won't play here) and any section left empty", () => {
    const hide = new Set(["AHM5EC5L", "AHM7EC5L", "AHM5EC8B", "AHM7EC8B"]);
    expect(narrowSections(sections, "", hide).some((x) => x.key === "ahm")).toBe(false);
  });
});
}

// ---- from hqpweb advice/variants.test.ts ---------------------------
{
describe("what each modulator variant is like", () => {
  it("ranks the EC variants by CPU load, lightest first", () => {
    const loads = ["ASDM7EC-ul", "ASDM7EC-light", "ASDM7EC-fast", "ASDM7EC-super"].map((n) => variantNote(n)?.load);
    expect(loads).toEqual(["lightest", "light", "a bit more than -light", "heaviest"]);
  });

  it("gives each its documented character, cited", () => {
    expect(variantNote("ASDM7EC-ul")?.rules).toEqual([RULES.ulPi, RULES.ulEss]);
    expect(variantNote("ASDM7EC-light")?.rules).toEqual([RULES.lightDesign]);
    expect(variantNote("ASDM7EC-fast")?.rules).toEqual([RULES.fastTransients]);
    expect(variantNote("ASDM7EC-super")?.rules).toEqual([RULES.superDesign, RULES.superFit]);
  });

  it("treats fifth order and 512+fs versions like their family", () => {
    expect([variantNote("ASDM5EC-light 512+fs")?.load, variantNote("ASDM5EC-super")?.load]).toEqual(["light", "heaviest"]);
  });

  it("describes AHM 4B and 8B, claiming light load only where Signalyst said so (8B)", () => {
    expect(variantNote("AHM5EC4B")).toEqual({ load: null, rules: [RULES.ahm4bNew] });
    expect(variantNote("AHM7EC8B")).toEqual({ load: "light", rules: [RULES.ahm8bLight] });
  });

  it("says nothing about a modulator it has no documented notes for", () => {
    expect([variantNote("ASDM7ECv3"), variantNote("DSD7")]).toEqual([null, null]);
  });
});

describe("heavy at DSD1024 (information, never a refusal)", () => {
  it("notes the EC line needs a high-clock CPU at DSD1024, cited", () => {
    expect(heavyAt("ASDM7EC-fast", 45_158_400)).toBe(RULES.ecAt1024);
  });

  it("says nothing below DSD1024, or for AHM", () => {
    expect([heavyAt("ASDM7EC-super", 22_579_200), heavyAt("AHM7EC8B", 45_158_400)]).toEqual([null, null]);
  });
});
}

// ---- from hqpweb advice/list-notes.test.ts -------------------------
{
describe("list notes", () => {
  const rows = [
    { name: "NS9", note: "NS9 is designed for 176.4/192k" },
    { name: "LNS15", note: "LNS15 isn't recommended below 352.8k" },
    { name: "NS5", warn: "failed here before", note: "x" },
    { name: "TPDF" },
  ];

  it("replaces a soft note the guide contradicts on a row it recommends", () => {
    expect(withGuideNotes(rows, new Set(["NS9"]))[0]?.note).toBe("Suits your answers: see Guide");
  });

  it("keeps notes on rows the guide doesn't recommend", () => {
    expect(withGuideNotes(rows, new Set(["NS9"]))[1]?.note).toBe("LNS15 isn't recommended below 352.8k");
  });

  it("never touches a warning", () => {
    expect(withGuideNotes(rows, new Set(["NS5"]))[2]).toEqual(rows[2]);
  });

  it("leaves a recommended row without a note alone", () => {
    expect(withGuideNotes(rows, new Set(["TPDF"]))[3]).toEqual({ name: "TPDF" });
  });
});

describe("AHM 5L with HQPlayer volume", () => {
  const rows = [{ name: "AHM7EC5L" }, { name: "AHM5EC5L" }, { name: "AHM7EC8B" }];

  it("notes that the 5L versions, both orders, don't suit HQPlayer's volume, when it sets the volume", () => {
    expect(withVolumeNotes(rows, { volume: "hqplayer" }).map((r) => r.note ?? null)).toEqual([
      NOT_WITH_VOLUME,
      NOT_WITH_VOLUME,
      null,
    ]);
  });

  it("leaves a warning alone", () => {
    const warned = [{ name: "AHM7EC5L", warn: "won't play here" }];
    expect(withVolumeNotes(warned, { volume: "hqplayer" })).toEqual(warned);
  });

  it("adds nothing when the volume is fixed or not answered", () => {
    expect([withVolumeNotes(rows, { volume: "fixed" }), withVolumeNotes(rows, {})]).toEqual([rows, rows]);
  });
});
}

// ---- from hqpweb dacs.test.ts --------------------------------------
{
describe("Find your DAC: which advice may be dated", () => {
  const at = (date, about, text = "") => ({ text, url: "", date, about });

  it("marks modulator advice from before HQPlayer 5.11's modulators (Feb 2025)", () => {
    expect(isDated(at("2025-01", "modulator"))).toBe(true);
  });

  it("doesn't mark modulator advice from February 2025 on", () => {
    expect(isDated(at("2025-02", "modulator"))).toBe(false);
  });

  it("marks DSD1024 / AHM advice from before HQPlayer 6.1's AHM 4B (Sep 2026)", () => {
    expect(datedBy(at("2025-11", "modulator", "DSD1024 with AHM7EC8B is clean."))?.label).toBe("before 6.1's AHM 4B");
  });

  it("doesn't mark other modulator advice from after 5.11 for 6.1", () => {
    expect(datedBy(at("2025-11", "modulator", "ASDM7EC-fast at DSD256."))).toBeNull();
  });

  it("names the older cut-over when advice predates both", () => {
    expect(datedBy(at("2024-08", "modulator", "AHM7EC5L at DSD1024."))?.label).toBe("before 5.11's modulators");
  });

  it("doesn't mark old advice about dither, or facts about the hardware", () => {
    expect([isDated(at("2016-01", "dither")), isDated(at("2016-01", "hardware"))]).toEqual([false, false]);
  });
});

const advice = [...CHIP_FAMILIES, ...DAC_MODELS].flatMap((r) => (r.advice ?? []).map((a) => ({ id: r.id, ...a })));

describe("Find your DAC: the table's own rules", () => {
  it("gives every row a unique id", () => {
    const ids = [...CHIP_FAMILIES, ...DAC_MODELS].map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("gives every model row at least one source", () => {
    expect(DAC_MODELS.filter((m) => m.sources.length === 0).map((m) => m.id)).toEqual([]);
  });

  it("gives every source a link, or a label saying what it is", () => {
    const bare = DAC_MODELS.filter((m) => m.sources.some((s) => !s.url && !s.label)).map((m) => m.id);
    expect(bare).toEqual([]);
  });

  it("marks every unlinked source as seen only in search results", () => {
    const wrong = DAC_MODELS.filter((m) => m.sources.some((s) => !s.url && s.seen !== "search")).map((m) => m.id);
    expect(wrong).toEqual([]);
  });

  it("cites Signalyst's advice as a single forum post, with its month", () => {
    const odd = advice.filter(
      (a) => !/^https:\/\/community\.roonlabs\.com\/t\/\d+\/\d+$/.test(a.url) || !/^\d{4}-\d\d$/.test(a.date),
    );
    expect(odd.map((a) => `${a.id}: ${a.url} ${a.date}`)).toEqual([]);
  });

  it("puts ESS up to the ES9038 and ES9068 as older ESS, and the ES9039 on as re-modulating", () => {
    const disagree = DAC_MODELS.filter((m) => {
      const ess = /ES90(\d\d)/.exec(m.chip)?.[1];
      if (!ess || m.dsd === "converts") return false;
      return m.dsd !== (["18", "28", "38", "68"].includes(ess) ? "older-ess" : "remodulates");
    });
    expect(disagree.map((m) => `${m.id}: ${m.chip} → ${m.dsd}`)).toEqual([]);
  });

  it("never names an older-series modulator in advice, only the principle (order, rate, 512+fs)", () => {
    // ASDM7EC, ASDM7ECv2, ASDM7, DSD7 and the like, but not ASDM7EC-fast or DSD512.
    const older = /\b(ASDM[57](EC(v\d)?)?|DSD[57](v2)?)\b(?!-)/;
    expect(advice.filter((a) => older.test(a.text)).map((a) => `${a.id}: ${a.text}`)).toEqual([]);
  });

  it("says what every piece of advice is about", () => {
    const odd = advice.filter((a) => !["modulator", "dither", "hardware"].includes(a.about));
    expect(odd.map((a) => `${a.id}: ${String(a.about)}`)).toEqual([]);
  });

  it("never lists a model as both covered and excluded by the same row", () => {
    const both = DAC_MODELS.filter((m) => m.notThese?.some((n) => m.models.includes(n))).map((m) => m.id);
    expect(both).toEqual([]);
  });
});
}

// ---- from hqpweb recovery.test.ts ----------------------------------
{
describe("how to restart HQPlayer when it stops answering", () => {
  it("tells Desktop users to quit and reopen it", () => {
    expect(restartSteps("Signalyst HQPlayer 5 Desktop").steps.join(" ")).toMatch(/[Qq]uit HQPlayer/);
  });

  it("gives Embedded users Signalyst's service restart, and the machine as the fallback", () => {
    const s = restartSteps("Signalyst HQPlayer Embedded").steps.join(" ");
    expect([s.includes("systemctl restart hqplayerd"), /restart the HQPlayer machine/i.test(s)]).toEqual([true, true]);
  });

  it("covers both when the product isn't known", () => {
    const s = restartSteps(undefined).steps.join(" ");
    expect([/[Qq]uit HQPlayer/.test(s), s.includes("systemctl")]).toEqual([true, true]);
  });

  it("always says it comes back on its saved settings", () => {
    expect(restartSteps("Signalyst HQPlayer Embedded").after).toMatch(/saved settings/);
  });
});

describe("tying an overload to a recent change", () => {
  const at = new Date(2026, 9, 6, 12, 3).getTime();

  it("names a risky change made in the last few minutes", () => {
    expect(recentChange(at, at + 2 * 60_000)).toBe(true);
  });

  it("doesn't blame a change made long before", () => {
    expect([recentChange(at, at + RECENT_MS + 1), recentChange(null, at)]).toEqual([false, false]);
  });
});
}

