// @ts-check
/*
 * playlist-tracks.js — a playlist's tracks as rows, and what helps find one in a long list (v2.0.3-t4,
 * dev/design/playlist-artists.md).
 *
 *   roonTrackRow — a Roon playlist's row: its cover (the playlist's own when the track has none), its title and its
 *     line beneath, and a tap that plays it. Moved out of public/app.js unchanged.
 *   enhance — a Sort above the rows (Playlist order · Artist · Title, the choice kept on this device), a find at its end
 *     (playlist-find.js, 2.0.4-t5), and, for a Roon
 *     playlist with native mode on, each row's line replaced by the track's own artist as your server names it (the
 *     official API's line is often the composers). Rows keep their tap: each plays its own track whatever the order.
 *
 * app.js loads it, as touchnav.js loads the Artists screen; it brings its own stylesheet.
 */
(() => {
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "playlist-tracks.css" }));
  // Find in this playlist (2.0.4-t5) and the A–Z slider (2.0.4-t6, a slider from t8): their own scripts.
  document.body.appendChild(Object.assign(document.createElement("script"), { src: "playlist-find.js" }));
  document.body.appendChild(Object.assign(document.createElement("script"), { src: "playlist-az.js" }));
  // The top of a playlist's page held while its rows scroll (2.0.4-t10): its own script, with its stylesheet.
  document.body.appendChild(Object.assign(document.createElement("script"), { src: "playlist-top.js" }));
  const KEY = "rouen.playlist-sort";
  const MODES = /** @type {const} */ ([["order", "Playlist order"], ["artist", "Artist"], ["title", "Title"]]);
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

  /**
   * @param {{ index: number, title?: string, subtitle?: string, image_key?: string | null }} t
   * @param {string | null | undefined} fallbackKey  the playlist's own cover
   * @param {(li: HTMLLIElement) => void} onPlay
   */
  function roonTrackRow(t, fallbackKey, onPlay) {
    const li = document.createElement("li");
    li.className = "track-row track-row-art";
    li.dataset.index = String(t.index);
    // Roon gives each playlist track its own image_key; fall back to the
    // playlist's own art so a row is never a bare gap.
    const art = document.createElement("span");
    art.className = "track-art";
    const key = t.image_key || fallbackKey;
    if (key) art.dataset.artKey = key;
    if (key) {
      const img = document.createElement("img");
      img.loading = "lazy"; img.alt = "";
      img.src = `/api/image/${encodeURIComponent(key)}?size=80`;
      img.onerror = () => { art.classList.add("no-image"); img.remove(); };
      art.appendChild(img);
    } else {
      art.classList.add("no-image");
    }
    li.appendChild(art);
    const text = document.createElement("div");
    text.className = "track-text";
    const tt = document.createElement("div");
    tt.className = "track-title";
    tt.textContent = t.title || "";
    text.appendChild(tt);
    if (t.subtitle) {
      const ts = document.createElement("div");
      ts.className = "track-artist";
      ts.textContent = t.subtitle;
      text.appendChild(ts);
    }
    li.appendChild(text);
    li.addEventListener("click", () => onPlay(li));
    return li;
  }

  /** The choice kept on this device; "order" when none is, or storage is unavailable. @returns {string} */
  function savedMode() {
    try { const m = localStorage.getItem(KEY); return MODES.some(([k]) => k === m) ? /** @type {string} */ (m) : "order"; }
    catch (e) { return "order"; }   // storage refused (a private window): the playlist's own order, as before
  }
  /** @param {string} m */
  function saveMode(m) {
    try { localStorage.setItem(KEY, m); } catch (e) { /* storage refused: the choice lasts until the page is left */ }
  }
  /** A row's artist as sorted: its own when known, else its line's first part ("Artist · Album"), without a lead "The ". */
  const artistOf = (/** @type {any} */ li) => {
    const own = li.dataset.artist;
    const line = li.querySelector(".track-artist");
    const a = own !== undefined ? own : (line ? String(line.textContent || "").split(" · ")[0] : "");
    return a.trim().replace(/^the\s+/i, "");
  };
  const titleOf = (/** @type {any} */ li) => { const t = li.querySelector(".track-title"); return t ? String(t.textContent || "").trim() : ""; };

  /**
   * The rows in the order asked: the playlist's own, or A→Z by artist (then title), or by title (then artist). A row
   * with no artist goes after those with one. Rows are moved, not rebuilt, so each keeps its cover and its tap.
   * @param {HTMLOListElement} ol @param {string} mode
   */
  function sortRows(ol, mode) {
    const rows = /** @type {any[]} */ (Array.from(ol.children));
    const by = (/** @type {any} */ a, /** @type {any} */ b) => a.__order - b.__order;
    const cmp = (/** @type {string} */ x, /** @type {string} */ y) => (!x === !y ? collator.compare(x, y) : x ? -1 : 1);
    if (mode === "artist") rows.sort((a, b) => cmp(artistOf(a), artistOf(b)) || cmp(titleOf(a), titleOf(b)) || by(a, b));
    else if (mode === "title") rows.sort((a, b) => cmp(titleOf(a), titleOf(b)) || cmp(artistOf(a), artistOf(b)) || by(a, b));
    else rows.sort(by);
    for (const li of rows) ol.appendChild(li);
    ol.dataset.sort = mode;
  }

  /**
   * Each row's line set to its own artist, where your server named one; the rows sorted again if by artist.
   * @param {HTMLOListElement} ol @param {Array<string | null>} artists  per row, in the playlist's order
   */
  function applyArtists(ol, artists) {
    for (const li of /** @type {any[]} */ (Array.from(ol.children))) {
      const a = artists[li.__order];
      if (!a) continue;
      let line = li.querySelector(".track-artist");
      if (!line) {
        line = document.createElement("div");
        line.className = "track-artist";
        const text = li.querySelector(".track-text");
        if (text) text.appendChild(line);
      }
      line.textContent = a;
      li.dataset.artist = a;
    }
    ol.dataset.artists = "roon";
    if (ol.dataset.sort && ol.dataset.sort !== "order") sortRows(ol, ol.dataset.sort);   // ties under Title break on artist too
  }

  /**
   * Ask Rouen for each row's own artist; anything but "ok" leaves the rows as they are.
   * @param {HTMLOListElement} ol @param {{ title: string, rows: Array<{ title?: string }>, live: () => boolean }} o
   */
  async function loadArtists(ol, o) {
    try {
      const r = await fetch("/api/playlist/track-artists", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: o.title, tracks: o.rows.map((t) => t.title || "") }) });
      if (!r.ok || !o.live()) return;
      const j = await r.json();
      if (j && j.status === "ok" && Array.isArray(j.artists) && o.live()) applyArtists(ol, j.artists);
    } catch (e) { /* offline, or the server restarting: each row keeps the line it has */ }
  }

  /**
   * The Sort above a playlist's rows, applied at once in the choice kept; and, for a Roon playlist (o.title and o.rows
   * given), each row's own artist asked for. The rows must be in the list already and the list in the page's tree.
   * @param {HTMLOListElement} ol
   * @param {{ title?: string, rows?: Array<{ title?: string }>, live?: () => boolean }} [o]
   */
  function enhance(ol, o = {}) {
    const rows = /** @type {any[]} */ (Array.from(ol.children));
    // Its place in the playlist, kept for the sorts and shown as the row's number whatever the order (playlist-tracks.css).
    rows.forEach((li, i) => { li.__order = i; li.dataset.pos = String(i + 1); });
    if (o.title && o.rows && o.rows.length) loadArtists(ol, { title: o.title, rows: o.rows, live: o.live || (() => ol.isConnected) });
    if (rows.length < 2 || !ol.parentNode) return;
    const bar = document.createElement("div");
    bar.className = "playlist-sort";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Sort the tracks");
    const label = document.createElement("span");
    label.className = "playlist-sort-label";
    label.textContent = "Sort";
    bar.appendChild(label);
    const mode = savedMode();
    for (const [k, text] of MODES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "playlist-sort-btn";
      b.dataset.sort = k;
      b.textContent = text;
      b.setAttribute("aria-pressed", k === mode ? "true" : "false");
      b.addEventListener("click", () => {
        for (const x of Array.from(bar.querySelectorAll(".playlist-sort-btn"))) x.setAttribute("aria-pressed", x === b ? "true" : "false");
        saveMode(k);
        sortRows(ol, k);
      });
      bar.appendChild(b);
    }
    ol.parentNode.insertBefore(bar, ol);
    sortRows(ol, mode);
    const find = /** @type {any} */ (window).RouenPlaylistFind;
    if (find) find.attach(ol, bar);
    const az = /** @type {any} */ (window).RouenPlaylistAZ;
    if (az) az.attach(ol);
  }

  /** @type {any} */ (window).RouenPlaylistTracks = { roonTrackRow, enhance, sortRows, applyArtists, artistOf, titleOf };
})();
