// @ts-check
"use strict";
/*
 * route.js — GET /api/debug/roon-direct, stage 0's probe (dev/design/
 * roon-native.md §4), run by hand.
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

module.exports = { mountRoonDirectProbe };
