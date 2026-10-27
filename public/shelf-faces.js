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

    /** @param {any} a @param {boolean} withImg */
    function frontHTML(a, withImg) {
      const blank = `<div class="blank"><b>${esc(a.t)}</b><span>${esc(a.a)}</span></div>`;
      // the card's names: shown only when the case is a tall card (shelf.css), as the album view says them
      const meta = [a.y, a.fm].filter(Boolean).join(" · "), line = h.pick ? h.pick.lineOf(a) : "";
      const card = `<div class="card"><b class="card-t">${esc(a.t)}</b><span class="card-a">${esc(a.a)}</span>`
        + `${meta ? `<span class="card-m">${esc(meta)}</span>` : ""}${line ? `<span class="card-l">${esc(line)}</span>` : ""}</div>`;
      return `<div class="cv">${a.k && withImg ? blank + coverImg(a) : blank}</div>${card}`;
    }

    // Two lines along a spine — the artist and the title; and the year and the format, with the catalogue number at
    // the foot (v1.9.67-t6). A tab wider than a letter is a divider card, raised when the spine before it has one.
    /** @param {any} a @param {string|undefined} tab @param {boolean} up */
    function spineHTML(a, tab, up) {
      const meta = [a.y, a.fm].filter(Boolean).map((x) => esc(x)).join(" · ");
      return `<div class="sp">${tab ? `<span class="sp-tab${tab.length > 1 ? " w" : ""}${up ? " up" : ""}">${esc(tab)}</span>` : ""}<span class="sp-txt">`
        + `<span class="sp-l1"><span class="sp-ar">${esc(a.a)}</span><span class="sp-ti">${esc(a.t)}</span></span>`
        + `<span class="sp-l2"><span class="sp-meta">${meta}</span>${a.c ? `<span class="sp-cat">${esc(a.c)}</span>` : ""}</span></span></div>`;
    }

    return { coverImg, frontHTML, spineHTML };
  }

  window.ShelfFaces = { create };
})();
