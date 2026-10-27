// @ts-check
/*
 * artists.js — the Artists screen (v1.9.70-t6, dev/design/artists.md §3): every album artist in the library, A to Z,
 * each a round picture, the name and how many albums, under a heading per letter, with a letter strip down the right
 * edge. A tap opens the artist's page, whose Back returns here as it was: the screen is drawn into the shared grid,
 * entered as the menu's screens are (RouenHost.enterFullWall), and the artist page keeps the screen it was opened
 * from and puts it back.
 *
 * Pictures (§3.2): the album credits' kept picture for the name, else one of the artist's covers. The names that
 * come on screen with none are asked for (GET /api/artists/photos, which queues their lookup), and asked once more
 * about 15 seconds later.
 *
 *   RouenArtists.open()       draws the screen (touchnav.js's Artists button)
 *   RouenArtists.showing()    whether it is the screen in the grid now
 */
(function artistsScreen() {
  "use strict";
  const W = /** @type {any} */ (window);
  const AGAIN_MS = 15000, BATCH_MS = 250, BATCH_MAX = 60, COVER_SIZE = 240;
  let seq = 0;
  /** The last opening's watcher of tiles coming on screen: let go when the screen is opened again (the review). @type {IntersectionObserver | null} */
  let watcher = null;

  /** @param {string} tag @param {string} cls @param {string} [text] */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** The screen in the grid now, or null. */
  function rootNow() {
    const H = W.RouenHost;
    const r = document.getElementById("artists-view");
    return H && r && H.grid.contains(r) && !H.grid.classList.contains("hidden") ? r : null;
  }

  /**
   * The photo, over the cover and the initial, which stay under it: one that fails to load (gone, or refusing a
   * hot-link) is removed and they show again, as album-credits.js's pictures do.
   * @param {HTMLElement} pic @param {string} url
   */
  function setPhoto(pic, url) {
    const img = /** @type {HTMLImageElement} */ (el("img", "artist-photo"));
    img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove());
    img.src = url;
    pic.appendChild(img);
    pic.dataset.photo = "1";
  }

  /**
   * One artist's tile.
   * @param {{ name: string, albums: number, cover: string | null, photo: string | null }} a
   */
  function tile(a) {
    const b = /** @type {HTMLButtonElement} */ (el("button", "artist-tile"));
    b.type = "button";
    b.dataset.name = a.name;
    b.setAttribute("aria-label", `${a.name}, ${a.albums} album${a.albums === 1 ? "" : "s"}`);
    const pic = el("span", "artist-pic");
    pic.setAttribute("aria-hidden", "true");
    // The first letter until a picture comes, and behind a cover that fails.
    pic.appendChild(el("span", "artist-initial", (a.name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase()));
    // The cover under the photo: what shows should the photo fail to load (§3.2).
    if (a.cover && W.RouenHost) W.RouenHost.loadArt(pic, a.cover, COVER_SIZE, (/** @type {HTMLImageElement} */ img) => img.remove());
    if (a.photo) setPhoto(pic, a.photo);
    b.append(pic, el("span", "artist-name", a.name), el("span", "artist-count", `${a.albums} album${a.albums === 1 ? "" : "s"}`));
    b.addEventListener("click", () => { if (typeof W.__showArtistAlbums === "function") W.__showArtistAlbums(a.name); });
    return b;
  }

  /**
   * The names on screen with no picture, asked for in batches; each asked once more later (§3.2).
   * @param {HTMLElement} root @param {number} mine
   */
  function pictures(root, mine) {
    /** Names come on screen, not asked yet. @type {Map<string, HTMLElement>} */
    const toAsk = new Map();
    /** Names asked and still with no photo. @type {Map<string, HTMLElement>} */
    const waiting = new Map();
    /** @type {Set<string>} */
    const asked = new Set();
    let timer = 0;
    // The same opening: the artist page parks this screen (its nodes out of the page) and puts it back on Back, so
    // a photo answered meanwhile still goes on its tile, and the asking goes on (the review).
    const live = () => mine === seq;
    /** @param {string[]} names @param {boolean} again */
    async function ask(names, again) {
      if (!names.length || !live()) return;
      const q = names.map((n) => "n=" + encodeURIComponent(n)).join("&");
      let j = null;
      try { const r = await fetch("/api/artists/photos?" + q, { cache: "no-store" }); j = r.ok ? await r.json() : null; }
      catch (e) { j = null; /* no answer: the tiles keep their covers, and the next opening asks again */ }
      if (!live() || !j || !j.photos) return;
      for (const n of names) {
        const t = waiting.get(n), url = j.photos[n];
        if (!t) continue;
        if (url) { const pic = /** @type {HTMLElement} */ (t.querySelector(".artist-pic")); if (pic) setPhoto(pic, url); waiting.delete(n); }
      }
      if (!again) setTimeout(() => ask(names.filter((n) => waiting.has(n)), true), AGAIN_MS);
    }
    const flush = () => {
      timer = 0;
      const names = [...toAsk.keys()].slice(0, BATCH_MAX);
      for (const n of names) { waiting.set(n, /** @type {HTMLElement} */ (toAsk.get(n))); toAsk.delete(n); asked.add(n); }
      ask(names, false);
      if (toAsk.size) timer = window.setTimeout(flush, BATCH_MS);
    };
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      if (!live()) { io.disconnect(); return; }
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const t = /** @type {HTMLElement} */ (e.target);
        io.unobserve(t);
        const name = t.dataset.name || "";
        if (name && !asked.has(name)) toAsk.set(name, t);
      }
      if (!timer && toAsk.size) timer = window.setTimeout(flush, BATCH_MS);
    }, { rootMargin: "200px 0px" });
    watcher = io;
    for (const t of root.querySelectorAll(".artist-tile")) {
      const pic = /** @type {HTMLElement | null} */ (t.querySelector(".artist-pic"));
      if (pic && !pic.dataset.photo) io.observe(t);
    }
  }

  async function open() {
    const H = W.RouenHost;
    if (!H) return;
    const mine = ++seq;
    if (watcher) { watcher.disconnect(); watcher = null; }
    H.enterFullWall("Artists", false);
    H.grid.innerHTML = "";
    const root = el("div", "artists-view");
    root.id = "artists-view";
    const note = el("p", "artists-note", "Reading your artists…");
    root.appendChild(note);
    H.grid.appendChild(root);
    /** @type {any} */
    let j = null;
    try { const r = await fetch("/api/artists", { cache: "no-store" }); j = await r.json(); if (!r.ok && !j.error) j.error = "HTTP " + r.status; }
    catch (e) { j = { error: "Couldn't reach Rouen." }; }
    // Another screen took the grid while Rouen answered: nothing to draw.
    if (mine !== seq || !H.grid.contains(root)) return;
    if (j.error) { note.textContent = "Your artists couldn't be read: " + j.error; return; }
    if (!j.ready) { note.textContent = "Your library is still being read. Your artists appear here once it has been."; return; }
    if (!j.artists.length) { note.textContent = "No artists yet: your library has no albums."; return; }
    note.remove();
    const list = el("div", "artists-list");
    const strip = el("nav", "artists-strip");
    strip.setAttribute("aria-label", "Jump to a letter");
    /** @type {HTMLElement | null} */
    let grid = null;
    let letter = "";
    for (const a of j.artists) {
      if (a.letter !== letter) {
        letter = a.letter;
        const head = el("h2", "artists-letter", letter);
        head.id = "artists-" + (letter === "#" ? "num" : letter);
        grid = el("div", "artists-grid");
        list.append(head, grid);
        const jump = /** @type {HTMLButtonElement} */ (el("button", "artists-jump", letter));
        jump.type = "button";
        jump.setAttribute("aria-label", letter === "#" ? "Names starting with a number or a sign" : "Artists under " + letter);
        jump.addEventListener("click", () => head.scrollIntoView({ block: "start" }));
        strip.appendChild(jump);
      }
      /** @type {HTMLElement} */ (grid).appendChild(tile(a));
    }
    root.append(list, strip);
    pictures(root, mine);
  }

  W.RouenArtists = { open, showing: () => !!rootNow() };
})();
