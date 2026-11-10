// @ts-check
/*
 * playlist-find.js — find a track in a long playlist (2.0.4-t5, dev/design/playlist-artists.md §8). The owner,
 * 2026-11-10: "When on the playlist screen showing the tracks in the playlist the search function from the bottom bar
 * when pressed will only then search within that playlist" (gert_mogensen, the Roon forum: a playlist of 1,515).
 *
 * A glass at the end of a playlist's Sort row opens a field over the rows: what is typed keeps the rows whose title or
 * artist has it (letters and digits, accents and case ignored), and says how many of how many. A tap on a row plays it,
 * as always. Play now and Queue still play the whole playlist in the Sort's order (the owner's choice, 2026-11-10:
 * "Whole playlist"): the rows left out are hidden, not gone. On a phone or tablet the bar's Search, pressed on a
 * playlist's page, opens this field (touchnav.js asks RouenPlaylistFind.here()). × or Escape clears and closes it.
 *
 * Loaded by playlist-tracks.js, which calls attach() when it adds the Sort; its look is in playlist-tracks.css.
 */
(() => {
  "use strict";
  /** A text as compared: lower case, accents off, letters and digits only. @param {string} s */
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const count = (/** @type {number} */ n) => n.toLocaleString();

  /** @type {Array<{ ol: HTMLElement, open: () => void }>} */
  const pages = [];

  /**
   * @param {HTMLElement} ol  the playlist's rows (ol.playlist-tracks)
   * @param {HTMLElement} bar  its Sort row, which the glass ends
   */
  function attach(ol, bar) {
    if (bar.querySelector(".playlist-find-btn")) return;
    const glass = document.createElement("button");
    glass.type = "button";
    glass.className = "playlist-find-btn";
    glass.setAttribute("aria-label", "Find in this playlist");
    glass.title = "Find in this playlist";
    glass.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    bar.appendChild(glass);

    const box = document.createElement("div");
    box.className = "playlist-find hidden";
    box.setAttribute("role", "search");
    const input = document.createElement("input");
    input.type = "search";
    input.className = "playlist-find-input";
    input.placeholder = "Find in this playlist";
    input.setAttribute("aria-label", "Find in this playlist");
    input.autocomplete = "off";
    input.spellcheck = false;
    const said = document.createElement("span");
    said.className = "playlist-find-count";
    said.setAttribute("aria-live", "polite");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "playlist-find-close";
    close.setAttribute("aria-label", "Close the find");
    close.textContent = "×";
    box.append(input, said, close);
    bar.insertAdjacentElement("afterend", box);

    /** Each row's words, read once: its title and its line (the artist, once native mode has named it). */
    const words = (/** @type {any} */ li) => norm((li.querySelector(".track-title") || {}).textContent + " " + (li.querySelector(".track-artist") || {}).textContent);
    function filter() {
      const q = norm(input.value);
      const rows = /** @type {HTMLElement[]} */ (Array.from(ol.children));
      let shown = 0;
      for (const li of rows) {
        const hit = !q || q.split(" ").every((w) => words(li).includes(w));
        li.classList.toggle("pf-hidden", !hit);
        if (hit) shown++;
      }
      said.textContent = q ? `${count(shown)} of ${count(rows.length)}` : "";
      ol.classList.toggle("pf-none", !!q && shown === 0);
    }
    function open() {
      box.classList.remove("hidden");
      glass.setAttribute("aria-expanded", "true");
      input.focus();
    }
    function shut() {
      input.value = "";
      filter();
      box.classList.add("hidden");
      glass.setAttribute("aria-expanded", "false");
      glass.focus({ preventScroll: true });
    }
    glass.setAttribute("aria-expanded", "false");
    glass.addEventListener("click", () => (box.classList.contains("hidden") ? open() : input.focus()));
    input.addEventListener("input", filter);
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); shut(); } });
    close.addEventListener("click", shut);
    // The artists come in after the rows (native mode's read): a find already typed is applied to them again.
    new MutationObserver(() => { if (input.value) filter(); }).observe(ol, { subtree: true, characterData: true, childList: true });
    for (let i = pages.length - 1; i >= 0; i--) if (!pages[i].ol.isConnected) pages.splice(i, 1);
    pages.push({ ol, open });
  }

  /** The playlist page on screen now, if one is: its find's open(). @returns {{ open: () => void } | null} */
  function here() {
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i];
      if (p.ol.isConnected && p.ol.getClientRects().length) return p;
    }
    return null;
  }

  /** @type {any} */ (window).RouenPlaylistFind = { attach, here, norm };
  // A playlist opened before this script came in: its Sort row is there already, without a find.
  for (const bar of Array.from(document.querySelectorAll(".playlist-sort"))) {
    const next = bar.nextElementSibling;
    if (next && next.matches("ol.playlist-tracks")) attach(/** @type {HTMLElement} */ (next), /** @type {HTMLElement} */ (bar));
  }
})();
