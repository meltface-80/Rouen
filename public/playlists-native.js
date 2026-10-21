// @ts-check
/*
 * playlists-native.js — playlists made in Rouen, in Roon itself (dev/design/native-remote.md §11, v1.9.42).
 *
 *   ADD TO PLAYLIST (moved out of app.js): with native mode on and Roon's playlists changeable here
 *   (GET /api/roon-playlists), "＋ New playlist…" makes one in Roon and the rows are Roon's own;
 *   POST /api/roon-playlists/add. An add Roon didn't take, or didn't show, falls back to Rouen's own
 *   playlist of that name (the owner, 2026-10-21), the toast saying why. Otherwise: the sheet as
 *   before, Rouen's own playlists.
 *   A ROON PLAYLIST'S PAGE: its ⋯ gains Rename and Delete, when native mode can change it.
 *   THE PLAYLISTS SCREEN: Rouen's own say "In Rouen only" while native mode can make Roon's.
 *
 * app.js lends what it owns as window.RouenPlaylistHost (its sheet, its own add, its selection), and
 * calls in here: RouenPlaylists.openAddSheet, .decorate, .markRouenOnly.
 */
(function () {
  /** @type {any} */
  const W = window;

  // The side menu's Dynamic Playlists and Playlists entries (moved out of index.html in v1.9.42, unchanged):
  // inserted where they stood, after Discover, before app.js runs, which wires the menu by data-action.
  const discover = document.getElementById("menu-item-discover");
  if (discover) discover.insertAdjacentHTML("afterend", `
        <button class="menu-item" type="button" data-action="smart-playlists">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.1 4.6 5 .6-3.7 3.4 1 4.9L12 14.1 7.6 16.5l1-4.9L4.9 8.2l5-.6z"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
          <span>Dynamic Playlists</span>
        </button>
        <button class="menu-item" type="button" data-action="playlists">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="14" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="10" y2="18"/><circle cx="17.5" cy="16.5" r="2.5"/><path d="M20 16.5V8l-3 1"/></svg>
          <span>Playlists</span>
        </button>`);
  /** @param {string} msg @param {string} [kind] */
  const toast = (msg, kind) => { if (W.RouenHost) W.RouenHost.toast(msg, kind); };
  const host = () => W.RouenPlaylistHost;
  /** @param {number} n @param {string} one */
  const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

  /**
   * Roon's playlists that can be changed here, or null (with why, when native mode is on). Asked once for 15 s:
   * the sheet, the Playlists screen and a playlist's page each want it, and each asking waits its turn with the
   * library's reads on your server (the review); forgotten after any change made here.
   */
  let cached = { at: 0, /** @type {Promise<any> | null} */ p: null };
  function roonPlaylists() {
    if (cached.p && Date.now() - cached.at < 15000) return cached.p;
    cached = { at: Date.now(), p: (async () => {
      try {
        const r = await fetch("/api/roon-playlists", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        return r.ok && j ? j : null;
      } catch (e) {
        return null;   // unreachable: today's sheet, which says so itself if it is unreachable too
      }
    })() };
    return cached.p;
  }
  const forget = () => { cached = { at: 0, p: null }; };

  /** @param {string} url @param {any} body */
  async function post(url, body) {
    forget();
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : Object.assign({ ok: false, error: "Rouen answered " + r.status }, j);
  }

  /**
   * To Roon's playlist (by id, or a new one by name); today's way when Roon didn't take it.
   * @param {{ id?: string, name: string }} target @param {any[] | null} entries @param {any[] | null} albums
   */
  async function addToRoon(target, entries, albums) {
    const body = Object.assign(target.id ? { id: target.id } : { name: target.name },
      entries ? { tracks: entries.map((t) => ({ title: t.title, album_title: t.album_title, album_subtitle: t.album_subtitle || "" })) }
        : { albums: (albums || []).map((a) => ({ title: a.title, subtitle: a.subtitle || "" })) });
    if (albums) toast(`Adding ${plural(albums.length, "album")} in Roon…`);
    let j;
    try { j = await post("/api/roon-playlists/add", body); } catch (e) { j = { ok: false, fallback: true, why: "Couldn't reach Rouen." }; }
    if (j.ok) {
      const missing = (j.missing || []).length;
      const kept = j.kept || [];
      // Tracks Roon didn't take (one album's, refused): kept in Rouen's own, as the owner chose.
      if (kept.length && entries) {
        await keepInRouen(j.name, entries.filter((t) => kept.includes(t.title)), null, `${kept.length} of them weren't taken by Roon (${j.why})`);
        return true;
      }
      toast(`Added ${plural(j.added, entries ? "track" : "album")} to "${j.name}" in Roon` + (missing ? ` — ${missing} not found in your library` : ""), missing ? undefined : "ok");
      return true;
    }
    if (!j.fallback) { toast(j.error || "Couldn't add that", "error"); return false; }
    // Today's way: Rouen's own playlist of that name, so nothing picked is lost.
    return keepInRouen(j.name || target.name, entries, albums, j.why || "");
  }

  /**
   * Into Rouen's own playlist of that name — the one there is, else a new one (the review: a name alone makes a
   * new playlist each time) — then why it isn't in Roon, said last so its own message doesn't hide it.
   * @param {string} name @param {any[] | null} entries @param {any[] | null} albums @param {string} why
   */
  async function keepInRouen(name, entries, albums, why) {
    /** @type {{ id?: string, name?: string }} */
    let target = { name };
    try {
      const r = await fetch("/api/user-playlists", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const same = (j.playlists || []).find((/** @type {any} */ p) => p.name === name);
      if (same) target = { id: same.id };
    } catch (e) {
      target = { name };   // unreachable: the add below says so
    }
    const ok = await host().addToUserPlaylist(target, entries, albums);
    if (ok && why) toast(`Kept in Rouen, not Roon: ${why}`);
    return ok;
  }

  /**
   * The Add to playlist sheet. Exactly one of `entries` (tracks) and `albums` is supplied.
   * @param {any[] | null} entries @param {any[] | null} albums
   */
  async function openAddSheet(entries, albums) {
    const n = entries ? entries.length : (albums || []).length;
    if (!n) { toast("Nothing to add", "error"); return; }
    const roon = await roonPlaylists();
    const native = !!(roon && roon.available);
    if (roon && !roon.available && roon.why) toast(`Your playlists in Rouen: ${roon.why}`);
    let list = [];
    if (!native) {
      try {
        const r = await fetch("/api/user-playlists", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { toast("Couldn't read your playlists", "error"); return; }
        list = j.playlists || [];
      } catch (e) {
        toast("Couldn't reach the extension", "error");
        return;
      }
    }
    const what = entries ? plural(n, "track") : plural(n, "album");
    const done = (/** @type {boolean} */ ok) => { if (ok) host().clearAfterAdd(); };
    host().openLibSheet(native ? `Add ${what} to a Roon playlist` : `Add ${what} to…`,
      (/** @type {HTMLElement} */ body, /** @type {() => void} */ close) => {
        /** @param {string} label @param {() => void} fn */
        const row = (label, fn) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "action-btn sheet-row";
          // textContent, never a template: a playlist name is user text and
          // this sheet has no business interpreting it as markup.
          b.textContent = label;
          b.addEventListener("click", () => { close(); fn(); });
          body.appendChild(b);
        };
        row("＋ New playlist…", () => {
          const name = window.prompt("Name this playlist", "My playlist");
          if (name === null) return;
          const trimmed = String(name).trim();
          if (!trimmed) { toast("Give it a name", "error"); return; }
          (native ? addToRoon({ name: trimmed }, entries, albums) : host().addToUserPlaylist({ name: trimmed }, entries, albums)).then(done);
        });
        if (native) {
          for (const p of roon.playlists) {
            row(p.tracks === null ? p.name : `${p.name} · ${plural(p.tracks, "track")}`, () => { addToRoon({ id: p.id, name: p.name }, entries, albums).then(done); });
          }
        } else {
          for (const p of list) {
            row(`${p.name} · ${plural(p.track_total, "track")}`, () => { host().addToUserPlaylist({ id: p.id }, entries, albums).then(done); });
          }
        }
      });
  }

  /**
   * A Roon playlist's page: Rename and Delete in its ⋯, when native mode can change it.
   * @param {HTMLElement} page  the playlist's page @param {string} title  its name, as Roon lists it
   */
  async function decorate(page, title) {
    const roon = await roonPlaylists();
    if (!roon || !roon.available || !page.isConnected) return;
    // By its name, all this page knows of it: two of one name can't be told apart, so neither is offered (the review).
    const same = roon.playlists.filter((/** @type {any} */ x) => x.name === title);
    if (same.length !== 1) return;
    const p = same[0];
    let actions = /** @type {HTMLElement | null} */ (page.querySelector(".playlist-actions"));
    if (!actions) {
      // An empty playlist has no row yet (nothing to play): one for its ⋯, under its heading.
      actions = document.createElement("div");
      actions.className = "playlist-actions";
      const head = page.querySelector(".playlist-head");
      if (head) head.after(actions); else page.appendChild(actions);
    }
    const items = [
      { label: "Rename", onClick: () => rename(p) },
      { label: "Delete", onClick: () => remove(p), danger: true },
    ];
    const menu = actions.querySelector(".overflow-menu");
    if (!menu) { actions.appendChild(W.RouenMenus.buildOverflowMenu(items, { title: p.name })); return; }
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sel-menu-item" + (it.danger ? " is-danger" : "");
      b.setAttribute("role", "menuitem");
      b.textContent = it.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); W.RouenMenus.closeOverflowMenu(); it.onClick(); });
      menu.appendChild(b);
    }
  }

  /** @param {{ id: string, name: string }} p */
  async function rename(p) {
    const name = window.prompt("Rename this playlist", p.name);
    if (name === null || !String(name).trim() || String(name).trim() === p.name) return;
    toast("Renaming in Roon…");
    const j = await post("/api/roon-playlists/rename", { id: p.id, name: String(name).trim() }).catch(() => ({ ok: false, error: "Couldn't reach Rouen." }));
    if (!j.ok) { toast(j.error || "Couldn't rename it", "error"); return; }
    toast("Renamed in Roon", "ok");
    if (W.__showPlaylists) W.__showPlaylists();
  }

  /** @param {{ id: string, name: string }} p */
  async function remove(p) {
    const ok = await W.RouenMenus.confirmDialog(`Delete "${p.name}" from Roon? It goes from Roon's own apps too, and can't be undone.`);
    if (!ok) return;
    const j = await post("/api/roon-playlists/delete", { id: p.id }).catch(() => ({ ok: false, error: "Couldn't reach Rouen." }));
    if (!j.ok) { toast(j.error || "Couldn't delete it", "error"); return; }
    toast("Deleted from Roon", "ok");
    if (W.__showPlaylists) W.__showPlaylists();
  }

  /**
   * The Playlists screen's own (Rouen's) tiles, said to be in Rouen only while native mode can make Roon's.
   * @param {HTMLElement[]} tiles
   */
  async function markRouenOnly(tiles) {
    if (!tiles.length) return;
    const roon = await roonPlaylists();
    if (!roon || !roon.available) return;
    for (const t of tiles) {
      const sub = t.querySelector(".album-artist");
      if (sub && t.isConnected && !/In Rouen only/.test(sub.textContent || "")) sub.textContent = (sub.textContent || "") + " · In Rouen only";
    }
  }

  W.RouenPlaylists = { openAddSheet, decorate, markRouenOnly };
})();
