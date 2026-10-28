// @ts-check
/*
 * now-playing-view.js — Now playing on a large screen, and the mini transport's markup
 * (dev/design/album-view-landscape.md §5, §6, §8).
 *
 *   The mini transport's markup (#mini-transport), moved out of index.html in v1.9.70-t11 and unchanged. It is inserted
 *   where this script's tag stands, which is where it stood in index.html, before app.js runs, as album-view.js does.
 *   index.html is over its length limit (dev/quality.md), and the fixed mini transport of §8 is built here next.
 *
 *   Now playing, reduced (v1.8.75; moved out of app.js in v1.9.70-t11, unchanged): on a big desktop the full-screen
 *   Now playing hides everything. Reduce size turns it into a card the size of the album view's; the same button then
 *   reads "Full size". The card is dragged by its top strip (not by its buttons, its tabs or anything inside the
 *   body). The choice is remembered on this device; the position is not — every opening starts centred.
 *
 *   Now playing in three columns (v1.9.70-t11, §5): on a screen of §3, full size, Now playing is album-view.css's
 *   three columns — the cover and Now playing's controls at the left, the playing album's review in the middle, the
 *   queue at the right, in place of the tabs (album-view.css shows it there whatever tab was last chosen). This keeps
 *   them following the zone:
 *
 *     RouenNowPlaying.threeColumns()   Now playing is open in three columns, now
 *     RouenNowPlaying.playing(np)      the transport's poll, with what is playing: the review follows the album
 *
 *   and asks app.js, which holds the queue and the review: window.__npThreeOn() going into the three columns (opened,
 *   the screen turned round, the card made full size), window.__npReview(album or null) for the middle. app.js
 *   re-reads the queue as it moves while threeColumns() is true, as it does for the Queue tab.
 */
(function miniTransportMarkup() {
  "use strict";
  const here = document.currentScript;
  if (!here) return;
  here.insertAdjacentHTML("beforebegin", `
  <div id="mini-transport" class="mini-transport hidden" aria-label="Now playing">
    <div class="mt-progress" aria-hidden="true">
      <div class="mt-progress-fill" id="mt-progress-fill"></div>
    </div>

    <button class="mt-btn mt-playpause" id="mt-playpause" aria-label="Play/pause">
      <svg id="mt-icon-play"  viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
      <svg id="mt-icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="hidden">
        <path d="M6 5h4v14H6zM14 5h4v14h-4z"/>
      </svg>
    </button>

    <div class="mt-info">
      <!-- Inside .mt-info, which is the region that opens Now playing: tapping
           the cover of the thing you are listening to should get you to it. -->
      <img id="mt-art" class="mt-art" alt="" aria-hidden="true" draggable="false">
      <div class="mt-text">
        <!-- The zone it is playing in, in small brass capitals above the track. -->
        <div id="mt-kicker" class="mt-kicker"></div>
        <div id="mt-title"  class="mt-title">—</div>
        <div id="mt-artist" class="mt-artist">—</div>
      </div>
    </div>

    <div class="mt-controls">
      <button class="mt-btn" id="mt-zone" aria-label="Choose zone" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="2.5" width="14" height="19" rx="2.5"/>
          <circle cx="12" cy="14" r="3.4"/>
          <circle cx="12" cy="6.4" r="1.1"/>
        </svg>
      </button>
      <button class="mt-btn mt-vol-btn" id="mt-vol-btn" aria-label="Volume" aria-expanded="false">
        <svg id="mt-icon-vol" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>
        </svg>
        <svg id="mt-icon-mute" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="hidden">
          <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5V12zM19 12c0 .9-.18 1.76-.5 2.55l1.51 1.51A8.96 8.96 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.17v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
        </svg>
      </button>
    </div>

    <div class="mt-zone-popover hidden" id="mt-zone-popover" role="dialog" aria-label="Play on">
      <div class="np-popover-title">Play on</div>
      <div class="np-device-list" id="mt-zone-list"></div>
      <button class="np-popover-action" type="button" id="mt-group-open">Group zones…</button>
      <button class="np-popover-action" type="button" id="mt-power-open">Device power…</button>
      <button class="np-popover-action" type="button" id="mt-pause-all">Pause all zones</button>
      <button class="np-popover-action" type="button" id="mt-mute-all">Mute all zones</button>
      <button class="np-popover-action" type="button" id="mt-unmute-all">Unmute all zones</button>
    </div>

    <!-- Roon-style volume sheet: [icon + value] [slider with min/max scale] [− +] -->
    <div class="mt-vol-popover vol-sheet hidden" id="mt-vol-popover" role="dialog" aria-label="Volume">
      <div class="vol-readout" aria-hidden="true">
        <span class="vol-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
          </svg>
        </span>
        <span class="vol-value" id="mt-vol-value">50</span>
      </div>
      <div class="vol-slider-wrap" id="mt-vol-sliderwrap">
        <input type="range" id="mt-vol-slider" class="vol-range" min="0" max="100" step="1" value="50" aria-label="Volume level">
        <div class="vol-scale" aria-hidden="true"><span id="mt-vol-min">0</span><span id="mt-vol-max">100</span></div>
      </div>
      <button class="vol-step" id="mt-vol-minus" aria-label="Volume down"><svg class="vol-step-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <button class="vol-step" id="mt-vol-plus" aria-label="Volume up"><svg class="vol-step-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    </div>
  </div>
`);
})();

(function nowPlayingReduced() {
  "use strict";
  const found = document.getElementById("album-modal");
  if (!found) return;
  const modal = found;
  const sizeBtn = document.getElementById("modal-np-size-btn");
  const panel = /** @type {HTMLElement | null} */ (modal.querySelector(".modal-panel"));
  const SIZE_KEY = "rra-np-reduced";
  const large = window.matchMedia ? window.matchMedia("(min-width: 1200px) and (min-height: 700px)") : null;
  let reduced = false;
  try { reduced = localStorage.getItem(SIZE_KEY) === "1"; }
  catch (e) { /* storage blocked — full size, the default */ }
  let dx = 0, dy = 0;

  const place = () => { if (panel) panel.style.transform = (dx || dy) ? "translate(" + dx + "px," + dy + "px)" : ""; };
  function paintSize() {
    const on = reduced && !!(large && large.matches) && modal.classList.contains("np-mode");
    if (modal.classList.contains("np-reduced") !== on) modal.classList.toggle("np-reduced", on);
    if (!on) { dx = 0; dy = 0; place(); }
    if (sizeBtn) {
      sizeBtn.setAttribute("aria-pressed", on ? "true" : "false");
      sizeBtn.setAttribute("aria-label", on ? "Full size" : "Reduce size");
      sizeBtn.title = on ? "Full size" : "Reduce size";
    }
  }
  if (sizeBtn) sizeBtn.addEventListener("click", () => {
    reduced = !modal.classList.contains("np-reduced");
    try { localStorage.setItem(SIZE_KEY, reduced ? "1" : "0"); }
    catch (e) { /* storage blocked — it still applies for this visit */ }
    dx = 0; dy = 0;
    paintSize();
  });
  if (large) {
    if (large.addEventListener) large.addEventListener("change", paintSize);
    else if (large.addListener) large.addListener(paintSize);
  }
  // Opening and closing come and go through the classes on the modal, so the
  // state follows them: a fresh opening is centred.
  // Every write below is guarded by a check that it CHANGES something:
  // classList.remove() rewrites the class attribute even when the token is
  // absent, and that write would wake this observer again, for ever.
  new MutationObserver(() => {
    if (modal.classList.contains("hidden") || !modal.classList.contains("np-mode")) {
      if (modal.classList.contains("np-reduced")) modal.classList.remove("np-reduced");
      if (dx || dy) { dx = 0; dy = 0; place(); }
    } else if (reduced && !modal.classList.contains("np-reduced") && large && large.matches) {
      paintSize();
    }
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });

  // Drag by the top strip: a press on the panel above its body's content —
  // never on a button, a tab or anything that is itself interactive.
  const STRIP = 56;
  /** @type {{ id: number, x: number, y: number, baseLeft: number, baseTop: number, w: number, h: number } | null} */
  let drag = null;
  if (panel) panel.addEventListener("pointerdown", (e) => {
    if (!modal.classList.contains("np-reduced") || e.button !== 0) return;
    if (/** @type {Element} */ (e.target).closest("button, a, input, select, .modal-tabs, [role='button']")) return;
    const box = panel.getBoundingClientRect();
    if (e.clientY - box.top > STRIP) return;
    drag = { id: e.pointerId, x: e.clientX - dx, y: e.clientY - dy,
             baseLeft: box.left - dx, baseTop: box.top - dy, w: box.width, h: box.height };
    panel.classList.add("is-dragging");
    try { panel.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety; the move handler still works */ }
    e.preventDefault();
  });
  if (panel) panel.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Kept wholly on screen, so its corner buttons can never be dragged out
    // of reach.
    const minX = -drag.baseLeft, maxX = Math.max(minX, window.innerWidth - drag.baseLeft - drag.w);
    const minY = -drag.baseTop,  maxY = Math.max(minY, window.innerHeight - drag.baseTop - drag.h);
    dx = Math.max(minX, Math.min(maxX, e.clientX - drag.x));
    dy = Math.max(minY, Math.min(maxY, e.clientY - drag.y));
    place();
  });
  const endDrag = (/** @type {PointerEvent} */ e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    if (panel) panel.classList.remove("is-dragging");
  };
  if (panel) {
    panel.addEventListener("pointerup", endDrag);
    panel.addEventListener("pointercancel", endDrag);
  }
  paintSize();
})();

(function nowPlayingThreeColumns() {
  "use strict";
  const W = /** @type {any} */ (window);
  const found = document.getElementById("album-modal");
  if (!found) return;
  const modal = found;
  const three = W.matchMedia ? W.matchMedia(W.RouenAlbumView.THREE) : null;
  // What album-view.css draws three columns for, read from the classes as they are now (never a copy of them, which
  // went stale when Back closed Now playing and opened an album in one go: the queue stayed on the album view).
  const threeColumns = () => !!(three && three.matches && !modal.classList.contains("hidden") &&
    modal.classList.contains("np-mode") && !modal.classList.contains("np-reduced"));

  // The review in the middle: the playing album's, asked for again when another starts. A stream, or a track with no
  // album, has none, rather than its song's title asked for as an album's.
  let shownKey = "";
  /** @param {any} np the zone's now_playing, from the transport's poll */
  function playing(np) {
    if (!np || !threeColumns()) return;
    const key = JSON.stringify([np.line3 || "", np.line2 || ""]);
    if (key === shownKey) return;
    shownKey = key;
    W.__npReview(np.line3 ? { title: np.line3, subtitle: np.line2 || "", image_key: np.image_key } : null);
  }

  // Into the three columns: the queue read, and the review asked for (the transport's refresh calls playing()).
  // Told once the modal's classes have settled, so a card reduced as it opens is never taken for them.
  let was = false;
  function follow() {
    const on = threeColumns();
    if (on === was) return;
    was = on;
    shownKey = "";
    if (!on) return;
    W.__npThreeOn();
    if (typeof W.__refreshTransport === "function") W.__refreshTransport();
  }
  // Safari before 14 has only addListener; without it this threw, and nothing below ran.
  if (three && three.addEventListener) three.addEventListener("change", follow);
  else if (three && three.addListener) three.addListener(follow);
  // Opening, closing and reducing all come and go through the modal's classes.
  new MutationObserver(follow).observe(modal, { attributes: true, attributeFilter: ["class"] });
  W.RouenNowPlaying = { threeColumns, playing };
})();
