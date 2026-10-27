/*
 * shelf.js — the /shelf page (v1.9.1).
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Flicking through a record collection:
 *  - the whole library arrives once (/api/shelf/albums, snapshot only) and
 *    every choice on the left is applied here, so the counts on the tiles move
 *    with the finger rather than a round trip behind it;
 *  - genres OR among themselves, artists' letters OR among themselves,
 *    decades OR among themselves (v1.9.10), and each kind narrows the others
 *    (Rock or Jazz, by an artist under B, from the 1970s);
 *  - Random puts what is chosen in a random order, as the Random albums
 *    screen does;
 *  - the shelf revolves: a short swipe moves one album, a swipe held out keeps
 *    it turning that way until the finger lifts, a hard flick spins it and it
 *    lands somewhere three seconds later;
 *  - one look since v1.9.68 (the owner): spines as tall as the screen allows, with the artist, the title, the
 *    year, the format and the catalogue number; the covers and the carousel removed;
 *  - a tap on the case in front turns it over and unfolds it into the album
 *    view (v1.9.67-t5, dev/design/album-view.md): the whole screen above the
 *    bar — the cover, the facts and every track, the tracks chosen on it.
 *
 * The motion is computed here, frame by frame (a critically damped spring, a
 * cubic spin), not left to CSS transitions: a revolving shelf has to be
 * caught mid-turn and its position known at every frame.
 *
 * The rest of the page is in its own scripts (v1.9.66; the volume sheet since
 * v1.9.10), loaded before this one and made here with the hub below:
 * shelf-page.js (the theme, no scroll, no zoom), shelf-pick.js (the library
 * and the choices), shelf-back.js (the album view, the tracks chosen on
 * it), shelf-player.js (the zone, the bar, playing), shelf-queue.js (the
 * queue pane), shelf-ways.js (the ways out, the idle clock, the help) and
 * shelf-panes.js (the side panes).
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

  async function jget(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      let why = "";
      try { why = (await r.json()).error || ""; } catch (x) { /* no JSON body: the status says enough */ }
      const e = new Error(why || "HTTP " + r.status); e.status = r.status; throw e;
    }
    return r.json();
  }

  const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7.5"/></svg>';
  // Spine colours before a cover has been read for its own.
  const SPINE_FALLBACK = ["#2f3a4a", "#4a2f35", "#2f4a3c", "#4a432f", "#3a2f4a", "#25343a", "#463026", "#33363b"];
  const imageUrl = (key, size) => "/api/image/" + encodeURIComponent(key) + "?size=" + size;

  // ---- The shelf ----------------------------------------------------------------
  const stage = $("#stage"), scene = $("#scene"), rig = $("#rig"), shelfEl = $("#shelf"), screenEl = $("#screen");
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, S = 200, SH = 200, T = 2, TOP = 0, stepPx = 100, K = 6;
  let p = 0, vp = 0, target = 0, mode = "idle";
  // What the shelf holds now: the choices applied to the library.
  let list = [], N = 0, listVer = 0, tabs = [];
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

  // The hub the page's other scripts are made with (v1.9.66): the helpers, the
  // shelf's state as it is at each read (and, where they move it, set), the
  // shelf's own functions, and each part once made — they reach one another
  // through it, so none needs the others to exist before it.
  const hub = { $, esc, clamp, mod, hash, rng, jget, storeGet, storeSet, imageUrl, TICK, live, stage, scene,
    kick, updateInfo, settled, settleTo, stopSpin, spin, refresh, showNote, toast, centre, wrap, layout };
  for (const [k, get, set] of [["p", () => p, (v) => { p = v; }], ["target", () => target, (v) => { target = v; }],
    ["vp", () => vp, (v) => { vp = v; }], ["mode", () => mode, (v) => { mode = v; }], ["flippedV", () => flippedV, (v) => { flippedV = v; }],
    ["drag", () => drag], ["N", () => N], ["list", () => list],
    ["S", () => S], ["W", () => W], ["H", () => H], ["TOP", () => TOP]]) Object.defineProperty(hub, k, { get, set });
  const pick = window.ShelfPick.create(hub), back = window.ShelfBack.create(hub), player = window.ShelfPlayer.create(hub);
  const queue = window.ShelfQueue.create(hub), ways = window.ShelfWays.create(hub), panes = window.ShelfPanes.create(hub);
  const faces = window.ShelfFaces.create(hub);
  Object.assign(hub, { pick, back, player, queue, ways, panes, faces, about: window.ShelfAbout.create(hub) });

  // Where a new letter, label or decade begins, in the order chosen (shelf-pick.js, v1.9.67).
  function computeTabs() {
    tabs = pick.tabsFor(list);
  }

  function layout() {
    const r = stage.getBoundingClientRect();
    // read with the stage, before anything is written: the bar's height and how far the corner pills reach down
    const footH = $("#mt").offsetHeight, clear = window.ShelfWays.cornersBelow(r);
    W = r.width; H = r.height;
    // the player's height, for the queue drawer on a narrow screen to stop at, and the album view to end at
    screenEl.style.setProperty("--foot-h", footH + "px");
    // v1.9.68 (the owner: spines as tall as the screen allows, and thinner): the stage less the corner pills' strip, a
    // divider card, the ledge and the 3% the front case gains drawn forward; the cover up to 55% of W (52% if taller).
    // Where the stage is taller than the cover is wide (a phone held upright, the lane open: the owner, "what best
    // suits"), the case is a tall card — the cover over its names (shelf.css .tall) — so the spines still stand full
    // height, as wide as one that tall needs to be read (7.2% of it, 11% of W at most). A divider card stands up to
    // 1.12 of a spine's width over it (shelf.css .sp-tab.w.up), 1.5 in perspective: a wider spine takes it again, once.
    let tabH = Math.max(26, H * 0.045);
    for (let k = 0; k < 2; k++) {
      const room = (H - clear - tabH - Math.max(14, H * 0.024)) / 1.03;
      S = Math.round(Math.max(110, Math.min(room, W * (H > W ? 0.52 : 0.55))));
      SH = room - S > S * 0.18 ? Math.round(room) : S;
      T = Math.max(16, Math.round(Math.min(SH * 0.072, W * 0.11)));
      tabH = Math.max(tabH, T * 1.5);
    }
    TOP = Math.round(Math.max(clear + tabH, (H - SH * 1.02) * 0.55));
    stepPx = Math.max(52, S * 0.24);
    K = Math.min(40, Math.ceil((W / 2 - S / 2) / (T * 1.08)) + 2);
    // v1.9.66: the cases are not one 3D scene but drawn one over another (shelf.css, render()), so the perspective
    // is the rig's own: in one scene a case half turned swings its cover back past the plane the spines stand in.
    scene.style.perspective = "";
    rig.style.perspective = Math.round(S * 3.2) + "px";
    rig.style.perspectiveOrigin = `50% ${Math.round(TOP + SH * 0.58)}px`;
    rig.style.transform = "none";
    stage.style.setProperty("--S", S + "px");
    stage.style.setProperty("--SH", SH + "px");
    stage.classList.toggle("tall", SH > S);
    stage.style.setProperty("--t", T + "px");
    stage.style.setProperty("--top", TOP + "px");
    kick();
  }

  function place(d) {
    const ad = Math.abs(d), s = d < 0 ? -1 : 1, a = Math.min(1, ad);
    const gap = Math.max(2, T * 0.08);
    const first = S / 2 + T / 2 + gap * 2;
    const ea = 1 - (1 - a) * (1 - a);           // slides out a little before it turns
    const x = s * (ea * first + Math.max(0, ad - 1) * (T + gap));
    const z = (S * 0.1 - T / 2) * (1 - a) - (S / 2) * a;
    const ry = -s * 90 * Math.pow(a, 1.35);
    return { tf: `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg)`, op: edgeFade(ad) };
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
    const span = Math.min(N, 2 * K + 2);
    const start = Math.floor(p - span / 2) + 1;
    return [start, start + span - 1];
  }

  function spineColour(a) {
    const c = a.k && colourOf.get(a.k);
    if (c) return c;
    return { bg: SPINE_FALLBACK[hash(a.t + "|" + a.a) % SPINE_FALLBACK.length], fg: "#f2efe6" };
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
    el._front.innerHTML = faces.frontHTML(a, !fastNow);
    el._imgOn = !fastNow;
    // A back is drawn only once the case is turned over (turnOver).
    el._backOn = false;
    el._back.innerHTML = "";
    const sp = faces.spineHTML(a, tabs[i], i > 0 && !!tabs[i - 1]); el._l.innerHTML = sp; el._r.innerHTML = sp;
    paintColour(el, a);
  }
  function clearNodes() {
    for (const [, el] of live) { el.style.display = "none"; el.classList.remove("flipped"); el._key = null; delete el.dataset.v; pool.push(el); }   // [data-v]: the cases drawn
    live.clear();
  }
  function render() {
    const [lo, hi] = windowRange();
    // a new shelf fades in over 420 ms after the choices change
    let fade = 1;
    if (fadeT0) { fade = clamp((performance.now() - fadeT0) / 420, 0, 1); if (fade >= 1) fadeT0 = 0; fade = 1 - (1 - fade) * (1 - fade); }
    for (const [v, el] of live) if (v < lo || v > hi) { el.style.display = "none"; el.classList.remove("flipped"); delete el.dataset.v; pool.push(el); live.delete(v); }
    for (let v = lo; v <= hi; v++) {
      let el = live.get(v);
      const i = mod(v, N);
      if (!el) { el = pool.pop() || makeNode(); el.style.display = ""; live.set(v, el); }
      const key = listVer + ":" + i;
      if (el._key !== key) { fill(el, list[i], i); el._key = key; }
      else if (!el._imgOn && !fastNow) {
        // slowed down: the cover it was owed
        if (el._album.k) el._front.firstChild.insertAdjacentHTML("beforeend", faces.coverImg(el._album));
        el._imgOn = true;
      }
      el.dataset.v = String(v);
      const pl = place(v - p);
      pl.op *= fade;
      el.style.transform = pl.tf;
      // Spines (v1.9.66): the nearer the front, the higher — a case turning is
      // whole over the spines beside it; of two as near, the one on the left.
      const z = String(-2 * Math.round(Math.abs(v - p) * 100) - (v > p ? 1 : 0));
      if (el._z !== z) { el._z = z; el.style.zIndex = z; }   // written when it moves, not every frame
      el.style.setProperty("--op", pl.op.toFixed(3));
      el.style.visibility = pl.op < 0.002 ? "hidden" : "";
      // Spines: a box turned edge-on shows its spine, never its front — so the
      // front is not painted (its cover still loads, for the spine's colour).
      const edge = Math.abs(v - p) >= 1.2;
      if (el.classList.contains("edge") !== edge) el.classList.toggle("edge", edge);
      const fl = flippedV === v && Math.abs(v - p) < 0.5;
      if (fl && !el._backOn) { el._backOn = true; el._back.innerHTML = back.backHTML(el._album); }   // a case turned by a key's step: its back drawn
      if (el.classList.contains("flipped") !== fl) el.classList.toggle("flipped", fl);
    }
    // moved off the album: turned back — unless the shelf is on its way to it (a key's step with the view open, t5)
    if (flippedV !== null && Math.abs(flippedV - p) >= 0.5 && !(mode === "spring" && target === flippedV)) flippedV = null;
    // the album view is open exactly while a case is turned over at the front (t5): its album, and its case where drawn
    back.setOpen(flippedV !== null ? list[mod(flippedV, N)] : null, flippedV !== null ? live.get(flippedV) || null : null);
    if (back.tsel() && !back.picking()) back.endPicks();
  }
  // A cover that will not load shows the plain sleeve beneath it; one that does
  // gives its spine and its back its own colour.
  rig.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
  // The colour is read (a decode on the main thread) for the spines it paints, and
  // again when a case is turned over if it had not loaded before.
  rig.addEventListener("load", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.dataset.k || colourOf.has(img.dataset.k)) return;
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
  // The tracks are chosen on the album view (shelf-back.js), which has its
  // own presses: the stage's pointer is the shelf's alone since v1.9.67-t5.
  stage.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || !N) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a pointer the browser no longer tracks: the drag still works while it stays over the stage */ }
    const caught = mode === "spin" || (mode === "spring" && Math.abs(vp) > 0.003);
    stopSpin();
    player.closeZones();
    player.volClose();
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
  // How far a finger goes for one album, against a cover's own step (v1.9.10,
  // from Mandarin v0.8.34: 1.4, the shelf asked to be less quick to move;
  // before, 1). A flick that spins it is firmer for the same reason. The wheel
  // and a trackpad are as before.
  const SWIPE = 1.4;
  function applyDrag() {
    const raw = drag.p0 - (drag.x - drag.x0) / (stepPx * SWIPE) + drag.acc;
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
    if (!d.moved) {
      if (d.caught) settleTo(Math.round(p)); else tapAt(e.clientX, e.clientY);
      return;
    }
    if (d.shuttle) { vp = d.rate / 1000; settleTo(Math.round(p + Math.sign(d.rate) * 0.4)); return; }
    if (Math.abs(v) >= 1.7 && Math.abs(dx) >= Math.max(140, W * 0.16) && now - d.t0 < 700) { spin(v < 0 ? 1 : -1, Math.abs(v)); return; }
    vp = -v / (stepPx * SWIPE);
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
      if (ad >= 0.5) face = d < 0 ? el._l : el._r;
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
      el._back.innerHTML = back.backHTML(a);
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
    // with the album view open (t5), a step shows the next album in it rather than closing it
    const step = (n) => { if (mode === "spin") stopSpin(); const base = mode === "spring" ? target : Math.round(p); vp = 0; settleTo(base + n); if (flippedV !== null) flippedV = target; };
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
  function centre() { return N ? list[mod(Math.round(p), N)] : null; }

  // ---- What the shelf says about itself --------------------------------------
  function showNote(title, why, withActions) {
    $("#note").classList.remove("hidden");
    $("#note-title").textContent = title;
    $("#note-why").textContent = why;
    $("#note-actions").classList.toggle("hidden", !withActions);
    stage.classList.add("empty");
  }
  function hideNote() {
    $("#note").classList.add("hidden");
    stage.classList.remove("empty");
  }
  function updateInfo(force) {
    if (!pick.ready()) return;
    if (N === 0) {
      const labelOf = pick.labelOf;
      const words = pick.chosen().filter(([c]) => c !== "order").map(([c, i]) => (c === "artist" ? "artists under " + labelOf(c, i)
        : c === "year" ? (i === "none" ? "no year" : "the " + labelOf(c, i)) : labelOf(c, i)));
      const joined = words.length > 1 ? words.slice(0, -1).join(", ") + " and " + words[words.length - 1] : words[0] || "";
      if (pick.albumCount()) showNote("Nothing on this shelf", `No albums match ${joined}.`, true);
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
    list = pick.buildList(); N = list.length; listVer++;
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
    $("#shelf-order").textContent = pick.orderText();
    $("#spin-btn").disabled = N < 2;
    pick.renderPick();
    updateInfo(true);
  }

  // ---- Start ------------------------------------------------------------------------
  panes.restore();
  pick.renderTiles();
  pick.renderPick();
  layout();
  pick.loadLibrary();
  ways.checkWall();
  ways.maybeShowHelp();
  setInterval(() => { if (!document.hidden) player.poll(); }, 4000);
  setInterval(ways.checkLive, 30000);
  setInterval(ways.checkIdle, 15000);
  // Coming back to a hidden page is a touch: its clock is however long it was away.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { ways.touched(); ways.checkLive(); player.poll(); } });

  // For the test suite: where the shelf is, without reaching into its closure.
  window.__shelfState = () => { const c = centre(), tsel = back.tsel(); return { p, mode, N, look: "spines", title: c && c.t, zone: player.zoneId(), flipped: flippedV, picks: tsel ? [...tsel.picks].sort((x, y) => x - y) : [],
    pick: !screenEl.classList.contains("pick-off"), queue: queue.isOpen(), swipe: stepPx * SWIPE }; };
  window.__shelfOrder = () => list.map((a) => a.t);
})();
