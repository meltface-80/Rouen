// @ts-check
/*
 * zone-settings.js — a zone's own settings in the zone sheet — the main remote's "Play on" popover
 * (#mt-zone-popover) and the Shelf's zone menu (#zones) — for the zone chosen there, as the server itself holds them.
 *   N3-3b (dev/design/native-remote.md §15.6, v1.9.66-t6): read (GET /api/roon/zone-settings).
 *   N3-3c (§15.7, v1.9.66-t7): changed — crossfade, the levelling mode and target, the sleep timer
 *   (POST /api/roon/zone-settings). Each change is sent once and shown only as the server then holds it; one not taken
 *   is said, and the control goes back.
 *   v1.9.66-t8 (§15.8): t7's DSP switch is gone — it was a master MUSE never shows.
 *   N3-4 (§15.9, v1.9.66-t9): each output's DSP items as MUSE shows them, each on or off (GET and POST
 *   /api/roon/zone-dsp).
 *   §15.10 (v1.9.66-t10): the items are shown in a window of their own (zone-dsp.js, loaded from here); the sheet keeps
 *   a DSP row saying what is on, which opens it.
 * Nothing is shown when native mode is off, the zone isn't found, or the read fails: the official API carries none of
 * these, so there is nothing truer to show instead.
 *
 * Built here in script, as index.html is at its length baseline: roon-settings.js loads it on the main remote,
 * shelf.html by its own tag. Styled inline, as style.css is at its baseline too; the colours are each page's own.
 */
(function zoneSettings() {
  "use strict";
  // The DSP window (§15.10), beside this script: the main remote loads this one from roon-settings.js, the Shelf by
  // its tag, so the path is taken from this script's own (the DOM harness serves it under its own root).
  const here = document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src;
  const dspScript = Object.assign(document.createElement("script"), { src: here ? new URL("zone-dsp.js", here).href : "/zone-dsp.js", async: false });
  /** Whether the window's script loaded: the row says so when it didn't, rather than leaving DSP out (the review). */
  const dspLoaded = new Promise((done) => { dspScript.onload = () => done(true); dspScript.onerror = () => done(false); });
  document.body.appendChild(dspScript);
  // an item's settings in that window (§15.12): beside it too; not loaded, its items' names simply open nothing
  document.body.appendChild(Object.assign(document.createElement("script"), { src: here ? new URL("zone-dsp-settings.js", here).href : "/zone-dsp-settings.js", async: false }));
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
   * @param {{ close: () => void, button: () => HTMLElement | null }} sheetOf  closes the sheet the section is in; its button
   * @param {HTMLElement | null} [keep]  the DSP row already read, kept rather than read again
   */
  function fill(box, j, zone, sheetOf, keep) {
    const dspRows = () => /** @type {HTMLElement | null} */ (box.querySelector(".zone-dsp"));
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
        // Shown only if the sheet still shows this zone (the review: switched meanwhile, another zone's section stays);
        // the DSP rows kept as they are, not read again for a change to something else.
        if (a && a.seen && a.settings) {
          if (box.dataset.zone === zone && box.isConnected) fill(box, Object.assign({}, j, a.settings), zone, sheetOf, dspRows());
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

    const dsp = keep || el("div");
    dsp.className = "zone-dsp";
    box.append(dsp, status);
    box.hidden = false;
    if (!keep) fillDsp(dsp, zone, box, sheetOf.close, sheetOf.button());
  }

  /**
   * The DSP row (§15.10): what is on beside it, as MUSE's button lights it; tapped, the zone sheet closes and the DSP
   * window opens (zone-dsp.js), as "Group zones…" and "Device power…" do. Read after the settings (calls); no row when
   * the zone has no DSP to show, or no answer came.
   * @param {HTMLElement} dsp @param {string} zone @param {HTMLElement} box @param {() => void} closeSheet
   * @param {HTMLElement | null} returnTo  the sheet's own button, focused when the window closes
   */
  async function fillDsp(dsp, zone, box, closeSheet, returnTo) {
    const W = /** @type {any} */ (window);
    let a;
    try {
      const r = await fetch("/api/roon/zone-dsp?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
      a = r.ok ? await r.json() : null;
    } catch (e) { return; }   // no answer: no DSP row, the settings above as they are
    const loaded = (await dspLoaded) && !!W.RouenZoneDsp;
    const said = loaded ? W.RouenZoneDsp.summary(a) : a && a.found ? "Couldn't load — reload the page" : null;
    if (said === null || !dsp.isConnected || box.dataset.zone !== zone) return;
    dsp.textContent = "";
    // width and height its own: the Shelf's menu sizes its buttons, which are zones, to the menu (shelf-bar.css .zones button)
    const row = /** @type {HTMLButtonElement} */ (el("button", undefined, { display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: ".8rem", width: "100%", minHeight: "0", padding: ".35rem .7rem", font: "inherit", fontSize: ".86rem", color: "inherit",
      background: "transparent", border: "0", textAlign: "left", cursor: "pointer" }));
    row.type = "button";
    row.className = "zone-setting";
    row.dataset.setting = "dsp";
    row.setAttribute("aria-label", `DSP: ${said}. Open DSP`);
    // what is on cut short with "…" rather than pushing the row past the sheet (the review)
    row.append(el("span", "DSP", { color: "var(--text-dim)", flex: "0 0 auto" }), el("span", loaded ? `${said} ›` : said, { color: "var(--text-faint)",
      minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }));
    row.disabled = !loaded;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSheet();
      if (W.RouenZoneDsp) W.RouenZoneDsp.open(zone, returnTo);
    });
    dsp.appendChild(row);
  }

  /**
   * Watches a sheet: each time it opens, the section is put in place and read afresh for the zone it shows.
   * @param {HTMLElement} sheet @param {() => string | null} zoneOf @param {(box: HTMLElement) => void} place
   * @param {{ close: () => void, button: () => HTMLElement | null }} sheetOf
   */
  function watch(sheet, zoneOf, place, sheetOf) {
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
        if (j && j.native && j.found) fill(box, j, zone, sheetOf);
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
      }, (box) => { if (box.previousElementSibling !== list) list.after(box); }, {
        // closed as the popover's own actions close it (app.js popoverAction)
        close: () => {
          pop.classList.add("hidden");
          const b = document.getElementById("mt-zone");
          if (b) b.setAttribute("aria-expanded", "false");
        },
        button: () => document.getElementById("mt-zone"),
      });
    }
    // The Shelf: its menu is written afresh at each opening, so the section goes at its foot each time.
    const zones = document.getElementById("zones");
    if (zones) {
      watch(zones, () => {
        // a zone's button (data-zone), never another button the menu holds
        const b = /** @type {HTMLElement | null} */ (zones.querySelector('button[data-zone][aria-checked="true"]'));
        // Only the zone the menu itself marks: a stored one may not be the zone the Shelf plays in (the review).
        return (b && b.dataset.zone) || null;
      }, (box) => { if (box.parentElement !== zones || box.nextElementSibling) zones.appendChild(box); }, {
        // closed as the Shelf closes it (shelf-player.js closeZones)
        close: () => {
          zones.classList.add("hidden");
          const b = document.getElementById("mt-zone-btn");
          if (b) b.setAttribute("aria-expanded", "false");
        },
        button: () => document.getElementById("mt-zone-btn"),
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
