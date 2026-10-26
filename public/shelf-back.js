// @ts-check
/*
 * shelf-back.js — the back of a case turned over on the Shelf: its track list
 * read from the Core (v1.9.1), the booklet a long list unfolds into (v1.9.4),
 * and the tracks chosen on it (v1.9.4). Moved out of shelf.js in v1.9.66,
 * behaviour unchanged. Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h: the
 * shelf's own state and helpers):
 *
 *   const back = ShelfBack.create(h);
 *   back.backHTML(a), back.readTracks(a), back.paginate(el)
 *   back.setBooklet(el), back.booklet(), back.bookletNavAt(x, y), back.turnPage(by)
 *   back.backOf(), back.trackAt(x, y), back.picking(), back.tsel(), back.tracksOf
 *   back.pickTrack(a, i, on), back.pickRun(a, i), back.paintPicks(), back.endPicks()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, clamp, hash, rng, jget, TICK, live, stage, scene } = h;

    function barcode(seed) {
      const r = rng(seed); const stops = []; let x = 0, k = 0;
      while (x < 100) { const w = 0.8 + r() * 2.6; stops.push(`${k++ % 2 ? "#fff" : "#111"} ${x.toFixed(1)}% ${(x + w).toFixed(1)}%`); x += w; }
      return `linear-gradient(90deg, ${stops.join(",")})`;
    }
    // The back of the case: its real track list, read from the Core when the
    // case is turned over (one album open, on a tap — never while flicking).
    const tracksOf = new Map();   // album key → { tracks, discs } | { error } | "loading"
    const albumKeyOf = (a) => a.o + "|" + a.t + "|" + a.a;
    // Tracks chosen on the back of the case (v1.9.4), one album at a time:
    // { key, album, picks: Set of track indices }, or null.
    let tsel = null;
    // A set lists each disc under its own heading, numbered from 1 (v1.9.4) —
    // the server says which disc each track is on (lib/discs.js). Every track
    // row carries its place in the album's list (data-i, what /api/play-track
    // is sent) and its number on its disc (data-n, put back when it is
    // un-chosen). Rows rather than one string, so a long list can be cut into
    // the back and the pages of its booklet.
    function trackRows(st, picks) {
      const discs = Array.isArray(st.discs) && st.discs.length > 1 ? st.discs : null;
      const rows = [];
      let disc = 0, n = 0;
      let label = "";   // the disc's name, carried by its rows: a page that starts mid-disc says which
      st.tracks.forEach((t, i) => {
        if (discs) {
          const d = Number.isInteger(t.disc) && t.disc >= 1 ? t.disc : (disc || 1);
          if (d !== disc) { label = discs[d - 1] || "Disc " + d; rows.push({ head: true, label, html: `<li class="bk-disc">${esc(label)}</li>` }); disc = d; n = 0; }
        }
        n++;
        const on = !!(picks && picks.has(i));
        rows.push({ head: false, label, html: `<li class="bk-t${on ? " sel" : ""}" data-i="${i}" data-n="${n}"><i>${on ? TICK : n}</i><span>${esc(t.title)}</span></li>` });
      });
      return rows;
    }
    const rowsHTML = (rows, s, e) => rows.slice(s, e).map((r) => r.html).join("");
    const picksFor = (key) => (tsel && tsel.key === key ? tsel.picks : null);
    function backHTML(a) {
      const key = albumKeyOf(a);
      const st = tracksOf.get(key);
      let body;
      if (st && st.tracks) {
        if (st.tracks.length) {
          const rows = trackRows(st, picksFor(key));
          body = `<ol class="bk-tracks${rows.length <= 10 ? " one" : ""}">${rowsHTML(rows, 0, rows.length)}</ol>`;
        } else {
          body = '<p class="bk-msg">Roon lists no tracks for this album.</p>';
        }
      } else if (st && st.error) {
        body = `<p class="bk-msg">${esc(st.error)}</p>`;
      } else if (st === "loading") {
        body = '<p class="bk-msg">Reading the track list…</p>';
      } else {
        body = "";   // never turned over: the far side of the carousel shows only the name
      }
      const line = h.pick ? h.pick.lineOf(a) : "";   // its label, catalogue number and kind (v1.9.67)
      return `<div class="bk"><div class="bk-ar">${esc(a.a)}</div><div class="bk-ti">${esc(a.t)}</div>${line ? `<div class="bk-lab">${esc(line)}</div>` : ""}${body}
        <div class="bk-foot"><span class="bk-bar" style="background:${barcode(hash(a.t + a.a))}"></span><span class="bk-cat">Tap to turn back</span></div></div>`;
    }
    // Every drawn case of this album — by identity, so a case drawn from a list
    // read again while the tracks were on their way still gets them. And one
    // frame drawn: the booklet opens from render(), and a list that comes back
    // after the shelf has stopped would otherwise wait for the next touch.
    function repaintBacks(key) {
      for (const [, el] of live) {
        if (el._backOn && el._album && albumKeyOf(el._album) === key) { el._back.innerHTML = backHTML(el._album); paginate(el); }
      }
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
        // Shown, then forgotten, so the next turn-over asks again (the Core may
        // be back by then).
        tracksOf.set(key, { error: e.status === 503 ? "Roon isn’t connected, so the track list can’t be read." : "The track list couldn’t be read." });
        setTimeout(() => { if (tracksOf.get(key) && tracksOf.get(key).error) tracksOf.delete(key); }, 4000);
      }
      repaintBacks(key);
    }

    // ---- The booklet (v1.9.4) -----------------------------------------------------------
    // A track list longer than the back of the case can hold used to lose its
    // tail off the bottom, where nothing could reach it. Now the back holds what
    // fits and the rest unfolds below the case as a booklet page, hinged at the
    // case's bottom edge, the moment the case is turned over (the user's design:
    // "the back cover folds down to show the extended track list, like a
    // booklet"). A box set too long even for that gets more pages, turned with
    // ‹ ›. While the booklet is open the whole shelf lifts and shrinks, so the
    // case and its booklet fit the stage together.
    //
    // Pages are found by MEASURING, not by counting rows: what fits depends on
    // the cover's size, the screen, the titles' lengths and the disc headings.
    // Each page takes as many rows as its list holds without spilling, and a
    // disc heading never ends a page — it goes over with its tracks.
    let bookletEl = null;   // the case whose booklet is open, or null
    const fitsIn = (ol) => ol.scrollHeight <= ol.clientHeight + 1 && ol.scrollWidth <= ol.clientWidth + 1;
    // A booklet page that starts part-way through a disc opens with its name
    // again ("Disc 2 · continued"), measured in with the page's rows.
    const leadFor = (rows, s) => (s > 0 && rows[s] && !rows[s].head && rows[s].label ? `<li class="bk-disc">${esc(rows[s].label)} · continued</li>` : "");
    function pageEnd(ol, rows, s) {
      const lead = leadFor(rows, s);
      ol.innerHTML = lead + rowsHTML(rows, s, rows.length);
      if (fitsIn(ol)) return rows.length;
      let lo = s + 1, hi = rows.length - 1, best = s + 1;   // a page holds one row at least, fitting or not
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        ol.innerHTML = lead + rowsHTML(rows, s, mid);
        if (fitsIn(ol)) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (best - 1 > s && rows[best - 1].head) best--;
      return best;
    }
    // The back's list as big as the back holds it (v1.9.10, from Mandarin
    // v0.8.28): in one column or two, whichever lets the titles be bigger, its
    // size found by measuring, as the booklet's pages are. Growing never cuts
    // short a title more than the smallest size does; one column is kept over two
    // that would cut titles short, unless two are much bigger. False when it
    // doesn't fit even at the smallest: the back is cut there, and the rest goes
    // into the booklet.
    const FIT_MAX = 2.2;
    function fitTracks(ol, rows) {
      ol.innerHTML = rowsHTML(rows, 0, rows.length);
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
      if (!ways.length) { at(rows.length <= 10, 1); return false; }
      ways.sort((x, y) => y.size - x.size);
      let w = ways[0];
      const whole = ways.find((x) => !x.cut);
      if (w.cut && whole && whole.size >= w.size * 0.75) w = whole;
      at(w.one, w.f);
      return true;
    }
    function bookletShell(el) {
      const a = el._album;
      el._bkl.innerHTML = `<div class="bkl-in"><div class="bkl-head">${esc(a.a)} · ${esc(a.t)}</div><ol class="bk-tracks"></ol>`
        + '<div class="bkl-nav"><b class="bkl-prev" aria-hidden="true">‹</b><span class="bkl-page"></span><b class="bkl-next" aria-hidden="true">›</b></div></div>';
      return el._bkl.querySelector(".bk-tracks");
    }
    // Cuts the case at the front's list into its back and its booklet pages:
    // el._pages = [[from, to], …] row ranges, the first the back's.
    function paginate(el) {
      if (!el || el !== live.get(h.flippedV) || !el._album) return;
      el._pagedS = h.S;
      el._pages = null;
      const key = albumKeyOf(el._album);
      const st = tracksOf.get(key);
      const ol = el._back.querySelector(".bk-tracks");
      if (!ol || !st || !st.tracks || !st.tracks.length) return;
      const rows = trackRows(st, picksFor(key));
      const pages = [[0, fitTracks(ol, rows) ? rows.length : pageEnd(ol, rows, 0)]];
      if (pages[0][1] < rows.length) {
        const bol = bookletShell(el);
        while (pages[pages.length - 1][1] < rows.length) {
          const from = pages[pages.length - 1][1];
          pages.push([from, pageEnd(bol, rows, from)]);
        }
      }
      ol.innerHTML = rowsHTML(rows, 0, pages[0][1]);
      el._pages = pages;
      el._bpage = clamp(el._bpage || 1, 1, Math.max(1, pages.length - 1));
      drawBooklet(el);
    }
    function drawBooklet(el) {
      if (!el._pages || el._pages.length < 2) return;
      const key = albumKeyOf(el._album), st = tracksOf.get(key);
      if (!st || !st.tracks) return;
      const n = el._pages.length - 1, [from, to] = el._pages[el._bpage];
      const rows = trackRows(st, picksFor(key));
      el._bkl.querySelector(".bk-tracks").innerHTML = leadFor(rows, from) + rowsHTML(rows, from, to);
      el._bkl.classList.toggle("one-page", n < 2);
      el._bkl.querySelector(".bkl-page").textContent = `${el._bpage} / ${n}`;
      el._bkl.querySelector(".bkl-prev").classList.toggle("off", el._bpage <= 1);
      el._bkl.querySelector(".bkl-next").classList.toggle("off", el._bpage >= n);
    }
    function turnPage(by) {
      const el = bookletEl;
      if (!el || !el._pages) return;
      const to = clamp(el._bpage + by, 1, el._pages.length - 1);
      if (to === el._bpage) return;
      el._bpage = to;
      drawBooklet(el);
    }
    // The booklet open on el, or on none: the case's class, and the lift that
    // makes room for it — the scene moved up and scaled about the front case's
    // top edge, so the case and the booklet under it share the stage's height.
    function setBooklet(el) {
      if (bookletEl && bookletEl !== el) bookletEl.classList.remove("booklet");
      bookletEl = el;
      stage.classList.toggle("booklet-open", !!el);
      if (!el) { scene.style.transform = ""; return; }
      el.classList.add("booklet");
      // The front case stands a little forward of the others (place()), so the
      // perspective draws it — and the booklet hanging from it — about 3% larger
      // than S, grown about its middle: room is made for that, not for S. The
      // carousel's front case is not stood forward.
      const { S, H, W, TOP } = h, grow = h.look === "ring" ? 1 : 1.035, m = 10;
      // a stage with no height to speak of (a phone on its side) has no room to
      // make: the booklet unfolds where it is
      if (H < 4 * m + 40) { scene.style.transform = ""; return; }
      const k = Math.min(1, (H - 2 * m) / (2 * S * grow));
      const dy = (m + 0.5 * S * k * grow) - (TOP + 0.5 * S * k);
      scene.style.transformOrigin = `${(W / 2).toFixed(1)}px ${TOP.toFixed(1)}px`;
      scene.style.transform = `translateY(${dy.toFixed(1)}px) scale(${k.toFixed(4)})`;
    }
    // ‹ or › under the finger (generously: they are small once the shelf has
    // shrunk), as -1 / 1; 0 for neither, or for one with nowhere to go.
    function bookletNavAt(x, y) {
      if (!bookletEl) return 0;
      for (const [sel, dir] of [[".bkl-prev", -1], [".bkl-next", 1]]) {
        const b = bookletEl._bkl.querySelector(sel);
        if (!b || b.classList.contains("off") || bookletEl._bkl.classList.contains("one-page")) continue;
        const r = b.getBoundingClientRect();
        if (x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10) return dir;
      }
      return 0;
    }

    // ---- Choosing tracks on the back of the case (v1.9.4) ---------------------------
    // A tap on the back turns the case over again, so choosing is a LONG press
    // on a track (500 ms, as the remote's) — its number becomes a tick and its
    // buttons come up in the bar (v1.9.66; a popup under the cover before). While tracks are chosen a tap on another
    // adds it, a tap on a chosen one takes it away, and the last one taken away
    // ends the choosing. With a mouse, Ctrl/⌘-click chooses without the hold and
    // Shift-click chooses every track from the last one chosen. Turning the case
    // back over, or moving the shelf off it, ends it: what is chosen is always
    // the album at the front. The booklet's tracks are chosen the same way.
    function backOf() {
      const el = h.flippedV !== null ? live.get(h.flippedV) : null;
      return el && el._backOn && el._album && el.classList.contains("flipped") ? el : null;
    }
    const picking = () => { const el = backOf(); return !!(tsel && el && albumKeyOf(el._album) === tsel.key); };
    // The track under the finger on that back or its open booklet, or -1.
    // Measured from each row's own box, as itemAt measures the covers, and only
    // inside its list's box.
    function trackAt(x, y) {
      const el = backOf();
      if (!el) return -1;
      const lists = [el._back.querySelector(".bk-tracks")];
      if (el === bookletEl) lists.push(el._bkl.querySelector(".bk-tracks"));
      for (const ol of lists) {
        if (!ol) continue;
        const b = ol.getBoundingClientRect();
        if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
        for (const li of ol.querySelectorAll("li[data-i]")) {
          const r = li.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return +li.dataset.i;
        }
      }
      return -1;
    }
    // Ticks and numbers drawn in place, on the back and the booklet alike.
    function paintPicks() {
      for (const [, el] of live) {
        if (!el._backOn || !el._album) continue;
        const mine = !!(tsel && albumKeyOf(el._album) === tsel.key);
        for (const holder of [el._back, el._bkl]) {
          for (const li of holder.querySelectorAll("li[data-i]")) {
            const on = mine && tsel.picks.has(+li.dataset.i);
            if (li.classList.contains("sel") === on) continue;
            li.classList.toggle("sel", on);
            // the same tick a chosen genre wears (TICK, above)
            li.querySelector("i").innerHTML = on ? TICK : esc(li.dataset.n);
          }
        }
      }
      const n = tsel ? tsel.picks.size : 0;
      $("#tsel").classList.toggle("hidden", !n);
      // The album's buttons in the bar (v1.9.10) step aside: they are for the
      // whole album, and two Play nows would not say which is which. (Its title
      // under the shelf stepped aside too, until v1.9.66 took it away.)
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

    return { backHTML, readTracks, paginate, setBooklet, bookletNavAt, turnPage, backOf, trackAt, picking,
      pickTrack, pickRun, paintPicks, endPicks, tracksOf, booklet: () => bookletEl, tsel: () => tsel };
  }

  window.ShelfBack = { create };
})();
