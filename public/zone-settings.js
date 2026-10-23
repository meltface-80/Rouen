// @ts-check
/*
 * zone-settings.js — N3-3b (dev/design/native-remote.md §15.6, v1.9.66-t6): a zone's crossfade, volume levelling and
 * sleep timer, shown read only in the zone sheet — the main remote's "Play on" popover (#mt-zone-popover) and the
 * Shelf's zone menu (#zones) — for the zone chosen there, as the server itself holds them
 * (GET /api/roon/zone-settings). Nothing is shown when native mode is off, the zone isn't found, or the read fails:
 * the official API carries none of these, so there is nothing truer to show instead.
 *
 * Built here in script, as index.html is at its length baseline: roon-settings.js loads it on the main remote,
 * shelf.html by its own tag. Styled inline, as style.css is at its baseline too; the colours are each page's own.
 */
(function zoneSettings() {
  "use strict";
  const SECTION = "zone-settings";

  /** @param {string} tag @param {string} [text] @param {Partial<CSSStyleDeclaration>} [style] */
  function el(tag, text, style) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (style) Object.assign(e.style, style);
    return e;
  }

  /** A whole number of minutes or seconds, said. @param {number} n @param {string} unit */
  const count = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  /** A level in LUFS, a minus sign a real one. @param {number} n */
  const lufs = (n) => `${String(n).replace("-", "−")} LUFS`;

  /**
   * What each row says, from the server's answer (lib/roon-direct/zone-settings.js).
   * @param {any} j
   * @returns {Array<[string, string]>}
   */
  function rows(j) {
    const fade = j.crossfade && j.crossfade.on ? count(j.crossfade.seconds, "second") : "Off";
    const lv = j.leveling || {};
    let level = "Off";
    if (lv.on) {
      // Only what the owner's server has shown is named (§15.5); another value is said as Roon's own number.
      level = lv.mode === "album" ? "Album" : `On (Roon's mode ${lv.value})`;
      if (typeof lv.target === "number") level += `, target ${lufs(lv.target)}`;
    }
    const sl = j.sleep || {};
    let sleep = "Off";
    if (sl.on) {
      const end = sl.ends ? new Date(sl.ends) : null;
      sleep = end && !isNaN(end.getTime()) ? `Ends at ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "On";
      if (typeof sl.minutes === "number") sleep += ` (${count(sl.minutes, "minute")})`;
    }
    return [["Crossfade", fade], ["Volume levelling", level], ["Sleep timer", sleep]];
  }

  /**
   * The section, made once per sheet, filled for the zone shown and hidden until it has something to say.
   * @param {HTMLElement} box @param {any} j
   */
  function fill(box, j) {
    box.textContent = "";
    box.appendChild(el("p", "Zone settings", { margin: ".55rem .7rem .25rem", fontSize: ".72rem", fontWeight: "800",
      letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-faint)" }));
    for (const [label, value] of rows(j)) {
      const row = el("div", undefined, { display: "flex", justifyContent: "space-between", gap: ".8rem", padding: ".2rem .7rem", fontSize: ".86rem" });
      row.className = "zone-setting";
      row.append(el("span", label, { color: "var(--text-dim)" }), el("span", value, { textAlign: "right" }));
      box.appendChild(row);
    }
    // not a <p>: the Shelf's menu makes its <p>s headings (shelf-bar.css .zones p), which this is not (the review)
    box.appendChild(el("div", "Read from your server. Change them in Roon for now.", { margin: ".3rem .7rem .5rem",
      fontSize: ".74rem", color: "var(--text-faint)" }));
    box.hidden = false;
  }

  /**
   * Watches a sheet: each time it opens, the section is put in place and read afresh for the zone it shows.
   * @param {HTMLElement} sheet @param {() => string | null} zoneOf @param {(box: HTMLElement) => void} place
   */
  function watch(sheet, zoneOf, place) {
    let asked = 0;
    async function open() {
      let box = /** @type {HTMLElement | null} */ (sheet.querySelector("." + SECTION));
      if (!box) { box = el("div"); box.className = SECTION; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Zone settings"); }
      place(box);
      box.hidden = true;
      // Counted first, so an answer still on its way for an earlier opening never fills this one (the review).
      const mine = ++asked;
      const zone = zoneOf();
      if (!zone) return;
      try {
        const r = await fetch("/api/roon/zone-settings?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
        const j = r.ok ? await r.json() : null;
        if (mine !== asked || sheet.classList.contains("hidden")) return;   // a newer opening, or closed meanwhile
        if (j && j.native && j.found) fill(box, j);
      } catch (e) { /* no answer: the section stays hidden — the zone sheet works as before, and nothing untrue is shown */ }
    }
    let shown = !sheet.classList.contains("hidden");
    new MutationObserver(() => {
      const now = !sheet.classList.contains("hidden");
      if (now && !shown) open();
      shown = now;
    }).observe(sheet, { attributes: true, attributeFilter: ["class"] });
    if (shown) open();
  }

  /** @param {string} key */
  function stored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }   // storage blocked: the sheet's own choice is used first anyway
  }

  function start() {
    // The main remote: the zone chosen in Settings' list, as the popover marks it, under the zones and above the actions.
    const pop = document.getElementById("mt-zone-popover");
    const list = document.getElementById("mt-zone-list");
    if (pop && list) {
      watch(pop, () => {
        const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("zone-select"));
        return (sel && sel.value) || stored("rra-zone");
      }, (box) => { if (box.previousElementSibling !== list) list.after(box); });
    }
    // The Shelf: its menu is written afresh at each opening, so the section goes at its foot each time.
    const zones = document.getElementById("zones");
    if (zones) {
      watch(zones, () => {
        const b = /** @type {HTMLElement | null} */ (zones.querySelector('button[aria-checked="true"]'));
        // Only the zone the menu itself marks: a stored one may not be the zone the Shelf plays in (the review).
        return (b && b.dataset.zone) || null;
      }, (box) => { if (box.parentElement !== zones || box.nextElementSibling) zones.appendChild(box); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
