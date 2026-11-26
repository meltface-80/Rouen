// @ts-check
"use strict";
/*
 * routes.js — profiles' routes (dev/design/profiles.md §2, §6, §9, 2.0.7-t2):
 *
 *   GET  /api/profiles                     { profiles, guest, current, colours }: this device's profile is `current`
 *   POST /api/profiles/current             { id } — this device's profile (a profile's id or "guest"), by its cookie
 *   POST /api/profiles                     { name, colour? } — a new profile
 *   POST /api/profiles/:id                 { name?, colour?, roonProfile? } — renamed, recoloured, or linked to one of
 *                                          the Roon server's profiles (null: none, native mode's choice; §5, 2.0.7-t4)
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
 *   changed: () => void, removed: (id: string, to: string) => void, movers?: Array<(db: any, from: string, to: string) => void>,
 *   roonProfiles?: () => { profiles: Array<{ id: string, name: string }>, reread?: () => void } | null,
 *   sync?: ReturnType<typeof import("./roon-sync").createRoonSync>,
 * }} d
 *   listeningTables: the tables whose rows move with a removed profile's listening; zone: a zone by its id, an
 *   output's or its name (index.js); changed: plays moved (index.js playsVersion), so every screen re-reads them;
 *   removed: a profile gone (attribution.js forgets every zone it held); roonProfiles: the Roon server's profiles, and
 *   a read of them again, while native mode is in use, else null; sync: Rouen's profiles kept with Roon's (§13.2)
 */
function mountProfiles(app, d) {
  const theirs = /no such profile|needs a name|already|always in the list|not one of the colours|choose the profile|zone required|not one of your server's profiles|already paired with/;
  /** @param {any} res @param {unknown} e */
  const fail = (res, e) => {
    const msg = /** @type {Error} */ (e).message;
    res.status(theirs.test(msg) ? 400 : 500).json({ error: msg });
  };
  /** @param {any} req */
  const view = (req) => {
    const roon = d.roonProfiles ? d.roonProfiles() : null;
    return {
      profiles: d.store.list().map((p) => ({ id: p.id, name: p.name, colour: p.colour, first: p.first, roonProfile: p.roon_profile,
        roonState: d.sync ? d.sync.stateOf(p, roon) : null })),
      guest: { id: d.guest, name: "Guest" }, current: req.profile || d.store.first().id, colours: d.store.COLOURS,
      roon: roon ? { profiles: roon.profiles } : null, pairing: d.sync ? d.sync.pairingOpen() : false,
    };
  };

  app.get("/api/profiles", (/** @type {any} */ req, /** @type {any} */ res) => {
    // Roon's profiles no Rouen profile is paired with show up here as Rouen profiles (§13.2), once the pairing is done.
    // The sync never stops the page (roon-sync.js says in the log what it couldn't add).
    try { if (d.sync) d.sync.sync(); } catch (e) { console.error("[profiles] " + /** @type {Error} */ (e).message); }
    try { res.json(view(req)); } catch (e) { fail(res, e); }
  });

  // "Read Roon's profiles again" (§13.2): one reconnect, as the nightly one; the list is read on the new connection.
  app.post("/api/profiles/roon-reread", (/** @type {any} */ req, /** @type {any} */ res) => {
    const roon = d.roonProfiles ? d.roonProfiles() : null;
    if (!roon || !roon.reread) return res.status(409).json({ error: "Native mode isn't connected to your server right now." });
    roon.reread();
    res.json({ rereading: true });
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
      const gone = d.store.get(req.params.id);
      const to = d.store.remove(req.params.id, (req.body || {}).moveTo, d.listeningTables, d.movers);
      // Removed: its Roon profile is not added back by the next read (§13.3, Rouen only); a removal refused hides nothing.
      if (d.sync && gone) d.sync.removed(gone.roon_profile);
      d.removed(String(req.params.id), to.id);
      d.changed();
      // This device was on it: it is on the first profile now (context.js), as every other device that was.
      if (req.profile === String(req.params.id)) req.profile = d.store.first().id;
      res.json(view(req));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/profiles/:id", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    try {
      const linking = body.roonProfile !== undefined;
      // Only a profile your server has: its list as native mode last read it. Checked before anything is written; the
      // name and colour are checked by update() before it writes, and the link written last, so a refusal writes nothing.
      const want = !linking || body.roonProfile === null || body.roonProfile === "" ? null : String(body.roonProfile).toLowerCase();
      const roon = want !== null && d.roonProfiles ? d.roonProfiles() : null;
      if (want !== null && !(roon && roon.profiles.some((p) => p.id === want))) throw new Error("not one of your server's profiles");
      if (linking && d.sync) d.sync.check(String(req.params.id), want);
      if (body.name !== undefined || body.colour !== undefined) d.store.update(req.params.id, { name: body.name, colour: body.colour });
      if (linking) { if (d.sync) d.sync.pair(String(req.params.id), want); else d.store.setRoon(req.params.id, want); }
      res.json(view(req));
    } catch (e) { fail(res, e); }
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
 * The play routes that start something on a zone (§4.1), and the body field naming the zone. Kept here, beside
 * attribution, so a new play route is added in one place. Queueing (`kind` "queue" or "play_next", and the queue
 * history's routes, which only queue) starts nothing: it is the listener's queue, not a new listener.
 */
const PLAY_ROUTES = new Map([
  ["/api/play", "zone_or_output_id"], ["/api/play-track", "zone_or_output_id"], ["/api/play-multi", "zone_or_output_id"],
  ["/api/play-from-here", "zone_or_output_id"], ["/api/play-unheard", "zone"], ["/api/radio", "zone"],
  ["/api/playlist/play", "zone_or_output_id"], ["/api/playlist/play-track", "zone_or_output_id"],
  ["/api/playlist/play-ordered", "zone_or_output_id"], ["/api/roon-smart/play", "zone_or_output_id"],
  ["/api/album/version-play", "zone_id"], ["/api/streaming/play", "zone_or_output_id"],
  ["/api/streaming/play-track", "zone_or_output_id"], ["/api/transfer-zone", "to_zone"],
]);

/** The answers that say a play route refused before acting: the claim is given back. */
const REFUSED = new Set([400, 401, 403, 404, 503]);

/**
 * Express middleware: a play route's zone is this device's profile's from before the route acts, so the first track it
 * starts is already counted for it (the routes that wait for the zone to show the track answer after it began), until
 * attribution.js says otherwise; given back when the route refuses.
 * @param {{ start: (zoneId: string, profile: string) => any, undo: (zoneId: string, before: any) => void }} attribution
 * @param {(id: string) => { zone_id: string } | null} zone  a zone by its id, an output's or its name
 */
function playStarts(attribution, zone) {
  return (/** @type {any} */ req, /** @type {any} */ res, /** @type {() => void} */ next) => {
    const field = req.method === "POST" ? PLAY_ROUTES.get(req.path) : undefined;
    const body = req.body || {};
    // Radio switched off, and queueing, start nothing (Play now and a playlist's Shuffle take the zone over).
    const starts = field && !(req.path === "/api/radio" && !body.enabled) && body.kind !== "queue" && body.kind !== "play_next";
    const z = starts && req.profile ? zone(String(body[/** @type {string} */ (field)] || "")) : null;
    if (z) {
      const before = attribution.start(z.zone_id, req.profile);
      res.on("finish", () => { if (REFUSED.has(res.statusCode)) attribution.undo(z.zone_id, before); });
    }
    next();
  };
}

module.exports = { mountProfiles, playStarts, PLAY_ROUTES };
