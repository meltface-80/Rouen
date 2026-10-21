// @ts-check
"use strict";
/*
 * streaming-browse-probe.js — N2c-0 (dev/design/native-remote.md §10.1, v1.9.36): what Roon's
 * official browse API offers for TIDAL and Qobuz, read only, run by hand.
 *
 *   GET /api/debug/streaming-browse         says what a run would do; touches nothing
 *   GET /api/debug/streaming-browse?run=1   walks each service's tree and answers with it
 *
 * For each of TIDAL and Qobuz on the browse root: each level's first items (title, subtitle,
 * hint), a few levels down, and the menus a page opens with ("Play Album", "Play Artist", …) —
 * which actions an extension is offered there ("Add to Library", "Listen Later", …).
 *
 * THE RULE: in the browse API, opening an item whose hint is "action" carries it out (plays,
 * queues, adds). This walk opens only "list" and "action_list" items (the latter opens a menu and
 * carries nothing out), never "action" or "input", and gives no zone.
 *
 * Depth first, so pages are met before the budget runs out on the service's own lists: into a
 * list, then back up a level (pop_levels) — each item found again in a fresh load of its level,
 * since an item key belongs to the load that gave it.
 */

const SERVICES = ["TIDAL", "Qobuz"];
const SHOWN = 25;           // items recorded a level
const OPENED = [8, 3, 2];   // lists opened on a level, at depth 1, 2 and 3 below the service
const MENUS = 6;            // menus opened a service
const MENUS_EACH = 2;       // of each kind ("Play Album", "Play Artist", …)
const CALLS = 400;          // browse and load calls a service, at most
const ERRORS_IN_ROW = 3;    // a Core gone quiet: stopped, rather than waited out path by path

/** The only items this probe may open (see THE RULE). @param {any} item */
const safeToOpen = (item) => !!item && !!item.item_key && (item.hint === "list" || item.hint === "action_list");

/** An item as the answer shows it: never its key. @param {any} it */
const shown = (it) => ({ title: String(it.title || ""), subtitle: it.subtitle ? String(it.subtitle) : null, hint: it.hint || null });
/** A page's opening menu: its first item, a menu named "Play …" with no credit (a track named so carries its artist). @param {any[]} items */
/** A page's opening menu: its first item, a menu named "Play …". @param {any[]} items */
const pageMenu = (items) => {
  const first = items[0];
  return first && first.hint === "action_list" && !first.subtitle && /^play\b/i.test(String(first.title || "")) && safeToOpen(first) ? first : null;
};

/**
 * @typedef {object} WalkDeps
 * @property {(fn: (sessionKey: string) => Promise<any>) => Promise<any>} withBrowseSession
 * @property {(opts: any) => Promise<any>} browse
 * @property {(opts: any) => Promise<any>} load
 */

class Stop extends Error {}

/**
 * One service's tree, on one browse session.
 * @param {WalkDeps} d @param {string} key @param {string} service @param {number} budget
 */
async function walkService(d, key, service, budget) {
  let calls = 0;
  const call = (/** @type {(o: any) => Promise<any>} */ fn, /** @type {any} */ o) => {
    if (++calls > budget) throw new Stop(`stopped at ${budget} calls`);
    return fn(Object.assign({ hierarchy: "browse", multi_session_key: key }, o));
  };
  /** The item titled `title` on this level, paged through, matched as index.js's findItemByTitle matches. @param {string} title */
  const find = async (title) => {
    const want = title.trim().toLowerCase();
    for (let off = 0; off < 1000; off += 100) {
      const r = await call(d.load, { offset: off, count: 100 });
      const items = r.items || [];
      const hit = items.find((/** @type {any} */ i) => String(i.title || "").trim().toLowerCase() === want);
      if (hit) return hit;
      if (off + 100 >= (r.list && r.list.count ? r.list.count : 0) || !items.length) break;
    }
    return null;
  };
  /** Into the list titled `title` on this level. @param {string} title */
  const enter = async (title) => {
    const item = await find(title);
    if (!item) throw new Error(`"${title}" is no longer there`);
    if (!safeToOpen(item) || item.hint !== "list") throw new Error(`"${title}" is not a list (hint ${item.hint || "none"}): not opened`);
    await call(d.browse, { item_key: item.item_key });
  };
  /** Back to the level at `path`, from the root. @param {string[]} path */
  const reach = async (path) => {
    await call(d.browse, { pop_all: true });
    for (const title of path) await enter(title);
  };

  /** @type {any[]} */
  const levels = [];
  /** @type {any[]} */
  const menus = [];
  const kinds = new Map();
  let inRow = 0;

  /** At `path`, already entered: the level, its menu, then each list on it, and back. @param {string[]} path */
  async function visit(path) {
    const lvl = await call(d.load, { offset: 0, count: SHOWN });
    const items = lvl.items || [];
    levels.push({ path, title: (lvl.list && lvl.list.title) || null, count: lvl.list ? lvl.list.count : null, items: items.map(shown) });
    inRow = 0;
    const menu = path.length > 1 ? pageMenu(items) : null;
    const kind = menu ? String(menu.title) : "";
    if (menu && menus.length < MENUS && (kinds.get(kind) || 0) < MENUS_EACH) {
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
      const b = await call(d.browse, { item_key: menu.item_key });
      if (b && b.action === "list") {
        const acts = await call(d.load, { offset: 0, count: 50 });
        menus.push({ path, menu: kind, actions: (acts.items || []).map(shown), zone: null });
        await call(d.browse, { pop_levels: 1 });
      } else menus.push({ path, menu: kind, opened: b ? b.action : null });
    }
    if (path.length > OPENED.length) return;
    const children = items.filter((/** @type {any} */ i) => i.hint === "list" && safeToOpen(i)).slice(0, OPENED[path.length - 1])
      .map((/** @type {any} */ i) => String(i.title || ""));
    for (const title of children) {
      const at = path.concat(title);
      try {
        await enter(title);
        await visit(at);
        await call(d.browse, { pop_levels: 1 });
      } catch (e) {
        if (e instanceof Stop) throw e;
        levels.push({ path: at, error: String(e && /** @type {any} */ (e).message) });
        if (++inRow >= ERRORS_IN_ROW) throw new Stop(`stopped after ${ERRORS_IN_ROW} errors in a row: ${String(e && /** @type {any} */ (e).message)}`);
        await reach(path);   // where this level was, whatever the error left
      }
    }
  }

  /** @type {string | null} */
  let stopped = null;
  try {
    await reach([service]);
    await visit([service]);
  } catch (e) {
    stopped = String(e && /** @type {any} */ (e).message);
  }
  return { service, levels, menus, calls: Math.min(calls, budget), stopped };
}

/**
 * The browse root, then each streaming service on it, walked.
 * @param {WalkDeps} d @param {{ calls?: number }} [o]  calls: the budget a service (tests)
 */
async function walkStreaming(d, o = {}) {
  const root = await d.withBrowseSession(async (key) => {
    await d.browse({ hierarchy: "browse", pop_all: true, multi_session_key: key });
    const r = await d.load({ hierarchy: "browse", offset: 0, count: 100, multi_session_key: key });
    return (r.items || []).map(shown);
  });
  /** @type {any[]} */
  const services = [];
  for (const name of SERVICES) {
    const item = root.find((/** @type {any} */ i) => i.title.trim().toLowerCase() === name.toLowerCase());
    if (!item) { services.push({ service: name, found: false }); continue; }
    // A session of its own each, so one service's walk never leaves the other's in a strange place.
    services.push(Object.assign({ found: true }, await d.withBrowseSession((key) => walkService(d, key, item.title, o.calls || CALLS))));
  }
  return { root, services };
}

/**
 * @param {{ get: Function }} app
 * @param {WalkDeps & { hasCore: () => boolean, walk?: typeof walkStreaming }} d
 */
function mountStreamingBrowseProbe(app, d) {
  const walk = d.walk || walkStreaming;
  let running = false;
  app.get("/api/debug/streaming-browse", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const about = { readOnly: true, design: "dev/design/native-remote.md §10.1",
      what: "What Roon's browse offers for TIDAL and Qobuz: each level's first items, and the menus its pages open with. Only lists and menus are opened; nothing is played, queued or added." };
    if (req.query.run !== "1") return res.json(Object.assign(about, { ran: false, how: "Add ?run=1 to run it." }));
    if (!d.hasCore()) return res.status(503).json(Object.assign(about, { ran: false, error: "Not paired with Roon Core yet" }));
    if (running) return res.status(409).json(Object.assign(about, { ran: false, error: "A run is already under way." }));
    running = true;
    try {
      res.json(Object.assign(about, { ran: true, ranAt: new Date().toISOString() }, await walk(d)));
    } catch (e) {
      res.status(500).json(Object.assign(about, { ran: true, error: String(e && /** @type {any} */ (e).message) }));
    } finally {
      running = false;
    }
  });
}

module.exports = { mountStreamingBrowseProbe, walkStreaming, safeToOpen, SERVICES };
