// @ts-check
// The head of a playlist's page (v2.0.3-t9). The owner, 2026-11-09: "The double back button is not correct. The
// brass < chevron is the correct and only button. It should take you back to the previous screen which is the
// overview playlist screen I came from to view this playlist. Put the name of the playlist on the same line as the
// brass < chevron and if two lines place the second row under the first without the top line moving position".
//
// So a playlist's page has no Back of its own and no heading of its own. Its name is the screen's title, as any other
// screen's is (app.js's setCountText): beside the ‹ in the bar with a mouse, and on a touch screen the page's heading
// (touchnav.js moves the title into <main>), which this file lifts onto the ‹'s own line. And the bar's ‹, which goes
// Home from everywhere else, goes back to the list the playlist was opened from while its page is up.
//
// Four pages use it: a Roon playlist, a playlist made in Rouen and a Dynamic Playlist (app.js), and one of Roon's
// smart playlists (playlists-native.js). Each calls enter() once it has taken the grid, and mounts its wrap.
// The layout itself is touchnav.css's "A playlist's page"; what is measured here is only where the ‹ is, so the
// name's line is the ‹'s whatever the bar's padding, the button's size or the status bar's inset.
// test/dom/playlist-head.test.js.
(function () {
  "use strict";
  /** @type {any} */
  const W = window;
  const root = document.documentElement;
  const grid = document.getElementById("album-grid");
  const backBtn = document.getElementById("topbar-back");
  const main = document.querySelector("main");
  if (!grid || !backBtn || !main) return;

  const touch = window.matchMedia("(hover: none), (pointer: coarse)");
  /** The ‹'s words everywhere else (index.html). */
  const HOME = { label: "Back to Home", title: "Home" };
  /** Only a label this file wrote is ever put back: the artist view writes its own ("Back", "Back to the album"). */
  const OURS = /^Back to (Dynamic )?Playlists$/;

  /**
   * The page that is up, or the last one that was.
   * @typedef {{ to: string, back: () => void, live: () => boolean, wrap: HTMLElement | null, seen: boolean }} Page
   * @type {Page | null}
   */
  let page = null;

  /**
   * Whether a playlist's page is what the grid is showing. Until its wrap has been in the grid, the page's own
   * word for it (it is loading, or it failed and the banner says so); from then on, the wrap being there. The
   * artist view opened from one of its rows takes the wrap out of the grid and puts it back when it is closed,
   * so the page is over while that is up and back afterwards.
   */
  function showing() {
    if (!page) return false;
    if (/** @type {HTMLElement} */ (grid).classList.contains("hidden")) return false;
    if (page.wrap && page.wrap.isConnected) { page.seen = true; return true; }
    return !page.seen && page.live();
  }

  /** @param {string} name @param {string} value */
  function setVar(name, value) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }

  /**
   * Where the ‹ is, for touchnav.css: its height, its top from the top of <main>, and where the name starts
   * (the ‹'s right edge and the bar's own gap), from the left of <main>'s content. From the ‹'s centre, which a
   * pressed button's shrinking does not move.
   * @param {boolean} on
   */
  function measure(on) {
    const b = /** @type {HTMLElement} */ (backBtn);
    const r = b.getBoundingClientRect();
    if (!on || !touch.matches || !r.width || !r.height) {
      for (const n of ["--plh-h", "--plh-top", "--plh-indent"]) if (root.style.getPropertyValue(n)) root.style.removeProperty(n);
      return;
    }
    const m = /** @type {HTMLElement} */ (main).getBoundingClientRect();
    const row = b.parentElement ? getComputedStyle(b.parentElement) : null;
    const gap = (row && parseFloat(row.columnGap)) || 10;
    const pad = parseFloat(getComputedStyle(/** @type {HTMLElement} */ (main)).paddingLeft) || 0;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const px = (/** @type {number} */ n) => `${Math.round(n * 100) / 100}px`;
    setVar("--plh-h", px(b.offsetHeight));
    setVar("--plh-top", px(Math.max(0, cy - b.offsetHeight / 2 - m.top)));
    setVar("--plh-indent", px(Math.max(0, cx + b.offsetWidth / 2 + gap - m.left - pad)));
  }

  /** The ‹'s words, the page's class on <html>, and the measurements: all from whether a playlist's page is up. */
  function update() {
    const on = showing();
    root.classList.toggle("pl-page", on);
    const b = /** @type {HTMLElement} */ (backBtn);
    const want = on && page ? { label: "Back to " + page.to, title: page.to }
      : OURS.test(b.getAttribute("aria-label") || "") ? HOME : null;
    if (want) {
      if (b.getAttribute("aria-label") !== want.label) b.setAttribute("aria-label", want.label);
      if (b.getAttribute("title") !== want.title) b.setAttribute("title", want.title);
    }
    measure(on);
  }

  /**
   * A playlist's page has taken the grid.
   * @param {{ to: string, back: () => void, live?: () => boolean }} o  the list it was opened from, by its name on
   *   screen; how to go back to it; and whether the page is still the one on screen while it has no wrap yet.
   * @returns {(wrap: HTMLElement, sub?: string) => void}  mounts the page's wrap: its one line under the name
   *   (how many tracks, what it is made of) goes in at its top.
   */
  function enter(o) {
    /** @type {Page} */
    const mine = { to: o.to, back: o.back, live: o.live || (() => false), wrap: null, seen: false };
    page = mine;
    update();
    return (wrap, sub) => {
      if (sub) {
        const head = document.createElement("div");
        head.className = "playlist-head";
        const line = document.createElement("div");
        line.className = "playlist-sub";
        line.textContent = sub;
        head.appendChild(line);
        wrap.prepend(head);
      }
      if (page !== mine) return;   // another page was opened while this one was loading
      mine.wrap = wrap;
      update();
    };
  }

  /**
   * The ‹ was pressed.
   * @returns {boolean} true when a playlist's page was up and this went back to its list; false, and the ‹ goes Home.
   */
  function back() {
    if (!showing() || !page) return false;
    const p = page;
    page = null;
    p.back();
    update();
    return true;
  }

  // Every screen change empties or refills the grid, or hides it; the artist view rewrites the ‹'s words; and
  // touchnav.js's classes on <html> decide whether the ‹ has a box to measure at all.
  new MutationObserver(update).observe(grid, { childList: true, attributes: true, attributeFilter: ["class"] });
  new MutationObserver(update).observe(backBtn, { attributes: true, attributeFilter: ["aria-label", "class"] });
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", update);
  if (touch.addEventListener) touch.addEventListener("change", update);

  W.RouenPlaylistHead = { enter, back, showing };
})();
