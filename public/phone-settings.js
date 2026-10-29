// @ts-check
/*
 * phone-settings.js — Settings → Setup → Streaming & downloads, in the Rouen app only (v1.9.72-t9,
 * dev/design/android-app.md §4.11; the owner, 2026-10-29: "add to Rouen settings for downloads and streaming quality
 * like Mandarin"). Mandarin's Settings → Setup → Downloads (its public/app/android-downloads.js), for Rouen:
 *
 *  - The settings are the phone's own, kept by the app; the page shows them and changes them through the app's bridge,
 *    window.RouenPhone (settings() and set(key, value), each answering JSON; §4.11). A browser has no bridge, so it
 *    never gets the page or its entry.
 *  - Streaming: the quality Rouen makes for this phone at home and away, Opus 256 (the default) or lossless FLAC. The
 *    app says it to Rouen when it says hello, and Rouen uses it from the next time Roon starts playing to the phone.
 *  - Downloading: the quality, where to, a size limit and Wi-Fi only — kept for the downloads that come in a later
 *    build (the owner: after Tailscale is tested), and said so on the page.
 *
 * And in Settings → Updates, a row for the app's own update (§4.12): the version, a newer one when there is one, Check
 * and Update, through the same bridge (appUpdate, appUpdateCheck, appUpdateInstall).
 *
 * Loaded before app.js: app.js collects the Settings pages and names the ⓘ buttons when it starts, so the page and
 * its entry must already be in place. The app calls window.__rouenPhoneChanged() when something changed on its side.
 */
(function phoneSettings() {
  "use strict";
  const bridge = /** @type {any} */ (window).RouenPhone;
  const setupNav = document.querySelector('.settings-pane[data-pane="setup"] .settings-nav');
  const setupPane = document.querySelector('.settings-pane[data-pane="setup"]');
  if (!bridge || typeof bridge.settings !== "function" || !setupNav || !setupPane) return;

  const caret = '<svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  /** A labelled select row. @param {string} key @param {string} label @param {string} info @param {Array<[string, string]>} options */
  const row = (key, label, info, options) => `
          <div class="settings-row">
            <span class="settings-label">${label}${info ? ` <button class="settings-info-btn" data-info="${info}" aria-label="About ${label}">&#9432;</button>` : ""}</span>
            <div class="settings-select-wrap">
              <select class="settings-select" data-phone-set="${key}" aria-label="${label}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
              ${caret}
            </div>
          </div>`;
  const QUALITY = /** @type {Array<[string, string]>} */ ([["opus", "Opus 256 kbps"], ["lossless", "Lossless (FLAC)"]]);

  // The entry, in Setup before Away from home (Mandarin's place for its Downloads).
  const away = setupNav.querySelector('.settings-nav-item[data-pane="away"]');
  const entry = `
          <button class="settings-nav-item" type="button" data-pane="phone">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Streaming &amp; downloads</span>
            </span>
          </button>`;
  if (away) away.insertAdjacentHTML("beforebegin", entry); else setupNav.insertAdjacentHTML("beforeend", entry);
  setupPane.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="phone" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Streaming &amp; downloads</h2>
        </div>
        <p class="settings-pane-desc">This phone's own: how Rouen streams to it, and how it downloads</p>
        <div class="settings-block">
          <div class="settings-block-title">Streaming to this phone</div>
          ${row("homeQuality", "At home", "On your home network. Opus 256 is made by Rouen as Roon plays: about a third of the data of a CD-quality FLAC, less against hi-res. Lossless is FLAC at the music&#x27;s own rate and depth.", QUALITY)}
          ${row("awayQuality", "Away from home", "Over mobile data or another Wi-Fi, through Tailscale (Settings → Setup → Away from home). Opus 256 is about 115 MB an hour; lossless at CD quality about 400 MB an hour, more for hi-res.", QUALITY)}
          <div class="settings-note" id="phone-network"></div>
          <div class="settings-note">A change is used from the next time Roon starts playing to this phone.</div>
        </div>
        <div class="settings-divider"></div>
        <div class="settings-block">
          <div class="settings-block-title">Downloading</div>
          <div class="settings-note">Downloads come in a later version of the app; these settings are kept for them.</div>
          ${row("downloadQuality", "Quality", "Original is the files as they are. Opus 256 is about a third of the size of a CD-quality FLAC, less against hi-res.", [["original", "Original"], ["opus", "Opus 256 kbps"]])}
          ${row("downloadLocation", "Save to", "", [])}
          ${row("downloadLimitGb", "Size limit", "", [0, 8, 16, 32, 64, 128, 256].map((g) => /** @type {[string, string]} */ ([String(g), g ? g + " GB" : "No limit"])))}
          <div class="settings-row">
            <span class="settings-label">Wi-Fi only</span>
            <label class="switch">
              <input type="checkbox" data-phone-set="downloadWifiOnly" aria-label="Wi-Fi only">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note hidden" id="phone-error"></div>
        </div>
      </div>`);

  const pane = /** @type {HTMLElement} */ (document.querySelector('.settings-pane[data-pane="phone"]'));
  const network = /** @type {HTMLElement} */ (document.getElementById("phone-network"));
  const problem = /** @type {HTMLElement} */ (document.getElementById("phone-error"));
  /** @param {number} b */
  const size = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : Math.round(b / (1 << 20)) + " MB");

  /** The bridge's answer, as an object; an error when it is not one. @param {() => string} f */
  function ask(f) {
    try {
      return JSON.parse(f()) || { error: "The app gave no answer." };
    } catch (e) {
      return { error: "The app could not be asked: " + /** @type {Error} */ (e).message };
    }
  }

  /** @param {any} s */
  function show(s) {
    problem.classList.toggle("hidden", !s.error);
    problem.textContent = s.error || "";
    // A refused change still shows what the app kept (the change handler gives its settings with the error).
    if (!Array.isArray(s.places)) return;
    const where = /** @type {HTMLSelectElement} */ (pane.querySelector('[data-phone-set="downloadLocation"]'));
    where.innerHTML = "";
    for (const p of Array.isArray(s.places) ? s.places : []) {
      where.appendChild(Object.assign(document.createElement("option"), { value: p.id, textContent: p.label + (p.free ? " · " + size(p.free) + " free" : "") }));
    }
    for (const el of /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement>} */ (pane.querySelectorAll("[data-phone-set]"))) {
      const v = s[/** @type {string} */ (el.dataset.phoneSet)];
      if (el instanceof HTMLInputElement) el.checked = v === true;
      else if (v !== undefined) el.value = String(v);
    }
    network.textContent = s.network === "home" ? "This phone is at home now." : s.network === "away" ? "This phone is away from home now." : "This phone cannot reach Rouen now.";
  }

  pane.addEventListener("change", (e) => {
    const el = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
    const key = el.dataset && el.dataset.phoneSet;
    if (!key) return;
    const value = el instanceof HTMLInputElement && el.type === "checkbox" ? String(el.checked) : el.value;
    const s = ask(() => bridge.set(key, value));
    show(s.error ? Object.assign(ask(() => bridge.settings()), { error: s.error }) : s);
  });

  // ---- Settings → Updates: the app's own update (§4.12) ----------------------------------------------------------
  const updates = document.getElementById("check-update-btn");
  const updatesBlock = updates && updates.closest(".settings-block");
  /** @type {HTMLButtonElement | null} */
  let appBtn = null;
  /** @type {HTMLElement | null} */
  let appLine = null;
  if (updatesBlock && typeof bridge.appUpdate === "function") {
    updatesBlock.insertAdjacentHTML("afterend", `
        <div class="settings-block" id="app-update-block">
          <div class="settings-row">
            <span class="settings-label">Rouen for Android <button class="settings-info-btn" data-info="This app updates itself, as Mandarin&#x27;s does: it looks for a newer version each time it starts and when this page opens, and Update downloads it and hands it to Android&#x27;s installer (Android asks once to allow installs from Rouen). A test version is offered the newest test build or release; a release, releases only. Rouen itself updates with the button above." aria-label="About the app&#x27;s updates">&#9432;</button></span>
            <button id="app-update-btn" class="settings-update-btn" type="button">Check</button>
          </div>
          <div class="settings-note" id="app-update-status"></div>
        </div>`);
    appBtn = /** @type {HTMLButtonElement} */ (document.getElementById("app-update-btn"));
    appLine = /** @type {HTMLElement} */ (document.getElementById("app-update-status"));
    appBtn.addEventListener("click", () => {
      const u = ask(() => bridge.appUpdate());
      ask(() => (u.available ? bridge.appUpdateInstall() : bridge.appUpdateCheck()));
      paintApp();
    });
  }

  /** The app's update as the app says it is. */
  function paintApp() {
    if (!appBtn || !appLine) return;
    const u = ask(() => bridge.appUpdate());
    appBtn.disabled = !!u.busy;
    appBtn.textContent = u.busy ? "Working…" : u.available ? "Update" : "Check";
    appLine.textContent = u.error ? u.error
      : u.busy ? (u.available ? "Downloading version " + u.latest + "…" : "Looking for a newer version…")
      : u.available ? "Version " + u.latest + " is ready to install (this is " + u.current + ")."
      : "Version " + (u.current || "?") + (u.latest ? ", the newest." : ".");
  }

  /** @type {any} */ (window).__rouenPhoneChanged = () => {
    if (!pane.classList.contains("hidden")) show(ask(() => bridge.settings()));
    paintApp();
  };
  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="phone"]')) show(ask(() => bridge.settings()));
    // Updates opened: the app looks again, and says when it is done (window.__rouenPhoneChanged).
    if (appBtn && t && t.closest && t.closest('.settings-nav-item[data-pane="system"]')) { ask(() => bridge.appUpdateCheck()); paintApp(); }
  });
})();
