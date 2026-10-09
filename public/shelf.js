/*
 * shelf.js — the /shelf page (v1.9.1).
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Flicking through a record collection:
 *  - the whole library arrives once (/api/shelf/albums, snapshot only) and
 *    every choice on the left is applied here, so the counts on the tiles move
 *    with the finger rather than a round trip behind it;
 *  - genres OR among themselves, artists' letters OR among themselves, and the
 *    two narrow each other (Rock or Jazz, by an artist under B);
 *  - Random puts what is chosen in a random order, as the Random albums
 *    screen does;
 *  - the shelf revolves: a short swipe moves one album, a swipe held out keeps
 *    it turning that way until the finger lifts, a hard flick spins it and it
 *    lands somewhere three seconds later;
 *  - three looks, kept per device: covers, spines, a carousel.
 *
 * The motion is computed here, frame by frame (a critically damped spring, a
 * cubic spin), not left to CSS transitions: a revolving shelf has to be
 * caught mid-turn and its position known at every frame.
 */

(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mod = (a, n) => ((a % n) + n) % n;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }   // private browsing: the defaults
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private browsing: remembered for this visit only */ } }

  // ---- The remote's theme, as this device chose it -------------------------
  document.documentElement.dataset.theme = storeGet("rra-theme-v2") === "brass-light" ? "light" : "dark";
  {
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (meta && bg) meta.setAttribute("content", bg);
  }

  // ---- The window must never be scrolled (the remote's v1.8.45 pin) ---------
  // Opened from the home-screen app, Shelf runs in its standalone window, with
  // live safe-area insets — and iOS can leave that window scrolled by the top
  // inset after a rotation, so every tap is hit-tested that far below what is
  // drawn and nothing seems to answer. This page never scrolls its window (the
  // body is overflow: hidden, only the tile list scrolls), so a non-zero offset
  // is never a position anyone wanted. app.js explains the readout that found it.
  const pinWindow = () => {
    if (!window.scrollX && !window.scrollY) return;
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };
  const pinAfterSettle = () => { pinWindow(); setTimeout(pinWindow, 300); setTimeout(pinWindow, 1000); };
  window.addEventListener("scroll", pinWindow, { passive: true });
  window.addEventListener("pageshow", pinWindow, { passive: true });
  window.addEventListener("orientationchange", pinAfterSettle, { passive: true });
  window.addEventListener("resize", pinAfterSettle, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", pinAfterSettle, { passive: true });
    window.visualViewport.addEventListener("scroll", pinWindow, { passive: true });
  }

  // ---- No zoom (v1.9.3) -------------------------------------------------------
  // A pinch on a shelf you flick through is meant for the shelf. The viewport
  // meta says so where a browser listens (Chrome on Android); iOS Safari has
  // ignored user-scalable=no since iOS 10, so the pinch is stopped here: its
  // own gesture events, any two-finger move, and a trackpad pinch on a
  // desktop (a wheel event with ctrlKey). Double-tap zoom is touch-action:
  // manipulation in shelf.css.
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener("touchmove", (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  async function jget(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      let why = "";
      try { why = (await r.json()).error || ""; } catch (x) { /* no JSON body: the status says enough */ }
      const e = new Error(why || "HTTP " + r.status); e.status = r.status; throw e;
    }
    return r.json();
  }

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(["#", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7.5"/></svg>';
  const DISC = '<svg class="disc" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".16"/><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const SHUFFLE = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';
  // Spine colours before a cover has been read for its own.
  const SPINE_FALLBACK = ["#2f3a4a", "#4a2f35", "#2f4a3c", "#4a432f", "#3a2f4a", "#25343a", "#463026", "#33363b"];
  const imageUrl = (key, size) => "/api/image/" + encodeURIComponent(key) + "?size=" + size;

  // ---- Library ---------------------------------------------------------------
  let genres = [];          // [{ name, count }], commonest first
  let albums = [];          // [{ o, t, a, k, g, b }] in artist order
  let libRev = null;        // /api/live's library revision the list was read at
  let ready = false;
  let fans = [];            // per genre: up to three image keys for its tile

  // ---- Choices ---------------------------------------------------------------
  const sel = { genre: new Set(), artist: new Set(), random: new Set() };
  let chosen = [];          // [cat, id] in the order chosen: the chips, and Undo
  let tab = "genre";
  let shuffleSeed = 1;
  // What the shelf holds now: the choices applied to the library.
  let list = [], N = 0, listVer = 0, tabs = [];
  let waitingText = "Reading your library…";

  function passes(a, skip) {
    if (skip !== "genre" && sel.genre.size && !a.g.some((i) => sel.genre.has(i))) return false;
    if (skip !== "artist" && sel.artist.size && !sel.artist.has(a.b)) return false;
    return true;
  }
  function seededShuffle(arr, seed) {
    const r = rng(seed);
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function buildList() {
    const out = albums.filter((a) => passes(a));
    return sel.random.has("order") ? seededShuffle(out, shuffleSeed) : out;
  }
  function labelOf(cat, id) {
    if (cat === "genre") return (genres[id] || { name: "?" }).name;
    if (cat === "random") return "Random order";
    return id;
  }
  function newSeed() { return ((Math.random() * 4294967295) >>> 0) || 1; }
  function toggle(cat, id) {
    const s = sel[cat];
    if (s.has(id)) { s.delete(id); chosen = chosen.filter(([c, i]) => !(c === cat && i === id)); }
    else {
      s.add(id); chosen.push([cat, id]);
      if (cat === "random") shuffleSeed = newSeed();
    }
    refresh();
  }
  function clearCat(cat) { sel[cat].clear(); chosen = chosen.filter(([c]) => c !== cat); refresh(); }
  function clearAll() { for (const k in sel) sel[k].clear(); chosen = []; refresh(); }

  // ---- The selection centre ---------------------------------------------------
  const tilesEl = $("#tiles");
  // keepScroll: a re-read of the library leaves the list where it was scrolled.
  // Every caller follows this with renderPick(), which brings the counts.
  function renderTiles(keepScroll) {
    tilesEl.className = "tiles " + tab;
    let html = "";
    if (!ready) {
      tilesEl.innerHTML = "";
      return;
    }
    if (tab === "genre") {
      html = genres.length ? genres.map((g, i) => `<button class="tile t-genre" type="button" data-cat="genre" data-id="${i}" aria-pressed="false">
          <span class="fan" aria-hidden="true">${(fans[i] || []).map((k, n) => `<span class="m m${n}"><img src="${imageUrl(k, 500)}" alt="" loading="lazy" decoding="async"></span>`).join("")}</span>
          <span class="t-row"><span class="t-name">${esc(g.name)}</span><span class="t-count"></span></span><span class="tick">${TICK}</span></button>`).join("")
        : '<p class="tiles-msg">Genres appear once Rouen has read Roon’s genre list, which it does after each library sync. Artists and Random work now.</p>';
    } else if (tab === "artist") {
      html = LETTERS.map((l) => `<button class="tile t-letter" type="button" data-cat="artist" data-id="${l}" aria-pressed="false" aria-label="Artists under ${l === "#" ? "#: names starting with 0, or with no letter A to Z" : l}">
        <span class="ch">${l}</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`).join("");
    } else {
      html = `<button class="tile t-rand" type="button" data-cat="random" data-id="order" aria-pressed="false">${SHUFFLE}
          <span class="t-row"><span class="t-name">Random order</span></span>
          <span class="t-note">The shelf in a random order, as on the Random albums screen. Only the genres and artists you have chosen, if any.</span><span class="tick">${TICK}</span></button>
        <div class="rand-acts">
          <button class="act" type="button" id="reshuffle">Shuffle again</button>
        </div>
        <button class="spin-big" type="button" id="spin-big">${DISC}<span><b>Spin the shelf</b><span>It lands on something in three seconds</span></span></button>`;
    }
    tilesEl.innerHTML = html;
    if (!keepScroll) $("#tiles-wrap").scrollTop = 0;
  }
  function updateTiles() {
    let gCount = null, lCount = null;
    if (tab === "genre") {
      gCount = new Array(genres.length).fill(0);
      for (const a of albums) if (passes(a, "genre")) for (const i of a.g) gCount[i]++;
    } else if (tab === "artist") {
      lCount = {};
      for (const a of albums) if (passes(a, "artist")) lCount[a.b] = (lCount[a.b] || 0) + 1;
    }
    for (const el of tilesEl.querySelectorAll(".tile")) {
      const cat = el.dataset.cat;
      const id = cat === "genre" ? +el.dataset.id : el.dataset.id;
      el.setAttribute("aria-pressed", sel[cat].has(id) ? "true" : "false");
      const c = el.querySelector(".t-count");
      let n = null;
      if (cat === "genre") n = gCount[id];
      else if (cat === "artist") n = lCount[id] || 0;
      if (c) c.textContent = n === null ? "" : String(n);
      el.classList.toggle("zero", n === 0);
    }
    const re = $("#reshuffle");
    if (re) re.disabled = !sel.random.has("order") || N < 2;
  }
  function renderPick() {
    for (const t of document.querySelectorAll(".tab")) {
      const k = t.dataset.tab;
      t.setAttribute("aria-selected", k === tab ? "true" : "false");
      t.querySelector(".badge").textContent = sel[k].size ? String(sel[k].size) : "";
    }
    const filtered = sel.genre.size || sel.artist.size;
    $("#pick-sum").innerHTML = !ready ? esc(waitingText)
      : filtered ? `<b>${N.toLocaleString()}</b> of ${albums.length.toLocaleString()} albums on the shelf`
      : `The whole library · <b>${albums.length.toLocaleString()}</b> albums`;
    const shown = chosen.length > 7 ? chosen.slice(0, 6) : chosen;
    $("#chips").innerHTML = shown.map(([c, i]) => `<span class="chip">${c === "artist" ? "<i>Artists</i>" : ""}<span>${esc(labelOf(c, i))}</span><button class="x" type="button" data-cat="${c}" data-id="${esc(i)}" aria-label="Remove ${esc(labelOf(c, i))}">×</button></span>`).join("")
      + (chosen.length > 7 ? `<span class="chip more">+${chosen.length - 6} more</span>` : "");
    const cats = new Set(chosen.map(([c]) => c));
    $("#reset-all").classList.toggle("hidden", !(chosen.length >= 2 && cats.size >= 2));
    const n = sel[tab].size;
    $("#sec-note").textContent =
      tab === "random" ? (n ? "On: the shelf is shuffled" : "Tap to shuffle the shelf")
      : n ? `${n} ${tab === "genre" ? (n === 1 ? "genre" : "genres") : (n === 1 ? "letter" : "letters")} chosen`
      : tab === "artist" ? "Tap letters. # holds names that start with 0, or have no letter A–Z."
      : "Tap to choose. Choose as many as you like.";
    $("#sec-clear").classList.toggle("hidden", n < 2);
    updateTiles();
  }
  // A genre's little fan of covers: one that will not load is left out.
  tilesEl.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.parentNode.remove(); }, true);
  tilesEl.addEventListener("click", (e) => {
    if (e.target.closest("#spin-big")) { spin(1, 2.4); return; }
    if (e.target.closest("#reshuffle")) { shuffleSeed = newSeed(); refresh(); return; }
    const t = e.target.closest(".tile");
    if (t) toggle(t.dataset.cat, t.dataset.cat === "genre" ? +t.dataset.id : t.dataset.id);
  });
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => { tab = t.dataset.tab; renderTiles(); renderPick(); });
  $("#chips").addEventListener("click", (e) => {
    const x = e.target.closest(".x");
    if (x) toggle(x.dataset.cat, x.dataset.cat === "genre" ? +x.dataset.id : x.dataset.id);
  });
  $("#sec-clear").addEventListener("click", () => clearCat(tab));
  $("#reset-all").addEventListener("click", clearAll);
  $("#note-reset").addEventListener("click", clearAll);
  // Undo takes back the last choice that NARROWED the shelf: Random only
  // reorders it, so undoing that would leave an empty shelf empty.
  $("#undo").addEventListener("click", () => {
    const last = [...chosen].reverse().find(([c]) => c !== "random");
    if (last) toggle(last[0], last[1]);
  });

  // ---- The shelf ----------------------------------------------------------------
  const stage = $("#stage"), scene = $("#scene"), rig = $("#rig"), shelfEl = $("#shelf"), screenEl = $("#screen");
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LOOKS = ["covers", "spines", "ring"];
  let look = LOOKS.indexOf(storeGet("rra-shelf-look")) > -1 ? storeGet("rra-shelf-look") : "covers";
  let W = 0, H = 0, S = 200, T = 2, TOP = 0, stepPx = 100, K = 6, slots = 10, R = 0;
  let p = 0, vp = 0, target = 0, mode = "idle";
  let spinA = null, drag = null, flippedV = null, raf = 0, lastT = 0, wheelTimer = 0, shownIdx = -1, fadeT0 = 0;
  const live = new Map(), pool = [];
  // Moving faster than a cover can be looked at: a spin, a held swipe. No
  // cover is fetched for an album flying past — the plain sleeve shows, and
  // its picture comes once the shelf slows (a spin passes up to a hundred
  // albums, and every one would otherwise be a 500px download on the way).
  let fastNow = false;
  const wrap = () => N > 3;
  // Cover colours, read off each cover as it arrives, for its spine and back.
  const colourOf = new Map();

  function computeTabs() {
    const alpha = !sel.random.has("order");
    tabs = list.map((a, i) => (alpha && (i === 0 || list[i - 1].b !== a.b) ? a.b : ""));
  }

  function layout() {
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height;
    if (look === "ring") {
      // A carousel seen from a little above: the front arc faces you, the backs
      // of the cases show at the far side of the ring.
      slots = wrap() ? clamp(N, 6, 12) : 6;
      const tanA = Math.tan(Math.PI / slots);
      S = Math.round(Math.max(90, Math.min(H * 0.37, (W * 0.9 * tanA) / 1.2, 420)));
      R = (S * 0.6) / tanA; T = 2;
      TOP = Math.round(H / 2 - S / 2);
      stepPx = Math.max(60, S * 1.1);
      scene.style.perspective = Math.round(S * 5) + "px";
      scene.style.perspectiveOrigin = `50% ${Math.round(H * 0.42)}px`;
      rig.style.transform = `translateZ(${(-R).toFixed(1)}px) rotateX(-17deg) translateZ(${R.toFixed(1)}px)`;
      const rf = $("#ringfloor");
      rf.style.width = Math.round(2 * R + S) + "px";
      rf.style.height = Math.round(0.62 * R + S * 0.4) + "px";
      rf.style.top = Math.round(H / 2 + S * 0.62) + "px";
    } else if (look === "spines") {
      S = Math.round(Math.max(110, Math.min(H * 0.72, W * 0.42, 600)));
      T = Math.max(14, Math.round(S * 0.115));
      TOP = Math.round((H - S * 1.075) * 0.62);
      stepPx = Math.max(56, S * 0.3);
      K = Math.min(30, Math.ceil((W / 2 - S / 2) / (T * 1.08)) + 2);
      scene.style.perspective = Math.round(S * 3.2) + "px";
      scene.style.perspectiveOrigin = `50% ${Math.round(TOP + S * 0.58)}px`;
      rig.style.transform = "none";
    } else {
      S = Math.round(Math.max(110, Math.min(H * 0.64, W * 0.44, 600)));
      T = 2;
      TOP = Math.round((H - S * 1.22) * 0.56);
      stepPx = Math.max(60, S * 0.42);
      K = Math.min(12, Math.ceil((W / 2 + S * 0.3 - S * 0.62) / (S * 0.24)) + 1);
      scene.style.perspective = Math.round(S * 3.2) + "px";
      scene.style.perspectiveOrigin = `50% ${Math.round(TOP + S * 0.5)}px`;
      rig.style.transform = "none";
    }
    stage.style.setProperty("--S", S + "px");
    stage.style.setProperty("--t", T + "px");
    stage.style.setProperty("--top", TOP + "px");
    kick();
  }

  function place(d) {
    const ad = Math.abs(d), s = d < 0 ? -1 : 1, a = Math.min(1, ad);
    let tf, op;
    if (look === "ring") {
      tf = `translateZ(${(-R).toFixed(1)}px) rotateY(${(d * 360 / slots).toFixed(3)}deg) translateZ(${R.toFixed(1)}px)`;
      const half = (wrap() ? Math.min(N, slots) : slots) / 2;
      op = clamp((half - ad) / 0.7, 0, 1) * (Math.abs(d * 360 / slots) > 95 ? 0.82 : 1);
    } else if (look === "spines") {
      const gap = Math.max(2, T * 0.08);
      const first = S / 2 + T / 2 + gap * 2;
      const ea = 1 - (1 - a) * (1 - a);           // slides out a little before it turns
      const x = s * (ea * first + Math.max(0, ad - 1) * (T + gap));
      const z = (S * 0.1 - T / 2) * (1 - a) - (S / 2) * a;
      const ry = -s * 90 * Math.pow(a, 1.35);
      tf = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg)`;
      op = edgeFade(ad);
    } else {
      const x = ad <= 1 ? d * S * 0.62 : s * (S * 0.62 + (ad - 1) * S * 0.24);
      const z = ad <= 1 ? S * 0.08 - a * S * 0.58 : -S * 0.5 - (ad - 1) * S * 0.035;
      const ry = -s * a * 62;
      tf = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg)`;
      op = edgeFade(ad);
    }
    return { tf, op };
  }
  function edgeFade(ad) {
    let op = clamp((K + 0.5 - ad) / 1.2, 0, 1);
    if (wrap() && N < 2 * K + 2) op = Math.min(op, clamp((N / 2 - ad) / 0.6, 0, 1));
    return op;
  }
  // Which albums are drawn: a window around the front one. A short shelf (four
  // or more) still revolves, each album drawn once and fading out where the
  // loop closes; three or fewer simply stand in a row.
  function windowRange() {
    if (!N) return [0, -1];
    if (!wrap()) return [0, N - 1];
    const span = look === "ring" ? Math.min(N, slots) : Math.min(N, 2 * K + 2);
    const start = Math.floor(p - span / 2) + 1;
    return [start, start + span - 1];
  }

  function spineColour(a) {
    const c = a.k && colourOf.get(a.k);
    if (c) return c;
    return { bg: SPINE_FALLBACK[hash(a.t + "|" + a.a) % SPINE_FALLBACK.length], fg: "#f2efe6" };
  }
  const coverImg = (a) => `<img src="${imageUrl(a.k, 500)}" alt="" decoding="async" draggable="false" data-k="${esc(a.k)}">`;
  function coverHTML(a, withImg) {
    const blank = `<div class="blank"><b>${esc(a.t)}</b><span>${esc(a.a)}</span></div>`;
    return a.k && withImg ? blank + coverImg(a) : blank;
  }
  function spineHTML(a, letter) {
    return `<div class="sp">${letter ? `<span class="sp-tab">${esc(letter)}</span>` : ""}<span class="sp-txt"><span class="sp-ar">${esc(a.a)}</span><span class="sp-ti">${esc(a.t)}</span></span><i class="sp-mark"></i></div>`;
  }
  function barcode(seed) {
    const r = rng(seed); const stops = []; let x = 0, k = 0;
    while (x < 100) { const w = 0.8 + r() * 2.6; stops.push(`${k++ % 2 ? "#fff" : "#111"} ${x.toFixed(1)}% ${(x + w).toFixed(1)}%`); x += w; }
    return `linear-gradient(90deg, ${stops.join(",")})`;
  }
  // The back of the case: its real track list, read from the Core when the
  // case is turned over (one album open, on a tap — never while flicking).
  const tracksOf = new Map();   // album key → { tracks } | { error } | "loading"
  const albumKeyOf = (a) => a.o + "|" + a.t + "|" + a.a;
  function backHTML(a) {
    const st = tracksOf.get(albumKeyOf(a));
    let body;
    if (st && st.tracks) {
      body = st.tracks.length
        ? `<ol class="bk-tracks${st.tracks.length <= 10 ? " one" : ""}">${st.tracks.map((t, i) => `<li><i>${i + 1}</i><span>${esc(t.title)}</span></li>`).join("")}</ol>`
        : '<p class="bk-msg">Roon lists no tracks for this album.</p>';
    } else if (st && st.error) {
      body = `<p class="bk-msg">${esc(st.error)}</p>`;
    } else if (st === "loading") {
      body = '<p class="bk-msg">Reading the track list…</p>';
    } else {
      body = "";   // never turned over: the far side of the carousel shows only the name
    }
    return `<div class="bk"><div class="bk-ar">${esc(a.a)}</div><div class="bk-ti">${esc(a.t)}</div>${body}
      <div class="bk-foot"><span class="bk-bar" style="background:${barcode(hash(a.t + a.a))}"></span><span class="bk-cat">Tap to turn back</span></div></div>`;
  }
  // Every drawn case of this album — by identity, so a case drawn from a list
  // read again while the tracks were on their way still gets them.
  function repaintBacks(key) {
    for (const [, el] of live) if (el._backOn && el._album && albumKeyOf(el._album) === key) el._back.innerHTML = backHTML(el._album);
  }
  async function readTracks(a) {
    const key = albumKeyOf(a);
    if (tracksOf.has(key)) return;
    tracksOf.set(key, "loading");
    repaintBacks(key);
    try {
      const j = await jget(`/api/album?offset=${encodeURIComponent(a.o)}&title=${encodeURIComponent(a.t)}&subtitle=${encodeURIComponent(a.a)}`);
      tracksOf.set(key, { tracks: Array.isArray(j.tracks) ? j.tracks : [] });
    } catch (e) {
      // Shown, then forgotten, so the next turn-over asks again (the Core may
      // be back by then).
      tracksOf.set(key, { error: e.status === 503 ? "Roon isn’t connected, so the track list can’t be read." : "The track list couldn’t be read." });
      setTimeout(() => { if (tracksOf.get(key) && tracksOf.get(key).error) tracksOf.delete(key); }, 4000);
    }
    repaintBacks(key);
  }

  function makeNode() {
    const el = document.createElement("div");
    el.className = "it";
    el.innerHTML = '<div class="box"><div class="face front"></div><div class="face back"></div><div class="face side l"></div><div class="face side r"></div></div>';
    const f = el.firstChild.children;
    el._front = f[0]; el._back = f[1]; el._l = f[2]; el._r = f[3];
    rig.appendChild(el);
    return el;
  }
  function paintColour(el, a) {
    const c = spineColour(a);
    el.style.setProperty("--sc", c.bg);
    el.style.setProperty("--sf", c.fg);
  }
  function fill(el, a, i) {
    el._album = a;
    el._front.innerHTML = coverHTML(a, !fastNow);
    el._imgOn = !fastNow;
    // A back is drawn only where it can be seen: round the far side of the
    // carousel, or once the case is turned over (turnOver).
    el._backOn = look === "ring";
    el._back.innerHTML = el._backOn ? backHTML(a) : "";
    if (look === "spines") { const sp = spineHTML(a, tabs[i]); el._l.innerHTML = sp; el._r.innerHTML = sp; }
    else { el._l.textContent = ""; el._r.textContent = ""; }
    paintColour(el, a);
  }
  function clearNodes() {
    for (const [, el] of live) { el.style.display = "none"; el.classList.remove("flipped"); el._key = null; pool.push(el); }
    live.clear();
  }
  function render() {
    const [lo, hi] = windowRange();
    // a new shelf fades in over 420 ms after the choices change
    let fade = 1;
    if (fadeT0) { fade = clamp((performance.now() - fadeT0) / 420, 0, 1); if (fade >= 1) fadeT0 = 0; fade = 1 - (1 - fade) * (1 - fade); }
    for (const [v, el] of live) if (v < lo || v > hi) { el.style.display = "none"; el.classList.remove("flipped"); pool.push(el); live.delete(v); }
    for (let v = lo; v <= hi; v++) {
      let el = live.get(v);
      const i = mod(v, N);
      if (!el) { el = pool.pop() || makeNode(); el.style.display = ""; live.set(v, el); }
      const key = listVer + ":" + i + ":" + look;
      if (el._key !== key) { fill(el, list[i], i); el._key = key; }
      else if (!el._imgOn && !fastNow) {
        // slowed down: the cover it was owed
        if (el._album.k) el._front.insertAdjacentHTML("beforeend", coverImg(el._album));
        el._imgOn = true;
      }
      el.dataset.v = String(v);
      const pl = place(v - p);
      pl.op *= fade;
      el.style.transform = pl.tf;
      el.style.setProperty("--op", pl.op.toFixed(3));
      el.style.visibility = pl.op < 0.002 ? "hidden" : "";
      // Spines: a box turned edge-on shows its spine, never its front — so the
      // front is not painted (its cover still loads, for the spine's colour).
      const edge = look === "spines" && Math.abs(v - p) >= 1.2;
      if (el.classList.contains("edge") !== edge) el.classList.toggle("edge", edge);
      const fl = flippedV === v && Math.abs(v - p) < 0.5;
      if (el.classList.contains("flipped") !== fl) el.classList.toggle("flipped", fl);
    }
    if (flippedV !== null && Math.abs(flippedV - p) >= 0.5) flippedV = null;
  }
  // A cover that will not load shows the plain sleeve beneath it; one that does
  // gives its spine and its back its own colour.
  rig.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
  // The colour is read (a decode on the main thread) only where it is used: the
  // Spines and the carousel's backs. Covers reads it when a case is turned over.
  rig.addEventListener("load", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.dataset.k || colourOf.has(img.dataset.k) || look === "covers") return;
    const c = averageColour(img);
    if (!c) return;
    colourOf.set(img.dataset.k, c);
    for (const [, el] of live) if (el._album && el._album.k === img.dataset.k) paintColour(el, el._album);
  }, true);
  let sampler = null;
  function averageColour(img) {
    try {
      sampler = sampler || document.createElement("canvas");
      sampler.width = sampler.height = 6;
      const ctx = sampler.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 6, 6);
      const d = ctx.getImageData(0, 0, 6, 6).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      // a touch deeper than the average, the way a printed spine reads
      const k = 0.82;
      const bg = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
      const lum = 0.2126 * r * k + 0.7152 * g * k + 0.0722 * b * k;
      return { bg, fg: lum > 150 ? "#17191c" : "#f2efe6" };
    } catch (e) {
      return null;   // a picture this page may not read: the spine keeps its stand-in colour
    }
  }

  // ---- Motion: a critically damped spring, a 3-second spin, and the finger ----
  const OMEGA = 2 * Math.PI / 420;          // rad per ms
  const SPIN_MS = reduced ? 700 : 3000;
  function kick() { if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    const dt = lastT ? Math.min(50, now - lastT) : 16;
    lastT = now;
    const before = p;
    if (mode === "spring") stepSpring(dt);
    else if (mode === "spin") stepSpin(now);
    else if (mode === "drag") stepDrag(now, dt);
    if (mode !== "spin" && spinA === null && screenEl.classList.contains("spinning")) screenEl.classList.remove("spinning");
    const speed = (Math.abs(p - before) / dt) * 1000;
    shelfEl.classList.toggle("fast", speed > 16 && mode === "spin");
    fastNow = speed > 8 && (mode === "spin" || mode === "drag");
    if (N) render();
    // dimmed while it flies past, so not rewritten every frame either
    if (!fastNow) updateInfo(false);
    if (mode !== "idle" || fadeT0) raf = requestAnimationFrame(frame);
  }
  function stepSpring(dt) {
    let left = dt;
    while (left > 0) {
      const h = Math.min(8, left); left -= h;
      const acc = -OMEGA * OMEGA * (p - target) - 2 * OMEGA * vp;
      vp += acc * h; p += vp * h;
    }
    if (Math.abs(p - target) < 6e-4 && Math.abs(vp) < 4e-5) { p = target; vp = 0; mode = "idle"; settled(); }
  }
  function settleTo(t) {
    target = wrap() ? t : clamp(t, 0, N - 1);
    vp = clamp(vp, -0.02, 0.02);
    mode = "spring"; kick();
  }
  function spin(dir, strength) {
    if (N < 2) {
      toast(N ? "There’s only one album on this shelf" : "Nothing on the shelf to spin");
      if (N) settleTo(Math.round(p));   // a flick on one album still comes to rest on it
      return;
    }
    flippedV = null;
    let D;
    if (!wrap()) {
      let t = Math.floor(Math.random() * N);
      if (t === Math.round(p)) t = (t + 1) % N;
      D = t - p;
    } else {
      const base = clamp(strength * 24, 26, 80);
      D = dir * (Math.round(base) + Math.floor(Math.random() * Math.min(N, 40)));
      D = Math.round(p + D) - p;
    }
    spinA = { p0: p, D, t0: performance.now(), T: wrap() ? SPIN_MS : 900 };
    // Where it will land is known now: fetch those covers first, ahead of the
    // ones it passes (which are not fetched at all while it is fast).
    const end = Math.round(p + D);
    for (let k = -3; k <= 3; k++) { const a = list[mod(end + k, N)]; if (a && a.k) new Image().src = imageUrl(a.k, 500); }
    mode = "spin"; vp = 0;
    screenEl.style.setProperty("--spin-ms", spinA.T + "ms");
    screenEl.classList.remove("spinning"); void screenEl.offsetWidth; screenEl.classList.add("spinning");
    kick();
  }
  function stepSpin(now) {
    // clamped below too: a frame's time is when the frame BEGAN, which can be
    // a moment before the tap that started the spin
    const u = clamp((now - spinA.t0) / spinA.T, 0, 1);
    p = spinA.p0 + spinA.D * (1 - Math.pow(1 - u, 3));
    if (u >= 1) { p = Math.round(p); target = p; spinA = null; mode = "idle"; screenEl.classList.remove("spinning"); landed(); }
  }
  function stopSpin() {
    spinA = null;
    clearTimeout(wheelTimer);
    screenEl.classList.remove("spinning");
  }
  function rubber(x) { if (x < 0) return x * 0.3; if (x > N - 1) return N - 1 + (x - (N - 1)) * 0.3; return x; }

  stage.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || !N) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a pointer the browser no longer tracks: the drag still works while it stays over the stage */ }
    const caught = mode === "spin" || (mode === "spring" && Math.abs(vp) > 0.003);
    stopSpin();
    closeZones();
    closeVol();
    const now = performance.now();
    drag = { id: e.pointerId, x0: e.clientX, x: e.clientX, p0: p, t0: now, still: now, moved: false, caught, samples: [[now, e.clientX]], shuttle: false, acc: 0, rate: 0 };
    mode = "drag"; vp = 0;
    stage.classList.add("grabbing");
    kick();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    if (Math.abs(e.clientX - drag.x) > 1.5) drag.still = now;
    drag.x = e.clientX;
    drag.samples.push([now, e.clientX]);
    while (drag.samples.length > 2 && now - drag.samples[0][0] > 120) drag.samples.shift();
    if (!drag.moved && Math.abs(drag.x - drag.x0) > 8) { drag.moved = true; flippedV = null; }
    applyDrag();
    kick();
  });
  function applyDrag() {
    const raw = drag.p0 - (drag.x - drag.x0) / stepPx + drag.acc;
    p = wrap() ? raw : rubber(raw);
  }
  // Swipe and HOLD: once the finger is well out and has stopped, the shelf keeps
  // turning that way, faster the further out it is held, until the finger lifts.
  function stepDrag(now, dt) {
    if (!drag) { mode = "idle"; return; }   // the finger is gone however it went: nothing to follow
    const dx = drag.x - drag.x0;
    const far = Math.abs(dx) > Math.max(80, W * 0.2);
    if (!drag.shuttle && drag.moved && far && wrap() && now - drag.still > 200) drag.shuttle = true;
    if (drag.shuttle) {
      const lim = Math.max(40, W * 0.08);
      let rate = 0;
      if (Math.abs(dx) > lim) rate = -Math.sign(dx) * (3 + 15 * Math.pow(clamp((Math.abs(dx) - lim) / (W * 0.35), 0, 1), 1.3));
      drag.rate = rate;
      drag.acc += (rate * dt) / 1000;
      shuttleOn(rate === 0 ? null : dx < 0 ? "l" : "r");
      applyDrag();
    }
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    stage.classList.remove("grabbing"); shuttleOn(null);
    if (e.type === "pointercancel") { settleTo(Math.round(p)); return; }
    const now = performance.now();
    const dx = d.x - d.x0;
    let v = 0;   // px per ms over the last ~100 ms; a finger that stopped before lifting has none
    const s = d.samples.filter((q) => now - q[0] < 100);
    if (s.length >= 2 && now - s[s.length - 1][0] < 80) v = (s[s.length - 1][1] - s[0][1]) / Math.max(8, s[s.length - 1][0] - s[0][0]);
    if (!d.moved) { if (d.caught) settleTo(Math.round(p)); else tapAt(e.clientX, e.clientY); return; }
    if (d.shuttle) { vp = d.rate / 1000; settleTo(Math.round(p + Math.sign(d.rate) * 0.4)); return; }
    if (Math.abs(v) >= 1.2 && Math.abs(dx) >= Math.max(100, W * 0.11) && now - d.t0 < 700) { spin(v < 0 ? 1 : -1, Math.abs(v)); return; }
    vp = -v / stepPx;
    if (Math.abs(dx) < clamp(W * 0.16, 80, 240)) { settleTo(Math.round(d.p0) + (dx < 0 ? 1 : -1)); return; }
    settleTo(Math.round(p + vp * 240));
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  // Where capture failed, the finger can lift off the stage: the window still
  // hears it, so a held swipe never keeps turning on its own.
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  stage.addEventListener("lostpointercapture", (e) => { if (drag && e.pointerId === drag.id) endDrag({ type: "pointerup", pointerId: e.pointerId, clientX: drag.x, clientY: 0 }); });
  // Which cover is under the finger. Measured from each item's own projected
  // box rather than elementFromPoint, which does not hit-test reliably inside a
  // preserve-3d scene; where boxes overlap, the one nearest the front wins.
  function itemAt(x, y) {
    let best = null, bestD = Infinity;
    for (const [v, el] of live) {
      if (el.style.visibility === "hidden") continue;
      const d = v - p, ad = Math.abs(d);
      let face = el._front;
      if (look === "spines" && ad >= 0.5) face = d < 0 ? el._l : el._r;
      else if (look === "ring" && Math.abs(d * 360 / slots) > 90) face = el._back;
      const r = face.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && ad < bestD) { best = v; bestD = ad; }
    }
    return best;
  }
  function turnOver(v) {
    if (mode === "spin") stopSpin();
    flippedV = flippedV === v ? null : v;
    const el = flippedV !== null ? live.get(v) : null;
    if (el && el._album) {
      const a = el._album, img = el._front.querySelector("img");
      if (a.k && !colourOf.has(a.k) && img && img.complete && img.naturalWidth) {
        const c = averageColour(img);
        if (c) { colourOf.set(a.k, c); paintColour(el, a); }
      }
      el._backOn = true;
      el._back.innerHTML = backHTML(a);
      readTracks(a);
    }
    // still drifting in from a swipe: finish on the album, squarely
    if (Math.abs(v - p) > 1e-3) { vp = 0; settleTo(v); } else kick();
  }
  function tapAt(x, y) {
    const v = itemAt(x, y);
    if (v === null) { settleTo(Math.round(p)); return; }
    if (Math.abs(v - p) < 0.5) turnOver(v);
    else settleTo(v);
  }
  stage.addEventListener("wheel", (e) => {
    if (!N) return;
    e.preventDefault();
    if (drag) return;   // a finger is on the shelf: it decides
    if (mode === "spin") stopSpin();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const notch = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
    if (notch) { const base = mode === "spring" ? target : Math.round(p); vp = 0; settleTo(base + Math.sign(delta)); return; }
    mode = "wheel";
    p += delta / (stepPx * 0.9);
    if (!wrap()) p = rubber(p);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { vp = 0; settleTo(Math.round(p)); }, 120);
    kick();
  }, { passive: false });
  // A TV remote or a keyboard: the arrows step, Shift+arrow jumps ten, Enter
  // turns the case over, S spins.
  stage.addEventListener("keydown", (e) => {
    if (!N) return;
    const step = (n) => { if (mode === "spin") stopSpin(); const base = mode === "spring" ? target : Math.round(p); vp = 0; settleTo(base + n); };
    if (e.key === "ArrowRight") { step(e.shiftKey ? 10 : 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { step(e.shiftKey ? -10 : -1); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === " ") { turnOver(Math.round(p)); e.preventDefault(); }
    else if (e.key === "s" || e.key === "S") spin(1, 2.4);
  });
  $("#spin-btn").addEventListener("click", () => spin(1, 2.4));
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(stage);
  else window.addEventListener("resize", layout);

  function shuttleOn(side) { $("#sh-l").classList.toggle("on", side === "l"); $("#sh-r").classList.toggle("on", side === "r"); }
  let toastTimer = 0;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
  }
  const centre = () => (N ? list[mod(Math.round(p), N)] : null);

  // ---- What the shelf says about itself --------------------------------------
  function showNote(title, why, withActions) {
    $("#note").classList.remove("hidden");
    $("#note-title").textContent = title;
    $("#note-why").textContent = why;
    $("#note-actions").classList.toggle("hidden", !withActions);
    $("#info").classList.add("hidden");
    stage.classList.add("empty");
  }
  function hideNote() {
    $("#note").classList.add("hidden");
    $("#info").classList.remove("hidden");
    stage.classList.remove("empty");
  }
  function updateInfo(force) {
    if (!ready) return;
    if (N === 0) {
      const words = chosen.filter(([c]) => c !== "random").map(([c, i]) => (c === "artist" ? "artists under " + labelOf(c, i) : labelOf(c, i)));
      const joined = words.length > 1 ? words.slice(0, -1).join(", ") + " and " + words[words.length - 1] : words[0] || "";
      if (albums.length) showNote("Nothing on this shelf", `No albums match ${joined}.`, true);
      else showNote("The shelf is empty", "Rouen hasn’t found any albums in your Roon library yet.", false);
      $("#shelf-pos").textContent = "0 albums";
      shownIdx = -1;
      return;
    }
    if (!$("#note").classList.contains("hidden")) hideNote();
    const i = mod(Math.round(p), N);
    if (i === shownIdx && !force) return;
    shownIdx = i;
    const a = list[i];
    $("#info-title").textContent = a.t;
    $("#info-artist").textContent = a.a;
    $("#info-meta").textContent = a.g.map((g) => (genres[g] || { name: "" }).name).filter(Boolean).join(" · ");
    $("#shelf-pos").textContent = `${(i + 1).toLocaleString()} of ${N.toLocaleString()}`;
    stage.setAttribute("aria-label", `${a.t} by ${a.a}, ${i + 1} of ${N}. Arrow keys move along the shelf, Enter turns the case over.`);
  }
  function settled() { const a = centre(); if (a) $("#live").textContent = `${a.t} by ${a.a}`; }
  function landed() {
    settled();
    const el = live.get(Math.round(p));
    if (el) { el._front.classList.remove("landed"); void el._front.offsetWidth; el._front.classList.add("landed"); }
    const a = centre();
    if (a) toast(`Landed on ${a.t}`);
  }
  // opts.reread: the library was read again — the same place, no fade-in.
  function refresh(opts) {
    const reread = !!(opts && opts.reread);
    const cur = centre();
    list = buildList(); N = list.length; listVer++;
    computeTabs();
    let idx = -1;
    if (cur) {
      idx = list.indexOf(cur);
      // after a re-read the records are new objects: find the same album again
      if (idx < 0) idx = list.findIndex((a) => a.t === cur.t && a.a === cur.a);
    }
    if (idx < 0) idx = 0;
    p = target = idx; vp = 0; mode = "idle"; flippedV = null;
    stopSpin();
    // a finger still down belonged to the shelf that was: let it go
    if (drag) { drag = null; stage.classList.remove("grabbing"); shuttleOn(null); }
    clearNodes();
    layout();
    fadeT0 = reduced || reread ? 0 : performance.now();
    $("#shelf-order").textContent = sel.random.has("order") ? "Random order" : "A → Z by artist";
    $("#spin-btn").disabled = N < 2;
    renderPick();
    updateInfo(true);
  }

  // ---- Looks ---------------------------------------------------------------------
  function setLook(l) {
    look = l;
    storeSet("rra-shelf-look", l);
    stage.className = "stage look-" + l + (stage.classList.contains("empty") ? " empty" : "");
    for (const b of document.querySelectorAll("#looks button")) b.setAttribute("aria-pressed", b.dataset.look === l ? "true" : "false");
    flippedV = null; mode = "idle"; p = target = Math.round(p);
    stopSpin();
    clearNodes(); layout();
  }
  $("#looks").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.look) setLook(b.dataset.look); });

  // ---- Playing ---------------------------------------------------------------------
  const ZONE_KEY = "rra-shelf-zone";
  let zoneId = new URLSearchParams(location.search).get("zone") || storeGet(ZONE_KEY) || storeGet("rra-zone") || null;
  let zoneList = [];
  let zoneName = "";
  let zoneKnown = false;    // zoneId is a zone the server answered for
  let firstNowPlaying = true;
  // Throws when Rouen doesn't answer: that is a blip, not "no zones", and the
  // callers keep what they had.
  async function pickZone() {
    const j = await jget("/api/zones");
    zoneList = j.zones || [];
    if (!zoneList.length) return null;
    const hit = zoneId && zoneList.find((z) => z.zone_id === zoneId || (z.display_name || "").toLowerCase() === String(zoneId).toLowerCase());
    if (hit) return hit.zone_id;
    const active = zoneList.find((z) => z.state === "playing" || z.state === "loading");
    return (active || zoneList[0]).zone_id;
  }
  async function pollNowPlaying() {
    try {
      if (!zoneKnown) {
        const resolved = await pickZone();
        if (!resolved) { zoneName = ""; paintNowPlaying(null, null); return; }
        zoneId = resolved;
        zoneKnown = true;
      }
      const j = await jget("/api/zone-state?zone=" + encodeURIComponent(zoneId));
      const zone = j && j.zone;
      if (!zone) { zoneKnown = false; zoneName = ""; paintNowPlaying(null, null); return; }   // gone (regrouped): picked again next time
      zoneName = zone.display_name || ((zoneList.find((z) => z.zone_id === zoneId) || {}).display_name) || "";
      paintNowPlaying(zone, zone.now_playing || null);
    } catch (e) { /* poll blip — the next one retries */ }
  }
  let npArtKey = null;
  let readyAt = 0;
  function paintNowPlaying(zone, np) {
    // Only on opening: once the shelf has been touched, or a few seconds have
    // gone, a record starting somewhere must not pull the shelf from under you.
    if (firstNowPlaying && ready && (Date.now() - readyAt > 15000 || idleAt > readyAt)) firstNowPlaying = false;
    $("#mt-zone").textContent = zoneName || (zone || zoneList.length ? "Choose a zone" : "No zones found");
    $("#mt-title").textContent = np ? (np.line1 || "") : (zone ? "Nothing playing" : "");
    $("#mt-artist").textContent = np ? (np.line2 || "") : "";
    paintTransport(zone, np);
    const key = np && np.image_key ? np.image_key : null;
    if (key !== npArtKey) {
      npArtKey = key;
      $("#mt-art").innerHTML = key ? `<img src="${imageUrl(key, 120)}" alt="">` : "";
      const img = $("#mt-art img");
      if (img) img.addEventListener("error", () => img.remove());   // no art (or no Core): the plain square
    }
    // The first time the shelf is open and something is playing, that album is
    // put in front — the record on the platter, pulled from the shelf.
    if (firstNowPlaying && ready && np && np.line3) {
      firstNowPlaying = false;
      const i = playingIndex(np);
      if (i > -1 && mode === "idle" && !drag) { p = target = i; kick(); updateInfo(true); }
    } else if (ready && zone) {
      firstNowPlaying = false;
    }
  }
  // ---- The transport bar (v1.9.3): the remote's mini player, fixed and flat ---
  // Play/pause, the position along the bar's top edge, the zone and volume.
  // The position is the poll's, carried on by the clock between polls while
  // the zone plays, so the line moves every second rather than every four.
  let tZone = null, tNp = null, tAt = 0;
  function playingNow() { return !!tZone && (tZone.state === "playing" || tZone.state === "loading"); }
  function paintTransport(zone, np) {
    tZone = zone; tNp = np; tAt = Date.now();
    const playing = playingNow();
    const pp = $("#mt-pp");
    pp.disabled = !zone;
    pp.setAttribute("aria-label", playing ? "Pause" : "Play");
    $("#mt-play").classList.toggle("hidden", playing);
    $("#mt-pause").classList.toggle("hidden", !playing);
    const vol = volumeOf(zone);
    $("#mt-vol-btn").disabled = !vol;
    if (!vol) closeVol();
    else if (!$("#vol").classList.contains("hidden") && !volHeld()) paintVol(vol);
    paintProgress();
  }
  function paintProgress() {
    const len = tNp && Number(tNp.length);
    let pos = tNp && Number(tNp.seek_position);
    if (!len || !Number.isFinite(pos)) { $("#mt-fill").style.width = "0"; return; }
    if (playingNow()) pos += (Date.now() - tAt) / 1000;
    $("#mt-fill").style.width = (clamp(pos / len, 0, 1) * 100).toFixed(2) + "%";
  }
  setInterval(() => { if (!document.hidden && playingNow()) paintProgress(); }, 1000);
  // Where the track is now, the poll's position carried on by the clock.
  function positionNow() {
    let pos = tNp ? Number(tNp.seek_position) : NaN;
    if (Number.isFinite(pos) && playingNow()) pos += (Date.now() - tAt) / 1000;
    return pos;
  }
  $("#mt-pp").addEventListener("click", async () => {
    if (!zoneKnown) return;
    const was = { zone: tZone, np: tNp };
    const playing = playingNow();
    // Shown at once; the poll that follows says what the zone really did. The
    // position is taken forward first, or pausing would draw the line back to
    // where the last poll left it.
    if (tZone) {
      const np = tNp && Number.isFinite(positionNow()) ? Object.assign({}, tNp, { seek_position: positionNow() }) : tNp;
      paintTransport(Object.assign({}, tZone, { state: playing ? "paused" : "playing" }), np);
    }
    try {
      const r = await fetch("/api/control", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: zoneId, command: "playpause" })
      });
      if (!r.ok) {
        // Not done: put the button back as it was, and say why.
        if (was.zone) paintTransport(was.zone, was.np);
        toast(r.status === 503 ? "Roon isn’t connected right now" : "That didn’t work. Try again.");
        return;
      }
    } catch (e) {
      if (was.zone) paintTransport(was.zone, was.np);
      toast("Rouen didn’t answer. Try again.");
      return;
    }
    setTimeout(pollNowPlaying, 400);
  });
  // A tap on the playing record brings it to the front of the shelf — when it
  // is on this shelf. Near: the shelf turns to it; far: it is put there.
  $("#mt-info").addEventListener("click", () => {
    if (!tZone) { toast("Choose a zone to play in first"); return; }
    if (!tNp) { toast("Nothing is playing"); return; }
    // Radio or a stream: a track with no album to find.
    if (!tNp.line3) { toast("What’s playing isn’t an album on this shelf"); return; }
    const i = playingIndex(tNp);
    if (i < 0) { toast("The playing record isn’t on this shelf"); return; }
    if (mode === "spin") stopSpin();
    flippedV = null;
    const here = Math.round(p);
    let to = i;
    if (wrap()) { const d = mod(i - here + N / 2, N) - N / 2; to = here + Math.round(d); }
    if (Math.abs(to - p) > 30) { p = target = to; vp = 0; mode = "idle"; kick(); updateInfo(true); settled(); }
    else { vp = 0; settleTo(to); }
  });

  // The volume sheet: the zone's first output's volume, as the remote reads
  // it. A zone whose volume is fixed has none, and its button is off.
  function volumeOf(zone) {
    const o = zone && Array.isArray(zone.outputs) ? zone.outputs.find((x) => x && x.volume) : null;
    return o ? o.volume : null;
  }
  let volHoldUntil = 0;
  let volShown = null;          // the value on screen while it is held against the poll
  const volHeld = () => Date.now() < volHoldUntil;
  const absoluteVol = (v) => !!v && v.type !== "incremental" && Number.isFinite(Number(v.value));
  const volMin = (v) => (Number.isFinite(Number(v.min)) ? Number(v.min) : 0);
  // The top of the range: an output's soft limit where it has one, as the
  // remote's volCeiling — past it Roon clamps, and the thumb would snap back.
  function volCeiling(v) {
    const max = Number.isFinite(Number(v.max)) ? Number(v.max) : 100;
    return Number.isFinite(Number(v.soft_limit)) ? Math.min(max, Number(v.soft_limit)) : max;
  }
  function paintVol(v) {
    const slider = $("#vol-slider");
    const absolute = absoluteVol(v);
    slider.classList.toggle("hidden", !absolute);
    if (absolute) {
      slider.min = String(volMin(v));
      slider.max = String(volCeiling(v));
      slider.step = String(Number(v.step) > 0 ? v.step : 1);
      slider.value = String(v.value);
      volShown = Number(v.value);
    }
    $("#vol-value").textContent = absolute ? String(Math.round(Number(v.value))) : "";
  }
  async function sendVolume(body) {
    // The answer comes once Roon has acted; a dropped Core must not leave a
    // request hanging for ever (the remote's v1.7.69 lesson).
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
    try {
      await fetch("/api/volume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ zone_or_output_id: zoneId }, body)),
        signal: ctl ? ctl.signal : undefined
      });
    } catch (e) { /* the next poll shows the volume the zone really has */ }
    finally { if (t) clearTimeout(t); }
  }
  function openVol() {
    const v = volumeOf(tZone);
    if (!v) return;
    closeZones();
    paintVol(v);
    $("#vol").classList.remove("hidden");
    $("#mt-vol-btn").setAttribute("aria-expanded", "true");
  }
  function closeVol() { $("#vol").classList.add("hidden"); $("#mt-vol-btn").setAttribute("aria-expanded", "false"); }
  $("#mt-vol-btn").addEventListener("click", (e) => { e.stopPropagation(); if ($("#vol").classList.contains("hidden")) openVol(); else closeVol(); });
  $("#vol").addEventListener("click", (e) => e.stopPropagation());
  // A drag is dozens of values a second: one write at a time, and while one is
  // out only the newest value waits — so the zone follows the finger during
  // the drag, not only once it stops.
  let volSending = false, volNext = null;
  async function pushVolume(value) {
    volNext = value;
    if (volSending) return;
    volSending = true;
    while (volNext !== null) {
      const v = volNext; volNext = null;
      await sendVolume({ value: v });
    }
    volSending = false;
  }
  function showVolume(value) {
    volShown = value;
    $("#vol-slider").value = String(value);
    $("#vol-value").textContent = String(Math.round(value));
    volHoldUntil = Date.now() + 2500;   // held against the poll
  }
  $("#vol-slider").addEventListener("input", () => {
    const value = Number($("#vol-slider").value);
    showVolume(value);
    pushVolume(value);
  });
  for (const [id, sign] of [["#vol-minus", -1], ["#vol-plus", 1]]) {
    $(id).addEventListener("click", () => {
      const v = volumeOf(tZone);
      if (!v) return;
      const step = Number(v.step) > 0 ? Number(v.step) : 1;
      if (absoluteVol(v)) {
        // From what is on screen — a drag or a tap the poll has not caught up
        // with yet — never from the last poll's value.
        const from = volHeld() && volShown !== null ? volShown : Number(v.value);
        const next = clamp(from + sign * step, volMin(v), volCeiling(v));
        showVolume(next);
        pushVolume(next);
      } else {
        sendVolume({ relative: sign * step });   // incremental: only steps exist
      }
    });
  }
  document.addEventListener("click", (e) => { if (!$("#vol").classList.contains("hidden") && !e.target.closest("#vol")) closeVol(); });

  // The playing record on the shelf. Whole credited NAMES agree, never "contains
  // the artist" (which opened Bonnie "Prince" Billy's album for Prince) — the
  // remote's own rule for the same job (app.js, the now-playing album link).
  // The playing line is the TRACK artist, so a compilation's names nobody on
  // the album's credit; a title only one album has is still that album.
  const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const creditNames = (s) => String(s || "").split(/ \/ |\/| feat\.? | featuring | ft\.? |,| & | \+ | and /i).map(normName).filter(Boolean);
  function playingIndex(np) {
    const title = normName(np.line3);
    if (!title) return -1;
    const wanted = creditNames(np.line2);
    const sameTitle = (a) => normName(a.t) === title;
    const i = list.findIndex((a) => sameTitle(a) && wanted.some((w) => creditNames(a.a).includes(w)));
    if (i > -1) return i;
    const only = list.filter(sameTitle);
    return only.length === 1 ? list.indexOf(only[0]) : -1;
  }
  async function act(kind, btn) {
    const a = centre();
    if (!a) return;
    // a zone given by name (?zone=Kitchen) is turned into its id first
    if (!zoneKnown) await pollNowPlaying();
    if (!zoneKnown) { toast("Choose a zone to play in first"); openZones(); return; }
    btn.disabled = true;
    try {
      const r = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: a.o,
          // Identity travels with the play (stale-offset defense; see /api/play).
          title: a.t, subtitle: a.a,
          zone_or_output_id: zoneId, kind,
          filter_type: "", filter_value: "", filter_parent: ""
        })
      });
      if (r.ok) {
        const where = zoneName ? " in " + zoneName : "";
        toast(kind === "play_now" ? `Playing ${a.t}${where}` : kind === "play_next" ? `${a.t} plays next${where}` : `${a.t} added to the queue${where}`);
        setTimeout(pollNowPlaying, 1200);
      } else if (r.status === 409) {
        toast("That album isn’t in your Roon library any more");
        loadLibrary();
      } else if (r.status === 503) {
        toast("Roon isn’t connected right now");
      } else {
        toast("That didn’t work. Try again.");
      }
    } catch (e) {
      toast("Rouen didn’t answer. Try again.");
    } finally {
      btn.disabled = false;
    }
  }
  $("#actions").addEventListener("click", (e) => { const b = e.target.closest(".act"); if (b) act(b.dataset.act, b); });

  // the zone chooser
  const zonesEl = $("#zones");
  function openZones() {
    pickZone().catch(() => false).then((ok) => {
      // a failed read says so, rather than claiming there are no zones
      if (ok === false && !zoneList.length) { toast("Rouen didn’t answer. Try again in a moment."); return; }
      zonesEl.innerHTML = '<p>Play in</p>' + (zoneList.length
        ? zoneList.map((z) => `<button type="button" role="menuitemradio" data-zone="${esc(z.zone_id)}" aria-checked="${z.zone_id === zoneId ? "true" : "false"}">${esc(z.display_name)}<small>${z.state === "playing" ? "Playing" : z.state === "paused" ? "Paused" : ""}</small></button>`).join("")
        : '<p>No zones found</p>');
      zonesEl.classList.remove("hidden");
      closeVol();
      $("#mt-zone-btn").setAttribute("aria-expanded", "true");
    });
  }
  function closeZones() { zonesEl.classList.add("hidden"); $("#mt-zone-btn").setAttribute("aria-expanded", "false"); }
  $("#mt-zone-btn").addEventListener("click", (e) => { e.stopPropagation(); if (zonesEl.classList.contains("hidden")) openZones(); else closeZones(); });
  zonesEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("button[data-zone]");
    if (!b) return;
    zoneId = b.dataset.zone;
    zoneKnown = true;
    storeSet(ZONE_KEY, zoneId);
    // The choice rides along to the wall display, which follows ?zone= too.
    try { const u = new URL(location.href); u.searchParams.set("zone", zoneId); window.history.replaceState(null, "", u.pathname + u.search); }
    catch (err) { /* an old browser without URL: the choice still holds on this page */ }
    closeZones();
    pollNowPlaying();
  });
  document.addEventListener("click", (e) => { if (!zonesEl.classList.contains("hidden") && !e.target.closest("#zones")) closeZones(); });

  // ---- Ways out: the remote, and the wall display ------------------------------
  // The remote marks the tab when it opens this page or the wall display
  // (sessionStorage), and is then the page right behind it — so going BACK
  // returns it as it was left. The wall display and Shelf REPLACE each other,
  // so flipping between them never grows the history. Opened any other way (a
  // kiosk's start page, a bookmark) there is no remote behind this page, so it
  // loads one. The timer catches a back that goes nowhere.
  let backTimer = null;
  function goRemote() {
    let fromRemote = false;
    try { fromRemote = sessionStorage.getItem("rra-display-from-remote") === "1"; }
    catch (e) { /* storage blocked — load the remote, which always works */ }
    if (fromRemote && window.history.length > 1) {
      clearTimeout(backTimer);
      backTimer = setTimeout(() => location.assign("/"), 3000);
      window.history.back();
      return;
    }
    location.assign("/");
  }
  // Only a zone that was GIVEN goes along — by the remote, or picked here (the
  // chooser writes it into the address). A wall display opened without one
  // follows the music, and must still do so after a trip through Shelf.
  const wallUrl = () => { const z = new URLSearchParams(location.search).get("zone"); return "/display" + (z ? "?zone=" + encodeURIComponent(z) : ""); };
  $("#to-remote").addEventListener("click", goRemote);
  $("#to-wall").addEventListener("click", () => location.replace(wallUrl()));
  window.addEventListener("pagehide", () => { clearTimeout(backTimer); backTimer = null; });
  // Offered only while the wall display is switched on: with it off, that page
  // says only so.
  let wallOn = false;
  // Read at start and whenever /api/live says a setting changed.
  async function checkWall() {
    try { const j = await jget("/api/settings/display"); wallOn = !!j.enabled; $("#to-wall").classList.toggle("hidden", !wallOn); }
    catch (e) { /* unreachable: leave the button as it is */ }
  }

  // ---- Back to the wall display when left alone ---------------------------------
  // The remote's Settings → "Switch to the wall display" sets, per device, how
  // many untouched minutes send that device to the wall display. Shelf is part
  // of the same kiosk and keeps the same clock: without it, one tap on the wall
  // display's Shelf pill would leave a kiosk on Shelf for ever. Read on every
  // check, so a change made in the remote applies here at once. Touches count
  // as the remote counts them; a mouse only when it MOVED.
  const idleMins = () => { const v = parseInt(storeGet("rra-display-idle") || "0", 10); return Number.isFinite(v) && v > 0 ? v : 0; };
  let idleAt = Date.now();
  const touched = () => { idleAt = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(ev, touched, { capture: true, passive: true });
  {
    let mx = null, my = null;
    document.addEventListener("pointermove", (e) => {
      if (mx !== null && Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < 4) return;
      mx = e.clientX; my = e.clientY;
      touched();
    }, { capture: true, passive: true });
  }
  let leaving = false;
  function checkIdle() {
    const mins = idleMins();
    if (leaving || !mins || document.hidden || !wallOn) return;
    // In use — a finger on the shelf, a spin still landing, the zone list
    // open: wait for it, then go.
    if (drag || mode === "spin" || !zonesEl.classList.contains("hidden") || !$("#vol").classList.contains("hidden")) return;
    // once: a kiosk that blocks the page must not be asked every 15 s
    if (Date.now() - idleAt >= mins * 60000) { leaving = true; location.replace(wallUrl()); }
  }

  // ---- Reading the library, and keeping up with it -------------------------------
  let loading = null;
  let libSig = null;        // what the server says the list it sent holds
  let retryMs = 5000;
  function loadLibrary() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const j = await jget("/api/shelf/albums" + (ready && libSig ? "?sig=" + encodeURIComponent(libSig) : ""));
        retryMs = 5000;
        // The revision moved for something the shelf doesn't show (a year, a
        // badge): nothing to redraw.
        if (j.same) { libRev = j.rev || libRev; return; }
        // Choices are kept by NAME: the genre list is ordered by count, so a
        // genre can sit at another place in the new one.
        const namesChosen = new Map([...sel.genre].map((i) => [i, genres[i] ? genres[i].name : null]));
        genres = Array.isArray(j.genres) ? j.genres : [];
        albums = Array.isArray(j.albums) ? j.albums : [];
        libRev = j.rev || null;
        libSig = j.sig || null;
        const at = new Map(genres.map((g, i) => [g.name, i]));
        const moved = (i) => { const n = namesChosen.get(i); return n != null && at.has(n) ? at.get(n) : -1; };
        sel.genre = new Set([...sel.genre].map(moved).filter((i) => i > -1));
        chosen = chosen.map(([c, i]) => (c === "genre" ? [c, moved(i)] : [c, i])).filter(([c, i]) => c !== "genre" || i > -1);
        // Three covers for each genre's tile, spread through its albums.
        const keysOf = genres.map(() => []);
        for (const a of albums) if (a.k) for (const gi of a.g) if (keysOf[gi]) keysOf[gi].push(a.k);
        fans = keysOf.map((keys, gi) => {
          const out = [], step = Math.max(1, Math.floor(keys.length / 3)), start = hash(genres[gi].name) % Math.max(1, keys.length);
          for (let n = 0; n < Math.min(3, keys.length); n++) out.push(keys[(start + n * step) % keys.length]);
          return out;
        });
        const wasReady = ready;
        if (!wasReady) readyAt = Date.now();
        ready = true;
        renderTiles(wasReady);
        refresh({ reread: wasReady });
        if (!wasReady) {
          // Somewhere in the middle of the collection rather than at "A", until
          // the record that is playing is found and put in front.
          if (N > 1 && !sel.random.size) { p = target = Math.floor(Math.random() * N); kick(); updateInfo(true); }
          pollNowPlaying();
        }
      } catch (e) {
        // After the first read, a failed re-read leaves the shelf as it is —
        // what is on screen is still a true library, only older — and the next
        // /api/live poll asks again.
        if (!ready) {
          const unpaired = e.status === 503 && /paired/i.test(e.message);
          const building = e.status === 503 && !unpaired;
          waitingText = unpaired ? "Waiting for Roon…" : building ? "Reading your library…" : "Rouen didn’t answer. Trying again…";
          renderPick();
          if (unpaired) showNote("Waiting for Roon", "The shelf fills as soon as Rouen is paired with Roon and has read your library.", false);
          else if (building) showNote("Reading your library", "Rouen is still reading your Roon library, or hasn’t found any albums in it yet. The shelf fills as soon as there are some.", false);
          else showNote("Can’t reach Rouen", "Rouen didn’t answer. The shelf keeps trying.", false);
          // Asked again, less often the longer it waits.
          setTimeout(loadLibrary, retryMs);
          retryMs = Math.min(60000, retryMs * 2);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  // Mid-gesture, mid-spin or with a case turned over is no time to redraw the
  // shelf: the next poll tries again.
  const busy = () => !!drag || mode !== "idle" || flippedV !== null;
  let settingsRev = null;
  async function checkLive() {
    if (document.hidden || !ready) return;
    try {
      const j = await jget("/api/live");
      const rev = j && j.rev;
      if (!rev) return;
      if (rev.settings && settingsRev && rev.settings !== settingsRev) checkWall();
      if (rev.settings) settingsRev = rev.settings;
      if (rev.library && libRev && rev.library !== libRev && !busy()) loadLibrary();
    } catch (e) { /* poll blip — the next one retries */ }
  }

  // ---- How the shelf moves: said once, not written on it (v1.9.3) ---------------
  // The gestures used to sit along the foot of the shelf for good, lighting up
  // as they were used. Now they are a popup: the first time Shelf is opened on
  // this device, and again after each update — until "Don't show again" is
  // ticked, after which never. Per device, like every other Shelf preference.
  const HELP_KEY = "rra-shelf-help";
  function helpSaved() {
    try { const j = JSON.parse(storeGet(HELP_KEY) || "null"); return j && typeof j === "object" ? j : {}; }
    catch (e) { return {}; }   // unreadable: as if never shown
  }
  let helpVersion = "";
  async function maybeShowHelp() {
    const saved = helpSaved();
    if (saved.never) return;
    try { helpVersion = String((await jget("/api/update/status")).current || ""); }
    catch (e) { helpVersion = ""; /* unknown: shown once until a version can be read */ }
    // Shown when it never has been, or when the version it was last dismissed
    // at is not this one. An unknown version never re-shows a dismissed help.
    if ("seen" in saved && (saved.seen === helpVersion || !helpVersion)) return;
    $("#help-never").checked = false;
    $("#help").classList.remove("hidden");
    try { $("#help-ok").focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
  }
  function dismissHelp() {
    storeSet(HELP_KEY, JSON.stringify({ seen: helpVersion, never: $("#help-never").checked }));
    $("#help").classList.add("hidden");
    try { stage.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
  }
  $("#help-ok").addEventListener("click", dismissHelp);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#help").classList.contains("hidden")) dismissHelp(); });

  // ---- Start ------------------------------------------------------------------------
  setLook(look);
  renderTiles();
  renderPick();
  layout();
  loadLibrary();
  checkWall();
  maybeShowHelp();
  setInterval(() => { if (!document.hidden) pollNowPlaying(); }, 4000);
  setInterval(checkLive, 30000);
  setInterval(checkIdle, 15000);
  // Coming back to a hidden page is a touch: its clock is however long it was away.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { touched(); checkLive(); pollNowPlaying(); } });

  // For the test suite: where the shelf is, without reaching into its closure.
  window.__shelfState = () => { const c = centre(); return { p, mode, N, look, title: c && c.t, zone: zoneId }; };
  window.__shelfOrder = () => list.map((a) => a.t);
})();
