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
 *   roonProfiles?: () => RoonSide,
 *   sync?: ReturnType<typeof import("./roon-sync").createRoonSync>,
 * }} d
 *   listeningTables: the tables whose rows move with a removed profile's listening; zone: a zone by its id, an
 *   output's or its name (index.js); changed: plays moved (index.js playsVersion), so every screen re-reads them;
 *   removed: a profile gone (attribution.js forgets every zone it held); roonProfiles: the Roon server's profiles, and
 *   a read of them again, while native mode is in use, else null; sync: Rouen's profiles kept with Roon's (§13.2)
 */
/**
 * Native mode's side of the profiles (profiles.md §13.2): the server's, a read of them again, and (P3b) one made and
 * renamed; null while native mode isn't in use.
 * @typedef {{ profiles: Array<{ id: string, name: string }>, former?: string | null, reread?: () => void,
 *   create?: (name: string) => Promise<{ id: string, name: string } | { notSent: string } | { error: string }>,
 *   rename?: (id: string, name: string) => Promise<{ ok: true } | { notSent: string } | { error: string }> } | null} RoonSide
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
      roon: roon ? { profiles: roon.profiles } : null,
    };
  };

  app.get("/api/profiles", (/** @type {any} */ req, /** @type {any} */ res) => {
    // Every profile a Roon profile (§13.2): Roon's others show up here as Rouen profiles, and a Rouen profile with none is
    // paired with Roon's of its name or made there, in the background (the page answers now; a later read shows it).
    // Neither stops the page (roon-sync.js says in the log what it couldn't do).
    try { if (d.sync) d.sync.sync(); } catch (e) { console.error("[profiles] " + /** @type {Error} */ (e).message); }
    if (d.sync) d.sync.adopt().catch((e) => console.error("[profiles] " + /** @type {Error} */ (e).message));
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

  /**
   * Roon asked first (§13.2, P3b: "A Rouen profile becomes a Roon profile"): made there, or why not. Only asked when native
   * mode is in use; the route answers at once otherwise (the profile is made in Rouen, and paired once it can be).
   * @param {string} name @returns {Promise<{ id: string } | { error: string, status: number }>}
   */
  const madeInRoon = async (name) => {
    const roon = /** @type {RoonSide} */ (d.roonProfiles ? d.roonProfiles() : null);
    const r = roon && roon.create ? await roon.create(name) : { notSent: "Native mode isn't connected to your server right now." };
    return "id" in r ? { id: r.id } : { error: "notSent" in r ? r.notSent : r.error, status: "notSent" in r ? 409 : 502 };
  };
  /** Whether Roon can be asked to make a profile now. */
  const canMake = () => { const roon = /** @type {RoonSide} */ (d.roonProfiles ? d.roonProfiles() : null); return !!(roon && roon.create); };

  app.post("/api/profiles", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    /** @type {string} */
    let name;
    try {
      name = d.store.checkedName(body.name, null);
      if (body.colour !== undefined && !d.store.COLOURS.includes(String(body.colour))) throw new Error("not one of the colours");
    } catch (e) { return fail(res, e); }
    /** @param {{ id: string } | { error: string, status: number } | null} made */
    const add = (made) => {
      try {
        if (made && "error" in made) return res.status(made.status).json({ error: made.error });
        const roonId = made && "id" in made ? made.id : null;
        const p = d.store.add(name, body.colour);
        if (roonId && d.sync) d.sync.pair(p.id, roonId);
        res.json(Object.assign(view(req), { added: p.id, inRoon: !!made }));
      } catch (e) { fail(res, e); }
    };
    if (!canMake()) return add(null);
    return madeInRoon(name).then(add, (e) => fail(res, e));
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
    const id = String(req.params.id);
    const linking = body.roonProfile !== undefined;
    // Only a profile your server has, as native mode last read it, or "create" (P3b: made in Roon under the profile's
    // name). Everything is checked before anything is written, Roon's answer included, so a refusal writes nothing; the
    // pairing is written last.
    let want = !linking || body.roonProfile === null || body.roonProfile === "" ? null : String(body.roonProfile).toLowerCase();
    const roon = /** @type {RoonSide} */ (d.roonProfiles ? d.roonProfiles() : null);
    /** @type {any} */
    let p;
    /** @type {string} */
    let name;
    try {
      p = d.store.get(id);
      if (!p) throw new Error("no such profile");
      name = body.name === undefined ? p.name : d.store.checkedName(body.name, id);
      if (body.colour !== undefined && !d.store.COLOURS.includes(String(body.colour))) throw new Error("not one of the colours");
      if (want === "create" && !canMake()) throw new Error("not one of your server's profiles");   // nothing to make it on
      if (want !== null && want !== "create" && !(roon && roon.profiles.some((r) => r.id === want))) throw new Error("not one of your server's profiles");
      if (linking && want !== "create" && d.sync) d.sync.check(id, want);
    } catch (e) { return fail(res, e); }
    const write = () => {
      try {
        if (body.name !== undefined || body.colour !== undefined) d.store.update(id, { name: body.name, colour: body.colour });
        if (linking) { if (d.sync) d.sync.pair(id, want); else d.store.setRoon(id, want); }
        res.json(view(req));
      } catch (e) { fail(res, e); }
    };
    /** @param {{ ok?: true, notSent?: string, error?: string }} r */
    const refused = (r) => res.status(r.notSent ? 409 : 502).json({ error: r.notSent || r.error });
    if (want === "create") {
      return madeInRoon(name).then((made) => {
        if ("error" in made) return res.status(made.status).json({ error: made.error });
        want = made.id;
        write();
      }, (e) => fail(res, e));
    }
    // Renamed: in Roon too, first, when paired with a Roon profile your server has (§13.2: a rename made here shows there).
    const paired = p.roon_profile && roon && roon.rename && roon.profiles.some((r) => r.id === p.roon_profile) ? p.roon_profile : null;
    if (body.name !== undefined && name !== p.name && paired && roon && roon.rename) {
      return roon.rename(paired, name).then((r) => ("ok" in r ? write() : refused(r)), (e) => fail(res, e));
    }
    write();
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
