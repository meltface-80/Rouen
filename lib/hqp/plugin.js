// @ts-check
"use strict";
/*
 * plugin.js — HQPlayer control as a plugin to Rouen (dev/design/plugins.md §5):
 * what the plugin host (lib/plugins.js) needs to know of it. The service is
 * service.js, as it was; this only says how to make one, and under which
 * switch and prefix.
 *
 * The switch is the setting HQPlayer control has used since v1.8.74,
 * hqpEnabled — on only when true — so a new install has it off and an
 * existing one keeps what it had, with nothing to migrate.
 */
const { createHqpService } = require("./service");

/**
 * @param {Parameters<typeof createHqpService>[0]} opts  what service.js is made with
 * @returns {import("../plugins").Plugin}
 */
function hqpPlugin(opts) {
  return {
    id: "hqplayer",
    name: "HQPlayer",
    prefix: "/api/hqp",
    settingKey: "hqpEnabled",
    // The Plugins page's card (dev/design/plugins.md §7, v1.9.33).
    summary: "Change HQPlayer's filters, modulator and dither from Rouen, with presets and undo.",
    author: "Rouen",
    credit: { name: "hqpweb", by: "statelycurmudgeon", url: "https://github.com/statelycurmudgeon/hqpweb" },
    // Closed by the host as a save that switches it off would close it:
    // drained, so a change being watched can still be rolled back.
    create: () => { const s = createHqpService(opts); return { mount: s.mount, close: s.retire }; },
  };
}

module.exports = { hqpPlugin };
