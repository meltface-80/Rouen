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
 *   GET /api/debug/roon-smart-update?name=&sort=[&dir=desc][&update=1]  a smart playlist's order changed, by hand (v1.9.55, §12.9)
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
const { brokerIdCandidates } = require("./brokerid");
const { MAX_ITEMS, SERVICES } = require("./find");

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
  // Hearts on or off, and whose (v1.9.27, native-remote.md §8.4).
  app.post("/api/roon-direct/hearts", (/** @type {any} */ req, /** @type {any} */ res) => {
    const on = req.body && req.body.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
    res.json(stage1.setHearts(on));
  });
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
  mountSmartUpdate(app, stage1.smartUpdater);
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
    res.json(req.query.update === "1" ? await updater.update(name, sort, dir) : await updater.preview(name, sort, dir));
  }));
}

module.exports = { mountRoonDirectProbe, mountRoonDirect, mountSmartUpdate };
