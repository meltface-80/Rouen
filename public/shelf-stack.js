// @ts-check
/*
 * shelf-stack.js — the Shelf's Stack look (v1.9.67-t5, dev/design/stacks.md):
 * every album a spine lying flat, as wide as the stage, coloured from its
 * cover, in a list that scrolls as a page does. Left to right: the brass tab
 * where a run begins in the order chosen, the artist, the title; at the right
 * the label, the year and the catalogue number in a monospaced face. The row
 * in front is the shelf's p (what the bar plays, what "n of N" counts); a tap
 * opens a row in place — the opened view (shelf-back.js) unfolds beneath it,
 * pushing the rows below down — and the tracks are chosen on it as on a case
 * turned over. Only the rows in view and a margin are in the document.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h) and hands
 * over to it while the look is "stack":
 *
 *   const stack = ShelfStack.create(h);
 *   stack.layout(), stack.settle(i), stack.spin(), stack.key(e), stack.tapAt(x, y)
 *   stack.openEl(), stack.open(), stack.repaint(key)
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, clamp, imageUrl, stage, colourOf, averageColour, paintColour, toast } = h;
    const scroller = $("#stack"), inner = $("#stack-in");
    let rowH = 44, panelH = 300, lastList = null, ver = 0, open = /** @type {number | null} */ (null), raf = 0, fresh = true;
    /** @type {Map<number, HTMLElement>} */
    const rows = new Map();
    /** @type {HTMLElement[]} */
    const pool = [];
    /** @type {any} the open row's view, one at a time; carries what shelf-back.js reads of a case: _album, _back, _backOn */
    let panel = null;
    const on = () => h.look === "stack";

    // Where a row's top is: the open row's view sits between it and the next.
    const y = (i) => i * rowH + (open !== null && i > open ? panelH : 0);
    const total = () => h.N * rowH + (open !== null ? panelH : 0);
    // The row at a height, the open view counted as its row's.
    function rowAt(s) {
      let i = Math.floor(s / rowH);
      if (open !== null && i > open) i = Math.max(open, Math.floor((s - panelH) / rowH));
      return clamp(i, 0, Math.max(0, h.N - 1));
    }

    function rowHTML(a, i) {
      const tab = h.tabs[i] || "";
      const label = h.pick.labelName(a);
      return (tab ? `<b class="st-tab${tab.length > 1 ? " w" : ""}">${esc(tab)}</b>` : "")
        + `<span class="st-txt"><span class="st-ar">${esc(a.a)}</span><span class="st-ti">${esc(a.t)}</span></span>`
        + `<span class="st-r">${label ? `<span class="st-lab">${esc(label)}</span>` : ""}${a.y ? `<span class="st-yr">${a.y}</span>` : ""}${a.c ? `<span class="st-no">${esc(a.c)}</span>` : ""}</span>`
        // its colour, read off its cover once (the same picture the Covers look fetches; the browser keeps it)
        + (a.k && !colourOf.has(a.k) ? `<img class="st-img" src="${imageUrl(a.k, 500)}" alt="" decoding="async" data-k="${esc(a.k)}">` : "");
    }
    function makeRow() {
      const el = document.createElement("div");
      el.className = "stack-row";
      inner.appendChild(el);
      return el;
    }
    function render() {
      const N = h.N, list = h.list, p = Math.round(h.p);
      inner.style.height = total() + "px";
      if (!N) { for (const [, el] of rows) { el.style.display = "none"; pool.push(el); } rows.clear(); placePanel(); return; }
      const s = scroller.scrollTop, lo = Math.max(0, rowAt(s) - 6), hi = Math.min(N - 1, rowAt(s + scroller.clientHeight) + 6);
      for (const [i, el] of rows) if (i < lo || i > hi) { el.style.display = "none"; pool.push(el); rows.delete(i); }
      for (let i = lo; i <= hi; i++) {
        let el = rows.get(i);
        if (!el) { el = pool.pop() || makeRow(); el.style.display = ""; rows.set(i, el); }
        // drawn again for a new list (ver: the order and the tabs may have changed under the same album)
        const a = list[i], key = ver + ":" + i;
        if (el.dataset.key !== key) { el.innerHTML = rowHTML(a, i); el.dataset.key = key; el.dataset.i = String(i); el.dataset.k = a.k || ""; paintColour(el, a); }
        el.style.transform = `translateY(${y(i)}px)`;
        el.classList.toggle("front", i === p);
        el.classList.toggle("open", i === open);
      }
      placePanel();
      // what is chosen is always the open album: another row opened, or none, ends the choosing (the review)
      if (h.back.tsel() && !h.back.picking()) h.back.endPicks();
    }
    function placePanel() {
      if (open === null || !h.N) { if (panel) { panel.remove(); panel = null; } return; }
      const a = h.list[open];
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "stack-open flipped";
        panel._backOn = true; panel._back = panel;
        inner.appendChild(panel);
      }
      if (panel._album !== a) { panel._album = a; panel.innerHTML = h.back.backHTML(a); }
      panel.style.transform = `translateY(${y(open) + rowH}px)`;
      h.back.fit(panel);
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (on()) render(); }); };
    scroller.addEventListener("scroll", schedule, { passive: true });
    // A cover arrived: its colour for every row of that album in view.
    scroller.addEventListener("load", (e) => {
      const img = /** @type {any} */ (e.target);
      if (!(img instanceof HTMLImageElement) || !img.dataset.k || colourOf.has(img.dataset.k)) return;
      const c = averageColour(img);
      if (!c) return;
      colourOf.set(img.dataset.k, c);
      for (const [, el] of rows) if (el.dataset.k === img.dataset.k) paintColour(el, h.list[+el.dataset.i]);
    }, true);
    scroller.addEventListener("error", (e) => { const t = /** @type {any} */ (e.target); if (t instanceof HTMLImageElement) t.remove(); }, true);
    // The look changing (shelf.js setLook follows): the open row folds away, and the Stack next shown brings the
    // row in front into view — the shelf may have moved while another look had it (the review).
    $("#looks").addEventListener("click", (e) => { const b = e.target instanceof Element && e.target.closest("button"); if (b && b.dataset.look && b.dataset.look !== h.look) { close(); fresh = true; } });

    // The row brought into view, if it is not: a keyboard's step, a spin's landing.
    function show(i, centre) {
      const top = y(i), bottom = top + rowH + (i === open ? panelH : 0), vh = scroller.clientHeight;
      let to = scroller.scrollTop;
      if (centre) to = top - Math.max(0, (vh - (bottom - top)) / 2);
      else if (top < scroller.scrollTop) to = top;
      else if (bottom > scroller.scrollTop + vh) to = bottom - vh;
      if (to !== scroller.scrollTop) scroller.scrollTo({ top: Math.max(0, to), behavior: h.reduced ? "auto" : "smooth" });
    }
    function close() {
      if (open === null) return;
      open = null;
      render();
      if (h.back.tsel()) h.back.endPicks();
    }

    return {
      // The stage measured (shelf.js layout): the rows' and the view's heights from the root size, and the rows
      // drawn — a new list (the choices changed) from the shelf's p, the open row folded away.
      layout() {
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        rowH = Math.round(rem * 2.75);
        panelH = Math.round(clamp(h.H * 0.55, 11 * rem, 22 * rem));
        stage.style.setProperty("--row", rowH + "px");
        stage.style.setProperty("--sh", panelH + "px");
        if (lastList !== h.list || fresh) { if (lastList !== h.list) { lastList = h.list; ver++; } fresh = false; open = null; render(); show(Math.round(h.p), true); }
        render();
      },
      /** The shelf's frame (shelf.js render): the rows drawn for the p and the list as they are. */
      render,
      /** The shelf's settleTo: the row in front, brought into view. @param {number} t */
      settle(t) {
        h.p = h.target = clamp(Math.round(t), 0, Math.max(0, h.N - 1)); h.vp = 0; h.mode = "idle";
        render(); show(Math.round(h.p), false); h.updateInfo(true); h.settled();
      },
      /** The Spin button and S: a row at random, brought to the middle. */
      spin() {
        let i = Math.floor(Math.random() * h.N);
        if (i === Math.round(h.p)) i = (i + 1) % h.N;
        close();
        this.settle(i); show(i, true);
        toast(`Landed on ${h.list[i].t}`);
      },
      /** A TV remote or a keyboard: up and down step (Shift: ten), Enter opens and closes, S spins. @param {KeyboardEvent} e */
      key(e) {
        const p = Math.round(h.p);
        if (e.key === "ArrowDown") this.settle(p + (e.shiftKey ? 10 : 1));
        else if (e.key === "ArrowUp") this.settle(p - (e.shiftKey ? 10 : 1));
        else if (e.key === "Home") this.settle(0);
        else if (e.key === "End") this.settle(h.N - 1);
        else if (e.key === "Enter" || e.key === " ") this.toggle(p);
        else if (e.key === "s" || e.key === "S") h.spin(1, 2.4);
        else return false;
        return true;
      },
      /** A tap (shelf.js tapEnd): on a row, it comes to the front and opens, or closes if open; on the open view, closes. */
      tapAt(x, y0) {
        const at = document.elementFromPoint(x, y0);
        const row = at && at.closest(".stack-row");
        if (row) this.toggle(+(/** @type {HTMLElement} */ (row)).dataset.i);
        else if (at && at.closest(".stack-open")) close();
      },
      /** @param {number} i */
      toggle(i) {
        if (open === i) { close(); return; }
        open = i;
        h.p = h.target = i; h.vp = 0;
        render(); show(i, false);
        h.back.readTracks(h.list[i]);
        h.updateInfo(true); h.settled();
      },
      open: () => open,
      openEl: () => (on() ? panel : null),
      /** The tracks came (shelf-back.js repaintBacks): the open view drawn again. @param {string} key */
      repaint(key) {
        if (panel && panel._album && h.back.albumKeyOf(panel._album) === key) { panel.innerHTML = h.back.backHTML(panel._album); h.back.fit(panel); }
      },
    };
  }

  window.ShelfStack = { create };
})();
