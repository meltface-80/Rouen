// @ts-check
/*
 * filter-sheet.js — the Filter sheet's markup (All / Genre / Tag / Decade), moved out of index.html unchanged
 * (v1.9.72-t59), so index.html shrinks as the catch-up's Settings page (catchup.js) adds its own script tag. What the
 * sheet does is still app.js's.
 *
 * Loaded where the markup stood, before app.js, which finds the sheet's controls when it starts: the markup is inserted
 * where this script's tag stands, as settings-sheet.js does.
 */
(function filterSheet() {
  "use strict";
  const here = document.currentScript;
  if (!here) return;
  here.insertAdjacentHTML("beforebegin", `
  <!-- Filter bottom sheet (All / Genre / Tag) -->
  <div id="filter-overlay" class="settings-overlay hidden" role="dialog" aria-modal="true" aria-label="Filter">
    <div class="settings-backdrop" data-filter-close></div>
    <div class="settings-sheet filter-sheet">
      <div class="settings-grip"></div>
      <div class="settings-head">
        <h2>Filter</h2>
      </div>

      <button class="filter-row" id="filter-all" type="button">
        <span>All albums</span>
        <span class="filter-check" data-for="all">✓</span>
      </button>

      <div class="settings-divider"></div>

      <button class="filter-section-toggle" id="filter-genres-toggle" type="button" aria-expanded="false">
        <span>Genre</span>
        <svg class="filter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="filter-list hidden" id="filter-genres-list"></div>

      <div class="settings-divider"></div>

      <button class="filter-section-toggle" id="filter-tags-toggle" type="button" aria-expanded="false">
        <span>Tag</span>
        <svg class="filter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="filter-list hidden" id="filter-tags-list"></div>

      <div class="settings-divider"></div>

      <button class="filter-section-toggle" id="filter-decades-toggle" type="button" aria-expanded="false">
        <span>Decade</span>
        <svg class="filter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="filter-list hidden" id="filter-decades-list"></div>

      <p class="settings-help filter-hint">
        Tip: in Roon, use Focus (e.g. hi-res only), select all, and add the
        results to a Tag — then filter by that Tag here.
      </p>
    </div>
  </div>
`);
})();
