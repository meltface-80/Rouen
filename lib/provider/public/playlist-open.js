// @ts-check
"use strict";
/*
 * playlist-open.js — one of your Roon playlists through Roon's official extension API: the public provider
 * (dev/design/native-remote.md §3.1). Its rows read, and the whole playlist or one of its tracks played or queued.
 * Moved out of index.js in 2.0.4-t1 (dev/quality.md, "Splitting the monoliths") with one change: the rows are read a
 * page at a time to Roon's own count, up to PLAYLIST_ITEMS, where one load of 1,000 rows had stopped every playlist at
 * 999 tracks (gert_mogensen, the Roon forum, 2026-11-10: a 1,515-track playlist, the 26 tracks added last missing).
 * What it reads of Rouen's — the browse calls, the title search, the track filters, the action menus, the errors — is
 * passed in.
 *
 * A playlist's cross-request identity is (offset, title), never item_key: an item_key is session-scoped, the offset
 * is a hint and the title the check (index.js, "Roon playlists").
 */

/** The most rows of one playlist read: past it the page says "Showing the first N of M tracks". */
const PLAYLIST_ITEMS = 10000;
/** Rows a load asks for: the count one load of a playlist always asked for before 2.0.4-t1. */
const PAGE = 1000;
/** Rows before a playlist's first track an action allows for (its Play row, a header) when it reads only as far as
 * the row it wants. */
const LEAD = 8;

/**
 * @param {{ browse: Function, load: Function, withBrowseSession: Function,
 *           findItemByTitle: (sk: any, hierarchy: string, title: string, max: number, ctx: string) => Promise<any>,
 *           playlistKeyOf: (title: string) => string, PLAYLIST_MAX: number, PLAYLIST_CTX: string,
 *           isTrackItem: (t: any, playMenu: any) => boolean, stripTrackNumber: (s: string) => string,
 *           normalize: (s: string) => string, roonBrowseError: Function, noActionError: Function,
 *           drillActionMenu: Function, matchAction: Function, pageSize?: number, maxItems?: number }} deps
 *   as index.js has them; pageSize and maxItems for the tests
 */
function createPlaylistOpen(deps) {
  const { browse, load, withBrowseSession, findItemByTitle, playlistKeyOf, PLAYLIST_MAX, PLAYLIST_CTX,
    isTrackItem, stripTrackNumber, normalize, roonBrowseError, noActionError, drillActionMenu, matchAction } = deps;
  const PAGE_ROWS = deps.pageSize || PAGE, MAX_ROWS = deps.maxItems || PLAYLIST_ITEMS;

  /**
   * A playlist's rows from the level the session stands on, a page at a time, to the count Roon gives, MAX_ROWS, or
   * `upTo` rows when an action needs no more. A page that comes back empty ends it (the list shrank under us): what was
   * read is kept.
   * @param {any} sessionKey @param {string} hierarchy @param {number} [upTo]
   * @returns {Promise<{ items: any[], total: number }>}
   */
  async function readRows(sessionKey, hierarchy, upTo) {
    const limit = upTo && upTo > 0 ? Math.min(upTo, MAX_ROWS) : MAX_ROWS;
    /** @type {any[]} */
    const items = [];
    let total = 0;
    while (items.length < limit) {
      const r = await load({ hierarchy, offset: items.length, count: Math.min(PAGE_ROWS, limit - items.length),
        multi_session_key: sessionKey });
      const got = (r && r.items) || [];
      total = (r && r.list && r.list.count) || total;
      items.push(...got);
      if (!got.length || items.length >= total) break;
    }
    return { items, total };
  }

  // Navigate a session into one playlist and return its contents. `expectTitle`
  // is verified against the item actually found at `offset`; on drift we re-locate
  // by title rather than opening whatever moved into that slot.
  // `zoneId` is passed on every browse in this walk: the Browse API documents it
  // as required for playback-related functionality, and it costs nothing to carry.
  // `upTo` (2.0.4-t1): read only that many rows, for an action that needs no more; `total` is still Roon's count.
  async function loadPlaylistSession(sessionKey, offset, expectTitle, zoneId, upTo) {
    const hierarchy = "playlists";
    const zone = zoneId || undefined;
    await browse({ hierarchy, pop_all: true, multi_session_key: sessionKey,
                   zone_or_output_id: zone });

    let item = null;
    if (Number.isFinite(offset) && offset >= 0) {
      const at = await load({ hierarchy, offset, count: 1, multi_session_key: sessionKey });
      item = (at.items && at.items[0]) || null;
    }
    const want = playlistKeyOf(expectTitle);
    if (want && (!item || playlistKeyOf(item.title) !== want)) {
      // The offset drifted (a playlist was added/renamed/removed above it).
      console.log(`[playlists] offset ${offset} drifted, re-locating "${expectTitle}"`);
      await browse({ hierarchy, pop_all: true, multi_session_key: sessionKey,
                     zone_or_output_id: zone });
      item = await findItemByTitle(sessionKey, hierarchy, expectTitle, PLAYLIST_MAX, PLAYLIST_CTX);
    }
    if (!item) {
      const err = /** @type {Error & { stale?: boolean }} */ (new Error("Playlist not found — reopen the playlist list"));
      err.stale = true;
      throw err;
    }

    const d = await browse({ hierarchy, item_key: item.item_key, multi_session_key: sessionKey,
                             zone_or_output_id: zone });
    // Same guard as drillActionMenu: without it a non-list response would leave
    // the follow-up load reading the CURRENT level, and we'd report the playlist
    // list itself as the playlist's tracks.
    if (d.action !== "list") throw roonBrowseError(d, "this playlist");

    // Every row, a page at a time (2.0.4-t1): one load of PLAYLIST_ITEMS rows stopped a 1,515-track playlist at 999
    // (its Play row took the thousandth), so the tracks added last, at its end, never showed.
    const { items, total: listed } = await readRows(sessionKey, hierarchy, upTo);
    // Identical shape to an album's contents: the playlist's own Play menu comes
    // back as a subtitle-less action_list alongside the tracks.
    const playMenu = items.find(i =>
         i.hint === "action_list" && !i.subtitle && /^play/i.test(i.title || "")
    ) || items.find(i =>
         i.hint === "action_list" && !i.subtitle
    );
    const total = listed || items.length;

    const realTracks = items.filter(t => isTrackItem(t, playMenu));
    if (!realTracks.length) {
      console.warn(`[playlist] "${item.title || ""}" resolved ${realTracks.length} track(s)` +
                   ` (zone=${zone || "none"}, raw items=${items.length}, list count=${total})`);
      for (const it of items.slice(0, 10)) {
        console.warn(`  - hint=${it.hint || "<none>"} title=${JSON.stringify(it.title)}` +
                     ` subtitle=${JSON.stringify(it.subtitle || "")}` +
                     ` item_key=${it.item_key ? "yes" : "no"}`);
      }
    }
    return { hierarchy, item, items, playMenu, total };
  }

  // Play or queue a WHOLE playlist through its own Play menu.
  async function invokePlaylistAction(offset, title, zoneOrOutputId, kind) {
    return withBrowseSession(async (sessionKey) => {
      // Its Play row is among the first: read those, and the rest only when it isn't (2.0.4-t1).
      let got = await loadPlaylistSession(sessionKey, offset, title, zoneOrOutputId, LEAD);
      if (!got.playMenu && got.items.length < got.total) got = await loadPlaylistSession(sessionKey, offset, title, zoneOrOutputId);
      const { hierarchy, item, playMenu } = got;
      if (!playMenu) throw new Error("This playlist offers no play action");
      const actions = await drillActionMenu(hierarchy, sessionKey, playMenu.item_key);
      const action = matchAction(actions, kind);
      if (!action) {
        throw noActionError(kind, actions, "this playlist");
      }
      await browse({
        hierarchy,
        item_key: action.item_key,
        zone_or_output_id: zoneOrOutputId,
        multi_session_key: sessionKey
      });
      return { invoked: action.title, playlist: item.title || "" };
    });
  }

  // Play or queue ONE track of a playlist. Mirrors invokeTrackAction: the tapped
  // title is verified against the re-resolved list, so a playlist edited since the
  // screen opened re-matches by title instead of firing whatever now sits at that
  // index.
  async function invokePlaylistTrackAction(offset, title, trackIndex, trackTitle, zoneOrOutputId, kind) {
    return withBrowseSession(async (sessionKey) => {
      const wanted = normalize(trackTitle || "");
      /** The row tapped: at its index when it still has its title, else (`byTitle`) the first of that title. */
      const pick = (/** @type {any[]} */ items, /** @type {any} */ playMenu, /** @type {boolean} */ byTitle) => {
        const trackItems = items.filter(t => isTrackItem(t, playMenu));
        let item = trackItems[trackIndex];
        if (!item || (wanted && normalize(stripTrackNumber(item.title)) !== wanted)) {
          item = byTitle && wanted
            ? trackItems.find(t => normalize(stripTrackNumber(t.title)) === wanted)
            : null;
        }
        return item || null;
      };
      // Read only as far as the row tapped (2.0.4-t1): each track of a run played in the order shown reads its row
      // again. Among those rows only the row at its own index is taken; any other answer (the playlist edited since the
      // page was read: the row moved, or one of its title further on) comes from the whole playlist, as before, so a
      // title found early never stands for one at its own place further down.
      let got = await loadPlaylistSession(sessionKey, offset, title, zoneOrOutputId, trackIndex + 1 + LEAD);
      const whole = got.items.length >= got.total;
      let item = pick(got.items, got.playMenu, whole);
      if (!item && !whole) {
        got = await loadPlaylistSession(sessionKey, offset, title, zoneOrOutputId);
        item = pick(got.items, got.playMenu, true);
      }
      const { hierarchy } = got;
      if (!item) {
        const err = /** @type {Error & { stale?: boolean }} */ (new Error("Playlist changed — reopen it"));
        err.stale = true;
        throw err;
      }

      const actions = await drillActionMenu(hierarchy, sessionKey, item.item_key);
      const action = matchAction(actions, kind);
      if (!action) {
        throw noActionError(kind, actions, "this track");
      }
      await browse({
        hierarchy,
        item_key: action.item_key,
        zone_or_output_id: zoneOrOutputId,
        multi_session_key: sessionKey
      });
      return { invoked: action.title, track: stripTrackNumber(item.title) };
    });
  }

  return { loadPlaylistSession, invokePlaylistAction, invokePlaylistTrackAction, readRows };
}

module.exports = { createPlaylistOpen, PLAYLIST_ITEMS, PAGE, LEAD };
