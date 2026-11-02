// @ts-check
/*
 * zone-dsp.js — a zone's DSP on its device's own page, Settings → Audio Devices → a device (dev/design/native-remote.md
 * §15.6, §15.9–§15.12): each output's DSP items, each on or off, an item's settings beneath its name.
 *
 *   window.RouenZoneDsp.summary(answer)  what is on ("Off", the one item's name, "N on", "Can't read"), or null when
 *                                         there is nothing to show
 *   window.RouenZoneDsp.render(host, zone, answer)  the items in [host], from the answer already read (GET
 *                                         /api/roon/zone-dsp)
 *
 * Only there (the owner, 2026-11-02: "Dont duplicate DSP controls … DSP settings only in Audio Devices and for the
 * individual devices"): the zone sheet's DSP row and the window it opened (v1.9.66-t10) went in v1.9.72-t73.
 *
 * A switch is sent once (POST /api/roon/zone-dsp) and shows only what the server then holds; one not taken is said,
 * and the switch stays as it was. An item with settings (§15.12) opens them beneath it when its name is tapped
 * (zone-dsp-settings.js). Styled inline. Loaded by zone-settings.js, beside it.
 */
(function zoneDsp() {
  "use strict";
  const SENDING = "Sending to your server…";

  /** @param {string} tag @param {string} [text] @param {Partial<CSSStyleDeclaration>} [style] */
  function el(tag, text, style) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (style) Object.assign(e.style, style);
    return e;
  }

  /**
   * What is on, as MUSE's button lights it: "Off", the one item's name, "N on", or "Can't read" when an output wasn't
   * read and nothing read is on; null when no output has items or failed to read (no row). Pure.
   * @param {any} a  GET /api/roon/zone-dsp's answer @returns {string | null}
   */
  function summary(a) {
    if (!a || !a.found || !Array.isArray(a.outputs)) return null;
    const items = [];
    let unread = 0;
    for (const o of a.outputs) {
      if (Array.isArray(o.items)) items.push(...o.items);
      else unread++;
    }
    if (!items.length && !unread) return null;
    const on = items.filter((i) => i && i.on === true);
    if (on.length === 1) return String(on[0].name);
    if (on.length > 1) return `${on.length} on`;
    return unread ? "Can't read" : "Off";
  }

  /** A switch shown on or off. @param {HTMLButtonElement} sw @param {boolean} on */
  function showSwitch(sw, on) {
    sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.textContent = on ? "On" : "Off";
    sw.style.background = on ? "var(--accent, #c9a45c)" : "transparent";
    sw.style.color = on ? "var(--on-accent, #111)" : "inherit";
  }

  /** The status line a change is said in. @param {string} padding */
  function statusLine(padding) {
    const status = el("div", "", { padding, fontSize: ".85rem", color: "var(--text-faint)", minHeight: "1.2em", flex: "0 0 auto" });
    status.className = "zone-dsp-status";
    status.setAttribute("role", "status");
    return status;
  }

  /**
   * The DSP in place: a heading, the items and their status line, in [host], inset as the zone settings around it, drawn
   * from [answer] (GET /api/roon/zone-dsp's, already read by the section).
   * @param {HTMLElement} host @param {string} zone @param {any} answer
   */
  function render(host, zone, answer) {
    host.textContent = "";
    host.style.padding = "0 .7rem";
    const head = el("div", "DSP", { margin: ".9rem 0 .1rem", fontSize: ".72rem", fontWeight: "800", letterSpacing: ".12em",
      textTransform: "uppercase", color: "var(--text-faint)" });
    const body = el("div");
    body.className = "zone-dsp-body";
    const status = statusLine("4px 0 8px");
    host.append(head, body, status);
    fill(body, status, zone, answer);
  }

  /**
   * The items, read afresh unless given: each output with items under its name, a switch for each that can be switched,
   * On or Off for one that can't, and an output not read said with why.
   * @param {HTMLElement} body @param {HTMLElement} status @param {string} zone
   * @param {any} [given]  the answer already read (in place, §15.6); otherwise read here
   */
  async function fill(body, status, zone, given) {
    body.textContent = "Reading your server…";
    body.style.color = "var(--text-faint)";
    let a = given === undefined ? null : given;
    if (given === undefined) {
      try {
        const r = await fetch("/api/roon/zone-dsp?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
        a = r.ok ? await r.json() : null;
      } catch (e) { a = null; }   // no answer: said just below, as for an answer with nothing in it
    }
    if (!body.isConnected) return;   // closed meanwhile
    body.textContent = "";
    body.style.color = "";
    if (!a || !a.found || !Array.isArray(a.outputs) || summary(a) === null) {
      body.appendChild(el("p", (a && (a.why || (a.found && "This zone's outputs have no DSP."))) || "Rouen couldn't read this zone's DSP from your server.",
        { margin: "12px 0", color: "var(--text-faint)" }));
      return;
    }
    for (const o of a.outputs) {
      if (Array.isArray(o.items) && !o.items.length) continue;   // an output with no DSP items: nothing to show
      body.appendChild(el("div", o.output || "Output", { margin: "14px 0 4px", fontSize: ".75rem", fontWeight: "700", letterSpacing: ".1em",
        textTransform: "uppercase", color: "var(--text-faint)" }));
      if (!Array.isArray(o.items)) {
        const row = rowOf("Can't read", el("span", "", {}));
        row.appendChild(el("div", o.why || "", { flexBasis: "100%", fontSize: ".85rem", color: "var(--text-faint)" }));
        row.style.flexWrap = "wrap";
        body.appendChild(row);
        continue;
      }
      for (const it of o.items) {
        const right = it.can ? switchOf(it, o, status, zone) : el("span", it.on ? "On" : "Off", { color: "var(--text-faint)", padding: "0 .9rem" });
        const S = /** @type {any} */ (window).RouenDspSettings;
        // an item with settings (§15.12): its name opens them beneath it, and closes them
        if (!S || !S.has(it)) { body.appendChild(rowOf(String(it.name), right)); continue; }
        const panel = el("div", undefined, { padding: "0 0 .4rem" });
        panel.className = "zone-dsp-settings";
        panel.hidden = true;
        const name = /** @type {HTMLButtonElement} */ (el("button", undefined, { font: "inherit", fontSize: "1rem", color: "inherit", background: "transparent",
          border: "0", padding: ".4rem 0", minHeight: "0", width: "auto", textAlign: "left", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: ".5rem" }));
        name.type = "button";
        name.setAttribute("aria-expanded", "false");
        const more = el("span", "›", { color: "var(--text-faint)", display: "inline-block", transition: "transform .15s" });
        name.append(Object.assign(el("span", String(it.name)), { className: "zone-dsp-name" }), more);
        name.addEventListener("click", () => {
          panel.hidden = !panel.hidden;
          name.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
          more.style.transform = panel.hidden ? "" : "rotate(90deg)";
          // drawn afresh at each opening, from the item as last shown (the review: never a stale panel kept)
          if (!panel.hidden) S.fill(panel, /** @type {any} */ (panel).item || it, { zone, status });
        });
        body.append(rowOf(name, right), panel);
      }
    }
    body.appendChild(el("p", "Each change pauses playback for a moment.", { margin: "12px 0 4px", fontSize: ".85rem", color: "var(--text-faint)" }));
  }

  /**
   * A row, made to be tapped: a name (or the button that opens the item's settings) on the left, `right` on the right.
   * @param {string | HTMLElement} name @param {HTMLElement} right
   */
  function rowOf(name, right) {
    const row = el("div", undefined, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", minHeight: "3rem",
      padding: ".35rem 0", fontSize: "1rem", borderTop: "1px solid var(--border, rgba(255,255,255,.08))" });
    row.className = "zone-dsp-item";
    row.append(typeof name === "string" ? Object.assign(el("span", name), { className: "zone-dsp-name" }) : name, right);
    return row;
  }

  /**
   * An item's switch: sent once; shown as the server then holds it; not taken, said and as it was.
   * @param {any} it @param {any} o  its output @param {HTMLElement} status @param {string} zone
   */
  function switchOf(it, o, status, zone) {
    // width and height its own: the Shelf sizes its buttons (shelf-bar.css), which this is not
    const sw = /** @type {HTMLButtonElement} */ (el("button", undefined, { font: "inherit", fontSize: "1rem", display: "inline-block", width: "auto",
      minHeight: "2.4rem", minWidth: "4.6rem", padding: ".3rem 1rem", borderRadius: "999px", border: "1px solid var(--border, rgba(255,255,255,.2))",
      cursor: "pointer", flex: "0 0 auto" }));
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-label", `${it.name}, ${o.output}`);
    sw.dataset.item = String(it.id);
    showSwitch(sw, it.on === true);
    sw.addEventListener("click", async () => {
      const on = sw.getAttribute("aria-checked") !== "true";
      sw.disabled = true;
      status.textContent = SENDING;
      try {
        const r = await fetch("/api/roon/zone-dsp", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone_id: zone, item: String(it.id), on }) });
        // a body that isn't JSON is no answer: said below, and the switch as it was
        const b = await r.json().catch(() => ({}));
        // taken: the switch as the server holds it; the line cleared only of "Sending…", never of what another switch
        // has said meanwhile (§15.9)
        if (b && b.seen && b.item) { showSwitch(sw, b.item.on === true); if (status.textContent === SENDING) status.textContent = ""; }
        else status.textContent = (b && (b.why || b.notSent || b.error)) || "That didn't reach your server.";
      } catch (err) {
        status.textContent = "That didn't reach your server.";   // no answer: said, and the switch as it was
      }
      sw.disabled = false;
    });
    return sw;
  }

  /** @type {any} */ (window).RouenZoneDsp = { summary, render };
})();
