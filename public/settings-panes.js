// @ts-check
/*
 * settings-panes.js — the Settings sheet's other pages, moved out of index.html unchanged (v1.9.72-t33): Streaming
 * accounts, Share Card, Wall display, UI Settings and Backup & restore, in that order. settings-sheet.js inserts the
 * sheet and its first pages; these go at its end, where they stood, so the pages are in index.html's old order.
 * settings-pages.js later puts the Home Screen's, Discover's and Smart Picks' pages before Backup & restore's.
 *
 * Loaded straight after settings-sheet.js, before app.js, which collects the Settings pages when it starts.
 */
(function settingsPanes() {
  "use strict";
  const sheet = document.querySelector("#settings-overlay .settings-sheet");
  if (!sheet) return;
  sheet.insertAdjacentHTML("beforeend", `
      <!-- Streaming accounts -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="streaming">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Services</h2>
        </div>
        <p class="settings-pane-desc">Qobuz &amp; Tidal</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Qobuz account <button class="settings-info-btn" data-info="Signs in on Qobuz&#x27;s own page — your password is never typed into or seen by this app. One sign-in covers browsing and searching Qobuz, your Qobuz favourites, source badges and sample rates, and Qobuz waveforms. If this device isn&#x27;t on your home network, paste the address you land on into the box and tap Finish. Uses an unofficial API, so it may break." aria-label="Info">ⓘ</button></span>
          </div>
          <div class="settings-token-row">
            <button id="qobuz-connect" class="settings-update-btn" type="button">Connect</button>
          </div>
          <div id="qobuz-status" class="settings-token-status"></div>
          <!-- Only shown when the redirect cannot land back here — a sign-in
               done on a device that is not on this network. -->
          <div id="qobuz-signin-paste" class="settings-token-row" hidden>
            <input id="qobuz-signin-url" class="settings-token-input" placeholder="Paste the address you were sent to…" autocomplete="off" spellcheck="false">
            <button id="qobuz-signin-finish" class="settings-update-btn" type="button">Finish</button>
          </div>
          <button id="qobuz-disconnect" class="settings-update-btn hidden" type="button">Disconnect</button>
          <div class="settings-token-status" style="opacity:.6;font-size:11px;margin-top:6px;">Unofficial Qobuz API — against Qobuz ToS, may break, use at your own risk.</div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Tidal account <button class="settings-info-btn" data-info="Signs in on TIDAL&#x27;s own device page — your password is never typed here. Used to browse and search TIDAL, manage your TIDAL favourites, source badges and quality, and draw waveforms for TIDAL tracks (the audio is analysed, never kept). Roon still does all the playing. Uses an unofficial API (the Lyrion/LMS TIDAL plugin&#x27;s client id), against TIDAL&#x27;s terms, so it may break." aria-label="Info">ⓘ</button></span>
          </div>
          <button id="tidal-connect" class="settings-update-btn" type="button">Connect Tidal…</button>
          <div id="tidal-auth-pending" class="tidal-auth-pending hidden"></div>
          <div id="tidal-status" class="settings-token-status"></div>
          <button id="tidal-disconnect" class="settings-update-btn hidden" type="button">Disconnect</button>
          <div class="settings-token-status" style="opacity:.6;font-size:11px;margin-top:6px;">Unofficial Tidal API — against Tidal ToS, may break, use at your own risk.</div>
        </div>
      </div>

      <!-- Share Card — the links under the card, grouped in one place -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="sharecard" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Share Card</h2>
        </div>
        <p class="settings-pane-desc">The links under the card</p>

        <div class="settings-block">
          <h3 class="settings-block-title">Services <button class="settings-info-btn" data-info="Each link opens the album on that service — usually as a search. Qobuz links are looked up in advance so they open the album itself in the Qobuz app. A suggestion that is already in your Roon library is queued instead." aria-label="About Services">ⓘ</button></h3>
          <!-- Filled from /api/settings/share-links: the list of what CAN be
               linked to lives in lib/share-links.js, so this screen and the
               chips can never disagree about which services exist. -->
          <div id="share-services-list" class="share-toggle-list"></div>
          <div class="settings-row settings-row-top">
            <span class="settings-label">Default <button class="settings-info-btn" data-info="Where a suggestion goes when the record is not in your Roon library. You can also set it by holding a service button under the share card. This is per device, so a phone and a tablet can differ." aria-label="Info">&#9432;</button></span>
            <div class="settings-select-wrap">
              <select id="share-default-service" class="settings-select" aria-label="Default service"></select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="settings-block">
          <h3 class="settings-block-title">Reviews <button class="settings-info-btn" data-info="Pitchfork and Wikipedia link to the actual page when it has already been found for the card, and to a search when it has not." aria-label="About Reviews">ⓘ</button></h3>
          <div id="share-reviews-list" class="share-toggle-list"></div>
        </div>
      </div>

      <!-- Wall display -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="display">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Wall Display</h2>
        </div>
        <p class="settings-pane-desc">Always-on screen &amp; screensaver</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Wall display <button class="settings-info-btn" data-info="Off by default. An always-on screen at http://&lt;server-ip&gt;:3399/display — open it from the menu or point any tablet or TV browser at it. Rotates album art, artist photos (needs a FanArt.tv key), a review, artist bios and grids from your library you can tap to play, with a progress bar for the playing zone. ‹ Remote in its top-left corner comes back, and Shelf › opposite opens Shelf. When off, the page shows a notice and nothing is fetched." aria-label="Info">ⓘ</button></span>
            <label class="switch">
              <input type="checkbox" id="display-toggle" aria-label="Wall display">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-row">
            <span class="settings-label">Rotate every <span id="display-seconds-value">10s</span></span>
            <input type="range" id="display-seconds" class="settings-range" min="5" max="60" step="1" value="10"
                   aria-label="Display rotation interval in seconds">
          </div>
        </div>

        <!-- Per device (localStorage), unlike everything above it: the wall
             tablet wants a screensaver and the phone in a pocket does not. -->
        <div class="settings-block">
          <h3 class="settings-block-title">This device</h3>
          <div class="settings-row settings-row-top">
            <span class="settings-label">Switch to the wall display <button class="settings-info-btn" data-info="After this long with nobody touching this device, it switches from the remote to the wall display — a screensaver. Tap ‹ Remote, top left on the display, to come straight back. Shelf, opened on this device, goes to the wall display after the same time. Set on this device only, and only while the wall display is switched on. It waits while Settings, a sheet or a selection is open, so nothing you are in the middle of is thrown away." aria-label="Info">&#9432;</button></span>
            <div class="settings-select-wrap">
              <select id="display-idle-select" class="settings-select" aria-label="Switch to the wall display after">
                <option value="0">Never</option>
                <option value="1">After 1 minute</option>
                <option value="2">After 2 minutes</option>
                <option value="5">After 5 minutes</option>
                <option value="10">After 10 minutes</option>
                <option value="15">After 15 minutes</option>
                <option value="30">After 30 minutes</option>
                <option value="60">After 1 hour</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- UI Settings (v1.8.77): text size, grid layout and tile size, per
           device — a phone and a wall-mounted tablet want different answers.
           The theme and the sample-rate switch moved here from Appearance in
           v1.8.79 (where Mandarin keeps its look), and Appearance went. -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="ui" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>UI Settings</h2>
        </div>
        <p class="settings-pane-desc">Theme, text size, layout &amp; tile size</p>

        <div class="settings-block">
          <span class="settings-label">Theme</span>
          <!-- Rows are built by app.js from its THEMES table, so the list and
               the palettes can never drift apart. -->
          <div id="theme-list" class="theme-list" role="radiogroup" aria-label="Theme"></div>
          <div class="theme-apply-row">
            <span id="theme-apply-hint" class="theme-apply-hint"></span>
            <button id="theme-apply" class="action-btn primary" type="button" disabled>Apply</button>
          </div>
        </div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Album &amp; artist text <button class="settings-info-btn" data-info="The size of the album name and artist name under every tile — on the Home carousels and on every grid screen." aria-label="About Album &amp; artist text">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="ui-text-select" class="settings-select" aria-label="Album &amp; artist text">
                <option value="1">Normal</option>
                <option value="1.1">+10%</option>
                <option value="1.25">+25%</option>
                <option value="1.5">+50%</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Grid screen title <button class="settings-info-btn" data-info="The size of the title at the top of a grid screen, such as the one a Home carousel opens to, and of a playlist's name." aria-label="About Grid screen title">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="ui-title-select" class="settings-select" aria-label="Grid screen title">
                <option value="1">Normal</option>
                <option value="1.1">+10%</option>
                <option value="1.25">+25%</option>
                <option value="1.5">+50%</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Menu &amp; Home Screen text <button class="settings-info-btn" data-info="The size of every other piece of text in the app: the side menu, Home's row titles and greeting, Settings, sheets, buttons and lists. Album and artist names under tiles, and a grid screen's title, have their own settings above." aria-label="About Menu &amp; Home Screen text">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="ui-chrome-select" class="settings-select" aria-label="Menu &amp; Home Screen text">
                <option value="1">Normal</option>
                <option value="1.1">+10%</option>
                <option value="1.25">+25%</option>
                <option value="1.5">+50%</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Grid layout <button class="settings-info-btn" data-info="How album, playlist and label grid screens are laid out. Auto fits as many columns as the screen suits (and follows Tile size). 3 or 2 columns fixes the count on every screen. List shows one row per album." aria-label="About Grid layout">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="ui-layout-select" class="settings-select" aria-label="Grid layout">
                <option value="auto">Auto</option>
                <option value="3">3 columns</option>
                <option value="2">2 columns</option>
                <option value="list">List</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Tile size <button class="settings-info-btn" data-info="The size of album and label tiles on every screen. On the Home carousels it sets the tile width; on a grid screen in Auto layout it sets how many columns fit — bigger tiles, fewer columns. On a small screen a 10% step may not change the column count, only the carousels." aria-label="About Tile size">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="ui-tile-select" class="settings-select" aria-label="Tile size">
                <option value="0.5">−50%</option>
                <option value="0.75">−25%</option>
                <option value="0.9">−10%</option>
                <option value="1">Normal</option>
                <option value="1.1">+10%</option>
                <option value="1.25">+25%</option>
                <option value="1.5">+50%</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Show sample rate on artwork <button class="settings-info-btn" data-info="Puts the bit depth and sample rate on every album tile — 24/96, 16/44.1, or the file type for a lossy one. Read from your own files during the library scan, and for albums you have no file for, from the Qobuz or TIDAL account you've connected in Settings. Qobuz states an exact bit depth and rate; TIDAL states a tier, so those read Hi-Res or Lossless. Hi-res albums are highlighted. An album from neither shows nothing rather than a guess." aria-label="Info">ⓘ</button></span>
            <label class="switch">
              <input type="checkbox" id="quality-toggle" aria-label="Show sample rate on artwork">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
        </div>
        <p class="settings-note">Saved on this device only.</p>
      </div>

      <!-- Backup & restore (v1.8.84, after Mandarin v0.6.14). The parts, the
           list and the restore all come from /api/backups; lib/backup.js says
           what each part holds and what is never in one. -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="backup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Backup &amp; restore</h2>
        </div>
        <p class="settings-pane-desc">Kept on the server — the last 10, each downloadable</p>

        <div class="settings-block">
          <h3 class="settings-block-title">What to include <button class="settings-info-btn" data-info="Settings: every preference you have set on this server, including Home Screen, Share Card, Wall Display and the HQPlayer presets. Playlists: your playlists and Dynamic Playlists. API keys: the Discogs and FanArt.tv keys and the Qobuz and TIDAL sign-ins — keep a backup that holds them somewhere private. Never included: play history, the library, the Roon pairing, and this device's own look (theme and UI Settings)." aria-label="About what a backup includes">ⓘ</button></h3>
          <div id="backup-parts" class="share-toggle-list"></div>
          <div class="settings-row backup-actions">
            <button id="backup-now" class="settings-update-btn is-update-ready" type="button">Back up now</button>
            <button id="backup-upload" class="settings-update-btn" type="button">Restore from a file…</button>
            <input id="backup-file" type="file" accept=".json,application/json" class="hidden" aria-label="Backup file">
          </div>
          <p id="backup-status" class="settings-note backup-status" role="status" aria-live="polite"></p>
        </div>

        <div class="settings-block">
          <h3 class="settings-block-title">Backups <button class="settings-info-btn" data-info="Restoring replaces what you chose above with what the backup holds, then restarts the server. A copy of how things were is kept first, as a “Before restore” backup (the last 5 of those are kept, apart from your own 10)." aria-label="About restoring">ⓘ</button></h3>
          <div id="backup-list" class="backup-list"></div>
        </div>
      </div>
`);
})();
