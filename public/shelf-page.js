// @ts-check
/*
 * shelf-page.js — the Shelf page as a page: the remote's theme, a window that
 * never scrolls, and no zoom (moved out of shelf.js in v1.9.66, behaviour
 * unchanged). Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Needs nothing from the shelf, and is loaded before shelf.js so the theme is
 * set before the shelf measures anything.
 */
(() => {
  "use strict";

  /** @param {string} k */
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }   // private browsing: the defaults

  // ---- The remote's theme, as this device chose it -------------------------
  document.documentElement.dataset.theme = storeGet("rra-theme-v2") === "brass-light" ? "light" : "dark";
  {
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (meta && bg) meta.setAttribute("content", bg);
  }

  // ---- The window must never be scrolled (the remote's v1.8.45 pin) ---------
  // Opened from the home-screen app, Shelf runs in its standalone window, with
  // live safe-area insets — and iOS can leave that window scrolled by the top
  // inset after a rotation, so every tap is hit-tested that far below what is
  // drawn and nothing seems to answer. This page never scrolls its window (the
  // body is overflow: hidden, only the tile list scrolls), so a non-zero offset
  // is never a position anyone wanted. app.js explains the readout that found it.
  const pinWindow = () => {
    if (!window.scrollX && !window.scrollY) return;
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };
  const pinAfterSettle = () => { pinWindow(); setTimeout(pinWindow, 300); setTimeout(pinWindow, 1000); };
  window.addEventListener("scroll", pinWindow, { passive: true });
  window.addEventListener("pageshow", pinWindow, { passive: true });
  window.addEventListener("orientationchange", pinAfterSettle, { passive: true });
  window.addEventListener("resize", pinAfterSettle, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", pinAfterSettle, { passive: true });
    window.visualViewport.addEventListener("scroll", pinWindow, { passive: true });
  }

  // ---- No zoom (v1.9.3) -------------------------------------------------------
  // A pinch on a shelf you flick through is meant for the shelf. The viewport
  // meta says so where a browser listens (Chrome on Android); iOS Safari has
  // ignored user-scalable=no since iOS 10, so the pinch is stopped here: its
  // own gesture events, any two-finger move, and a trackpad pinch on a
  // desktop (a wheel event with ctrlKey). Double-tap zoom is touch-action:
  // manipulation in shelf.css.
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener("touchmove", (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
})();
