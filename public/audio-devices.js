// @ts-check
/*
 * audio-devices.js — Settings → Audio Devices (v1.9.72-t65; the owner, 2026-11-02: "rearranging the audio devices
 * settings page/screen in line with what I asked to copy Mandarin"). What was Settings → Playback, laid out as
 * Mandarin's Audio Devices: the zone chosen at the top, then every device as a card — its icon, its name, what it is
 * (its outputs, or "Phone"), its state and a chevron — then Waveform and the two radios as before. A card opens the
 * device's own page: its settings as the zone sheet shows them (zone-settings.js: crossfade, levelling, the sleep
 * timer, DSP), as Roon holds them; This phone's card opens This phone's own Streaming settings (the app only). No
 * switch on a card and no Hide / unhide (the owner, 2026-11-02: "No hide/un hide and no enable switch either").
 *
 * The markup — the page, its Devices block and the device page — is settings-sheet.js's (in place, before app.js);
 * settings-sheet.js loads this script, which fills the cards and needs nothing from app.js: the cards are Settings nav
 * items, which app.js opens wherever they are. The list is read from /api/zones as the page itself reads it (This
 * phone included, phone-local.js) when the page comes on screen and every few seconds while it stays there; not once
 * it or Settings is closed, nor while the app is in the background. A card is updated in place, never rebuilt, so a
 * tap or the focus is never lost to a refresh.
 */
(function audioDevices() {
  "use strict";
  const pane = /** @type {HTMLElement | null} */ (document.querySelector('.settings-pane[data-pane="playback"]'));
  const devicePane = /** @type {HTMLElement | null} */ (document.querySelector('.settings-pane[data-pane="audio-device"]'));
  const list = document.getElementById("ad-devices");
  const note = document.getElementById("ad-devices-note");
  if (!pane || !devicePane || !list || !note) return;
  const overlay = document.getElementById("settings-overlay");
  const PHONE = "this-phone";
  /** How often the list is read while on screen. */
  const EVERY_MS = 5000;
  /** The device the page is about. @type {{ zone: string }} */
  const chosen = { zone: "" };

  const ICONS = {
    phone: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    speaker: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/></svg>',
    group: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="9" height="15" rx="2"/><rect x="13" y="5" width="9" height="15" rx="2"/><circle cx="6.5" cy="14" r="2.5"/><circle cx="17.5" cy="14" r="2.5"/></svg>',
  };
  const CHEVRON = '<svg class="ad-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

  /** A zone's state, as Mandarin shows it. @param {string} s */
  const stateOf = (s) => ({ playing: "PLAYING", paused: "PAUSED", loading: "LOADING", stopped: "STOPPED" })[String(s || "")] || "";

  /** What a zone's card shows, and the kind of card it needs. @param {any} z */
  function viewOf(z) {
    const phone = z.zone_id === PHONE;
    const outputs = Array.isArray(z.outputs) ? z.outputs.map((/** @type {any} */ o) => o && o.display_name).filter(Boolean) : [];
    const name = String(z.display_name || "");
    const sub = phone ? "Phone" : outputs.length > 1 ? outputs.join(" + ") : outputs[0] && outputs[0] !== name ? outputs[0] : "Roon";
    // This phone's settings are the app's own Streaming page; without it (a browser), its card opens nothing.
    const target = phone ? (document.querySelector('.settings-pane[data-pane="phone-streaming"]') ? "phone-streaming" : "") : "audio-device";
    const icon = phone ? "phone" : outputs.length > 1 ? "group" : "speaker";
    return { zone: String(z.zone_id || ""), name, sub, state: stateOf(z.state), target, kind: icon + "|" + target };
  }

  /** A new card of [v]'s kind. @param {ReturnType<typeof viewOf>} v */
  function make(v) {
    const c = document.createElement(v.target ? "button" : "div");
    c.className = "ad-card" + (v.target ? " settings-nav-item" : "");
    if (v.target) { /** @type {HTMLButtonElement} */ (c).type = "button"; c.dataset.pane = v.target; }
    c.dataset.zone = v.zone;
    c.dataset.kind = v.kind;
    c.innerHTML = `<span class="ad-ico">${ICONS[/** @type {"phone" | "speaker" | "group"} */ (v.kind.split("|")[0])]}</span>
      <span class="ad-txt"><span class="ad-name"></span><span class="ad-sub"></span></span>
      <span class="ad-state"></span>${v.target ? CHEVRON : ""}`;
    return c;
  }

  /** [c]'s words, as [v] has them (as text, never markup). @param {HTMLElement} c @param {ReturnType<typeof viewOf>} v */
  function fillCard(c, v) {
    const set = (/** @type {string} */ sel, /** @type {string} */ text) => {
      const e = /** @type {HTMLElement} */ (c.querySelector(sel));
      if (e.textContent !== text) e.textContent = text;
    };
    set(".ad-name", v.name); set(".ad-sub", v.sub); set(".ad-state", v.state);
    if (v.target) c.setAttribute("aria-label", `${v.name}, ${v.sub}${v.state ? ", " + v.state.toLowerCase() : ""}. Settings`);
  }

  /** The cards for [zones]: each kept and updated where it is when it can be, made only when new. @param {any[]} zones */
  function show(zones) {
    /** @type {Map<string, HTMLElement>} */
    const had = new Map();
    for (const c of /** @type {HTMLElement[]} */ (Array.from(list.children))) had.set(String(c.dataset.zone), c);
    const want = zones.map((z) => {
      const v = viewOf(z);
      const old = had.get(v.zone);
      const c = old && old.dataset.kind === v.kind ? old : make(v);
      fillCard(c, v);
      return c;
    });
    // Moved only when the order or the set changed: a node moved loses focus.
    const same = want.length === list.children.length && want.every((c, i) => list.children[i] === c);
    if (!same) list.replaceChildren(...want);
  }

  /** @type {any} */
  let again = null;
  let asked = 0;
  const onScreen = () => !pane.classList.contains("hidden") && !(overlay && overlay.classList.contains("hidden")) &&
    document.visibilityState !== "hidden";
  /** @param {string} text */
  const say = (text) => { note.textContent = text; note.classList.toggle("hidden", !text); };

  async function load() {
    const mine = ++asked;
    if (again) { clearTimeout(again); again = null; }
    try {
      const r = await fetch("/api/zones", { cache: "no-store" });
      const j = r.ok ? await r.json() : null;
      if (mine !== asked) return;
      const zones = j && Array.isArray(j.zones) ? j.zones : null;
      if (zones) {
        show(zones);
        say(zones.length ? "" : "No audio devices yet. Enable them in Roon (Settings → Audio).");
      } else if (!list.children.length) say("Rouen couldn't list the devices just now.");
    } catch (e) {
      // No answer, or not JSON: the cards stay as they were; with none yet, the page says so. Asked again while open.
      if (mine === asked && !list.children.length) say("Rouen couldn't list the devices just now.");
    }
    if (mine === asked && onScreen()) again = setTimeout(load, EVERY_MS);
  }

  // A card opens the device's page: chosen before app.js shows it (this listener is on the list, app.js's on the sheet).
  list.addEventListener("click", (e) => {
    const c = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".ad-card[data-pane]"));
    if (!c) return;
    if (c.dataset.pane === "phone-streaming") { backTo(c.dataset.pane); return; }
    chosen.zone = c.dataset.zone || "";
    /** @type {HTMLElement} */ (document.getElementById("ad-device-name")).textContent = /** @type {HTMLElement} */ (c.querySelector(".ad-name")).textContent || "Device";
    /** @type {HTMLElement} */ (document.getElementById("ad-device-sub")).textContent = /** @type {HTMLElement} */ (c.querySelector(".ad-sub")).textContent || "";
  });

  /**
   * A page that belongs elsewhere (This phone's Streaming page is Setup's), opened from here, goes Back here; once it is
   * closed it belongs where it did, so Setup still opens it with Back to Setup. @param {string} name
   */
  function backTo(name) {
    const p = /** @type {HTMLElement | null} */ (document.querySelector(`.settings-pane[data-pane="${name}"]`));
    if (!p) return;
    const home = p.getAttribute("data-parent");
    p.setAttribute("data-parent", "playback");
    const put = new MutationObserver(() => {
      if (!p.classList.contains("hidden")) return;
      put.disconnect();
      if (home === null) p.removeAttribute("data-parent"); else p.setAttribute("data-parent", home);
    });
    put.observe(p, { attributes: true, attributeFilter: ["class"] });
  }

  // The device page's settings: zone-settings.js's own section, put on this page (it loads after this script).
  let wired = false;
  function wire() {
    const ZS = /** @type {any} */ (window).RouenZoneSettings;
    if (wired || !ZS || typeof ZS.watch !== "function") return;
    wired = true;
    const host = /** @type {HTMLElement} */ (document.getElementById("ad-device-settings"));
    const back = /** @type {HTMLElement | null} */ (devicePane.querySelector("[data-settings-back]"));
    ZS.watch(devicePane, () => chosen.zone || null, (/** @type {HTMLElement} */ box) => { if (box.parentElement !== host) host.appendChild(box); },
      // The DSP window opens over this page, which stays where it is; its Back takes the focus when the window closes.
      { close: () => {}, button: () => back });
  }

  // Asked when the page comes on screen, however it is opened; not once it or Settings is closed, or the app is away.
  let was = false;
  const check = () => {
    const now = onScreen();
    if (now && !was) load();
    if (!now && again) { clearTimeout(again); again = null; }
    was = now;
  };
  const watch = new MutationObserver(check);
  watch.observe(pane, { attributes: true, attributeFilter: ["class"] });
  if (overlay) watch.observe(overlay, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", check);
  // The device page: its section wired the first time it opens (zone-settings.js is loaded by then).
  new MutationObserver(() => { if (!devicePane.classList.contains("hidden")) wire(); })
    .observe(devicePane, { attributes: true, attributeFilter: ["class"] });
})();
