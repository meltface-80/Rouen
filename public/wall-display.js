// @ts-check
/*
 * wall-display.js — moved out of public/app.js unchanged in v1.9.66-t16 (dev/quality.md's order, item 6), its comment
 * set right: the from-remote mark is read by display.js and shelf-ways.js. app.js hands it, through
 * window.__wallHost, the three things of its own the code reads live: the zone this remote drives, whether a selection
 * is being made, and the wall display's switch as last read. Loaded by app.js after it has set the host.
 */
// ===========================================================================
// WALL DISPLAY ⇄ REMOTE (v1.8.66).
//
// Asked for on the Roon forum by someone running both pages on one iPad in a
// kiosk browser: a way to flip between the remote and the wall display, and a
// timer that goes back to the display once the remote has been left alone —
// the display as the remote's screensaver.
//
// Both ways are an ordinary navigation in the same tab: "Wall display" in the
// side menu here, "Remote" on the display (shown when it is tapped). Going TO
// the display pushes a history entry and marks the tab (sessionStorage), and
// the display's way back is then history.back(): the remote comes back as it
// was left when the browser has kept the page, the browser's own Back agrees
// with the button, and flipping a hundred times leaves two entries rather
// than two hundred. A display opened any other way (a kiosk's start page, a
// bookmark) has no remote behind it, so it loads one.
//
// The display is sent THIS remote's zone: it is this remote's screen, and a
// display left to find "the first zone playing" can show a room the remote
// is not controlling.
//
// The timer is PER DEVICE and off unless chosen — the wall iPad wants it, the
// phone in a pocket does not. It never throws work away: it waits while
// Settings, a sheet, the label tools or a selection is open. And it does
// nothing while the wall display is switched off, because the page it would
// open says only that.
// ===========================================================================
(function wallDisplay() {
  "use strict";
  /**
   * @param {{ zone: () => (string | null), selecting: () => boolean, displayOn: () => boolean }} host
   */
  function start(host) {
    const DISPLAY_IDLE_KEY = "rra-display-idle";        // minutes, this device; absent = never
    // sessionStorage: "the remote is the page behind this tab's wall display or
    // Shelf". Set here on the way out, cleared on arrival; display.js and shelf-ways.js
    // read it (by this literal) to go BACK rather than load a fresh remote. It
    // holds only while those two REPLACE each other — a push between them would
    // put the other one behind, not the remote.
    const DISPLAY_FROM_KEY = "rra-display-from-remote";
    const DISPLAY_IDLE_CHOICES = [0, 1, 2, 5, 10, 15, 30, 60];
    let displayIdleMins = 0;
    try {
      const v = parseInt(localStorage.getItem(DISPLAY_IDLE_KEY) || "0", 10);
      if (DISPLAY_IDLE_CHOICES.indexOf(v) > -1) displayIdleMins = v;
    } catch (e) { /* private browsing — never, the default */ }
    let displayIdleAt = Date.now();     // when anyone last touched this page
    let displayIdleTimer = null;

    function openWallDisplay() {
      clearTimeout(displayIdleTimer);
      displayIdleTimer = null;
      try { sessionStorage.setItem(DISPLAY_FROM_KEY, "1"); }
      catch (e) { /* the display then loads a fresh remote rather than going back — still a way back */ }
      location.assign("/display" + (host.zone() ? "?zone=" + encodeURIComponent(host.zone()) : ""));
    }
    window.__openWallDisplay = openWallDisplay;
    // Shelf (v1.9.1) is reached the same way: this tab, marked so its Remote
    // button can go BACK to this page as it was left, and the zone in use passed
    // along so Play now plays where this remote is pointed.
    // The idle timer is left running: unloading stops it anyway, and a kiosk that
    // blocks /shelf must not be left with its timer dead.
    function openShelf() {
      try { sessionStorage.setItem(DISPLAY_FROM_KEY, "1"); }
      catch (e) { /* Shelf then loads a fresh remote rather than going back — still a way back */ }
      location.assign("/shelf" + (host.zone() ? "?zone=" + encodeURIComponent(host.zone()) : ""));
    }
    window.__openShelf = openShelf;

    // Open work the timer must not throw away: picks being made, a sheet (an
    // import's result, a playlist being named), Settings, the label tools.
    function displayIdleHeld() {
      if (host.selecting()) return true;
      if (document.querySelector(".lib-sheet-backdrop")) return true;
      for (const id of ["settings-overlay", "label-merge-bar", "label-unmerge-sheet", "logo-url-sheet"]) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains("hidden")) return true;
      }
      return false;
    }
    function armDisplayIdle(wait) {
      clearTimeout(displayIdleTimer);
      displayIdleTimer = null;
      if (!displayIdleMins || document.hidden) return;
      const due = wait != null ? wait : displayIdleAt + displayIdleMins * 60000 - Date.now();
      displayIdleTimer = setTimeout(checkDisplayIdle, Math.max(1000, due));
    }
    function checkDisplayIdle() {
      displayIdleTimer = null;
      if (!displayIdleMins || document.hidden) return;   // re-armed when shown again
      if (Date.now() - displayIdleAt < displayIdleMins * 60000) { armDisplayIdle(); return; }
      // Held, or the display is off: look again shortly rather than starting the
      // count over. The page HAS been left alone all this time, so it goes soon
      // after the sheet closes or the switch is turned on.
      if (!host.displayOn() || displayIdleHeld()) { armDisplayIdle(15000); return; }
      openWallDisplay();
    }
    {
      const touched = () => { displayIdleAt = Date.now(); };
      // Every way a person can be at this page. Not `scroll`: the app scrolls
      // itself (a revealed tile, a list put back), and a person who scrolls has
      // touched, wheeled or pressed a key to do it.
      for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
        document.addEventListener(ev, touched, { capture: true, passive: true });
      }
      // A mouse that MOVED. Browsers send moves of their own when the page
      // changes under a resting pointer, and the progress bar changes it four
      // times a second — counted, those would keep a desktop awake for ever.
      let mx = null, my = null;
      document.addEventListener("pointermove", (e) => {
        if (mx !== null && Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < 4) return;
        mx = e.clientX; my = e.clientY;
        touched();
      }, { capture: true, passive: true });
      window.addEventListener("focus", touched);
      // A hidden page has nobody to hand over from, and coming back is a touch.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { clearTimeout(displayIdleTimer); displayIdleTimer = null; return; }
        touched();
        armDisplayIdle();
      });
      // Arriving — a load, or back from the display. The tab's mark is spent, and
      // a page the browser kept comes back with the clock it left with, which
      // would read as however long the display was up and send it straight back.
      const arrived = () => {
        try { sessionStorage.removeItem(DISPLAY_FROM_KEY); }
        catch (e) { /* nothing could have been stored, then */ }
        touched();
        armDisplayIdle();
      };
      window.addEventListener("pageshow", (e) => { if (e.persisted) arrived(); });
      arrived();

      const sel = document.getElementById("display-idle-select");
      if (sel) {
        sel.value = String(displayIdleMins);
        sel.addEventListener("change", () => {
          const v = parseInt(sel.value, 10);
          displayIdleMins = DISPLAY_IDLE_CHOICES.indexOf(v) > -1 ? v : 0;
          try { localStorage.setItem(DISPLAY_IDLE_KEY, String(displayIdleMins)); }
          catch (e) { /* holds for this session, which beats not at all */ }
          touched();
          armDisplayIdle();
        });
      }
    }
  }

  const W = /** @type {any} */ (window);
  if (W.__wallHost) start(W.__wallHost);
})();
