// @ts-check
/*
 * phone-local.js — "This phone" in the Android app: the phone's own standalone player, shown and driven by Rouen's
 * page as one of its zones, offline and online, at home and away alike (dev/design/android-app.md §4.22, v1.9.72; the
 * owner, 2026-10-31: "This phone is this phone at all times"). It is never a Roon zone; it plays the phone's own files
 * (the Mandarin port — the local library now, TIDAL/Qobuz as Rouen's own client later), direct, streamed from Rouen.
 *
 * Does nothing outside the app (no window.RouenPhone). In the app the phone is one zone, "This phone" (this-phone): its
 * state, its queue (localQueue), its buttons (localControl, localSeek) and a tap in its queue (localJump) are the
 * phone's own player (RouenPhone.localState / localPlay). A Play Now on This phone of a local library album plays
 * direct (playLibrary); a streaming-service album waits for the Mandarin port's own client.
 *
 * Online this script wraps fetch: /api/zones lists This phone (away, alone — the home zones can't be heard; home,
 * beside the real Roon zones, with this phone's own server zone, while it still exists, hidden). Every this-phone route
 * is answered here, never through Roon. Offline, offline.js answers every route and asks RouenLocal.answer first.
 * Roon's own play counts for This phone's plays are kept by the silent catch-up zone server-side (§4.22), not here.
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
      subtitle: t.artist, image_key: t.image_key || cover(t.key), length: Math.round(Number(t.length) || 0) }));
    return { items, history: [] };
  }

  /** Now playing's format badge (album-view.js npFormat): {kind, text} from what the phone plays, or none. @param {any} s */
  function fmt(s) {
    if (!s || !s.quality) return undefined;
    if (s.quality === "opus") return { kind: "opus", text: "256" };
    const rate = Number(s.rate) || 0;
    return { kind: "lossless", text: rate ? (rate / 1000).toFixed(1).replace(/\.0$/, "") + " kHz" : "" };
  }

  /** "This phone" playing its own, as Roon's zones are drawn. @param {any} s */
  function zone(s) {
    /** @type {any} */
    const z = { zone_id: PHONE, display_name: "This phone", state: s.state || "stopped", outputs: [],
      is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
      settings: { shuffle: false, loop: "disabled", auto_radio: false } };
    if (playing(s)) {
      z.now_playing = { line1: s.title || "", line2: s.artist || "", line3: s.album || "", image_key: s.image_key || cover(s.key),
        length: Math.round(Number(s.length) || 0), seek_position: Math.round(Number(s.position) || 0), format: fmt(s) };
      z.queue_items_remaining = Math.max(0, (Number(s.count) || 0) - (Number(s.index) || 0) - 1);
    }
    return z;
  }

  /** The album playing, as /api/album/now-playing answers. @param {any} s */
  function nowPlaying(s) {
    if (!playing(s)) return { album: null, tracks: [] };
    const a = ask(() => bridge.album(String(s.album || ""), String(s.artist || "")), null);
    return { album: { title: s.album, subtitle: s.artist, image_key: s.image_key || cover(s.key) },
      tracks: ((a && a.tracks) || []).map((/** @type {any} */ t) => ({ title: t.title, subtitle: s.artist, length: t.length })) };
  }

  /** One of the local* calls' answers, as the page's routes answer. @param {any} r @returns {[number, any]} */
  const done = (r) => (r && r.error ? [400, { error: r.error }] : [200, { ok: true }]);
  const failed = { error: "The app could not be asked." };

  /**
   * This phone's own routes — always answered here, since This phone is always the phone's own player (§4.22): the
   * answer, or null for a route that isn't one of them. @param {URL} u @param {string} method @param {any} body
   * @returns {[number, any] | null}
   */
  function answer(u, method, body) {
    const p = u.pathname, s = state();
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

  // ---- Online: This phone is always the phone's own standalone player (§4.22) ------------------------------------

  /** Off the server's subnet (the page's "away"): the home Roon zones can't be heard, so the list is This phone alone. */
  const isAway = () => (((ask(() => bridge.settings(), {}) || {}).network) === "away");

  /** Is [z] this phone's own zone in Roon — the server-side Squeezebox named in Rouen's hello? While that zone still
   * exists (until it is retired server-side, §4.22) it IS this phone, so This phone stands in its place, shown once.
   * @param {any} z @param {string} name */
  const isPhone = (z, name) => !!(z && name && (z.display_name === name ||
    (z.outputs || []).some((/** @type {any} */ o) => o && o.display_name === name)));

  /** Roon's zones with This phone as its own zone (§4.22): away, This phone alone; home, the real Roon zones plus This
   * phone, with this phone's own server zone (while it still exists) hidden — one phone, shown once. @param {any} j */
  function zonesOut(j) {
    const s = state();
    if (isAway()) {
      try { localStorage.setItem("rra-zone", PHONE); } catch (e) { /* storage refused: the page picks a zone itself */ }
      return Object.assign({}, j, { zones: [zone(s)] });
    }
    const zones = Array.isArray(j && j.zones) ? j.zones.slice() : [];
    const at = zones.findIndex((z) => isPhone(z, s.roon_zone));
    const hiddenId = at >= 0 ? zones[at].zone_id : null;
    if (at >= 0) zones.splice(at, 1);   // this phone's server zone is This phone; don't show it twice
    zones.push(zone(s));
    try {
      // The phone's own server zone, if it was the chosen one, is This phone now.
      if (hiddenId && localStorage.getItem("rra-zone") === hiddenId) localStorage.setItem("rra-zone", PHONE);
    } catch (e) { /* storage refused: the page picks a zone as it would with none chosen */ }
    return Object.assign({}, j, { zones });
  }

  /** A reply as the page's routes give one. @param {number} status @param {any} out */
  const reply = (status, out) => new Response(JSON.stringify(out), { status, headers: { "Content-Type": "application/json" } });

  const realFetch = window.fetch.bind(window);

  /**
   * This phone plays its own (§4.22): Play Now (or a track) on This phone of a local library album plays direct on the
   * phone's own player, streamed from Rouen — home and away alike (the Roon relay is gone). A Response when it played;
   * null when the album is not one of the server's own files (a TIDAL/Qobuz album, or one the /music scan didn't match),
   * so the caller can say so. Roon's play count for the direct play is kept by the silent catch-up zone (§4.22).
   * @param {string} path @param {any} body
   */
  async function playLibrary(path, body) {
    if (typeof bridge.playLibrary !== "function") return null;
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
    // The cover key the page played from (/api/play's body), so Now playing has the art.
    if (body.image_key) album.image_key = body.image_key;
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
    // This phone is its own player: its routes are always answered here, never through Roon (§4.22).
    const own = answer(u, method, body || {});
    if (own) return reply(own[0], own[1]);
    if (method === "POST" && (u.pathname === "/api/play" || u.pathname === "/api/play-track")) {
      const b = body || {};
      const t = String((u.pathname === "/api/play" ? b.title : b.album_title) || "");
      const a = String((u.pathname === "/api/play" ? b.subtitle : b.album_subtitle) || "");
      // Queue and Play Next add to the phone's own queue (as offline.js does), never Roon's.
      if (b.kind === "queue" || b.kind === "play_next") {
        const track = u.pathname === "/api/play" ? "" : String(Number(b.track) || 0);
        const [st, out] = done(ask(() => bridge.localAdd(t, a, track, b.kind === "play_next" ? "1" : "0"), failed));
        return reply(st, out);
      }
      const direct = await playLibrary(u.pathname, b);
      if (direct) return direct;
      // Not one of the server's own library files. This phone plays those direct; a streaming-service album waits for
      // the Mandarin port's own TIDAL/Qobuz client (§4.22). Say so plainly — away there is no Roon zone to fall back
      // to, and at home This phone still plays its own, not Roon's relay (owner, 2026-10-31).
      return reply(409, { error: "This phone plays your own library files, and Rouen couldn't find this album's files among them."
        + (isAway() ? " Playing a streaming-service album on This phone is coming."
                    : " Playing a streaming-service album on This phone is coming; for now, play it to a Roon zone.") });
    }
    // Anything else (a playlist, a transfer) has no home on This phone's own player yet — it waits for the Mandarin
    // port (§4.22); This phone is never a Roon zone to relay it to. Say so rather than fail silently.
    return reply(409, { error: "This phone plays your own albums; that isn't available for it yet." });
  };

  // A download still playing as the page loads (Rouen came back under it): This phone is the zone shown.
  try { if (playing(state())) localStorage.setItem("rra-zone", PHONE); } catch (e) { /* storage refused: the page picks a zone as it would with none chosen */ }
})();
