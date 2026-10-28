// @ts-check
/*
 * select-bars.js — the markup of the label merge bar, the album selection bar and the label unmerge sheet, moved out of
 * index.html in v1.9.71-t1, unchanged: index.html is over its length limit (dev/quality.md), so a change to it moves
 * code out, and this block stands alone.
 *
 * Loaded before app.js, which finds these elements by id when it starts: the markup is inserted where this script's
 * tag stands, which is where it stood in index.html, as album-view.js does. app.js does all the rest, as before.
 */
(function selectBars() {
  "use strict";
  const here = document.currentScript;
  if (!here) return;
  here.insertAdjacentHTML("beforebegin", `
  <!-- Label merge action bar: appears in select mode -->
  <div id="label-merge-bar" class="label-merge-bar hidden" role="toolbar" aria-label="Label merge">
    <span id="label-merge-info" class="label-merge-info"></span>
    <div class="label-merge-actions">
      <button id="label-merge-btn" class="action-btn primary" type="button" disabled>Merge</button>
      <button id="label-merge-cancel-btn" class="icon-btn" type="button" aria-label="Cancel selection">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Album multi-select action bar: Play Now / Queue selected albums -->
  <div id="album-action-bar" class="label-merge-bar hidden" role="toolbar" aria-label="Album actions">
    <span id="album-action-info" class="label-merge-info"></span>
    <div class="label-merge-actions">
      <button id="album-action-cancel-btn" class="icon-btn" type="button" aria-label="Cancel selection">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Label unmerge sheet: slide up to manage merged labels one by one -->
  <div id="label-unmerge-sheet" class="label-unmerge-sheet hidden" role="dialog" aria-modal="true" aria-labelledby="label-unmerge-heading">
    <div class="label-unmerge-header">
      <span id="label-unmerge-heading">Merged into <strong id="label-unmerge-name"></strong></span>
      <button id="label-unmerge-close" class="icon-btn" type="button" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div id="label-unmerge-list" class="label-unmerge-list"></div>
  </div>
`);
})();
