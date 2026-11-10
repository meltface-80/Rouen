// @ts-check
// The mini player, moved about on a desktop. Moved out of app.js in v2.0.3-t12, unchanged (dev/quality.md, "Splitting
// the monoliths"); loaded by app.js. test/dom/mini-drag.test.js.
/* ------------------------------------------------------------------ */
/*  The mini player, moved about on a desktop (v1.8.81, Mandarin      */
/*  v0.7.11)                                                          */
/* ------------------------------------------------------------------ */
/*
 * Press anywhere on the bar but a button and drag: it goes where it is put,
 * kept wholly on screen, and stays there (this browser remembers it). A
 * press that hardly moves is a click as before — the cover and the title
 * still open Now playing. Double-click the bar to send it back to its
 * corner. Desktops only (a mouse, 1024px and wider, as the stylesheet's
 * desktop size): on a phone or a tablet it stays put. The sheets it opens
 * go with it: the volume sheet beside it, the zone list above it, or under
 * it when it is near the top of the screen.
 *
 * Two things learned building it, both kept: the moves and the release are
 * followed on the WINDOW, because a quick flick leaves the bar before the
 * first move arrives; and the "swallow the next click" flag is cleared
 * straight after the release, because a release outside the bar fires no
 * click and the next real one would otherwise be lost.
 */
(function movableMiniPlayer() {
  const bar = document.getElementById("mini-transport");
  const volPop = document.getElementById("mt-vol-popover");
  if (!bar || !window.matchMedia) return;
  const desk = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)");
  const KEY = "rra-mini-pos";
  const MARGIN = 8, THRESHOLD = 5;
  let pos = null;            // { left, top } in px, or null: the corner
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Number.isFinite(v.left) && Number.isFinite(v.top)) pos = v; } catch (e) { /* storage blocked */ }

  const clamp = (p) => {
    const r = bar.getBoundingClientRect();
    return {
      left: Math.max(MARGIN, Math.min(window.innerWidth - r.width - MARGIN, p.left)),
      top: Math.max(MARGIN, Math.min(window.innerHeight - r.height - MARGIN, p.top))
    };
  };
  function place() {
    if (!desk.matches || !pos) {
      bar.style.left = bar.style.top = bar.style.right = bar.style.bottom = "";
      bar.classList.remove("mt-moved", "mt-drop-down");
      placeSheets();
      return;
    }
    // Hidden, it has no size to keep on screen: that waits till it shows.
    if (bar.offsetWidth) pos = clamp(pos);
    bar.style.left = pos.left + "px"; bar.style.top = pos.top + "px";
    bar.style.right = "auto"; bar.style.bottom = "auto";
    bar.classList.add("mt-moved");
    placeSheets();
  }
  // The sheets it opens, beside it wherever it is.
  function placeSheets() {
    room();
    const moved = desk.matches && !!pos;
    const r = bar.getBoundingClientRect();
    // Room above for the room list (it opens upwards): else under the bar.
    bar.classList.toggle("mt-drop-down", moved && r.top < 360);
    if (!volPop) return;
    if (!moved) { volPop.style.left = volPop.style.top = volPop.style.right = volPop.style.bottom = ""; return; }
    const h = volPop.offsetHeight || 96;
    const above = r.top - h - 8 >= MARGIN;
    volPop.style.left = r.left + "px"; volPop.style.right = "auto";
    volPop.style.top = (above ? r.top - h - 8 : r.bottom + 8) + "px"; volPop.style.bottom = "auto";
  }
  function save() { try { if (pos) localStorage.setItem(KEY, JSON.stringify(pos)); else localStorage.removeItem(KEY); } catch (e) { /* this visit only */ } }

  let drag = null, dragged = false;
  // The moves and the release followed on the window: a quick flick leaves
  // the bar before the first move is seen.
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      drag.moving = true;
      bar.classList.add("is-dragging");
    }
    pos = { left: drag.left + dx, top: drag.top + dy };
    place();
    e.preventDefault();
  };
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    // The click that may follow this release is swallowed, and only that
    // one: released off the bar there is none, and the next is a click.
    if (drag.moving) { dragged = true; save(); setTimeout(() => { dragged = false; }, 0); }
    drag = null;
    bar.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  bar.addEventListener("pointerdown", (e) => {
    if (!desk.matches || e.button !== 0 || drag) return;
    if (e.target.closest("button, a, input, select, .mt-zone-popover, .mt-vol-popover")) return;
    const r = bar.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moving: false };
    dragged = false;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  // The cover is an <img>: a press and move on it starts the browser's own
  // image drag, which cancels the pointer — the card stopped after its first
  // step whenever it was picked up by its biggest part (found in review; the
  // stylesheet's -webkit-user-drag covers WebKit, this covers the rest).
  bar.addEventListener("dragstart", (e) => e.preventDefault());
  // The room the card takes at the foot of the screen, MEASURED: it grows
  // with the text size (UI Settings, up to twice), and the page, the album
  // view, Now playing's queue, the share sheet and the volume sheet all read
  // it (--mt-room in the stylesheet's desktop block). Its height, its 16px
  // off the bottom and a 6px gap. Not on a phone or tablet, whose bar keeps
  // the stylesheet's own numbers.
  function room() {
    const root = document.documentElement;
    if (desk.matches && bar.offsetHeight) root.style.setProperty("--mt-room", (bar.offsetHeight + 22) + "px");
    else root.style.removeProperty("--mt-room");
  }
  if (window.ResizeObserver) new ResizeObserver(room).observe(bar);
  if (desk.addEventListener) desk.addEventListener("change", room); else if (desk.addListener) desk.addListener(room);
  room();
  // A drag is not a click: the cover and the title don't open Now playing
  // at the end of one.
  bar.addEventListener("click", (e) => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);
  // Back to its corner.
  bar.addEventListener("dblclick", (e) => {
    if (!desk.matches || e.target.closest("button, a, input, select, .mt-zone-popover, .mt-vol-popover")) return;
    pos = null; save(); place();
  });
  window.addEventListener("resize", () => place());
  if (desk.addEventListener) desk.addEventListener("change", place); else if (desk.addListener) desk.addListener(place);
  // The volume sheet placed as it opens (its height is known then).
  if (volPop) new MutationObserver(() => { if (!volPop.classList.contains("hidden")) placeSheets(); })
    .observe(volPop, { attributes: true, attributeFilter: ["class"] });
  // Shown again (it is hidden on Now playing): kept on screen. Only the
  // change from hidden to shown: place() sets the bar's own classes too.
  let shown = !bar.classList.contains("hidden");
  new MutationObserver(() => {
    const now = !bar.classList.contains("hidden");
    if (now && !shown) { room(); requestAnimationFrame(place); }
    shown = now;
  }).observe(bar, { attributes: true, attributeFilter: ["class"] });
  place();
  window.__miniPlayerPos = () => pos;
})();
