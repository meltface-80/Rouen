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

    /** @type {any} the path last read, for the card */
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
      if (!/^[0-9a-fA-F]{2,64}$/.test(zone)) { path = null; paintButton(); return; }
      const n = ++asked;
      /** @type {any} */
      let got = null;
      try {
        const r = await fetch("/api/roon/signal-path?zone_id=" + encodeURIComponent(zone), { cache: "no-store" });
        got = r.ok ? await r.json() : null;
      } catch (e) { got = null; }   // the server unreachable a moment: no path to show, and the next read tries again
      if (n !== asked || zone !== zoneId()) return;
      path = got && got.native && got.found && got.path ? got.path : null;
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
    if (zones) zones.addEventListener("change", () => { path = null; paintButton(); void read(); });
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
