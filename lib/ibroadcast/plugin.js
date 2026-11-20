// @ts-check
"use strict";
/*
 * plugin.js — iBroadcast as a plugin to Rouen (2.0.6-t1, dev/design/ibroadcast.md §1; the owner's answer,
 * 2026-11-20): what the plugin host (lib/plugins.js) needs to know of it. The service is service.js; this only says how
 * to make one, and under which switch and prefix. Off unless ibroadcastEnabled is true, so a new install has it off.
 */
const { createIBroadcastService } = require("./service");

/**
 * @param {Parameters<typeof createIBroadcastService>[0]} opts  what service.js is made with
 * @returns {import("../plugins").Plugin}
 */
function ibroadcastPlugin(opts) {
  return {
    id: "ibroadcast",
    name: "iBroadcast",
    prefix: "/api/ibroadcast",
    settingKey: "ibroadcastEnabled",
    summary: "Sign in to your iBroadcast account and read its library, on the way to Roon playing it from a drive.",
    author: "Rouen",
    create: () => createIBroadcastService(opts),
  };
}

module.exports = { ibroadcastPlugin };
