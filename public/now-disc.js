// @ts-check
/*
 * now-disc.js — a small disc on the album view's playing track (v1.9.72-t16; the owner, 2026-10-29: "When on an album
 * view page and I press play now I want the same spinning disc indicator that Mandarin has to indicate which track is
 * playing on the album"). Mandarin's nowdisc.js (meltface-80/Mandarin: public/nowdisc.js, its v1.0.1), drawn and
 * placed as there: between the track's number and its name, centred in the space between them, on the name's line.
 * It turns while the zone plays and stops where it is when it pauses; with reduced motion it stands still. The titles
 * don't move for it.
 *
 * How the playing track is found is Rouen's own: Roon's public API gives a zone's track no id, so it is found by what
 * the mini player shows, the selected zone's — its title (#mt-title, Roon's line1) and "artist · album" (#mt-artist,
 * line2 · line3). The album must be the one on the page (window.__currentAlbum), its title the line's last part; the
 * track is the first row whose title is the same, folded as track-times.js folds titles (case, spacing, accents,
 * quotes and dashes however written). Looked at again whenever the album's rows are drawn and whenever the mini player
 * changes (its title, its line, or its play button's Play or Pause).
 *
 * Loaded by album-view.js (index.html is at its length baseline), so it waits for the page if it comes first.
 */
(function nowDisc() {
  "use strict";
  const W = /** @type {any} */ (window);
  const DISC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".16"/><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  /** A title as the album's rows and Roon's line give it (track-times.js's folding, or its rule when not loaded). @param {string} s */
  const fold = (s) => (W.RouenTrackTimes && W.RouenTrackTimes.norm ? W.RouenTrackTimes.norm(s)
    : String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim());

  function start() {
    const rows = document.getElementById("modal-tracks");
    const bar = document.getElementById("mini-transport");
    if (!rows || !bar) return;
    /** @type {CanvasRenderingContext2D | null} */
    let pen = null;

    /**
     * How wide the row's number is drawn (its ::before), to centre the disc between the number's end and the name's start.
     * @param {Element} li @param {number} n @returns {number}
     */
    function numberWidth(li, n) {
      const cs = getComputedStyle(li, "::before");
      if (!pen) pen = document.createElement("canvas").getContext("2d");
      if (!pen) return 7 * String(n).length;
      pen.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return pen.measureText(String(n)).width;
    }

    /**
     * The row's gap, which the disc's slot takes back so the name doesn't move; and where the disc goes from the number's
     * box (where the slot starts): the middle of the room between the number's last figure and the name.
     * @param {HTMLElement} li @param {number} n @returns {{ gap: number, x: number }}
     */
    function placeFor(li, n) {
      const box = parseFloat(getComputedStyle(li, "::before").width) || 22;
      const gap = parseFloat(getComputedStyle(li).columnGap) || 0;
      return { gap, x: (numberWidth(li, n) - box + gap) / 2 };
    }

    /** The playing track's folded title when the selected zone plays from the album on the page, else "". */
    function playingHere() {
      const album = W.__currentAlbum;
      const title = (document.getElementById("mt-title") || {}).textContent || "";
      const line = (document.getElementById("mt-artist") || {}).textContent || "";
      if (!album || !album.title || !title || title === "—") return "";
      const name = fold(album.title), sub = fold(line);
      return sub === name || sub.endsWith(" · " + name) ? fold(title) : "";
    }

    function sync() {
      const want = playingHere();
      const pp = document.getElementById("mt-playpause");
      const paused = !pp || pp.getAttribute("aria-label") !== "Pause";
      const list = /** @type {HTMLElement[]} */ ([...rows.querySelectorAll("li.t-row")]);
      let found = false;
      list.forEach((li, i) => {
        const t = li.querySelector(".t-title");
        const on = !found && want !== "" && !!t && fold(t.textContent || "") === want;
        let disc = /** @type {HTMLElement | null} */ (li.querySelector(":scope > .now-disc"));
        if (!on) { if (disc) disc.remove(); li.classList.remove("is-now-track"); return; }
        found = true;
        if (!disc) {
          disc = document.createElement("span");
          disc.className = "now-disc";
          disc.innerHTML = DISC;
          li.insertBefore(disc, li.firstChild);
        }
        li.classList.add("is-now-track");
        disc.classList.toggle("is-paused", paused);
        const at = placeFor(li, i + 1);
        disc.style.marginLeft = -at.gap + "px";
        disc.style.setProperty("--nd-x", at.x.toFixed(1) + "px");
      });
    }

    // Gathered into one look after the changes in hand (a timer, not a frame: a frame waits while the page isn't drawn).
    let queued = false;
    const soon = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; sync(); }, 0); };
    new MutationObserver(soon).observe(rows, { childList: true });
    new MutationObserver(soon).observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
    sync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
