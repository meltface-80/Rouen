// @ts-check
"use strict";
/*
 * queue.js — GET /api/queue?zone=: a zone's queue, and what it already played. Moved out of index.js unchanged in
 * 2.0.6-t2 (dev/quality.md, "Splitting the monoliths").
 *
 * Queue for a zone
 * RoonApiTransport doesn't expose a one-shot get_queue — only subscribe_queue.
 * We subscribe, respond on the first "Subscribed" payload, then immediately
 * unsubscribe via the handle node-roon-api returns. The old version skipped
 * the unsubscribe, so every queue-modal open left one live subscription the
 * Core kept pushing deltas to for the life of the process — an unbounded,
 * extension-induced load on the Core.
 */

/**
 * @param {{ get: Function }} app
 * @param {{ core: () => any, history: (zoneId: string) => any[] }} d  history: what the zone already played, newest first
 */
function mountQueue(app, d) {
  app.get("/api/queue", (/** @type {any} */ req, /** @type {any} */ res) => {
    const core = d.core();
    if (!core) return res.status(503).json({ error: "Not paired with Roon Core" });
    const zoneId = req.query.zone;
    if (!zoneId) return res.status(400).json({ error: "zone required" });

    let responded = false;
    /** @type {any} */
    let sub = null;
    // Declared before finish(), which clears it (ESLint's no-use-before-define, once out of index.js); set just below.
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeout;
    // Respond exactly once, then drop the subscription. Also runs on timeout,
    // so a slow "Subscribed" that arrives after 504 still gets unsubscribed.
    const finish = (/** @type {() => void} */ send) => {
      if (responded) return;
      responded = true;
      clearTimeout(timeout);
      send();
      if (sub) {
        try { sub.unsubscribe(() => {}); }
        catch (e) { /* socket already gone — the subscription died with it */ }
      }
    };
    timeout = setTimeout(() => {
      finish(() => res.status(504).json({ error: "queue subscription timed out" }));
    }, 5000);

    try {
      sub = core.services.RoonApiTransport.subscribe_queue(zoneId, 100, (/** @type {string} */ response, /** @type {any} */ msg) => {
        if (response === "Subscribed") {
          finish(() => {
            const items = ((msg && msg.items) || []).map((/** @type {any} */ it) => ({
              queue_item_id: it.queue_item_id,
              // three_line FIRST. Roon's one_line.line1 is "Track - Artist" all
              // in one string, and the row already prints the artist underneath
              // as its subtitle — so it read "The Artist - Big Big Train" over
              // "Big Big Train". The played-earlier rows come from the zone push,
              // which is three_line, so the two halves of the same list also
              // disagreed about how to write a track down.
              title:    (it.three_line && it.three_line.line1) || (it.one_line && it.one_line.line1) || "",
              subtitle: (it.three_line && it.three_line.line2) || "",
              image_key: it.image_key || null,
              length:    it.length || null
            }));
            // What this zone already played, newest first, alongside the live
            // queue so the screen needs one fetch. Roon cannot supply it — see
            // lib/queue-history.js — so it comes from what we watched leave.
            // Capped well below the ring: this is a fold-out, not an archive,
            // and it rides on a response the queue screen opens constantly.
            res.json({ items, history: d.history(zoneId) });
          });
        } else if (response && response !== "Changed" && response !== "Unsubscribed") {
          // An error name (e.g. "NetworkError") instead of a payload — fail fast
          // rather than waiting out the 5 s timeout.
          finish(() => res.status(502).json({ error: "queue subscription failed: " + response }));
        }
      });
      // If the first response was delivered synchronously (inside the
      // subscribe_queue call itself), finish() ran while `sub` was still null
      // and couldn't unsubscribe — catch up now that the handle exists.
      if (responded && sub) {
        try { sub.unsubscribe(() => {}); }
        catch (e) { /* socket already gone — the subscription died with it */ }
      }
    } catch (e) {
      finish(() => res.status(500).json({ error: e.message || String(e) }));
    }
  });
}

module.exports = { mountQueue };
