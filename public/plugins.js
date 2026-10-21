// @ts-check
/*
 * plugins.js — Rouen's side of its plugins (v1.9.19, dev/design/plugins.md
 * §4): features Rouen can be without, of which HQPlayer control is the first.
 *
 * Loaded before app.js, because app.js collects the Settings pages and binds
 * the side menu's entries once, when it starts. So this inserts Settings →
 * Plugins (the owner's idea, 2026-10-14: every plugin in one place; Lyrion-style
 * since v1.9.34, §7: Installed and Available, a card each, Install, Settings and
 * Remove), and for each plugin, whatever its state:
 *   - its Settings page, holding its settings once installed (Back returns to
 *     Plugins), opened by its card's Settings;
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
 * Settings opens, what is installed is read again: another device may have
 * installed or removed one.
 */
(function rouenPlugins() {
  "use strict";
  const SLIDERS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';

  const PUZZLE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/></svg>';

  /** The plugins this page knows. `menuAfter` places its side-menu entry where it has always stood. */
  const KNOWN = [{
    id: "hqplayer", name: "HQPWeb", menuId: "menu-item-hqplayer",
    desc: "Filters, modulator &amp; presets",
    on: "HQPWeb installed: it is in the side menu", off: "HQPWeb removed",
    menuAfter: "#menu-item-shelf",
    files: ["hqp/hqp.css", "hqp/core.js", "hqp/render.js", "hqp/pickers.js", "hqp/shaper.js", "hqp/screen.js", "hqp/settings.js", "hqp/plugin.js"],
  }];

  /** @typedef {{ start(): void, stop(): void, show(): void, leave?(): void, resume?(): void, settingsOpened?(): void }} PluginApi */
  /** @type {Map<string, PluginApi>} */
  const registered = new Map();
  /** What GET /api/plugins said last: each plugin's state and its card's words (v1.9.34). @type {any[]} */
  let latest = [];
  /** Plugins whose Install or Remove is under way, and how many have finished (v1.9.34, the review). */
  const busy = new Set();
  let changes = 0;
  /** Which plugins are on now. @type {Map<string, boolean>} */
  const on = new Map();
  /** Which plugins have been started (and not stopped since). @type {Set<string>} */
  const started = new Set();
  /** Each file, once asked for; a file that failed is forgotten, to be asked again. @type {Map<string, Promise<void>>} */
  const files = new Map();

  // Settings → Plugins: a row in the Settings list, where HQPlayer's stood
  // (before Setup), and a page listing every plugin, as Setup lists its pages.
  const setupRow = document.querySelector('.settings-nav-item[data-pane="setup"]');
  const displayPane = document.querySelector('.settings-pane[data-pane="display"]');
  if (setupRow) setupRow.insertAdjacentHTML("beforebegin", `
          <button class="settings-nav-item" type="button" data-pane="plugins">
            <span class="settings-nav-ico" aria-hidden="true">${PUZZLE}</span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Plugins</span>
            </span>
          </button>`);
  if (displayPane) displayPane.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="plugins">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Plugins</h2>
        </div>
        <style>
          .plugins-group { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; opacity: .7; margin: 18px 4px 8px; }
          .plugin-card .plugin-meta { font-size: 13px; opacity: .75; margin-top: 2px; }
          .plugin-card .plugin-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
          .plugin-card .plugin-actions button { flex: 0 0 auto; }
        </style>
        <h3 class="plugins-group" id="plugins-installed-h">Installed</h3>
        <div data-plugins="installed" aria-labelledby="plugins-installed-h"></div>
        <h3 class="plugins-group" id="plugins-available-h">Available</h3>
        <div data-plugins="available" aria-labelledby="plugins-available-h"></div>
      </div>`);
  const pluginsPane = document.querySelector('.settings-pane[data-pane="plugins"]');

  for (const p of KNOWN) {
    const menuAfter = document.querySelector(p.menuAfter);
    if (pluginsPane) pluginsPane.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="${p.id}" data-parent="plugins">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Plugins">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>${p.name}</h2>
        </div>
        <p class="settings-pane-desc">${p.desc}</p>
        <div data-plugin-top="${p.id}"></div>
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
    const api = registered.get(p.id);
    if (!enabled) { on.set(p.id, false); if (api && started.delete(p.id)) api.stop(); return; }
    // Installed only once its files are in: one that cannot load is not shown as installed (the review).
    await load(p);
    on.set(p.id, true);
    const now = registered.get(p.id);
    if (now && on.get(p.id) && !started.has(p.id)) { started.add(p.id); now.start(); }
  }

  /** The switches as the server has them now (another device may have flipped one). */
  async function refresh() {
    const asked = changes;
    try {
      const r = await fetch("/api/plugins", { cache: "no-store" });
      const list = r.ok ? await r.json() : null;
      // An answer from before an Install or Remove landed, or while one runs, is not the state now (the review).
      if (Array.isArray(list) && asked === changes && !busy.size) {
        latest = list;
        for (const p of KNOWN) {
          const s = list.find((x) => x && x.id === p.id);
          try { await apply(p, !!(s && s.enabled === true)); }
          catch (e) { /* its files would not load: shown under Available, to install again; the next plugin is still applied */ }
        }
      }
    } catch (e) { /* no answer: every plugin stays as it is, and its card says so */ }
    // Drawn whatever the answer (the review): the cards stand on what is known, never on nothing.
    render();
  }

  const toast = (/** @type {string} */ msg, /** @type {string} [kind] */ kind) => { if (/** @type {any} */ (window).__showToast) /** @type {any} */ (window).__showToast(msg, kind); };

  // ---- the cards (plugins.md §7, v1.9.34): Installed and Available, as Lyrion's page has them ----
  const groupOf = (/** @type {string} */ g) => /** @type {HTMLElement | null} */ (document.querySelector(`[data-plugins="${g}"]`));
  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function render() {
    const installed = groupOf("installed"), available = groupOf("available");
    if (!installed || !available) return;
    installed.textContent = ""; available.textContent = "";
    for (const p of KNOWN) {
      const s = latest.find((x) => x && x.id === p.id) || { name: p.name };
      const isOn = on.get(p.id) === true;
      const card = el("div", "settings-block plugin-card");
      card.dataset.plugin = p.id;
      card.appendChild(el("div", "settings-label", s.name || p.name));
      const meta = el("div", "plugin-meta");
      meta.appendChild(document.createTextNode((s.author ? "By " + s.author : "") + (s.credit ? (s.author ? ", built on " : "Built on ") : "")));
      if (s.credit) {
        const a = /** @type {HTMLAnchorElement} */ (el("a", "", s.credit.name));
        a.href = s.credit.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        meta.appendChild(a);
        meta.appendChild(document.createTextNode(" by " + s.credit.by));
      }
      if (s.version) meta.appendChild(document.createTextNode((meta.textContent ? " · " : "") + "Comes with Rouen v" + s.version));
      card.appendChild(meta);
      if (s.summary) card.appendChild(el("div", "settings-note", s.summary));
      const actions = el("div", "plugin-actions");
      if (isOn) {
        const open = el("button", "action-btn primary", "Settings");
        open.addEventListener("click", () => { const go = /** @type {any} */ (window).__openSettingsPane; if (go) go(p.id); });
        const remove = el("button", "settings-update-btn", "Remove");
        remove.dataset.pluginRemove = p.id;
        remove.addEventListener("click", () => { change(p, false, remove); });
        actions.append(open, remove);
      } else {
        const install = el("button", "action-btn primary", "Install");
        install.dataset.pluginInstall = p.id;
        install.addEventListener("click", () => { change(p, true, install); });
        actions.append(install);
      }
      for (const b of actions.querySelectorAll("button")) { /** @type {HTMLButtonElement} */ (b).type = "button"; /** @type {HTMLButtonElement} */ (b).disabled = busy.has(p.id); }
      card.appendChild(actions);
      (isOn ? installed : available).appendChild(card);
    }
    if (!installed.children.length) installed.appendChild(el("p", "settings-note", "Nothing installed yet."));
    if (!available.children.length) available.appendChild(el("p", "settings-note", "Every plugin Rouen has is installed."));
  }

  /**
   * Install (its files first: installed and then unable to load, it would be on for every device and
   * working on none) or Remove (asked first).
   * @param {typeof KNOWN[number]} p @param {boolean} want @param {HTMLElement} button
   */
  async function change(p, want, button) {
    // One at a time, from the first tap (the review: a double tap asked twice and removed twice).
    if (busy.has(p.id)) return;
    busy.add(p.id);
    /** @type {HTMLButtonElement} */ (button).disabled = true;
    try {
      if (!want) {
        // The app's own confirm dialog, through its bridge, as the plugins' own pages ask.
        const confirmDialog = /** @type {any} */ (window).__confirmDialog || ((/** @type {string} */ m) => Promise.resolve(window.confirm(m)));
        if (!await confirmDialog(`Remove ${p.name}? Its screen and settings page go; its settings are kept, for if you install it again.`)) return;
      }
      if (want) await load(p);
      const r = await fetch("/api/plugins/" + p.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: want }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      await apply(p, want);
      toast(want ? p.on : p.off);
    } catch (e) {
      toast("Couldn't " + (want ? "install " : "remove ") + p.name + ".", "error");
    } finally {
      busy.delete(p.id);
      changes++;
      render();
    }
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
