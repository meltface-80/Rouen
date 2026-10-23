// @ts-check
/*
 * zone-settings.js — a zone's own settings in the zone sheet — the main remote's "Play on" popover
 * (#mt-zone-popover) and the Shelf's zone menu (#zones) — for the zone chosen there, as the server itself holds them.
 *   N3-3b (dev/design/native-remote.md §15.6, v1.9.66-t6): read (GET /api/roon/zone-settings).
 *   N3-3c (§15.7, v1.9.66-t7): changed — crossfade, the levelling mode and target, the sleep timer
 *   (POST /api/roon/zone-settings). Each change is sent once and shown only as the server then holds it; one not taken
 *   is said, and the control goes back.
 *   v1.9.66-t8 (§15.8): t7's DSP switch is gone — it was a master MUSE never shows; DSP comes back item by item.
 * Nothing is shown when native mode is off, the zone isn't found, or the read fails: the official API carries none of
 * these, so there is nothing truer to show instead.
 *
 * Built here in script, as index.html is at its length baseline: roon-settings.js loads it on the main remote,
 * shelf.html by its own tag. Styled inline, as style.css is at its baseline too; the colours are each page's own.
 */
(function zoneSettings() {
  "use strict";
  const SECTION = "zone-settings";
  /** The choices offered (§15.7); the current value is added when it is not among them. */
  const CROSSFADE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const LEVELING = [["off", "Off"], ["track", "Track"], ["album", "Album"], ["auto", "Auto"]];
  const TARGETS = [-14, -16, -18, -20, -23];
  const SLEEP = [0, 15, 30, 45, 60, 90, 120];

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
  /** When the timer ends, in this browser's time, or null. @param {any} sl */
  function endsAt(sl) {
    const end = sl && sl.on && sl.ends ? new Date(sl.ends) : null;
    return end && !isNaN(end.getTime()) ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  }

  /**
   * A row: its label and a select of [value, text] choices, the current one chosen. Changed, it calls `send`.
   * @param {string} label @param {string} key @param {Array<[string, string]>} choices @param {string} current
   * @param {(value: string, select: HTMLSelectElement) => void} send @param {string} [note]
   */
  function selectRow(label, key, choices, current, send, note) {
    const row = el("label", undefined, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", padding: ".2rem .7rem", fontSize: ".86rem" });
    row.className = "zone-setting";
    row.dataset.setting = key;
    const name = el("span", label, { color: "var(--text-dim)" });
    if (note) name.appendChild(el("small", " " + note, { color: "var(--text-faint)" }));
    const sel = /** @type {HTMLSelectElement} */ (el("select", undefined, { maxWidth: "60%", font: "inherit", color: "inherit",
      background: "var(--bg-elev-2, transparent)", border: "1px solid var(--border)", borderRadius: ".4rem", padding: ".15rem .3rem" }));
    sel.setAttribute("aria-label", label);
    for (const [v, t] of choices) sel.appendChild(Object.assign(document.createElement("option"), { value: v, textContent: t }));
    sel.value = current;
    sel.dataset.was = current;
    sel.addEventListener("change", () => send(sel.value, sel));
    row.append(name, sel);
    return row;
  }

  /** The choices with the current value among them. @param {number[]} list @param {number} cur */
  const withCurrent = (list, cur) => (list.includes(cur) ? list : list.concat([cur]).sort((a, b) => a - b));

  /**
   * The section, made once per sheet, filled for the zone shown and hidden until it has something to say.
   * @param {HTMLElement} box @param {any} j  the server's answer @param {string} zone
   */
  function fill(box, j, zone) {
    box.textContent = "";
    box.appendChild(el("p", "Zone settings", { margin: ".55rem .7rem .25rem", fontSize: ".72rem", fontWeight: "800",
      letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-faint)" }));
    // not a <p>: the Shelf's menu makes its <p>s headings (shelf-bar.css .zones p), which this is not (the review)
    const status = el("div", "", { margin: ".2rem .7rem .5rem", fontSize: ".74rem", color: "var(--text-faint)", minHeight: "1em" });
    status.className = "zone-settings-status";
    status.setAttribute("role", "status");

    /** One change, sent; the section shown again as the server then holds it, or the control put back and why said. */
    const send = async (/** @type {any} */ body, /** @type {HTMLSelectElement} */ ctl, /** @type {() => void} */ back) => {
      ctl.disabled = true;
      status.textContent = "Sending to your server…";
      try {
        const r = await fetch("/api/roon/zone-settings", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ zone_id: zone }, body)) });
        // a body that isn't JSON is no answer: said below as not reaching the server, the control put back
        const a = await r.json().catch(() => ({}));
        // Shown only if the sheet still shows this zone (the review: switched meanwhile, another zone's section stays).
        if (a && a.seen && a.settings) {
          if (box.dataset.zone === zone && box.isConnected) fill(box, Object.assign({}, j, a.settings), zone);
          return;
        }
        back();
        status.textContent = (a && (a.why || a.notSent || a.error)) || "That didn't reach your server.";
      } catch (e) {
        back();
        status.textContent = "That didn't reach your server.";   // no answer at all: said, and the control as it was
      }
      ctl.disabled = false;
    };
    /** @param {HTMLSelectElement} s */
    const putBack = (s) => () => { s.value = s.dataset.was || s.value; };

    const fade = j.crossfade && j.crossfade.on ? j.crossfade.seconds : 0;
    box.appendChild(selectRow("Crossfade", "crossfade", withCurrent(CROSSFADE, fade).map((n) => [String(n), n ? count(n, "second") : "Off"]),
      String(fade), (v, s) => send({ crossfade: Number(v) }, s, putBack(s))));

    const lv = j.leveling || {};
    const modes = LEVELING.slice();
    const curMode = lv.on ? (lv.mode || `n${lv.value}`) : "off";
    // a value outside the catalogue's enum is shown as Roon's number, and can only be changed away from
    if (lv.on && !lv.mode) modes.push([curMode, `Roon's mode ${lv.value}`]);
    box.appendChild(selectRow("Volume levelling", "leveling", /** @type {Array<[string, string]>} */ (modes), curMode,
      (v, s) => send({ leveling: v }, s, putBack(s))));
    if (lv.on && typeof lv.target === "number") {
      box.appendChild(selectRow("Target", "target", withCurrent(TARGETS, lv.target).map((n) => [String(n), lufs(n)]), String(lv.target),
        (v, s) => send({ target: Number(v) }, s, putBack(s))));
    }

    const sl = j.sleep || {};
    const mins = sl.on && typeof sl.minutes === "number" ? sl.minutes : 0;
    const ends = endsAt(sl);
    box.appendChild(selectRow("Sleep timer", "sleep", withCurrent(SLEEP, mins).map((n) => [String(n), n ? count(n, "minute") : "Off"]),
      String(mins), (v, s) => send({ sleep: Number(v) }, s, putBack(s)), ends ? `ends ${ends}` : undefined));

    box.appendChild(status);
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
      box.dataset.zone = zone;
      try {
        const r = await fetch("/api/roon/zone-settings?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
        const j = r.ok ? await r.json() : null;
        if (mine !== asked || sheet.classList.contains("hidden")) return;   // a newer opening, or closed meanwhile
        if (j && j.native && j.found) fill(box, j, zone);
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
        // a zone's button (data-zone), never another control the menu may hold that is checked the same way
        const b = /** @type {HTMLElement | null} */ (zones.querySelector('button[data-zone][aria-checked="true"]'));
        // Only the zone the menu itself marks: a stored one may not be the zone the Shelf plays in (the review).
        return (b && b.dataset.zone) || null;
      }, (box) => { if (box.parentElement !== zones || box.nextElementSibling) zones.appendChild(box); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
