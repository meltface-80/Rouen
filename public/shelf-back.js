// @ts-check
/*
 * shelf-back.js — the album opened on the Shelf. A tap on the case in front
 * turns it over (v1.9.1) and, since v1.9.67-t5 (dev/design/album-view.md),
 * the turn unfolds into the album view: the whole screen above the bar, in
 * the remote's own album-screen style — the cover, the title, the artist, its
 * label · catalogue № · kinds · year, and every track, read from the Core.
 * The tracks are chosen on it (v1.9.4) exactly as they were on the back of
 * the case: a hold, a tap to add, Ctrl/⌘- and Shift-click; their buttons are
 * under the cover with the album's own (v1.9.68). The back of the case itself
 * keeps the album's name and its barcode — the moment of the turn. The booklet
 * of v1.9.4 is gone: the view holds every track, and scrolls.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h):
 *
 *   const back = ShelfBack.create(h);
 *   back.backHTML(a), back.readTracks(a), back.setOpen(a, el)
 *   back.picking(), back.tsel(), back.tracksOf
 *   back.pickTrack(a, i, on), back.pickRun(a, i), back.paintPicks(), back.endPicks()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, hash, rng, jget, TICK, imageUrl } = h;
    const ov = $("#open"), body = $("#open-body");

    function barcode(seed) {
      const r = rng(seed); const stops = []; let x = 0, k = 0;
      while (x < 100) { const w = 0.8 + r() * 2.6; stops.push(`${k++ % 2 ? "#fff" : "#111"} ${x.toFixed(1)}% ${(x + w).toFixed(1)}%`); x += w; }
      return `linear-gradient(90deg, ${stops.join(",")})`;
    }
    // The opened album's real track list, read from the Core when the case is
    // turned over (one album open, on a tap — never while flicking).
    const tracksOf = new Map();   // album key → { tracks, discs } | { error } | "loading"
    const albumKeyOf = (a) => a.o + "|" + a.t + "|" + a.a;
    // Tracks chosen on the opened album (v1.9.4), one album at a time:
    // { key, album, picks: Set of track indices }, or null.
    let tsel = null;
    /** The album the view shows, or null while it is closed. @type {any} */
    let openA = null;
    let hideTimer = 0;
    // its label, catalogue number and kinds (v1.9.67), and its year (t5)
    const lineOf = (a) => [h.pick ? h.pick.lineOf(a) : "", a.y].filter(Boolean).join(" · ");

    // The back of the case: the album's name, its facts and a barcode — what
    // the turn shows for a moment.
    function backHTML(a) {
      const line = lineOf(a);
      return `<div class="bk"><div class="bk-ar">${esc(a.a)}</div><div class="bk-ti">${esc(a.t)}</div>${line ? `<div class="bk-lab">${esc(line)}</div>` : ""}
        <div class="bk-foot"><span class="bk-bar" style="background:${barcode(hash(a.t + a.a))}"></span><span class="bk-cat">Tap to turn back</span></div></div>`;
    }
    // A set lists each disc under its own heading, numbered from 1 (v1.9.4) —
    // the server says which disc each track is on (lib/discs.js). Every track
    // row carries its place in the album's list (data-i, what /api/play-track
    // is sent) and its number on its disc (data-n, put back when it is
    // un-chosen).
    function trackRows(st, picks) {
      const discs = Array.isArray(st.discs) && st.discs.length > 1 ? st.discs : null;
      const rows = [];
      let disc = 0, n = 0;
      st.tracks.forEach((t, i) => {
        if (discs) {
          const d = Number.isInteger(t.disc) && t.disc >= 1 ? t.disc : (disc || 1);
          if (d !== disc) { rows.push(`<li class="bk-disc">${esc(discs[d - 1] || "Disc " + d)}</li>`); disc = d; n = 0; }
        }
        n++;
        const on = !!(picks && picks.has(i));
        rows.push(`<li class="bk-t${on ? " sel" : ""}" data-i="${i}" data-n="${n}"><i>${on ? TICK : n}</i><span>${esc(t.title)}</span></li>`);
      });
      return rows;
    }
    // The album view: the cover; the title, the artist and the facts; the tracks, as the remote's album screen lays them.
    function viewHTML(a) {
      const key = albumKeyOf(a), st = tracksOf.get(key);
      let list;
      if (st && st.tracks) list = st.tracks.length ? `<ol class="bk-tracks">${trackRows(st, tsel && tsel.key === key ? tsel.picks : null).join("")}</ol>` : '<p class="ov-msg">Roon lists no tracks for this album.</p>';
      else if (st && st.error) list = `<p class="ov-msg">${esc(st.error)}</p>`;
      else list = '<p class="ov-msg">Reading the track list…</p>';
      const line = lineOf(a);
      // v1.9.68 (the owner): the play controls under the cover (placed by draw), then the review and the artist's
      // other albums (shelf-about.js); the title, the facts and the tracks beside them.
      return `<div class="ov-side"><div class="ov-art">${a.k ? `<img src="${imageUrl(a.k, 500)}" alt="" decoding="async" draggable="false">` : `<div class="blank"><b>${esc(a.t)}</b><span>${esc(a.a)}</span></div>`}</div>`
        + `<div class="ov-acts-slot"></div><div class="ov-about">${h.about ? h.about.html(a) : ""}</div></div>`
        + `<div class="ov-info"><div class="ov-head"><h2 class="ov-title">${esc(a.t)}</h2><div class="ov-sub">${esc(a.a)}</div>${line ? `<div class="ov-line">${esc(line)}</div>` : ""}</div>`
        + `<div class="ov-tracks"><h3 class="ov-label">Tracks</h3>${list}</div></div>`;
    }
    // The view drawn for an album, and its buttons put back under its cover (they keep their listeners: moved, not
    // made). Held here, not looked up: once moved in, the next drawing's innerHTML takes them out of the document.
    let acts = null;
    function draw(a) {
      const top = body.scrollTop;
      acts = acts || $("#ov-acts");
      body.innerHTML = viewHTML(a);
      const slot = body.querySelector(".ov-acts-slot");
      if (slot && acts) slot.appendChild(acts);
      body.scrollTop = top;
    }
    /** The tracks, or the review, came: drawn again if the view shows that album. By its key, not the object: the
     * shelf's list may have been read again meanwhile, the same album a new object. @param {any} keyOrAlbum */
    function repaint(keyOrAlbum) {
      if (openA && albumKeyOf(openA) === (typeof keyOrAlbum === "string" ? keyOrAlbum : albumKeyOf(keyOrAlbum))) draw(openA);
      h.kick();   // one frame drawn: a list that comes back after the shelf has stopped would otherwise wait for the next touch
    }
    async function readTracks(a) {
      const key = albumKeyOf(a);
      if (tracksOf.has(key)) return;
      tracksOf.set(key, "loading");
      repaint(key);
      try {
        const j = await jget(`/api/album?offset=${encodeURIComponent(a.o)}&title=${encodeURIComponent(a.t)}&subtitle=${encodeURIComponent(a.a)}`);
        tracksOf.set(key, { tracks: Array.isArray(j.tracks) ? j.tracks : [], discs: Array.isArray(j.discs) ? j.discs : null });
      } catch (e) {
        // Shown, then forgotten, so the next opening asks again (the Core may
        // be back by then).
        tracksOf.set(key, { error: e.status === 503 ? "Roon isn’t connected, so the track list can’t be read." : "The track list couldn’t be read." });
        setTimeout(() => { if (tracksOf.get(key) && tracksOf.get(key).error) tracksOf.delete(key); }, 4000);
      }
      repaint(key);
    }

    // ---- The view, opened and closed (v1.9.67-t5) ----------------------------------
    // The view is open exactly while a case is turned over at the front
    // (shelf.js render says which album, every frame, and its case where it
    // is drawn): it grows out of that case — scaled up from where the case
    // stands, a moment into the turn (shelf-open.css) — and shrinks back into
    // it when the case turns back. Another album at the front while open (a
    // key's step, even by ten, before its case is drawn): the view changes
    // album without closing, from the top, and reads its tracks.
    function setOpen(a, el) {
      if (a) {
        if (openA === a) return;
        const fresh = !openA;
        openA = a;
        body.scrollTop = 0;   // from the top: draw keeps where the view was scrolled, and that is now 0
        draw(a);
        readTracks(a);
        if (h.about) h.about.read(a);
        if (!fresh) return;
        clearTimeout(hideTimer);
        ov.classList.remove("hidden", "on");
        const o = ov.getBoundingClientRect(), r = el ? el.getBoundingClientRect() : o;
        ov.style.transformOrigin = `${(r.left + r.width / 2 - o.left).toFixed(1)}px ${(r.top + r.height / 2 - o.top).toFixed(1)}px`;
        void ov.offsetWidth;   // the start of the transition seen, not skipped
        ov.classList.add("on");
      } else if (openA) {
        openA = null;
        ov.classList.remove("on");
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { if (!openA) ov.classList.add("hidden"); }, 420);
      }
    }
    // Closed from the view (Back, a tap away from the tracks): the case turns back, and the keys are the shelf's again.
    const close = () => { if (h.flippedV !== null) { h.flippedV = null; h.kick(); } h.stage.focus({ preventScroll: true }); };
    $("#open-close").addEventListener("click", close);

    // ---- Choosing tracks on the opened album (v1.9.4) ---------------------------
    // Choosing is a LONG press on a track (500 ms, as the remote's) — its
    // number becomes a tick and its buttons come up under the cover (v1.9.68; the bar's from v1.9.66).
    // While tracks are chosen a tap on another adds it, a tap on a chosen one
    // takes it away, and the last one taken away ends the choosing. With a
    // mouse, Ctrl/⌘-click chooses without the hold and Shift-click chooses
    // every track from the last one chosen. A tap on the view away from the
    // tracks closes it, as a tap on the back of the case turned it over again;
    // a finger that slides scrolls the list and is no tap. Closing the view, or
    // moving the shelf off the album, ends the choosing: what is chosen is
    // always the album at the front.
    const SLOP = 10;
    /** @type {any} the press under way on the view */
    let press = null;
    const picking = () => !!(tsel && openA && albumKeyOf(openA) === tsel.key);
    const trackOf = (t) => { const li = t instanceof Element ? t.closest("li[data-i]") : null; return li ? +(/** @type {HTMLElement} */ (li)).dataset.i : -1; };
    ov.addEventListener("pointerdown", (e) => {
      if ((e.pointerType === "mouse" && e.button !== 0) || !openA) return;
      if (e.target instanceof Element && e.target.closest("button, a")) return;
      const a = openA, d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, pressed: false, lp: 0,
        track: trackOf(e.target), mod: e.ctrlKey || e.metaKey, shift: e.shiftKey };
      press = d;
      // Not while choosing, nor with Ctrl/⌘ or Shift held: then the release decides.
      if (d.track >= 0 && !picking() && !d.mod && !d.shift) {
        d.lp = setTimeout(() => {
          if (press !== d || d.moved) return;
          d.pressed = true;
          try { if (navigator.vibrate) navigator.vibrate(25); } catch (x) { /* no vibration here: the tick is the answer */ }
          pickTrack(a, d.track, true);
        }, 500);
      }
    });
    ov.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id || press.moved) return;
      if (Math.abs(e.clientX - press.x0) > SLOP || Math.abs(e.clientY - press.y0) > SLOP) { press.moved = true; clearTimeout(press.lp); }
    });
    const endPress = (e) => {
      if (!press || e.pointerId !== press.id) return;
      const d = press; press = null;
      clearTimeout(d.lp);
      if (e.type !== "pointerup" || d.moved || d.pressed || !openA) return;
      const a = openA;
      if (d.track >= 0) {
        if (d.shift) pickRun(a, d.track);
        else if (d.mod || picking()) pickTrack(a, d.track);
        return;   // a plain tap on a track, nothing chosen: nothing
      }
      // a tap on the cover or the album's name closes it; the review, the other albums and the buttons are read and used
      if (e.target instanceof Element && e.target.closest(".ov-art, .ov-head")) close();
    };
    // a tile of the artist's other albums: the shelf turns to it and opens it (shelf-about.js)
    body.addEventListener("click", (e) => {
      const t = e.target instanceof Element ? e.target.closest("[data-more]") : null;
      if (t && openA && h.about) h.about.open(openA, +(/** @type {HTMLElement} */ (t)).dataset.more);
    });
    ov.addEventListener("pointerup", endPress);
    ov.addEventListener("pointercancel", endPress);
    // A long press is the view's (choosing a track), not the browser's menu.
    ov.addEventListener("contextmenu", (e) => { if (trackOf(e.target) >= 0) e.preventDefault(); });

    // Ticks and numbers drawn in place.
    function paintPicks() {
      const mine = picking();
      for (const li of body.querySelectorAll("li[data-i]")) {
        const on = mine && tsel.picks.has(+li.dataset.i);
        if (li.classList.contains("sel") === on) continue;
        li.classList.toggle("sel", on);
        // the same tick a chosen genre wears (TICK, above)
        li.querySelector("i").innerHTML = on ? TICK : esc(li.dataset.n);
      }
      const n = tsel ? tsel.picks.size : 0;
      $("#tsel").classList.toggle("hidden", !n);
      // The album's own buttons (under the cover since v1.9.68) step aside: they
      // are for the whole album, and two Play nows would not say which is which.
      ov.classList.toggle("choosing", !!n);
      if (n) $("#tsel-count").textContent = n === 1 ? "1 track chosen" : `${n} tracks chosen`;
    }
    // on: true chooses, false un-chooses, undefined toggles. A track chosen is
    // where the next Shift-click's run starts.
    function pickTrack(a, i, on) {
      const key = albumKeyOf(a);
      if (!tsel || tsel.key !== key) tsel = { key, album: a, picks: new Set(), anchor: i };
      const want = on === undefined ? !tsel.picks.has(i) : on;
      if (want) { tsel.picks.add(i); tsel.anchor = i; } else tsel.picks.delete(i);
      if (!tsel.picks.size) tsel = null;
      paintPicks();
    }
    // Shift-click: every track from the last one chosen to this one.
    function pickRun(a, i) {
      const key = albumKeyOf(a);
      if (!tsel || tsel.key !== key) { pickTrack(a, i, true); return; }
      const lo = Math.min(tsel.anchor, i), hi = Math.max(tsel.anchor, i);
      for (let j = lo; j <= hi; j++) tsel.picks.add(j);
      paintPicks();
    }
    function endPicks() {
      if (!tsel) return;
      tsel = null;
      paintPicks();
    }

    return { backHTML, readTracks, setOpen, repaint, picking, pickTrack, pickRun, paintPicks, endPicks, tracksOf, tsel: () => tsel };
  }

  window.ShelfBack = { create };
})();
