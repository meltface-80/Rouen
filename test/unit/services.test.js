"use strict";
// ---------------------------------------------------------------------------
// The Qobuz and TIDAL sessions (lib/services/), moved out of index.js unchanged in v1.9.72-t63.
//
// Everything runs on fakes (test/lib/fake-services.js) — no network, no Core, no service. What is pinned is what the
// move must not change: which token a call goes out under and when it logs in again, the backoffs and the single
// flights, what is cleared and saved when a connection is refused, the minted signing token living in one place,
// and the album shape every service route shares. The routes and the wiring: services-routes.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServices } = require("../../lib/services");
const { serviceErrorStatus } = require("../../lib/services/albums");
const { quietly, deferred, httpError, world } = require("../lib/fake-services");

// ----------------------------- the Qobuz session -----------------------------

test("qobuz: the sign-in's token is the session; nothing stored is 'not connected'", async () => {
  const w = world({ qobuzWaveToken: "wave", qobuzToken: "own" });
  const sv = createServices(w.d);
  assert.equal(await sv.qobuzWithToken(async (t) => t), "wave");
  w.s.qobuzWaveToken = "";
  assert.equal(await sv.qobuzWithToken(async (t) => t), "own");
  w.s.qobuzToken = "";
  await assert.rejects(sv.qobuzWithToken(async (t) => t), /^Error: Qobuz not connected — connect Qobuz in Settings$/);
  assert.deepEqual(w.s.logins, []);
});

test("qobuz: a stored login with no token logs in first, once for concurrent callers, and saves what it got", async () => {
  const w = world({ qobuzUsername: "u", qobuzPasswordMd5: "md5" });
  const gate = deferred();
  w.s.login = () => gate.p;
  const sv = createServices(w.d);
  const a = sv.qobuzWithToken(async (t) => "a:" + t), b = sv.qobuzWithToken(async (t) => "b:" + t);
  gate.resolve({ token: "fresh", displayName: "Lew" });
  assert.deepEqual(await Promise.all([a, b]), ["a:fresh", "b:fresh"]);
  assert.deepEqual(w.s.logins, [["u", "md5", true, undefined]]);
  assert.equal(w.s.qobuzToken, "fresh");
  assert.equal(w.s.qobuzDisplayName, "Lew");
  assert.deepEqual(w.s.saved, [{ qobuzToken: "fresh", qobuzDisplayName: "Lew" }]);
});

test("qobuz: a failed re-login is refused for 60 s without asking Qobuz again", async () => {
  const w = world({ qobuzUsername: "u", qobuzPasswordMd5: "md5" });
  w.s.login = async () => { throw new Error("bad password"); };
  const sv = createServices(w.d);
  await assert.rejects(sv.qobuzWithToken(async (t) => t), /bad password/);
  await assert.rejects(sv.qobuzWithToken(async (t) => t), /^Error: Qobuz not connected — recent login attempt failed, retrying shortly$/);
  assert.equal(w.s.logins.length, 1);
  assert.equal(serviceErrorStatus(await sv.qobuzWithToken(async (t) => t).catch((e) => e)), 400);
});

test("qobuz: a 401 under the password token logs in again and retries with the new token", async () => {
  const w = world({ qobuzUsername: "u", qobuzPasswordMd5: "md5", qobuzToken: "stale" });
  w.s.login = async () => ({ token: "renewed", displayName: "Lew" });
  const sv = createServices(w.d);
  const seen = [];
  const r = await sv.qobuzWithToken(async (t) => { seen.push(t); if (t === "stale") throw httpError(401); return "ok:" + t; });
  assert.equal(r, "ok:renewed");
  assert.deepEqual(seen, ["stale", "renewed"]);
  // Not a 401: passed on, no login.
  await assert.rejects(sv.qobuzWithToken(async () => { throw httpError(500, "boom"); }), /boom/);
  assert.equal(w.s.logins.length, 1);
});

test("qobuz: a 401 under the sign-in's token is said and passed on, never papered over with a re-login", async () => {
  const w = world({ qobuzWaveToken: "wave", qobuzUsername: "u", qobuzPasswordMd5: "md5" });
  const sv = createServices(w.d);
  const { out } = await quietly(() => assert.rejects(sv.qobuzWithToken(async () => { throw httpError(401); }), (e) => e.code === 401));
  assert.deepEqual(out, ["[qobuz] refused (401) under the sign-in's app current-app. If a screen is empty because of this, it needs reporting."]);
  assert.deepEqual(w.s.logins, []);
});

test("qobuz: the default app_id follows the sign-in", () => {
  const w = world({ qobuzWaveToken: "wave" });
  const sv = createServices(w.d);
  sv.qobuzSyncAppId();
  assert.equal(w.s.defaultAppId, "oauth-app");
  w.s.qobuzWaveToken = "";
  sv.qobuzSyncAppId();
  assert.equal(w.s.defaultAppId, "own-app");
});

test("qobuz signing token: none without an app, said once without a login, minted once, then kept", async () => {
  const w = world();
  w.s.login = async (u, p, md5, appId) => ({ token: "tok-" + appId });
  const sv = createServices(w.d);
  assert.equal(await sv.qobuzSigningToken(), null);
  w.s.qobuzSignAppId = " 123 ";
  const said = await quietly(async () => [await sv.qobuzSigningToken(), await sv.qobuzSigningToken()]);
  assert.deepEqual(said.value, [null, null]);
  assert.equal(said.out.length, 1);
  assert.match(said.out[0], /^\[waveform\] qobuz: a signing app_id is set but this app has no stored Qobuz username\/password/);
  w.s.qobuzUsername = "u"; w.s.qobuzPasswordMd5 = "md5";
  const minted = await quietly(async () => Promise.all([sv.qobuzSigningToken(), sv.qobuzSigningToken()]));
  assert.deepEqual(minted.value, ["tok-123", "tok-123"]);
  assert.deepEqual(minted.out, ["[waveform] qobuz: minted a signing token under app 123"]);
  assert.deepEqual(w.s.logins, [["u", "md5", true, "123"]]);
  assert.equal(await sv.qobuzSigningToken(), "tok-123");
  assert.deepEqual(sv.qobuzSignTok(), { appId: "123", token: "tok-123" });
  assert.equal(w.s.logins.length, 1, "a kept token is not minted again");
});

test("qobuz signing token: a failed mint is said and backed off for 60 s", async () => {
  const w = world({ qobuzSignAppId: "9", qobuzUsername: "u", qobuzPasswordMd5: "md5" });
  w.s.login = async () => { throw new Error("refused"); };
  const sv = createServices(w.d);
  const { value, out } = await quietly(async () => [await sv.qobuzSigningToken(), await sv.qobuzSigningToken()]);
  assert.deepEqual(value, [null, null]);
  assert.deepEqual(out, ["[waveform] qobuz: could not mint a token under app 9 — refused"]);
  assert.equal(w.s.logins.length, 1);
});

test("qobuz signing token: lib/wave's getter and setters reach the same state qobuzSigningToken keeps", async () => {
  const w = world({ qobuzSignAppId: "9", qobuzUsername: "u", qobuzPasswordMd5: "md5" });
  w.s.login = async (u, p, md5, appId) => ({ token: "minted-" + appId });
  const sv = createServices(w.d);
  assert.equal(sv.qobuzSignTok(), null);
  sv.setQobuzSignTok({ appId: "9", token: "handed" });
  assert.equal(await sv.qobuzSigningToken(), "handed", "setQobuzSignTok does not set the token the session hands out");
  // Forgotten (as lib/wave does when Qobuz refuses it) inside the backoff: nothing is minted.
  sv.setQobuzSignTok(null);
  sv.setQobuzSignTokAt(Date.now());
  assert.equal(await sv.qobuzSigningToken(), null, "setQobuzSignTokAt does not set the session's backoff");
  assert.deepEqual(w.s.logins, []);
  // The backoff zeroed (a new signing pair): minted at once, and the getter sees it.
  sv.setQobuzSignTokAt(0);
  const { value } = await quietly(() => sv.qobuzSigningToken());
  assert.equal(value, "minted-9");
  assert.deepEqual(sv.qobuzSignTok(), { appId: "9", token: "minted-9" });
});

// ----------------------------- the TIDAL session -----------------------------

test("tidal: not connected without a refresh token; one refresh shared, kept until 5 minutes before it expires", async () => {
  const w = world();
  const sv = createServices(w.d);
  await assert.rejects(sv.tidalWithToken(async (t) => t), /^Error: Tidal not connected — connect your Tidal account in Settings$/);
  Object.assign(w.s, { tidalRefreshToken: "rt", tidalUserId: "u1", tidalCountryCode: "GB" });
  let refreshes = 0;
  const gate = deferred();
  w.s.refresh = (rt) => { refreshes++; assert.equal(rt, "rt"); return gate.p; };
  const a = sv.tidalWithToken(async (t, cc, uid) => [t, cc, uid]), b = sv.tidalWithToken(async (t) => t);
  gate.resolve({ accessToken: "at1", expiresIn: 3600 });
  assert.deepEqual(await Promise.all([a, b]), [["at1", "GB", "u1"], "at1"]);
  assert.equal(await sv.tidalWithToken(async (t) => t), "at1");
  assert.equal(refreshes, 1);
  assert.deepEqual(w.s.saved, [], "an unrotated refresh token is not saved");
  // An access token inside its last 5 minutes is refreshed (expiresIn 300 → kept at least 60 s, then refreshed).
  const w2 = world({ tidalRefreshToken: "rt" });
  let n = 0;
  w2.s.refresh = async () => ({ accessToken: "at" + (++n), expiresIn: 200 });
  const sv2 = createServices(w2.d);
  assert.equal(await sv2.tidalWithToken(async (t) => t), "at1");
  assert.equal(await sv2.tidalWithToken(async (t) => t), "at1", "kept for the 60 s floor");
});

test("tidal: a rotated refresh token is saved; a 401 on a call refreshes once and retries", async () => {
  const w = world({ tidalRefreshToken: "rt", tidalUserId: "u1" });
  let n = 0;
  w.s.refresh = async () => ({ accessToken: "at" + (++n), expiresIn: 3600, refreshToken: "rt2" });
  const sv = createServices(w.d);
  const seen = [];
  const r = await sv.tidalWithToken(async (t) => { seen.push(t); if (t === "at1") throw httpError(401); return "ok:" + t; });
  assert.equal(r, "ok:at2");
  assert.deepEqual(seen, ["at1", "at2"]);
  assert.equal(w.s.tidalRefreshToken, "rt2");
  assert.deepEqual(w.s.saved, [{ tidalRefreshToken: "rt2" }]);
});

test("tidal: a refused refresh token clears the stored connection and says 'not connected'", async () => {
  const w = world({ tidalRefreshToken: "rt", tidalUserId: "u1", tidalDisplayName: "Lew", tidalCountryCode: "GB" });
  w.s.refresh = async () => { throw httpError(401, "invalid_grant"); };
  const sv = createServices(w.d);
  const { err } = await quietly(() => assert.rejects(sv.tidalWithToken(async (t) => t), /^Error: Tidal not connected — connect your Tidal account in Settings$/));
  assert.deepEqual(err, ["[tidal] refresh token rejected — clearing stored connection"]);
  assert.deepEqual([w.s.tidalRefreshToken, w.s.tidalUserId, w.s.tidalDisplayName, w.s.tidalCountryCode], ["", "", "", "GB"]);
  assert.deepEqual(w.s.cleared, ["tidalFavIds"]);
  assert.deepEqual(w.s.saved, [{ tidalRefreshToken: "", tidalUserId: "", tidalDisplayName: "" }]);
  // Disconnected while the exchange was in flight: the fresh token is not installed.
  const w2 = world({ tidalRefreshToken: "rt" });
  const gate = deferred();
  w2.s.refresh = () => gate.p;
  const sv2 = createServices(w2.d);
  const p = sv2.tidalWithToken(async (t) => t);
  w2.s.tidalRefreshToken = "";
  gate.resolve({ accessToken: "late", expiresIn: 3600 });
  await assert.rejects(p, /Tidal not connected/);
});

// ----------------------------- the shared album shapes -----------------------------

test("albums: the status a service failure answers, and the one album shape for both services", () => {
  assert.equal(serviceErrorStatus(httpError(429)), 429);
  assert.equal(serviceErrorStatus(new Error("Tidal not connected — x")), 400);
  assert.equal(serviceErrorStatus(new Error("upstream")), 502);
  const sv = createServices(world().d);
  const fav = new Set(["2"]);
  assert.deepEqual(sv.normalizeQobuzAlbums([null, { title: "no id" }, { id: 2, title: "T", performer: { name: "P" },
    released_at: 1000, release_date_original: "2001-01-01" }], fav), [{ id: "2", title: "T", version: null, artist: "P",
    artist_id: null, image: "img:2", released_at: 1000000, release_date: "2001-01-01", favourited: true }]);
  assert.equal(sv.qobuzReleaseTs({ release_date_stream: "2020-05-01" }), Date.parse("2020-05-01"));
  assert.equal(sv.qobuzReleaseTs({}), null);
  assert.deepEqual(sv.normalizeTidalAlbums([{ id: 0, title: "Zero", artists: [{ id: 4, name: "A" }], cover: "c",
    releaseDate: "2020-01-02" }, { title: "no id" }], new Set()), [{ id: "0", title: "Zero", version: null, artist: "A",
    artist_id: "4", image: "cover:c:640x640", released_at: Date.parse("2020-01-02"), release_date: "2020-01-02",
    favourited: false }]);
  assert.equal(sv.tidalReleaseTs({ releaseDate: "nope" }), null);
});
