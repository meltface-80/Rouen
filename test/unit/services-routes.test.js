"use strict";
// ---------------------------------------------------------------------------
// The Qobuz and TIDAL routes (lib/services/), moved out of index.js unchanged in v1.9.72-t63, and their wiring.
//
// Everything runs on fakes (test/lib/fake-services.js) — no network, no Core, no service. What is pinned is what the
// move must not change: what is cleared and saved on a connect and a disconnect, the device login, what each route
// answers, the order the routes register in, and that index.js hands each getter and setter the variable of its
// own name. The sessions themselves: services.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { indexSource } = require("../lib/extract");
const { quietly, deferred, world, mounted, handTimers } = require("../lib/fake-services");

// ----------------------------- the routes -----------------------------

test("qobuz settings: the status never carries a credential; connect saves and clears; a refusal is a 502", async () => {
  const w = world({ ready: true, qobuzWaveToken: "wave", qobuzUsername: "me@x", qobuzDisplayName: "Old", qobuzWaveName: "" });
  const { call } = mounted(w);
  assert.deepEqual((await call("GET /api/settings/qobuz")).body, { connected: true, signed_in: true, username: "me@x", displayName: "Old" });
  w.s.qobuzWaveName = "Wave name";
  assert.equal((await call("GET /api/settings/qobuz")).body.displayName, "Wave name");
  assert.deepEqual(await call("POST /api/settings/qobuz", { body: { username: " ", password: "p" } }),
    { code: 400, body: { ok: false, error: "username and password required" } });
  w.s.login = async (u, p) => ({ token: "t", displayName: "Lew", passwordMd5: "md5:" + p });
  const { value, out } = await quietly(() => call("POST /api/settings/qobuz", { body: { username: " me@y ", password: "pw" } }));
  assert.deepEqual(value, { code: 200, body: { ok: true, displayName: "Lew" } });
  assert.deepEqual(out, ["[settings] qobuz connected as Lew"]);
  assert.deepEqual(w.s.saved, [{ qobuzUsername: "me@y", qobuzPasswordMd5: "md5:pw", qobuzToken: "t", qobuzDisplayName: "Lew" }]);
  assert.deepEqual(w.s.cleared, ["qobuzFavIds", "qobuzFeaturedCache"]);
  assert.deepEqual(w.s.refreshed, ["qobuz connected"]);
  w.s.login = async () => { throw new Error("wrong password"); };
  assert.deepEqual(await call("POST /api/settings/qobuz", { body: { username: "a", password: "b" } }),
    { code: 502, body: { ok: false, error: "wrong password" } });
});

test("qobuz settings: disconnect clears every credential and the sign-in, the caches, the badges and the said-once log", async () => {
  const w = world({ qobuzUsername: "u", qobuzPasswordMd5: "m", qobuzToken: "t", qobuzDisplayName: "n",
    qobuzWaveToken: "w", qobuzWaveUser: "wu", qobuzWaveName: "wn" });
  w.s.said.add("noid:x");
  const { call } = mounted(w);
  assert.deepEqual((await call("POST /api/settings/qobuz/disconnect")).body, { ok: true });
  for (const k of ["qobuzUsername", "qobuzPasswordMd5", "qobuzToken", "qobuzDisplayName", "qobuzWaveToken", "qobuzWaveUser", "qobuzWaveName"]) {
    assert.equal(w.s[k], "", k + " kept");
  }
  assert.equal(w.s.defaultAppId, "own-app", "the app_id did not follow the sign-in out");
  assert.deepEqual(w.s.cleared, ["qobuzFavIds", "qobuzFeaturedCache"]);
  assert.deepEqual(w.s.badgesCleared, ["qobuz"]);
  assert.equal(w.s.said.size, 0);
  assert.deepEqual(w.s.saved, [{ qobuzUsername: "", qobuzPasswordMd5: "", qobuzToken: "", qobuzDisplayName: "",
    qobuzWaveToken: "", qobuzWaveUser: "", qobuzWaveName: "" }]);
});

test("tidal settings: the device login — polled until approved, then saved and primed; status follows it", async () => {
  await handTimers(async (timers) => {
    const w = world();
    let polls = 0;
    w.s.startDeviceAuth = async () => ({ deviceCode: "dc", userCode: "ABCD", verificationUri: "v", verificationUriComplete: "vc", interval: 1, expiresIn: 300 });
    w.s.pollDeviceToken = async (code) => {
      assert.equal(code, "dc");
      if (++polls === 1) return { pending: true, slowDown: true };
      return { refreshToken: "rt", userId: "u9", countryCode: "NO", displayName: "Lew", accessToken: "primed", expiresIn: 3600 };
    };
    w.s.refresh = async () => { throw new Error("should not refresh: the login primed the access token"); };
    const { call, sv } = mounted(w);
    assert.deepEqual((await call("GET /api/settings/tidal/status")).body, { state: "idle" });
    assert.deepEqual((await call("POST /api/settings/tidal/start")).body,
      { user_code: "ABCD", verification_uri: "v", verification_uri_complete: "vc", expires_in: 300 });
    assert.equal(timers[0].ms, 2000, "the interval's 2 s floor");
    assert.deepEqual((await call("GET /api/settings/tidal/status")).body, { state: "pending" });
    await timers[0].f();
    assert.equal(timers[1].ms, 7000, "slow_down stretches the interval by 5 s");
    const { out } = await quietly(() => timers[1].f());
    assert.deepEqual(out, ["[settings] tidal connected as Lew"]);
    assert.deepEqual(w.s.saved, [{ tidalRefreshToken: "rt", tidalUserId: "u9", tidalCountryCode: "NO", tidalDisplayName: "Lew" }]);
    assert.deepEqual(w.s.cleared, ["tidalFavIds", "tidalFeaturedCache"]);
    assert.deepEqual(w.s.refreshed, ["tidal connected"]);
    assert.deepEqual((await call("GET /api/settings/tidal/status")).body, { state: "connected", displayName: "Lew" });
    assert.deepEqual((await call("GET /api/settings/tidal")).body, { connected: true, displayName: "Lew" });
    assert.deepEqual(await sv.tidalWithToken(async (t, cc, uid) => [t, cc, uid]), ["primed", "NO", "u9"]);
  });
});

test("tidal settings: a newer start supersedes one in flight (409); a failed poll is retried 3 times, then an error", async () => {
  await handTimers(async (timers) => {
    const w = world();
    const first = deferred();
    let starts = 0;
    w.s.startDeviceAuth = () => (++starts === 1 ? first.p : Promise.resolve({ deviceCode: "b", interval: 2, expiresIn: 300 }));
    w.s.pollDeviceToken = async () => { throw new Error("ECONNRESET"); };
    const { call } = mounted(w);
    const a = call("POST /api/settings/tidal/start");
    const b = await call("POST /api/settings/tidal/start");
    first.resolve({ deviceCode: "a", interval: 2, expiresIn: 300 });
    assert.deepEqual(await a, { code: 409, body: { ok: false, error: "superseded by a newer Tidal login attempt" } });
    assert.equal(b.code, 200);
    assert.equal(timers.length, 1);
    const { err } = await quietly(async () => { for (let i = 0; i < 4; i++) await timers[i].f(); });
    assert.equal(timers.length, 4, "three retries, then no more");
    assert.deepEqual(err, ["[tidal] device login poll failed (retry 1/3): ECONNRESET", "[tidal] device login poll failed (retry 2/3): ECONNRESET",
      "[tidal] device login poll failed (retry 3/3): ECONNRESET", "[tidal] device login failed: ECONNRESET"]);
    assert.deepEqual((await call("GET /api/settings/tidal/status")).body, { state: "error", error: "ECONNRESET" });
    w.s.startDeviceAuth = async () => { throw new Error("tidal down"); };
    assert.deepEqual(await call("POST /api/settings/tidal/start"), { code: 502, body: { ok: false, error: "tidal down" } });
  });
});

test("tidal settings: disconnect stops a login in progress and clears the connection, back to US", async () => {
  await handTimers(async (timers) => {
    const w = world({ tidalRefreshToken: "rt", tidalUserId: "u", tidalDisplayName: "n", tidalCountryCode: "GB" });
    w.s.startDeviceAuth = async () => ({ deviceCode: "dc", interval: 2, expiresIn: 300 });
    let n = 0;
    w.s.refresh = async () => ({ accessToken: ++n === 1 ? "before" : "after", expiresIn: 3600 });
    const { call, sv } = mounted(w);
    assert.equal(await sv.tidalWithToken(async (t) => t), "before");
    await call("POST /api/settings/tidal/start");
    assert.deepEqual((await call("POST /api/settings/tidal/disconnect")).body, { ok: true });
    assert.equal(timers[0].cleared, true, "the poll was not stopped");
    assert.deepEqual([w.s.tidalRefreshToken, w.s.tidalUserId, w.s.tidalDisplayName, w.s.tidalCountryCode], ["", "", "", "US"]);
    assert.deepEqual(w.s.cleared, ["tidalFavIds", "tidalFeaturedCache"]);
    assert.deepEqual(w.s.badgesCleared, ["tidal"]);
    assert.deepEqual(w.s.saved, [{ tidalRefreshToken: "", tidalUserId: "", tidalCountryCode: "US", tidalDisplayName: "" }]);
    assert.deepEqual((await call("GET /api/settings/tidal/status")).body, { state: "idle" });
    // The access token went with it: a reconnect refreshes rather than reusing it.
    w.s.tidalRefreshToken = "rt2";
    assert.equal(await sv.tidalWithToken(async (t) => t), "after", "the old account's access token was kept");
  });
});

test("tidal catalogue: new releases windowed and newest first; featured groups matched by id, name or prefix", async () => {
  const day = 24 * 60 * 60 * 1000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const w = world({ tidalRefreshToken: "rt", groups: [{ id: "x1", name: "Top albums" }, { id: "NEW", name: "New" }] });
  w.s.refresh = async () => ({ accessToken: "at", expiresIn: 3600 });
  w.s.featured = [{ id: 1, title: "old", releaseDate: iso(Date.now() - 40 * day) }, { id: 2, title: "recent", releaseDate: iso(Date.now() - 3 * day) },
    { id: 3, title: "undated" }, { id: 4, title: "newest", releaseDate: iso(Date.now() - day) }, { title: "no id" }];
  const { call } = mounted(w);
  const nr = await call("GET /api/tidal/new-releases", { query: { days: "999" } });
  assert.equal(nr.body.days, 30);
  assert.deepEqual(nr.body.albums.map((a) => a.title), ["newest", "recent", "undated"]);
  assert.deepEqual(w.s.featuredAsked, ["NEW"]);
  assert.deepEqual(await call("GET /api/tidal/featured", { query: { type: "new" } }), { code: 400, body: { error: "invalid type" } });
  const top = await call("GET /api/tidal/featured", { query: { type: "top" } });
  assert.equal(top.body.type, "top");
  assert.deepEqual(top.body.albums.map((a) => a.id), ["1", "2", "3", "4"], "Tidal's own order");
  assert.deepEqual(w.s.featuredAsked, ["NEW", "x1"], "'top' found by its name's prefix");
  // A group Tidal does not offer is [] and is not cached: asked again next time.
  const rising = await call("GET /api/tidal/featured", { query: { type: "rising" } });
  assert.deepEqual(rising.body.albums, []);
  w.s.groups = [{ id: "rising", name: "Rising" }];
  w.s.featured = [{ id: 9 }];
  assert.deepEqual((await call("GET /api/tidal/featured", { query: { type: "rising" } })).body.albums, [],
    "the groups list is cached for 10 minutes");
  w.d.tidalFeaturedCache.m.delete("groups"); // its 10 minutes are up
  assert.deepEqual((await call("GET /api/tidal/featured", { query: { type: "rising" } })).body.albums.map((a) => a.id), ["9"],
    "a group missing upstream was cached as empty");
  // Not connected: 400, as every service route answers it.
  const w2 = world();
  assert.deepEqual(await mounted(w2).call("GET /api/tidal/featured", { query: { type: "top" } }),
    { code: 400, body: { error: "Tidal not connected — connect your Tidal account in Settings" } });
});

test("tidal catalogue: an artist's albums need an id, page by offset and say whether there is more", async () => {
  const w = world({ tidalRefreshToken: "rt", artistPage: { items: [{ id: 1 }, { id: 2 }], total: 53 } });
  w.s.refresh = async () => ({ accessToken: "at", expiresIn: 3600 });
  const { call } = mounted(w);
  assert.deepEqual(await call("GET /api/tidal/artist-albums", { query: { artist_id: " " } }), { code: 400, body: { error: "artist_id required" } });
  const r = await call("GET /api/tidal/artist-albums", { query: { artist_id: "5", offset: "50" } });
  assert.deepEqual(r.body.artist, { id: "5", name: "Artist 5", image: "cover:pic:750x750" });
  assert.deepEqual([r.body.offset, r.body.limit, r.body.total, r.body.has_more], [50, 50, 53, true]);
  assert.deepEqual(r.body.albums.map((a) => a.id), ["1", "2"]);
  w.s.artistPage = { items: [{ id: 3 }], total: 51 };
  assert.equal((await call("GET /api/tidal/artist-albums", { query: { artist_id: "5", offset: "50" } })).body.has_more, false);
});

// ----------------------------- the wiring -----------------------------

test("the services' wiring: the routes keep index.js's order, and index.js hands each getter and setter its own variable", () => {
  assert.deepEqual(mounted(world()).order, ["GET /api/settings/qobuz", "POST /api/settings/qobuz", "POST /api/settings/qobuz/disconnect",
    "GET /api/settings/tidal", "POST /api/settings/tidal/start", "GET /api/settings/tidal/status", "POST /api/settings/tidal/disconnect",
    "GET /api/tidal/new-releases", "GET /api/tidal/artist-albums", "GET /api/tidal/featured"]);
  const src = indexSource();
  // Registered where they always were, between the Qobuz/TIDAL routes that stayed in index.js.
  const marks = ["qobuzSyncAppId();", "streamServices.mountQobuzSettings(app);", "mountQobuzReleases(app, {", "streamServices.mountTidalSettings(app);",
    "mountServiceFavourites(app, serviceFavourites, serviceErrorStatus);", "mountLibraryAdd(app, createLibraryAdd({", "mountServiceSearch(app, {",
    "streamServices.mountTidalCatalogue(app);"].map((m) => { const at = src.indexOf(m); assert.ok(at > 0, m + " is gone"); return at; });
  assert.deepEqual(marks, [...marks].sort((a, b) => a - b), "the routes register in a different order");
  const at = src.indexOf("const streamServices = createServices({");
  assert.ok(at > 0 && at < marks[0], "index.js does not wire createServices before using it");
  const call = src.slice(at, src.indexOf("\n});", at));
  const getters = [...call.matchAll(/(\w+): \(\) => (\w+)\b/g)];
  assert.equal(getters.length, 11);
  for (const [, name, v] of getters) assert.equal(v, name, name + " reads " + v);
  const setters = [...call.matchAll(/set(\w+): \((\w+)\) => \{ (\w+) = (\w+); \}/g)];
  assert.equal(setters.length, 11);
  for (const [, name, arg, v, val] of setters) {
    assert.equal(v, name[0].toLowerCase() + name.slice(1), "set" + name + " assigns " + v);
    assert.equal(val, arg);
  }
  assert.match(call, /wfQobuzSaid: _wfQobuzSaid\b/);
  // The two the top of the file reaches by name stay declarations; the rest are the services' own.
  assert.match(src, /\nasync function qobuzWithToken\(fn\) \{ return streamServices\.qobuzWithToken\(fn\); \}/);
  assert.match(src, /\nasync function tidalWithToken\(fn\) \{ return streamServices\.tidalWithToken\(fn\); \}/);
  assert.match(src, /\nconst \{ qobuzSigningToken, qobuzSyncAppId, qobuzReleaseTs, normalizeQobuzAlbum, normalizeQobuzAlbums,\n  normalizeTidalAlbums, serviceErrorStatus, parseOffsetParam \} = streamServices;/);
});
