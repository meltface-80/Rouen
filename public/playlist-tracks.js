// @ts-check
/*
 * playlist-tracks.js — a Roon playlist's tracks as rows. Moved out of public/app.js in v2.0.3-t4, unchanged
 * (dev/quality.md, "Splitting the monoliths"): the row openPlaylist built for each track, its cover (the playlist's own
 * when the track has none), its title and its line beneath, and a tap that plays it. app.js loads it, as touchnav.js
 * loads the Artists screen, and openPlaylist calls window.RouenPlaylistTracks.roonTrackRow.
 */
(() => {
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

  /** @type {any} */ (window).RouenPlaylistTracks = { roonTrackRow };
})();
