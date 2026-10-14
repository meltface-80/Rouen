// @ts-check
/*
 * menus.js — the app's two small shared popups (v1.9.25): the ⋯ overflow menu
 * and the yes/no confirm dialog. Moved here unchanged from app.js and
 * index.html (dev/quality.md's order, item 6), with one fix:
 *
 *   THE MINI TRANSPORT IS NOT ROOM. A ⋯ menu opens under its button, and is
 *   turned upward when the box that clips it has more room above (Mandarin
 *   v0.7.8). That box is the nearest scrolling ancestor — on the album view,
 *   its scroller, which runs to the foot of the window. But the mini transport
 *   is fixed OVER it (z-index 70, the modal's 50), so the last ~90px of the
 *   room measured below were under the bar: a menu that "fitted" was drawn
 *   behind it, out of reach (reported from a phone, v1.9.24). The bar's edge
 *   now ends the room on its side, wherever the bar is (a desktop's card can
 *   be moved to the top half, v1.8.81).
 *
 * Loaded first of the page's scripts, so the confirm dialog's markup keeps its
 * place before the sheets the other scripts add, and window.RouenMenus is
 * there before app.js reads it.
 */
(function rouenMenus() {
  "use strict";

  // ---- the confirm dialog (e.g. move queue on zone change) ------------------
  document.body.insertAdjacentHTML("beforeend", `
  <div id="confirm-overlay" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="confirm-msg">
    <div class="confirm-backdrop"></div>
    <div class="confirm-box">
      <p class="confirm-msg" id="confirm-msg"></p>
      <div class="confirm-actions">
        <button class="confirm-btn" id="confirm-no" type="button">No</button>
        <button class="confirm-btn confirm-primary" id="confirm-yes" type="button">Yes</button>
      </div>
    </div>
  </div>`);

  /**
   * Styled yes/no confirm. Resolves true/false. Falls back to native confirm.
   * @param {string} message @returns {Promise<boolean>}
   */
  function confirmDialog(message) {
    return new Promise((resolve) => {
      const ov  = document.getElementById("confirm-overlay");
      const msg = document.getElementById("confirm-msg");
      const yes = document.getElementById("confirm-yes");
      const no  = document.getElementById("confirm-no");
      if (!ov || !msg || !yes || !no) { resolve(window.confirm(message)); return; }
      msg.textContent = message;
      let done = false;
      const onYes = () => close(true);
      const onNo  = () => close(false);
      const onBackdrop = (/** @type {Event} */ e) => {
        const t = /** @type {Element} */ (e.target);
        if (t.classList.contains("confirm-backdrop")) close(false);
      };
      /** @param {boolean} val */
      function close(val) {
        if (done) return; done = true;
        ov.classList.add("hidden");
        yes.removeEventListener("click", onYes);
        no.removeEventListener("click", onNo);
        ov.removeEventListener("click", onBackdrop);
        resolve(val);
      }
      yes.addEventListener("click", onYes);
      no.addEventListener("click", onNo);
      ov.addEventListener("click", onBackdrop);
      ov.classList.remove("hidden");
    });
  }

  // ---- the ⋯ overflow menu ---------------------------------------------------
  // The three dots only. The circle round them is the BUTTON's border
  // (.overflow-btn in style.css) since v1.8.60: drawn here, it was a ring about
  // half the height of the Play now / Queue pills it sits beside.
  const OVERFLOW_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="6" cy="12" r="1.9"/>' +
    '<circle cx="12" cy="12" r="1.9"/>' +
    '<circle cx="18" cy="12" r="1.9"/>' +
    "</svg>";

  // Close whichever overflow menu is open. Module-level rather than per-menu so
  // opening one closes any other, and so a screen teardown can shut it.
  /** @type {{ btn: HTMLElement, menu: HTMLElement } | null} */
  let openOverflow = null;
  function closeOverflowMenu() {
    if (!openOverflow) return;
    openOverflow.menu.classList.add("hidden");
    openOverflow.btn.setAttribute("aria-expanded", "false");
    openOverflow = null;
  }
  document.addEventListener("click", (e) => {
    const t = /** @type {Element} */ (e.target);
    if (openOverflow && !(t && t.closest && t.closest(".overflow-wrap"))) closeOverflowMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverflowMenu();
  });

  /**
   * The room a menu has above and below its button: the box that clips it (the
   * nearest scrolling ancestor, within the window), less the mini transport
   * where the bar lies over that box beside the menu.
   * @param {HTMLElement} menu @param {DOMRect} m the menu's box @param {DOMRect} b the button's
   */
  function roomFor(menu, m, b) {
    let top = 0, bottom = window.innerHeight;
    for (let el = menu.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowY)) {
        const r = el.getBoundingClientRect();
        top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom);
        break;
      }
    }
    const bar = document.getElementById("mini-transport");
    if (bar && !bar.classList.contains("hidden")) {
      const r = bar.getBoundingClientRect();
      const beside = r.height > 0 && r.left < Math.max(m.right, b.right) && r.right > Math.min(m.left, b.left);
      if (beside && r.top >= b.bottom) bottom = Math.min(bottom, r.top);
      else if (beside && r.bottom <= b.top) top = Math.max(top, r.bottom);
    }
    return { top, bottom };
  }

  /*
   * A menu that would be cut off, opened the other way (Mandarin v0.7.8). A
   * menu opens under its button as a rule, but the box that clips it is not
   * always where the rule expects: a playlist's ⋯ at the foot of the screen,
   * or an album's with its row near the bar. A menu cut off by a box that does
   * not scroll — or drawn under the bar — cannot be reached at all. So it is
   * measured as it opens, and turned round when the other side has more room.
   */
  /** @param {HTMLElement} menu @param {HTMLElement} btn */
  function placeOverflowMenu(menu, btn) {
    menu.classList.remove("opens-up", "opens-down");
    const m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect();
    const { top, bottom } = roomFor(menu, m, b);
    const up = m.bottom <= b.top + 1;
    const roomAbove = b.top - top - 6, roomBelow = bottom - b.bottom - 6;
    if (up && m.height > roomAbove && roomBelow > roomAbove) menu.classList.add("opens-down");
    else if (!up && m.height > roomBelow && roomAbove > roomBelow) menu.classList.add("opens-up");
  }

  /**
   * @typedef {{ label: string, onClick: (b: HTMLButtonElement) => void, danger?: boolean, title?: string }} MenuItem
   * @param {Array<MenuItem | null | undefined | false>} items
   * @param {{ label?: string, title?: string }} [opts]
   * @returns {HTMLDivElement} the wrapper to append
   */
  function buildOverflowMenu(items, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "overflow-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "overflow-btn";
    btn.setAttribute("aria-label", opts.label || "More actions");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = OVERFLOW_SVG;

    const menu = document.createElement("div");
    menu.className = "sel-menu overflow-menu hidden";
    menu.setAttribute("role", "menu");
    if (opts.title) {
      const t = document.createElement("div");
      t.className = "sel-menu-title";
      t.textContent = opts.title;
      menu.appendChild(t);
    }
    for (const it of items) {
      if (!it) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sel-menu-item" + (it.danger ? " is-danger" : "");
      b.setAttribute("role", "menuitem");
      b.textContent = it.label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        closeOverflowMenu();
        // The button is passed on so an action can disable it / show progress,
        // exactly as the pill buttons it replaced did.
        it.onClick(b);
      });
      menu.appendChild(b);
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = openOverflow && openOverflow.menu === menu;
      closeOverflowMenu();
      if (wasOpen) return;
      menu.classList.remove("hidden");
      placeOverflowMenu(menu, btn);
      btn.setAttribute("aria-expanded", "true");
      openOverflow = { btn, menu };
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  /** @type {any} */ (window).RouenMenus = { buildOverflowMenu, closeOverflowMenu, confirmDialog };
})();
