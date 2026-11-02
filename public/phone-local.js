// @ts-check
/*
 * phone-local.js — "This phone" in the Android app, offline only: the phone's own player playing its downloads, shown
 * and driven by Rouen's page as one zone while Rouen can't be reached (offline.js answers every route and asks
 * RouenLocal.answer first). Its state, its queue (localQueue), its buttons (localControl, localSeek) and a tap in its
 * queue (localJump) are the phone's own player (RouenPhone.localState / localPlay).
 *
 * Online it shows the phone's own Roon zone only, away from home (v1.9.72-t79, below), and otherwise leaves the zones
 * alone (v1.9.72-t69; dev/design/android-app.md §4.23, the owner, 2026-11-02): the phone is a Roon zone of its own,
 * "Rouen <phone>", run by Rouen's server, which Roon plays like any zone. The standalone "This phone" of §4.22 — its
 * own zone on the page beside Roon's, playing the server's files and your TIDAL albums direct — is gone.
 *
 * Does nothing outside the app (no window.RouenPhone).
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
  /** What the phone plays: {state, index, count, position, length, title, artist, album, key}. */
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
  /**
   * The phone's volume keys (v1.9.72-t74; the owner, 2026-11-02: "unlink zone volume from the device buttons … use the
   * phone's volume control"). The app asks here where a press goes (MainActivity): "phone" when the zone selected is the
   * phone's own — its Roon zone ("Rouen <phone>", as the app's hello learned it) or This phone offline — and the app
   * moves the phone's own media volume; otherwise the press nudges the selected Roon zone, as before (window.__rouenVolumeKey,
   * app.js) and "roon" is answered. The phone plays Roon's stream at full gain, so its own volume is the volume. A
   * group with the phone's zone in it is Roon's (its other outputs' volume); a zone renamed in Roon is not known as the
   * phone's until the app's hello learns the new name.
   * @param {number} delta  +1 or -1 @returns {"phone" | "roon"}
   */
  W.__rouenVolumeKeyAt = (delta) => {
    const id = typeof W.__selectedZoneId === "function" ? W.__selectedZoneId() : null;
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("zone-select"));
    const opt = sel && id ? Array.from(sel.options).find((o) => o.value === id) : null;
    const mine = String(state().roon_zone || "");
    if (id === PHONE || (!!mine && !!opt && opt.textContent === mine)) return "phone";
    if (typeof W.__rouenVolumeKey === "function") W.__rouenVolumeKey(delta);
    return "roon";
  };
  /**
   * Away from home, the phone's own zone only (v1.9.72-t79; the owner, 2026-11-02: "It must be a straight drop-off for
   * Roon zones what are on the same subnet as the Roon server. On mobile data or another WiFi I must only see the phone
   * as a zone"). The app says where the phone is (RouenPhone.settings().network: "home" on the Roon server's own
   * network, "away" through Tailscale, "offline"); away, every zone and output list the page is given (/api/zones,
   * /api/outputs) keeps the phone's own Roon zone ("Rouen <phone>", as the app's hello learned it) and nothing else —
   * none at all if the app has not learned its name yet. Home and offline (offline.js's own answer) pass unchanged.
   */
  const network = () => String((ask(() => bridge.settings(), {}) || {}).network || "");
  const LISTS = new Set(["/api/zones", "/api/outputs"]);
  const realFetch = W.fetch.bind(W);
  /** @param {RequestInfo | URL} input @param {RequestInit} [init] */
  W.fetch = async function (input, init) {
    const res = await realFetch(input, init);
    /** @type {URL} */
    let u;
    try { u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href); } catch (e) { return res; /* not a URL the page can mean: not a zone list */ }
    if (u.origin !== location.origin || !LISTS.has(u.pathname) || !res.ok || network() !== "away") return res;
    const j = await res.clone().json().catch(() => null);
    if (!j || typeof j !== "object") return res;
    const mine = String(state().roon_zone || "");
    const ours = (/** @type {any} */ name) => !!mine && name === mine;
    if (Array.isArray(j.zones)) j.zones = j.zones.filter((/** @type {any} */ z) => z && ours(z.display_name));
    if (Array.isArray(j.outputs)) j.outputs = j.outputs.filter((/** @type {any} */ o) => o && (ours(o.zone_name) || ours(o.display_name)));
    return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: { "Content-Type": "application/json" } });
  };
  // Leaving home, or coming back: the page is read afresh at once, so the other zones drop off (or come back) straight
  // away rather than at the next time a list is asked. The app says so through window.__rouenPhoneChanged.
  let was = network();
  document.addEventListener("rouen:phone", () => {
    const now = network();
    const crossed = now !== was && (now === "away" || was === "away");
    was = now;
    // window.__rouenReload stands in for the reload where the page must stay (the DOM tests).
    if (crossed) (typeof W.__rouenReload === "function" ? W.__rouenReload : () => location.reload())();
  });
  // Online, nothing more: the phone is its Roon zone (§4.23).
})();
