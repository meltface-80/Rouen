// @ts-check
/*
 * keyboard.js — is the on-screen keyboard open? (2.0.4-t8, dev/design/artists.md §1). The owner, 2026-11-10, a
 * playlist's find and the Library's "Starts with…" typed into on a phone, the bar and the mini player taking half the
 * screen left above the keyboard: "The bottom bar and mini transport bars should not show when the keyboard is open on
 * any screen where search works".
 *
 * Puts kb-open on <html> while a field that takes typing has the focus AND the screen the page has is at least
 * SHORTER px less tall than it was at that width before the field took the focus: the Android app resizes the page
 * for the keyboard (adjustResize), and a browser's visualViewport shrinks the same way. A field focused with a hardware keyboard takes
 * no room and changes nothing; the keyboard put away with the field still focused takes kb-open off. Touch layout only
 * (the same media query as touchnav.css): a desktop has no keyboard on its screen. touchnav.css and
 * playlist-tracks.css hide the bar, the mini player and a playlist's A–Z slider under it.
 *
 * Loaded by touchnav.js. RouenKeyboard.check() asks again (the tests' way in).
 */
(() => {
  "use strict";
  const SHORTER = 120;
  const root = document.documentElement;
  const touch = window.matchMedia("(hover: none), (pointer: coarse)");
  const TEXT = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);
  /** The tallest the page has been at each width (a turned phone is another width). @type {Map<number, number>} */
  const tallest = new Map();

  /** The height the page can show now, as layout pixels (a pinch-zoom is not the keyboard). */
  const height = () => {
    const v = window.visualViewport;
    return v ? v.height * (v.scale || 1) : window.innerHeight;
  };
  /** @param {Element | null} el */
  const typing = (el) => el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && TEXT.has(String(el.getAttribute("type") || "").toLowerCase()) && !el.readOnly && !el.disabled) ||
    (el instanceof HTMLElement && el.isContentEditable);

  function check() {
    const w = Math.round(window.innerWidth), h = height();
    const now = typing(document.activeElement);
    // With no field focused there is no keyboard: the height now is the page's own (a split screen, a resized
    // window, as it stands). While typing, the tallest seen stands for it (the review, 2.0.4-t8).
    const top = now ? Math.max(tallest.get(w) || 0, h) : h;
    tallest.set(w, top);
    root.classList.toggle("kb-open", !!touch.matches && now && top - h >= SHORTER);
  }

  check();
  document.addEventListener("focusin", check);
  // While focus moves, the old field still has it: ask once it has landed.
  document.addEventListener("focusout", () => setTimeout(check, 0));
  window.addEventListener("resize", check);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", check);
  if (touch.addEventListener) touch.addEventListener("change", check);
  else if (touch.addListener) touch.addListener(check);   // Safari before 14

  /** @type {any} */ (window).RouenKeyboard = { check };
})();
