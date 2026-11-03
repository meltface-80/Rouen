// @ts-check
/*
 * zone-settings.js — a zone's own settings on its device's page, Settings → Audio Devices → a device (audio-devices.js,
 * v1.9.72-t65), as the server itself holds them. Only there (the owner, 2026-11-02: "Dont duplicate DSP controls …
 * DSP settings only in Audio Devices and for the individual devices"): the main remote's "Play on" popover and the
 * Shelf's zone menu, which carried them from v1.9.66-t6, no longer do (v1.9.72-t73).
 *   N3-3b (dev/design/native-remote.md §15.6, v1.9.66-t6): read (GET /api/roon/zone-settings).
 *   N3-3c (§15.7, v1.9.66-t7): changed — crossfade, the levelling mode and target, the sleep timer
 *   (POST /api/roon/zone-settings). Each change is sent once and shown only as the server then holds it; one not taken
 *   is said, and the control goes back.
 *   N3-4 (§15.9, v1.9.66-t9): each output's DSP items as MUSE shows them, each on or off (GET and POST
 *   /api/roon/zone-dsp), drawn in place by zone-dsp.js (loaded from here), an item's settings beneath it.
 * Nothing is shown when native mode is off, the zone isn't found, or the read fails: the official API carries none of
 * these, so there is nothing truer to show instead.
 *
 * Styled inline; the colours are the page's own. window.RouenZoneSettings.watch(page, zoneOf, place) puts the section
 * on a page each time it opens.
 */
(function zoneSettings() {
  "use strict";
  // The DSP's drawing (zone-dsp.js), beside this script: the page loads this one from roon-settings.js, so the path
  // is taken from this script's own (the DOM harness serves it under its own root).
  const here = document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src;
  const dspScript = Object.assign(document.createElement("script"), { src: here ? new URL("zone-dsp.js", here).href : "/zone-dsp.js", async: false });
  /** Whether zone-dsp.js loaded: the page says so when it didn't, rather than leaving DSP out (the review). */
  const dspLoaded = new Promise((done) => { dspScript.onload = () => done(true); dspScript.onerror = () => done(false); });
  document.body.appendChild(dspScript);
  // an item's settings beneath it (§15.12): beside it too; not loaded, its items' names simply open nothing
  document.body.appendChild(Object.assign(document.createElement("script"), { src: here ? new URL("zone-dsp-settings.js", here).href : "/zone-dsp-settings.js", async: false }));
  // a Parametric EQ's bands (§15.15), drawn with that script's rows
  document.body.appendChild(Object.assign(document.createElement("script"), { src: here ? new URL("zone-dsp-peq.js", here).href : "/zone-dsp-peq.js", async: false }));
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
   * The section, made once per page, filled for the zone shown and hidden until it has something to say.
   * @param {HTMLElement} box @param {any} j  the server's answer @param {string} zone
   * @param {HTMLElement | null} [keep]  the DSP already drawn, kept rather than read again
   */
  function fill(box, j, zone, keep) {
    const dspRows = () => /** @type {HTMLElement | null} */ (box.querySelector(".zone-dsp"));
    box.textContent = "";
    box.appendChild(el("p", "Zone settings", { margin: ".55rem .7rem .25rem", fontSize: ".72rem", fontWeight: "800",
      letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-faint)" }));
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
        // Shown only if the page still shows this zone (the review: switched meanwhile, another zone's section stays);
        // the DSP kept as it is, not read again for a change to something else.
        if (a && a.seen && a.settings) {
          if (box.dataset.zone === zone && box.isConnected) fill(box, Object.assign({}, j, a.settings), zone, dspRows());
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
    if (!keep) fillDsp(dsp, zone, box);
  }

  /**
   * The zone's DSP, drawn in place (zone-dsp.js render), read after the settings: nothing when no output has items or
   * could be read, or no answer came; "DSP: Couldn't load — reload the page" when zone-dsp.js didn't load.
   * @param {HTMLElement} dsp @param {string} zone @param {HTMLElement} box
   */
  async function fillDsp(dsp, zone, box) {
    const W = /** @type {any} */ (window);
    let a;
    try {
      const r = await fetch("/api/roon/zone-dsp?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
      a = r.ok ? await r.json() : null;
    } catch (e) { return; }   // no answer: no DSP shown, the settings above as they are
    const loaded = (await dspLoaded) && !!W.RouenZoneDsp;
    const said = loaded ? W.RouenZoneDsp.summary(a) : a && a.found ? "Couldn't load — reload the page" : null;
    if (said === null || !dsp.isConnected || box.dataset.zone !== zone) return;
    dsp.textContent = "";
    if (loaded) W.RouenZoneDsp.render(dsp, zone, a);
    else dsp.appendChild(el("div", "DSP: " + said, { padding: ".35rem .7rem", fontSize: ".86rem", color: "var(--text-faint)" }));
  }

  /**
   * Watches a page: each time it opens, the section is put in place and read afresh for the zone it shows.
   * @param {HTMLElement} sheet  the page @param {() => string | null} zoneOf @param {(box: HTMLElement) => void} place
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
      } catch (e) { /* no answer: the section stays hidden — the page works as before, and nothing untrue is shown */ }
    }
    let shown = !sheet.classList.contains("hidden");
    new MutationObserver(() => {
      const now = !sheet.classList.contains("hidden");
      if (now && !shown) open();
      shown = now;
    }).observe(sheet, { attributes: true, attributeFilter: ["class"] });
    if (shown) open();
  }

  // Settings → Audio Devices' device page (audio-devices.js, v1.9.72-t65) is the section's one place (v1.9.72-t73).
  /** @type {any} */ (window).RouenZoneSettings = { watch };

})();
