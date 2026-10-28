// @ts-check
/*
 * album-view.js — the album view's markup (#album-modal: the album page, and Now playing, which shares it), moved out
 * of index.html in v1.9.70-t10 (dev/design/album-view-landscape.md §6), unchanged but for one comment's backticks:
 * the album view is to be the one every screen opens, the Shelf's page too, so its markup leaves the remote's page for
 * a file both can load; and index.html is over its length limit (dev/quality.md), so a change to it moves code out.
 *
 * Loaded before app.js, which finds these elements by id when it starts: the markup is inserted where this script's
 * tag stands, which is where it stood in index.html, as random-pick-sheet.js does. app.js does all the rest, as
 * before; public/album-view.css lays it out in three columns on a landscape screen (§4).
 */
/*
 * And what the album view does that its three columns (album-view.css) made its own (v1.9.70-t10; moved out of
 * app.js, which is over its length limit, and grown):
 *
 *   window.__setupBioToggle(text, toggle)        a review's Show more, shown only when the review is clipped — and
 *                                                checked again when the screen crosses into or out of the three
 *                                                columns, where the review is never clipped (a tablet turned round)
 *   RouenAlbumView.resetScroll(modal)            every scroller of the view to its top: the body, and in three
 *                                                columns the tracks and the review, which scroll on their own
 *   RouenAlbumView.scrollOf(modal)               where the body and the tracks are scrolled to
 *   RouenAlbumView.restoreScroll(modal, at, current)  put back, once the track list is long enough to hold it again
 *                                                (it loads after the view opens); current() false stops it
 */
(function albumViewBehaviour() {
  "use strict";
  const W = /** @type {any} */ (window);
  /** album-view.css's three columns. */
  const THREE = "(orientation: landscape) and (min-width: 1000px) and (min-height: 600px)";

  /** @param {HTMLElement} textEl @param {HTMLElement} toggleEl */
  function checkBio(textEl, toggleEl) {
    textEl.dataset.clipped = "true";
    if (textEl.scrollHeight > textEl.clientHeight + 4) {
      toggleEl.classList.remove("hidden");
      toggleEl.textContent = "Show more";
      toggleEl.onclick = () => {
        const isClipped = textEl.dataset.clipped === "true";
        textEl.dataset.clipped = isClipped ? "false" : "true";
        toggleEl.textContent = isClipped ? "Show less" : "Show more";
      };
    } else {
      toggleEl.classList.add("hidden");
    }
  }
  // Shared with the artist-albums view and the Qobuz artist screen (app.js's separate IIFEs): the same clamp and
  // expand everywhere a bio renders.
  W.__setupBioToggle = (/** @type {HTMLElement} */ textEl, /** @type {HTMLElement} */ toggleEl) =>
    requestAnimationFrame(() => checkBio(textEl, toggleEl));
  if (W.matchMedia) {
    const three = W.matchMedia(THREE);
    const recheck = () => {
      const text = document.getElementById("album-bio-text"), toggle = document.getElementById("album-bio-toggle");
      if (text && toggle && text.textContent && text.textContent.trim()) checkBio(text, toggle);
    };
    // Safari before 14 (iOS 13 and older) has only addListener: addEventListener threw there and stopped this file,
    // and with it every album opened (v1.9.70-t11, test/dom/album-view-old-safari.test.js).
    if (three.addEventListener) three.addEventListener("change", recheck);
    else if (three.addListener) three.addListener(recheck);
  }

  /** @param {Element} modal @returns {HTMLElement[]} the body, the tracks, the review */
  const scrollers = (modal) => /** @type {HTMLElement[]} */ ([".modal-body", ".track-list-wrap", "#album-bio-section"]
    .map((q) => modal.querySelector(q)).filter(Boolean));
  /** @param {Element} modal */
  function resetScroll(modal) { for (const e of scrollers(modal)) e.scrollTop = 0; }
  /** @param {Element} modal */
  function scrollOf(modal) {
    const [body, tracks] = [modal.querySelector(".modal-body"), modal.querySelector(".track-list-wrap")];
    return { body: body ? body.scrollTop : 0, tracks: tracks ? tracks.scrollTop : 0 };
  }
  /** @param {Element} modal @param {{ body: number, tracks: number }} at @param {() => boolean} current */
  function restoreScroll(modal, at, current) {
    const parts = /** @type {Array<[HTMLElement | null, number]>} */ ([[modal.querySelector(".modal-body"), at.body || 0],
      [modal.querySelector(".track-list-wrap"), at.tracks || 0]]).filter(([e, want]) => e && want > 0);
    if (!parts.length) return;
    let tries = 0;
    const settle = () => {
      // Stop if the view was closed or something else was opened meanwhile.
      if (!current()) return;
      let left = 0;
      for (const [e, want] of parts) {
        const el = /** @type {HTMLElement} */ (e);
        if (el.scrollHeight - el.clientHeight >= want) el.scrollTop = want; else left++;
      }
      if (left && ++tries < 20) setTimeout(settle, 100);
    };
    setTimeout(settle, 50);
  }
  W.RouenAlbumView = { resetScroll, scrollOf, restoreScroll };
})();

(function albumViewMarkup() {
  "use strict";
  const here = document.currentScript;
  if (!here) return;
  here.insertAdjacentHTML("beforebegin", `
  <div id="album-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-backdrop" data-close></div>
    <div class="modal-panel">
      <!-- Ambient glow: the album cover, heavily blurred and faded, washes the
           top of the panel so each album tints its own detail view (decorative
           only — hidden from AT, never intercepts taps). -->
      <img id="modal-ambient" class="modal-ambient hidden" alt="" aria-hidden="true">
      <!-- Full screen (a phone held upright) this is a back chevron: the panel
           is somewhere you came FROM the grid. From 720px up the album view is
           a card hovering over the page, and a card closes with an × (v1.8.75).
           Same button, same data-close — only the glyph (CSS) and the label
           (app.js) follow the layout. -->
      <button class="modal-close icon-btn" id="modal-close-btn" data-close aria-label="Back" title="Back">
        <svg class="ico-back" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        <svg class="ico-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
      <!-- Now-playing mode only (CSS-gated): top-left Back (v1.8.75 — it was a
           Home button, which was the only way out and always went Home). It
           returns to the screen before the mini player was tapped: the album
           that was open, or the screen underneath. -->
      <button class="modal-home icon-btn" id="modal-home-btn" aria-label="Back" title="Back">
        <svg class="ico-back" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        <!-- A desktop (a mouse, a large screen) CLOSES Now playing; a phone or
             tablet goes back. Same action — only the glyph and label differ. -->
        <svg class="ico-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
      <!-- Now-playing mode, large screens only (CSS-gated): shrink the screen to
           the album view's card size and back. The card can then be dragged by
           its top strip. -->
      <button class="modal-np-size icon-btn" id="modal-np-size-btn" type="button"
              aria-label="Reduce size" title="Reduce size" aria-pressed="false">
        <svg class="ico-shrink" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
          <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
        </svg>
        <svg class="ico-grow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
          <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
        </svg>
      </button>
      <button class="modal-share icon-btn" id="modal-share-btn" aria-label="Share card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        </svg>
      </button>

      <div class="modal-body">
        <div class="modal-tabs hidden" id="modal-tabs">
          <button class="modal-tab is-active" type="button" data-tab="album">Now playing</button>
          <button class="modal-tab"           type="button" data-tab="queue">Queue</button>
        </div>
        <!-- No source badge on this artwork (v1.8.60). The album view and Now
             playing share it, and its top-right corner is where the Share
             button sits: the local / Qobuz / TIDAL mark showed through under
             the button. The tiles on every grid keep theirs. -->
        <div class="modal-art">
          <img id="modal-img" alt="">
          <span id="modal-quality" class="album-quality hidden"></span>
          <!-- Previous / next album in the list this one was opened from
               (v1.8.66). A quiet hint on the cover's edges for what a swipe
               on the card does; shown only when there IS a neighbour that
               way, and never on Now playing. -->
          <button class="modal-step modal-step-prev hidden" id="modal-prev" type="button"
                  aria-label="Previous album" title="Previous album">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="modal-step modal-step-next hidden" id="modal-next" type="button"
                  aria-label="Next album" title="Next album">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <!-- About this album (v1.8.81, Mandarin v0.7.8): a sibling of the cover,
             so from 720px up (a tablet, a laptop) it sits UNDER the cover in the
             left-hand column while the title, the buttons and the tracks run
             down the right. On a phone it follows the tracks, as before
             (style.css puts it there with "order"). Not on Now playing. -->
        <div class="modal-aside" id="modal-aside">
          <div class="bio-section hidden" id="album-bio-section">
            <h3 class="section-label">About this album</h3>
            <div class="bio-meta" id="album-meta"></div>
            <div class="bio-text" id="album-bio-text" data-clipped="true"></div>
            <!-- Whose words those are, shown only when it is NOT the same place
                 the link below goes — which is the Pitchfork case, where the
                 text is Wikipedia's and the link is the review. -->
            <div class="bio-text-source hidden" id="album-bio-text-source"></div>
            <div class="bio-footer">
              <button class="bio-toggle hidden" type="button" id="album-bio-toggle">Show more</button>
              <a class="bio-source hidden" id="album-bio-source" target="_blank" rel="noopener noreferrer"></a>
            </div>
          </div>
          <!-- Below the review (v1.9.3): the library's other albums by this
               album's artist and the ones they appear on, then Last.fm's
               similar artists and similar albums. Each is hidden until it has
               something to show; three at first, More shows the rest. -->
          <div class="more-section hidden" id="album-more-by">
            <h3 class="section-label"><span class="more-title">More by this artist</span></h3>
            <div class="more-grid"></div>
            <button class="more-toggle hidden" type="button" aria-expanded="false">More</button>
          </div>
          <div class="more-section hidden" id="album-more-appears">
            <h3 class="section-label"><span class="more-title">Appears on</span></h3>
            <div class="more-grid"></div>
            <button class="more-toggle hidden" type="button" aria-expanded="false">More</button>
          </div>
          <div class="more-section hidden" id="album-lastfm-artists">
            <h3 class="section-label"><span class="more-title">Similar artists</span>
              <a class="more-site hidden" target="_blank" rel="noopener noreferrer">Last.fm ↗</a></h3>
            <div class="more-grid more-grid-artists"></div>
            <button class="more-toggle hidden" type="button" aria-expanded="false">More</button>
          </div>
          <div class="more-section hidden" id="album-lastfm-albums">
            <h3 class="section-label"><span class="more-title">Similar albums</span></h3>
            <div class="more-grid"></div>
            <button class="more-toggle hidden" type="button" aria-expanded="false">More</button>
          </div>
        </div>
        <div class="modal-info">
          <h2 id="modal-title">—</h2>
          <div id="modal-subtitle" class="modal-subtitle"></div>

          <div class="modal-tab-pane" id="tab-album">

          <div id="np-screen" class="np-screen hidden">
            <div class="np-track" id="np-track">—</div>
            <div class="np-artist" id="np-artist">—</div>
            <button class="np-album" id="np-album" type="button" aria-label="Open album detail"></button>

            <div class="np-progress">
              <!-- Behind the seek input, not instead of it: the range is what
                   makes the bar draggable and accessible, and it keeps every
                   one of its behaviours. The canvas is decoration under it,
                   hidden whenever there is no waveform for the track. -->
              <canvas id="np-wave" class="np-wave hidden" aria-hidden="true"></canvas>
              <input type="range" id="np-seek" class="np-seek" min="0" max="100" step="1" value="0"
                     aria-label="Seek" disabled>
              <div class="np-times">
                <span id="np-cur" class="np-time">0:00</span>
                <span id="np-tot" class="np-time">0:00</span>
              </div>
            </div>

            <div class="np-transport">
              <button class="np-btn np-mode-btn" id="np-shuffle" aria-label="Shuffle" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="16 3 21 3 21 8"/>
                  <line x1="4" y1="20" x2="21" y2="3"/>
                  <polyline points="21 16 21 21 16 21"/>
                  <line x1="15" y1="15" x2="21" y2="21"/>
                  <line x1="4" y1="4" x2="9" y2="9"/>
                </svg>
              </button>
              <button class="np-btn" id="np-prev" aria-label="Previous track" disabled>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6 6h2v12H6zM9.5 12l10-6v12z"/>
                </svg>
              </button>
              <button class="np-btn np-playpause" id="np-playpause" aria-label="Play/pause">
                <svg id="np-icon-play"  viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <svg id="np-icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="hidden">
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z"/>
                </svg>
              </button>
              <button class="np-btn" id="np-next" aria-label="Next track" disabled>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16 6h2v12h-2zM4.5 6l10 6-10 6z"/>
                </svg>
              </button>
              <!-- Repeat cycles off → whole queue → this track, like Roon.
                   The "1" badge is DOM text, not an SVG glyph, so it themes and
                   scales with the rest of the interface. -->
              <button class="np-btn np-mode-btn" id="np-loop" aria-label="Repeat off">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="17 1 21 5 17 9"/>
                  <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/>
                  <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
                <span class="np-mode-badge hidden" id="np-loop-badge" aria-hidden="true">1</span>
              </button>
            </div>

            <div class="np-secondary">
              <!-- Device / zone picker -->
              <button class="np-mini-btn" id="np-device" aria-label="Choose device" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="5" y="2.5" width="14" height="19" rx="2.5"/>
                  <circle cx="12" cy="14" r="3.4"/>
                  <circle cx="12" cy="6.4" r="1.1"/>
                </svg>
              </button>
              <div class="np-popover np-device-popover hidden" id="np-device-popover">
                <div class="np-popover-title">Play on</div>
                <div class="np-device-list" id="np-device-list"></div>
                <button class="np-popover-action" type="button" id="np-group-open">Group zones…</button>
                <button class="np-popover-action" type="button" id="np-power-open">Device power…</button>
                <button class="np-popover-action" type="button" id="np-pause-all">Pause all zones</button>
                <button class="np-popover-action" type="button" id="np-mute-all">Mute all zones</button>
                <button class="np-popover-action" type="button" id="np-unmute-all">Unmute all zones</button>
              </div>

              <!-- Volume: tap the speaker to reveal the slider (hidden when fixed) -->
              <div class="np-vol">
                <button class="np-mini-btn" id="np-volbtn" aria-label="Volume" aria-expanded="false">
                  <svg id="np-icon-vol" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
                  </svg>
                  <svg id="np-icon-mute" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="hidden">
                    <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5V12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.17v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
                  </svg>
                </button>
                <!-- Same Roon-style volume sheet as the mini bar's -->
                <div class="np-popover np-vol-popover vol-sheet hidden" id="np-vol-popover">
                  <div class="vol-controls" id="np-vol-controls">
                    <div class="vol-readout" aria-hidden="true">
                      <span class="vol-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
                        </svg>
                      </span>
                      <span class="vol-value" id="np-vol-value">50</span>
                    </div>
                    <div class="vol-slider-wrap" id="np-vol-sliderwrap">
                      <input type="range" id="np-vol-slider" class="vol-range" min="0" max="100" step="1" value="50"
                             aria-label="Volume">
                      <div class="vol-scale" aria-hidden="true"><span id="np-vol-min">0</span><span id="np-vol-max">100</span></div>
                    </div>
                    <button class="vol-step" id="np-vol-minus" aria-label="Volume down"><svg class="vol-step-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                    <button class="vol-step" id="np-vol-plus" aria-label="Volume up"><svg class="vol-step-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                  </div>
                  <div class="np-vol-fixed hidden" id="np-vol-fixed">
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
                    </svg>
                    <span>Volume control is fixed</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-actions" id="modal-actions">
            <!-- buttons injected -->
          </div>

          <div class="track-list-wrap">
            <h3 class="section-label">Tracks</h3>
            <ol id="modal-tracks" class="track-list"></ol>
          </div>

          </div><!-- /#tab-album -->

          <div class="modal-tab-pane hidden" id="tab-queue">
            <div id="queue-summary" class="queue-summary"></div>
            <ol id="queue-list" class="queue-list"></ol>
            <div id="queue-empty" class="queue-empty hidden">Queue is empty.</div>
          </div>

        </div>
      </div>
    </div>
  </div>
`);
})();
