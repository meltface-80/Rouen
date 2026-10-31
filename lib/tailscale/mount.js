// @ts-check
"use strict";
/*
 * mount.js — the phones and the way to them from away (dev/design/android-app.md §4.7, §4.9, §4.10; v1.9.72-t7):
 * Rouen's built-in Tailscale (node.js, routes.js) and the phone's API (lib/phone), wired as index.js wired the phones
 * in v1.9.72-t5, moved out of it here.
 *
 *  - Express believes X-Forwarded-For from loopback only: the engine's own requests (routes.js, isAway).
 *  - The engine's state is data/tailscale; the engine itself the image's /usr/local/bin/musicdnet, or on Windows
 *    bin/musicdnet.exe beside Rouen (windows.yml builds it into the payload).
 *  - Its switch is the stored setting `tailscaleEnabled`, on unless switched off (Mandarin's default).
 *  - The phone's hello says whether it came over the tailnet, and gives Rouen's tailnet address.
 *  - The phone's downloads (lib/phone/downloads.js, v1.9.72-t27) read the albums' folders in /music.
 */
const path = require("node:path");
const { createTailscaleNode } = require("./node");
const { mountTailscale, isAway } = require("./routes");
const { createDevices } = require("../phone/devices");
const { createPhonePlayer } = require("../phone/player");
const { mountPhone } = require("../phone/routes");
const { createDownloads, mountDownloads } = require("../phone/downloads");

/**
 * @param {any} app  the Express app
 * @param {{ root: string, port: number, version: string, ffmpeg: () => string, host: () => string | null,
 *   zones: () => Record<string, any>, control: (zoneId: string, op: string, done: (err: any) => void) => void,
 *   settings: { load: () => Record<string, any>, save: (patch: Record<string, any>) => void },
 *   downloads?: Parameters<typeof createDownloads>[0], spawn?: Function,
 *   env?: Record<string, string | undefined>, platform?: string }} o
 */
function mountAway(app, o) {
  const platform = o.platform || process.platform;
  app.set("trust proxy", "loopback");
  const tailscale = createTailscaleNode({
    bin: platform === "win32" ? path.join(o.root, "bin", "musicdnet.exe") : "/usr/local/bin/musicdnet",
    dir: path.join(o.root, "data", "tailscale"),
    port: o.port, version: o.version, env: o.env, platform,
    enabled: () => o.settings.load().tailscaleEnabled !== false,
    setEnabled: (on) => o.settings.save({ tailscaleEnabled: on }),
    log: (line) => console.log(line),
  });
  mountTailscale(app, { tailscale });
  const devices = createDevices({ host: o.host,
    makePlayer: (p, send) => createPhonePlayer({ dir: path.join(o.root, "data", "phone"), ffmpeg: o.ffmpeg, send,
      version: o.version, log: (line) => console.log("[phone] " + line) }, p) });
  mountPhone(app, { devices, zones: o.zones, control: o.control, away: isAway, awayAddress: () => tailscale.address(), coreHost: o.host });
  if (o.downloads) mountDownloads(app, createDownloads(o.downloads), { ffmpeg: o.ffmpeg, spawn: o.spawn || require("node:child_process").spawn });
  return { tailscale, devices };
}

module.exports = { mountAway };
