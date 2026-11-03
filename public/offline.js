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
 *   - the downloaded albums are the Library, and Home's "Downloaded" (home-downloads.js, a Home row from v1.9.72-t32);
 *   - an album's page is its download, its tracks as they were downloaded, with their lengths (v1.9.72-t32);
 *   - Home's other rows are off (they are Roon's);
 *   - the one zone is "This phone" (v1.9.72-t31): Play Now on an album or a track plays it on the phone's own player
 *     (RouenPhone.localPlay), and Queue and Play Next add to the phone's own queue (localAdd, v1.9.72-t32). The mini
 *     player, Now playing and the Queue screen are phone-local.js's, asked first (RouenLocal.answer);
 *   - every other route answers as empty, so a screen shows nothing rather than an error;
 *   - covers are not asked here: <img> goes to the app, which serves /api/image/dl:<key> from the album's cover.jpg.
 *
 * Home says the phone is offline, over its rows.
 */
(function rouenOffline() {
  "use strict";
  const bridge = /** @type {any} */ (window).RouenPhone;
  if (!bridge || typeof bridge.albums !== "function") return;
  document.documentElement.classList.add("rouen-offline");

  /** The bridge's answer. @param {() => string} f @param {any} none @returns {any} */
  const ask = (f, none) => { try { return JSON.parse(f()); } catch (e) { return none; } };
  /** The albums wholly on the phone, as the page's album tiles (phone-local.js's, loaded before any route is asked). */
  /** @returns {any[]} */
  const albums = () => { const local = /** @type {any} */ (window).RouenLocal; return local ? local.albums() : []; };
  /** An album's page, from its download. @param {URLSearchParams} q */
  function album(q) {
    const title = q.get("title") || "", artist = q.get("subtitle") || "";
    const a = ask(() => bridge.album(title, artist), null);
    if (!a || a.state !== "done") return null;
    return {
      title: a.title, subtitle: a.artist, image_key: "dl:" + a.key, offset: Number(q.get("offset")) || 0,
      actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }, { kind: "play_next", title: "Play Next" }],
      tracks: (a.tracks || []).map((/** @type {any} */ t) => ({ title: t.title, subtitle: a.artist, length: t.length })),
    };
  }

  const HOME_ROWS = ["unplayed", "history", "later", "picks", "random", "library", "lotw", "genres"];
  /** One of the local* calls' answers, as the page's routes answer. @param {any} r @returns {[number, any]} */
  const done = (r) => (r && r.error ? [400, { error: r.error }] : [200, { ok: true }]);
  const failed = { error: "The app could not be asked." };
  /** Play Now plays; Queue and Play Next add to the phone's own queue. @param {any} b @param {string} t @param {string} a @param {string} track */
  function play(b, t, a, track) {
    if (b.kind === "queue" || b.kind === "play_next") return done(ask(() => bridge.localAdd(t, a, track, b.kind === "play_next" ? "1" : "0"), failed));
    return done(ask(() => bridge.localPlay(t, a, track || "0"), failed));
  }
  /** An album's track lengths, as /api/album/track-times answers. @param {URLSearchParams} q */
  function trackTimes(q) {
    const a = ask(() => bridge.album(q.get("title") || "", q.get("artist") || ""), null);
    if (!a || a.state !== "done") return { status: "none" };
    return { status: "ok", tracks: (a.tracks || []).map((/** @type {any} */ t) => ({ title: t.title, seconds: Math.round(Number(t.length) || 0) })) };
  }

  /** @param {URL} u @param {string} method @param {any} body @returns {[number, any]} */
  function answer(u, method, body) {
    const p = u.pathname;
    const local = /** @type {any} */ (window).RouenLocal;
    const own = local ? local.answer(u, method, body) : null;
    if (own) return own;
    if (method === "POST") {
      if (p === "/api/play") return play(body, String(body.title || ""), String(body.subtitle || ""), "");
      if (p === "/api/play-track") return play(body, String(body.album_title || ""), String(body.album_subtitle || ""), String(Number(body.track) || 0));
      return [503, { error: "Rouen can't be reached." }];
    }
    if (p === "/api/choices") return [200, { made: true, accounts: false, native: false }];
    // The page waits for Rouen to be paired with Roon before it shows Home: offline, what there is to show is here.
    if (p === "/api/status") return [200, { paired: true }];
    if (p === "/api/settings/home-rows") return [200, { rows: [{ id: "downloads", on: true }, ...HOME_ROWS.map((id) => ({ id, on: false }))] }];
    if (p === "/api/zones") return [200, { zones: local ? [local.zone()] : [] }];
    if (p === "/api/album/track-times") return [200, trackTimes(u.searchParams)];
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

  // Home: it says it is offline, over its rows (Downloaded is home-downloads.js's).
  function paintHome() {
    const home = document.getElementById("home-view");
    if (!home || document.getElementById("offline-home")) return;
    const note = document.createElement("div");
    note.id = "offline-home";
    note.className = "offline-note";
    note.textContent = albums().length ? "Offline: Rouen can't be reached. Here is what's on this phone."
      : "Offline: Rouen can't be reached, and there are no albums on this phone. Download one from its ⋯ when Rouen can be reached.";
    home.insertBefore(note, home.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintHome);
  else paintHome();

  const style = document.createElement("style");
  style.textContent = `
    .offline-note { margin: 0 0 14px; padding: 10px 14px; border-radius: 12px; background: var(--bg-elev-2); color: var(--text-dim); font-size: 14px; }`;
  (document.head || document.documentElement).appendChild(style);
})();
