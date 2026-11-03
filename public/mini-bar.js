// @ts-check
/*
 * mini-bar.js — the mini player's words when nothing is playing, and the last track kept for the next start
 * (v1.9.72-t26; the keeping and the cover moved out of app.js, behaviour unchanged). app.js's mini transport drives
 * the bar and calls these.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 *   RouenMiniBar.idleSig(zone)          what the idle bar shows, as one string ("idle|…"), so app.js repaints on change
 *   RouenMiniBar.idle(els, zone)        a zone with nothing playing (its name over "Nothing playing"), or none (null)
 *   RouenMiniBar.art(img, imageKey)     the cover, or none (hidden rather than a broken image)
 *   RouenMiniBar.save(zone)             the track playing, kept for the next start (localStorage "rra-transport")
 *   RouenMiniBar.restore(els)           true when a kept track was painted
 *
 * The bar is always there (the owner, 2026-10-30: "I want the mini transport bar to be permanently visible on the
 * android app as well as browsers"), as Mandarin's is: with no zone it says so and the speaker is where one is chosen.
 * Only Now playing, which has its own transport, hides it (app.js, refreshVisibility).
 *
 * In the Android app (its User-Agent ends "RouenAndroid/<version>", MainActivity.kt) <html> gets rouen-app, and
 * touchnav.css docks the bar on the row along the foot, solid, as Mandarin's app has it (its bug list item 102).
 * Set here, before app.js paints anything.
 */
(() => {
  document.documentElement.classList.toggle("rouen-app", /\bRouenAndroid\//.test(navigator.userAgent || ""));

  const KEY = "rra-transport";

  /**
   * @typedef {{ title: HTMLElement, artist: HTMLElement, kicker: HTMLElement | null, art: HTMLImageElement | null,
   *   btnPP: HTMLElement, iconPlay: HTMLElement, iconPause: HTMLElement, iconVol: HTMLElement, iconMute: HTMLElement }} Els
   */

  /** @param {any} zone */
  function muted(zone) { return !!(zone && (zone.outputs || []).some((/** @type {any} */ o) => o.is_muted)); }

  /** @param {any} zone */
  function idleSig(zone) {
    return "idle|" + (zone ? zone.zone_id + "|" + (zone.display_name || "") + "|" + muted(zone) : "");
  }

  /** @param {Els} els @param {any} zone */
  function idle(els, zone) {
    if (els.kicker) els.kicker.textContent = zone ? zone.display_name || "" : "";
    els.title.textContent  = zone ? "Nothing playing" : "No Zone Selected";
    els.artist.textContent = zone ? "Pick an album to play here" : "Tap the speaker to choose where to play";
    art(els.art, "");
    els.iconPlay.classList.remove("hidden"); els.iconPause.classList.add("hidden");
    els.btnPP.setAttribute("aria-label", "Play");
    const m = muted(zone);
    els.iconVol.classList.toggle("hidden", m); els.iconMute.classList.toggle("hidden", !m);
  }

  // The cover for the playing track. Hidden rather than broken when the zone
  // reports no art (a stream, a zone mid-handshake): an empty <img> draws the
  // browser's broken-image glyph, which looks like a fault.
  /** @param {HTMLImageElement | null} img @param {string | null | undefined} imageKey */
  function art(img, imageKey) {
    if (!img) return;
    if (imageKey) {
      const src = `/api/image/${encodeURIComponent(imageKey)}?size=120`;
      // Guarded: assigning the same src restarts the request on some browsers,
      // and this runs off a 1.5s poll.
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      img.classList.remove("hidden");
    } else {
      img.removeAttribute("src");
      img.classList.add("hidden");
    }
  }

  let lastSig = "";
  /** @param {any} zone */
  function save(zone) {
    if (!zone || !zone.now_playing) return;
    const np = zone.now_playing;
    // The 1.5s poll calls this every tick — synchronous localStorage writes
    // are only worth paying when the persisted fields actually changed.
    const sig = [np.line1, np.line2, np.line3, np.image_key, zone.state].join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        line1: np.line1 || "", line2: np.line2 || "", line3: np.line3 || "",
        image_key: np.image_key || "", state: zone.state || "stopped"
      }));
    } catch (e) { /* localStorage optional — keeping the last track is best-effort */ }
  }

  /** @param {Els} els */
  function restore(els) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!saved || !saved.line1) return false;
      els.title.textContent  = saved.line1;
      const sub = [saved.line2, saved.line3].filter(Boolean).join(" · ");
      els.artist.textContent = sub || "—";
      art(els.art, saved.image_key);
      return true;
    } catch (e) { return false; } // corrupt localStorage — the first poll paints the bar, no action needed
  }

  /** @type {any} */ (window).RouenMiniBar = { idleSig, idle, art, save, restore };
})();
