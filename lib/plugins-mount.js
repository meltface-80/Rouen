// @ts-check
"use strict";
/*
 * plugins-mount.js — the plugins Rouen comes with, registered with the plugin host and mounted (dev/design/plugins.md).
 * Moved out of index.js, HQPWeb's registration unchanged.
 *
 *   HQPWeb (v1.8.74, a plugin since v1.9.19): /api/hqp/*, all in lib/hqp/, its presets and learned failures kept on the
 *     data volume beside the rest. Not in Rouen Lite (2.0.6-t8; the owner: "Remove hqpweb as without a server this
 *     feature doesn't work"): HQPlayer runs on a computer of its own, and Lite is a phone or a tablet.
 */
const { createPluginHost } = require("./plugins");
const { hqpPlugin } = require("./hqp/plugin");

/**
 * @param {{ get: Function, post: Function, use: Function }} app
 * @param {{ dataDir: string, loadPersistedSettings: () => any, savePersistedSettings: (patch: any) => boolean,
 *           zones: () => any, version: string, lite?: boolean }} d  lite: Rouen Lite's (from the environment)
 */
function mountPlugins(app, d) {
  const lite = d.lite !== undefined ? d.lite : require("./lite").isLite();
  const { loadPersistedSettings, savePersistedSettings, zones } = d;
  const plugins = createPluginHost({ getSettings: () => loadPersistedSettings(),
    saveSettings: (patch) => savePersistedSettings(patch), log: (line) => { console.log("[plugins] " + line); } });
  if (!lite) plugins.register(hqpPlugin({ dataDir: d.dataDir, getSettings: () => loadPersistedSettings(),
    saveSettings: (patch) => savePersistedSettings(patch), zones: () => zones() }));
  plugins.mount(app);
  return plugins;
}

module.exports = { mountPlugins };
