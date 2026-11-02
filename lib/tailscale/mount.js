// @ts-check
"use strict";
/*
 * mount.js — the phones and the way to them from away (dev/design/android-app.md §4.7, §4.10, §4.22; v1.9.72-t7):
 * Rouen's built-in Tailscale (node.js, routes.js) and the phone's API (lib/phone), wired as index.js wired the phones
 * in v1.9.72-t5, moved out of it here.
 *
 *  - Express believes X-Forwarded-For from loopback only: the engine's own requests (routes.js, isAway).
 *  - The engine's state is data/tailscale; the engine itself the image's /usr/local/bin/musicdnet, or on Windows
 *    bin/musicdnet.exe beside Rouen (windows.yml builds it into the payload).
 *  - Its switch is the stored setting `tailscaleEnabled`, on unless switched off (Mandarin's default).
 *  - The phone's hello says whether it came over the tailnet, and gives Rouen's tailnet address. Since §4.22 the
 *    phone is never a Roon zone, so no Squeezebox player is made for it here (v1.9.72-t54).
 *  - The phone's downloads (lib/phone/downloads.js, v1.9.72-t27) read the albums' folders in /music.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createTailscaleNode } = require("./node");
const { mountTailscale, isAway } = require("./routes");
const { mountPhone } = require("../phone/routes");
const { createDownloads, mountDownloads } = require("../phone/downloads");

/**
 * The server-side Squeezebox player's sessions, left from before v1.9.72-t54 (§4.22): data/phone/<device>/s<n>.flac or
 * .ogg, up to three per phone (whole albums, when lossless). Nothing reads or writes that folder any more, so it is
 * removed when Rouen starts; a folder already gone is no work. One that can't be removed costs disk only, never a
 * failure to start, and is said in the log.
 * @param {string} root  Rouen's folder @param {(line: string) => void} log
 */
function removeOldSessions(root, log) {
  const dir = path.join(root, "data", "phone");
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    log("[phone] couldn't remove the old Squeezebox sessions in " + dir + ": " + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * @param {any} app  the Express app
 * @param {{ root: string, port: number, version: string, ffmpeg: () => string,
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
  removeOldSessions(o.root, (line) => console.log(line));
  mountPhone(app, { away: isAway, awayAddress: () => tailscale.address() });
  if (o.downloads) mountDownloads(app, createDownloads(o.downloads), { ffmpeg: o.ffmpeg, spawn: o.spawn || require("node:child_process").spawn });
  return { tailscale };
}

module.exports = { mountAway, removeOldSessions };
