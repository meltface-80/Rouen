// @ts-check
"use strict";
/*
 * smart-picks-actions.js — what changes today's Smart Picks:
 *
 *   POST /api/smart-picks/rebuild        today's set discarded and built again now (moved out of index.js unchanged
 *                                        in 2.0.7-t1)
 *   POST /api/smart-picks/block          { artist } — "Not for me", for ever (moved out unchanged in 2.0.7-t1)
 *   GET  /api/smart-picks/tune           { tune, genres, decades, windows, adventures }: Tune (smart-picks.md §5)
 *   POST /api/smart-picks/tune           { tune } — the whole Tune, checked before any of it is taken, saved, and
 *                                        today's picks rebuilt (a change rebuilds, as Rebuild does); {} is Reset
 *   POST /api/smart-picks/tune/artist    { name, as: "more" | "never" | "none" } — one artist, from a pick's
 *                                        "Because you play X" or the Tune sheet's lists; saved and rebuilt
 *
 * A Tune is saved before the rebuild starts; a rebuild refused (not paired) leaves it saved, said in the answer. A
 * rebuild asked for while a build runs (which reads the Tune it started with) waits for it, then builds again, once.
 *
 * Each profile's (profiles.md §3, 2.0.7-t3): every route acts for the device's profile (`owner`). Guest has no Smart
 * Picks of its own: it reads the first profile's, and changes none (403).
 */

const { parseTune, withArtist, WINDOW_LABELS, ADVENTURE_LABELS } = require("../smart-picks/tune");

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{
 *   paired: () => boolean, today: () => string, dest: () => string, db: () => any, attemptKey: (day: string) => string,
 *   forgetLaterDay: (day: string) => void, forgetPickArtist: (canon: string) => void, bump: () => void,
 *   kick: (o: { tuned?: boolean, profile: string }) => void, running: () => Promise<unknown> | null, log: (line: string) => void,
 *   canonArtist: (name: string) => string, blockStmt: () => any, owner: (req: any) => string | null, reader: (req: any) => string,
 *   tune: (profile: string) => import("../smart-picks/tune").Tune,
 *   saveTune: (profile: string, t: import("../smart-picks/tune").Tune) => boolean,
 *   listened: (profile: string) => { genres: Array<{ name: string, share: number }>, decades: Array<{ name: string, share: number }> },
 * }} d
 *   bump: today's picks changed (index.js picksVersion), so every screen re-reads them; kick: the build, now (nothing
 *   when Smart Picks is off), `tuned` for one a Tune change asked for, which adds nothing to the streaming library;
 *   running: the build under way, if one is; log: a line for the container's log; owner: whose Smart Picks the request
 *   changes (its device's profile), or null on Guest; reader: whose it reads (Guest: the first profile's)
 */
function mountSmartPicksActions(app, d) {
  /** The rebuilds waiting for the build under way: each profile's, and whether a Tune change asked for it. */
  /** @type {Map<string, boolean>} */
  const waiting = new Map();
  /** @type {Promise<void> | null} */
  let again = null;
  /**
   * A profile's set of today discarded and built again. @param {string} profile @param {{ tuned?: boolean }} [o]  a
   * Tune change: picks with Add, none favourited (the owner, 2026-11-26: "Show, don't add")
   * @returns {{ ok: true, building: boolean }}
   */
  function rebuild(profile, o) {
    const tuned = !!(o && o.tuned);
    const day = d.today();
    const db = d.db();
    if (db) {
      // With picks sent to Listen later, the set being discarded was put there
      // too; leaving it would stack a fresh five on top at every Rebuild, with
      // the old ones no longer on the Smart Picks screen to say "Not for me" to.
      if (d.dest() === "later") d.forgetLaterDay(day);
      db.prepare("DELETE FROM smart_picks WHERE day = ? AND profile = ?").run(day, profile);
      db.prepare("DELETE FROM smart_cache WHERE key = ?").run(d.attemptKey(day));
      d.bump();   // the day's set is gone until the rebuild lands
    }
    const running = d.running();
    if (running) {
      // The build under way started with the Tune as it was: once it ends, the profile's set is built again (§5).
      waiting.set(profile, !!waiting.get(profile) || tuned);   // one asked for by Tune among them: nothing favourited
      if (!again) {
        again = Promise.resolve(running).catch(() => null)   // its own failure is logged where it runs (index.js bgRun)
          .then(() => {
            const all = [...waiting];
            waiting.clear();
            again = null;
            for (const [p, t] of all) rebuild(p, { tuned: t });
          })
          .catch((e) => { d.log("[picks] the rebuild after a running build failed: " + /** @type {Error} */ (e).message); });
      }
      return { ok: true, building: true };
    }
    d.kick({ tuned, profile });   // the button means now, schedule or not
    return { ok: true, building: !!d.running() };
  }

  /** The request's profile, or a 403 sent (Guest changes no one's picks). @param {any} req @param {any} res */
  function ownerOr403(req, res) {
    const p = d.owner(req);
    if (p === null) res.status(403).json({ error: "Guest has no Smart Picks of its own. Choose your profile in the side menu to change them." });
    return p;
  }

  // Rebuild today's picks now, ignoring the schedule and the attempt marker.
  // The button somebody presses when they want to see it work.
  app.post("/api/smart-picks/rebuild", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.paired()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const profile = ownerOr403(req, res);
    if (profile === null) return;
    try { res.json(rebuild(profile)); }
    catch (e) { res.status(500).json({ error: /** @type {Error} */ (e).message }); }
  });

  // POST /api/smart-picks/block { artist } — "not for me", permanently.
  //
  // Only an explicit tap blocks an artist. Ignoring a pick must NOT count as a
  // rejection: the whole premise is albums the user would never reach for, so a
  // model that read silence as "no" would suppress the entire feature within a
  // week.
  app.post("/api/smart-picks/block", (/** @type {any} */ req, /** @type {any} */ res) => {
    const artist = String((req.body && req.body.artist) || "").trim();
    if (!artist) return res.status(400).json({ error: "artist required" });
    const canon = d.canonArtist(artist);
    if (!canon) return res.status(400).json({ error: "unrecognisable artist name" });
    const profile = ownerOr403(req, res);
    if (profile === null) return;
    const db = d.db();
    const stmt = d.blockStmt();
    if (!db || !stmt) return res.status(503).json({ error: "History database unavailable" });
    try {
      stmt.run(profile, canon, artist, Date.now());
      // Drop it from today's set too, so it disappears on refresh instead of
      // sitting there until tomorrow's build.
      db.prepare("DELETE FROM smart_picks WHERE canon = ? AND profile = ?").run(canon, profile);
      d.bump();   // gone from the Home row on every device, not just this one
      d.forgetPickArtist(canon);   // and the picks of theirs sent to Listen later
      res.json({ ok: true, artist });
    } catch (e) {
      res.status(500).json({ error: /** @type {Error} */ (e).message });
    }
  });

  /**
   * What the Tune sheet shows; with `names` (a pick's starting artists), each one's More / Never as the server matches
   * names (canonArtist: "The Beatles" is "Beatles"), so the sheet never guesses. @param {string} profile
   * @param {unknown} [names]
   */
  const view = (profile, names) => {
    const t = d.tune(profile);
    const l = d.listened(profile);
    /** @type {Record<string, string>} */
    const states = {};
    for (const n of Array.isArray(names) ? names.slice(0, 20) : []) {
      const c = typeof n === "string" ? d.canonArtist(n) : "";
      if (c) states[n] = t.more.some((a) => a.canon === c) ? "more" : t.never.some((a) => a.canon === c) ? "never" : "none";
    }
    return { tune: { window: t.window, adventure: t.adventure, genres: t.genres, decades: t.decades,
      more: t.more.map((a) => a.name), never: t.never.map((a) => a.name) }, states,
    genres: l.genres, decades: l.decades, windows: WINDOW_LABELS, adventures: ADVENTURE_LABELS };
  };

  app.get("/api/smart-picks/tune", (/** @type {any} */ req, /** @type {any} */ res) => {
    let names = null;
    try { names = req.query && req.query.names ? JSON.parse(String(req.query.names)) : null; }
    catch (e) { return res.status(400).json({ error: "names must be a JSON list" }); }
    try { res.json(view(d.reader(req), names)); }
    catch (e) { res.status(500).json({ error: /** @type {Error} */ (e).message }); }
  });

  /**
   * Save, then rebuild the profile's picks of today when paired. @param {any} res @param {string} profile
   * @param {import("../smart-picks/tune").Tune} t @param {unknown} [names]  the pick sheet's artists, whose states the
   * answer carries
   */
  const apply = (res, profile, t, names) => {
    if (!d.saveTune(profile, t)) return res.status(500).json({ error: "Tune couldn't be saved" });
    let rebuilt = null;
    try { rebuilt = d.paired() ? rebuild(profile, { tuned: true }) : null; }
    catch (e) { return res.status(500).json({ error: "Saved, but today's picks couldn't be rebuilt: " + /** @type {Error} */ (e).message }); }
    res.json(Object.assign(view(profile, names), { ok: true, rebuilding: !!(rebuilt && rebuilt.building),
      note: !rebuilt ? "Saved. Today's picks are rebuilt once Rouen is paired with your Roon Core."
        : !rebuilt.building ? "Saved. Smart Picks is switched off, so nothing is rebuilt until it is on." : null }));
  };

  app.post("/api/smart-picks/tune", (/** @type {any} */ req, /** @type {any} */ res) => {
    const profile = ownerOr403(req, res);
    if (profile === null) return;
    /** @type {import("../smart-picks/tune").Tune} */
    let t;
    try { t = parseTune((req.body || {}).tune || {}, d.canonArtist); }
    catch (e) { return res.status(400).json({ error: /** @type {Error} */ (e).message }); }
    apply(res, profile, t);
  });

  app.post("/api/smart-picks/tune/artist", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    const profile = ownerOr403(req, res);
    if (profile === null) return;
    /** @type {import("../smart-picks/tune").Tune} */
    let t;
    try { t = withArtist(d.tune(profile), String(body.name || ""), String(body.as || ""), d.canonArtist); }
    catch (e) { return res.status(400).json({ error: /** @type {Error} */ (e).message }); }
    apply(res, profile, t, body.names);
  });

  return { rebuild };
}

module.exports = { mountSmartPicksActions };
