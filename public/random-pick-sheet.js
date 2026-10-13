// @ts-check
/*
 * random-pick-sheet.js — the Random Album sheet's markup (v1.9.3): the album
 * the button chose, and what to do with it. Moved out of index.html in
 * v1.9.14, unchanged, to make room there for the touch layout without
 * raising the page's length baseline (the owner's choice).
 *
 * Loaded before app.js, which finds these elements by id when it starts: the
 * markup is inserted where this script's tag stands, which is where it stood
 * in index.html — beside the confirm dialog and outside the app shell, for
 * the reason the side menu is (v1.8.59): inside it, no z-index could lift it
 * over the now-playing pill. app.js does all the rest, as before.
 */
(function randomPickSheet() {
  "use strict";
  const here = document.currentScript;
  if (!here) return;
  here.insertAdjacentHTML("beforebegin", `
  <div id="random-pick-overlay" class="confirm-overlay random-pick hidden" role="dialog" aria-modal="true" aria-labelledby="random-pick-title">
    <div class="confirm-backdrop"></div>
    <div class="confirm-box random-pick-box">
      <button class="random-pick-close" id="random-pick-close" type="button" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="random-pick-art" id="random-pick-art"></div>
      <p class="random-pick-title" id="random-pick-title"></p>
      <p class="random-pick-artist" id="random-pick-artist"></p>
      <div class="random-pick-actions">
        <button class="confirm-btn confirm-primary" type="button" data-kind="play_now">Play now</button>
        <button class="confirm-btn" type="button" data-kind="play_next">Play next</button>
        <!-- The end of the queue: a list, and an arrow down to its last line. -->
        <button class="confirm-btn" type="button" data-kind="queue" aria-label="Queue — add to the end">
          <svg class="random-pick-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h11M3 10h11M3 15h7"/><path d="M18 5v12"/><path d="M14.5 13.5L18 17l3.5-3.5"/><path d="M3 20h18"/></svg>
          Queue
        </button>
      </div>
    </div>
  </div>
`);
})();
