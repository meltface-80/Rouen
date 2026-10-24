// @ts-check
/*
 * zone-dsp-settings.js — a DSP item's own settings in the DSP window (dev/design/native-remote.md §15.12, v1.9.66-t12):
 * Headroom's gain and clipping indicator; Crossfeed's preset, cut frequency and feed level; Sample rate conversion's
 * mode, filter, DSD to PCM filter and, in custom mode, each input rate's output. Shown beneath an item
 * when its name is tapped (zone-dsp.js); a choice by a select of the server's own list, a number by − value + (the
 * owner's choices), the clipping indicator by a switch.
 *
 *   window.RouenDspSettings.has(item)                             whether it has a setting to show (else nothing opens)
 *   window.RouenDspSettings.fill(panel, item, { zone, status })   the item's settings, in the panel
 *
 * Each change is sent once (POST /api/roon/zone-dsp/setting) and shown only as the server then holds it; one not taken
 * is said on the window's status line, and the setting shown as it was. Loaded by zone-settings.js, beside it.
 */
(function dspSettings() {
  "use strict";
  const SENDING = "Sending to your server…";
  /** The − value + steps (the owner, §15.12). */
  const STEP = { gain: 0.5, cut: 10, feed: 0.5 };
  /** The server's values, as MUSE says them; any other as it comes. */
  const LABELS = /** @type {Record<string, string>} */ ({
    none: "None", max_sample_rate: "Max sample rate", custom: "Custom", default: "Default", cmoy: "Chu Moy", meier: "Jan Meier",
    linear_phase: "Linear phase", minimum_phase: "Minimum phase", linear_phase_smooth: "Linear phase, smooth", minimum_phase_smooth: "Minimum phase, smooth",
    order5: "5th order", order7: "7th order", clans_order5: "5th order CLANS", clans_order7: "7th order CLANS",
    lowpass_24khz: "Low-pass, 24 kHz", lowpass_30khz: "Low-pass, 30 kHz", lowpass_50khz: "Low-pass, 50 kHz",
  });
  /** @param {any} v */
  const label = (v) => LABELS[String(v)] || String(v);
  /** A rate in kHz. @param {number} n */
  const khz = (n) => `${String(n / 1000).replace(/\.0$/, "")} kHz`;
  /** One decimal place, as the server keeps them. @param {number} n */
  const tenth = (n) => Math.round(n * 10) / 10;

  /** @param {string} tag @param {string} [text] @param {Partial<CSSStyleDeclaration>} [style] */
  function el(tag, text, style) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (style) Object.assign(e.style, style);
    return e;
  }
  /** A setting's row: its name on the left, its control on the right. @param {string} name @param {HTMLElement} control @param {string} key */
  function row(name, control, key) {
    const r = el("div", undefined, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", minHeight: "2.6rem",
      padding: ".2rem 0 .2rem .8rem", fontSize: ".95rem" });
    r.className = "zone-dsp-setting";
    r.dataset.setting = key;
    r.append(el("span", name, { color: "var(--text-dim)" }), control);
    return r;
  }
  /** A small button, its size its own (the Shelf sizes its buttons). @param {string} text @param {string} aria */
  function btn(text, aria) {
    const b = /** @type {HTMLButtonElement} */ (el("button", text, { font: "inherit", fontSize: "1.1rem", width: "2.4rem", height: "2.4rem", minHeight: "0",
      padding: "0", borderRadius: "999px", border: "1px solid var(--border, rgba(255,255,255,.2))", background: "transparent", color: "inherit", cursor: "pointer" }));
    b.type = "button";
    b.setAttribute("aria-label", aria);
    return b;
  }

  /**
   * The item's settings, in the panel, as the server holds them.
   * @param {HTMLElement} panel @param {any} it  the item, with its settings @param {{ zone: string, status: HTMLElement }} ctx
   */
  function fill(panel, it, ctx) {
    panel.textContent = "";
    /** @type {any} */ (panel).item = it;   // the item as last shown, for when it is opened again
    const st = it.settings;
    if (!st) return;
    /** Sent once; the panel shown afresh as the server then holds it, or as it was, and why said. */
    const send = async (/** @type {string} */ setting, /** @type {any} */ value, /** @type {string | undefined} */ rule) => {
      for (const c of panel.querySelectorAll("button, select")) /** @type {HTMLButtonElement} */ (c).disabled = true;
      ctx.status.textContent = SENDING;
      let next = it;
      try {
        const r = await fetch("/api/roon/zone-dsp/setting", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ zone_id: ctx.zone, item: String(it.id), setting, value }, rule ? { rule } : {})) });
        // a body that isn't JSON is no answer: said below, and the setting as it was
        const b = await r.json().catch(() => ({}));
        if (b && b.seen && b.item && b.item.settings) {
          next = b.item;
          // the line cleared only of "Sending…", never of what another control has said meanwhile
          if (ctx.status.textContent === SENDING) ctx.status.textContent = "";
        } else {
          ctx.status.textContent = (b && (b.why || b.notSent || b.error)) || "That didn't reach your server.";
        }
      } catch (e) {
        ctx.status.textContent = "That didn't reach your server.";   // no answer: said, and the setting as it was
      }
      if (panel.isConnected) fill(panel, next, ctx);
    };
    /** A choice, from the server's own list. */
    const choice = (/** @type {string} */ name, /** @type {string} */ key, /** @type {Array<[string, string]>} */ opts, /** @type {string} */ cur,
      /** @type {(v: string) => void} */ onChange) => {
      const sel = /** @type {HTMLSelectElement} */ (el("select", undefined, { maxWidth: "60%", font: "inherit", fontSize: ".95rem", color: "inherit",
        background: "var(--bg-elev-2, transparent)", border: "1px solid var(--border, rgba(255,255,255,.2))", borderRadius: ".4rem", padding: ".3rem .4rem" }));
      sel.setAttribute("aria-label", name);
      // a value the server didn't send: said as not set, never shown as the first choice (the review); not sendable
      if (cur === null || cur === undefined) sel.appendChild(Object.assign(document.createElement("option"), { value: "\u0000", textContent: "Not set", disabled: true }));
      for (const [v, t] of opts) sel.appendChild(Object.assign(document.createElement("option"), { value: v, textContent: t }));
      sel.value = cur === null || cur === undefined ? "\u0000" : cur;
      sel.addEventListener("change", () => { if (sel.value !== "\u0000") onChange(sel.value); });
      panel.appendChild(row(name, sel, key));
    };
    /** A number by − value +, within its bounds; `can` false: shown, not changeable, why beside it. */
    const stepper = (/** @type {string} */ name, /** @type {string} */ key, /** @type {number} */ v, /** @type {number} */ step, /** @type {number} */ lo,
      /** @type {number} */ hi, /** @type {string} */ unit, /** @type {boolean} */ can, /** @type {(v: number) => void} */ onChange) => {
      const box = el("span", undefined, { display: "inline-flex", alignItems: "center", gap: ".5rem", flex: "0 0 auto" });
      const down = btn("−", `${name} down`), up = btn("+", `${name} up`);
      const shown = el("span", `${v} ${unit}`, { minWidth: "5.2rem", textAlign: "center" });
      shown.className = "zone-dsp-value";
      // disabled only at a bound: a value off the step reaches it, clamped (the review: 9.1 up to 9.5)
      down.disabled = !can || v <= lo + 1e-9;
      up.disabled = !can || v >= hi - 1e-9;
      down.addEventListener("click", () => onChange(tenth(Math.max(lo, v - step))));
      up.addEventListener("click", () => onChange(tenth(Math.min(hi, v + step))));
      box.append(down, shown, up);
      panel.appendChild(row(name, box, key));
    };

    if (st.kind === "headroom") {
      if (st.canGain) stepper("Gain", "headroom.gain", st.gain, STEP.gain, st.min, st.max, "dB", true, (v) => send("headroom.gain", v));
      if (st.canClipping) {
        const sw = btn(st.clipping ? "On" : "Off", "Clipping indicator");
        Object.assign(sw.style, { width: "auto", minWidth: "4.2rem", padding: "0 .9rem", fontSize: ".95rem",
          background: st.clipping ? "var(--accent, #c9a45c)" : "transparent", color: st.clipping ? "var(--on-accent, #111)" : "inherit" });
        sw.setAttribute("role", "switch");
        sw.setAttribute("aria-checked", st.clipping ? "true" : "false");
        sw.addEventListener("click", () => send("headroom.clipping", !st.clipping));
        panel.appendChild(row("Clipping indicator", sw, "headroom.clipping"));
      }
    } else if (st.kind === "crossfeed") {
      if (st.canPreset) choice("Preset", "crossfeed.preset", st.presets.map((/** @type {string} */ p) => [p, label(p)]), st.preset, (v) => send("crossfeed.preset", v));
      stepper("Cut frequency", "crossfeed.cut", st.cut, STEP.cut, st.cutMin, st.cutMax, "Hz", st.canCut, (v) => send("crossfeed.cut", Math.round(v)));
      stepper("Feed level", "crossfeed.feed", st.feed, STEP.feed, st.feedMin, st.feedMax, "dB", st.canFeed, (v) => send("crossfeed.feed", v));
      // only the custom preset's values can be changed (§15.12): said, rather than buttons that do nothing
      if (!st.canCut || !st.canFeed) panel.appendChild(el("div", "Choose the Custom preset to change these.", { padding: "0 0 .3rem .8rem", fontSize: ".82rem", color: "var(--text-faint)" }));
    } else if (st.kind === "src") {
      if (st.canMode) choice("Mode", "src.mode", st.modes.map((/** @type {string} */ m) => [m, label(m)]), st.mode, (v) => send("src.mode", v));
      if (st.canFilter) choice("Filter", "src.filter", st.filters.map((/** @type {string} */ f) => [f, label(f)]), st.filter, (v) => send("src.filter", v));
      // custom, its rates not all sent yet: said, rather than some shown as if they were all (the review)
      if (st.mode === "custom" && st.canRules && !st.rulesComplete) panel.appendChild(el("div", "Your server hasn't sent the sample rates yet.", { padding: "0 0 .3rem .8rem", fontSize: ".82rem", color: "var(--text-faint)" }));
      for (const r of st.rules || []) {
        choice(`${khz(r.input)} to`, "src.rule", [["", "Same as input"]].concat(r.outputs.map((/** @type {number} */ o) => [String(o), khz(o)])),
          r.output === null ? "" : String(r.output), (v) => send("src.rule", v === "" ? null : Number(v), r.id));
      }
      if (st.canDsdToPcm) choice("DSD to PCM filter", "src.dsdToPcm", st.dsdToPcms.map((/** @type {string} */ f) => [f, label(f)]), st.dsdToPcm, (v) => send("src.dsdToPcm", v));
    }
  }

  /**
   * Whether an item has a setting to show: else its name opens nothing (the review: no empty panel).
   * @param {any} it
   */
  function has(it) {
    const st = it && it.settings;
    if (!st) return false;
    if (st.kind === "headroom") return !!(st.canGain || st.canClipping);
    if (st.kind === "crossfeed") return true;
    if (st.kind === "src") return !!(st.canMode || st.canFilter || st.canDsdToPcm || (st.rules && st.rules.length));
    return false;
  }

  /** @type {any} */ (window).RouenDspSettings = { fill, has };
})();
