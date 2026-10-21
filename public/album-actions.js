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
 *   favourites" in the selection menu — both offered, as whether a track
 *   already is one is not known on this page (native-remote.md §8.1). The menu's items are built here too (they were index.html's, which
 *   is at its length baseline). The heart item carries no data-sel-act: app.js
 *   sends every action it does not know to the play routes.
 *
 *   ADD TO LIBRARY (v1.9.41, native-remote.md §9.2): the button on a TIDAL or Qobuz album page
 *   (streaming.js) and Smart Picks' and Listen Later's primary button on Home (moved out of app.js),
 *   as window.RouenLibraryAdd — below, in its own scope.
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
    .heart-wrap { position: relative; flex: 0 0 auto; display: flex; }
  </style>`);

  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linejoin="round" d="M12 20.3s-7.6-4.6-9.2-9.4C1.6 7.3 3.9 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4c3.4 0 5.7 3.3 4.5 6.9-1.6 4.8-9.2 9.4-9.2 9.4z"/></svg>';

  /** The album the view shows, as the album route named it, and whether its tracks can be hearted. */
  let current = /** @type {{ title: string, artist: string, titles: string[], tracks: boolean, row: HTMLElement } | null} */ (null);
  const modal = $("album-modal");
  const albumViewOpen = () => !!modal && !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");

  /** @param {string} url @param {any} body */
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* no JSON body: the status says enough */ }
    return { ok: r.ok, body: /** @type {any} */ (j) };
  }

  /** How often the open album view asks for its heart again. */
  const LIVE_MS = 2000;
  /** A heart being saved, by album: a row rebuilt meanwhile waits for it before asking again (the review). */
  let saving = /** @type {{ key: string, done: Promise<void> } | null} */ (null);

  /**
   * The heart, at the row's start, when your server can take one for this album.
   * @param {HTMLElement} row @param {string} title @param {string} artist @param {(msg: string, kind?: string) => void} toast
   * @param {Element} firstPill  the Play Now this build made: gone from the row, and the row is another album's
   */
  async function addHeart(row, title, artist, toast, firstPill) {
    const mine = current;
    const key = title + "\u0000" + artist;
    if (saving && saving.key === key) await saving.done;
    let st;
    try {
      const r = await fetch(`/api/hearts/album?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, { cache: "no-store" });
      st = r.ok ? await r.json() : null;
    } catch (e) { st = null; }   // unreachable for a moment: no heart this time, as with native mode off
    // Another album opened meanwhile (it empties this same row first, so its
    // Play Now is gone even before its own build), or no heart to offer.
    if (current !== mine || firstPill.parentNode !== row || !st || st.available !== true) return;
    if (mine) mine.tracks = st.tracks === true;
    let on = st.favorite === true;
    /** Taps so far: an answer asked for before one is from before it, and not painted. */
    let taps = 0;
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
      taps++;
      const want = !on;
      on = want; paint();          // at once; put back if your server does not take it
      btn.disabled = true;
      /** @type {() => void} */
      let finished = () => {};
      saving = { key, done: new Promise((r) => { finished = r; }) };
      try {
        const r = await post("/api/hearts/album", { title, artist, on: want });
        if (!r.ok) { on = !want; paint(); toast(r.body.error || "Your server didn't take that.", "error"); }
      } catch (e) {
        on = !want; paint(); toast("Rouen could not be reached; nothing was changed.", "error");
      } finally {
        btn.disabled = false;
        finished();
        if (saving && saving.key === key) saving = null;
      }
    });
    // Stretched to the row's height as ⋯'s wrap is — but not one of its class:
    // menus.js closes an open ⋯ on a tap outside .overflow-wrap, and a heart tap is one.
    const wrap = document.createElement("div");
    wrap.className = "heart-wrap";
    wrap.appendChild(btn);
    row.insertBefore(wrap, row.firstChild);

    // Asked again while this album's view is open and shown (v1.9.29, the owner: a heart changed in
    // the server's own app showed only once the view was opened again). Rouen holds the answer — kept
    // by what the server pushes and what Rouen reads — so each ask is a look-up there, nothing sent to it.
    // Ends once another album is opened or the row is rebuilt.
    const tick = async () => {
      if (current !== mine || !btn.isConnected) return;
      if (!document.hidden && albumViewOpen() && !btn.disabled) {
        const asked = taps;
        let now = null;
        try {
          const r = await fetch(`/api/hearts/album?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, { cache: "no-store" });
          now = r.ok ? await r.json() : null;
        } catch (e) { now = null; }   // unreachable for a moment: the heart stays as shown, and is asked about again
        if (current === mine && asked === taps && !btn.disabled && now && now.available === true && (now.favorite === true) !== on) {
          on = now.favorite === true;
          paint();
        }
      }
      setTimeout(tick, LIVE_MS);
    };
    setTimeout(tick, LIVE_MS);
  }

  // ---- the row --------------------------------------------------------------------
  /**
   * @param {{ row: HTMLElement, answer: any, album: any, invoke: (kind: string, btn: any) => void,
   *           setListenLater: (a: { title: string, artist: string }, on: boolean) => Promise<boolean | null>,
   *           toast: (msg: string, kind?: string) => void, buildOverflowMenu: Function, listenLater?: boolean, heart?: boolean }} o
   *   listenLater, heart: false leaves them out — a TIDAL or Qobuz album browsed through Roon (streaming.js, v1.9.39) is put
   *   aside on Roon's own Listen Later and hearted through Roon once those are built (native-remote.md §10.3), not Rouen's
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
    if (available.length && laterTitle && o.listenLater !== false) {
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
    const firstPill = modalActs.querySelector(".action-btn");
    if (available.length && laterTitle && firstPill && o.heart !== false) addHeart(modalActs, laterTitle, laterArtist, o.toast, firstPill);
    return available.length;
  }

  // ---- tracks: the selection menu ------------------------------------------------
  /** The album view's selected tracks, by their place in its list. */
  function picked() {
    const rows = [...document.querySelectorAll("#modal-tracks li.t-row")];
    return rows.map((li, i) => (li.querySelector('.t-mark[aria-pressed="true"]') ? i : -1)).filter((i) => i >= 0);
  }
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

/*
 * Add to library — "Add to library" (dev/design/native-remote.md §9.2, v1.9.41): the button on a
 * TIDAL or Qobuz album page (streaming.js), and Smart Picks' and Listen Later's primary button on
 * Home (moved out of app.js, where it favourited the album on the service, unchanged in its looks).
 *
 * One call, POST /api/library/add: with native mode on, your server adds the album itself, and the
 * button waits until the album is in the library ("Added — waiting for your server"); otherwise, or
 * when native mode couldn't send it (the toast says why), the album is made a favourite on the
 * service with Rouen's own sign-in, and Roon imports it when it syncs ("waiting for Roon"). While it
 * waits the button asks GET /api/library/add every 3 s; in the library, it becomes the way to open
 * the album. A native add not in the library after three minutes says so, and can be sent again.
 */
(function () {
  /** @type {any} */
  const W = window;
  /** @type {Record<string, string>} */
  const NAMES = { tidal: "TIDAL", qobuz: "Qobuz" };
  const POLL_MS = 3000;
  // The server says "not taken" at three minutes; a little longer here, so its answer is the one shown.
  const FOLLOW_MS = 3 * 60 * 1000 + 10 * 1000;

  /** @param {string} msg @param {string} [kind] */
  const toast = (msg, kind) => { if (W.RouenHost) W.RouenHost.toast(msg, kind); };

  /** @param {any} body @returns {Promise<any>} */
  async function send(body) {
    const r = await fetch("/api/library/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: "Rouen answered with something other than the add (" + r.status + ")." }));
    return r.ok ? j : Object.assign({ error: "Couldn't add that album" }, j, { ok: false });
  }

  /**
   * Follows an add until the album is in the library, or the server says it wasn't taken, or the wait is over.
   * @param {string} title @param {string} artist @param {() => boolean} alive
   * @param {(offset: number, title: string, artist: string) => void} inLibrary  where, under Roon's own strings
   * @param {() => void} notTaken
   */
  function follow(title, artist, alive, inLibrary, notTaken) {
    const began = Date.now();
    const tick = async () => {
      if (!alive()) return;
      /** @type {any} */
      let st = null;
      try {
        const r = await fetch("/api/library/add?" + new URLSearchParams({ title, artist }).toString(), { cache: "no-store" });
        st = r.ok ? await r.json() : null;
      } catch (e) {
        st = null;   // unreachable for a moment: asked again at the next tick
      }
      if (!alive()) return;
      if (st && st.state === "in-library" && typeof st.offset === "number") { inLibrary(st.offset, st.library_title || title, st.library_subtitle || artist); return; }
      if (st && st.state === "not-taken") { notTaken(); return; }
      // A service favourite: Roon imports it when it syncs, which may be long after; the button keeps saying so.
      if (Date.now() - began > FOLLOW_MS) return;
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  }

  /**
   * The add, from a button: "…" while it is sent (disabled, so a second tap sends nothing), then what came of it.
   * @param {HTMLButtonElement} btn
   * @param {{ title: string, artist: string, service: string, album_id?: string | null }} w
   * @param {{ waiting: (via: string, other: string | null) => string, retry: string, inLibrary: (offset: number, title: string, artist: string) => void }} o
   *   waiting: the button's words while it waits; `other`, the other service's name when its copy was added
   */
  async function add(btn, w, o) {
    const before = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const r = await send({ title: w.title, artist: w.artist, service: w.service, album_id: w.album_id || null });
      if (!r.ok) { btn.textContent = before; btn.disabled = false; toast(r.error, "error"); return; }
      if (r.state === "in-library" && typeof r.offset === "number") { o.inLibrary(r.offset, r.library_title || w.title, r.library_subtitle || w.artist); return; }
      if (r.state === "in-library") {
        // Your server's search has it in your library, and Rouen's copy can't yet say where: nothing was added.
        btn.textContent = "Already in your library";
        btn.classList.add("is-done");
        toast("Your server already has this album in your library", "ok");
        return;
      }
      const name = NAMES[w.service] || w.service;
      // The other service's copy, when Roon's search had none on this one (the owner, 2026-10-21): said which.
      const other = r.via === "roon" && r.from && r.from !== w.service ? NAMES[r.from] || r.from : null;
      btn.textContent = o.waiting(r.via, other);
      btn.classList.add("is-done");
      btn.dataset.added = "1";
      if (other) toast(`Added from ${other}: your server's search had no ${name} copy. It's going into your library`, "ok");
      else if (r.via === "roon") toast("Added — your server is putting it in your library", "ok");
      else toast(r.why ? `Added to your ${name} favourites instead: ${r.why}` : `Added to ${name} — Roon will import it on its next sync`, "ok");
      follow(w.title, w.artist, () => btn.isConnected, o.inLibrary, () => {
        btn.textContent = o.retry;
        btn.classList.remove("is-done");
        btn.disabled = false;
        delete btn.dataset.added;
      });
    } catch (e) {
      btn.textContent = before;
      btn.disabled = false;
      toast("Failed: " + (e && /** @type {any} */ (e).message), "error");
    }
  }

  /** @param {any} album  as app.js's openAlbum takes it */
  const open = (album) => { if (W.__openAlbum) W.__openAlbum(album, { filter: null }); };

  /**
   * A Smart Pick's or Listen Later entry's primary button — "a record that may or may not be in Roon yet" —
   * Play, waiting, or Add (app.js's pickPrimaryButton until v1.9.41). Play opens it under ROON's own strings
   * (library_title / library_subtitle): the play routes check identity against the snapshot, and an edition
   * suffix that differs would be refused as a stale offset. Null when there is nothing to offer.
   * @param {any} item @param {string} title @param {string} artist @param {string} addLabel
   * @returns {HTMLButtonElement | null}
   */
  function pickButton(item, title, artist, addLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    /** PLAY — Roon has it, so every ordinary play route works. @param {number} offset @param {string} t @param {string} a */
    const play = (offset, t, a) => {
      btn.className = "pick-add pick-play";
      btn.disabled = false;
      btn.textContent = "▶ Play";
      btn.onclick = () => open({ offset, title: t, subtitle: a, image_key: item.image_key || null });
    };
    if (item.offset !== null && item.offset !== undefined) {
      play(item.offset, item.library_title || title || "", item.library_subtitle || artist || "");
    } else if (item.added) {
      // WAITING — a service favourite, not imported yet. Roon decides when.
      btn.className = "pick-add is-done";
      btn.disabled = true;
      btn.textContent = "✓ Added — waiting for Roon";
    } else if (item.service && NAMES[item.service]) {
      // ADD — to the library: your server's own add, or the service favourite (lib/library-add.js).
      btn.className = "pick-add";
      btn.textContent = addLabel;
      btn.onclick = () => add(btn, { title, artist, service: item.service, album_id: item.album_id || null }, {
        waiting: (via) => (via === "roon" ? "✓ Added — waiting for your server" : "✓ Added — waiting for Roon"),
        retry: "Not in your library yet — tap to try again",
        inLibrary: (offset, t, a) => play(offset, t, a),
      });
    } else {
      return null;
    }
    return btn;
  }

  /**
   * The TIDAL or Qobuz album page's button, for an album not in the library: once it is, `inLibrary` is
   * told where (the page then offers to open it).
   * @param {{ title: string, artist: string, service: string, inLibrary: (offset: number, title: string, artist: string) => void }} o
   * @returns {HTMLButtonElement}
   */
  function pageButton(o) {
    const btn = /** @type {HTMLButtonElement} */ (document.createElement("button"));
    btn.type = "button";
    btn.className = "action-btn library-add";
    btn.textContent = "＋ Add to library";
    btn.addEventListener("click", () => add(btn, { title: o.title, artist: o.artist, service: o.service }, {
      waiting: (via, other) => (via === "roon" ? (other ? `Added from ${other} — waiting for your server` : "Added — waiting for your server")
        : `Added to ${NAMES[o.service] || o.service} favourites — waiting for Roon`),
      retry: "Not in your library yet — your server may not have taken it. Try again",
      inLibrary: o.inLibrary,
    }));
    return btn;
  }

  W.RouenLibraryAdd = { pickButton, pageButton };
})();
