// @ts-check
/*
 * shelf-back.js — the album opened on the Shelf: a case turned over unfolds
 * into the opened view (v1.9.67-t5, dev/design/stacks.md §3: the cover at the
 * left; the artist, the title, its label · catalogue № · kinds · year and every
 * track at the right), its track list read from the Core (v1.9.1), and the
 * tracks chosen on it (v1.9.4). The same view opens in place beneath a row of
 * the Stack (shelf-stack.js). The booklet of v1.9.4 is gone: the opened view
 * has the stage's height for the list, and scrolls when a box set needs more.
 * Moved out of shelf.js in v1.9.66.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h: the
 * shelf's own state and helpers):
 *
 *   const back = ShelfBack.create(h);
 *   back.backHTML(a), back.readTracks(a), back.fit(el), back.scrollList(dy)
 *   back.backOf(), back.trackAt(x, y), back.picking(), back.tsel(), back.tracksOf
 *   back.pickTrack(a, i, on), back.pickRun(a, i), back.paintPicks(), back.endPicks()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, hash, rng, jget, TICK, live, imageUrl } = h;

    function barcode(seed) {
      const r = rng(seed); const stops = []; let x = 0, k = 0;
      while (x < 100) { const w = 0.8 + r() * 2.6; stops.push(`${k++ % 2 ? "#fff" : "#111"} ${x.toFixed(1)}% ${(x + w).toFixed(1)}%`); x += w; }
      return `linear-gradient(90deg, ${stops.join(",")})`;
    }
    // The opened album's real track list, read from the Core when the case is
    // turned over or the row opened (one album open, on a tap — never while flicking).
    const tracksOf = new Map();   // album key → { tracks, discs } | { error } | "loading"
    const albumKeyOf = (a) => a.o + "|" + a.t + "|" + a.a;
    // Tracks chosen on the opened album (v1.9.4), one album at a time:
    // { key, album, picks: Set of track indices }, or null.
    let tsel = null;
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
    const picksFor = (key) => (tsel && tsel.key === key ? tsel.picks : null);
    // The opened view. The cover is drawn only once the album has been opened
    // (its tracks read, or on their way): the far side of the carousel shows
    // the name alone, as it always did, and fetches nothing.
    function backHTML(a) {
      const key = albumKeyOf(a);
      const st = tracksOf.get(key);
      let body;
      if (st && st.tracks) {
        if (st.tracks.length) {
          const rows = trackRows(st, picksFor(key));
          body = `<ol class="bk-tracks${rows.length <= 10 ? " one" : ""}">${rows.join("")}</ol>`;
        } else {
          body = '<p class="bk-msg">Roon lists no tracks for this album.</p>';
        }
      } else if (st && st.error) {
        body = `<p class="bk-msg">${esc(st.error)}</p>`;
      } else if (st === "loading") {
        body = '<p class="bk-msg">Reading the track list…</p>';
      } else {
        body = "";
      }
      // its label, catalogue number and kinds (v1.9.67), and its year (t5); the foot's word for the Stack's row
      const line = [h.pick ? h.pick.lineOf(a) : "", a.y].filter(Boolean).join(" · ");
      const cover = st && a.k ? `<div class="bk-cover"><img src="${imageUrl(a.k, 500)}" alt="" decoding="async" draggable="false"></div>` : "";
      return `<div class="bk">${cover}<div class="bk-body"><div class="bk-ar">${esc(a.a)}</div><div class="bk-ti">${esc(a.t)}</div>${line ? `<div class="bk-lab">${esc(line)}</div>` : ""}${body}
        <div class="bk-foot"><span class="bk-bar" style="background:${barcode(hash(a.t + a.a))}"></span><span class="bk-cat">${h.look === "stack" ? "Tap to close" : "Tap to turn back"}</span></div></div></div>`;
    }
    // Every drawn case of this album — by identity, so a case drawn from a list
    // read again while the tracks were on their way still gets them — and the
    // Stack's open row. And one frame drawn: a list that comes back after the
    // shelf has stopped would otherwise wait for the next touch.
    function repaintBacks(key) {
      for (const [, el] of live) {
        if (el._backOn && el._album && albumKeyOf(el._album) === key) { el._back.innerHTML = backHTML(el._album); fit(el); }
      }
      if (h.stack) h.stack.repaint(key);
      h.kick();
    }
    async function readTracks(a) {
      const key = albumKeyOf(a);
      if (tracksOf.has(key)) return;
      tracksOf.set(key, "loading");
      repaintBacks(key);
      try {
        const j = await jget(`/api/album?offset=${encodeURIComponent(a.o)}&title=${encodeURIComponent(a.t)}&subtitle=${encodeURIComponent(a.a)}`);
        tracksOf.set(key, { tracks: Array.isArray(j.tracks) ? j.tracks : [], discs: Array.isArray(j.discs) ? j.discs : null });
      } catch (e) {
        // Shown, then forgotten, so the next opening asks again (the Core may
        // be back by then).
        tracksOf.set(key, { error: e.status === 503 ? "Roon isn’t connected, so the track list can’t be read." : "The track list couldn’t be read." });
        setTimeout(() => { if (tracksOf.get(key) && tracksOf.get(key).error) tracksOf.delete(key); }, 4000);
      }
      repaintBacks(key);
    }

    // ---- The list as big as the view holds it (v1.9.10, from Mandarin v0.8.28) ----
    // In one column or two, whichever lets the titles be bigger, its size
    // found by measuring. Growing never cuts short a title more than the
    // smallest size does; one column is kept over two that would cut titles
    // short, unless two are much bigger. A list too long even at the smallest
    // scrolls inside the view (the booklet of v1.9.4 unfolded it below the case).
    const FIT_MAX = 2.2;
    const fitsIn = (ol) => ol.scrollHeight <= ol.clientHeight + 1 && ol.scrollWidth <= ol.clientWidth + 1;
    function fitTracks(ol) {
      const cut = () => { let n = 0; for (const sp of ol.querySelectorAll("li span")) if (sp.scrollWidth > sp.clientWidth + 1) n++; return n; };
      const at = (one, f) => { ol.classList.toggle("one", one); ol.style.setProperty("--fit", f.toFixed(3)); return fitsIn(ol); };
      const ways = [];
      for (const one of [true, false]) {
        if (!at(one, 1)) continue;
        const least = cut();
        let lo = 1, hi = FIT_MAX;
        if (at(one, hi) && cut() <= least) lo = hi;
        else for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (at(one, mid) && cut() <= least) lo = mid; else hi = mid; }
        at(one, lo);
        ways.push({ one, f: lo, size: lo * (one ? 4 : 3.5), cut: cut() });
      }
      // nothing fits: one column, so the rest is below and the list scrolls to it (two columns would spill sideways)
      if (!ways.length) { at(true, 1); return; }
      ways.sort((x, y) => y.size - x.size);
      let w = ways[0];
      const whole = ways.find((x) => !x.cut);
      if (w.cut && whole && whole.size >= w.size * 0.75) w = whole;
      at(w.one, w.f);
    }
    // Fits the opened album's list to the room it has now, and again only when
    // that room changes: as the tracks come, when the view has unfolded to its
    // size (shelf.js: the case's transitionend, or at once where nothing
    // transitions), and when the stage is laid out again.
    // Only the opened album anyone can see (a case folded away, the carousel's far side: never), and not while a
    // pane slides (a score of measurements a frame; the slide's end lays the shelf out once more). The room is
    // remembered on the list itself, so a list drawn afresh is always fitted.
    function fit(el) {
      if (!el || el !== backOf() || $("#screen").classList.contains("sliding")) return;
      const ol = el._back.querySelector(".bk-tracks");
      if (!ol) return;
      const key = ol.clientWidth + ":" + ol.clientHeight;
      if (!ol.clientWidth || ol._fitKey === key) return;
      ol._fitKey = key;
      fitTracks(ol);
    }
    // A finger sliding up or down the opened list (a box set's) scrolls it:
    // the stage takes every touch for the shelf, so the browser never does.
    function scrollList(dy) {
      const el = backOf(), ol = el && el._back.querySelector(".bk-tracks");
      if (ol) ol.scrollTop -= dy;
    }

    // ---- Choosing tracks on the opened album (v1.9.4) ---------------------------
    // A tap on the view turns the case over again, so choosing is a LONG press
    // on a track (500 ms, as the remote's) — its number becomes a tick and its
    // buttons come up in the bar (v1.9.66; a popup under the cover before). While tracks are chosen a tap on another
    // adds it, a tap on a chosen one takes it away, and the last one taken away
    // ends the choosing. With a mouse, Ctrl/⌘-click chooses without the hold and
    // Shift-click chooses every track from the last one chosen. Turning the case
    // back over, or moving the shelf off it, ends it: what is chosen is always
    // the album at the front.
    /** The opened album's element: the case turned over at the front, or the Stack's open row. */
    function backOf() {
      if (h.look === "stack") return h.stack ? h.stack.openEl() : null;
      const el = h.flippedV !== null ? live.get(h.flippedV) : null;
      return el && el._backOn && el._album && el.classList.contains("flipped") ? el : null;
    }
    const picking = () => { const el = backOf(); return !!(tsel && el && albumKeyOf(el._album) === tsel.key); };
    // The track under the finger on the opened list, or -1. Measured from each
    // row's own box, as itemAt measures the covers, and only inside its list's box.
    function trackAt(x, y) {
      const el = backOf();
      const ol = el && el._back.querySelector(".bk-tracks");
      if (!ol) return -1;
      const b = ol.getBoundingClientRect();
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) return -1;
      for (const li of ol.querySelectorAll("li[data-i]")) {
        const r = li.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return +li.dataset.i;
      }
      return -1;
    }
    // Ticks and numbers drawn in place, on every opened view of the album.
    function paintPicks() {
      const holders = [...live.values()];
      if (h.stack && h.stack.openEl()) holders.push(h.stack.openEl());
      for (const el of holders) {
        if (!el._backOn || !el._album) continue;
        const mine = !!(tsel && albumKeyOf(el._album) === tsel.key);
        for (const li of el._back.querySelectorAll("li[data-i]")) {
          const on = mine && tsel.picks.has(+li.dataset.i);
          if (li.classList.contains("sel") === on) continue;
          li.classList.toggle("sel", on);
          // the same tick a chosen genre wears (TICK, above)
          li.querySelector("i").innerHTML = on ? TICK : esc(li.dataset.n);
        }
      }
      const n = tsel ? tsel.picks.size : 0;
      $("#tsel").classList.toggle("hidden", !n);
      // The album's buttons in the bar (v1.9.10) step aside: they are for the
      // whole album, and two Play nows would not say which is which.
      $("#mt").classList.toggle("choosing", !!n);
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

    return { backHTML, readTracks, fit, scrollList, backOf, trackAt, picking,
      pickTrack, pickRun, paintPicks, endPicks, tracksOf, albumKeyOf, tsel: () => tsel };
  }

  window.ShelfBack = { create };
})();
