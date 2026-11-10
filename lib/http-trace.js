// @ts-check
"use strict";
/*
 * http-trace.js — the request trace of the debug log: one line per API request, the steady pollers left out. Moved
 * out of index.js in v2.0.3-t11 (dev/quality.md, "Splitting the monoliths"), unchanged but for the one path added.
 *
 *   [http] POST /api/playlist/play -> 200 412ms
 *
 * One line per user action is what makes the log readable. A page that asks the same thing every second or two would
 * bury everything else, so those paths are left out:
 *   zone-state, zones: the transport bar, every 1.5 s;  image/: one a cover
 *   live$: every 3 s while the app is on screen (v1.8.65)
 *   hqp/now: every 1.5 s while the HQPWeb screen is open (v1.8.74)
 *   playlist/play-ordered/status: every 1.5 s while a page watches tracks being sent in the order shown (v2.0.3-t11).
 *     The start and the Stop of that run have paths of their own, and are traced.
 */

const TRACE_SKIP = /^\/api\/(live$|zone-state|zones$|image\/|update\/status|settings\/tidal\/status|settings\/display|labels-scan-status|search-status|hqp\/now$|playlist\/play-ordered\/status$)/;

/**
 * @param {{ use: Function }} app  mounted before the routes, so every one of them is timed
 * @param {{ debug: boolean, log?: (...parts: any[]) => void }} o  debug: off, and nothing is traced; log: the test's
 */
function mountHttpTrace(app, o) {
  app.use((/** @type {any} */ req, /** @type {any} */ res, /** @type {() => void} */ next) => {
    if (!o.debug || !req.path.startsWith("/api/") || TRACE_SKIP.test(req.path)) return next();
    const t0 = Date.now();
    res.on("finish", () => {
      // console.log as it is when the line is written: index.js gives it the log's timestamps and file.
      (o.log || console.log)("[http]", req.method, req.originalUrl, "->", res.statusCode, (Date.now() - t0) + "ms");
    });
    next();
  });
}

module.exports = { mountHttpTrace, TRACE_SKIP };
