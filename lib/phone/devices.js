// @ts-check
"use strict";
/*
 * devices.js — the phones Rouen plays to (dev/design/android-app.md §4.9 and §4.10, v1.9.72-t5): each one's player
 * (player.js), its commands waiting for it, and whether it is there.
 *
 *   hello     a phone says who it is; its player joins Roon (the zone "Rouen <name>"); a session already playing is
 *             sent to it again, so a phone that restarted picks it up.
 *   poll      the commands long poll. A phone that has not polled for 45 s is offline: its player leaves Roon, and its
 *             zone goes until the phone is back (the owner, §7 point 2).
 *   report    the phone's place and state, for its player to tell Roon.
 */

const PRESENT_MS = 45000, SWEEP_MS = 5000, KEEP_COMMANDS = 100, MAX_WAIT_MS = 25000;

/**
 * @typedef {object} DevicesDeps
 * @property {() => string | null} host  the Core's address
 * @property {(o: { deviceId: string, name: string, quality: "opus" | "lossless", host: string },
 *             send: (cmd: Record<string, any>) => void) => ReturnType<typeof import("./player").createPhonePlayer>} makePlayer
 * @property {() => number} [now]
 * @property {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [timers]
 */

/** @param {DevicesDeps} deps */
function createDevices(deps) {
  const now = deps.now || Date.now;
  const T = deps.timers || { setInterval, clearInterval, setTimeout, clearTimeout };
  /** @type {Map<string, any>} */
  const all = new Map();
  /** @type {any} */
  let sweeper = null;

  /** @param {any} d @param {Record<string, any>} cmd */
  function push(d, cmd) {
    d.seq++;
    d.commands.push(Object.assign({ seq: d.seq }, cmd));
    if (d.commands.length > KEEP_COMMANDS) d.commands.splice(0, d.commands.length - KEEP_COMMANDS);
    if (cmd.op === "open") d.open = Object.assign({}, cmd);
    if (cmd.op === "stop") d.open = null;
    if (cmd.op === "play" && d.open) d.open.play = true;
    if (cmd.op === "pause" && d.open) d.open.play = false;
    for (const w of d.waiters) w();
  }

  function sweep() {
    for (const d of all.values()) {
      if (d.player.running && !d.waiters.size && now() - d.lastSeen > PRESENT_MS) d.player.stop();
    }
  }

  return {
    /**
     * @param {{ device_id: string, name: string, quality: "opus" | "lossless" }} b
     * @returns {{ device_id: string, zone_name: string, seq: number, open: any } | null}  null: no Core to join
     */
    hello(b) {
      const host = deps.host();
      if (!host) return null;
      let d = all.get(b.device_id);
      if (!d) {
        d = { id: b.device_id, name: b.name, quality: b.quality, seq: 0, commands: [], waiters: new Set(), lastSeen: now(), open: null };
        const dev = d;
        d.player = deps.makePlayer({ deviceId: b.device_id, name: b.name, quality: b.quality, host }, (cmd) => push(dev, cmd));
        all.set(d.id, d);
      } else {
        if (d.name !== b.name) { d.name = b.name; d.player.rename(b.name); }
        if (d.quality !== b.quality) { d.quality = b.quality; d.player.setQuality(b.quality); }
      }
      d.lastSeen = now();
      d.player.start();
      if (!sweeper) sweeper = T.setInterval(sweep, SWEEP_MS);
      return { device_id: d.id, zone_name: d.player.zoneName, seq: d.seq, open: d.open };
    },
    /**
     * The commands after `after`, at once or when the next comes, or none after `wait`.
     * @param {string} id @param {number} after @param {number} wait
     * @returns {Promise<{ seq: number, commands: any[] }> | null}  null: say hello first
     */
    poll(id, after, wait) {
      const d = all.get(id);
      if (!d) return null;
      d.lastSeen = now();
      if (!d.player.running) d.player.start();
      const ready = () => d.commands.filter((/** @type {any} */ c) => c.seq > after);
      if (ready().length || after > d.seq) return Promise.resolve({ seq: d.seq, commands: ready() });
      return new Promise((resolve) => {
        /** @type {any} */
        let timer = null;
        const done = () => {
          T.clearTimeout(timer);
          d.waiters.delete(done);
          d.lastSeen = now();
          resolve({ seq: d.seq, commands: ready() });
        };
        timer = T.setTimeout(done, Math.max(0, Math.min(MAX_WAIT_MS, wait)));
        d.waiters.add(done);
      });
    },
    /** @param {string} id @param {{ session: number, position: number, state: string, error?: string }} r */
    report(id, r) {
      const d = all.get(id);
      if (!d) return false;
      d.lastSeen = now();
      d.player.report(r);
      return true;
    },
    /** @param {string} id @param {number} n */
    session(id, n) { const d = all.get(id); return d ? d.player.session(n) : null; },
    /** @param {string} id */
    zoneName(id) { const d = all.get(id); return d ? d.player.zoneName : null; },
    /**
     * What a zone is hearing, when it is a phone's (v1.9.72-t12, Mandarin's Now playing badge): Opus with its bit rate,
     * or lossless with its depth and rate; null for any other zone, or a phone with no session open.
     * @param {any} zone  Roon's zone (its display name, or one of its outputs', is the phone's)
     * @returns {{ kind: "opus" | "lossless", text: string } | null}
     */
    formatFor(zone) {
      if (!zone) return null;
      const names = [zone.display_name, ...(zone.outputs || []).map((/** @type {any} */ o) => o && o.display_name)];
      for (const d of all.values()) {
        if (!names.includes(d.player.zoneName)) continue;
        const f = d.player.info().format;
        if (!f) return null;
        if (f.quality === "opus") return { kind: "opus", text: "256kbps" };
        return { kind: "lossless", text: "Lossless" + (f.bits && f.rate ? " · " + f.bits + "-bit/" + (f.rate / 1000) + " kHz" : "") };
      }
      return null;
    },
    list() {
      return [...all.values()].map((d) => ({ device_id: d.id, name: d.name, quality: d.quality, online: d.player.running,
        last_seen_ms_ago: now() - d.lastSeen, player: d.player.info() }));
    },
    stopAll() {
      if (sweeper) T.clearInterval(sweeper);
      sweeper = null;
      for (const d of all.values()) { d.player.stop(); for (const w of d.waiters) w(); }
    },
  };
}

module.exports = { createDevices, PRESENT_MS, MAX_WAIT_MS };
