// @ts-check
/*
 * playlist-top.js — the top of a playlist's page stays put while its tracks scroll (2.0.4-t10,
 * dev/design/playlist-artists.md §9). The owner, 2026-11-10: "I want the top section of the playlist screen to be fixed
 * but reduced in size on the phone app and phone sizes screens, tablets can display the play options and sort options
 * on a single line and that'll reduce the height of the bar and show more tracks on the screen. The same I guess for
 * desktop sized screen."
 *
 * What a playlist's page has above its rows — the line saying what it is (.playlist-head), Play now · Queue · Shuffle ·
 * ⋯ (.playlist-actions), the Sort (.playlist-sort) and the find (.playlist-find) — is gathered into one block,
 * .playlist-top, which playlist-top.css holds at the top while the rows scroll under it: under the page's heading on a
 * touch screen (the heading itself held at the very top: the name on the ‹'s line), under the bar with a mouse. The
 * parts are moved, not rebuilt, so each keeps what it does; parts added later (the Sort, once the rows are in) are
 * gathered as they come. --plt-top on <html> is where the block stops: the heading's height, or the bar's foot.
 *
 * On a touch screen the count ("50 Tracks", a playlist's line when that is all it says) goes beside the name, the
 * owner's choice: the name on one line, cut with … when long (from t10; it was two lines, 2.0.3-t9). A longer line (a
 * Dynamic Playlist's "Albums · album order · …") stays a line of its own in the block.
 *
 * Loaded by playlist-tracks.js with its stylesheet. Every playlist page (playlist-head.js's four) is one of
 * #album-grid's .playlist-detail.
 */
(() => {
  "use strict";
  const root = document.documentElement;
  const grid = document.getElementById("album-grid");
  const main = document.querySelector("main");
  if (!grid || !main) return;
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "playlist-top.css" }));
  const touch = window.matchMedia("(hover: none), (pointer: coarse)");
  const PARTS = [".playlist-head", ".playlist-actions", ".playlist-sort", ".playlist-find"];
  /** A line that is only a count of tracks, which goes beside the name. */
  const COUNT = /^\s*[\d,.\s]+\s+tracks?\s*$/i;

  /** The parts the page has put straight into its wrap, into its top block, in their order. @param {Element} detail */
  function gather(detail) {
    const loose = PARTS.map((sel) => detail.querySelector(":scope > " + sel)).filter(Boolean);
    if (!loose.length) return;
    let top = detail.querySelector(":scope > .playlist-top");
    if (!top) {
      top = document.createElement("div");
      top.className = "playlist-top";
      detail.insertBefore(top, detail.firstChild);
    }
    const block = top;
    // Each in its place: the order of PARTS, whether it was in the block already or has just come.
    let at = /** @type {Element | null} */ (null);
    for (const sel of PARTS) {
      const el = detail.querySelector(":scope > " + sel) || block.querySelector(":scope > " + sel);
      if (!el) continue;
      const want = at ? at.nextElementSibling : block.firstElementChild;
      if (el !== want) block.insertBefore(el, want);
      at = el;
    }
  }

  /** @type {HTMLElement | null} the count beside the name */
  let count = null;
  /** The count beside the name on a touch screen; anything longer stays its own line. */
  function beside() {
    const heading = document.getElementById("tnav-heading");
    const detail = grid ? grid.querySelector(".playlist-detail") : null;
    const head = detail ? detail.querySelector(".playlist-head") : null;
    const sub = head ? head.querySelector(".playlist-sub") : null;
    const text = sub ? String(sub.textContent || "") : "";
    const on = !!heading && !!head && root.classList.contains("pl-page") && touch.matches && COUNT.test(text);
    if (head) head.classList.toggle("is-beside", on);
    if (!on) { if (count) count.remove(); return; }
    if (!count) {
      count = document.createElement("span");
      count.className = "plt-count";
    }
    count.textContent = text.trim();
    if (count.parentNode !== heading) /** @type {HTMLElement} */ (heading).appendChild(count);
  }

  /** Where the block stops: under the held heading (touch: it is held at the screen's top), else under the bar. A held
   * box's top counts from its scroller's padding edge, so main's top padding is taken off (the result may be less
   * than nothing). */
  function place() {
    let top = 0;
    if (root.classList.contains("pl-page")) {
      const m = /** @type {HTMLElement} */ (main);
      const pad = parseFloat(getComputedStyle(m).paddingTop) || 0;
      const heading = document.getElementById("tnav-heading");
      const held = heading && getComputedStyle(heading).position === "sticky";
      let ceiling = 0;
      if (held) ceiling = /** @type {HTMLElement} */ (heading).offsetHeight;
      else {
        const bar = document.querySelector(".topbar");
        if (bar) ceiling = Math.max(0, bar.getBoundingClientRect().bottom - m.getBoundingClientRect().top);
      }
      top = Math.round(ceiling - pad);
    }
    root.style.setProperty("--plt-top", top + "px");
  }

  // The heading's or the bar's height changing (a larger title in UI Settings, a notice): the block's place again.
  // The heading is touchnav.js's, which may come in after this script: watched once it is there.
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => later()) : null;
  const watched = new Set();
  function watch() {
    for (const el of [document.getElementById("tnav-heading"), document.querySelector(".topbar")]) {
      if (ro && el && !watched.has(el)) { watched.add(el); ro.observe(el); }
    }
  }

  let soon = 0;
  function all() {
    soon = 0;
    watch();
    const detail = grid ? grid.querySelector(".playlist-detail") : null;
    if (detail) gather(detail);
    beside();
    place();
  }
  function later() { if (!soon) soon = window.setTimeout(all, 0); }
  // A page put in the grid, a part added to one, its line written; the page marked a playlist's or no longer.
  new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target instanceof Element ? r.target : r.target.parentElement;
      if (!t) continue;
      if (t === grid || t.classList.contains("playlist-detail") || t.closest(".playlist-head")) { later(); return; }
    }
  }).observe(grid, { childList: true, subtree: true, characterData: true });
  new MutationObserver(later).observe(root, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", later);
  if (touch.addEventListener) touch.addEventListener("change", later);
  else if (touch.addListener) touch.addListener(later);   // Safari before 14
  all();

  /** @type {any} */ (window).RouenPlaylistTop = { gather, place, COUNT };
})();
