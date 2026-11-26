// @ts-check
"use strict";
/*
 * routes.js — profiles' routes (dev/design/profiles.md §2, §6, §9, 2.0.7-t2):
 *
 *   GET  /api/profiles                     { profiles, guest, current, colours }: this device's profile is `current`
 *   POST /api/profiles/current             { id } — this device's profile (a profile's id or "guest"), by its cookie
 *   POST /api/profiles                     { name, colour? } — a new profile
 *   POST /api/profiles/:id                 { name?, colour? } — renamed or recoloured, every field checked first
 *   POST /api/profiles/:id/remove          { moveTo } — removed, its listening and its zones moved to `moveTo`
 *   GET  /api/zone-profile?zone=           { zone, profile }: whose listening the zone counts for (§4.2)
 *   POST /api/zone-profile                 { zone, profile } — a profile's id or "guest" (no one)
 *
 * A store error that is the asker's (a name taken, no such profile) is a 400 with its words; any other a 500.
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{
 *   store: ReturnType<typeof import("./store").createProfileStore>,
 *   context: ReturnType<typeof import("./context").createProfileContext>,
 *   guest: string, listeningTables: string[],
 *   zone: (id: string) => { zone_id: string, display_name: string } | null,
 *   changed: () => void,
 * }} d
 *   listeningTables: the tables whose rows move with a removed profile's listening; zone: a zone by its id, an
 *   output's or its name (index.js); changed: plays moved (index.js playsVersion), so every screen re-reads them
 */
function mountProfiles(app, d) {
  const theirs = /no such profile|needs a name|already|always there|not one of the colours|choose the profile|zone required/;
  /** @param {any} res @param {unknown} e */
  const fail = (res, e) => {
    const msg = /** @type {Error} */ (e).message;
    res.status(theirs.test(msg) ? 400 : 500).json({ error: msg });
  };
  /** @param {any} req */
  const view = (req) => ({
    profiles: d.store.list().map((p) => ({ id: p.id, name: p.name, colour: p.colour, first: p.first })),
    guest: { id: d.guest, name: "Guest" }, current: req.profile || d.store.first().id, colours: d.store.COLOURS,
  });

  app.get("/api/profiles", (/** @type {any} */ req, /** @type {any} */ res) => {
    try { res.json(view(req)); } catch (e) { fail(res, e); }
  });

  app.post("/api/profiles/current", (/** @type {any} */ req, /** @type {any} */ res) => {
    const id = String((req.body || {}).id || "");
    try {
      if (id !== d.guest && !d.store.get(id)) return res.status(400).json({ error: "no such profile" });
      res.setHeader("Set-Cookie", d.context.cookie(id, !!req.secure));
      req.profile = id;
      res.json(view(req));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/profiles", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    try { const p = d.store.add(body.name, body.colour); res.json(Object.assign(view(req), { added: p.id })); }
    catch (e) { fail(res, e); }
  });

  app.post("/api/profiles/:id/remove", (/** @type {any} */ req, /** @type {any} */ res) => {
    try {
      d.store.remove(req.params.id, (req.body || {}).moveTo, d.listeningTables);
      d.changed();
      // This device was on it: it is on the first profile now (context.js), as every other device that was.
      if (req.profile === String(req.params.id)) req.profile = d.store.first().id;
      res.json(view(req));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/profiles/:id", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    try { d.store.update(req.params.id, { name: body.name, colour: body.colour }); res.json(view(req)); }
    catch (e) { fail(res, e); }
  });

  app.get("/api/zone-profile", (/** @type {any} */ req, /** @type {any} */ res) => {
    const z = d.zone(String(req.query.zone || ""));
    if (!z) return res.status(404).json({ error: "no such zone" });
    try { res.json({ zone: z.zone_id, profile: d.store.zoneProfile(z.zone_id) }); } catch (e) { fail(res, e); }
  });

  app.post("/api/zone-profile", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    const z = d.zone(String(body.zone || ""));
    if (!z) return res.status(404).json({ error: "no such zone" });
    try { d.store.setZoneProfile(z.zone_id, z.display_name, body.profile); res.json({ zone: z.zone_id, profile: d.store.zoneProfile(z.zone_id) }); }
    catch (e) { fail(res, e); }
  });
}

/**
 * The play routes whose success means this device started something on a zone (§4.1), and the body or query field
 * naming the zone. Kept here, beside attribution, so a new play route is added in one place.
 */
const PLAY_ROUTES = new Map([
  ["/api/play", "zone_or_output_id"], ["/api/play-track", "zone_or_output_id"], ["/api/play-multi", "zone_or_output_id"],
  ["/api/queue/play-history-next", "zone_or_output_id"], ["/api/queue/history-multi", "zone_or_output_id"],
  ["/api/play-from-here", "zone_or_output_id"], ["/api/play-unheard", "zone"], ["/api/radio", "zone"],
  ["/api/playlist/play", "zone_or_output_id"], ["/api/playlist/play-track", "zone_or_output_id"],
  ["/api/playlist/play-ordered", "zone_or_output_id"], ["/api/roon-smart/play", "zone_or_output_id"],
  ["/api/album/version-play", "zone_id"], ["/api/streaming/play", "zone_or_output_id"],
  ["/api/streaming/play-track", "zone_or_output_id"], ["/api/transfer-zone", "to_zone"],
]);

/**
 * Express middleware: when a play route answers success, the zone it named is this device's profile's until
 * attribution.js says otherwise. Before the route runs; it only listens for the answer.
 * @param {{ start: (zoneId: string, profile: string) => void }} attribution
 * @param {(id: string) => { zone_id: string } | null} zone  a zone by its id, an output's or its name
 */
function playStarts(attribution, zone) {
  return (/** @type {any} */ req, /** @type {any} */ res, /** @type {() => void} */ next) => {
    const field = req.method === "POST" ? PLAY_ROUTES.get(req.path) : undefined;
    // Radio switched off starts nothing.
    const starts = field && !(req.path === "/api/radio" && !(req.body && req.body.enabled));
    if (starts && req.profile) {
      const named = String((req.body && req.body[/** @type {string} */ (field)]) || "");
      const profile = req.profile;
      res.on("finish", () => {
        if (res.statusCode >= 300 || !named) return;
        const z = zone(named);
        if (z) attribution.start(z.zone_id, profile);
      });
    }
    next();
  };
}

module.exports = { mountProfiles, playStarts, PLAY_ROUTES };
