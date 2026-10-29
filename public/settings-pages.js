// @ts-check
/*
 * settings-pages.js — Setup pages' markup, moved here from index.html unchanged: Discover's (v1.9.72-t7) and the Home
 * Screen's (v1.9.72-t8). index.html is over its length limit, and each new Settings page's script took a line of it
 * (Away from home's, then Streaming & downloads'); CLAUDE.md: a file over 850 lines that is touched gives code back.
 * What the pages do is still app.js's.
 *
 * Loaded before app.js: app.js collects the Settings pages and finds the pages' controls when it starts, so the pages
 * must already be in place. They go where they stood, before Smart Picks' page.
 */
(function settingsPages() {
  "use strict";
  const before = document.querySelector('.settings-pane[data-pane="smartpicks"]');
  if (!before) return;
  before.insertAdjacentHTML("beforebegin", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="homescreen" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Home Screen</h2>
        </div>
        <p class="settings-pane-desc">Which rows show, and in what order</p>

        <div class="settings-block">
          <div class="settings-note">Hold the handle to drag a row. <button class="settings-info-btn" data-info="Hold a row's handle and drag it to a new position; the order is shared by every device. A row switched off is not fetched at all — it does no work in the background." aria-label="About Home Screen rows">ⓘ</button></div>
          <ul class="home-rows-list" id="home-rows-list"></ul>
        </div>
      </div>

      <!-- Discover -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="discover" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Discover</h2>
        </div>
        <p class="settings-pane-desc">New records by the artists you play</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Discover <button class="settings-info-btn" data-info="Off by default. When on, the extension looks once a day for records released in the last two months by the artists you actually listen to — read from your own play history, not your whole library. It asks Deezer and nothing else, and never touches your Roon Core. When off it does nothing at all: no daily build, no timer, no requests to anybody." aria-label="Info">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="discover-enabled" aria-label="Discover">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note">Off by default. Everything below applies only while this is on.</div>
        </div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Look for new records at <button class="settings-info-btn" data-info="The hour the daily check runs, in this server&#39;s local time. If the extension is off at that hour, it runs the next time it starts." aria-label="Info">&#9432;</button></span>
            <select id="discover-hour" class="settings-select" aria-label="Discover build hour"></select>
          </div>
          <div class="settings-note" id="discover-note"></div>
        </div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Look again now</span>
            <button id="discover-rebuild" class="settings-update-btn" type="button">Refresh</button>
          </div>
          <div class="settings-note">Discards today&#39;s list and looks again. Takes a minute or two.</div>
        </div>
      </div>
`);
})();
