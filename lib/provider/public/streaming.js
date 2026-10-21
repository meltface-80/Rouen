// @ts-check
"use strict";
/*
 * streaming.js — N2c-1 (dev/design/native-remote.md §10.3, v1.9.39): TIDAL and Qobuz as Roon
 * shows them, through the official extension API's browse, whatever is in the library.
 *
 *   GET  /api/streaming/level?service=tidal|qobuz|search&q=&path=&offset=&count=&zone_or_output_id=
 *        a level's items, or — when the path ends on an album, a playlist or an artist — its page:
 *        the actions its menu offers, its tracks, the lists it also holds (an artist's Albums), and
 *        whether the album is in the library. A search is read in the zone given (Roon's search is
 *        the zone's), so a play walks the very tree that was shown
 *   POST /api/streaming/play        {service, q?, path, kind, zone_or_output_id}
 *   POST /api/streaming/play-track  {service, q?, path, pos, title, kind, zone_or_output_id}
 *        a track: on a page, or on a level of tracks, by its position there, its title the proof
 *
 * A page is named by its path of titles from the service's own level (or from a search's terms),
 * each with its position on its level to tell two of one title apart: an item's key belongs to the
 * load that gave it, so every request walks from the root, the position tried first and the title
 * the proof. Only lists are opened on the way; a page's menu (an action_list) is opened to read its
 * actions; an action is carried out only when it is the one asked for, with the zone.
 */
const { plainCredit } = require("../../roon-direct/find");

const SERVICES = Object.freeze({ tidal: "TIDAL", qobuz: "Qobuz" });
const KINDS = new Set(["play_now", "play_next", "queue", "shuffle", "radio"]);
const MAX_STEPS = 10;
const PAGE_ITEMS = 500;
const LEVEL_MAX = 100;

/**
 * A page's opening menu: its first item, an action_list named "Play …" with no credit — the rule the
 * album view's own walk uses (index.js), since a track is an action_list too, and carries one.
 * @param {any} it
 */
const isPageMenu = (it) => !!it && it.hint === "action_list" && !it.subtitle && /^play\b/i.test(String(it.title || ""));
/** @param {any[]} items */
const pageMenu = (items) => (isPageMenu(items[0]) ? items[0] : null);
/** An item as a page shows it: never its key; a credit read as names (§9.1). @param {any} it @param {number} pos */
const shown = (it, pos) => ({ title: String(it.title || ""), subtitle: it.subtitle ? plainCredit(String(it.subtitle)) : null,
  hint: it.hint || null, image_key: it.image_key || null, pos });

/** @param {string} message @param {number} status */
function failure(message, status) {
  const e = /** @type {Error & { status?: number }} */ (new Error(message));
  e.status = status;
  return e;
}

/**
 * Where a request starts, and the steps from there, as the route takes them; null when malformed.
 * @param {any} q  { service, q, path }  path: JSON of [[title, position], …]
 * @returns {{ root: { service?: string, search?: string }, path: Array<[string, number]> } | null}
 */
function parseWhere(q) {
  const service = String(q.service || "");
  /** @type {{ service?: string, search?: string }} */
  let root;
  if (service === "search") {
    const terms = typeof q.q === "string" ? q.q.trim() : "";
    if (!terms || terms.length > 200) return null;
    root = { search: terms };
  } else if (Object.prototype.hasOwnProperty.call(SERVICES, service)) root = { service: SERVICES[/** @type {"tidal"|"qobuz"} */ (service)] };
  else return null;
  let path;
  try { path = typeof q.path === "string" ? JSON.parse(q.path || "[]") : (q.path || []); } catch (e) { return null; }   // a malformed path is refused below
  if (!Array.isArray(path) || path.length > MAX_STEPS) return null;
  if (!path.every((s) => Array.isArray(s) && s.length === 2 && typeof s[0] === "string" && s[0].length <= 500 && Number.isInteger(s[1]) && s[1] >= -1)) return null;
  return { root, path: /** @type {Array<[string, number]>} */ (path) };
}

/**
 * @param {{ browse: (o: any) => Promise<any>, load: (o: any) => Promise<any>, withBrowseSession: <T>(fn: (key: string) => Promise<T>) => Promise<T>,
 *           drillActionMenu: (hierarchy: string, key: string, itemKey: string) => Promise<Array<{ item_key: string, title: string, kind: string }>>,
 *           matchAction: (actions: any[], kind: string) => any, libraryOffset: (title: string, artist: string) => number | null,
 *           defaultZone: () => string | null, hasCore: () => boolean }} deps
 */
function createStreaming(deps) {
  /** The item titled `title` on this level: at `pos` if it is there, else the first so titled. */
  async function find(/** @type {string} */ key, /** @type {string} */ hierarchy, /** @type {string} */ title, /** @type {number} */ pos) {
    const want = title.trim().toLowerCase();
    const same = (/** @type {any} */ it) => !!it && String(it.title || "").trim().toLowerCase() === want;
    if (pos >= 0) {
      const r = await deps.load({ hierarchy, offset: pos, count: 1, multi_session_key: key });
      if (same((r.items || [])[0])) return r.items[0];
    }
    for (let off = 0; off < 2000; off += 100) {
      const r = await deps.load({ hierarchy, offset: off, count: 100, multi_session_key: key });
      const items = r.items || [];
      const hit = items.find(same);
      if (hit) return hit;
      if (off + 100 >= (r.list && r.list.count ? r.list.count : 0) || !items.length) break;
    }
    return null;
  }

  /**
   * From the root to the end of `path`, opening only lists; the last item entered (its title,
   * credit and cover name the page it opened). The zone is given on every step when playing.
   * A search begins in `zone`, else `searchZone` (the zone the level was read in), else the first there is.
   * @param {string} key @param {{ service?: string, search?: string }} root @param {Array<[string, number]>} path @param {string | null} zone
   * @param {string | null} [searchZone]
   */
  async function walk(key, root, path, zone, searchZone) {
    const z = zone ? { zone_or_output_id: zone } : {};
    const hierarchy = root.search ? "search" : "browse";
    const steps = root.search ? path : /** @type {Array<[string, number]>} */ ([[/** @type {string} */ (root.service), -1]]).concat(path);
    if (root.search) {
      // Roon's search is the zone's (album-search.js): the zone chosen, else the first there is.
      const sz = zone || searchZone || deps.defaultZone();
      await deps.browse(Object.assign({ hierarchy, input: root.search, pop_all: true, multi_session_key: key }, sz ? { zone_or_output_id: sz } : {}));
    } else await deps.browse(Object.assign({ hierarchy, pop_all: true, multi_session_key: key }, z));
    let last = null;
    for (const [title, pos] of steps) {
      const item = await find(key, hierarchy, title, pos);
      if (!item) throw failure(`"${title}" isn't there any more. Go back and open it again.`, 404);
      if (item.hint !== "list" || !item.item_key) throw failure(`"${title}" can't be opened here.`, 409);
      const b = await deps.browse(Object.assign({ hierarchy, item_key: item.item_key, multi_session_key: key }, z));
      if (!b || b.action !== "list") throw failure(`"${title}" didn't open.`, 502);
      last = item;
    }
    return { hierarchy, last };
  }

  return {
    /**
     * A level's items, or the page the path ends on.
     * @param {any} q  the query: service, q, path, offset, count
     */
    async level(q) {
      const where = parseWhere(q);
      if (!where) throw failure("service (tidal, qobuz or search with q) and a path, please", 400);
      if (!deps.hasCore()) throw failure("Not paired with Roon Core yet", 503);
      const offset = Math.max(0, Number.parseInt(q.offset, 10) || 0);
      const count = Math.min(LEVEL_MAX, Math.max(1, Number.parseInt(q.count, 10) || 60));
      return deps.withBrowseSession(async (key) => {
        const searchZone = typeof q.zone_or_output_id === "string" && q.zone_or_output_id ? q.zone_or_output_id : null;
        const { hierarchy, last } = await walk(key, where.root, where.path, null, searchZone);
        const head = await deps.load({ hierarchy, offset: 0, count, multi_session_key: key });
        const items = head.items || [];
        const title = (head.list && head.list.title) || (last ? String(last.title || "") : where.root.service || where.root.search || "");
        const menu = where.path.length ? pageMenu(items) : null;
        if (!menu) {
          const got = offset ? (await deps.load({ hierarchy, offset, count, multi_session_key: key })).items || [] : items.slice(0, count);
          return { title, count: head.list ? head.list.count : got.length, offset, items: got.map((it, i) => shown(it, offset + i)), page: null };
        }
        // A page: its items up to PAGE_ITEMS (the rest read once, after the head), then its menu's actions
        // (that opens the menu, carrying nothing out).
        const total = head.list && head.list.count ? head.list.count : items.length;
        const all = total > items.length
          ? items.concat((await deps.load({ hierarchy, offset: items.length, count: Math.min(total, PAGE_ITEMS) - items.length, multi_session_key: key })).items || [])
          : items;
        // Its tracks: every action_list after its menu, each with its position on the page; and the lists
        // it also holds (an artist's Albums, Singles …), as a level shows them.
        const tracks = all.map((t, pos) => ({ t, pos })).filter(({ t, pos }) => pos > 0 && t && t.hint === "action_list")
          .map(({ t, pos }) => ({ title: String(t.title || ""), subtitle: t.subtitle ? plainCredit(String(t.subtitle)) : null, pos }));
        const lists = all.map((it, pos) => ({ it, pos })).filter(({ it, pos }) => pos > 0 && it && it.hint === "list").map(({ it, pos }) => shown(it, pos));
        // A key belongs to the load that gave it: after the rest was read, the menu's is asked for again (one item).
        const menuNow = all === items ? menu : pageMenu((await deps.load({ hierarchy, offset: 0, count: 1, multi_session_key: key })).items || []);
        if (!menuNow) throw failure("That page changed while it was read. Open it again.", 409);
        const actions = (await deps.drillActionMenu(hierarchy, key, menuNow.item_key)).map((a) => ({ kind: a.kind, title: a.title }));
        const self = last ? shown(last, where.path[where.path.length - 1][1]) : null;
        const kind = /album/i.test(String(menu.title)) ? "album" : /playlist/i.test(String(menu.title)) ? "playlist" : "other";
        const offsetInLibrary = self && kind === "album" ? deps.libraryOffset(self.title, self.subtitle || "") : null;
        return { title, count: total, offset: 0, items: lists, page: { kind, menu: String(menu.title), self, actions, tracks, library_offset: offsetInLibrary,
          shown: all.length } };
      });
    },

    /**
     * The page's menu, the action asked for, carried out in the zone.
     * @param {any} b  the body: service, q, path, kind, zone_or_output_id
     */
    async play(b) {
      const where = parseWhere(b);
      if (!where || !where.path.length || !KINDS.has(b.kind) || typeof b.zone_or_output_id !== "string" || !b.zone_or_output_id) {
        throw failure("service, path, kind and zone_or_output_id, please", 400);
      }
      if (!deps.hasCore()) throw failure("Not paired with Roon Core yet", 503);
      return deps.withBrowseSession(async (key) => {
        const { hierarchy } = await walk(key, where.root, where.path, b.zone_or_output_id);
        const items = (await deps.load({ hierarchy, offset: 0, count: 1, multi_session_key: key })).items || [];
        const menu = pageMenu(items);
        if (!menu) throw failure("There's nothing to play here.", 409);
        const action = deps.matchAction(await deps.drillActionMenu(hierarchy, key, menu.item_key), b.kind);
        if (!action) throw failure(`Roon doesn't offer that here.`, 409);
        await deps.browse({ hierarchy, item_key: action.item_key, zone_or_output_id: b.zone_or_output_id, multi_session_key: key });
        return { invoked: action.title };
      });
    },

    /**
     * One track: on a page, or on a level of tracks, by its position there, its title the proof.
     * @param {any} b  the body: service, q, path, pos, title, kind, zone_or_output_id
     */
    async playTrack(b) {
      const where = parseWhere(b);
      if (!where || !where.path.length || !KINDS.has(b.kind) || !Number.isInteger(b.pos) || b.pos < 0 || typeof b.title !== "string"
          || typeof b.zone_or_output_id !== "string" || !b.zone_or_output_id) {
        throw failure("service, path, pos, title, kind and zone_or_output_id, please", 400);
      }
      if (!deps.hasCore()) throw failure("Not paired with Roon Core yet", 503);
      return deps.withBrowseSession(async (key) => {
        const { hierarchy } = await walk(key, where.root, where.path, b.zone_or_output_id);
        const t = ((await deps.load({ hierarchy, offset: b.pos, count: 1, multi_session_key: key })).items || [])[0];
        // A track is an action_list; a page's own menu ("Play Album") is not one to play as a track.
        if (!t || t.hint !== "action_list" || !t.item_key || String(t.title || "") !== b.title || (b.pos === 0 && isPageMenu(t))) {
          throw failure("That track has moved. Go back and open the page again.", 409);
        }
        const action = deps.matchAction(await deps.drillActionMenu(hierarchy, key, t.item_key), b.kind);
        if (!action) throw failure(`Roon doesn't offer that for this track.`, 409);
        await deps.browse({ hierarchy, item_key: action.item_key, zone_or_output_id: b.zone_or_output_id, multi_session_key: key });
        return { invoked: action.title, track: t.title };
      });
    },
  };
}

/**
 * @param {{ get: Function, post: Function }} app
 * @param {ReturnType<typeof createStreaming>} s
 */
function mountStreaming(app, s) {
  /** An answer, or the error's own status and words. @param {(req: any) => Promise<any>} fn */
  const route = (fn) => async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await fn(req)); }
    catch (e) {
      const err = /** @type {any} */ (e);
      res.status(err && err.status ? err.status : 502).json({ error: String(err && err.message || err) });
    }
  };
  app.get("/api/streaming/level", route((req) => s.level(req.query || {})));
  app.post("/api/streaming/play", route((req) => s.play(req.body || {})));
  app.post("/api/streaming/play-track", route((req) => s.playTrack(req.body || {})));
}

module.exports = { createStreaming, mountStreaming, parseWhere, SERVICES };
