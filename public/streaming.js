// @ts-check
/*
 * streaming.js — N2c-1 (dev/design/native-remote.md §10.3, v1.9.39): TIDAL and Qobuz as Roon shows
 * them, from the side menu's own entries, with Rouen's search box at the top (Roon's own search).
 *
 * A level's lists are rows; its albums and playlists are tiles with Roon's covers; its tracks are
 * rows played by a tap. An album or a playlist opens a page: its cover, title and credit, the album
 * view's action row (album-actions.js) and its tracks. Where a page is, is its path of titles from
 * the service's level (lib/provider/public/streaming.js), each with its position there.
 *
 * An album not in the library offers "Add to library" (album-actions.js RouenLibraryAdd, v1.9.41).
 *
 * It draws into the shared grid through RouenHost (app.js), and an answer that lands after the grid
 * has gone to another screen draws nothing. The side menu's TIDAL and Qobuz entries open it by
 * their data-target: the two hidden buttons made here.
 */
(function () {
  /** @type {any} */
  const W = window;

  // Rouen's own Qobuz and Tidal browsers' top-bar toggles (moved out of index.html in v1.9.39, unchanged):
  // inserted where they stood, before app.js runs, which finds them by id — global search's TIDAL and Qobuz
  // sections and Pitchfork's "Find on" still open those browsers through them (design §10.3).
  const pitchfork = document.getElementById("pitchfork-toggle");
  if (pitchfork) pitchfork.insertAdjacentHTML("beforebegin", `
        <!-- Qobuz "Q" logomark (Arcticons, CC BY 4.0) — 48-unit viewBox, so the
             3.6 stroke renders at the same visual weight as the 1.8 strokes
             on the neighbouring 24-unit icons. -->
        <button id="qobuz-toggle" class="icon-btn hidden" aria-label="Qobuz" title="Qobuz">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor"
               stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M39.203 39.203A21.43 21.43 0 0 0 45.5 24c0-11.874-9.626-21.5-21.5-21.5S2.5 12.126 2.5 24S12.126 45.5 24 45.5c4.89 0 9.4-1.633 13.012-4.383"/>
            <circle cx="24" cy="24" r="4.873"/>
            <path d="M32.944 32.944L45.5 45.5"/>
          </svg>
        </button>

        <!-- Hidden until a Tidal account is connected (app.js loadTidalStatus unhides it) -->
        <button id="tidal-toggle" class="icon-btn hidden" aria-label="Tidal" title="Tidal">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 9l3-3 3 3-3 3z"/>
            <path d="M9 9l3-3 3 3-3 3z"/>
            <path d="M16 9l3-3 3 3-3 3z"/>
            <path d="M9 16l3-3 3 3-3 3z"/>
          </svg>
        </button>
`);
  /** @type {Record<string, string>} */
  const NAMES = { tidal: "TIDAL", qobuz: "Qobuz" };

  /**
   * Where the screen is: a service, or a search begun from one; and the path of [title, position] from there.
   * skip: the path's lengths reached by a step the server took for the user (a level holding only the album
   * it was opened from, v1.9.40) — Back from there goes up past that level too.
   * @type {{ service: string, q: string, from: string, path: Array<[string, number]>, skip: number[] } | null}
   */
  let at = null;
  let seq = 0;

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** The zone the play goes to: the one chosen in the top bar, by app.js's own rule. */
  const zone = () => (W.__selectedZoneId ? W.__selectedZoneId() : null);

  /** Where the screen is, as the server takes it. */
  function where() {
    const a = /** @type {NonNullable<typeof at>} */ (at);
    return a.service === "search" ? { service: "search", q: a.q, path: a.path } : { service: a.service, path: a.path };
  }

  /** @param {string} msg @param {string} [kind] */
  const toast = (msg, kind) => { if (W.RouenHost) W.RouenHost.toast(msg, kind); };

  /**
   * A play, sent once: the button or row tapped is busy until Roon has answered, since every play walks
   * the whole path again and a second tap meanwhile would queue the album twice.
   * @param {string} url @param {any} body @param {HTMLElement} [from]
   */
  async function post(url, body, from) {
    const z = zone();
    if (!z) { toast("Choose a zone first", "error"); return; }
    if (from && from.dataset.busy) return;
    if (from) { from.dataset.busy = "1"; from.setAttribute("aria-busy", "true"); }
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign(where(), body, { zone_or_output_id: z })) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast(j.error || "Roon refused that", "error");
      else toast(j.invoked || "Sent to Roon");
    } catch (e) {
      toast("Couldn't reach Rouen", "error");
    } finally {
      if (from) { delete from.dataset.busy; from.removeAttribute("aria-busy"); }
    }
  }

  /** Opens the service's own level. @param {string} service */
  function open(service) {
    at = { service, q: "", from: service, path: [], skip: [] };
    draw();
  }

  /** Into one of this level's items. @param {string} title @param {number} pos */
  function into(title, pos) {
    if (!at) return;
    at.path.push([title, pos]);
    draw();
  }

  /** Up a level; from a search's own level, back to the service it was begun from. */
  function back() {
    if (!at) return;
    if (at.path.length) {
      const was = at.path.length;
      at.path.pop();
      if (at.skip.includes(was)) { at.skip = at.skip.filter((n) => n !== was); if (at.path.length) at.path.pop(); }
    } else if (at.service === "search") at = { service: at.from, q: "", from: at.from, path: [], skip: [] };
    draw();
  }

  /** The search box: Roon's own search, begun from this service. @param {HTMLElement} root */
  function searchBox(root) {
    const form = el("form", "streaming-search");
    form.style.cssText = "display:flex;gap:8px;";
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.type = "search";
    input.placeholder = "Search Roon";
    input.setAttribute("aria-label", "Search Roon");
    input.style.cssText = "flex:1 1 auto;min-width:0;";
    if (at && at.service === "search") input.value = at.q;
    const go = el("button", "action-btn", "Search");
    /** @type {HTMLButtonElement} */ (go).type = "submit";
    go.style.flex = "0 0 auto";
    form.appendChild(input);
    form.appendChild(go);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q || !at) return;
      at = { service: "search", q, from: at.from, path: [], skip: [] };
      draw();
    });
    root.appendChild(form);
  }

  /** A tile, as an album tile is drawn (app.js buildAlbumTile's markup). @param {any} it @param {() => void} onClick */
  function tile(it, onClick) {
    const btn = el("button", "album");
    /** @type {HTMLButtonElement} */ (btn).type = "button";
    btn.setAttribute("aria-label", it.title + (it.subtitle ? " by " + it.subtitle : ""));
    const art = el("div", "album-art-wrap");
    if (it.image_key) {
      // The key stays on the tile when a failed <img> removes itself, as app.js's tiles keep theirs.
      art.dataset.artKey = it.image_key;
      const img = /** @type {HTMLImageElement} */ (el("img"));
      img.loading = "lazy";
      img.alt = "";
      img.src = "/api/image/" + encodeURIComponent(it.image_key) + "?size=300";
      img.onerror = () => { art.classList.add("no-image"); img.remove(); };
      art.appendChild(img);
    } else art.classList.add("no-image");
    const meta = el("div", "album-meta");
    meta.appendChild(el("div", "album-title", it.title || "Untitled"));
    meta.appendChild(el("div", "album-artist", it.subtitle || ""));
    btn.appendChild(art);
    btn.appendChild(meta);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** A row: a list to open, or a track to play. @param {any} it @param {(li: HTMLElement) => void} onClick */
  function row(it, onClick) {
    const li = el("li", "track-row");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    const text = el("div", "track-text");
    text.appendChild(el("div", "track-title", it.title));
    if (it.subtitle) text.appendChild(el("div", "track-artist", it.subtitle));
    li.appendChild(text);
    li.addEventListener("click", () => onClick(li));
    li.addEventListener("keydown", (e) => { if (/** @type {KeyboardEvent} */ (e).key === "Enter") onClick(li); });
    return li;
  }

  /**
   * Items in Roon's order: a run of tiles (lists with a cover: albums, playlists) or of rows (lists
   * without one, and tracks, played where they are), a new run whenever the kind changes. Actions and
   * inputs are not offered. @param {HTMLElement} body @param {any[]} items
   */
  function drawItems(body, items) {
    for (const it of items) {
      if (it.hint !== "list" && it.hint !== "action_list") continue;
      const asTile = it.hint === "list" && !!it.image_key;
      let run = /** @type {HTMLElement | null} */ (body.lastElementChild);
      if (!run || !run.classList.contains(asTile ? "streaming-tiles" : "streaming-rows")) {
        run = asTile ? el("div", "streaming-tiles") : el("ol", "track-list playlist-tracks streaming-rows");
        if (asTile) run.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px;";
        body.appendChild(run);
      }
      if (asTile) run.appendChild(tile(it, () => into(it.title, it.pos)));
      else if (it.hint === "list") run.appendChild(row(it, () => into(it.title, it.pos)));
      else run.appendChild(row(it, (li) => post("/api/streaming/play-track", { pos: it.pos, title: it.title, kind: "play_now" }, li)));
    }
  }

  /**
   * A level's next items, under a More button, while Roon has more than are shown.
   * @param {HTMLElement} root @param {HTMLElement} body @param {number} next @param {number} count
   */
  function more(root, body, next, count) {
    if (next >= count) return;
    const b = /** @type {HTMLButtonElement} */ (el("button", "action-btn streaming-more", "More"));
    b.type = "button";
    b.style.alignSelf = "center";
    b.addEventListener("click", async () => {
      b.disabled = true;
      const mine = seq;
      const j = await fetchLevel(next);
      // The screen moved on while Roon answered: nothing to add.
      if (mine !== seq || !root.isConnected) return;
      b.remove();
      if (j.error) { root.appendChild(el("div", "playlist-empty", j.error)); return; }
      const items = j.items || [];
      drawItems(body, items);
      if (items.length) more(root, body, next + items.length, j.count);
    });
    root.appendChild(b);
  }

  /** A level: its items in Roon's order, and More while there are more. @param {HTMLElement} root @param {any} j */
  function drawLevel(root, j) {
    const body = el("div", "streaming-items");
    root.appendChild(body);
    drawItems(body, j.items || []);
    if (!body.childNodes.length) {
      root.appendChild(el("div", "playlist-empty", at && at.service === "search" ? "Roon's search found nothing for that." : "Nothing here."));
    }
    more(root, body, (j.offset || 0) + (j.items || []).length, j.count || 0);
  }

  /**
   * A page: cover, title and credit, the action row, the tracks, and the lists it also holds (an
   * artist's Albums). @param {HTMLElement} root @param {any} j
   */
  function drawPage(root, j) {
    const p = j.page;
    const self = p.self || { title: "", subtitle: null, image_key: null };
    const head = el("div", "playlist-head");
    head.style.cssText = "flex-direction:row;gap:14px;align-items:flex-end;";
    if (self.image_key) {
      const img = /** @type {HTMLImageElement} */ (el("img", "streaming-cover"));
      img.alt = "";
      img.src = "/api/image/" + encodeURIComponent(self.image_key) + "?size=300";
      img.style.cssText = "width:140px;height:140px;object-fit:cover;border-radius:6px;flex:0 0 auto;";
      head.appendChild(img);
    }
    const text = el("div");
    text.appendChild(el("h2", "playlist-title", self.title));
    if (self.subtitle) text.appendChild(el("div", "playlist-sub", self.subtitle));
    head.appendChild(text);
    root.appendChild(head);
    /**
     * In the library: the way to Rouen's own album view of it, under Roon's own strings (the album view's identity check).
     * @param {number} offset @param {string} title @param {string} artist
     */
    const openIn = (offset, title, artist) => {
      const lib = el("button", "action-btn", "In your library — open it there");
      /** @type {HTMLButtonElement} */ (lib).type = "button";
      lib.style.alignSelf = "flex-start";
      lib.addEventListener("click", () => {
        if (W.__openAlbum) W.__openAlbum({ offset, title, subtitle: artist, image_key: self.image_key }, { filter: null });
      });
      return lib;
    };
    if (p.library_offset !== null && p.library_offset !== undefined) {
      root.appendChild(openIn(p.library_offset, p.library_title || self.title, p.library_subtitle || self.subtitle || ""));
    }
    else if (p.kind === "album" && at && NAMES[at.from] && W.RouenLibraryAdd) {
      // Not in the library: added through your server, or as a favourite on the service (album-actions.js, v1.9.41).
      const add = W.RouenLibraryAdd.pageButton({ title: self.title, artist: self.subtitle || "", service: at.from,
        inLibrary: (/** @type {number} */ offset, /** @type {string} */ t, /** @type {string} */ a) => { add.replaceWith(openIn(offset, t, a)); } });
      add.style.alignSelf = "flex-start";
      root.appendChild(add);
    }
    const acts = el("div", "playlist-actions");
    root.appendChild(acts);
    if (W.RouenAlbumActions && W.RouenMenus) {
      W.RouenAlbumActions.build({ row: acts, answer: { actions: p.actions, album: { title: self.title, subtitle: self.subtitle || "" }, tracks: p.tracks },
        album: { title: self.title, subtitle: self.subtitle || "" },
        invoke: (/** @type {string} */ kind, /** @type {HTMLElement} */ btn) => post("/api/streaming/play", { kind }, btn),
        setListenLater: async () => null, toast, buildOverflowMenu: W.RouenMenus.buildOverflowMenu, listenLater: false, heart: false });
    }
    const ol = el("ol", "track-list playlist-tracks");
    for (const t of p.tracks || []) ol.appendChild(row(t, (li) => post("/api/streaming/play-track", { pos: t.pos, title: t.title, kind: "play_now" }, li)));
    if (ol.childNodes.length) root.appendChild(ol);
    const body = el("div", "streaming-items");
    drawItems(body, j.items || []);
    if (body.childNodes.length) root.appendChild(body);
    if (p.shown < j.count) root.appendChild(el("div", "playlist-empty", `The first ${p.shown} of ${j.count}.`));
  }

  /**
   * The level the screen is at, from `offset`: its items, or its page; `error` when it couldn't be read.
   * A search is read in the zone chosen, as its plays walk it. @param {number} offset
   */
  async function fetchLevel(offset) {
    const a = /** @type {NonNullable<typeof at>} */ (at);
    /** @type {Record<string, string>} */
    const q = { service: a.service, path: JSON.stringify(a.path), offset: String(offset), count: "60" };
    if (a.service === "search") {
      q.q = a.q;
      const z = zone();
      if (z) q.zone_or_output_id = z;
    }
    try {
      const r = await fetch("/api/streaming/level?" + new URLSearchParams(q).toString(), { cache: "no-store" });
      const j = await r.json().catch(() => ({ error: "Rouen answered with something other than the list (" + r.status + ")." }));
      if (!r.ok && !j.error) j.error = "Roon couldn't open that (" + r.status + ").";
      return j;
    } catch (e) {
      return { error: "Couldn't reach Rouen." };
    }
  }

  /** Draws where the screen is, from the server's answer. */
  async function draw() {
    const H = W.RouenHost;
    if (!H || !at) return;
    const mine = ++seq;
    const name = at.service === "search" ? "Search" : NAMES[at.service];
    H.enterFullWall(at.path.length ? at.path[at.path.length - 1][0] : at.service === "search" ? "Search: " + at.q : name);
    H.grid.innerHTML = "";
    const root = el("div", "playlist-detail streaming-view");
    root.dataset.service = at.service;
    H.grid.appendChild(root);
    if (at.path.length || at.service === "search") {
      const b = el("button", "action-btn playlist-back", "‹ Back");
      /** @type {HTMLButtonElement} */ (b).type = "button";
      b.addEventListener("click", back);
      root.appendChild(b);
    }
    if (!at.path.length) searchBox(root);
    const note = el("div", "playlist-empty", "Asking Roon…");
    root.appendChild(note);
    const j = await fetchLevel(0);
    // Another screen took the grid, or this one moved on, while Roon answered: nothing to draw.
    if (mine !== seq || !H.grid.contains(root)) return;
    note.remove();
    // A step the server took for the user: the screen is there now, its plays walk it, and Back skips the level.
    if (j.entered && j.entered.length) {
      for (const step of j.entered) at.path.push(step);
      at.skip.push(at.path.length);
    }
    if (j.error) { root.appendChild(el("div", "playlist-empty", j.error)); return; }
    if (j.page) drawPage(root, j);
    else drawLevel(root, j);
  }

  // The side menu's entries open it by their data-target (index.html): a hidden button each.
  for (const service of Object.keys(NAMES)) {
    const b = /** @type {HTMLButtonElement} */ (el("button"));
    b.type = "button";
    b.hidden = true;
    b.id = "streaming-" + service;
    b.addEventListener("click", () => open(service));
    document.body.appendChild(b);
  }
  W.RouenStreaming = { open };
})();
