// @ts-check
/*
 * shelf-ways.js — the Shelf's ways out and its housekeeping: back to the
 * remote and on to the wall display, back to the wall display when left
 * alone, keeping up with the library and the settings, and the help said once
 * (v1.9.3). Moved out of shelf.js in v1.9.66, behaviour unchanged.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h: the
 * shelf's own state and helpers, and the other parts):
 *
 *   const ways = ShelfWays.create(h);
 *   ways.checkWall(), ways.checkIdle(), ways.checkLive(), ways.maybeShowHelp()
 *   ways.touched(), ways.idleAt()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, jget, storeGet, storeSet, stage } = h;

    // ---- Ways out: the remote, and the wall display ------------------------------
    // The remote marks the tab when it opens this page or the wall display
    // (sessionStorage), and is then the page right behind it — so going BACK
    // returns it as it was left. The wall display and Shelf REPLACE each other,
    // so flipping between them never grows the history. Opened any other way (a
    // kiosk's start page, a bookmark) there is no remote behind this page, so it
    // loads one. The timer catches a back that goes nowhere.
    let backTimer = null;
    function goRemote() {
      let fromRemote = false;
      try { fromRemote = sessionStorage.getItem("rra-display-from-remote") === "1"; }
      catch (e) { /* storage blocked — load the remote, which always works */ }
      if (fromRemote && window.history.length > 1) {
        clearTimeout(backTimer);
        backTimer = setTimeout(() => location.assign("/"), 3000);
        window.history.back();
        return;
      }
      location.assign("/");
    }
    // Only a zone that was GIVEN goes along — by the remote, or picked here (the
    // chooser writes it into the address). A wall display opened without one
    // follows the music, and must still do so after a trip through Shelf.
    const wallUrl = () => { const z = new URLSearchParams(location.search).get("zone"); return "/display" + (z ? "?zone=" + encodeURIComponent(z) : ""); };
    $("#to-remote").addEventListener("click", goRemote);
    $("#to-wall").addEventListener("click", () => location.replace(wallUrl()));
    window.addEventListener("pagehide", () => { clearTimeout(backTimer); backTimer = null; });
    // Offered only while the wall display is switched on: with it off, that page
    // says only so.
    let wallOn = false;
    // Read at start and whenever /api/live says a setting changed.
    async function checkWall() {
      try { const j = await jget("/api/settings/display"); wallOn = !!j.enabled; $("#to-wall").classList.toggle("hidden", !wallOn); }
      catch (e) { /* unreachable: leave the button as it is */ }
    }

    // ---- Back to the wall display when left alone ---------------------------------
    // The remote's Settings → "Switch to the wall display" sets, per device, how
    // many untouched minutes send that device to the wall display. Shelf is part
    // of the same kiosk and keeps the same clock: without it, one tap on the wall
    // display's Shelf pill would leave a kiosk on Shelf for ever. Read on every
    // check, so a change made in the remote applies here at once. Touches count
    // as the remote counts them; a mouse only when it MOVED.
    const idleMins = () => { const v = parseInt(storeGet("rra-display-idle") || "0", 10); return Number.isFinite(v) && v > 0 ? v : 0; };
    let idleAt = Date.now();
    const touched = () => { idleAt = Date.now(); };
    for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(ev, touched, { capture: true, passive: true });
    {
      let mx = null, my = null;
      document.addEventListener("pointermove", (e) => {
        if (mx !== null && Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < 4) return;
        mx = e.clientX; my = e.clientY;
        touched();
      }, { capture: true, passive: true });
    }
    let leaving = false;
    function checkIdle() {
      const mins = idleMins();
      if (leaving || !mins || document.hidden || !wallOn) return;
      // In use — a finger on the shelf, a spin still landing, the zone list
      // open: wait for it, then go.
      if (h.drag || h.mode === "spin" || h.player.zonesOpen() || !$("#vol").classList.contains("hidden")) return;
      // once: a kiosk that blocks the page must not be asked every 15 s
      if (Date.now() - idleAt >= mins * 60000) { leaving = true; location.replace(wallUrl()); }
    }

    // Mid-gesture, mid-spin or with a case turned over (the album view open)
    // is no time to redraw the shelf: the next poll tries again.
    const busy = () => !!h.drag || h.mode !== "idle" || h.flippedV !== null;
    let settingsRev = null;
    async function checkLive() {
      if (document.hidden || !h.pick.ready()) return;
      try {
        const j = await jget("/api/live");
        const rev = j && j.rev;
        if (!rev) return;
        if (rev.settings && settingsRev && rev.settings !== settingsRev) checkWall();
        if (rev.settings) settingsRev = rev.settings;
        const libRev = h.pick.libRev();
        if (rev.library && libRev && rev.library !== libRev && !busy()) h.pick.loadLibrary();
      } catch (e) { /* poll blip — the next one retries */ }
    }

    // ---- How the shelf moves: said once, not written on it (v1.9.3) ---------------
    // The gestures used to sit along the foot of the shelf for good, lighting up
    // as they were used. Now they are a popup: the first time Shelf is opened on
    // this device, and again after each update — until "Don't show again" is
    // ticked, after which never. Per device, like every other Shelf preference.
    const HELP_KEY = "rra-shelf-help";
    function helpSaved() {
      try { const j = JSON.parse(storeGet(HELP_KEY) || "null"); return j && typeof j === "object" ? j : {}; }
      catch (e) { return {}; }   // unreadable: as if never shown
    }
    let helpVersion = "";
    async function maybeShowHelp() {
      const saved = helpSaved();
      if (saved.never) return;
      try { helpVersion = String((await jget("/api/update/status")).current || ""); }
      catch (e) { helpVersion = ""; /* unknown: shown once until a version can be read */ }
      // Shown when it never has been, or when the version it was last dismissed
      // at is not this one. An unknown version never re-shows a dismissed help.
      if ("seen" in saved && (saved.seen === helpVersion || !helpVersion)) return;
      $("#help-never").checked = false;
      $("#help").classList.remove("hidden");
      try { $("#help-ok").focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
    }
    function dismissHelp() {
      storeSet(HELP_KEY, JSON.stringify({ seen: helpVersion, never: $("#help-never").checked }));
      $("#help").classList.add("hidden");
      try { stage.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
    }
    $("#help-ok").addEventListener("click", dismissHelp);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#help").classList.contains("hidden")) dismissHelp();
      else if (h.back.tsel()) h.back.endPicks();
      else if (h.flippedV !== null) { h.flippedV = null; h.kick(); }   // the album view closes, the case turns back (t5)
      else if (h.queue.armed()) h.queue.disarm();
    });

    return { checkWall, checkIdle, checkLive, maybeShowHelp, touched, idleAt: () => idleAt };
  }

  window.ShelfWays = { create };
})();
