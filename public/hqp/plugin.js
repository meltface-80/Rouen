// @ts-check
/*
 * hqp/plugin.js — HQPlayer control, registered with Rouen as a plugin
 * (dev/design/plugins.md §4, §5). Loaded last of the plugin's files, only
 * while it is on: everything the other files defined is on H by now.
 *
 *   start   its part of Settings → HQPlayer and its side-menu entry shown
 *   stop    the screen's poll ended, its menu entry and its part of the page
 *           hidden — and if its screen is open, Home instead
 *   show    the side-menu entry: the screen
 *   leave / resume / settingsOpened   what app.js did for it before v1.9.19
 *
 * And the credit box at the top of the page (v1.8.85): Hide, and "Don't show
 * this again" — saved, so it stays hidden on every device (the owner's
 * answer, 2026-10-14). Hidden either way, one line still credits hqpweb.
 */
(function () {
  const H = window.RouenHQP;
  const Host = window.RouenHost;
  const top = /** @type {HTMLElement | null} */ (document.querySelector('[data-plugin-top="hqplayer"]'));
  const body = /** @type {HTMLElement | null} */ (document.querySelector('[data-plugin-body="hqplayer"]'));
  const menu = document.querySelector('.menu-item[data-action="hqplayer"]');   // its entry, from plugins.js
  if (!top || !body || !menu || !window.RouenPlugins) return;

  // Credit where it is due (v1.8.85, asked for by the owner): this whole
  // feature is hqpweb's work, so it says so first, not in a footnote.
  top.insertAdjacentHTML("beforeend", `
        <section class="hqp-credit" id="hqp-credit" aria-label="Who made this">
          <div class="hqp-credit-head">
            <span class="hqp-credit-ico" aria-hidden="true">♥</span>
            <strong>Built on hqpweb, by statelycurmudgeon</strong>
          </div>
          <p>
            The HQPlayer screen is <strong>statelycurmudgeon</strong>'s hard
            work: how HQPlayer is talked to, every change checked and undone when
            it stops playback, the filter guide (its ratings are Signalyst's own),
            the modulator and dither guide and its sources, Find your DAC, presets, finding HQPlayers on
            your network and keeping several of them. Rouen carries it with
            thanks, under hqpweb's MIT licence.
          </p>
          <a class="hqp-credit-link" href="https://github.com/statelycurmudgeon/hqpweb" target="_blank" rel="noopener noreferrer">hqpweb on GitHub ↗</a>
          <div class="hqp-credit-actions">
            <label class="hqp-credit-never"><input type="checkbox" id="hqp-credit-never"> Don't show this again</label>
            <button type="button" class="settings-update-btn" id="hqp-credit-hide">Hide</button>
          </div>
        </section>
`);
  // The line that stays once the box is hidden: at the top of its page.
  body.insertAdjacentHTML("afterbegin", `
        <div class="settings-note hqp-credit-line hidden" id="hqp-credit-line">Built on
          <a href="https://github.com/statelycurmudgeon/hqpweb" target="_blank" rel="noopener noreferrer">hqpweb</a>,
          by statelycurmudgeon.</div>`);
  const credit = /** @type {HTMLElement} */ (document.getElementById("hqp-credit"));
  const line = /** @type {HTMLElement} */ (document.getElementById("hqp-credit-line"));
  const never = /** @type {HTMLInputElement} */ (document.getElementById("hqp-credit-never"));
  const hide = /** @type {HTMLButtonElement} */ (document.getElementById("hqp-credit-hide"));
  let hiddenNow = false;    // Hide, without the box ticked: until Rouen is next opened
  let saved = false;        // the last settings say it is hidden for good

  /** @param {any} [j] the last /api/hqp/settings answer */
  H.paintCredit = (j) => {
    if (j) saved = j.credit_hidden === true;
    const gone = hiddenNow || saved;
    credit.classList.toggle("hidden", gone);
    line.classList.toggle("hidden", !gone);
  };

  hide.addEventListener("click", async () => {
    hiddenNow = true;
    H.paintCredit();
    if (!never.checked) return;
    try {
      const r = await fetch("/api/hqp/settings", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credit_hidden: true }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      saved = true;
    } catch (e) {
      if (window.__showToast) window.__showToast("Hidden for now — couldn't remember it for next time.", "error");
    }
  });

  // What app.js's leavePlaylistScreens did for it: another screen took the
  // grid, so the poll stops — that poll is also what keeps the server asking
  // HQPlayer for its status, so leaving the screen must end it.
  function leave() {
    H.hqpActive = false;
    H.hqpSeq++;
    if (H.hqpTimer) { clearTimeout(H.hqpTimer); H.hqpTimer = null; }
  }

  window.RouenPlugins.register("hqplayer", {
    start() {
      top.hidden = false;
      body.hidden = false;
      menu.classList.remove("hidden");
      H.loadHqpSettings();
      H.loadHqpSetup();
    },
    stop() {
      const open = !!(H.hqpEls && Host.grid.contains(H.hqpEls.root));
      leave();
      top.hidden = true;
      body.hidden = true;
      menu.classList.add("hidden");
      if (open && window.__showHome) window.__showHome();
    },
    show() { H.showHQPlayer(); },
    leave,
    // Back from a view that borrowed the grid (the artist view, opened from
    // Now playing) puts this screen's nodes back — but leaving it stopped the
    // poll, and the screen would go on showing what HQPlayer was doing when
    // it was left, for good. Start it again.
    resume() {
      if (!H.hqpEls || !Host.grid.contains(H.hqpEls.root)) return;
      if (H.hqpTimer) { clearTimeout(H.hqpTimer); H.hqpTimer = null; }
      H.hqpActive = true;
      H.hqpPoll(++H.hqpSeq);
    },
    settingsOpened() { H.loadHqpSettings(); H.loadHqpSetup(); },
  });
})();
