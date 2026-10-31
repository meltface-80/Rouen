// @ts-check
/*
 * phone-local.js — "This phone" in the Android app: the downloaded albums the phone plays itself, shown and driven by
 * Rouen's page as one of its zones, offline and online alike (dev/design/android-app.md §4.19, v1.9.72-t32). The owner,
 * 2026-10-30: "Online and offline modes should work in harmony".
 *
 * Does nothing outside the app (no window.RouenPhone). In the app the phone is one zone, "This phone" (this-phone):
 *   - while the phone plays its own files (RouenPhone.localState), the zone is that play: its state, its queue
 *     (localQueue), its buttons (localControl, localSeek) and a tap in its queue (localJump);
 *   - otherwise, online, it is the phone's zone in Roon ("Rouen <name>", which Rouen's hello named): the page's
 *     requests for this-phone go to that zone, and its answers come back as this-phone. Roon starting a stream on the
 *     phone (a Play Now there) ends the phone's own play, in the app.
 * So online, a download still playing when Rouen came back goes on, under This phone, until something is played
 * through Roon.
 *
 * Offline, offline.js answers every route and asks RouenLocal.answer first. Online this script wraps fetch itself.
 * Covers: a download's own (/api/image/dl:<key>, which only the offline copy serves) offline, Roon's online.
 */
(function rouenPhoneLocal() {
  "use strict";
  const W = /** @type {any} */ (window);
  const bridge = W.RouenPhone;
  if (!bridge || typeof bridge.localState !== "function") return;
  const PHONE = "this-phone";
  const offline = () => document.documentElement.classList.contains("rouen-offline");

  /** The bridge's answer. @param {() => string} f @param {any} none @returns {any} */
  const ask = (f, none) => { try { return JSON.parse(f()); } catch (e) { return none; } };
  /** What the phone plays: {state, index, count, position, length, title, artist, album, key, roon_zone}. */
  const state = () => ask(() => bridge.localState(), { state: "stopped" }) || { state: "stopped" };
  const playing = (/** @type {any} */ s) => !!(s && s.state && s.state !== "stopped");

  /** The downloads as the bridge lists them, kept a few seconds: the mini player asks each second while one plays. */
  /** @type {any[] | null} */
  let kept = null, keptAt = 0;
  function downloads() {
    if (!kept || Date.now() - keptAt > 5000) {
      const all = ask(() => bridge.albums(), []);
      kept = Array.isArray(all) ? all : [];
      keptAt = Date.now();
    }
    return kept;
  }
  /** A download's cover, by its key: its own offline, Roon's online. @param {string} key */
  function cover(key) {
    if (!key) return "";
    if (offline()) return "dl:" + key;
    const a = downloads().find((x) => x && x.key === key);
    return (a && a.image_key) || "";
  }
  /** The albums wholly on the phone, as the page's album tiles, A to Z by artist then title: Home's Downloaded, and
   * offline the Library. */
  function albums() {
    const done = downloads().filter((a) => a && a.state === "done");
    done.sort((a, b) => String(a.artist).localeCompare(String(b.artist)) || String(a.title).localeCompare(String(b.title)));
    return done.map((a, i) => ({ offset: i, title: a.title, subtitle: a.artist, image_key: cover(a.key) }));
  }

  /** The queue from the track playing on, as Rouen's /api/queue answers. */
  function queue() {
    const q = ask(() => bridge.localQueue(), []);
    const items = (Array.isArray(q) ? q : []).map((/** @type {any} */ t) => ({ queue_item_id: t.id, title: t.title,
      subtitle: t.artist, image_key: cover(t.key), length: Math.round(Number(t.length) || 0) }));
    return { items, history: [] };
  }

  /** "This phone" playing its own, as Roon's zones are drawn. @param {any} s */
  function zone(s) {
    /** @type {any} */
    const z = { zone_id: PHONE, display_name: "This phone", state: s.state || "stopped", outputs: [],
      is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
      settings: { shuffle: false, loop: "disabled", auto_radio: false } };
    if (playing(s)) {
      z.now_playing = { line1: s.title || "", line2: s.artist || "", line3: s.album || "", image_key: cover(s.key),
        length: Math.round(Number(s.length) || 0), seek_position: Math.round(Number(s.position) || 0) };
      z.queue_items_remaining = Math.max(0, (Number(s.count) || 0) - (Number(s.index) || 0) - 1);
    }
    return z;
  }

  /** The album playing, as /api/album/now-playing answers. @param {any} s */
  function nowPlaying(s) {
    if (!playing(s)) return { album: null, tracks: [] };
    const a = ask(() => bridge.album(String(s.album || ""), String(s.artist || "")), null);
    return { album: { title: s.album, subtitle: s.artist, image_key: cover(s.key) },
      tracks: ((a && a.tracks) || []).map((/** @type {any} */ t) => ({ title: t.title, subtitle: s.artist, length: t.length })) };
  }

  /** One of the local* calls' answers, as the page's routes answer. @param {any} r @returns {[number, any]} */
  const done = (r) => (r && r.error ? [400, { error: r.error }] : [200, { ok: true }]);
  const failed = { error: "The app could not be asked." };

  /**
   * This phone's own routes, while it plays its own files (or always, offline): the answer, or null for a route that
   * isn't one of them. @param {URL} u @param {string} method @param {any} body @returns {[number, any] | null}
   */
  function answer(u, method, body) {
    const p = u.pathname, s = state();
    if (!offline() && !playing(s)) return null;
    if (method === "POST") {
      if (p === "/api/control") return done(ask(() => bridge.localControl(String(body.command || "")), failed));
      if (p === "/api/seek") return done(ask(() => bridge.localSeek(String(Number(body.seconds) || 0)), failed));
      if (p === "/api/play-from-here") return done(ask(() => bridge.localJump(String(Number(body.queue_item_id) || 0)), failed));
      return null;
    }
    if (p === "/api/zone-state") return [200, { zone: zone(s) }];
    if (p === "/api/queue") return [200, queue()];
    if (p === "/api/album/now-playing") return [200, nowPlaying(s)];
    return null;
  }

  // forget: the downloads moved (window.__rouenDownloadsChanged, home-downloads.js), so they are read afresh.
  W.RouenLocal = { PHONE, zone: () => zone(state()), answer, albums, cover, forget: () => { kept = null; } };
  if (offline()) return;

  // ---- Online: This phone is the phone's own play, or its zone in Roon ------------------------------------------

  /** The phone's zone in Roon, as the last zone list had it (null: not there). @type {string | null} */
  let roonId = null;

  /** Is [z] the phone's zone in Roon? @param {any} z @param {string} name */
  const isPhone = (z, name) => !!(z && name && (z.display_name === name ||
    (z.outputs || []).some((/** @type {any} */ o) => o && o.display_name === name)));

  /** Roon's zones with the phone's own as This phone. @param {any} j */
  function zonesOut(j) {
    const s = state(), zones = Array.isArray(j && j.zones) ? j.zones.slice() : [];
    const at = zones.findIndex((z) => isPhone(z, s.roon_zone));
    roonId = at >= 0 ? zones[at].zone_id : null;
    if (playing(s)) {
      if (at >= 0) zones[at] = zone(s); else zones.push(zone(s));
    } else if (at >= 0) {
      zones[at] = Object.assign({}, zones[at], { zone_id: PHONE, display_name: "This phone" });
    }
    try {
      // The phone's zone in Roon, chosen before This phone stood for it, is This phone now.
      if (roonId && localStorage.getItem("rra-zone") === roonId) localStorage.setItem("rra-zone", PHONE);
    } catch (e) { /* storage refused: the page picks a zone as it would with none chosen */ }
    return Object.assign({}, j, { zones });
  }

  /** [v] with this-phone, wherever it stands, as the phone's zone in Roon. @param {any} v @returns {any} */
  function toRoon(v) {
    if (v === PHONE) return roonId;
    if (Array.isArray(v)) return v.map(toRoon);
    if (v && typeof v === "object") {
      /** @type {Record<string, any>} */
      const o = {};
      for (const k of Object.keys(v)) o[k] = toRoon(v[k]);
      return o;
    }
    return v;
  }

  /** A reply as the page's routes give one. @param {number} status @param {any} out */
  const reply = (status, out) => new Response(JSON.stringify(out), { status, headers: { "Content-Type": "application/json" } });

  const realFetch = window.fetch.bind(window);

  /**
   * The split head (§4.20, v1.9.72-t36, owner's "B"): away from home, Play Now (or a track) on This phone of a local
   * library album plays direct on the phone's own player, streamed from Rouen, not through Roon's zone. A Response
   * when it played; null to fall through to Roon (at home, a TIDAL/Qobuz album Rouen won't serve, or it couldn't play).
   * Roon's play count for the direct play follows in B2.
   * @param {string} path @param {any} body
   */
  async function playLibrary(path, body) {
    if (typeof bridge.playLibrary !== "function") return null;
    if (((ask(() => bridge.settings(), {}) || {}).network) !== "away") return null;
    const title = String((path === "/api/play" ? body.title : body.album_title) || "");
    const artist = String((path === "/api/play" ? body.subtitle : body.album_subtitle) || "");
    const from = path === "/api/play" ? 0 : Number(body.track) || 0;
    if (!title) return null;
    let album;
    try {
      const r = await realFetch("/api/phone/album?title=" + encodeURIComponent(title) + "&artist=" + encodeURIComponent(artist));
      if (!r.ok) return null;   // not one of the server's own albums (TIDAL/Qobuz): Roon plays it
      album = await r.json();
    } catch (e) { return null; /* the album couldn't be read: Roon plays it */ }
    const res = ask(() => bridge.playLibrary(JSON.stringify(album), String(from)), null);
    return res && res.ok ? reply(200, { ok: true }) : null;
  }

  /** @param {RequestInfo | URL} input @param {RequestInit} [init] */
  window.fetch = async function (input, init) {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/") || u.pathname.startsWith("/api/image/")) return realFetch(input, init);
    if (u.pathname === "/api/zones") {
      const r = await realFetch(input, init);
      if (!r.ok) return r;
      return reply(r.status, zonesOut(await r.json().catch(() => ({}))));
    }
    const method = String((init && init.method) || "GET").toUpperCase();
    /** @type {any} */
    let body = null;
    try { body = init && typeof init.body === "string" ? JSON.parse(init.body) : null; } catch (e) { body = null; /* not JSON: no zone in it */ }
    const mine = [...u.searchParams.values()].includes(PHONE) || JSON.stringify(body || {}).includes('"' + PHONE + '"');
    if (!mine) return realFetch(input, init);
    const own = answer(u, method, body || {});
    if (own) return reply(own[0], own[1]);
    if (method === "POST" && (u.pathname === "/api/play" || u.pathname === "/api/play-track")) {
      const direct = await playLibrary(u.pathname, body || {});
      if (direct) return direct;
    }
    if (!roonId) return reply(409, { error: "This phone isn't one of Roon's zones right now." });
    // Through Roon, to the phone's zone there.
    for (const [k, v] of [...u.searchParams.entries()]) if (v === PHONE) u.searchParams.set(k, roonId);
    const sent = body ? Object.assign({}, init, { body: JSON.stringify(toRoon(body)) }) : init;
    const r = await realFetch(u.href, sent);
    if (u.pathname !== "/api/zone-state" || !r.ok) return r;
    const j = await r.json().catch(() => ({}));
    if (j && j.zone) j.zone = Object.assign({}, j.zone, { zone_id: PHONE, display_name: "This phone" });
    return reply(r.status, j);
  };

  // A download still playing as the page loads (Rouen came back under it): This phone is the zone shown.
  try { if (playing(state())) localStorage.setItem("rra-zone", PHONE); } catch (e) { /* storage refused: the page picks a zone as it would with none chosen */ }
})();
