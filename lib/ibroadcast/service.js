// @ts-check
"use strict";
/*
 * service.js — iBroadcast as a plugin's service (2.0.6-t1, dev/design/ibroadcast.md §3.3): the account, the library
 * read, and their routes under /api/ibroadcast. Made by the plugin host when the plugin is on (lib/plugins.js) and
 * closed when it is removed: the sign-in under way stops asking, and the library's watch ends.
 *
 *   GET  /status          { connected, user: { name }, premium, formats, since, library }, or signed out
 *                         { connected: false, pending?: { url, code, expires_at, error } }
 *   POST /signin          a code to approve on iBroadcast: the state, its pending among it
 *   POST /signin/cancel   the sign-in under way let go
 *   POST /signout         signed out, here and at iBroadcast
 *   POST /library         Read library now: the state once it is read
 *   GET  /drive           the drive (2.0.6-t2's probe, §4.4): { available, why, max, mount, albums, totals }
 *   GET  /drive/search?q= the library's albums matching q, up to 30
 *   POST /drive/albums    { ids }: the probe's albums, up to 20; the drive made again
 *   GET  /drive/report    what was read, served, refused and downloaded (§4.3)
 *
 * library is { reading, albums, tracks, lossless, bytes, at, error }. A failure is answered in iBroadcast's words with
 * its status (401: signed out, or to sign in again). Writes must be JSON, as HQPWeb's are.
 */
const { createIBroadcastAccount } = require("./account");
const { createIBroadcastLibrary } = require("./library");
const { IBroadcastError } = require("./api");
const { createIBroadcastDrive } = require("./drive");
const { createPlaying } = require("./playing");

/** How often iBroadcast is asked whether the library changed: ten minutes. */
const WATCH_MS = 10 * 60 * 1000;

/**
 * @param {{ load: () => Record<string, any>, save: (patch: Record<string, any>) => boolean, dataDir: string,
 *           version: string, base?: string | null, log?: (line: string) => void, now?: () => number,
 *           fetch?: typeof fetch, watchMs?: number, zones?: () => Record<string, any> | null,
 *           peekQueue?: (zoneId: string, count: number) => Promise<any[]>,
 *           mount?: ReturnType<typeof import("./drive-mount").createDriveMount>, holdMs?: number }} o
 *   zones, peekQueue: what Roon is playing and has queued (index.js's), for the drive's read rule
 */
function createIBroadcastService(o) {
  const log = (/** @type {string} */ line) => { (o.log || ((/** @type {string} */ l) => { console.log(l); }))("[ibroadcast] " + line); };
  /** The library, set once both are made: the account's sign-in reads it. @type {ReturnType<typeof createIBroadcastLibrary> | null} */
  let library = null;
  /** The drive, set once made: brought into line after each reading and each sign-in or out. @type {any} */
  let drive = null;
  const readLater = () => {
    if (library) library.read(true).then(() => drive && drive.sync(), (e) => { log("the library couldn't be read: " + e.message); });
  };
  const account = createIBroadcastAccount({ load: o.load, save: o.save, version: o.version, base: o.base, log, now: o.now, fetch: o.fetch,
    onSignedIn: readLater });
  library = createIBroadcastLibrary({ account, dataDir: o.dataDir, log, now: o.now });
  const lib = library;
  const playing = createPlaying({ zones: o.zones || (() => null), peekQueue: o.peekQueue, now: o.now });
  const theDrive = createIBroadcastDrive({ account, library: lib, load: o.load, save: o.save, version: o.version, log, now: o.now,
    fetch: o.fetch, mount: o.mount, holdMs: o.holdMs, wants: (t, a) => playing.wants(t, a) });
  drive = theDrive;
  // Up at once where it was before Rouen stopped (the plugin is made at Rouen's start: lib/plugins-mount.js).
  theDrive.sync();

  const watch = setInterval(() => {
    if (account.connected()) lib.read(false).then(() => theDrive.sync(), (e) => { log("the library couldn't be read: " + e.message); });
  }, o.watchMs || WATCH_MS);
  if (watch.unref) watch.unref();

  /** The state with the library's, signed in. */
  function state() {
    /** @type {Record<string, any>} */
    const s = account.status();
    if (s.connected) s.library = lib.state();
    return s;
  }

  /** @type {Record<string, (req: { query: any, body: any }) => Promise<any> | any>} */
  const ROUTES = {
    "GET /status": () => {
      // Read again from iBroadcast six hours on: the page shows what is kept meanwhile.
      account.refreshIfDue();
      return state();
    },
    "POST /signin": () => account.beginSignIn(),
    "POST /signin/cancel": () => account.cancelSignIn(),
    "POST /signout": async () => { const s = await account.signOut(); lib.forget(); await theDrive.sync(); return s; },
    "POST /library": async () => {
      if (!account.connected()) throw new IBroadcastError("Not signed in to iBroadcast", 401);
      await lib.read(true);
      await theDrive.sync();
      return state();
    },
    "GET /drive": () => theDrive.state(),
    "GET /drive/search": (/** @type {any} */ q) => theDrive.search(String((q.query && q.query.q) || "")),
    "POST /drive/albums": async (/** @type {any} */ q) => {
      if (!account.connected()) throw new IBroadcastError("Not signed in to iBroadcast", 401);
      await theDrive.choose(q.body && q.body.ids);
      return theDrive.state();
    },
    "GET /drive/report": () => theDrive.report(),
  };

  /** @param {{ method: string, path: string, headers: Record<string, any>, query?: any, body?: any }} req @returns {Promise<{ status: number, body: any }>} */
  async function dispatch(req) {
    const method = String(req.method || "GET").toUpperCase();
    if (method !== "GET" && !/^application\/json\b/i.test(String((req.headers || {})["content-type"] || ""))) {
      return { status: 415, body: { error: "expected application/json" } };
    }
    const fn = ROUTES[method + " " + String(req.path || "/")];
    if (!fn) return { status: 404, body: { error: "not found" } };
    try {
      return { status: 200, body: await fn({ query: req.query || {}, body: req.body || {} }) };
    } catch (e) {
      const status = e instanceof IBroadcastError ? e.status : 500;
      /** @type {Record<string, any>} */
      const body = { error: String((e && /** @type {any} */ (e).message) || e) };
      if (status === 401) body.connected = false;
      return { status, body };
    }
  }

  return {
    dispatch,
    account,
    library: lib,
    drive: theDrive,
    /** @param {{ use: Function }} app */
    mount(app) {
      app.use("/api/ibroadcast", (/** @type {any} */ req, /** @type {any} */ res) => {
        res.set("Cache-Control", "no-store");
        dispatch({ method: req.method, path: req.path, headers: req.headers, query: req.query, body: req.body })
          .then((r) => { if (!res.headersSent) res.status(r.status).json(r.body); });
      });
    },
    /** The plugin removed: nothing of it asks iBroadcast again. */
    close() { clearInterval(watch); account.close(); return theDrive.close(); },
  };
}

module.exports = { createIBroadcastService, WATCH_MS };
