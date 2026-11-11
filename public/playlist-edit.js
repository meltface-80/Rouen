// @ts-check
/*
 * playlist-edit.js — a Roon playlist's tracks moved and removed from its page (2.0.4-t13, dev/design/playlist-edit.md
 * §1 and §4.1). The owner, 2026-11-10: "I don't see a way to reorder tracks or delete tracks from playlists"; their
 * choices: an edit mode, and a question before each removal.
 *
 *   ⋯ → Edit playlist (playlists-native.js offers it where it offers Rename and Delete, the playlist not read-only)
 *   → the rows in the playlist's own order, each with a red − on its left and a ≡ on its right; a tap elsewhere on a row
 *   plays nothing; the top block shows Done alone.
 *   − asks "Remove … from this playlist?" (Cancel · Remove); ≡ drags the row (a finger or a mouse; the arrow keys move
 *   it one place); each change goes to Roon at once (POST /api/roon-playlists/remove, /move) and is kept only when your
 *   server's read-back shows it. One change at a time.
 *   After each change kept, the page's own list of the tracks (the one Play now, Queue and a row's tap read) is changed
 *   the same way and every place numbered again, so the page acts on the playlist as it now is.
 *
 * Loaded by playlist-tracks.js, which keeps the rows' track list on the list (ol.__rows) for this; brings its stylesheet.
 */
(() => {
  "use strict";
  /** @type {any} */
  const W = window;
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "playlist-edit.css" }));
  /** @param {string} msg @param {string} [kind] */
  const toast = (msg, kind) => { if (W.RouenHost) W.RouenHost.toast(msg, kind); };
  /** A line that is only a count of tracks (playlist-top.js's), renumbered after a removal. */
  const COUNT = /^\s*[\d,.\s]+\s+tracks?\s*$/i;
  /** Room kept at the top block and the screen's foot, where a dragged row scrolls the page. */
  const EDGE = 56;

  /**
   * The page being edited, if one is.
   * @type {null | { page: HTMLElement, ol: HTMLOListElement, p: { id: string, name: string }, rows: any[],
   *                 sortWas: string, done: HTMLButtonElement, busy: boolean, onClick: (e: Event) => void }}
   */
  let ed = null;
  /** The row being dragged, if one is. @type {null | { li: HTMLElement, from: number, id: number, grab: number, y: number, timer: any }} */
  let drag = null;

  /** @param {string} url @param {any} body @returns {Promise<any>} */
  async function post(url, body) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      return j && typeof j === "object" ? j : { ok: false, error: "Rouen gave no answer." };
    } catch (e) {
      return { ok: false, error: "Couldn't reach Rouen." };
    }
  }

  /** The app's question, its buttons saying Cancel and Remove for this one (menus.js's dialog says No and Yes). */
  const ask = (/** @type {string} */ message) => W.RouenMenus.confirmDialog(message, { yes: "Remove", no: "Cancel" });

  const rowsOf = () => /** @type {HTMLElement[]} */ (ed ? Array.from(ed.ol.children) : []);
  const placeOf = (/** @type {HTMLElement} */ li) => rowsOf().indexOf(li);

  /** Each track's place and each row's numbered again, after a change kept. */
  function renumber() {
    if (!ed) return;
    ed.rows.forEach((t, i) => { t.index = i; });
    rowsOf().forEach((li, i) => { /** @type {any} */ (li).__order = i; li.dataset.pos = String(i + 1); li.dataset.index = String(i); });
  }

  /**
   * The count one less wherever the page says it: its line under the name (.playlist-sub, playlist-head.js) and beside
   * the name on a touch screen (playlist-top.js). Roon's count, less one: a long playlist's line counts tracks the page
   * didn't read (the review).
   */
  function recount() {
    if (!ed) return;
    const lines = [...Array.from(ed.page.querySelectorAll(".playlist-head .playlist-sub")), ...Array.from(document.querySelectorAll("#tnav-heading .plt-count"))];
    for (const el of lines) {
      const t = el.textContent || "";
      if (el.children.length || !COUNT.test(t)) continue;
      const n = Math.max(0, Number(t.replace(/[^\d]/g, "")) - 1);
      el.textContent = `${n.toLocaleString("en")} Track${n === 1 ? "" : "s"}`;
    }
  }
  /** How many tracks the page has, when it has them all (no "Showing the first … of …" note): the server checks it. */
  function countSent() {
    if (!ed) return undefined;
    const cut = Array.from(ed.page.querySelectorAll(".playlist-empty")).some((x) => /^Showing the first /.test(x.textContent || ""));
    return cut ? undefined : ed.rows.length;
  }

  /** While a change is on its way: the page says so, and refuses another. @param {boolean} on */
  function busy(on) {
    if (!ed) return;
    ed.busy = on;
    ed.page.classList.toggle("ple-busy", on);
  }

  /** A row's − and ≡. @param {HTMLElement} li @param {any} t  its track */
  function controls(li, t) {
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "ple-remove";
    minus.setAttribute("aria-label", `Remove ${t.title || "this track"}`);
    minus.addEventListener("click", (e) => { e.stopPropagation(); removeRow(li); });
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "ple-grip";
    grip.setAttribute("aria-label", `Move ${t.title || "this track"}`);
    grip.textContent = "≡";
    grip.addEventListener("pointerdown", (e) => grab(e, li, grip));
    grip.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const from = placeOf(li), to = from + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= rowsOf().length) return;
      if (refused()) return;
      const ol = /** @type {any} */ (ed).ol;
      ol.insertBefore(li, e.key === "ArrowUp" ? li.previousElementSibling : (li.nextElementSibling ? li.nextElementSibling.nextElementSibling : null));
      grip.focus();
      send(li, from, to);
    });
    li.prepend(minus);
    li.append(grip);
  }

  /** Another change while one is on its way, or a row is being dragged: said, and refused. */
  function refused() {
    if (!ed) return true;
    if (ed.busy || drag) { toast("One change at a time"); return true; }
    return false;
  }

  /**
   * Edit mode on a playlist's page.
   * @param {HTMLElement} page  its .playlist-detail @param {{ id: string, name: string }} p  the playlist, as Roon lists it
   */
  function start(page, p) {
    if (ed) stop();
    const PT = W.RouenPlaylistTracks;
    const ol = /** @type {HTMLOListElement | null} */ (page.querySelector("ol.playlist-tracks"));
    const rows = ol ? /** @type {any} */ (ol).__rows : null;
    if (!ol || !Array.isArray(rows) || !rows.length) { toast("This playlist has no tracks to edit here.", "error"); return; }
    // The playlist's own order (the Sort the page had is put back on Done), and the find closed. Sorted here, not by
    // the Sort's button, which would keep Playlist order as this device's choice should the page be left without Done.
    const sortWas = ol.dataset.sort || "order";
    if (sortWas !== "order" && PT) sorted(page, ol, "order");
    const find = page.querySelector(".playlist-find");
    const shut = /** @type {HTMLElement | null} */ (find && !find.classList.contains("hidden") ? find.querySelector(".playlist-find-close") : null);
    if (shut) shut.click();
    // The rows as the page's track list has them, one for one: anything else and a place sent would name another track.
    const lis = /** @type {any[]} */ (Array.from(ol.children));
    if (lis.length !== rows.length || lis.some((li, i) => li.__order !== i)) { toast("This page's rows aren't the playlist's; reopen it to edit it.", "error"); return; }
    const done = document.createElement("button");
    done.type = "button";
    done.className = "action-btn primary ple-done";
    done.textContent = "Done";
    done.addEventListener("click", () => { if (!refused()) stop(); });
    const actions = page.querySelector(".playlist-actions");
    if (actions) actions.prepend(done); else ol.before(done);
    // A tap on a row plays nothing while editing: stopped on its way to the row, unless it is on the row's − or ≡.
    const onClick = (/** @type {Event} */ e) => {
      const t = /** @type {Element} */ (e.target);
      if (t && t.closest && t.closest(".ple-remove, .ple-grip")) return;
      e.stopPropagation();
      e.preventDefault();
    };
    ol.addEventListener("click", onClick, true);
    ed = { page, ol, p, rows, sortWas, done, busy: false, onClick };
    lis.forEach((li, i) => controls(li, rows[i]));
    page.classList.add("is-editing");
  }

  /** The rows in a Sort's order and its button shown pressed, the choice this device keeps left alone. */
  function sorted(/** @type {HTMLElement} */ page, /** @type {HTMLOListElement} */ ol, /** @type {string} */ mode) {
    W.RouenPlaylistTracks.sortRows(ol, mode);
    for (const b of Array.from(page.querySelectorAll(".playlist-sort-btn"))) {
      b.setAttribute("aria-pressed", /** @type {HTMLElement} */ (b).dataset.sort === mode ? "true" : "false");
    }
  }

  /** Edit mode off: the rows as they were but for the changes kept, and the Sort the page had. */
  function stop() {
    if (!ed) return;
    const e = ed;
    endDrag(true);
    ed = null;
    e.ol.removeEventListener("click", e.onClick, true);
    for (const x of Array.from(e.ol.querySelectorAll(".ple-remove, .ple-grip"))) x.remove();
    e.done.remove();
    e.page.classList.remove("is-editing", "ple-busy");
    if (e.sortWas !== "order" && W.RouenPlaylistTracks) sorted(e.page, e.ol, e.sortWas);
  }

  /** − : asked first; gone from the page once your server shows it gone from the playlist. @param {HTMLElement} li */
  async function removeRow(li) {
    if (refused()) return;
    const e = /** @type {NonNullable<typeof ed>} */ (ed);
    const at = placeOf(li), t = e.rows[at];
    if (at < 0 || !t) return;
    if (!(await ask(`Remove "${t.title}" from this playlist?`))) return;
    if (ed !== e || refused()) return;
    busy(true);
    const j = await post("/api/roon-playlists/remove", { id: e.p.id, at, title: t.title || "", count: countSent() });
    if (ed !== e) return;
    busy(false);
    if (!j.ok) { toast(j.error || "Roon didn't take that change.", "error"); return; }
    li.remove();
    e.rows.splice(at, 1);
    renumber();
    recount();
    /** @type {any} */ (e.ol).__edited = true;
  }

  /**
   * A row put at a new place on the page: sent, kept there when your server shows it moved, put back when not.
   * @param {HTMLElement} li @param {number} from @param {number} to
   */
  async function send(li, from, to) {
    const e = /** @type {NonNullable<typeof ed>} */ (ed);
    const moving = e.rows[from], there = e.rows[to];
    busy(true);
    const j = await post("/api/roon-playlists/move", { id: e.p.id, from, from_title: moving.title || "", to, to_title: there.title || "", count: countSent() });
    if (ed !== e) return;
    busy(false);
    if (!j.ok) {
      li.remove();
      e.ol.insertBefore(li, e.ol.children[from] || null);
      toast(j.error || "Roon didn't take that change.", "error");
      return;
    }
    e.rows.splice(from, 1);
    e.rows.splice(to, 0, moving);
    renumber();
    /** @type {any} */ (e.ol).__edited = true;
  }

  // ---- Dragging by the ≡ ---------------------------------------------------------------------------------------------

  /** The element that scrolls the rows: the first scrolling one above them. @param {HTMLElement} el */
  function scrollerOf(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    }
    return /** @type {HTMLElement} */ (document.scrollingElement || document.documentElement);
  }
  /** Where rows can be seen: under the page's held top, above the mini player and the bar. */
  function band() {
    const top = ed ? ed.page.querySelector(".playlist-top") : null;
    let lo = top ? top.getBoundingClientRect().bottom : 0, hi = window.innerHeight;
    for (const sel of [".mini-transport", "#touch-nav"]) {
      const x = document.querySelector(sel);
      const q = x && x.getClientRects().length ? x.getBoundingClientRect() : null;
      if (q && q.height && q.top < hi && q.top > window.innerHeight / 2) hi = q.top;
    }
    lo = Math.max(0, lo);
    return { lo, hi };
  }

  /** @param {PointerEvent} e @param {HTMLElement} li @param {HTMLElement} grip */
  function grab(e, li, grip) {
    if (!ed || drag || e.button > 0) return;
    e.preventDefault();
    if (refused()) return;
    // The pointer's moves and release are taken on the window, so a drag ends wherever it is let go, captured or not.
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* not capturable (released already): the window's pointerup ends it */ }
    drag = { li, from: placeOf(li), id: e.pointerId, grab: e.clientY - li.getBoundingClientRect().top, y: e.clientY, timer: null };
    li.classList.add("is-dragging");
    ed.ol.classList.add("ple-dragging");
    const move = (/** @type {PointerEvent} */ m) => { if (drag && m.pointerId === drag.id) { drag.y = m.clientY; follow(); } };
    const up = (/** @type {PointerEvent} */ u) => {
      if (!drag || u.pointerId !== drag.id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      endDrag(u.type === "pointercancel");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    // Near the top block or the screen's foot, the page scrolls on its own while the finger is held.
    drag.timer = setInterval(() => {
      if (!drag) return;
      const { lo, hi } = band();
      const by = drag.y < lo + EDGE ? -12 : drag.y > hi - EDGE ? 12 : 0;
      if (!by) return;
      scrollerOf(drag.li).scrollTop += by;
      follow();
    }, 16);
    follow();
  }

  /** The dragged row past each neighbour whose middle the pointer has crossed, and drawn under the pointer. */
  function follow() {
    if (!drag || !ed) return;
    const { li } = drag;
    li.style.transform = "";
    for (;;) {
      const prev = /** @type {HTMLElement | null} */ (li.previousElementSibling), next = /** @type {HTMLElement | null} */ (li.nextElementSibling);
      const mid = (/** @type {HTMLElement} */ x) => { const q = x.getBoundingClientRect(); return q.top + q.height / 2; };
      if (prev && drag.y < mid(prev)) ed.ol.insertBefore(li, prev);
      else if (next && drag.y > mid(next)) ed.ol.insertBefore(li, next.nextElementSibling);
      else break;
    }
    li.style.transform = `translateY(${Math.round(drag.y - drag.grab - li.getBoundingClientRect().top)}px)`;
  }

  /** The drag over: sent when the row is at a new place; back where it was when cancelled. @param {boolean} cancel */
  function endDrag(cancel) {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearInterval(d.timer);
    d.li.style.transform = "";
    d.li.classList.remove("is-dragging");
    if (!ed) return;
    ed.ol.classList.remove("ple-dragging");
    const to = placeOf(d.li);
    if (to === d.from) return;
    if (cancel || ed.busy) {
      d.li.remove();
      ed.ol.insertBefore(d.li, ed.ol.children[d.from] || null);
      if (!cancel) toast("One change at a time");
      return;
    }
    send(d.li, d.from, to);
  }

  W.RouenPlaylistEdit = { start, stop, editing: () => !!ed && ed.page.isConnected };
})();
