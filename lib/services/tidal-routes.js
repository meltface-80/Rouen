// @ts-check
"use strict";
/*
 * tidal-routes.js — the TIDAL connection in Settings and TIDAL's catalogue routes, moved out of index.js unchanged
 * in v1.9.72-t63 (dev/quality.md, step 5):
 *
 *   GET  /api/settings/tidal             → { connected, displayName }   never a token
 *   POST /api/settings/tidal/start       → { user_code, verification_uri, verification_uri_complete, expires_in }:
 *                                        the OAuth device flow, polled here until approved; 409 when a newer
 *                                        attempt superseded it, 502 when TIDAL refuses
 *   GET  /api/settings/tidal/status      → { state: "connected" | "pending" | "error" | "idle", ... }
 *   POST /api/settings/tidal/disconnect  → { ok }: the stored connection and any login in progress cleared
 *   GET  /api/tidal/new-releases?days=   → { albums, days }   newest first, days 1-365 (default 30)
 *   GET  /api/tidal/artist-albums?artist_id=&offset= → { artist, offset, limit, total, has_more, albums }
 *   GET  /api/tidal/featured?type=       → { type, albums }   400 for a type not in the list
 *
 * A catalogue failure answers { error } with the shared streaming-service status (serviceErrorStatus). index.js
 * mounts the first five, then (after the favourites, "Add to library" and the search) the last two, where it
 * registered them. The device login in progress lives here, the only place that reads it.
 */

// Tidal featured/browse categories ("new" is served by /api/tidal/new-releases).
// Albums are returned in Tidal's own order (meaningful for e.g. top), so no
// re-sorting here.
const TIDAL_FEATURED_TYPES = new Set(["top", "rising", "recommended"]);

/**
 * What the TIDAL routes use: index.js's own, by the same names (a getter for each value index.js may replace, and a
 * setter for each the routes replace), the session's, and the shared album shapes.
 * @typedef {object} TidalRouteDeps
 * @property {boolean} DEBUG
 * @property {any} tidal  lib/tidal.js, the TIDAL client
 * @property {() => string} tidalRefreshToken
 * @property {(v: string) => void} setTidalRefreshToken
 * @property {(v: string) => void} setTidalUserId
 * @property {(v: string) => void} setTidalCountryCode
 * @property {() => string} tidalDisplayName
 * @property {(v: string) => void} setTidalDisplayName
 * @property {() => string} tidalUserId
 * @property {() => string} tidalCountryCode
 * @property {(v: string) => void} setTidalAccessToken  the session's
 * @property {(v: number) => void} setTidalAccessTokenExpiry  the session's
 * @property {(fn: (token: string, countryCode: string, userId: string) => Promise<any>) => Promise<any>} tidalWithToken
 * @property {{ get: () => Promise<any>, clear: () => void }} tidalFavIds  the favourite album ids cache
 * @property {{ get: (key: any, fetchFn: () => Promise<any>) => Promise<any>, clear: () => void }} tidalFeaturedCache
 *   "groups" | "albums:<type>", 10 minutes
 * @property {(reason: string) => Promise<any>} refreshStreamAlbumKeys
 * @property {(which: string) => void} clearStreamAlbumKeys
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 * @property {(a: any) => number | null} tidalReleaseTs
 * @property {(a: any, favIds: any) => any} normalizeTidalAlbum
 * @property {(items: any[], favIds: any) => any[]} normalizeTidalAlbums
 * @property {(e: any) => number} serviceErrorStatus
 * @property {(req: any) => number} parseOffsetParam
 */

/**
 * The TIDAL routes, made once by lib/services/index.js and mounted in two calls.
 * @param {TidalRouteDeps} d
 */
function createTidalRoutes(d) {
  const { DEBUG, tidal, tidalWithToken, tidalFavIds, tidalFeaturedCache, refreshStreamAlbumKeys, clearStreamAlbumKeys,
    savePersistedSettings, tidalReleaseTs, normalizeTidalAlbum, normalizeTidalAlbums, serviceErrorStatus,
    parseOffsetParam } = d;

  // Device-flow login in progress, or null. `timer` drives the server-side poll
  // loop; `error` holds the terminal failure for GET /api/settings/tidal/status.
  /** @type {{ deviceCode: string, interval: number, expiresAt: number, netFails: number, timer: any, error: string | null } | null} */
  let tidalPendingAuth = null; // { deviceCode, interval, expiresAt, netFails, timer, error }
  let tidalAuthGen = 0; // /start generation counter — a newer login attempt supersedes an older one racing it

  // Resolve a featured group ("new", "top", …) against Tidal's live /featured
  // list — group ids aren't guaranteed stable, so match id OR name
  // case-insensitively. Returns the group object, or null when Tidal doesn't
  // currently offer it. The groups list shares the 10-min featured TTL cache.
  /** @param {string} wanted */
  async function resolveTidalFeaturedGroup(wanted) {
    const groups = await tidalFeaturedCache.get("groups", () =>
      tidalWithToken((t, cc) => tidal.getFeaturedGroups(t, cc)));
    const w = String(wanted).toLowerCase();
    // Exact id/name/path match first; fall back to a prefix match so a group
    // Tidal renames from "new" to e.g. "New albums" keeps resolving.
    for (const g of groups) {
      if (String(g.id).toLowerCase() === w || String(g.name).toLowerCase() === w ||
          String(g.path || "").toLowerCase() === w) return g;
    }
    for (const g of groups) {
      if (String(g.id).toLowerCase().startsWith(w) ||
          String(g.name).toLowerCase().startsWith(w) ||
          String(g.path || "").toLowerCase().startsWith(w)) return g;
    }
    return null;
  }

  // Raw featured items per group type (10-min TTL, see makeTtlCache) — the
  // Tidal counterpart of the Qobuz getFeaturedItemsCached (lib/routes/qobuz-releases.js). A group missing upstream
  // yields [] WITHOUT caching it: an unmatched/renamed group is re-probed on
  // the next tap instead of pinning an empty tab for 10 minutes (the groups
  // list itself is still TTL-cached, so re-probing is cheap).
  /** @param {string} type */
  async function getTidalFeaturedItemsCached(type) {
    const group = await resolveTidalFeaturedGroup(type);
    if (!group) return [];
    return tidalFeaturedCache.get("albums:" + type, () =>
      tidalWithToken((t, cc) => tidal.getFeaturedAlbums(t, cc, group.id, 150)));
  }

  /**
   * GET /api/settings/tidal, POST /api/settings/tidal/start, GET /api/settings/tidal/status,
   * POST /api/settings/tidal/disconnect and GET /api/tidal/new-releases, in that order.
   * @param {{ get: Function, post: Function }} app
   */
  function mountTidalSettings(app) {
    // Connection status (never returns tokens).
    app.get("/api/settings/tidal", (/** @type {any} */ req, /** @type {any} */ res) => {
      res.json({ connected: !!d.tidalRefreshToken(), displayName: d.tidalDisplayName() || "" });
    });

    // Start the OAuth device flow: respond immediately with the code/URL the user
    // must approve on tidal.com, then poll the token endpoint server-side until
    // approval, a terminal error, or code expiry. GET /api/settings/tidal/status
    // reports the outcome. Starting a new flow supersedes a previous pending one.
    app.post("/api/settings/tidal/start", async (/** @type {any} */ req, /** @type {any} */ res) => {
      try {
        if (tidalPendingAuth && tidalPendingAuth.timer) clearTimeout(tidalPendingAuth.timer);
        tidalPendingAuth = null;
        // Guard the gap across the await: a second /start racing this one must
        // win outright — without this, the server could poll flow A's deviceCode
        // while the UI displays flow B's user code (approval would never land).
        const gen = ++tidalAuthGen;
        const flow = await tidal.startDeviceAuth();
        if (gen !== tidalAuthGen) {
          return res.status(409).json({ ok: false, error: "superseded by a newer Tidal login attempt" });
        }
        const pending = {
          deviceCode: flow.deviceCode,
          interval:   Math.max(flow.interval, 2) * 1000,
          expiresAt:  Date.now() + flow.expiresIn * 1000,
          netFails:   0,    // consecutive network failures — a blip must not kill the login
          timer:      null,
          error:      null
        };
        tidalPendingAuth = pending;
        const poll = async () => {
          if (tidalPendingAuth !== pending) return; // superseded or cancelled
          pending.timer = null;
          try {
            if (Date.now() >= pending.expiresAt) {
              pending.error = "Login timed out — the Tidal code expired before it was approved";
              console.error("[tidal] device login expired before approval");
              return;
            }
            const r = await tidal.pollDeviceToken(pending.deviceCode);
            if (tidalPendingAuth !== pending) return; // superseded while awaiting
            if (r.pending) {
              pending.netFails = 0;
              // RFC 8628 slow_down: stretch the polling interval by 5s and keep going.
              if (r.slowDown) pending.interval += 5000;
              pending.timer = setTimeout(poll, pending.interval);
              return;
            }
            // Approved — persist the connection and prime the access token.
            d.setTidalRefreshToken(r.refreshToken);
            d.setTidalUserId(r.userId);
            d.setTidalCountryCode(r.countryCode);
            d.setTidalDisplayName(r.displayName);
            d.setTidalAccessToken(r.accessToken);
            d.setTidalAccessTokenExpiry(Date.now() + Math.max(r.expiresIn - 300, 60) * 1000);
            savePersistedSettings({ tidalRefreshToken: d.tidalRefreshToken(), tidalUserId: d.tidalUserId(),
                                    tidalCountryCode: d.tidalCountryCode(), tidalDisplayName: d.tidalDisplayName() });
            tidalFavIds.clear();       // account may have changed — drop cached favourite ids
            tidalFeaturedCache.clear();
            tidalPendingAuth = null;
            // Newly connected account — read its favourites now so Tidal badges
            // appear without waiting for the next library sync.
            refreshStreamAlbumKeys("tidal connected").catch(e => {
              if (DEBUG) console.error("[stream] refresh:", e.message);
            });
            console.log("[settings] tidal connected as " + d.tidalDisplayName());
          } catch (e) {
            if (tidalPendingAuth !== pending) return;
            // A structured OAuth error (access_denied, expired_token, …) is a
            // definitive outcome; a network blip mid-approval is not — retry up
            // to 3 consecutive times before declaring the login dead.
            if (!e.oauthError && pending.netFails < 3) {
              pending.netFails++;
              console.error("[tidal] device login poll failed (retry " + pending.netFails + "/3):", e.message);
              pending.timer = setTimeout(poll, pending.interval);
              return;
            }
            pending.error = e.message; // terminal (denied/expired code) — surfaced via /status
            console.error("[tidal] device login failed:", e.message);
          }
        };
        pending.timer = setTimeout(poll, pending.interval);
        res.json({
          user_code:                 flow.userCode,
          verification_uri:          flow.verificationUri,
          verification_uri_complete: flow.verificationUriComplete,
          expires_in:                flow.expiresIn
        });
      } catch (e) {
        res.status(502).json({ ok: false, error: e.message });
      }
    });

    // Device-flow progress for the settings UI to poll.
    app.get("/api/settings/tidal/status", (/** @type {any} */ req, /** @type {any} */ res) => {
      if (d.tidalRefreshToken()) return res.json({ state: "connected", displayName: d.tidalDisplayName() || "" });
      if (tidalPendingAuth) {
        if (tidalPendingAuth.error) return res.json({ state: "error", error: tidalPendingAuth.error });
        return res.json({ state: "pending" });
      }
      res.json({ state: "idle" });
    });

    // Disconnect: clear all stored Tidal tokens/identity and any pending login.
    app.post("/api/settings/tidal/disconnect", (/** @type {any} */ req, /** @type {any} */ res) => {
      if (tidalPendingAuth && tidalPendingAuth.timer) clearTimeout(tidalPendingAuth.timer);
      tidalPendingAuth = null;
      d.setTidalDisplayName("");
      d.setTidalUserId("");
      d.setTidalRefreshToken("");
      d.setTidalCountryCode("US");
      d.setTidalAccessToken("");
      d.setTidalAccessTokenExpiry(0);
      tidalFavIds.clear();
      tidalFeaturedCache.clear();
      clearStreamAlbumKeys("tidal");   // badges go with the account
      savePersistedSettings({ tidalRefreshToken: "", tidalUserId: "", tidalCountryCode: "US", tidalDisplayName: "" });
      res.json({ ok: true });
    });

    // New releases from the last N days (default 30), newest first — same shape
    // and windowing as /api/qobuz/new-releases.
    app.get("/api/tidal/new-releases", async (/** @type {any} */ req, /** @type {any} */ res) => {
      let days = parseInt(req.query.days, 10);
      if (!Number.isFinite(days) || days <= 0 || days > 365) days = 30;
      try {
        // Which of these are already in the user's Tidal favourites (any device).
        // Best-effort (cached): on failure the list still renders without marks.
        const [items, favIds] = await Promise.all([
          getTidalFeaturedItemsCached("new"),
          tidalFavIds.get()
        ]);
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const future = Date.now() + 2 * 24 * 60 * 60 * 1000; // tolerate a couple days' skew
        const albums = [];
        for (const a of items) {
          if (!a || a.id == null) continue;
          const ts = tidalReleaseTs(a);
          if (ts !== null && (ts < cutoff || ts > future)) continue; // outside the window
          albums.push(normalizeTidalAlbum(a, favIds));
        }
        albums.sort((x, y) => (y.released_at || 0) - (x.released_at || 0));
        res.json({ albums, days });
      } catch (e) {
        res.status(serviceErrorStatus(e)).json({ error: e.message });
      }
    });
  }

  /**
   * GET /api/tidal/artist-albums and GET /api/tidal/featured, in that order.
   * @param {{ get: Function }} app
   */
  function mountTidalCatalogue(app) {
    // A Tidal artist's discography, paged by offset. Albums stay in Tidal's own
    // order — matching /api/qobuz/artist-albums, which keeps upstream order so
    // dates don't jump around at every "Load more" seam.
    app.get("/api/tidal/artist-albums", async (/** @type {any} */ req, /** @type {any} */ res) => {
      const artistId = String(req.query.artist_id || "").trim();
      if (!artistId) return res.status(400).json({ error: "artist_id required" });
      const offset = parseOffsetParam(req);
      try {
        const [artist, page, favIds] = await Promise.all([
          tidalWithToken((t, cc) => tidal.getArtist(t, cc, artistId)),
          tidalWithToken((t, cc) => tidal.getArtistAlbums(t, cc, artistId, 50, offset)),
          tidalFavIds.get()
        ]);
        const albums = normalizeTidalAlbums(page.items, favIds);
        const hasMore = offset + page.items.length < page.total; // raw length — see /api/qobuz/search
        res.json({
          artist: {
            id:    artist.id,
            name:  artist.name,
            image: artist.picture ? tidal.coverUrl(artist.picture, "750x750") : null
          },
          offset, limit: 50, total: page.total, has_more: hasMore, albums
        });
      } catch (e) {
        res.status(serviceErrorStatus(e)).json({ error: e.message });
      }
    });

    app.get("/api/tidal/featured", async (/** @type {any} */ req, /** @type {any} */ res) => {
      const type = String(req.query.type || "").trim();
      if (!TIDAL_FEATURED_TYPES.has(type)) return res.status(400).json({ error: "invalid type" });
      try {
        const [items, favIds] = await Promise.all([
          getTidalFeaturedItemsCached(type),
          tidalFavIds.get()
        ]);
        res.json({ type, albums: normalizeTidalAlbums(items, favIds) });
      } catch (e) {
        res.status(serviceErrorStatus(e)).json({ error: e.message });
      }
    });
  }

  return { mountTidalSettings, mountTidalCatalogue };
}

module.exports = { createTidalRoutes, TIDAL_FEATURED_TYPES };
