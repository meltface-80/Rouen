// @ts-check
/*
 * touchnav.js — the touch layout's row along the foot of the screen
 * (v1.9.14, ported from Mandarin v0.9.6): Home, Library, Artists, Shelf and
 * Search (the owner's order, v1.9.70-t6, dev/design/artists.md §1) under the
 * mini player, on a phone or a tablet in either orientation. The menu is a ☰
 * at the top left of Home (§2), not in the row. A
 * desktop (a mouse) never shows it: the layout is touchnav.css, under the same
 * media query as the touch-sized mini player (style.css, v1.8.81).
 *
 * The row is built here rather than written into index.html, which is at
 * its length baseline. Loaded after app.js.
 *
 * Each button works the page's own control, so there is one way to do each
 * thing: Home's ☰ is #menu-toggle's, Library is Home's "Library" heading's
 * (the full A–Z wall), Artists is artists.js's screen (loaded from here, with
 * its stylesheet), Shelf is the side menu's Shelf, Search is the top bar's
 * glass, and Home is the page's own showHome. What covers the screen (an
 * album's page) closes first, as its Back would.
 *
 * It also tells the layout, on <html>, what is on screen: tn-home (Home, so
 * no top bar), tn-search (the search open, so the top bar is back with the
 * field across it), tn-lib (the Library wall), tn-artists (the Artists
 * screen), tn-filter (the Library's
 * filter, or the Labels list's search, open: the top bar back for its
 * field), tn-labels (the Labels list), tn-np (Now playing, which has its own
 * transport and no row), tn-select (albums selected: the bar is back, for the
 * selection's menu, which lives in it), tn-share (the share card, which the
 * row must not sit over).
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
  const MENU = '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>';
  const BUTTONS = [
    ["tnav-home", "Home", '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h4.5v-6h4v6h4.5V9"/>'],
    ["tnav-library", "Library", '<line x1="5" y1="4" x2="5" y2="20"/><line x1="10" y1="4" x2="10" y2="20"/><path d="m14.5 4.6 4.6 14.8"/>'],
    ["tnav-artists", "Artists", '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.9-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/>'],
    // The side menu's Shelf icon (index.html's #menu-item-shelf).
    ["tnav-shelf", "Shelf", '<line x1="5" y1="4" x2="5" y2="17"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="13.2" y1="5.2" x2="17" y2="17"/><line x1="3" y1="20.5" x2="21" y2="20.5"/>'],
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
  // The menu on Home: a ☰ at its top left (v1.9.70-t6, artists.md §2), part of Home's page.
  const homeMenu = document.createElement("button");
  homeMenu.id = "tnav-home-menu";
  homeMenu.className = "tnav-home-menu";
  homeMenu.type = "button";
  homeMenu.setAttribute("aria-label", "Menu");
  homeMenu.innerHTML = `<svg ${ICON}>${MENU}</svg>`;
  const homeView = document.getElementById("home-view");
  if (homeView) homeView.insertBefore(homeMenu, homeView.firstChild);
  // The Artists screen and its look (artists.js, artists.css), loaded as plugins.js loads a plugin's files.
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "artists.css" }));
  document.body.appendChild(Object.assign(document.createElement("script"), { src: "artists.js", async: false }));

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
  const selecting = byId("select-menu-wrap");
  const share = byId("share-overlay");
  const grid = byId("album-grid");
  /** @param {Element | null} el @param {string} cls */
  const has = (el, cls) => !!el && el.classList.contains(cls);

  const w = /** @type {any} */ (window);
  /* What is on screen, as classes on <html> for touchnav.css. */
  function sync() {
    const modalOpen = !!modal && !has(modal, "hidden");
    root.classList.toggle("tn-home", !!home && !has(home, "hidden"));
    root.classList.toggle("tn-search", has(search, "is-open"));
    root.classList.toggle("tn-lib", has(topbar, "lib-wall"));
    root.classList.toggle("tn-artists", !!w.RouenArtists && w.RouenArtists.showing());
    root.classList.toggle("tn-filter", has(topbar, "lib-filtering") || has(topbar, "labels-searching"));
    // The Labels list: app.js shows its tools on the list only, not on one label's albums.
    root.classList.toggle("tn-labels", !!labels && !has(labels, "hidden"));
    // Now playing (the album tab of the player's own screen): as app.js's onNowPlayingScreen.
    root.classList.toggle("tn-np", modalOpen && has(modal, "np-mode") && has(modal, "tab-album"));
    root.classList.toggle("tn-select", !!selecting && !has(selecting, "hidden"));
    root.classList.toggle("tn-share", !!share && !has(share, "hidden"));
  }
  for (const el of [home, topbar, search, modal, labels, selecting, share]) {
    if (el) new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ["class"] });
  }
  // The Artists screen comes and goes as the grid's content, which changes often (a wall's pages, skeletons): looked
  // at once in 50 ms at most (the review). A timer, not a frame: a page in the background draws no frames.
  let syncAsked = 0;
  if (grid) new MutationObserver(() => { if (!syncAsked) syncAsked = window.setTimeout(() => { syncAsked = 0; sync(); }, 50); })
    .observe(grid, { childList: true, attributes: true, attributeFilter: ["class"] });

  /* What covers the screen closes, as its Back does: an album's page, or Now
     playing's Queue tab (the row is not on its album tab). Back from Now
     playing returns to the album it replaced, so Back is pressed until
     nothing is left over the screen — at most Now playing, then that album. */
  function clearOver() {
    const back = byId("modal-close-btn");
    for (let i = 0; i < 3 && back && modal && !has(modal, "hidden"); i++) back.click();
  }
  /* The screen already showing: back to its top, as a second tap does in other apps. */
  function toTop() {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** @param {string} id @param {(e: MouseEvent) => void} fn */
  function on(id, fn) {
    const b = byId(id);
    if (b) b.addEventListener("click", fn);
  }
  sync();
  on("tnav-home-menu", () => { const m = byId("menu-toggle"); if (m) m.click(); });
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
  on("tnav-artists", () => {
    const already = root.classList.contains("tn-artists") && !(modal && !has(modal, "hidden"));
    clearOver();
    if (already) { toTop(); return; }
    if (w.RouenArtists) w.RouenArtists.open();
  });
  on("tnav-shelf", () => { clearOver(); if (typeof w.__openShelf === "function") w.__openShelf(); });
  on("tnav-search", (e) => {
    // The page closes its search on any tap outside it: this one opens it, so
    // it goes no further. What else closes on a tap outside it (a volume or
    // zone sheet, a menu) is given that tap first, on the page itself.
    e.stopPropagation();
    if (has(search, "is-open")) { const i = byId("search-input"); if (i) i.focus(); return; }
    document.body.click();
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
    if (touch.addEventListener) touch.addEventListener("change", place);
    else if (touch.addListener) touch.addListener(place);   // Safari before 14
  }
})();
