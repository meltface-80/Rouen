"use strict";
// ---------------------------------------------------------------------------
// What the modulator / dither sheet shows, worked out in one place from the
// lists, the status, the setup answers and the picker hints: the List tab's
// sections and badges, and the Guide tab's questions, rate-and-modulator
// pairs and where to start. The decisions are advice.js's; this only gathers
// them for the page. Adapted from hqpweb's AdviceSheet, ModulatorGuide and
// DitherGuide (apps/web/src/lib/*.svelte, main at 525f8d7), MIT, (c) 2026
// statelycurmudgeon — see ./LICENSE.
//
// Also here: what to say when HQPlayer stops answering (hqpweb's recovery.ts).
// ---------------------------------------------------------------------------

const A = require("./advice");
const { SETUP_QUESTIONS } = require("./setup");
const { context, checkPair } = require("./hints");

const nameAt = (list, i) => {
  const hit = (list || []).find((x) => x.index === i);
  return hit ? hit.name : "";
};

/** Every rule in a value, with the citation the page links ("Jussi, Aug 2025"). */
function cited(v) {
  if (Array.isArray(v)) return v.map(cited);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = cited(x);
  if (typeof v.text === "string" && typeof v.date === "string" && (v.url || v.source)) return A.cite(out);
  return out;
}

/**
 * The sheet's whole view. `hints` are the picker hints for the shaper field
 * (pickerHints(...).shaper), so the list keeps its warnings and notes.
 */
function guideView(caps, snap, setup, hints, processSpeed) {
  const c = context(caps, snap);
  const isSdm = c.isSdm;
  const names = caps.shapers.map((s) => s.name);
  const current = nameAt(caps.shapers, snap.state.shaper);
  // The rate the advice is for: the configured one when fixed, else what is
  // active; 0 while stopped on auto, when AHM and 512+fs cannot be judged.
  const rateHz = snap.status.state === 0 && !c.fixedRate ? 0 : c.outRate;
  const rates = caps.rates.filter((r) => r.allowed && r.rate > 0).map((r) => r.rate);

  const mod = isSdm ? A.modulatorAdvice({ setup, rateHz, modulators: names, processSpeed }) : null;
  const dit = isSdm ? null : A.ditherAdvice({ setup, rateHz, shapers: names });

  // The guide's starting point(s), badged in the list.
  const badges = {};
  if (mod && mod.status === "ok" && mod.start)
    badges[mod.start.name] = mod.start.isDefault ? { text: "HQPlayer's default", kind: "default" } : { text: "For your answers", kind: "yours" };
  if (dit && dit.status === "ok") for (const n of dit.group) badges[n] = { text: "For your answers", kind: "yours" };
  // Each row's note as the List shows it: the guide's reason over a soft note
  // it contradicts, and the manual's advice on AHM 5L with HQPlayer's volume.
  const yours = new Set(Object.keys(badges).filter((n) => badges[n].kind === "yours"));
  const rows = names.map((n) => Object.assign({ name: n }, hints && hints[n] ? { warn: hints[n].warn, note: hints[n].note } : {}));
  const notes = {};
  for (const r of A.withVolumeNotes(A.withGuideNotes(rows, yours), setup)) if (r.note) notes[r.name] = r.note;

  const view = {
    isSdm,
    current,
    // The list's warnings, worked out with everything else here, so the
    // sheet's warnings, badges and notes all describe the same moment.
    hints: hints || {},
    rateHz,
    rates,
    setup,
    sections: isSdm ? A.groupModulators(names, mod && mod.status === "ok" ? mod.order : null) : A.groupDithers(names),
    badges,
    notes,
    questions: isSdm
      ? { dsd: SETUP_QUESTIONS.dsd, amp: SETUP_QUESTIONS.amp, volume: SETUP_QUESTIONS.volume }
      : { pcm: SETUP_QUESTIONS.pcm, link: SETUP_QUESTIONS.link },
    rules: { variantsEqual: A.RULES.variantsEqual, p512Volume: A.RULES.p512Volume, gainOpt: A.RULES.gainOpt,
             usePcm: A.RULES.usePcm, neverNone: A.RULES.neverNone },
  };

  if (mod) {
    const pairs = A.modulatorPairs({ setup, rates, modulators: names }).map((p) => Object.assign({}, p, {
      variant: A.variantNote(p.start.name),
      check: checkPair(c, { rateHz: p.rateHz, shaper: p.start.name }),
    }));
    view.modulator = Object.assign({}, mod, {
      alternatives: mod.alternatives.map((a) => ({ name: a.name, variant: A.variantNote(a.name) })),
      pairs,
      // The current rate's starting point is already a pair row when the rate is one of them.
      startInPairs: pairs.some((p) => p.rateHz === rateHz),
      p512Name: mod.start ? mod.start.name + " 512+fs" : "",
      p512Listed: !!mod.start && names.includes(mod.start.name + " 512+fs"),
    });
  }
  if (dit) view.dither = dit;
  return cited(view);
}

// ---- when HQPlayer stops answering (recovery.ts) ------------------------------
// Typically after a change it could not keep up with: overload builds over
// minutes, and the control API stops answering, so neither rollback nor undo
// can reach it. Restarting is the cure. Embedded: Signalyst's own command for
// Linux installs (Jussi Laako, Roon forum t/244327/1650, Jun 2025); HQPlayer OS
// documents none, so the machine is the fallback.

const DESKTOP = "Quit HQPlayer and open it again (Force Quit on a Mac, or End task on Windows, if it won't quit).";
const EMBEDDED = [
  "On the HQPlayer machine, run: sudo systemctl restart hqplayerd",
  "On HQPlayer OS, or if that doesn't work, restart the HQPlayer machine.",
];

function restartSteps(product) {
  const p = product || "";
  const steps = /Embedded/i.test(p) ? EMBEDDED
    : /Desktop/i.test(p) ? [DESKTOP]
    : ["Desktop: " + DESKTOP].concat(EMBEDDED.map((s) => "Embedded: " + s));
  return {
    steps,
    after: "HQPlayer comes back on its saved settings, which may not be the last ones you chose: check the volume before playing.",
  };
}

/**
 * Overload can build over minutes after a change (about 5 minutes to 100% CPU,
 * measured by hqpweb), well after the playback check ends. Within this window
 * the overload warnings name the last risky change, next to Undo.
 */
const RECENT_MS = 10 * 60000;
const recentChange = (changedAt, now) => changedAt !== null && changedAt !== undefined && now - changedAt <= RECENT_MS;

module.exports = { guideView, restartSteps, cited, RECENT_MS, recentChange };
