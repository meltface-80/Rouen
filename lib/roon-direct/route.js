// @ts-check
"use strict";
/*
 * route.js — Roon direct's routes (dev/design/roon-native.md).
 *
 * Stage 1 (§10, v1.9.18): Settings → Roon's switch.
 *   GET  /api/roon-direct            on or off, why it went off, the last read, the match
 *   GET  /api/roon-direct/unmatched  Rouen's albums Roon's list gave no source for, and why
 *   POST /api/roon-direct {on}       turn it on (reads at once) or off
 * Answers carry counts, versions, times and reasons, never protocol bytes.
 *
 * Hearts (v1.9.27, dev/design/native-remote.md §8), Roon's own favourite, written to the Core:
 *   GET  /api/hearts/album?title=&artist=          whether this album can be hearted here, and whether it is
 *   POST /api/hearts/album {title, artist, on}     heart it, or not
 *   POST /api/hearts/tracks {title, artist, titles, picks, on}   heart the picked tracks (positions in `titles`)
 * The album named by the album view's own title and artist; never a Core object id from the page.
 *
 * N2b-1 (v1.9.32, native-remote.md §9.1), read only:
 *   POST /api/roon-direct/find {albums: [{title, artist, service}]}   the server's own search for each
 *   (at most 20; service "tidal" or "qobuz"), and what it found — nothing is written.
 *
 * N2c-0 (v1.9.36, native-remote.md §10.1), read only, run by hand:
 *   GET /api/debug/roon-listen-later          says what a run would do; asks nothing
 *   GET /api/debug/roon-listen-later?run=1    Roon's own Listen Later, for the profile chosen
 *   GET /api/debug/roon-smart-playlists?run=1[&name=]  Roon's playlists, which are smart, their Focus, one's items (v1.9.50)
 *   GET /api/debug/roon-zones?run=1           zones, outputs and audio devices as the server sends them; no call (v1.9.64)
 *       [&settings=1] each device's settings and DSP, read (v1.9.66) · [&watch=N] every push to them for N s (v1.9.66)
 *   GET /api/debug/roon-peq?zone=&band=&gain=[&send=1][&save=0]  one Parametric EQ band's gain, tried by hand (v1.9.66-t14)
 *   GET /api/debug/roon-native-reads?run=1[&title=&artist=][&zone_id=][&queue=1]   N7-0 (v1.9.70-t3, native-remote.md §16.4;
 *                                         t4 §16.5): the reads full native mode rests on, each once; nothing written
 *   GET /api/album/track-times?title=&artist=   each track's length (v1.9.70-t14, native-remote.md §16.6;
 *                                         lib/routes/album-track-times.js)
 *   GET /api/debug/roon-smart-update?name=&sort=[&dir=desc][&omit=][&carry=][&update=1]  a smart playlist's order changed,
 *                                         by hand (v1.9.55, §12.9; the form varied by omit= and carry=, v1.9.56, §12.10)
 *
 * N3-3b (v1.9.66-t6, native-remote.md §15.6), read only:
 *   GET /api/roon/zone-settings?zone_id=   a zone's crossfade, volume levelling and sleep timer, from the server's Zone
 * N3-3c (v1.9.66-t7, §15.7), writes, each believed only when the server shows it:
 *   POST /api/roon/zone-settings {zone_id, crossfade | leveling | target | sleep}   one change
 * N3-4 (v1.9.66-t9, §15.9): each DSP item of the zone's outputs, as MUSE shows them
 *   GET  /api/roon/zone-dsp?zone_id=        each output of the zone and its DSP items, on or off (calls)
 *   POST /api/roon/zone-dsp {zone_id, item, on}   one item on or off, believed only when the server shows it
 * N3-5a (v1.9.66-t12, §15.12):
 *   POST /api/roon/zone-dsp/setting {zone_id, item, setting, value[, rule]}   one setting of an item, likewise
 * N3-5c (v1.9.66-t15, §15.15): a Parametric EQ, read afresh on a connection of its own (peq.js); writes its spec
 *   GET  /api/roon/zone-dsp/peq?zone_id=&item=   its bands (200), or why not (503; 400 for a request that can't be met)
 *   POST /api/roon/zone-dsp/peq {zone_id, item, band, setting, value}   one band's gain, frequency, q or on, likewise
 *
 * Stage 0: GET /api/debug/roon-direct, the probe (§4), run by hand.
 *
 *   /api/debug/roon-direct          says what a run would do; connects to nothing
 *   /api/debug/roon-direct?run=1    runs the probe (probe.js) and answers with it
 *   &broker=<32 hex>                a broker id to try first, given by hand
 *
 * Only `run=1` opens a connection, so a link previewed or prefetched never
 * touches the Core. The host is the Core Rouen is paired with (or
 * ROON_CORE_IP), never one named in the URL: this route must not become a way
 * to make Rouen open connections to arbitrary machines. One run at a time.
 * The answer carries counts, names and errors, never raw protocol bytes (§2.4:
 * nothing of the internal protocol is passed through to a browser).
 */
const { runProbe } = require("./probe");
const { DEFAULT_N, MAX_N } = require("./edit-info");
const { brokerIdCandidates } = require("./brokerid");
const { MAX_ITEMS, SERVICES } = require("./find");
const { OMITTABLE, CARRIABLE } = require("./smart-update");
const { MAX_MINUTES } = require("./push-log");
const { mountTrackTimes } = require("../routes/album-track-times");

/**
 * @typedef {object} RouteDeps
 * @property {() => { host: string | null, coreId: string | null, coreName: string | null }} core  the paired Core, as Rouen knows it
 * @property {() => number | null} rouenAlbums   Rouen's own album count, for comparison
 * @property {() => boolean} [enabled]           Roon direct switched on (v1.9.20): off, only Roon's
 *                                               official extension API is used, as Settings → Roon says
 * @property {typeof runProbe} [probe]           tests replace it
 */

/**
 * @param {{ get: Function }} app
 * @param {RouteDeps} deps
 */
function mountRoonDirectProbe(app, deps) {
  const probe = deps.probe || runProbe;
  let running = false;
  app.get("/api/debug/roon-direct", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const core = deps.core();
    const override = typeof req.query.broker === "string" ? req.query.broker : "";
    if (override && !/^[0-9a-f]{32}$/i.test(override)) return res.status(400).json({ error: "broker must be 32 hex characters" });
    const candidates = brokerIdCandidates({ coreId: core.coreId || undefined, override });
    const about = {
      stage: 0,
      readOnly: true,
      host: core.host,
      core: core.coreName,
      brokerIdsToTry: candidates.map((c) => ({ label: c.label, id: c.id.toString("hex") })),
      rouenAlbums: deps.rouenAlbums(),
      expectOnTheTestLibrary: "2 local + 6 TIDAL albums: local 2, tidal 6, qobuz 0",
    };
    if (req.query.run !== "1") {
      return res.json(Object.assign(about, { ran: false, how: "Add ?run=1 to run it. It opens one connection to the Core, reads, releases everything it opened, and closes." }));
    }
    if (deps.enabled && !deps.enabled()) {
      return res.status(409).json(Object.assign(about, { ran: false, error: "Native mode is off. Turn it on in Settings → Native mode first: while it is off, Rouen uses only the official extension API." }));
    }
    if (!core.host) return res.status(503).json(Object.assign(about, { ran: false, error: "Rouen is not paired with a Core, so there is no host to probe." }));
    if (running) return res.status(409).json(Object.assign(about, { ran: false, error: "A probe is already running." }));
    running = true;
    try {
      const result = await probe({ host: core.host, coreId: core.coreId || undefined, override });
      res.json(Object.assign(about, { ran: true, ranAt: new Date().toISOString() }, result));
    } catch (e) {
      res.status(500).json(Object.assign(about, { ran: true, error: e.message }));
    } finally {
      running = false;
    }
  });
}

/**
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof import("./stage1").createStage1>} stage1
 */
function mountRoonDirect(app, stage1) {
  app.get("/api/roon-direct", (/** @type {any} */ _req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json(stage1.status());
  });
  // Every album of Rouen's that Roon's list gave no source for, with why and
  // the Core's albums of the same title (v1.9.20): to read the next case, not guess it.
  app.get("/api/roon-direct/unmatched", (/** @type {any} */ _req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json({ unmatched: stage1.unmatched() });
  });
  app.post("/api/roon-direct", (/** @type {any} */ req, /** @type {any} */ res) => {
    const on = req.body && req.body.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
    const out = on ? stage1.turnOn() : stage1.turnOff();
    if ("error" in out) return res.status(409).json(Object.assign({ error: out.error }, stage1.status()));
    res.json(out);
  });
  // Whose hearts (v1.9.27, native-remote.md §8.4); hearts themselves are always on since v1.9.63 (§13).
  app.post("/api/roon-direct/profile", (/** @type {any} */ req, /** @type {any} */ res) => {
    const id = req.body && req.body.id;
    if (typeof id !== "string" || !/^[0-9a-f]{2,64}$/.test(id)) return res.status(400).json({ error: "a profile id, please" });
    const out = stage1.setProfile(id);
    if ("error" in out) return res.status(404).json({ error: out.error });
    res.json(out);
  });
  mountHearts(app, stage1.marks);
  mountFind(app, stage1.finder);
  mountListenLater(app, stage1.later);
  mountSmartProbe(app, stage1.smartProbe);
  mountEditInfoProbe(app, stage1.editInfoProbe);
  mountSmartUpdate(app, stage1.smartUpdater);
  mountZoneProbe(app, stage1.zoneProbe);
  mountReadsProbe(app, stage1.readsProbe);
  mountTrackTimes(app, stage1.trackTimes);
  mountZoneSettings(app, stage1);
  mountPeqTry(app, stage1.peqTry);
}


/** @param {unknown} v */
const text = (v) => (typeof v === "string" && v.length <= 1000 ? v : null);

/** A call to the Core that threw (unanswered, the connection gone) is an answer, not a crash. @param {Function} fn */
const safe = (fn) => (/** @type {any} */ req, /** @type {any} */ res) => Promise.resolve(fn(req, res)).catch((/** @type {any} */ e) => {
  // Unanswered, refused, or the connection gone: the reason as it came, never protocol bytes (it carries none).
  if (!res.headersSent) res.status(502).json({ error: "That didn't reach your server: " + (e && e.message) });
});
/** @param {any} res @param {any} out */
const send = (res, out) => ("error" in out ? res.status(out.status).json({ error: out.error }) : res.json(out));

/**
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof import("./marks").createMarks>} marks
 */
function mountHearts(app, marks) {
  app.get("/api/hearts/album", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = text(req.query.title), artist = text(req.query.artist || "");
    if (title === null || artist === null) return res.status(400).json({ error: "title and artist, please" });
    res.json(marks.albumState(title, artist));
  });
  app.post("/api/hearts/album", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const title = text(b.title), artist = text(b.artist || "");
    if (title === null || artist === null || typeof b.on !== "boolean") return res.status(400).json({ error: "title, artist and on, please" });
    send(res, await marks.setAlbum(title, artist, b.on));
  }));
  app.post("/api/hearts/tracks", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const title = text(b.title), artist = text(b.artist || "");
    const titles = Array.isArray(b.titles) && b.titles.length <= 500 && b.titles.every((t) => text(t) !== null) ? b.titles : null;
    const picks = Array.isArray(b.picks) && b.picks.length <= 500 && b.picks.every(Number.isInteger) ? b.picks : null;
    if (title === null || artist === null || !titles || !picks || typeof b.on !== "boolean") {
      return res.status(400).json({ error: "title, artist, titles, picks and on, please" });
    }
    send(res, await marks.setTracks(title, artist, titles, picks, b.on));
  }));
}

/**
 * N2b-1's check (native-remote.md §9.1): read only. Begun by a POST, followed by GETs (the review:
 * twenty searches in one request outlived proxies, and a lost answer looked like no check at all).
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof import("./find").createFinder>} finder
 */
function mountFind(app, finder) {
  app.get("/api/roon-direct/find", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json(finder.progress());
  });
  app.post("/api/roon-direct/find", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const list = req.body && req.body.albums;
    const ok = Array.isArray(list) && list.length >= 1 && list.length <= MAX_ITEMS && list.every((/** @type {any} */ a) => a &&
      text(a.title) !== null && a.title.trim() !== "" && text(a.artist || "") !== null && Object.prototype.hasOwnProperty.call(SERVICES, a.service));
    if (!ok) return res.status(400).json({ error: `albums: 1 to ${MAX_ITEMS} of {title, artist, service: ${Object.keys(SERVICES).map((k) => `"${k}"`).join(" or ")}}, please` });
    send(res, finder.start(list.map((/** @type {any} */ a) => ({ title: a.title.trim(), artist: String(a.artist || "").trim(), service: a.service }))));
  }));
}

/**
 * N2c-0's read of Roon's own Listen Later (native-remote.md §10.1): nothing without run=1.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./listen-later").createListenLaterReader>} later
 */
function mountListenLater(app, later) {
  app.get("/api/debug/roon-listen-later", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/native-remote.md §10.1",
        how: "Add ?run=1 to read Roon's own Listen Later, for the profile chosen in Settings → Native mode. Nothing is changed." });
    }
    send(res, await later.read());
  }));
}

/**
 * N2e-0's read of Roon's smart playlists (native-remote.md §12.1): nothing without run=1.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./smart-probe").createSmartProbe>} probe
 */
function mountSmartProbe(app, probe) {
  app.get("/api/debug/roon-smart-playlists", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/native-remote.md §12.1",
        how: "Add ?run=1 to read your server's playlists — which are smart, their Focus, and the first tracks of one (add &name= for a playlist by name). Nothing is changed." });
    }
    send(res, await probe.run({ name: typeof req.query.name === "string" && req.query.name ? req.query.name.slice(0, 200) : undefined }));
  }));
}

/**
 * t3's read of what Roon holds of a few albums' catalogue numbers, labels and kinds (catalogue.md §4): nothing
 * without run=1.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./edit-info").createEditInfoProbe>} probe
 */
function mountEditInfoProbe(app, probe) {
  app.get("/api/debug/roon-album-edit-info", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/catalogue.md §4",
        how: `Add ?run=1 to read what your server holds of a few library albums' catalogue number, labels and kind (its Type and its Live, Bootleg and Compilation flags), beside what Rouen holds from the tags and Discogs. Add &n=N (1 to ${MAX_N}, ${DEFAULT_N} if not given) for how many, &title=text or &artist=text to pick them. One read; nothing is changed.` });
    }
    const n = req.query.n === undefined ? undefined : /^\d+$/.test(String(req.query.n)) ? Number(req.query.n) : NaN;
    if (req.query.n !== undefined && !(n >= 1 && n <= MAX_N)) return res.status(400).json({ error: `n takes a whole number, 1 to ${MAX_N}` });
    send(res, await probe.run({ n, title: text(req.query.title) || undefined, artist: text(req.query.artist) || undefined }));
  }));
}

/**
 * N2e-3a's update of a Roon smart playlist's order, tried once by hand (native-remote.md §12.9): a preview unless
 * update=1, which sends it.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./smart-update").createSmartUpdater>} updater
 */
function mountSmartUpdate(app, updater) {
  app.get("/api/debug/roon-smart-update", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const name = typeof req.query.name === "string" ? req.query.name.slice(0, 200) : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "";
    if (!name || !sort) {
      return res.json({ design: "dev/design/native-remote.md §12.9",
        how: "Add ?name=<a Roon smart playlist>&sort=<album|artist|year|random> (and &dir=desc) to see the update; add &update=1 to send it." });
    }
    const dir = req.query.dir === "desc" ? "desc" : "asc";
    // The update's form, to find what the server refuses (§12.10): only the updater's own names, else a 400. A repeated
    // parameter is an array, and spaces and empty parts are dropped (the review).
    const list = (/** @type {any} */ v) => [].concat(v || []).join(",").split(",").map((x) => x.trim()).filter(Boolean);
    const omit = list(req.query.omit), carry = list(req.query.carry);
    if (omit.some((x) => !OMITTABLE.includes(x)) || carry.some((x) => !CARRIABLE.includes(x))) {
      return res.status(400).json({ error: `omit takes ${OMITTABLE.join(", ")}; carry takes ${CARRIABLE.join(", ")}` });
    }
    res.json(req.query.update === "1" ? await updater.update(name, sort, dir, { omit, carry }) : await updater.preview(name, sort, dir));
  }));
}

/**
 * N3-0's zones probe (native-remote.md §14.1): nothing without run=1; with it, no call either — what the connection holds.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./zone-probe").createZoneProbe>} probe
 */
function mountZoneProbe(app, probe) {
  app.get("/api/debug/roon-zones", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    // The recorder (§15.3, v1.9.66-t4): ?record=start[&minutes=N, 1 to 15, 10 if not given], then ?record=1.
    if (req.query.record !== undefined) {
      if (req.query.record === "1") return res.json(probe.record.read());
      if (req.query.record !== "start") return res.status(400).json({ error: "record takes start or 1" });
      const minutes = req.query.minutes === undefined ? 10 : /^\d+$/.test(String(req.query.minutes)) ? Number(req.query.minutes) : NaN;
      if (!(minutes >= 1 && minutes <= MAX_MINUTES)) return res.status(400).json({ error: `minutes takes whole minutes, 1 to ${MAX_MINUTES}` });
      const out = probe.record.start(minutes);
      return "error" in out ? res.status(503).json(out) : res.json(out);
    }
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/native-remote.md §14.1",
        how: "Add ?run=1 to read your server's zones, outputs and audio devices as it already sends them to Rouen, beside the official API's zones. It takes about 3 seconds. Nothing is asked of your server, and nothing is changed. Add &settings=1 to read each device's settings and DSP too (two reads a device; nothing is changed), and &watch=N (1 to 60) to log every update your server sends about them for N seconds while you change things in Roon's own app. Or record for longer: ?record=start (&minutes=N, 1 to 15) starts recording those updates and answers at once; change things in Roon's own app as you like, then open ?record=1 to read what came." });
    }
    // Absent: no watch. Given: whole seconds, 1 to 60 (0 and an empty one too are refused, the review).
    const watch = req.query.watch === undefined ? 0 : /^\d+$/.test(String(req.query.watch)) ? Number(req.query.watch) : NaN;
    if (req.query.watch !== undefined && !(watch >= 1 && watch <= 60)) return res.status(400).json({ error: "watch takes whole seconds, 1 to 60" });
    send(res, await probe.run({ settings: req.query.settings === "1", watchMs: watch * 1000 }));
  }));
}

/**
 * N7-0's reads probe (native-remote.md §16.4, v1.9.70-t3): nothing without run=1; with it, each read once, in the turn.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./reads-probe").createReadsProbe>} probe
 */
function mountReadsProbe(app, probe) {
  app.get("/api/debug/roon-native-reads", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/native-remote.md §16.4",
        how: "Add ?run=1 to ask your server, once each, for what full native mode needs: an album with its tracks, its artist (members, photo, biography), the genres, the tags, a cover, and what a zone plays. Add &title=…&artist=… for the album (a band whose line-up has changed shows most), and &zone_id=… for the zone; without them, the first playing zone and the library's first album. It takes a few seconds while something plays. Add &queue=1 to ask for the queue's items too (last; the whole queue with its history, which can be thousands). Nothing is changed." });
    }
    send(res, await probe.run({ title: text(req.query.title) || undefined, artist: text(req.query.artist) || undefined, zoneId: text(req.query.zone_id) || undefined,
      queue: req.query.queue === "1" }));
  }));
}

/**
 * A zone's settings (N3-3b, §15.6, read) and their changes and each output's DSP (N3-3c, §15.7).
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof import("./stage1").createStage1>} stage1
 */
function mountZoneSettings(app, stage1) {
  // N3-3b (§15.6, v1.9.66-t6): a zone's crossfade, volume levelling and sleep timer, read only.
  app.get("/api/roon/zone-settings", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const id = req.query.zone_id;
    if (typeof id !== "string" || !/^[0-9a-fA-F]{2,64}$/.test(id)) return res.status(400).json({ error: "a zone_id, please" });
    res.json(stage1.zoneSettings.read(id));
  });
  // N3-3c (§15.7, v1.9.66-t7): the settings changed. 200 when the server showed it; 409 when it was sent and
  // not shown (said, never sent again); 503 when nothing was sent.
  const zid = (/** @type {any} */ v) => (typeof v === "string" && /^[0-9a-fA-F]{2,64}$/.test(v) ? v : null);
  const changed = (/** @type {any} */ res, /** @type {any} */ out) => res.status(out.seen ? 200 : "notSent" in out ? 503 : 409).json(out);
  app.post("/api/roon/zone-settings", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    if (!zid(b.zone_id)) return res.status(400).json({ error: "a zone_id, please" });
    const { crossfade, leveling, target, sleep } = b;
    changed(res, await stage1.zoneControls.set(b.zone_id, { crossfade, leveling, target, sleep }));
  }));
  // N3-4 (§15.9, v1.9.66-t9): each DSP item, read and changed as above.
  app.get("/api/roon/zone-dsp", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (!zid(req.query.zone_id)) return res.status(400).json({ error: "a zone_id, please" });
    res.json(await stage1.zoneDsp.read(req.query.zone_id));
  }));
  app.post("/api/roon/zone-dsp", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    if (!zid(b.zone_id) || typeof b.item !== "string" || !/^\d{1,20}$/.test(b.item) || typeof b.on !== "boolean") {
      return res.status(400).json({ error: "a zone_id, an item and on, please" });
    }
    changed(res, await stage1.zoneDsp.set(b.zone_id, b.item, b.on));
  }));
  // N3-5a (§15.12, v1.9.66-t12): an item's setting, as above; the value is checked against the part as held (dsp-parts.js).
  app.post("/api/roon/zone-dsp/setting", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const v = b.value;
    const valueOk = v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 64);
    if (!zid(b.zone_id) || typeof b.item !== "string" || !/^\d{1,20}$/.test(b.item) || typeof b.setting !== "string" || b.setting.length > 32 || !valueOk
      || (b.rule !== undefined && (typeof b.rule !== "string" || !/^\d{1,20}$/.test(b.rule)))) {
      return res.status(400).json({ error: "a zone_id, an item, a setting and a value, please" });
    }
    changed(res, await stage1.dspSettings.set(b.zone_id, b.item, b.setting, v, b.rule));
  }));
  // N3-5c (§15.15, v1.9.66-t15): a Parametric EQ's bands, read afresh on a connection of its own (200, or 503 with why),
  // and one band's setting changed, as above.
  app.get("/api/roon/zone-dsp/peq", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (!zid(req.query.zone_id) || typeof req.query.item !== "string" || !/^\d{1,20}$/.test(req.query.item)) return res.status(400).json({ error: "a zone_id and an item, please" });
    const out = /** @type {any} */ (await stage1.peq.read(req.query.zone_id, req.query.item));
    res.status(out.item ? 200 : out.invalid ? 400 : 503).json(out);
  }));
  app.post("/api/roon/zone-dsp/peq", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const valueOk = typeof b.value === "boolean" || (typeof b.value === "number" && Number.isFinite(b.value));
    if (!zid(b.zone_id) || typeof b.item !== "string" || !/^\d{1,20}$/.test(b.item) || !Number.isInteger(b.band) || b.band < 1 || b.band > 64
      || typeof b.setting !== "string" || b.setting.length > 16 || !valueOk) {
      return res.status(400).json({ error: "a zone_id, an item, a band, a setting and a value, please" });
    }
    const out = /** @type {any} */ (await stage1.peq.set(b.zone_id, b.item, b.band, b.setting, b.value));
    // a change that can't be made (out of bounds, a setting the band hasn't, not an EQ): the request's, 400 (the review)
    if (out.invalid) return res.status(400).json(out);
    changed(res, out);
  }));
}

/**
 * N3-5b (§15.14, v1.9.66-t14): one Parametric EQ band's gain, tried by hand. Without send=1, the spec it would send and
 * the bands Rouen holds, to be compared with MUSE; with it, sent once, and what came back.
 * @param {{ get: Function }} app
 * @param {ReturnType<typeof import("./peq-try").createPeqTry>} peqTry
 */
function mountPeqTry(app, peqTry) {
  app.get("/api/debug/roon-peq", safe(async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const q = req.query;
    if (typeof q.zone !== "string" || typeof q.band !== "string" || typeof q.gain !== "string") {
      return res.json({ design: "dev/design/native-remote.md §15.14",
        how: "Add ?zone=<a zone's name>&band=<its number, from 1>&gain=<dB> to see the spec Rouen would send, with one band's gain changed, beside the bands it holds. Add &send=1 to send it once (&save=0 to send its bool false)." });
    }
    const band = /^\d{1,2}$/.test(q.band) ? Number(q.band) : NaN;
    const gain = /^-?\d{1,2}(\.\d)?$/.test(q.gain) ? Number(q.gain) : NaN;
    res.json(await peqTry.run({ zone: q.zone.slice(0, 100), band, gain, save: q.save !== "0", send: q.send === "1" }));
  }));
}

module.exports = { mountRoonDirectProbe, mountRoonDirect, mountSmartUpdate };
