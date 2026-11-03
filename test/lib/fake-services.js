"use strict";
// ---------------------------------------------------------------------------
// The fakes the lib/services/ tests run on (test/unit/services.test.js, services-routes.test.js): Qobuz and TIDAL
// clients that answer what each test says, the favourites caches as small objects, a timer that is
// called by hand, and the settings as a plain object behind the getters and setters index.js hands in.
// ---------------------------------------------------------------------------

const { createServices } = require("../../lib/services");

/** Runs fn with console.log/error captured; resolves to { value, out, err }. */
async function quietly(fn) {
  const out = [], err = [];
  const log = console.log, error = console.error;
  console.log = (...a) => { out.push(a.join(" ")); };
  console.error = (...a) => { err.push(a.join(" ")); };
  try { return { value: await fn(), out, err }; } finally { console.log = log; console.error = error; }
}

function deferred() { let resolve, reject; const p = new Promise((r, j) => { resolve = r; reject = j; }); return { p, resolve, reject }; }
const httpError = (code, msg) => Object.assign(new Error(msg || "HTTP " + code), { code });

/** A cache the routes clear and read through: counts its clears, and memoises what get() fetched. */
function fakeCache(name, s) {
  const m = new Map();
  return { m, clear() { m.clear(); s.cleared.push(name); }, get(key, fn) {
    if (m.has(key)) return Promise.resolve(m.get(key));
    return fn().then((v) => { m.set(key, v); return v; });
  } };
}

/** Everything index.js hands in, as fakes; `s` is the state the getters read and the setters write. */
function world(over) {
  const s = Object.assign({
    qobuzSignAppId: "", qobuzUsername: "", qobuzPasswordMd5: "", qobuzToken: "", qobuzDisplayName: "",
    qobuzWaveToken: "", qobuzWaveUser: "", qobuzWaveName: "",
    tidalRefreshToken: "", tidalUserId: "", tidalCountryCode: "US", tidalDisplayName: "",
    saved: [], cleared: [], refreshed: [], badgesCleared: [], said: new Set(), logins: [], defaultAppId: null,
    ready: false, favIds: new Set(["7"]),
  }, over);
  const qobuz = {
    APP_ID: "own-app",
    setDefaultAppId: (id) => { s.defaultAppId = id; },
    currentAppId: () => "current-app",
    login: (u, p, isMd5, appId) => { s.logins.push([u, p, isMd5, appId]); return s.login(u, p, isMd5, appId); },
    pickImage: (a) => "img:" + a.id,
  };
  const tidal = {
    refreshAccessToken: (rt) => s.refresh(rt),
    coverUrl: (c, size) => "cover:" + c + ":" + size,
    startDeviceAuth: () => s.startDeviceAuth(),
    pollDeviceToken: (code) => s.pollDeviceToken(code),
  };
  const qobuzFavIds = Object.assign(fakeCache("qobuzFavIds", s), { get: async () => s.favIds });
  const tidalFavIds = Object.assign(fakeCache("tidalFavIds", s), { get: async () => s.favIds });
  const d = {
    DEBUG: false, qobuz, tidal, QOA: { APP_ID: "oauth-app" },
    qobuzSignAppId: () => s.qobuzSignAppId,
    qobuzUsername: () => s.qobuzUsername, setQobuzUsername: (v) => { s.qobuzUsername = v; },
    qobuzPasswordMd5: () => s.qobuzPasswordMd5, setQobuzPasswordMd5: (v) => { s.qobuzPasswordMd5 = v; },
    qobuzToken: () => s.qobuzToken, setQobuzToken: (v) => { s.qobuzToken = v; },
    qobuzDisplayName: () => s.qobuzDisplayName, setQobuzDisplayName: (v) => { s.qobuzDisplayName = v; },
    qobuzWaveToken: () => s.qobuzWaveToken, setQobuzWaveToken: (v) => { s.qobuzWaveToken = v; },
    setQobuzWaveUser: (v) => { s.qobuzWaveUser = v; },
    qobuzWaveName: () => s.qobuzWaveName, setQobuzWaveName: (v) => { s.qobuzWaveName = v; },
    tidalRefreshToken: () => s.tidalRefreshToken, setTidalRefreshToken: (v) => { s.tidalRefreshToken = v; },
    tidalUserId: () => s.tidalUserId, setTidalUserId: (v) => { s.tidalUserId = v; },
    tidalCountryCode: () => s.tidalCountryCode, setTidalCountryCode: (v) => { s.tidalCountryCode = v; },
    tidalDisplayName: () => s.tidalDisplayName, setTidalDisplayName: (v) => { s.tidalDisplayName = v; },
    qobuzFavIds, tidalFavIds,
    qobuzReady: () => s.ready,
    refreshStreamAlbumKeys: async (why) => { s.refreshed.push(why); },
    clearStreamAlbumKeys: (which) => { s.badgesCleared.push(which); },
    wfQobuzSayOnce: (k, m) => { if (s.said.has(k)) return; s.said.add(k); console.log(m); }, wfQobuzSaid: s.said,
    savePersistedSettings: (p) => { s.saved.push(p); },
  };
  return { s, d };
}

/** The routes, mounted on a fake app as index.js mounts them; returns call(key, req) and the registration order. */
function mounted(w) {
  const h = {}, order = [];
  const app = { get: (p, f) => { h["GET " + p] = f; order.push("GET " + p); }, post: (p, f) => { h["POST " + p] = f; order.push("POST " + p); } };
  const sv = createServices(w.d);
  sv.mountQobuzSettings(app);
  sv.mountTidalSettings(app);
  const call = (key, req) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    h[key](Object.assign({ query: {}, body: {} }, req), res);
  });
  return { sv, call, order };
}

/** setTimeout/clearTimeout replaced by a list the test runs by hand. */
function handTimers(fn) {
  const real = { set: global.setTimeout, clear: global.clearTimeout };
  const timers = [];
  global.setTimeout = (f, ms) => { const t = { f, ms, cleared: false }; timers.push(t); return t; };
  global.clearTimeout = (t) => { if (t) t.cleared = true; };
  return Promise.resolve().then(() => fn(timers)).finally(() => { global.setTimeout = real.set; global.clearTimeout = real.clear; });
}

module.exports = { quietly, deferred, httpError, fakeCache, world, mounted, handTimers };
