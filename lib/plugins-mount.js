// @ts-check
"use strict";
/*
 * plugins-mount.js — the plugins Rouen comes with, registered with the plugin host and mounted (dev/design/plugins.md).
 * Moved out of index.js in 2.0.6-t1, HQPWeb's registration unchanged, when iBroadcast joined it
 * (dev/design/ibroadcast.md §3.5).
 *
 *   HQPWeb (v1.8.74, a plugin since v1.9.19): /api/hqp/*, all in lib/hqp/, its presets and learned failures kept on the
 *     data volume beside the rest.
 *   iBroadcast (2.0.6-t1): /api/ibroadcast/*, all in lib/ibroadcast/, its library kept on the data volume.
 */
const { createPluginHost } = require("./plugins");
const { hqpPlugin } = require("./hqp/plugin");
const { ibroadcastPlugin } = require("./ibroadcast/plugin");

/**
 * @param {{ get: Function, post: Function, use: Function }} app
 * @param {{ dataDir: string, loadPersistedSettings: () => any, savePersistedSettings: (patch: any) => boolean,
 *           zones: () => any, version: string, ibroadcastBase?: string | null }} d
 *   ibroadcastBase: iBroadcast's servers under one address (tests' stand-in); iBroadcast's own when not given
 */
function mountPlugins(app, d) {
  const { loadPersistedSettings, savePersistedSettings, zones } = d;
  const plugins = createPluginHost({ getSettings: () => loadPersistedSettings(),
    saveSettings: (patch) => savePersistedSettings(patch), log: (line) => { console.log("[plugins] " + line); } });
  plugins.register(hqpPlugin({ dataDir: d.dataDir, getSettings: () => loadPersistedSettings(),
    saveSettings: (patch) => savePersistedSettings(patch), zones: () => zones() }));
  plugins.register(ibroadcastPlugin({ dataDir: d.dataDir, load: () => loadPersistedSettings(),
    save: (patch) => savePersistedSettings(patch), version: d.version, base: d.ibroadcastBase || null }));
  plugins.mount(app);
  return plugins;
}

module.exports = { mountPlugins };
