"use strict";
/*
 * fake-ibroadcast.js — iBroadcast's servers on loopback, under one address as lib/ibroadcast/api.js's `base` puts them
 * (2.0.6-t1), ported from Mandarin's test/fake-ibroadcast.js less its upload and streaming servers:
 *   /oauth    the device sign-in (GET /device/code, POST /token: approved when the test says so, slow_down asked for
 *             once, turned down or refused on demand), the refresh, POST /revoke;
 *   /api      the JSON API: POST /<mode>, Bearer <access token>; "authenticated": false for a token made stale, as
 *             iBroadcast answers one. status gives the user, the settings and, asked for them, the supported types;
 *   /library  the library, as iBroadcast's library server sends it: each table an id → array of values with a map naming
 *             the places; its status.lastmodified moved on by changed();
 *   /streaming /orig/<path>?Expires&Signature&file_id&user_id&platform&version (2.0.6-t2): a track's original (its
 *             `data`), byte ranges answered as a server answers them; refused without the access token. Each ask kept.
 * What was asked for is recorded: the client id and scope a code was asked with, the bodies the API was sent.
 */
const http = require("node:http");
const crypto = require("node:crypto");

const hex = (n) => crypto.randomBytes(n).toString("hex");

class FakeIBroadcast {
  /* albums: [{ id, name, artist: { id, name }, disc, year, trashed, tracks: [{ id, title, track, length, type, size, album_id, artist, trashed }] }] */
  constructor({ user = { id: 4242, username: "tester", email_address: "tester@example.com", premium: true }, albums = [] } = {}) {
    this.albums = albums;
    this.user = user;
    this.lastmodified = "2026-11-16 12:00:00";
    this.libraryReads = 0;
    this.statusReads = 0;
    this.supported = [{ extension: ".flac" }, { extension: ".mp3" }, { extension: ".m3u" }, { extension: ".wav" }];
    this.codes = new Map();            // device_code -> { userCode, approved, denied, clientId, scope }
    this.access = "at-" + hex(6);
    this.refreshToken = "rt-" + hex(6);
    this.stale = new Set();            // access tokens that no longer work
    this.revoked = [];
    this.refreshes = 0;
    this.polls = 0;
    this.slowOnce = true;              // the first poll is asked to slow down
    this.refuseGrant = false;          // the device grant refused, as iBroadcast refuses an app not let use it
    this.expiresIn = 3600;
    this.apiBodies = [];
    this.streamAsks = [];              // { path, query, range }
    this.ignoreRange = false;          // the whole file answered whatever range is asked, as a server ignoring Range does
    this.server = null;
    this.port = 0;
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  /* The latest code approved, or turned down, as a person does on iBroadcast. */
  approve() { const c = [...this.codes.values()].pop(); if (c) c.approved = true; }
  deny() { const c = [...this.codes.values()].pop(); if (c) c.denied = true; }
  /* The library changed: its lastmodified moved on. */
  changed() { this.lastmodified = "2026-11-17 09:" + String(10 + this.libraryReads).padStart(2, "0") + ":00"; }
  /* The access token made stale: the next API call answers "authenticated": false. */
  expire() { this.stale.add(this.access); }

  library() {
    const albums = { map: { name: 0, tracks: 1, artist_id: 2, trashed: 3, rating: 4, disc: 5, year: 6 } };
    const artists = { map: { name: 0, tracks: 1, trashed: 2, rating: 3 } };
    const tracks = { map: { track: 0, year: 1, title: 2, genre: 3, length: 4, album_id: 5, artwork_id: 6, artist_id: 7, trashed: 8,
      size: 9, file: 10, type: 11 } };
    for (const a of this.albums) {
      albums[a.id] = [a.name, a.tracks.map((t) => t.id), a.artist.id, !!a.trashed, 0, a.disc || 0, a.year || 0];
      artists[a.artist.id] = [a.artist.name, [], false, 0];
      for (const t of a.tracks) {
        const artist = t.artist || a.artist;
        artists[artist.id] = [artist.name, [], false, 0];
        tracks[t.id] = [t.track, a.year || 0, t.title, "", t.length || 60, t.album_id || a.id, t.artwork_id || 0, artist.id, !!t.trashed,
          t.data ? t.data.length : t.size || 1000, "/128/a/b/" + t.id, t.type || "audio/flac"];
      }
    }
    return { albums, artists, tracks, playlists: { map: { name: 0, tracks: 1 } }, tags: {}, trash: { map: { name: 0, tracks: 1 } } };
  }

  tokenAnswer() {
    return { access_token: this.access, token_type: "Bearer", expires_in: this.expiresIn, refresh_token: this.refreshToken, scope: ["user.account:read", "user.library:read"] };
  }

  handle(req, res, body) {
    const u = new URL(req.url, this.base);
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const form = () => Object.fromEntries(new URLSearchParams(body));
    const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (u.pathname === "/oauth/device/code" && req.method === "GET") {
      const device = "dc-" + hex(8), userCode = hex(3).toUpperCase();
      this.codes.set(device, { userCode, approved: false, denied: false, clientId: u.searchParams.get("client_id"), scope: u.searchParams.get("scope") });
      return json(200, { device_code: device, user_code: userCode, verification_uri: "https://media.ibroadcast.com/device",
        verification_uri_complete: "https://media.ibroadcast.com/device?code=" + userCode, interval: 1, expires_in: 600 });
    }
    if (u.pathname === "/oauth/token" && req.method === "POST") {
      const f = form();
      if (f.grant_type === "device_code") {
        this.polls++;
        const c = this.codes.get(f.device_code);
        if (!c) return json(400, { error: "invalid_grant" });
        if (c.denied) return json(400, { error: "access_denied" });
        if (this.refuseGrant) return json(400, { message: "Unauthorized client: `grant_type` is invalid" });
        if (this.slowOnce) { this.slowOnce = false; return json(429, { error: "slow_down" }); }
        if (!c.approved) return json(400, { error: "authorization_pending" });
        this.codes.delete(f.device_code);
        return json(200, this.tokenAnswer());
      }
      if (f.grant_type === "refresh_token") {
        this.refreshes++;
        if (f.refresh_token !== this.refreshToken) return json(400, { error: "invalid_grant", error_description: "The refresh token is no good" });
        this.access = "at-" + hex(6);
        return json(200, { access_token: this.access, token_type: "Bearer", expires_in: this.expiresIn, scope: "user.library:read" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (u.pathname.startsWith("/streaming/") && req.method === "GET") {
      const q = Object.fromEntries(u.searchParams);
      this.streamAsks.push({ path: u.pathname, query: q, range: req.headers.range || null });
      if (q.Signature !== this.access) { res.writeHead(403); return res.end(); }
      const id = u.pathname.split("/").pop();
      const t = this.albums.flatMap((a) => a.tracks).find((x) => String(x.id) === id && x.data);
      if (!t) { res.writeHead(404); return res.end(); }
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
      if (m && !this.ignoreRange) {
        const from = Number(m[1]), to = Math.min(t.data.length - 1, m[2] ? Number(m[2]) : t.data.length - 1);
        res.writeHead(206, { "Content-Range": `bytes ${from}-${to}/${t.data.length}`, "Content-Length": to - from + 1 });
        return res.end(t.data.subarray(from, to + 1));
      }
      res.writeHead(200, { "Content-Length": t.data.length });
      return res.end(t.data);
    }
    if (u.pathname === "/oauth/revoke" && req.method === "POST") { this.revoked.push(form()); return json(200, { result: true }); }
    if (u.pathname === "/library" && req.method === "POST") {
      if (auth !== this.access || this.stale.has(auth)) return json(200, { result: false, authenticated: false });
      this.libraryReads++;
      return json(200, { result: true, message: "ok", library: this.library(), status: { timestamp: this.lastmodified, lastmodified: this.lastmodified },
        settings: { streaming_server: this.base + "/streaming", artwork_server: this.base + "/artwork" } });
    }
    if (u.pathname.startsWith("/api/") && req.method === "POST") {
      let b = {};
      try { b = JSON.parse(body); } catch (e) { /* not JSON: recorded as an empty body */ }
      this.apiBodies.push({ path: u.pathname, body: b, agent: req.headers["user-agent"] });
      if (auth !== this.access || this.stale.has(auth)) return json(200, { result: false, authenticated: false, message: "Your session has expired" });
      if (u.pathname === "/api/status") {
        this.statusReads++;
        const o = { result: true, authenticated: true, message: "ok", user: Object.assign({ token: "legacy-token" }, this.user),
          settings: { streaming_server: this.base + "/streaming", artwork_server: this.base + "/artwork" }, status: { timestamp: this.lastmodified, lastmodified: this.lastmodified } };
        if (b.supported_types) o.supported = this.supported;
        return json(200, o);
      }
      return json(200, { result: false, message: "Unknown mode " + b.mode });
    }
    res.writeHead(404); res.end();
  }

  start() {
    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => { this.handle(req, res, Buffer.concat(chunks).toString("utf8")); });
    });
    return new Promise((resolve) => { this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; resolve(this); }); });
  }

  stop() {
    return new Promise((resolve) => { this.server.closeAllConnections(); this.server.close(() => resolve()); });
  }
}

module.exports = { FakeIBroadcast };
