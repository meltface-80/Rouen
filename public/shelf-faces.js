// @ts-check
/*
 * shelf-faces.js — what a case on the Shelf shows (v1.9.68): its front — the cover, and on a stage taller than the
 * cover is wide (a phone held upright, the owner: "what best suits a smartphone"), the album's names under it, the
 * case being a tall card there (shelf.css .tall) — and its spine. Moved out of shelf.js with the card.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h):
 *
 *   const faces = ShelfFaces.create(h);
 *   faces.coverImg(a)              the cover picture, for a front drawn without it while the shelf flew past
 *   faces.frontHTML(a, withImg)    the front: the cover (its picture, or its names on a plain sleeve), then the card's names
 *   faces.spineHTML(a, tab, up)    the spine, with the divider card standing on it where a new letter, label or decade begins
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { esc, imageUrl } = h;
    /** @param {any} a */
    const coverImg = (a) => `<img src="${imageUrl(a.k, 500)}" alt="" decoding="async" draggable="false" data-k="${esc(a.k)}">`;

    // The names as a spine and a card read them (v1.9.68-t2, the owner): from the top the artist, the album and its
    // version ("Deluxe Edition", taken off the title by lib/album-version.js); from the foot up the catalogue number,
    // the year and the format.
    const parts = (/** @type {any} */ a) => ({ title: a.v ? a.v[0] : a.t, version: a.v ? a.v[1] : "" });

    /** @param {any} a @param {boolean} withImg */
    function frontHTML(a, withImg) {
      const blank = `<div class="blank"><b>${esc(a.t)}</b><span>${esc(a.a)}</span></div>`;
      // the card's names: shown only when the case is a tall card (shelf.css), in the spine's order — the artist, the
      // album and its version at the top; the format, the year and the catalogue number up from the foot
      const { title, version } = parts(a);
      const foot = [a.fm, a.y, a.c].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("");
      const card = `<div class="card"><span class="card-a">${esc(a.a)}</span><b class="card-t">${esc(title)}</b>`
        + `${version ? `<span class="card-v">${esc(version)}</span>` : ""}${foot ? `<span class="card-f">${foot}</span>` : ""}</div>`;
      return `<div class="cv">${a.k && withImg ? blank + coverImg(a) : blank}</div>${card}`;
    }

    // One line along a spine (v1.9.68-t2): reading down, the artist, the album and its version; at the foot, read up
    // from it, the catalogue number (t6), the year and the format — so, reading down, the format, the year, the
    // number. A long name gives way (cut with an ellipsis), never the foot. A tab wider than a letter is a divider
    // card, raised when the spine before it has one.
    /** @param {any} a @param {string|undefined} tab @param {boolean} up */
    function spineHTML(a, tab, up) {
      const { title, version } = parts(a);
      return `<div class="sp">${tab ? `<span class="sp-tab${tab.length > 1 ? " w" : ""}${up ? " up" : ""}">${esc(tab)}</span>` : ""}<span class="sp-txt">`
        + `<span class="sp-ar">${esc(a.a)}</span><span class="sp-ti">${esc(title)}</span>${version ? `<span class="sp-vr">${esc(version)}</span>` : ""}`
        + `<span class="sp-foot">${a.fm ? `<span class="sp-fm">${esc(a.fm)}</span>` : ""}${a.y ? `<span class="sp-yr">${esc(a.y)}</span>` : ""}`
        + `${a.c ? `<span class="sp-cat">${esc(a.c)}</span>` : ""}</span></span></div>`;
    }

    return { coverImg, frontHTML, spineHTML };
  }

  window.ShelfFaces = { create };
})();
