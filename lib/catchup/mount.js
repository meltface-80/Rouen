// @ts-check
"use strict";
/*
 * mount.js — the catch-up, wired (dev/design/android-app.md §4.22, v1.9.72-t56): the silent player (player.js), the
 * driver that replays This phone's plays on it (driver.js), the plays kept on disk, how a play is asked of Roon, and
 * the routes. Every route needs Rouen's login, as every route does.
 *
 *   POST /api/phone/plays  {device_id, plays: [{album, artist, track, index, elapsed, at}]}
 *                          → {ok, kept, waiting, catchup}  the phone's plays; kept only while catch-up is on
 *   GET  /api/catchup      → {enabled, waiting, replaying, replayed, dropped, zone, player, recent, zone_name}
 *   POST /api/catchup      {enabled: true | false}  → the same; switches it (the stored setting `catchupEnabled`)
 *
 * Off unless switched on (Settings → Setup; the owner, 2026-10-31: "make it optional"). Off, the phone's plays are not
 * kept, so they reach neither Roon's counts nor, through Roon, Last.fm (the owner, 2026-11-02: Roon scrobbles them on
 * catch-up). On, "Rouen catch-up" joins Roon and must be enabled there once (Settings → Audio), as any new device.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createCatchupPlayer, NAME } = require("./player");
const { createCatchup } = require("./driver");

const ID = /^[0-9a-f]{32}$/;
/** A request's plays at most; more is a phone sending what it shouldn't. */
const MAX_PLAYS = 500;

/**
 * One play as the phone sends it, checked; null when it isn't one. The artist is needed: without it, the album would
 * be found by its title alone, and a play replayed on another artist's album of the same name.
 * @param {any} p @returns {import("./driver").Play | null}
 */
function playOf(p) {
  if (!p || typeof p !== "object") return null;
  const str = (/** @type {any} */ v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const album = str(p.album), artist = str(p.artist), track = str(p.track);
  const index = Number(p.index), elapsed = Number(p.elapsed), at = Number(p.at);
  if (!album || !artist || !track || !Number.isInteger(index) || index < 0 || index > 999) return null;
  if (!(elapsed > 0 && elapsed <= 6 * 3600) || !(at > 0)) return null;
  return { album, artist, track, index, elapsed, at };
}

/**
 * The plays kept on disk in [file]. One that can't be read (cut off, or not a list) is set aside beside it, never
 * written over, and the queue starts empty. @param {string} file @param {(line: string) => void} log
 */
function storeAt(file, log) {
  return {
    load() {
      if (!fs.existsSync(file)) return [];
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(v)) return v;
        throw new Error("not a list");
      } catch (e) {
        const aside = file + ".unreadable-" + Date.now();
        fs.renameSync(file, aside);
        log("[catch-up] the kept plays couldn't be read (" + /** @type {Error} */ (e).message + "): set aside as " + aside);
        return [];
      }
    },
    /** @param {any[]} plays */
    save(plays) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(plays));
      fs.renameSync(file + ".tmp", file);
    },
  };
}

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ root: string, host: () => string | null, zone: () => any,
 *   settings: { load: () => Record<string, any>, save: (patch: Record<string, any>) => void },
 *   core: () => any, libraryReady: () => boolean, relocate: (expect: { title: string, subtitle: string }) => number,
 *   invokeTrackAction: (offset: number, track: number, title: string, zoneId: string, kind: string, filter: any,
 *     expect: { title: string, subtitle: string }) => Promise<any>,
 *   parseFilter: (src: any) => any, control: (zoneId: string, op: string, done: (err: any) => void) => void,
 *   log?: (line: string) => void, player?: ReturnType<typeof createCatchupPlayer> }} o
 *   relocate: the album's place in the library by its title and artist (-1: not there); invokeTrackAction: index.js's
 *   own play of one track, which finds the track by its place and then its title
 */
function mountCatchup(app, o) {
  const log = o.log || ((/** @type {string} */ line) => console.log(line));
  const enabled = () => o.settings.load().catchupEnabled === true;
  const player = o.player || createCatchupPlayer();
  const zoneId = () => { const z = o.zone(); return z ? z.zone_id : null; };

  /** Ask Roon to play [play]'s track on the zone. Throws; a `permanent` error is one that will never succeed. @param {import("./driver").Play} play @param {string} zid */
  async function playTrack(play, zid) {
    if (!o.core()) throw new Error("Not paired with Roon Core yet");
    // Before the library's first read the albums aren't known yet: that is a wait, not "not in the library".
    if (!o.libraryReady()) throw new Error("Rouen hasn't read the library yet");
    const expect = { title: play.album, subtitle: play.artist };
    const offset = o.relocate(expect);
    if (offset < 0) throw Object.assign(new Error("not in the library: " + play.album + " by " + play.artist), { permanent: true });
    try {
      await o.invokeTrackAction(offset, play.index, play.track, zid, "play_now", o.parseFilter({}), expect);
    } catch (e) {
      // Stale: the album holds no such track, by its place or its title — it won't be there next time either.
      if (e && /** @type {any} */ (e).stale) /** @type {any} */ (e).permanent = true;
      throw e;
    }
  }
  /** @param {string} zid @returns {Promise<void>} */
  const stop = (zid) => new Promise((resolve, reject) => {
    o.control(zid, "stop", (err) => (err ? reject(new Error(String(err))) : resolve()));
  });

  const store = storeAt(path.join(o.root, "data", "catchup-plays.json"), log);
  const catchup = createCatchup({ player, host: o.host, enabled, zoneId, playTrack, stop, store, log });
  catchup.start();

  const status = () => Object.assign(catchup.status(), { player: player.state(), zone_name: NAME });

  app.post("/api/phone/plays", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    if (typeof b.device_id !== "string" || !ID.test(b.device_id) || !Array.isArray(b.plays) || b.plays.length > MAX_PLAYS) {
      return res.status(400).json({ error: "device_id (32 hex) and plays (at most " + MAX_PLAYS + "), please" });
    }
    const plays = b.plays.map(playOf);
    if (plays.some((p) => p === null)) return res.status(400).json({ error: "each play: album, artist, track, index, elapsed (s) and at, please" });
    // Off, the plays are not kept: they are answered as taken, so the phone doesn't send them again.
    if (!enabled()) return res.json({ ok: true, kept: 0, waiting: 0, catchup: false });
    // Plays sent again (an answer lost on the way) are taken once: `kept` counts only the new.
    const kept = catchup.add(/** @type {import("./driver").Play[]} */ (plays));
    res.json({ ok: true, kept, waiting: catchup.waiting(), catchup: true });
  });

  app.get("/api/catchup", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json(status());
  });

  app.post("/api/catchup", (/** @type {any} */ req, /** @type {any} */ res) => {
    const on = (req.body || {}).enabled;
    if (typeof on !== "boolean") return res.status(400).json({ error: "enabled: true or false, please" });
    o.settings.save({ catchupEnabled: on });
    log("[catch-up] switched " + (on ? "on" : "off"));
    res.json(status());
  });

  return catchup;
}

module.exports = { mountCatchup, playOf, storeAt, MAX_PLAYS };
