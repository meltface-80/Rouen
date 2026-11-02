// @ts-check
"use strict";
/*
 * lib/services — the Qobuz and TIDAL sessions and their HTTP routes, moved out of index.js unchanged in v1.9.72-t63
 * (dev/quality.md, step 5):
 *
 *   qobuz-session.js  which token a Qobuz call goes out under, the re-login behind it, and the token minted under
 *                     the signing app_id (the streaming waveform's, read and forgotten by lib/wave/ through here)
 *   tidal-session.js  the TIDAL access token minted from the stored refresh token, and the 401 retry
 *   albums.js         the service-generic album shape, release timestamps, the error status and the offset param
 *   qobuz-routes.js   GET and POST /api/settings/qobuz, POST /api/settings/qobuz/disconnect
 *   tidal-routes.js   the TIDAL connection in Settings (the device login), its new releases, an artist's albums
 *                     and the featured lists
 *
 * index.js keeps every stored credential (the Qobuz login, its password hash and the sign-in; the TIDAL refresh
 * token, user, country and name), the favourites and featured caches, qobuzReady/tidalReady, the stream badges and
 * the said-once log, and wires them here (createServices). A value index.js may replace is handed in as a getter,
 * read where the code read the variable; one these set comes with a setter that does the same assignment. The
 * other Qobuz/TIDAL routes (lib/routes/qobuz-releases.js, service-favourites.js, service-search.js and
 * lib/library-add.js) are mounted by index.js between these, in the order they always were.
 */
const { createQobuzSession } = require("./qobuz-session");
const { createTidalSession } = require("./tidal-session");
const { serviceErrorStatus, parseOffsetParam, createAlbumShapes } = require("./albums");
const { mountQobuzSettings } = require("./qobuz-routes");
const { createTidalRoutes } = require("./tidal-routes");

/**
 * What the services use: index.js's own, by the same names (a getter for each value index.js may replace, a setter
 * for each one these replace).
 * @typedef {object} ServicesDeps
 * @property {boolean} DEBUG
 * @property {any} qobuz  lib/qobuz.js, the Qobuz client
 * @property {any} tidal  lib/tidal.js, the TIDAL client
 * @property {{ APP_ID: string }} QOA  lib/qobuz-oauth.js: the built-in sign-in's app
 * @property {() => string} qobuzSignAppId  the app_id of the pasted secret (the older route)
 * @property {() => string} qobuzUsername
 * @property {(v: string) => void} setQobuzUsername
 * @property {() => string} qobuzPasswordMd5
 * @property {(v: string) => void} setQobuzPasswordMd5
 * @property {() => string} qobuzToken  this app's own (legacy) login token
 * @property {(v: string) => void} setQobuzToken
 * @property {() => string} qobuzDisplayName
 * @property {(v: string) => void} setQobuzDisplayName
 * @property {() => string} qobuzWaveToken  the browser sign-in's token
 * @property {(v: string) => void} setQobuzWaveToken
 * @property {(v: string) => void} setQobuzWaveUser
 * @property {() => string} qobuzWaveName
 * @property {(v: string) => void} setQobuzWaveName
 * @property {() => string} tidalRefreshToken
 * @property {(v: string) => void} setTidalRefreshToken
 * @property {() => string} tidalUserId
 * @property {(v: string) => void} setTidalUserId
 * @property {() => string} tidalCountryCode
 * @property {(v: string) => void} setTidalCountryCode
 * @property {() => string} tidalDisplayName
 * @property {(v: string) => void} setTidalDisplayName
 * @property {{ get: () => Promise<any>, clear: () => void }} qobuzFavIds  the favourite album ids cache
 * @property {{ get: (key: any, fetchFn: () => Promise<any>) => Promise<any>, clear: () => void }} qobuzFeaturedCache
 * @property {{ get: () => Promise<any>, clear: () => void }} tidalFavIds
 * @property {{ get: (key: any, fetchFn: () => Promise<any>) => Promise<any>, clear: () => void }} tidalFeaturedCache
 * @property {() => boolean} qobuzReady
 * @property {(reason: string) => Promise<any>} refreshStreamAlbumKeys
 * @property {(which: string) => void} clearStreamAlbumKeys
 * @property {(key: string, msg: string) => void} wfQobuzSayOnce  the streaming waveform's said-once log
 * @property {Set<string>} wfQobuzSaid  what wfQobuzSayOnce has said, forgotten with the Qobuz account
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 */

/**
 * The Qobuz and TIDAL sessions and routes, wired once by index.js.
 * @param {ServicesDeps} d
 */
function createServices(d) {
  const qobuzSession = createQobuzSession(d);
  const tidalSession = createTidalSession(d);
  const shapes = createAlbumShapes(d);
  const tidalRoutes = createTidalRoutes({ ...d, ...tidalSession, ...shapes, serviceErrorStatus, parseOffsetParam });
  return {
    ...qobuzSession, ...tidalSession, ...shapes, serviceErrorStatus, parseOffsetParam,
    /**
     * GET and POST /api/settings/qobuz and POST /api/settings/qobuz/disconnect, in that order.
     * @param {{ get: Function, post: Function }} app
     */
    mountQobuzSettings(app) { mountQobuzSettings(app, { ...d, qobuzSyncAppId: qobuzSession.qobuzSyncAppId }); },
    /**
     * The TIDAL connection's four routes and GET /api/tidal/new-releases, in that order.
     * @param {{ get: Function, post: Function }} app
     */
    mountTidalSettings: tidalRoutes.mountTidalSettings,
    /**
     * GET /api/tidal/artist-albums and GET /api/tidal/featured, in that order.
     * @param {{ get: Function }} app
     */
    mountTidalCatalogue: tidalRoutes.mountTidalCatalogue,
  };
}

module.exports = { createServices };
