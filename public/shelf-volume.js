// @ts-check
/*
 * shelf-volume.js — the Shelf page's volume sheet (moved out of shelf.js in
 * v1.9.10, behaviour unchanged but for the slider's fill).
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * The zone's first output's volume, as the remote reads it. A zone whose
 * volume is fixed has none, and its button is off. Loaded before shelf.js,
 * which creates one with the page's own lookups:
 *
 *   const vol = ShelfVolume.create({ zone, zoneId, clamp, onOpen });
 *   vol.sync(zone)   after every poll: the button, and the sheet if open
 *   vol.close()
 */
(() => {
  "use strict";

  /** @param {string} s */
  const $ = (s) => /** @type {any} */ (document.querySelector(s));

  /**
   * @param {object} o
   * @param {() => any} o.zone            the zone the bar shows (the last poll's)
   * @param {() => string} o.zoneId       the zone volume is sent to
   * @param {(x: number, a: number, b: number) => number} o.clamp
   * @param {() => void} o.onOpen         closes whatever else is open over the bar
   */
  function create(o) {
    /** @param {any} zone */
    function volumeOf(zone) {
      const out = zone && Array.isArray(zone.outputs) ? zone.outputs.find((x) => x && x.volume) : null;
      return out ? out.volume : null;
    }
    let holdUntil = 0;
    /** @type {number|null} the value on screen while it is held against the poll */
    let shown = null;
    const held = () => Date.now() < holdUntil;
    /** @param {any} v */
    const absolute = (v) => !!v && v.type !== "incremental" && Number.isFinite(Number(v.value));
    /** @param {any} v */
    const lowest = (v) => (Number.isFinite(Number(v.min)) ? Number(v.min) : 0);
    // The top of the range: an output's soft limit where it has one, as the
    // remote's volCeiling — past it Roon clamps, and the thumb would snap back.
    /** @param {any} v */
    function ceiling(v) {
      const max = Number.isFinite(Number(v.max)) ? Number(v.max) : 100;
      return Number.isFinite(Number(v.soft_limit)) ? Math.min(max, Number(v.soft_limit)) : max;
    }
    // How far along the slider is filled (v1.9.10, from Mandarin v0.8.28):
    // shelf.css draws a thicker track than the browser's hairline, filled to
    // the level, and needs the fraction to draw it.
    function fill() {
      // Read with Number.isFinite, never ||: a dB volume runs -80 to 0, and
      // `|| 100` would take its 0 for a missing maximum.
      const s = $("#vol-slider"), min = Number(s.min), max = Number(s.max);
      const lo = Number.isFinite(min) ? min : 0, hi = Number.isFinite(max) ? max : 100;
      s.style.setProperty("--fill", (hi > lo ? o.clamp((Number(s.value) - lo) / (hi - lo), 0, 1) * 100 : 0).toFixed(1) + "%");
    }
    /** @param {any} v */
    function paint(v) {
      const slider = $("#vol-slider");
      const abs = absolute(v);
      slider.classList.toggle("hidden", !abs);
      if (abs) {
        slider.min = String(lowest(v));
        slider.max = String(ceiling(v));
        slider.step = String(Number(v.step) > 0 ? v.step : 1);
        slider.value = String(v.value);
        shown = Number(v.value);
        fill();
      }
      $("#vol-value").textContent = abs ? String(Math.round(Number(v.value))) : "";
    }
    /** @param {object} body */
    async function send(body) {
      // The answer comes once Roon has acted; a dropped Core must not leave a
      // request hanging for ever (the remote's v1.7.69 lesson).
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
      try {
        await fetch("/api/volume", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ zone_or_output_id: o.zoneId() }, body)),
          signal: ctl ? ctl.signal : undefined
        });
      } catch (e) { /* the next poll shows the volume the zone really has */ }
      finally { if (t) clearTimeout(t); }
    }
    function open() {
      const v = volumeOf(o.zone());
      if (!v) return;
      o.onOpen();
      paint(v);
      $("#vol").classList.remove("hidden");
      $("#mt-vol-btn").setAttribute("aria-expanded", "true");
    }
    function close() { $("#vol").classList.add("hidden"); $("#mt-vol-btn").setAttribute("aria-expanded", "false"); }
    $("#mt-vol-btn").addEventListener("click", (/** @type {Event} */ e) => { e.stopPropagation(); if ($("#vol").classList.contains("hidden")) open(); else close(); });
    $("#vol").addEventListener("click", (/** @type {Event} */ e) => e.stopPropagation());
    // A drag is dozens of values a second: one write at a time, and while one is
    // out only the newest value waits — so the zone follows the finger during
    // the drag, not only once it stops.
    let sending = false;
    /** @type {number|null} */
    let next = null;
    /** @param {number} value */
    async function push(value) {
      next = value;
      if (sending) return;
      sending = true;
      while (next !== null) {
        const v = next; next = null;
        await send({ value: v });
      }
      sending = false;
    }
    /** @param {number} value */
    function show(value) {
      shown = value;
      $("#vol-slider").value = String(value);
      fill();
      $("#vol-value").textContent = String(Math.round(value));
      holdUntil = Date.now() + 2500;   // held against the poll
    }
    $("#vol-slider").addEventListener("input", () => {
      const value = Number($("#vol-slider").value);
      show(value);
      push(value);
    });
    for (const [id, sign] of /** @type {Array<[string, number]>} */ ([["#vol-minus", -1], ["#vol-plus", 1]])) {
      $(id).addEventListener("click", () => {
        const v = volumeOf(o.zone());
        if (!v) return;
        const step = Number(v.step) > 0 ? Number(v.step) : 1;
        if (absolute(v)) {
          // From what is on screen — a drag or a tap the poll has not caught up
          // with yet — never from the last poll's value.
          const from = held() && shown !== null ? shown : Number(v.value);
          const to = o.clamp(from + sign * step, lowest(v), ceiling(v));
          show(to);
          push(to);
        } else {
          send({ relative: sign * step });   // incremental: only steps exist
        }
      });
    }
    document.addEventListener("click", (e) => {
      const t = /** @type {Element|null} */ (e.target);
      if (!$("#vol").classList.contains("hidden") && !(t && t.closest("#vol"))) close();
    });
    // After every poll: the button is off for a fixed-volume zone, and an open
    // sheet follows the zone unless a change made here is still being held.
    /** @param {any} zone */
    function sync(zone) {
      const v = volumeOf(zone);
      $("#mt-vol-btn").disabled = !v;
      if (!v) close();
      else if (!$("#vol").classList.contains("hidden") && !held()) paint(v);
    }
    return { sync, close };
  }

  /** @type {any} */ (window).ShelfVolume = { create };
})();
