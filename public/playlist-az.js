// @ts-check
/*
 * playlist-az.js — the A–Z slider on a long playlist (2.0.4-t6; a slider from t8; dev/design/playlist-artists.md §8).
 * gert_mogensen, the Roon forum, 2026-11-10: "I have a playlist with 1500 songs, it would be nice if i could jump to
 * the letter S instead of scrolling through the playlist". Shown only when the playlist is sorted by Title or Artist
 * (the owner's choice: in Playlist order a letter means nothing), and only when its rows run past the screen.
 *
 * t6 was a strip of letters. The owner, 2026-11-10, seeing it on a phone, asked for a slider instead, and chose how it
 * behaves: a thin line down the right edge; on it a circle holding the letter of the top row on screen, which moves
 * down the line as the list scrolls (its place on the line is the place in the list). A long press on the circle takes
 * hold of it; drawn along the line the list moves with the finger as it goes, and the top row's letter shows in a
 * larger circle just above the finger. A finger that moves before the press has lasted does nothing.
 *
 * The letter is the Sort's own key (playlist-tracks.js titleOf / artistOf, a lead "The " off), accents off: A–Z, each
 * digit its own (the owner's choice), anything else "#". Rows a find hid (playlist-find.js) take no room on the line.
 * While the keyboard is open (kb-open, keyboard.js) it is not shown (playlist-tracks.css).
 *
 * Loaded by playlist-tracks.js, which calls attach() when it adds the Sort; its look is in playlist-tracks.css.
 */
(() => {
  "use strict";
  const HOLD_MS = 320;   // how long a press lasts before it holds the circle
  const SLOP = 10;       // how far (px) a finger may wander before then
  const EDGE = 12;       // px kept clear of the screen's top and of the mini player
  const THUMB = 36;      // the circle's size (playlist-tracks.css)
  const LIFT = 84;       // how far above the finger the larger circle sits (its middle)

  /** The letter a key files under, accents off: A–Z, a digit, else "#". @param {string} key */
  const letterOf = (key) => {
    const c = String(key || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().charAt(0).toUpperCase();
    return (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ? c : "#";
  };
  const clamp = (/** @type {number} */ x) => Math.max(0, Math.min(1, x));

  /** The element whose scrolling moves the rows: the nearest that scrolls, else the page. @param {HTMLElement} el */
  function scrollerOf(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return { sc: p, page: false };
    }
    return { sc: /** @type {HTMLElement} */ (document.scrollingElement || document.documentElement), page: true };
  }
  /** Where the top bar ends, when it lies over the rows' top (a desktop's: opaque, its controls at the right); else y.
   * @param {number} y */
  function ceilingBelow(y) {
    const bar = document.querySelector(".topbar");
    const q = bar ? bar.getBoundingClientRect() : null;
    return q && q.height > 0 && q.top <= y + 1 && q.bottom > y ? q.bottom : y;
  }
  /** Where the mini player or the bar along the foot begins, if either is shown; else the given bottom. @param {number} y */
  function floorAbove(y) {
    for (const sel of [".mini-transport", "#touch-nav"]) {
      const el = document.querySelector(sel);
      const q = el ? el.getBoundingClientRect() : null;
      if (q && q.height > 0 && q.top < y) y = q.top;
    }
    return y;
  }

  /** Each shown slider's paint-soon, for the scroll and resize listeners all share. @type {Set<() => void>} */
  const sliders = new Set();
  const all = () => { for (const f of sliders) f(); };
  document.addEventListener("scroll", all, { capture: true, passive: true });
  window.addEventListener("resize", all);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", all);

  /** @param {HTMLElement} ol */
  function attach(ol) {
    const T = /** @type {any} */ (window).RouenPlaylistTracks;
    if (!T || !ol.parentNode || /** @type {any} */ (ol).__az) return;
    const box = document.createElement("div");
    box.className = "playlist-az hidden";
    const line = document.createElement("div");
    line.className = "playlist-az-line";
    const thumb = document.createElement("div");
    thumb.className = "playlist-az-thumb";
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "slider");
    thumb.setAttribute("aria-label", "Jump to a letter: press and hold, then slide");
    thumb.setAttribute("aria-valuemin", "0");
    thumb.setAttribute("aria-valuemax", "100");
    const bubble = document.createElement("div");
    bubble.className = "playlist-az-bubble";
    bubble.setAttribute("aria-hidden", "true");
    box.append(line, thumb, bubble);
    ol.parentNode.appendChild(box);   // fixed, down the right edge: where in the page it sits moves nothing
    /** @type {any} */ (ol).__az = box;

    const mode = () => ol.dataset.sort || "order";
    const keyOf = (/** @type {any} */ li) => (mode() === "artist" ? T.artistOf(li) : T.titleOf(li));
    /** @type {HTMLElement[] | null} the rows a find leaves, read again when the rows change */
    let seen = null;
    const rows = () => seen || (seen = /** @type {HTMLElement[]} */ (Array.from(ol.children)).filter((li) => !li.classList.contains("pf-hidden")));

    /** The list against the screen now: the line's top and floor, and the scroll at which the rows start and end on it. */
    function measure() {
      const { sc, page } = scrollerOf(ol);
      const v = page ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
      const r = ol.getBoundingClientRect();
      const top = ceilingBelow(v.top) + EDGE, floor = floorAbove(v.bottom) - EDGE;
      const s = sc.scrollTop;
      return { sc, view: top, top: Math.max(top, r.top), floor, start: s + r.top - top, end: s + r.bottom - floor, s };
    }
    /** The first row whose foot is below y (rows are stacked, so halve the search). @param {number} y */
    function rowAt(y) {
      const all = rows();
      let lo = 0, hi = all.length - 1, hit = all.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (all[m].getBoundingClientRect().bottom > y + 1) { hit = m; hi = m - 1; } else lo = m + 1;
      }
      return all[hit] || null;
    }

    /** @type {{ top: number, height: number, grip: number } | null} the line as it stood when the circle was taken
     * hold of, and where on the circle the finger is (its middle 0) */
    let held = null;
    /** @type {any} */
    let frame = 0;
    function paint() {
      frame = 0;
      // Out of the document: closed, or set aside while an artist's page is shown (artist-view.js puts the same rows
      // back). Hidden, nothing held, and off the shared listeners (a closed page is let go) until the rows are laid
      // out again (the ResizeObserver below).
      if (!ol.isConnected) {
        letGo(); seen = null; box.classList.add("hidden");
        if (typeof ResizeObserver === "function") sliders.delete(later);
        return;
      }
      const on = (mode() === "title" || mode() === "artist") && ol.getClientRects().length > 0 && rows().length > 1;
      const m = on ? measure() : null;
      const line0 = held || (m ? { top: m.top, height: m.floor - m.top } : null);
      if (!m || !line0 || m.end - m.start <= 0 || line0.height < THUMB * 2) { box.classList.add("hidden"); return; }
      box.classList.remove("hidden");
      box.style.top = line0.top + "px";
      box.style.height = line0.height + "px";
      const f = clamp((m.s - m.start) / (m.end - m.start));
      thumb.style.transform = `translateY(${Math.round(f * (line0.height - THUMB))}px)`;
      const li = rowAt(m.view);
      const letter = li ? letterOf(keyOf(li)) : "";
      thumb.textContent = letter;
      bubble.textContent = letter;
      thumb.setAttribute("aria-valuenow", String(Math.round(f * 100)));
      thumb.setAttribute("aria-valuetext", letter);
    }
    // Once per burst of scrolling, soon after (a timer, not a frame: a page in the background, or headless, gets none).
    function later() { if (!frame) frame = setTimeout(paint, 16); }
    /** The list to the place f (0 to 1) along it, at once. @param {number} f */
    function seek(f) {
      const m = measure();
      if (m.end - m.start <= 0) return;
      m.sc.scrollTop = m.start + clamp(f) * (m.end - m.start);
      paint();
    }

    // A long press takes hold of the circle; then the finger moves the list.
    /** @type {{ id: number, x: number, y: number, timer: any } | null} */
    let press = null;
    function grab(/** @type {number} */ y) {
      const m = measure(), c = thumb.getBoundingClientRect();
      // Held where the finger is on the circle, so the list does not jump as the hold begins.
      held = { top: m.top, height: m.floor - m.top, grip: c.height ? y - (c.top + c.height / 2) : 0 };
      box.classList.add("is-held");
      slide(y);
    }
    function slide(/** @type {number} */ y) {
      if (!held) return;
      seek((y - held.grip - held.top - THUMB / 2) / Math.max(1, held.height - THUMB));
      bubble.style.top = Math.round(y - held.top - LIFT) + "px";
    }
    function letGo() {
      if (press) clearTimeout(press.timer);
      press = null;
      if (!held) return;
      held = null;
      box.classList.remove("is-held");
      paint();
    }
    thumb.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      try { thumb.setPointerCapture(e.pointerId); } catch (x) { /* a pointer the circle may not hold: its moves still reach it while over it */ }
      const at = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0 };
      at.timer = setTimeout(() => { if (press === at) grab(at.y); }, HOLD_MS);
      press = at;
    });
    thumb.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (held) { slide(e.clientY); return; }
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) { clearTimeout(press.timer); press = null; }
      else press.y = e.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) thumb.addEventListener(type, letGo);
    thumb.addEventListener("contextmenu", (e) => e.preventDefault());   // a long press is the circle's, not a menu's
    // The keyboard's way: arrows a little, Page keys more, Home and End the ends.
    thumb.addEventListener("keydown", (e) => {
      const step = { ArrowDown: 0.05, ArrowUp: -0.05, PageDown: 0.2, PageUp: -0.2 }[e.key];
      const m = measure();
      const f = m.end > m.start ? (m.s - m.start) / (m.end - m.start) : 0;
      if (step !== undefined) seek(clamp(f) + step);
      else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(1);
      else return;
      e.preventDefault();
    });

    // The Sort changed, the rows came in or moved, a find typed, the artists named: the rows read again.
    new MutationObserver(() => { seen = null; later(); })
      .observe(ol, { attributes: true, attributeFilter: ["data-sort", "class"], subtree: true, childList: true, characterData: true });
    // The rows laid out again: back from an artist's page (on the shared listeners again), or grown.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => { seen = null; if (ol.isConnected) sliders.add(later); later(); }).observe(ol);
    }
    // The rows scrolled, the screen resized: every slider's paint, through the one set of listeners below.
    sliders.add(later);
    paint();
  }


  /** @type {any} */ (window).RouenPlaylistAZ = { attach, letterOf };
  // A playlist opened before this script came in: its rows are there already, without a slider.
  // Rows the Sort has numbered (data-pos) are a playlist's it has enhanced.
  for (const ol of Array.from(document.querySelectorAll("ol.playlist-tracks"))) {
    const first = ol.firstElementChild;
    if (first instanceof HTMLElement && first.dataset.pos) attach(/** @type {HTMLElement} */ (ol));
  }
})();
