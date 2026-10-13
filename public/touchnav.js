// @ts-check
/*
 * touchnav.js — the touch layout's row along the foot of the screen
 * (v1.9.14, ported from Mandarin v0.9.6): Menu, Home, Library and Search
 * under the mini player, on a phone or a tablet in either orientation. A
 * desktop (a mouse) never shows it: the layout is touchnav.css, under the same
 * media query as the touch-sized mini player (style.css, v1.8.81).
 *
 * The row is built here rather than written into index.html, which is at
 * its length baseline. Loaded after app.js.
 *
 * Each button works the page's own control, so there is one way to do each
 * thing: the menu is #menu-toggle's, Library is Home's "Library" heading's
 * (the full A–Z wall), Search is the top bar's glass, and Home is the page's
 * own showHome. What covers the screen (an album's page) closes first, as
 * its Back would.
 *
 * It also tells the layout, on <html>, what is on screen: tn-home (Home, so
 * no top bar), tn-search (the search open, so the top bar is back with the
 * field across it), tn-lib (the Library wall), tn-filter (the Library's
 * filter, or the Labels list's search, open: the top bar back for its
 * field), tn-labels (the Labels list), tn-np (Now playing, which has its own
 * transport and no row).
 *
 * Elsewhere (the grid screens) the top bar has no strip: its buttons float
 * over the albums, which scroll up to the screen's edge, and the screen's
 * title (#album-count) is the page's heading, at the top of <main>, moved
 * there while the touch layout applies and back to the bar when it doesn't.
 * It is moved, not copied, so app.js, which finds it by id, keeps working.
 * On the Library wall Search opens its filter ("starts with"), and on the
 * Labels list its "Search labels", not Home's: their own glasses give way.
 *
 * Mandarin's row also carries an Offline sign; Rouen has no offline mode, so
 * it has none.
 */
(function touchNav() {
  "use strict";
  const ICON = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  /** [id, label, the icon's shapes] */
  const BUTTONS = [
    ["tnav-menu", "Menu", '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>'],
    ["tnav-home", "Home", '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h4.5v-6h4v6h4.5V9"/>'],
    ["tnav-library", "Library", '<line x1="5" y1="4" x2="5" y2="20"/><line x1="10" y1="4" x2="10" y2="20"/><path d="m14.5 4.6 4.6 14.8"/>'],
    ["tnav-search", "Search", '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'],
  ];
  const nav = document.createElement("nav");
  nav.id = "touch-nav";
  nav.className = "touch-nav";
  nav.setAttribute("aria-label", "Main");
  for (const [id, label, shapes] of BUTTONS) {
    const b = document.createElement("button");
    b.id = id;
    b.className = "tnav-btn";
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.innerHTML = `<svg ${ICON}>${shapes}</svg><span>${label}</span>`;
    nav.appendChild(b);
  }
  // After the mini player, where Mandarin's markup has it.
  const mini = document.getElementById("mini-transport");
  if (mini && mini.parentNode) mini.parentNode.insertBefore(nav, mini.nextSibling);
  else document.body.appendChild(nav);

  const root = document.documentElement;
  /** @param {string} id */
  const byId = (id) => document.getElementById(id);
  const home = byId("home-view");
  const topbar = document.querySelector(".topbar");
  const search = byId("topbar-search");
  const modal = byId("album-modal");
  const labels = byId("labels-tools");
  /** @param {Element | null} el @param {string} cls */
  const has = (el, cls) => !!el && el.classList.contains(cls);

  /* What is on screen, as classes on <html> for touchnav.css. */
  function sync() {
    const modalOpen = !!modal && !has(modal, "hidden");
    root.classList.toggle("tn-home", !!home && !has(home, "hidden"));
    root.classList.toggle("tn-search", has(search, "is-open"));
    root.classList.toggle("tn-lib", has(topbar, "lib-wall"));
    root.classList.toggle("tn-filter", has(topbar, "lib-filtering") || has(topbar, "labels-searching"));
    // The Labels list: app.js shows its tools on the list only, not on one label's albums.
    root.classList.toggle("tn-labels", !!labels && !has(labels, "hidden"));
    // Now playing (the album tab of the player's own screen): as app.js's onNowPlayingScreen.
    root.classList.toggle("tn-np", modalOpen && has(modal, "np-mode") && has(modal, "tab-album"));
  }
  for (const el of [home, topbar, search, modal, labels]) {
    if (el) new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ["class"] });
  }
  sync();

  /* An album's page over the screen closes, as its Back does. */
  function clearOver() {
    if (!modal || has(modal, "hidden")) return;
    const back = byId("modal-close-btn");
    if (back) back.click();
  }
  /* The screen already showing: back to its top, as a second tap does in other apps. */
  function toTop() {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }
  const w = /** @type {any} */ (window);

  /** @param {string} id @param {(e: MouseEvent) => void} fn */
  function on(id, fn) {
    const b = byId(id);
    if (b) b.addEventListener("click", fn);
  }
  on("tnav-menu", () => { const m = byId("menu-toggle"); if (m) m.click(); });
  on("tnav-home", () => {
    const already = root.classList.contains("tn-home") && !(modal && !has(modal, "hidden"));
    clearOver();
    if (already && !root.classList.contains("tn-search")) { toTop(); return; }
    if (typeof w.__showHome === "function") w.__showHome();
  });
  on("tnav-library", () => {
    const already = root.classList.contains("tn-lib") && !(modal && !has(modal, "hidden"));
    clearOver();
    if (already) { toTop(); return; }
    const heading = byId("home-library-title");
    if (heading) heading.click();
  });
  on("tnav-search", (e) => {
    // The page closes its search on any tap outside it: this one opens it.
    e.stopPropagation();
    if (has(search, "is-open")) { const i = byId("search-input"); if (i) i.focus(); return; }
    clearOver();
    // The Library wall: its own filter, opened (its glass is hidden in this layout) or, open, its field.
    if (root.classList.contains("tn-lib")) {
      const field = /** @type {HTMLElement | null} */ (document.querySelector("#library-filter .lib-filter-input"));
      const glass = /** @type {HTMLElement | null} */ (document.querySelector("#library-filter .lib-filter-btn"));
      if (field) field.focus(); else if (glass) glass.click();
      return;
    }
    // The Labels list: "Search labels", opened or, open, its field.
    if (root.classList.contains("tn-labels")) {
      if (has(topbar, "labels-searching")) { const i = byId("labels-search-input"); if (i) i.focus(); }
      else { const glass = byId("labels-search-open"); if (glass) glass.click(); }
      return;
    }
    // The search is Home's: from anywhere else, Home first.
    if (has(search, "hidden") && typeof w.__showHome === "function") w.__showHome();
    const glass = byId("search-open");
    if (glass) glass.click();
    // On Home the bar's row is hidden until tn-search is on <html>, and the
    // observer that puts it there runs after this handler: app.js's focus()
    // met a hidden field, so a phone raised no keyboard. The layout now, and
    // the focus again, inside the tap (iOS raises the keyboard only there).
    sync();
    const input = byId("search-input");
    if (input && has(search, "is-open")) input.focus();
  });

  /* The screen's title: the page's heading in the touch layout, the bar's otherwise. */
  const title = byId("album-count");
  const main = document.querySelector("main");
  if (title && title.parentNode && main) {
    const home0 = { parent: title.parentNode, next: title.nextSibling };
    const heading = document.createElement("div");
    heading.id = "tnav-heading";
    heading.className = "tnav-heading";
    main.insertBefore(heading, main.firstChild);
    const touch = window.matchMedia("(hover: none), (pointer: coarse)");
    const place = () => {
      if (touch.matches) { if (title.parentNode !== heading) heading.appendChild(title); }
      else if (title.parentNode !== home0.parent) home0.parent.insertBefore(title, home0.next && home0.next.parentNode === home0.parent ? home0.next : null);
    };
    place();
    touch.addEventListener("change", place);
  }
})();
