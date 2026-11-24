// @ts-check
"use strict";
/*
 * routes.js — Settings → Setup → Away from home (dev/design/android-app.md §4.7, v1.9.72-t7): Tailscale built into
 * Rouen (node.js), from Mandarin's lib/server/api-tailscale.js.
 *
 *   GET  /api/tailscale          how it is: state, sign-in link, address
 *   POST /api/tailscale/login    a sign-in link (open it, sign in, done)
 *   POST /api/tailscale/logout   this Rouen leaves the tailnet
 *   POST /api/tailscale/enable   {on}: built-in Tailscale on or off
 *
 * Behind Rouen's login, as every route is — and the three that change it from home only: away, the way you are
 * reaching Rouen is the thing they would change.
 *
 * isAway: a request that came over the tailnet. The engine passes each one to Rouen on 127.0.0.1 with the caller's
 * tailnet address in X-Forwarded-For; Express is told to believe that header from loopback only ("trust proxy"), so
 * req.ip is then the caller's tailnet address — 100.64.0.0/10, or fd7a:115c:a1e0::/48 — and Rouen's login limiter
 * counts each caller apart rather than all of the tailnet as one.
 */

/** Tailscale's own addresses. @param {string} a */
function inTailnet(a) {
  const ip = String(a || "").replace(/^::ffff:(?=\d+\.)/i, "");
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (m) return Number(m[1]) >= 64 && Number(m[1]) <= 127;
  return /^fd7a:115c:a1e0:/i.test(ip);
}

/** Whether the request came over the tailnet. @param {any} req */
function isAway(req) {
  const peer = String((req.socket && req.socket.remoteAddress) || "").replace(/^::ffff:(?=\d+\.)/i, "");
  return (peer === "127.0.0.1" || peer === "::1") && inTailnet(req.ip);
}

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ tailscale: ReturnType<typeof import("./node").createTailscaleNode> }} deps
 */
function mountTailscale(app, deps) {
  const ts = deps.tailscale;
  /** @param {(req: any) => Promise<any>} fn */
  const change = (fn) => async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (isAway(req)) return res.status(403).json({ error: "Change this from home: away, it is how you are connected." });
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(500).json({ error: /** @type {Error} */ (e).message || String(e) });
    }
  };
  app.get("/api/tailscale", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json(Object.assign(ts.status(), { away: isAway(req) }));
  });
  app.post("/api/tailscale/login", change(() => ts.login()));
  app.post("/api/tailscale/logout", change(() => ts.logout()));
  app.post("/api/tailscale/enable", change((req) => ts.setEnabled(!!(req.body && req.body.on))));
}

module.exports = { mountTailscale, isAway, inTailnet };
