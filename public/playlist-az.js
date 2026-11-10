// @ts-check
/*
 * playlist-az.js — the A–Z strip on a long playlist (2.0.4-t6, dev/design/playlist-artists.md §8). gert_mogensen, the
 * Roon forum, 2026-11-10: "I have a playlist with 1500 songs, it would be nice if i could jump to the letter S instead
 * of scrolling through the playlist". Asked, the owner chose: shown only when the playlist is sorted by Title or Artist
 * (in Playlist order a letter means nothing).
 *
 * A strip of letters down the right edge, A to Z and # (a digit or anything else first); a letter no row starts with is
 * dimmed. A tap, or a finger drawn down it, brings the first row of that letter (or the next letter that has one) to
 * the top. The letter is the sort's own key (playlist-tracks.js titleOf / artistOf, a lead "The " off), accents off.
 * Rows a find has hidden (playlist-find.js) are passed over.
 *
 * Loaded by playlist-tracks.js, which calls attach() when it adds the Sort; its look is in playlist-tracks.css.
 */
(() => {
  "use strict";
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
  /** The letter a key files under: its first letter, accents off; "#" for a digit or anything else. @param {string} key */
  const letterOf = (key) => {
    const c = String(key || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().charAt(0).toUpperCase();
    return c >= "A" && c <= "Z" ? c : "#";
  };

  /** @param {HTMLElement} ol */
  function attach(ol) {
    const T = /** @type {any} */ (window).RouenPlaylistTracks;
    if (!T || !ol.parentNode || /** @type {any} */ (ol).__az) return;
    const strip = document.createElement("nav");
    strip.className = "playlist-az hidden";
    strip.setAttribute("aria-label", "Jump to a letter");
    for (const l of LETTERS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "playlist-az-letter";
      b.dataset.letter = l;
      b.textContent = l;
      b.setAttribute("aria-label", l === "#" ? "Jump to numbers and others" : "Jump to " + l);
      strip.appendChild(b);
    }
    ol.parentNode.appendChild(strip);   // fixed, down the right edge: where in the page it sits moves nothing
    /** @type {any} */ (ol).__az = strip;

    const mode = () => ol.dataset.sort || "order";
    const keyOf = (/** @type {any} */ li) => (mode() === "artist" ? T.artistOf(li) : T.titleOf(li));
    /** The rows a find leaves, each with its letter. */
    const rows = () => /** @type {any[]} */ (Array.from(ol.children)).filter((li) => !li.classList.contains("pf-hidden"))
      .map((li) => ({ li, letter: letterOf(keyOf(li)) }));
    /** The row a letter jumps to: the first of it, else of the next letter that has one; null when none. @param {string} l */
    function rowFor(l) {
      const all = rows();
      const at = LETTERS.indexOf(l);
      for (let i = at; i < LETTERS.length; i++) { const hit = all.find((r) => r.letter === LETTERS[i]); if (hit) return hit.li; }
      return null;
    }
    function paint() {
      const on = mode() === "title" || mode() === "artist";
      strip.classList.toggle("hidden", !on);
      if (!on) return;
      const have = new Set(rows().map((r) => r.letter));
      for (const b of /** @type {HTMLElement[]} */ (Array.from(strip.children))) b.classList.toggle("is-empty", !have.has(String(b.dataset.letter)));
    }
    /** @param {string} l */
    function jump(l) {
      const li = rowFor(l);
      if (li) li.scrollIntoView({ block: "start" });
    }
    // A tap on a letter, or a finger drawn down the strip: the letter under it.
    let down = false;
    const at = (/** @type {PointerEvent} */ e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const b = el instanceof HTMLElement ? el.closest(".playlist-az-letter") : null;
      if (b instanceof HTMLElement && strip.contains(b)) jump(String(b.dataset.letter));
    };
    strip.addEventListener("pointerdown", (e) => { down = true; try { strip.setPointerCapture(e.pointerId); } catch (x) { /* a pointer the strip may not hold: the tap alone */ } at(e); e.preventDefault(); });
    strip.addEventListener("pointermove", (e) => { if (down) at(e); });
    const up = () => { down = false; };
    strip.addEventListener("pointerup", up);
    strip.addEventListener("pointercancel", up);
    // A keyboard's Enter or Space on a letter (a click with no pointer before it).
    strip.addEventListener("click", (e) => {
      if (/** @type {MouseEvent} */ (e).detail !== 0) return;
      const b = e.target instanceof HTMLElement ? e.target.closest(".playlist-az-letter") : null;
      if (b instanceof HTMLElement) jump(String(b.dataset.letter));
    });
    // The Sort changed, the rows came in or moved, a find typed, the artists named: the strip again.
    new MutationObserver(paint).observe(ol, { attributes: true, attributeFilter: ["data-sort", "class"], subtree: true, childList: true, characterData: true });
    paint();
  }

  /** @type {any} */ (window).RouenPlaylistAZ = { attach, letterOf };
  // A playlist opened before this script came in: its rows are there already, without a strip.
  // Rows the Sort has numbered (data-pos) are a playlist's it has enhanced.
  for (const ol of Array.from(document.querySelectorAll("ol.playlist-tracks"))) {
    const first = ol.firstElementChild;
    if (first instanceof HTMLElement && first.dataset.pos) attach(/** @type {HTMLElement} */ (ol));
  }
})();
