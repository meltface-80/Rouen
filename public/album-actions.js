// @ts-check
/*
 * album-actions.js — the album view's action row, and its hearts (v1.9.27,
 * dev/design/native-remote.md §8).
 *
 *   THE ROW, moved here unchanged from app.js (dev/quality.md's order, item 6):
 *   Play Now and Queue on the row, Play Next / Shuffle / Radio and Listen later
 *   behind ⋯. app.js calls build() with what the album route answered.
 *
 *   THE HEART (the owner, 2026-10-14): Roon's own favourite, on the left of
 *   the row before Play Now — the pills are `flex: 1 1 0`, so they narrow to
 *   make room; the heart is the ⋯ button's size and finish. Shown only when
 *   your server can take a heart for this album (native mode on, the album
 *   found in its list): GET /api/hearts/album. Tapped, it fills at once and
 *   goes back, with a toast, if your server does not take it.
 *
 *   TRACKS: long-press to select, then "Add to favourites" or "Remove from
 *   favourites" in the selection menu (whether a track already is one is not
 *   known on this page, so both are offered). The menu's items are built here too (they were index.html's, which
 *   is at its length baseline). The heart item carries no data-sel-act: app.js
 *   sends every action it does not know to the play routes.
 *
 * Loaded before app.js, which looks the selection menu's items up.
 */
(function rouenAlbumActions() {
  "use strict";
  const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

  // ---- the selection menu's items ---------------------------------------------
  const selMenu = $("select-menu");
  if (selMenu) {
    selMenu.insertAdjacentHTML("beforeend", `
          <button class="sel-menu-item" type="button" role="menuitem" data-sel-act="play_now">Play now</button>
          <button class="sel-menu-item" type="button" role="menuitem" data-sel-act="play_next">Play next</button>
          <button class="sel-menu-item" type="button" role="menuitem" data-sel-act="queue">Add to end of queue</button>
          <button class="sel-menu-item" type="button" role="menuitem" data-sel-act="add">Add to playlist…</button>
          <button class="sel-menu-item" type="button" role="menuitem" data-sel-act="later">Listen later</button>
          <button class="sel-menu-item hidden" type="button" role="menuitem" data-heart-act="on">Add to favourites</button>
          <button class="sel-menu-item hidden" type="button" role="menuitem" data-heart-act="off">Remove from favourites</button>
          <button class="sel-menu-item" type="button" role="menuitem" data-sel-act="clear">Clear selection</button>`);
  }

  document.body.insertAdjacentHTML("beforeend", `
  <style>
    .heart-btn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; }
    .heart-btn.is-on svg { fill: var(--accent); stroke: var(--accent); }
    .heart-btn:disabled { opacity: .6; }
  </style>`);

  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linejoin="round" d="M12 20.3s-7.6-4.6-9.2-9.4C1.6 7.3 3.9 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4c3.4 0 5.7 3.3 4.5 6.9-1.6 4.8-9.2 9.4-9.2 9.4z"/></svg>';

  /** The album the view shows, as the album route named it, and whether its tracks can be hearted. */
  let current = /** @type {{ title: string, artist: string, titles: string[], tracks: boolean, row: HTMLElement } | null} */ (null);

  /** @param {string} url @param {any} body */
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* no JSON body: the status says enough */ }
    return { ok: r.ok, body: /** @type {any} */ (j) };
  }

  /**
   * The heart, at the row's start, when your server can take one for this album.
   * @param {HTMLElement} row @param {string} title @param {string} artist @param {(msg: string, kind?: string) => void} toast
   */
  async function addHeart(row, title, artist, toast) {
    const mine = current;
    let st;
    try {
      const r = await fetch(`/api/hearts/album?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, { cache: "no-store" });
      st = r.ok ? await r.json() : null;
    } catch (e) { st = null; }   // unreachable for a moment: no heart this time, as with native mode off
    // Another album opened meanwhile, or no heart to offer.
    if (current !== mine || !st || st.available !== true || !row.isConnected) return;
    if (mine) mine.tracks = st.tracks === true;
    let on = st.favorite === true;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "overflow-btn heart-btn";
    btn.innerHTML = HEART;
    const paint = () => {
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
    };
    paint();
    btn.addEventListener("click", async () => {
      const want = !on;
      on = want; paint();          // at once; put back if your server does not take it
      btn.disabled = true;
      try {
        const r = await post("/api/hearts/album", { title, artist, on: want });
        if (!r.ok) { on = !want; paint(); toast(r.body.error || "Your server didn't take that.", "error"); }
      } catch (e) {
        on = !want; paint(); toast("Rouen could not be reached; nothing was changed.", "error");
      } finally { btn.disabled = false; }
    });
    // A wrap like ⋯'s, so the row's stretch makes it the pills' height.
    const wrap = document.createElement("div");
    wrap.className = "overflow-wrap";
    wrap.appendChild(btn);
    row.insertBefore(wrap, row.firstChild);
  }

  // ---- the row --------------------------------------------------------------------
  /**
   * @param {{ row: HTMLElement, answer: any, album: any, invoke: (kind: string, btn: any) => void,
   *           setListenLater: (a: { title: string, artist: string }, on: boolean) => Promise<boolean | null>,
   *           toast: (msg: string, kind?: string) => void, buildOverflowMenu: Function }} o
   * @returns {number} how many playback actions the album has (0: app.js says why)
   */
  function build(o) {
    const j = o.answer, album = o.album, modalActs = o.row;
    // Build action buttons in preferred order
    const order  = ["play_now", "queue", "play_next", "shuffle", "radio"];
    /** @type {Record<string, string>} */
    const labels = {
      play_now:  "Play Now",
      queue:     "Queue",
      play_next: "Play Next",
      shuffle:   "Shuffle",
      radio:     "Radio"
    };
    const map = new Map();
    for (const a of (j.actions || [])) {
      if (!map.has(a.kind)) map.set(a.kind, a);
    }

    // Play Now and Queue stay on the row; Play Next / Shuffle / Radio go behind the
    // overflow menu. Five pills hit the same wall the playlist screens did —
    // .action-btn is `flex: 1 1 0`, so they shrink together instead of
    // wrapping, and on a phone the labels start clipping.
    const ROW_ACTIONS = 2;
    modalActs.innerHTML = "";
    const available = order.filter(k => map.has(k));
    let first = true;
    for (const k of available.slice(0, ROW_ACTIONS)) {
      const btn = document.createElement("button");
      btn.className = "action-btn" + (first ? " primary" : "");
      btn.type = "button";
      btn.textContent = labels[k];
      btn.addEventListener("click", () => o.invoke(k, btn));
      modalActs.appendChild(btn);
      first = false;
    }
    const overflow = available.slice(ROW_ACTIONS);
    const menuItems = overflow.map(k => ({ label: labels[k], onClick: (/** @type {any} */ b) => o.invoke(k, b) }));
    // Listen later (v1.8.67), under the same ⋯ as Next / Shuffle / Radio. Put
    // aside under ROON's strings for the album — the ones the server just
    // answered with — so the entry resolves straight back to this record.
    const laterTitle = (j.album && j.album.title) || album.title || "";
    const laterArtist = (j.album && j.album.subtitle) || album.subtitle || "";
    if (available.length && laterTitle) {
      let onList = !!j.listen_later;
      const laterLabel = () => (onList ? "Remove from Listen later" : "Listen later");
      menuItems.push({
        label: laterLabel(),
        onClick: async (/** @type {any} */ b) => {
          const got = await o.setListenLater({ title: laterTitle, artist: laterArtist }, !onList);
          if (got === null) return;   // not saved — already reported
          onList = got;
          b.textContent = laterLabel();
          o.toast(onList ? "Put aside in Listen later" : "Taken off Listen later", "ok");
        }
      });
    }
    if (menuItems.length) {
      modalActs.appendChild(o.buildOverflowMenu(menuItems, { label: "More actions" }));
    }
    // The heart, by the same strings as Listen later: the ones your server's album was matched by.
    current = { title: laterTitle, artist: laterArtist, titles: (j.tracks || []).map((/** @type {any} */ t) => String(t.title || "")), tracks: false, row: modalActs };
    if (available.length && laterTitle) addHeart(modalActs, laterTitle, laterArtist, o.toast);
    return available.length;
  }

  // ---- tracks: the selection menu ------------------------------------------------
  /** The album view's selected tracks, by their place in its list. */
  function picked() {
    const rows = [...document.querySelectorAll("#modal-tracks li.t-row")];
    return rows.map((li, i) => (li.querySelector('.t-mark[aria-pressed="true"]') ? i : -1)).filter((i) => i >= 0);
  }
  const modal = $("album-modal");
  const albumViewOpen = () => !!modal && !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
  // Shown only for tracks selected on an album whose tracks your server can heart.
  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (!selMenu || !t || !t.closest || !t.closest("#select-menu-btn")) return;
    const show = albumViewOpen() && !!current && current.tracks && picked().length > 0;
    for (const b of selMenu.querySelectorAll("[data-heart-act]")) b.classList.toggle("hidden", !show);
  }, true);
  if (selMenu) {
    selMenu.addEventListener("click", async (e) => {
      const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest("[data-heart-act]"));
      if (!item || !current) return;
      e.stopPropagation();
      const on = item.dataset.heartAct === "on";
      const picks = picked();
      const toast = (/** @type {string} */ msg, /** @type {string} */ kind) => {
        const host = /** @type {any} */ (window).RouenHost;
        if (host && host.toast) host.toast(msg, kind); else window.alert(msg);
      };
      // Closed, and the selection cleared, as every other action of the menu does.
      const clear = /** @type {HTMLElement | null} */ (selMenu.querySelector('[data-sel-act="clear"]'));
      if (clear) clear.click();
      try {
        const r = await post("/api/hearts/tracks", { title: current.title, artist: current.artist, titles: current.titles, picks, on });
        const n = picks.length;
        if (r.ok) toast((on ? "Added to" : "Removed from") + " your server's favourites: " + n + " track" + (n === 1 ? "" : "s"), "ok");
        else toast(r.body.error || "Your server didn't take that.", "error");
      } catch (e2) { toast("Rouen could not be reached; nothing was changed.", "error"); }
    });
  }

  /** @type {any} */ (window).RouenAlbumActions = { build };
})();
