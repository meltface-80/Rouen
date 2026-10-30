// @ts-check
/*
 * offline.js — Rouen's page in the Android app with Rouen out of reach (dev/design/android-app.md §4.19,
 * v1.9.72-t29). The owner, 2026-10-30: "Offline use requires the app to have the same Rouen UI".
 *
 * Never loaded by Rouen's own page. The app carries a copy of public/ and, when Rouen can't be reached, serves that
 * copy from the page's own address (OfflineSite.kt), with this script put first in <head>. So it runs before any of
 * the page's scripts, and answers the page's /api from what is on the phone, through the app's bridge
 * (window.RouenPhone: albums(), album(title, artist), and the local* calls below):
 *
 *   - the downloaded albums are the Library, and Home's "Downloaded";
 *   - an album's page is its download, its tracks as they were downloaded;
 *   - Home's other rows are off (they are Roon's);
 *   - the one zone is "This phone" (v1.9.72-t30): Play Now on an album or a track plays it on the phone's own player
 *     (RouenPhone.localPlay), and the mini player and Now playing drive it (localState, localControl, localSeek);
 *   - every other route answers as empty, so a screen shows nothing rather than an error;
 *   - covers are not asked here: <img> goes to the app, which serves /api/image/dl:<key> from the album's cover.jpg.
 *
 * Home says the phone is offline, over the albums on it.
 */
(function rouenOffline() {
  "use strict";
  const bridge = /** @type {any} */ (window).RouenPhone;
  if (!bridge || typeof bridge.albums !== "function") return;
  document.documentElement.classList.add("rouen-offline");

  /** The bridge's answer. @param {() => string} f @param {any} none @returns {any} */
  const ask = (f, none) => { try { return JSON.parse(f()); } catch (e) { return none; } };
  /** The albums wholly on the phone, as the page's album tiles, A to Z by artist then title. */
  function albums() {
    const all = ask(() => bridge.albums(), []);
    const done = (Array.isArray(all) ? all : []).filter((/** @type {any} */ a) => a && a.state === "done");
    done.sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.artist).localeCompare(String(b.artist)) || String(a.title).localeCompare(String(b.title)));
    return done.map((/** @type {any} */ a, /** @type {number} */ i) => ({ offset: i, title: a.title, subtitle: a.artist, image_key: "dl:" + a.key }));
  }
  /** An album's page, from its download. @param {URLSearchParams} q */
  function album(q) {
    const title = q.get("title") || "", artist = q.get("subtitle") || "";
    const a = ask(() => bridge.album(title, artist), null);
    if (!a || a.state !== "done") return null;
    return {
      title: a.title, subtitle: a.artist, image_key: "dl:" + a.key, offset: Number(q.get("offset")) || 0,
      actions: [{ kind: "play_now", title: "Play Now" }],
      tracks: (a.tracks || []).map((/** @type {any} */ t) => ({ title: t.title, subtitle: a.artist, length: t.length })),
    };
  }

  const HOME_ROWS = ["unplayed", "history", "later", "picks", "random", "library", "lotw", "genres"];
  const PHONE = "this-phone";
  /** "This phone", as Roon's zones are drawn: what its own player is playing, if anything. */
  function zone() {
    const s = ask(() => bridge.localState(), { state: "stopped" }) || { state: "stopped" };
    /** @type {any} */
    const z = { zone_id: PHONE, display_name: "This phone", state: s.state || "stopped", outputs: [],
      is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
      settings: { shuffle: false, loop: "disabled", auto_radio: false } };
    if (s.state && s.state !== "stopped") {
      z.now_playing = { line1: s.title || "", line2: s.artist || "", line3: s.album || "", image_key: s.key ? "dl:" + s.key : "",
        length: Math.round(Number(s.length) || 0), seek_position: Math.round(Number(s.position) || 0) };
    }
    return z;
  }
  /** One of the local* calls' answers, as the page's routes answer. @param {any} r @returns {[number, any]} */
  const done = (r) => (r && r.error ? [400, { error: r.error }] : [200, { ok: true }]);

  /** @param {URL} u @param {string} method @param {any} body @returns {[number, any]} */
  function answer(u, method, body) {
    const p = u.pathname;
    if (method === "POST") {
      if (p === "/api/play") return done(ask(() => bridge.localPlay(String(body.title || ""), String(body.subtitle || ""), "0"), { error: "The app could not be asked." }));
      if (p === "/api/play-track") return done(ask(() => bridge.localPlay(String(body.album_title || ""), String(body.album_subtitle || ""), String(Number(body.track) || 0)), { error: "The app could not be asked." }));
      if (p === "/api/control") return done(ask(() => bridge.localControl(String(body.command || "")), { error: "The app could not be asked." }));
      if (p === "/api/seek") return done(ask(() => bridge.localSeek(String(Number(body.seconds) || 0)), { error: "The app could not be asked." }));
      return [503, { error: "Rouen can't be reached." }];
    }
    if (p === "/api/choices") return [200, { made: true, accounts: false, native: false }];
    // The page waits for Rouen to be paired with Roon before it shows Home: offline, what there is to show is here.
    if (p === "/api/status") return [200, { paired: true }];
    if (p === "/api/settings/home-rows") return [200, { rows: HOME_ROWS.map((id) => ({ id, on: false })) }];
    if (p === "/api/zones") return [200, { zones: [zone()] }];
    if (p === "/api/zone-state") return [200, { zone: zone() }];
    if (p === "/api/library/albums") {
      const all = albums(), from = Number(u.searchParams.get("offset")) || 0, n = Number(u.searchParams.get("count")) || all.length;
      return [200, { albums: all.slice(from, from + n), total: all.length }];
    }
    if (p === "/api/random-albums") return [200, { albums: albums(), total: albums().length, filtered: false }];
    if (p === "/api/album") {
      const a = album(u.searchParams);
      return a ? [200, a] : [404, { error: "Not on this phone." }];
    }
    return [200, {}];
  }

  const realFetch = window.fetch.bind(window);
  /** @param {RequestInfo | URL} input @param {RequestInit} [init] */
  window.fetch = function (input, init) {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/") || u.pathname.startsWith("/api/image/")) return realFetch(input, init);
    const method = String((init && init.method) || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    let sent = {};
    try { sent = init && typeof init.body === "string" ? JSON.parse(init.body) : {}; } catch (e) { sent = {}; /* not JSON: the route answers as for no body */ }
    const [status, out] = answer(u, method, sent);
    return Promise.resolve(new Response(JSON.stringify(out), { status, headers: { "Content-Type": "application/json" } }));
  };

  // Home: offline, over the albums on the phone. Built once the page is there.
  function paintHome() {
    const home = document.getElementById("home-view");
    if (!home || document.getElementById("offline-home")) return;
    const box = document.createElement("section");
    box.id = "offline-home";
    box.className = "home-section";
    const note = document.createElement("div");
    note.className = "offline-note";
    note.textContent = "Offline: Rouen can't be reached. Here is what's on this phone.";
    const head = document.createElement("h2");
    head.className = "home-section-title";
    head.textContent = "Downloaded";
    const row = document.createElement("div");
    row.className = "offline-albums";
    const list = albums();
    if (!list.length) {
      const none = document.createElement("div");
      none.className = "offline-empty";
      none.textContent = "No albums on this phone. Download one from its ⋯ when Rouen can be reached.";
      row.appendChild(none);
    }
    for (const a of list) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "offline-album";
      const img = document.createElement("img");
      img.alt = "";
      img.src = "/api/image/" + encodeURIComponent(a.image_key) + "?size=300";
      const t = document.createElement("span");
      t.className = "offline-album-title";
      t.textContent = a.title;
      const s = document.createElement("span");
      s.className = "offline-album-artist";
      s.textContent = a.subtitle;
      tile.append(img, t, s);
      tile.addEventListener("click", () => {
        const open = /** @type {any} */ (window).__openAlbum;
        if (typeof open === "function") open(a, { source: "search" });
      });
      row.appendChild(tile);
    }
    box.append(note, head, row);
    home.insertBefore(box, home.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintHome);
  else paintHome();

  const style = document.createElement("style");
  style.textContent = `
    #offline-home { margin: 0 0 22px; }
    .offline-note { margin: 0 0 14px; padding: 10px 14px; border-radius: 12px; background: var(--bg-elev-2); color: var(--text-dim); font-size: 14px; }
    .offline-albums { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
    .offline-album { display: flex; flex-direction: column; gap: 4px; background: none; border: 0; padding: 0; color: var(--text); text-align: left; cursor: pointer; }
    .offline-album img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; background: var(--bg-elev-2); }
    .offline-album-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .offline-album-artist { font-size: 13px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .offline-empty { color: var(--text-dim); font-size: 14px; }`;
  (document.head || document.documentElement).appendChild(style);
})();
