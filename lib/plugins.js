// @ts-check
"use strict";
/*
 * plugins.js — the plugin host (dev/design/plugins.md §3). A plugin is a
 * feature Rouen can be without: a switch kept in Rouen's settings, a service
 * created only while it is on, and routes under a prefix of its own.
 *
 *   GET  /api/plugins              [{ id, name, enabled }], for the client's loader
 *   POST /api/plugins/:id {enabled} the switch: saved; off also closes the service
 *   <prefix>/*                      the plugin's own routes — off: 404, before any
 *                                   of its code runs, and a service still held is
 *                                   closed and dropped
 *
 * The switch is read from the settings on every request, so a plugin's own
 * route that writes the same key (HQPlayer's /api/hqp/settings, from a page
 * built before v1.9.19) turns it off just the same. A service is created on the
 * first request that finds its plugin on, never before.
 */

/**
 * @typedef {{ mount(app: any): void, close(): Promise<void> | void }} PluginService
 * @typedef {object} Plugin
 * @property {string} id                 the switch's route and the client's name for it
 * @property {string} name               what Settings calls it ("HQPlayer")
 * @property {string} prefix             its routes ("/api/hqp")
 * @property {string} settingKey         its switch in the settings ("hqpEnabled"); on only when true
 * @property {() => PluginService} create
 */

/**
 * @param {{ getSettings: () => any, saveSettings: (patch: any) => boolean, log?: (line: string) => void }} o
 */
function createPluginHost(o) {
  const log = o.log || (() => {});
  /** @type {Map<string, { plugin: Plugin, service: PluginService | null, routes: any }>} */
  const plugins = new Map();

  /** @param {Plugin} p */
  const isOn = (p) => (o.getSettings() || {})[p.settingKey] === true;

  /** @param {{ service: PluginService | null }} e */
  function drop(e) {
    const s = e.service;
    e.service = null;
    if (!s) return;
    Promise.resolve().then(() => s.close()).catch((err) => { log("closing a plugin failed: " + (err && err.message)); });
  }

  /** The plugin's service, created on first use; null while it is off (and anything held closed). @param {string} id */
  function serviceOf(id) {
    const e = plugins.get(id);
    if (!e) return null;
    if (!isOn(e.plugin)) { drop(e); return null; }
    if (!e.service) {
      e.service = e.plugin.create();
      // Its routes, on a router of their own: the host decides, per request, whether they run.
      e.routes = recorder(e.plugin.prefix);
      e.service.mount(e.routes);
    }
    return e.service;
  }

  return {
    /** @param {Plugin} p */
    register(p) { plugins.set(p.id, { plugin: p, service: null, routes: null }); },

    /** @param {{ get: Function, post: Function, use: Function }} app */
    mount(app) {
      app.get("/api/plugins", (/** @type {any} */ _req, /** @type {any} */ res) => {
        res.set("Cache-Control", "no-store");
        res.json([...plugins.values()].map((e) => ({ id: e.plugin.id, name: e.plugin.name, enabled: isOn(e.plugin) })));
      });
      app.post("/api/plugins/:id", (/** @type {any} */ req, /** @type {any} */ res) => {
        const e = plugins.get(req.params.id);
        if (!e) return res.status(404).json({ error: "no such plugin" });
        const on = req.body && req.body.enabled;
        if (typeof on !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
        if (!o.saveSettings({ [e.plugin.settingKey]: on })) return res.status(500).json({ error: "Couldn't save the switch" });
        // Either way, a service held from before goes: off, it is closed; on,
        // the next request makes a fresh one from the settings as they are now.
        drop(e);
        log(e.plugin.name + (on ? " switched on" : " switched off"));
        res.json({ id: e.plugin.id, name: e.plugin.name, enabled: on });
      });
      for (const e of plugins.values()) {
        app.use(e.plugin.prefix, (/** @type {any} */ req, /** @type {any} */ res, /** @type {Function} */ next) => {
          if (!serviceOf(e.plugin.id)) return res.status(404).json({ error: e.plugin.name + " is off" });
          e.routes.handle(req, res, next);
        });
      }
    },

    /** For tests and diagnostics: whether a plugin's service exists now. @param {string} id */
    running(id) { const e = plugins.get(id); return !!(e && e.service); },
  };
}

/**
 * The routes a service mounts, kept to be run by the host: only `use` with a
 * handler for the plugin's whole prefix (already stripped by the host's own
 * `use`) — HQPlayer's one handler. Anything narrower is refused rather than
 * run for every request under the prefix.
 * @param {string} prefix
 */
function recorder(prefix) {
  /** @type {Function[]} */
  const handlers = [];
  return {
    /** @param {...any} args */
    use(...args) {
      const fn = args[args.length - 1];
      if (typeof fn !== "function" || args.length > 2 || (args.length === 2 && args[0] !== prefix)) {
        throw new Error("a plugin service may mount only use(" + prefix + ", handler)");
      }
      handlers.push(fn);
    },
    /** @param {any} req @param {any} res @param {Function} next */
    handle(req, res, next) {
      let i = 0;
      const step = () => { const h = handlers[i++]; if (h) h(req, res, step); else next(); };
      step();
    },
  };
}

module.exports = { createPluginHost };
