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
  const name = document.getElementById("album-count");
  const selMenu = document.getElementById("select-menu-wrap");
  const bar = document.querySelector(".topbar");

  const touch = window.matchMedia("(hover: none), (pointer: coarse)");
  /** The ‹'s words everywhere else (index.html). */
  const HOME = { label: "Back to Home", title: "Home" };
  /** Only a label this file wrote is ever put back: the artist view writes its own ("Back", "Back to the album"). */
  const OURS = /^Back to (Dynamic )?Playlists$/;

  /**
   * The page that is up. Its place is an empty, hidden node this file puts in the grid the moment the page takes
   * it; its wrap is what the page mounts once it has something to show.
   * @typedef {{ to: string, back: () => void, place: HTMLElement, wrap: HTMLElement | null }} Page
   * @type {Page | null}
   */
  let page = null;

  /**
   * Whether a playlist's page is what the grid is showing: its place or its wrap is in the grid. Read off the grid
   * and nothing else, because the grid is what every screen shares: one that takes it empties it, and the artist
   * view opened over a page lifts every node out and puts them all back when it is closed. So a page that is
   * still loading, or that could not be read and has only its banner, is up and comes back exactly as a loaded
   * one does (v2.0.3-t9's review: a flag kept beside the grid said otherwise after the artist view had been
   * over a page that failed, and the ‹ went Home).
   */
  function showing() {
    if (!page || /** @type {HTMLElement} */ (grid).classList.contains("hidden")) return false;
    return page.place.isConnected || !!(page.wrap && page.wrap.isConnected);
  }

  /** @param {string} name @param {string | null} value  null takes it away */
  function setVar(name, value) {
    if (value === null) { if (root.style.getPropertyValue(name)) root.style.removeProperty(name); return; }
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }

  /**
   * Where the ‹ is, for touchnav.css: its height, its top from the top of <main>, and where the name starts
   * (the ‹'s right edge and the bar's own gap), from the left of <main>'s content. From the ‹'s centre, which a
   * pressed button's shrinking does not move. And where the name ends while albums are selected (a Dynamic
   * Playlist's tiles): short of the selection's menu, which takes the bar's right-hand corner.
   * @param {boolean} on
   */
  function measure(on) {
    const b = /** @type {HTMLElement} */ (backBtn);
    const r = on && touch.matches ? b.getBoundingClientRect() : null;
    if (!r || !r.width || !r.height) {
      for (const n of ["--plh-h", "--plh-top", "--plh-indent", "--plh-end", "--plh-pad-right"]) setVar(n, null);
      return;
    }
    const m = /** @type {HTMLElement} */ (main).getBoundingClientRect();
    const row = b.parentElement ? getComputedStyle(b.parentElement) : null;
    const gap = (row && parseFloat(row.columnGap)) || 10;
    const cs = getComputedStyle(/** @type {HTMLElement} */ (main));
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const px = (/** @type {number} */ n) => `${Math.round(n * 100) / 100}px`;
    setVar("--plh-h", px(b.offsetHeight));
    setVar("--plh-top", px(Math.max(0, cy - b.offsetHeight / 2 - m.top)));
    setVar("--plh-indent", px(Math.max(0, cx + b.offsetWidth / 2 + gap - m.left - padL)));
    const s = selMenu ? selMenu.getBoundingClientRect() : null;
    setVar("--plh-end", s && s.width ? px(Math.max(0, m.right - padR - s.left + gap)) : null);
    setVar("--plh-pad-right", px(padR));   // where Import ends on a Playlists screen: the page's own right edge
  }

  /**
   * The ‹'s words, the page's class on <html>, the name as the page's heading, and the measurements: all from
   * whether a playlist's page is up. Home hides the grid without emptying it, and a search from Home shows it
   * again for a moment before filling it: the page is over once the grid has been hidden.
   */
  function update() {
    if (page && /** @type {HTMLElement} */ (grid).classList.contains("hidden")) page = null;
    const on = showing();
    root.classList.toggle("pl-page", on);
    // The Playlists and Dynamic Playlists screens (2.0.4-t11; the owner, 2026-11-10: "Move the title - Playlists ...
    // next to the back < chevron maintaining the same spacing as other screens"): their names on the ‹'s line too,
    // Import at its right (touchnav.css). Known by what only they have: Import, and the new Dynamic Playlist's tile.
    const list = !on && !(/** @type {HTMLElement} */ (grid).classList.contains("hidden")) &&
      !!(document.querySelector("#content-count .playlists-import") || /** @type {HTMLElement} */ (grid).querySelector("#new-smart-tile"));
    root.classList.toggle("pl-list", list);
    const b = /** @type {HTMLElement} */ (backBtn);
    const want = on && page ? { label: "Back to " + page.to, title: page.to }
      : OURS.test(b.getAttribute("aria-label") || "") ? HOME : null;
    if (want) {
      if (b.getAttribute("aria-label") !== want.label) b.setAttribute("aria-label", want.label);
      if (b.getAttribute("title") !== want.title) b.setAttribute("title", want.title);
    }
    // The page had a heading of its own until v2.0.3-t9 (an h2); its name in the bar is that heading now.
    if (name && on !== (name.getAttribute("role") === "heading")) {
      if (on) { name.setAttribute("role", "heading"); name.setAttribute("aria-level", "2"); }
      else { name.removeAttribute("role"); name.removeAttribute("aria-level"); }
    }
    measure(on || list);
  }

  /**
   * A playlist's page has taken the grid: its place goes in, after whatever the grid is showing while it loads.
   * @param {{ to: string, back: () => void }} o  the list it was opened from, by its name on screen, and how to go
   *   back to it.
   * @returns {(wrap?: HTMLElement, sub?: string) => void}  with a wrap, the page is about to put it in the grid:
   *   its one line under the name (how many tracks, what it is made of) goes in at its top. With none, the page
   *   could not be read: the grid is emptied down to its place, so the page is still there to go back from.
   */
  function enter(o) {
    const place = document.createElement("div");
    place.className = "playlist-place";
    place.hidden = true;
    /** @type {Page} */
    const mine = { to: o.to, back: o.back, place, wrap: null };
    page = mine;
    /** @type {HTMLElement} */ (grid).appendChild(place);
    update();
    return (wrap, sub) => {
      if (!wrap) {
        if (page !== mine) return;
        /** @type {HTMLElement} */ (grid).innerHTML = "";
        /** @type {HTMLElement} */ (grid).appendChild(place);
        return;
      }
      if (sub) {
        const head = document.createElement("div");
        head.className = "playlist-head";
        const line = document.createElement("div");
        line.className = "playlist-sub";
        line.textContent = sub;
        head.appendChild(line);
        wrap.prepend(head);
      }
      if (page === mine) mine.wrap = wrap;   // not if another page was opened while this one was loading
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

  /** Now, and again as the screen settles: iOS reports a rotation before the web view has its new size and insets
   *  (app.js's --topbar-h is published the same way, for the same reason). */
  function settle() {
    update();
    setTimeout(update, 300);
    setTimeout(update, 1000);
  }

  // Every screen change empties or refills the grid, or hides it; the artist view rewrites the ‹'s words;
  // touchnav.js's classes on <html> decide whether the ‹ has a box to measure at all; and the selection's menu
  // comes and goes, and widens with its count. The ‹ moves when the bar's own box does (the status bar's inset
  // arriving late, a notice opening in the bar), which no resize of the window reports.
  new MutationObserver(update).observe(grid, { childList: true, attributes: true, attributeFilter: ["class"] });
  new MutationObserver(update).observe(backBtn, { attributes: true, attributeFilter: ["aria-label", "class"] });
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ["class"] });
  // Import put in its line (the Playlists screen) or taken out: the screen's class with it.
  const counted = document.getElementById("content-count");
  if (counted) new MutationObserver(update).observe(counted, { childList: true });
  if (selMenu) new MutationObserver(update).observe(selMenu, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", settle);
  window.addEventListener("orientationchange", settle);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", settle);
  if (touch.addEventListener) touch.addEventListener("change", update);
  if (typeof ResizeObserver === "function" && bar) new ResizeObserver(update).observe(bar, { box: "border-box" });

  W.RouenPlaylistHead = { enter, back, showing };
})();
