// @ts-check
/*
 * signal-path.js — Roon's signal path on Now playing (v2.0.3-t15, dev/design/signal-path.md; the owner, 2026-11-09:
 * "I also want Roons signal path to be visible from the now playing screen in a similar means to roon"). Under the
 * album name, a button: a dot in the path's colour and what the source plays ("FLAC 44.1kHz 16-bit"); a tap opens a
 * card listing each step with its own dot, a name and what it does, the path's quality in words and Roon's processing
 * speed. Its look is signal-path.css, loaded beside it.
 *
 * Read from /api/roon/signal-path (lib/roon-direct/signal-path.js: the zone's path as the native connection holds it)
 * for the selected zone (window.__selectedZoneId), when Now playing opens, when its track changes and every 5 seconds
 * while it shows (not while the page is in the background), and at once when another zone is chosen. Hidden when there
 * is no path to show: native mode off, no connection, a zone Roon's connection doesn't hold (a phone's), no quality to
 * say. An answer for a zone no longer selected is dropped. Not said: Clipping (signal-path.md §5).
 *
 * Away from home (2.0.4-t3, signal-path.md §3.4; the owner, 2026-11-10: "away from home needs to be taken into
 * consideration and shown within the signal path to show true transparency and correctness"), Roon's path ends at the
 * phone's zone on Rouen's server, and Rouen's own leg follows it: a "Rouen" step, the Opus 256 kbps Rouen's server
 * encodes or the lossless it passes through, as Now playing's format badge says it (#np-format, from the server's
 * now_playing.format). Opus makes the path "High quality", green: what reaches the phone is lossy. In the app, on this
 * phone's own zone, a last step, "This phone", says where the sound comes out (RouenPhone.output(): Bluetooth, wired,
 * USB, the speaker; never a Bluetooth codec, which the app can't read).
 *
 * Loaded by album-view.js (index.html is at its length baseline).
 */
(function signalPath() {
  "use strict";
  const W = /** @type {any} */ (window);
  const EVERY_MS = 5000;
  /** The quality in words (signal-path.md §3.1). */
  const WORDS = Object.freeze(/** @type {Record<string, string>} */ ({ enhanced: "Enhanced", lossless: "Lossless", high: "High quality", low: "Low quality" }));

  const here = document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src;
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: here ? new URL("signal-path.css", here).href : "/signal-path.css" }));

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  /** A dot of a quality. @param {string | null} q */
  const dot = (q) => { const d = el("span", "sp-dot" + (q ? " is-" + q : "")); d.setAttribute("aria-hidden", "true"); return d; };
  /** The qualities in order, best last: a path is no better than its worst step. */
  const RANK = Object.freeze(/** @type {Record<string, number>} */ ({ low: 1, high: 2, lossless: 3, enhanced: 4 }));

  /**
   * Rouen's leg from the phone's zone on Rouen's server, as Now playing's format badge says it; null when the badge
   * says nothing (every zone but a phone's on Rouen's server). @param {HTMLElement | null} fmt
   */
  function rouenLeg(fmt) {
    if (!fmt || fmt.classList.contains("hidden")) return null;
    const t = fmt.querySelector(".np-format-text");
    const said = t ? String(t.textContent || "").trim() : "";
    if (fmt.classList.contains("is-opus")) return { kind: "Rouen", quality: "high", name: "Rouen", text: "Encoded to Opus " + (said ? said.replace(/kbps$/, " kbps") : "") + " by Rouen's server" };
    if (fmt.classList.contains("is-lossless")) {
      const more = said.replace(/^Lossless\s*(·\s*)?/, "");
      return { kind: "Rouen", quality: "lossless", name: "Rouen", text: "Passed through lossless by Rouen's server" + (more ? " · " + more : "") };
    }
    return null;
  }

  /** Where this phone's sound comes out, said as a step's line: "Bluetooth (A2DP)". @param {any} out */
  function outWords(out) {
    const s = typeof out === "string" ? out.trim() : "";
    if (!s) return null;
    const w = s.startsWith("to ") ? s.slice(3) : s.startsWith("connected: ") ? "Connected: " + s.slice(11) : s;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  /**
   * "This phone", when the page is the app's and the zone chosen is this phone's own (the app's name for it, as Audio
   * Devices finds it); null otherwise. @param {string | null} quality  the step before's
   */
  function phoneStep(quality) {
    const b = W.RouenPhone;
    if (!b || typeof b.output !== "function" || typeof b.localState !== "function") return null;
    let mine = "", out = null;
    try { mine = String(JSON.parse(b.localState()).roon_zone || ""); } catch (e) { return null; }   // no answer: no zone is the phone's
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("zone-select"));
    const opt = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    if (!mine || !opt || opt.textContent !== mine) return null;
    try { out = JSON.parse(b.output()).output; } catch (e) { out = null; }   // Android would not say: the step's name alone
    return { kind: "Phone", quality, name: "This phone", text: outWords(out) };
  }

  /**
   * Roon's path with Rouen's leg and the phone after it, and its quality the worse of Roon's and Rouen's leg's.
   * @param {any} p  Roon's path, as the server read it @param {HTMLElement | null} fmt
   */
  function whole(p, fmt) {
    if (!p || !p.quality) return p;
    const steps = (p.steps || []).slice();
    let quality = p.quality;
    const leg = rouenLeg(fmt);
    if (leg) {
      steps.push(leg);
      if (RANK[leg.quality] && RANK[quality] && RANK[leg.quality] < RANK[quality]) quality = leg.quality;
    }
    const last = steps.length ? steps[steps.length - 1].quality : quality;
    const phone = phoneStep(last || quality);
    if (phone) steps.push(phone);
    return Object.assign({}, p, { quality, steps });
  }

  function start() {
    const fmt = document.getElementById("np-format");
    const modal = document.getElementById("album-modal");
    const track = document.getElementById("np-track");
    if (!fmt || !modal) return;
    const btn = /** @type {HTMLButtonElement} */ (el("button", "np-signal hidden"));
    btn.type = "button";
    btn.id = "np-signal";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    fmt.insertAdjacentElement("afterend", btn);

    /** @type {any} Roon's path as last read */
    let raw = null;
    /** @type {any} the path shown: Roon's, with Rouen's leg and the phone after it (whole) */
    let path = null;
    let asked = 0;
    let shown = "";
    /** The path the open card says, so a read saying the same leaves it be (its scroll and focus kept). */
    let painted = "";
    /** @type {HTMLElement | null} */
    let card = null;

    const onNowPlaying = () => !modal.classList.contains("hidden") && modal.classList.contains("np-mode");
    const zoneId = () => { try { return String((W.__selectedZoneId && W.__selectedZoneId()) || ""); } catch (e) { return ""; } };   // no zone chosen yet: nothing to read

    /** The button, as the path says it; hidden when there is nothing to say. */
    function paintButton() {
      const q = path && path.quality && WORDS[path.quality] ? path.quality : null;
      const sig = q ? q + "|" + (path.format || "") : "";
      if (sig === shown) return;
      shown = sig;
      btn.textContent = "";
      btn.classList.toggle("hidden", !q);
      if (!q) { btn.removeAttribute("aria-label"); closeCard(); return; }
      btn.appendChild(dot(q));
      btn.appendChild(el("span", "np-signal-text", path.format || WORDS[q]));
      btn.setAttribute("aria-label", "Signal path: " + WORDS[q] + (path.format ? ". " + path.format : ""));
    }

    /** The card's head and steps, as the path says them. @param {HTMLElement} body */
    function paintCard(body) {
      body.textContent = "";
      if (!path || !path.quality) return;
      const head = el("div", "sp-head");
      const q = el("div", "sp-quality");
      q.append(dot(path.quality), WORDS[path.quality] || "");
      head.appendChild(q);
      if (typeof path.speed === "number") head.appendChild(el("div", "sp-speed", "Processing speed " + (Math.round(path.speed * 10) / 10) + "×"));
      body.appendChild(head);
      const list = el("ol", "sp-steps");
      for (const s of path.steps || []) {
        const li = el("li", "sp-step");
        li.appendChild(dot(s.quality));
        const words = el("div", "sp-words");
        words.appendChild(el("div", "sp-name", s.name));
        if (s.text) words.appendChild(el("div", "sp-text", s.text));
        li.appendChild(words);
        list.appendChild(li);
      }
      body.appendChild(list);
    }

    function openCard() {
      if (card || !path || !path.quality) return;
      card = el("div", "sp-card-wrap");
      const panel = el("div", "sp-card");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", "sp-title");
      const top = el("div", "sp-top");
      const h = el("h2", "sp-title", "Signal path");
      h.id = "sp-title";
      top.appendChild(h);
      const x = /** @type {HTMLButtonElement} */ (el("button", "sp-close icon-btn", "×"));
      x.type = "button";
      x.setAttribute("aria-label", "Close");
      x.addEventListener("click", closeCard);
      top.appendChild(x);
      panel.appendChild(top);
      panel.appendChild(el("div", "sp-body"));
      card.appendChild(panel);
      card.addEventListener("click", (e) => { if (e.target === card) closeCard(); });
      document.body.appendChild(card);
      painted = JSON.stringify(path);
      paintCard(/** @type {HTMLElement} */ (panel.querySelector(".sp-body")));
      btn.setAttribute("aria-expanded", "true");
      x.focus();
    }
    function closeCard() {
      if (!card) return;
      card.remove();
      card = null;
      painted = "";
      btn.setAttribute("aria-expanded", "false");
      // Focus back where the card came from (a tap focuses no button on every browser), if it is still to be seen.
      if (!btn.classList.contains("hidden") && onNowPlaying()) btn.focus({ preventScroll: true });
    }

    /** Read the selected zone's path, if Now playing shows; an answer for a zone no longer selected, dropped. */
    async function read() {
      if (!onNowPlaying()) { closeCard(); return; }
      const zone = zoneId();
      if (!/^[0-9a-fA-F]{2,64}$/.test(zone)) { raw = null; path = null; paintButton(); return; }
      const n = ++asked;
      /** @type {any} */
      let got = null;
      try {
        const r = await fetch("/api/roon/signal-path?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
        got = r.ok ? await r.json() : null;
      } catch (e) { got = null; }   // the server unreachable a moment: no path to show, and the next read tries again
      if (n !== asked || zone !== zoneId()) return;
      raw = got && got.native && got.found && got.path ? got.path : null;
      repaint();
    }

    /** The path shown, from Roon's last read and Rouen's leg as the badge says it now. */
    function repaint() {
      path = whole(raw, fmt);
      paintButton();
      const body = card && card.querySelector(".sp-body");
      if (!body) return;
      if (!path || !path.quality) { closeCard(); return; }
      const sig = JSON.stringify(path);
      if (sig !== painted) { painted = sig; paintCard(/** @type {HTMLElement} */ (body)); }
    }

    btn.addEventListener("click", openCard);
    document.addEventListener("keydown", (e) => {
      if (!card) return;
      if (e.key === "Escape") { e.stopPropagation(); closeCard(); }
      // The card is modal: Tab stays on its one control, the close button.
      else if (e.key === "Tab") { e.preventDefault(); const x = /** @type {HTMLElement | null} */ (card.querySelector(".sp-close")); if (x) x.focus(); }
    }, true);
    // Another zone chosen: the last zone's path is not this one's, so it goes at once and the new zone's is read.
    const zones = document.getElementById("zone-select");
    if (zones) zones.addEventListener("change", () => { raw = null; path = null; paintButton(); void read(); });
    // The format badge changed (the phone's server switched Opus and lossless, or the zone is no phone's): Rouen's leg
    // follows it at once.
    new MutationObserver(repaint).observe(fmt, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true, characterData: true });
    // Now playing opened or closed, and its track changed: read again (closing it closes the card).
    new MutationObserver(() => { if (!onNowPlaying()) { closeCard(); return; } void read(); }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    if (track) new MutationObserver(() => { void read(); }).observe(track, { childList: true, characterData: true, subtree: true });
    setInterval(() => { if (onNowPlaying() && !document.hidden) void read(); }, EVERY_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && onNowPlaying()) void read(); });
    void read();
    W.RouenSignalPath = { read, open: openCard, close: closeCard };
  }

  if (document.getElementById("np-format")) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
