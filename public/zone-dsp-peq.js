// @ts-check
/*
 * zone-dsp-peq.js — a Parametric EQ's bands in the DSP window (dev/design/native-remote.md §15.15, v1.9.66-t15): each
 * band's gain, frequency and Q by − value +, and each band on or off (the owner's choices), beneath the EQ's name as
 * the other items' settings are (zone-dsp-settings.js, whose rows it draws with).
 *
 *   window.RouenDspPeq.fill(panel, item, { zone, status })   the EQ's bands, read afresh from the server, in the panel
 *
 * Your server never tells Rouen that an EQ changed, so the bands are read afresh at each opening, and before and after
 * each change (lib/roon-direct/peq.js): a change takes a few seconds (a read at most 20 s), and is shown only as the
 * server then holds it.
 * Steps (the owner): gain 0.5 dB, frequency 1/12 octave, Q 0.1; within gain −24 to 24 dB, 20 Hz to 20 kHz, Q 0.1 to 10.
 */
(function dspPeq() {
  "use strict";
  const SENDING = "Sending to your server… a few seconds, as Rouen reads the EQ before and after.";
  const BOUNDS = { gain: [-24, 24], frequency: [20, 20000], q: [0.1, 10] };
  /** One tap of frequency: 1/12 octave (the owner). */
  const SEMITONE = Math.pow(2, 1 / 12);
  /** @param {number} n */
  const tenth = (n) => Math.round(n * 10) / 10;
  /** @param {number} hz */
  const hzText = (hz) => (hz >= 1000 ? `${String(tenth(hz / 1000))} kHz` : `${Math.round(hz)} Hz`);

  /**
   * The next value of a setting, one tap up (dir 1) or down (−1), within its bounds; a value off the step reaches the
   * step, a frequency moves at least 1 Hz.
   * @param {"gain" | "frequency" | "q"} setting @param {number} v @param {number} dir
   */
  function step(setting, v, dir) {
    const [lo, hi] = BOUNDS[setting];
    let next;
    if (setting === "frequency") {
      next = Math.round(dir > 0 ? v * SEMITONE : v / SEMITONE);
      if (next === Math.round(v)) next = Math.round(v) + dir;
    } else {
      const s = setting === "gain" ? 0.5 : 0.1;
      // a value off the step goes to the next one on it (the review: 7.3 up to 7.5, not 7.8)
      next = tenth(dir > 0 ? Math.floor(v / s + 1e-9) * s + s : Math.ceil(v / s - 1e-9) * s - s);
    }
    return Math.min(hi, Math.max(lo, next));
  }

  /**
   * The EQ's bands, in the panel, read afresh.
   * @param {HTMLElement} panel @param {any} it  the item @param {{ zone: string, status: HTMLElement }} ctx
   */
  async function fill(panel, it, ctx) {
    const ui = /** @type {any} */ (window).RouenDspSettings.ui;
    /** @type {any} */ (panel).item = it;
    panel.textContent = "";
    const note = (/** @type {string} */ t) => panel.appendChild(ui.el("div", t, { padding: ".3rem 0 .3rem .8rem", fontSize: ".85rem", color: "var(--text-faint)" }));
    note("Reading the EQ from your server…");
    /** @type {any} */
    let a = null;
    try {
      const r = await fetch(`/api/roon/zone-dsp/peq?zone_id=${encodeURIComponent(ctx.zone)}&item=${encodeURIComponent(String(it.id))}`, { cache: "no-store" });
      a = await r.json().catch(() => null);   // a body that isn't JSON is no answer: said just below
    } catch (e) { a = null; }   // no answer: said just below
    if (!panel.isConnected || panel.hidden) return;   // closed meanwhile
    if (!a || !a.item) { panel.textContent = ""; note((a && a.why) || "Rouen couldn't read the EQ from your server."); return; }
    draw(panel, it, a.item, ctx);
  }

  /**
   * The bands as read.
   * @param {HTMLElement} panel @param {any} it @param {{ gain: number, bands: any[] }} view @param {{ zone: string, status: HTMLElement }} ctx
   */
  function draw(panel, it, view, ctx) {
    const ui = /** @type {any} */ (window).RouenDspSettings.ui;
    panel.textContent = "";
    /** Sent once; the bands shown afresh as the server then holds them, or as they were, and why said. */
    const send = async (/** @type {number} */ band, /** @type {string} */ setting, /** @type {any} */ value) => {
      for (const c of panel.querySelectorAll("button")) /** @type {HTMLButtonElement} */ (c).disabled = true;
      ctx.status.textContent = SENDING;
      let next = view;
      try {
        const r = await fetch("/api/roon/zone-dsp/peq", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone_id: ctx.zone, item: String(it.id), band, setting, value }) });
        const b = await r.json().catch(() => ({}));   // a body that isn't JSON is no answer: said below
        if (b && b.item && Array.isArray(b.item.bands)) next = b.item;
        if (b && b.seen) { if (ctx.status.textContent === SENDING) ctx.status.textContent = ""; }
        else ctx.status.textContent = (b && (b.why || b.notSent || b.error)) || "That didn't reach your server.";
      } catch (e) {
        ctx.status.textContent = "That didn't reach your server.";   // no answer: said, and the bands as they were
      }
      if (panel.isConnected) draw(panel, it, next, ctx);
    };
    panel.appendChild(ui.el("div", `EQ gain ${tenth(view.gain)} dB`, { padding: ".2rem 0 .2rem .8rem", fontSize: ".85rem", color: "var(--text-faint)" }));
    for (const b of view.bands) {
      if (b.empty) continue;
      // a band of a type Rouen doesn't know: said on or off, not a switch the server would refuse (the review)
      const sw = b.can.on ? ui.btn(b.on ? "On" : "Off", `Band ${b.n} on`) : ui.el("span", b.on ? "On" : "Off", { color: "var(--text-faint)", padding: "0 .9rem" });
      if (b.can.on) {
        Object.assign(sw.style, { width: "auto", minWidth: "4.2rem", padding: "0 .9rem", fontSize: ".95rem",
          background: b.on ? "var(--accent, #c9a45c)" : "transparent", color: b.on ? "var(--on-accent, #111)" : "inherit" });
        sw.setAttribute("role", "switch");
        sw.setAttribute("aria-checked", b.on ? "true" : "false");
        sw.addEventListener("click", () => send(b.n, "on", !b.on));
      }
      const head = ui.row(`Band ${b.n} · ${b.label}`, sw, "peq.on");
      head.dataset.band = String(b.n);
      Object.assign(head.style, { borderTop: "1px solid var(--border, rgba(255,255,255,.08))", color: "inherit" });
      panel.appendChild(head);
      /** A number by − value +. */
      const stepper = (/** @type {"gain" | "frequency" | "q"} */ setting, /** @type {string} */ name, /** @type {number} */ v, /** @type {string} */ shown) => {
        const box = ui.el("span", undefined, { display: "inline-flex", alignItems: "center", gap: ".5rem", flex: "0 0 auto" });
        const down = ui.btn("−", `Band ${b.n} ${name} down`), up = ui.btn("+", `Band ${b.n} ${name} up`);
        const value = ui.el("span", shown, { minWidth: "5.2rem", textAlign: "center" });
        value.className = "zone-dsp-value";
        const [lo, hi] = BOUNDS[setting];
        // disabled only at a bound: a value off the step reaches it (the review)
        down.disabled = v <= lo + 1e-9;
        up.disabled = v >= hi - 1e-9;
        down.addEventListener("click", () => send(b.n, setting, step(setting, v, -1)));
        up.addEventListener("click", () => send(b.n, setting, step(setting, v, 1)));
        box.append(down, value, up);
        const r = ui.row(name, box, "peq." + setting);
        r.dataset.band = String(b.n);
        panel.appendChild(r);
      };
      if (b.can.gain) stepper("gain", "Gain", b.gain, `${tenth(b.gain)} dB`);
      if (b.can.frequency && typeof b.frequency === "number") stepper("frequency", "Frequency", b.frequency, hzText(b.frequency));
      if (b.can.q && typeof b.q === "number") stepper("q", "Q", b.q, String(tenth(b.q)));
      // a high or low pass: its slope, as MUSE says it, not changed here
      if (!b.can.q && typeof b.order === "number") panel.appendChild(ui.el("div", `${b.order * 6} dB/octave`, { padding: "0 0 .3rem .8rem", fontSize: ".85rem", color: "var(--text-faint)" }));
    }
  }

  /** @type {any} */ (window).RouenDspPeq = { fill, step };
})();
