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
  mountHearts(app, stage1.marks);
}

/** @param {unknown} v */
const text = (v) => (typeof v === "string" && v.length <= 1000 ? v : null);

/**
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof import("./marks").createMarks>} marks
 */
function mountHearts(app, marks) {
  /** A call to the Core that threw (unanswered, the connection gone) is an answer, not a crash. @param {Function} fn */
  const safe = (fn) => (/** @type {any} */ req, /** @type {any} */ res) => Promise.resolve(fn(req, res)).catch((/** @type {any} */ e) => {
    if (!res.headersSent) res.status(502).json({ error: "Your server didn't answer: " + (e && e.message) });
  });
  /** @param {any} res @param {any} out */
  const send = (res, out) => ("error" in out ? res.status(out.status).json({ error: out.error }) : res.json(out));

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

module.exports = { mountRoonDirectProbe, mountRoonDirect };
