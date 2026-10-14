// @ts-check
/*
 * plugins.js — Rouen's side of its plugins (v1.9.19, dev/design/plugins.md
 * §4): features Rouen can be without, of which HQPlayer control is the first.
 *
 * Loaded before app.js, because app.js collects the Settings pages and binds
 * the side menu's entries once, when it starts. So this inserts, for each
 * plugin and whatever its state:
 *   - its row in the Settings list, and a Settings page holding only its
 *     switch and one line saying what turning it on does;
 *   - its side-menu entry, hidden.
 * Nothing else of a plugin is in the page until it is on. Then its stylesheet
 * and scripts are added (once per page life), and the plugin, registering
 * itself with RouenPlugins.register, is started: it fills its Settings page,
 * shows its menu entry. Turned off, it is stopped — its timers end, its menu
 * entry and its part of the page are hidden — and nothing of it runs again.
 * Off from the start: none of its files is asked for, and nothing calls its
 * routes. A plugin reaches the rest of the app through window.RouenHost
 * (app.js) and the app's own window.__ bridges it already had (toasts, Home,
 * Settings, the confirm dialog) — never into app.js's closures. Each time
 * Settings opens, the switches are read again: another device may have
 * flipped one.
 */
(function rouenPlugins() {
  "use strict";
  const SLIDERS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';

  /**
   * The plugins this page knows. `navBefore` / `paneAfter` / `menuAfter` place
   * its row, its page and its menu entry where they have always stood.
   */
  const KNOWN = [{
    id: "hqplayer", name: "HQPlayer", label: "HQPlayer control", switchId: "hqp-enabled", menuId: "menu-item-hqplayer",
    desc: "Filters, modulator &amp; presets",
    info: "Off by default. For a Roon that plays through HQPlayer: a screen in the side menu that changes HQPlayer&#x27;s filters and its modulator or dither, with presets and undo — the volume stays with Rouen&#x27;s own control for the zone. Every change is checked by reading HQPlayer&#x27;s settings back, and one that stops playback, or that HQPlayer cannot keep up with, is put back as it was where HQPlayer still answers. When off, nothing connects to anything.",
    note: "A screen in the side menu for HQPlayer&#x27;s filters, modulator and presets, for a Roon that plays through HQPlayer. Off by default; while it is off, nothing of it runs.",
    on: "HQPlayer is in the side menu", off: "HQPlayer control is off",
    navBefore: '.settings-nav-item[data-pane="setup"]', paneAfter: '.settings-pane[data-pane="display"]',
    menuAfter: "#menu-item-shelf",
    files: ["hqp/hqp.css", "hqp/core.js", "hqp/render.js", "hqp/pickers.js", "hqp/shaper.js", "hqp/screen.js", "hqp/settings.js", "hqp/plugin.js"],
  }];

  /** @typedef {{ start(): void, stop(): void, show(): void, leave?(): void, resume?(): void, settingsOpened?(): void }} PluginApi */
  /** @type {Map<string, PluginApi>} */
  const registered = new Map();
  /** Which plugins are on now. @type {Map<string, boolean>} */
  const on = new Map();
  /** Which plugins have been started (and not stopped since). @type {Set<string>} */
  const started = new Set();
  /** Each file, once asked for; a file that failed is forgotten, to be asked again. @type {Map<string, Promise<void>>} */
  const files = new Map();

  for (const p of KNOWN) {
    const before = document.querySelector(p.navBefore);
    const after = document.querySelector(p.paneAfter);
    const menuAfter = document.querySelector(p.menuAfter);
    if (before) before.insertAdjacentHTML("beforebegin", `
          <button class="settings-nav-item" type="button" data-pane="${p.id}">
            <span class="settings-nav-ico" aria-hidden="true">${SLIDERS}</span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">${p.name}</span>
            </span>
          </button>`);
    if (after) after.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="${p.id}">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>${p.name}</h2>
        </div>
        <p class="settings-pane-desc">${p.desc}</p>
        <div data-plugin-top="${p.id}"></div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">${p.label} <button class="settings-info-btn" data-info="${p.info}" aria-label="Info">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="${p.switchId}" aria-label="${p.label}">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note">${p.note}</div>
        </div>
        <div data-plugin-body="${p.id}"></div>
      </div>`);
    if (menuAfter) menuAfter.insertAdjacentHTML("afterend", `
        <button class="menu-item hidden" type="button" data-action="${p.id}" id="${p.menuId}">
          ${SLIDERS.replace(' width="20" height="20"', "")}
          <span>${p.name}</span>
        </button>`);
  }

  /**
   * Adds a plugin's stylesheet and scripts, each once. Scripts added together
   * with async off run in the order added; one already run is not added
   * again, and one that failed is, the next time.
   * @param {typeof KNOWN[number]} p
   */
  function load(p) {
    return Promise.all(p.files.map((f) => {
      let done = files.get(f);
      if (done) return done;
      const el = f.endsWith(".css") ? Object.assign(document.createElement("link"), { rel: "stylesheet", href: f })
        : Object.assign(document.createElement("script"), { src: f, async: false });
      done = new Promise((resolve, reject) => {
        el.addEventListener("load", () => { resolve(); });
        el.addEventListener("error", () => { files.delete(f); el.remove(); reject(new Error("could not load " + f)); });
      });
      files.set(f, done);
      document.body.appendChild(el);
      return done;
    })).then(() => {});
  }

  /** @param {typeof KNOWN[number]} p @param {boolean} enabled */
  async function apply(p, enabled) {
    on.set(p.id, enabled);
    const box = /** @type {HTMLInputElement | null} */ (document.getElementById(p.switchId));
    if (box) box.checked = enabled;
    const api = registered.get(p.id);
    if (!enabled) { if (api && started.delete(p.id)) api.stop(); return; }
    await load(p);
    const now = registered.get(p.id);
    if (now && on.get(p.id) && !started.has(p.id)) { started.add(p.id); now.start(); }
  }

  /** The switches as the server has them now (another device may have flipped one). */
  async function refresh() {
    try {
      const r = await fetch("/api/plugins", { cache: "no-store" });
      if (!r.ok) return;
      const list = await r.json();
      for (const p of KNOWN) {
        const s = Array.isArray(list) && list.find((x) => x && x.id === p.id);
        await apply(p, !!(s && s.enabled === true));
      }
    } catch (e) { /* no answer: every plugin stays as it is, and its switch says so */ }
  }

  const toast = (/** @type {string} */ msg, /** @type {string} [kind] */ kind) => { if (/** @type {any} */ (window).__showToast) /** @type {any} */ (window).__showToast(msg, kind); };

  for (const p of KNOWN) {
    const box = /** @type {HTMLInputElement | null} */ (document.getElementById(p.switchId));
    if (!box) continue;
    box.addEventListener("change", async () => {
      const want = box.checked;
      box.disabled = true;
      try {
        // Its files first: switched on and then unable to load, it would be
        // on for every device and working on none.
        if (want) await load(p);
        const r = await fetch("/api/plugins/" + p.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: want }) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        await apply(p, want);
        toast(want ? p.on : p.off);
      } catch (e) {
        box.checked = !want;
        toast("Couldn't switch " + p.name + (want ? " on" : " off") + ".", "error");
      } finally {
        box.disabled = false;
      }
    });
  }

  /** Each plugin that is on and started, for the hooks below. */
  const running = () => [...registered].filter(([id]) => started.has(id)).map(([, api]) => api);

  /** @type {any} */ (window).RouenPlugins = {
    /** A plugin's last script calls this. @param {string} id @param {PluginApi} api */
    register(id, api) { registered.set(id, api); },
    /** The side menu's entry was tapped: true when a plugin took it. @param {string} id */
    show(id) { const api = registered.get(id); if (!api || !on.get(id)) return false; api.show(); return true; },
    /** Another screen took the grid: a plugin's screen stops what it was doing. */
    leave() { for (const api of running()) if (api.leave) api.leave(); },
    /** Back from a view that borrowed the grid: a plugin's screen carries on. */
    resume() { for (const api of running()) if (api.resume) api.resume(); },
    /** Settings opened: the switches read again, then a plugin's page reads its settings again. */
    settingsOpened() { refresh().then(() => { for (const api of running()) if (api.settingsOpened) api.settingsOpened(); }); },
    /**
     * Resolves once the plugins on at start are loaded and started (tests wait
     * on it). Not before DOMContentLoaded: by then app.js has run, and with it
     * window.RouenHost, which a plugin's scripts take when they run.
     */
    ready: (async () => {
      if (document.readyState === "loading") await new Promise((r) => { document.addEventListener("DOMContentLoaded", r, { once: true }); });
      await refresh();
    })(),
  };
})();
