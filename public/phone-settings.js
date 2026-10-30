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
 *  - Downloading: the quality, where to, a size limit and Wi-Fi only; and the albums on the phone (§4.19, v1.9.72-t28),
 *    each with how far it has got and Remove. An album is downloaded from its ⋯ menu (album-actions.js asks
 *    window.RouenPhoneDownloads, below, for the item).
 *
 * And in Settings → Updates, a row for the app's own update (§4.12): the version, a newer one when there is one, Check
 * and Update, through the same bridge (appUpdate, appUpdateCheck, appUpdateInstall).
 *
 * And Settings → Setup → Logging (§4.13, v1.9.72-t11; the owner: "Build logging into the Android app like mandarin …
 * Make logging an on/off item. Save logs to phone"): the app's log switched on and off, how much is logged, Save log
 * (to Downloads/Rouen) and Clear, through the bridge's logging, loggingUse, loggingSave and loggingClear.
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
          <div class="settings-note">Download an album from the ⋯ on its page. Only your own files can be downloaded, not TIDAL or Qobuz.</div>
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

  // ---- Settings → Setup → Logging (§4.13): Mandarin's words, for Rouen ------------------------------------------------
  const LOG_ON = "Logging is on. Use the app as you normally would — play, pause, skip, go out and come home — then tap Save log: " +
    "the log is saved to Downloads/Rouen on this phone, for you to send. Switching logging off deletes it.";
  const LOG_OFF = "Off: nothing is logged.";
  const LOG_PRIVACY = "The log is made without personal data: no IP addresses (home, Tailscale or internet), no names of people " +
    "or devices, nothing you play or search for, no files or folders, no account details. Before you send it, please look " +
    "through it: what you send is your choice.";
  /** @type {HTMLElement | null} */
  let logPane = null;
  if (typeof bridge.logging === "function") {
    const phoneEntry = setupNav.querySelector('.settings-nav-item[data-pane="phone"]');
    const logEntry = `
          <button class="settings-nav-item" type="button" data-pane="logging">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Logging</span>
            </span>
          </button>`;
    if (phoneEntry) phoneEntry.insertAdjacentHTML("afterend", logEntry); else setupNav.insertAdjacentHTML("beforeend", logEntry);
    pane.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="logging" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Logging</h2>
        </div>
        <p class="settings-pane-desc">This phone's log of what the app does, for finding what went wrong</p>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Logging</span>
            <label class="switch">
              <input type="checkbox" id="log-on" aria-label="Logging">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note" id="log-what"></div>
          <div class="settings-note">${LOG_PRIVACY}</div>
        </div>
        <div class="settings-block hidden" id="log-kept">
          <div class="settings-note" id="log-about"></div>
          <div class="settings-row">
            <span class="settings-label">Save to Downloads/Rouen</span>
            <button id="log-save" class="settings-update-btn" type="button">Save log</button>
          </div>
          <div class="settings-note hidden" id="log-saved"></div>
          <div class="settings-row">
            <span class="settings-label">Empty the log</span>
            <button id="log-clear" class="settings-update-btn" type="button">Clear</button>
          </div>
        </div>
      </div>`);
    logPane = /** @type {HTMLElement} */ (document.querySelector('.settings-pane[data-pane="logging"]'));
    const logOn = /** @type {HTMLInputElement} */ (document.getElementById("log-on"));
    logOn.addEventListener("change", () => { paintLog(ask(() => bridge.loggingUse(String(logOn.checked)))); });
    /** @type {HTMLButtonElement} */ (document.getElementById("log-save")).addEventListener("click", () => {
      const b = /** @type {HTMLButtonElement} */ (document.getElementById("log-save"));
      b.disabled = true;
      b.textContent = "Saving…";
      ask(() => bridge.loggingSave());
    });
    /** @type {HTMLButtonElement} */ (document.getElementById("log-clear")).addEventListener("click", () => {
      paintLog(ask(() => bridge.loggingClear()));
      /** @type {HTMLElement} */ (document.getElementById("log-saved")).classList.add("hidden");
    });
  }

  /** The Logging page as the app says it is. @param {any} [l] */
  function paintLog(l) {
    if (!logPane) return;
    const s = l || ask(() => bridge.logging());
    const on = !!s.on;
    /** @type {HTMLInputElement} */ (document.getElementById("log-on")).checked = on;
    /** @type {HTMLElement} */ (document.getElementById("log-what")).textContent = on ? LOG_ON : LOG_OFF;
    /** @type {HTMLElement} */ (document.getElementById("log-kept")).classList.toggle("hidden", !on);
    /** @type {HTMLElement} */ (document.getElementById("log-about")).textContent = s.about || "";
    const save = /** @type {HTMLButtonElement} */ (document.getElementById("log-save"));
    save.disabled = !!s.saving;
    save.textContent = s.saving ? "Saving…" : "Save log";
    const saved = /** @type {HTMLElement} */ (document.getElementById("log-saved"));
    const said = s.error || (s.saved ? "Saved to Downloads/Rouen/" + s.saved + "." : "");
    saved.textContent = said;
    saved.classList.toggle("hidden", !said);
  }

  /** @type {any} */ (window).__rouenPhoneChanged = () => {
    if (logPane && !logPane.classList.contains("hidden")) paintLog();
    if (!pane.classList.contains("hidden")) show(ask(() => bridge.settings()));
    paintApp();
    // Whatever else the app's bridge feeds (Away from home's This phone, away.js) hears it too.
    document.dispatchEvent(new Event("rouen:phone"));
  };
  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="phone"]')) show(ask(() => bridge.settings()));
    if (logPane && t && t.closest && t.closest('.settings-nav-item[data-pane="logging"]')) paintLog();
    // Updates opened: the app looks again, and says when it is done (window.__rouenPhoneChanged).
    if (appBtn && t && t.closest && t.closest('.settings-nav-item[data-pane="system"]')) { ask(() => bridge.appUpdateCheck()); paintApp(); }
  });
})();

// ---- Downloads: albums from Rouen to this phone (dev/design/android-app.md §4.19, v1.9.72-t28) --------------------
// In the app only, through its bridge (RouenPhone.albumDownload / albumState / albumRemove / albums): the ⋯ menu's
// Download on an album's page, and Settings → Streaming & downloads → On this phone. The app says each move through
// window.__rouenDownloadsChanged().
(function phoneDownloads() {
  "use strict";
  const bridge = /** @type {any} */ (window).RouenPhone;
  if (!bridge || typeof bridge.albumDownload !== "function") return;
  /** The bridge's answer, as an object. @param {() => string} f @returns {any} */
  const ask = (f) => {
    try { return JSON.parse(f()) || {}; } catch (e) { return { error: "The app could not be asked: " + /** @type {Error} */ (e).message }; }
  };
  /** @param {number} b */
  const size = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : Math.max(1, Math.round(b / (1 << 20))) + " MB");

  /** Where an album's download is, in words. @param {any} s */
  function words(s) {
    switch (s.state) {
      case "queued": return "Waiting to download";
      case "downloading": return "Downloading " + (s.done || 0) + " of " + (s.total || "…");
      case "waiting": return s.error || "Waiting";
      case "done": return "On this phone" + (s.bytes ? " · " + size(s.bytes) : "");
      case "failed": return "Not downloaded: " + (s.error || "it failed");
      default: return "";
    }
  }
  /** The ⋯ item's words for an album's state. @param {any} s */
  const label = (s) => (!s.state || s.state === "none" ? "Download to this phone"
    : s.state === "failed" ? "Download again" : s.state === "done" ? "Remove from this phone" : words(s) + " · Remove");

  /** The ⋯ item on the album now open, kept so its words follow the download. @type {{ title: string, artist: string, button: HTMLElement } | null} */
  let open = null;

  /**
   * The album view's ⋯ item (album-actions.js): Download, or how far it has got; on the phone, Remove.
   * @param {string} title @param {string} artist @param {string} imageKey @param {(msg: string, kind: string) => void} toast
   */
  function item(title, artist, imageKey, toast) {
    return {
      label: label(ask(() => bridge.albumState(title, artist))),
      onClick: (/** @type {HTMLElement} */ b) => {
        open = { title, artist, button: b };
        const s = ask(() => bridge.albumState(title, artist));
        if (s.error) { toast(s.error, "error"); return; }
        if (s.state === "none" || s.state === "failed") {
          const r = ask(() => bridge.albumDownload(title, artist, imageKey || ""));
          toast(r.error || "Downloading to this phone", r.error ? "error" : "ok");
        } else {
          ask(() => bridge.albumRemove(title, artist));
          toast("Removed from this phone", "ok");
        }
        b.textContent = label(ask(() => bridge.albumState(title, artist)));
      },
    };
  }
  /** @type {any} */ (window).RouenPhoneDownloads = { item, words };

  // Settings → Streaming & downloads → On this phone.
  const pane = document.querySelector('.settings-pane[data-pane="phone"]');
  const last = pane && pane.querySelectorAll(".settings-block");
  if (last && last.length) {
    last[last.length - 1].insertAdjacentHTML("afterend", `
        <div class="settings-divider"></div>
        <div class="settings-block">
          <div class="settings-block-title">On this phone</div>
          <div id="phone-albums"></div>
        </div>`);
  }
  const list = /** @type {HTMLElement | null} */ (document.getElementById("phone-albums"));

  function paintList() {
    if (!list) return;
    const albums = ask(() => bridge.albums());
    list.innerHTML = "";
    if (!Array.isArray(albums) || !albums.length) {
      list.innerHTML = '<div class="settings-note">No albums on this phone yet.</div>';
      return;
    }
    for (const a of albums) {
      const row = document.createElement("div");
      row.className = "settings-row";
      const text = document.createElement("span");
      text.className = "settings-label";
      text.textContent = a.title + (a.artist ? " — " + a.artist : "");
      const note = document.createElement("div");
      note.className = "settings-note";
      note.textContent = words(a);
      text.appendChild(note);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "settings-update-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => { ask(() => bridge.albumRemove(a.title, a.artist)); paintList(); });
      row.append(text, remove);
      list.appendChild(row);
    }
  }

  /** @type {any} */ (window).__rouenDownloadsChanged = () => {
    if (pane && !pane.classList.contains("hidden")) paintList();
    const o = open;
    if (o && document.contains(o.button)) o.button.textContent = label(ask(() => bridge.albumState(o.title, o.artist)));
  };
  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="phone"]')) paintList();
  });
})();
