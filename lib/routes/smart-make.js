// @ts-check
"use strict";
/*
 * smart-make.js — N2e-2b (dev/design/native-remote.md §12.7, v1.9.53): the one test, by hand.
 *
 *   GET /api/debug/roon-smart-make?name=<a Dynamic Playlist's name>          what would be made; asks the server nothing
 *   GET /api/debug/roon-smart-make?name=<a Dynamic Playlist's name>&make=1   made in Roon, once, and checked
 *
 * Only `make=1` writes, so a link previewed or prefetched never does. Rouen's Dynamic Playlist isn't changed.
 * The answer carries names, counts and reasons, never protocol bytes.
 */
const { mapFocus } = require("../roon-direct/focus-map");

/**
 * @typedef {import("../roon-direct/focus-map").Dynamic & { id?: string }} Dynamic
 */

/**
 * One of Rouen's Dynamic Playlists by its name, with how many albums its Focus matches and why Rouen can't use it; or
 * why not. Why it can't is asked of the record as saved: loading one drops a facet that is off (a label filter with
 * Labels off), which would make a broader playlist in Roon than the one saved (the review).
 * @param {string} name @param {Dynamic[]} list  as Rouen loads them @param {any[]} saved  as settings.json holds them
 * @param {(view: any) => number | null} matched @param {(sp: any) => string | null} unavailable
 * @returns {{ sp: Dynamic, matched: number | null, unavailable: string | null } | { error: string, status: number }}
 */
function dynamicNamed(name, list, saved, matched, unavailable) {
  const same = list.filter((p) => p.name === name);
  if (!same.length) return { status: 404, error: `Rouen has no Dynamic Playlist named "${name}".` };
  if (same.length > 1) return { status: 409, error: `Rouen has ${same.length} Dynamic Playlists named "${name}"; rename one first.` };
  const sp = same[0];
  const raw = (Array.isArray(saved) ? saved : []).find((p) => p && p.id === sp.id) || sp;
  return { sp, matched: matched(sp.view), unavailable: unavailable(raw) };
}

/**
 * @param {{ get: Function }} app
 * @param {{ maker: () => ReturnType<typeof import("../roon-direct/smart-make").createSmartMaker> | null,
 *           list: () => Dynamic[], saved: () => any[], matched: (view: any) => number | null, unavailable: (sp: any) => string | null }} d
 *   list: Rouen's Dynamic Playlists as loaded; saved: as settings.json holds them; matched: how many albums a Focus matches
 *   now (null: the library not built yet); unavailable: why Rouen itself can't use one now, or null
 */
function mountSmartMake(app, d) {
  app.get("/api/debug/roon-smart-make", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const name = typeof req.query.name === "string" ? req.query.name.slice(0, 200) : "";
    if (!name) {
      return res.json({ design: "dev/design/native-remote.md §12.7",
        how: "Add ?name=<one of your Dynamic Playlists> to see how it would be made as a Roon smart playlist; add &make=1 to make it. Rouen's own stays as it is." });
    }
    const dyn = dynamicNamed(name, d.list(), d.saved(), d.matched, d.unavailable);
    if ("error" in dyn) return res.status(dyn.status).json({ error: dyn.error });
    const mapped = mapFocus(dyn.sp, dyn.matched, dyn.unavailable);
    const rouen = { name: dyn.sp.name, view: dyn.sp.view || {}, limit: dyn.sp.limit ?? null, mode: dyn.sp.mode || null, order: dyn.sp.order || null,
      albumsMatched: dyn.matched };
    if ("why" in mapped) return res.json({ rouen, made: false, why: mapped.why });
    const maker = d.maker();
    if (!maker) return res.status(409).json({ rouen, made: false, why: ["Native mode isn't running."] });
    try {
      const out = req.query.make === "1" ? await maker.make(dyn.sp.name, mapped.focus) : await maker.preview(dyn.sp.name, mapped.focus);
      res.json(Object.assign({ rouen, focus: mapped.focus, notes: mapped.notes }, out));
    } catch (e) {
      res.status(500).json({ rouen, made: "unknown", why: ["Rouen failed while asking (" + /** @type {any} */ (e).message + "). Look in Roon before trying again."] });
    }
  });
}

module.exports = { mountSmartMake, dynamicNamed };
