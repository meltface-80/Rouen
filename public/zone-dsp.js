// @ts-check
/*
 * zone-dsp.js — a zone's DSP in a window of its own (dev/design/native-remote.md §15.10, v1.9.66-t10), opened from
 * the zone sheet's DSP row as Roon opens DSP behind its MUSE button: each output's DSP items (§15.9), each on or off,
 * larger than the zone sheet's rows could show them.
 *
 *   window.RouenZoneDsp.summary(answer)  what is on, as the zone sheet's row says it (null: no row)
 *   window.RouenZoneDsp.open(zone, back)  the window, read afresh for the zone (GET /api/roon/zone-dsp); focus goes
 *                                         to `back` (the zone sheet's own button) when it closes
 *
 * A switch is sent once (POST /api/roon/zone-dsp) and shows only what the server then holds; one not taken is said,
 * and the switch stays as it was. Laid out as the main remote's other sheets (.lib-sheet), its styles inline: the
 * Shelf, which also opens it, has no style.css. Loaded by zone-settings.js, beside it.
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

  /** The window open now, closed by the next open. @type {null | (() => void)} */
  let closeOpen = null;

  /**
   * Opens the window for a zone, read afresh.
   * @param {string} zone  the zone's id @param {HTMLElement | null} [returnTo]  focused when it closes
   */
  function open(zone, returnTo) {
    if (closeOpen) closeOpen();
    // From the foot of the screen at every width, as .lib-sheet: on a wide one all its corners rounded and lifted off
    // the foot (style.css), followed as the screen turns (the review).
    const wide = window.matchMedia ? window.matchMedia("(min-width: 560px)") : null;
    const back = el("div", undefined, { position: "fixed", top: "0", right: "0", bottom: "0", left: "0", zIndex: "90", background: "rgba(0,0,0,.55)",
      display: "flex", alignItems: "flex-end", justifyContent: "center" });
    back.className = "zone-dsp-window";
    const sheet = el("div", undefined, { width: "100%", maxWidth: "560px", maxHeight: "82vh", display: "flex", flexDirection: "column",
      background: "var(--bg-elev, #1f2226)", color: "var(--text, #ecebe6)",
      border: "1px solid var(--border, rgba(255,255,255,.12))", boxShadow: "0 12px 40px rgba(0,0,0,.45)", paddingBottom: "env(safe-area-inset-bottom)" });
    const lay = () => {
      const w = !!(wide && wide.matches);
      sheet.style.borderRadius = w ? "16px" : "16px 16px 0 0";
      sheet.style.marginBottom = w ? "24px" : "0";
    };
    lay();
    sheet.style.maxHeight = "82dvh";   // follows a phone's collapsing toolbars where it is known; 82vh above where not
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "DSP");
    const head = el("div", undefined, { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 14px 8px",
      borderBottom: "1px solid var(--border, rgba(255,255,255,.12))", flex: "0 0 auto" });
    const x = /** @type {HTMLButtonElement} */ (el("button", "✕", { font: "inherit", fontSize: "1.1rem", width: "2.6rem", height: "2.6rem", minHeight: "0",
      border: "0", borderRadius: "999px", background: "transparent", color: "inherit", cursor: "pointer" }));
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    head.append(el("h3", "DSP", { margin: "0", fontSize: "1.05rem", fontWeight: "700" }), x);
    const body = el("div", undefined, { flex: "1 1 auto", minHeight: "0", overflowY: "auto", padding: "4px 14px 8px" });
    const status = el("div", "", { padding: "4px 14px 12px", fontSize: ".85rem", color: "var(--text-faint)", minHeight: "1.2em", flex: "0 0 auto" });
    status.className = "zone-dsp-status";
    status.setAttribute("role", "status");
    sheet.append(head, body, status);
    back.appendChild(sheet);

    // Its keys are its own, taken first (the review): Escape closes it and nothing behind it — an album or Now Playing
    // left open on the main remote, the Shelf's picks; Tab goes round its own controls, never to the page behind.
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const all = /** @type {HTMLElement[]} */ (Array.from(sheet.querySelectorAll("button:not([disabled])")));
      if (!all.length) return;
      const i = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      if (e.shiftKey ? i <= 0 : i === all.length - 1 || i === -1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        (e.shiftKey ? all[all.length - 1] : all[0]).focus();
      }
    };
    function close() {
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      if (wide && wide.removeEventListener) wide.removeEventListener("change", lay);
      if (closeOpen === close) closeOpen = null;
      if (returnTo && returnTo.isConnected && returnTo.focus) returnTo.focus();
    }
    closeOpen = close;
    x.addEventListener("click", close);
    // Its clicks are its own: a page's "tap outside closes the menu" never acts on them.
    back.addEventListener("click", (e) => { e.stopPropagation(); if (e.target === back) close(); });
    document.addEventListener("keydown", onKey, true);
    if (wide && wide.addEventListener) wide.addEventListener("change", lay);
    document.body.appendChild(back);
    x.focus();
    fill(body, status, zone);
  }

  /**
   * The window's items, read afresh: each output with items under its name, a switch for each that can be switched,
   * On or Off for one that can't, and an output not read said with why.
   * @param {HTMLElement} body @param {HTMLElement} status @param {string} zone
   */
  async function fill(body, status, zone) {
    body.textContent = "Reading your server…";
    body.style.color = "var(--text-faint)";
    let a = null;
    try {
      const r = await fetch("/api/roon/zone-dsp?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
      a = r.ok ? await r.json() : null;
    } catch (e) { a = null; }   // no answer: said just below, as for an answer with nothing in it
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
      for (const it of o.items) body.appendChild(rowOf(String(it.name), it.can ? switchOf(it, o, status, zone)
        : el("span", it.on ? "On" : "Off", { color: "var(--text-faint)", padding: "0 .9rem" })));
    }
    body.appendChild(el("p", "Each change pauses playback for a moment.", { margin: "12px 0 4px", fontSize: ".85rem", color: "var(--text-faint)" }));
  }

  /** A row, made to be tapped: a name on the left, `right` on the right. @param {string} name @param {HTMLElement} right */
  function rowOf(name, right) {
    const row = el("div", undefined, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", minHeight: "3rem",
      padding: ".35rem 0", fontSize: "1rem", borderTop: "1px solid var(--border, rgba(255,255,255,.08))" });
    row.className = "zone-dsp-item";
    row.append(el("span", name), right);
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

  /** @type {any} */ (window).RouenZoneDsp = { open, summary };
})();
