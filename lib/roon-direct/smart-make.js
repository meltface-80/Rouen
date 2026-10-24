// @ts-check
"use strict";
/*
 * smart-make.js — N2e-2b (dev/design/native-remote.md §12.7, v1.9.53): the one test. One of Rouen's Dynamic Playlists
 * made by hand as a Roon smart playlist, for the owner to check in Roon.
 *
 *   preview: the mapping (focus-map.js), and each genre's GenreLite as found in what the server has sent — asks the
 *            server nothing.
 *   make:    Playlists::CreatePlaylistFromParameters with the profile, the name and the album Focus, believed once the
 *            Playlists object lists a smart playlist of that name whose Focus reads back with the genres and every other
 *            filter sent (§12.15).
 *            Never run nor captured before this test.
 *
 * Each in its turn with reads, hearts and searches. Nothing in Rouen changes.
 */
const { field, waitFor } = require("./objects");
const { SIG, smartPlaylistArgs } = require("./methods");
const { allPlaylists, isSmart, playlistsNow } = require("./playlists");
const { focusFields, genreList } = require("./focus");
const { readExtra, differs, none, readOrder } = require("./focus-write");

const SHOWN_GENRES = 20;
const GENRES_ANY_OF = 1;   // CriteriaMode Or, as the make sends Rouen's genres

/**
 * @typedef {import("./focus-map").Mapped} Mapped
 * @typedef {{ name: string, oids: bigint[] }} Genre  a genre by name, and every GenreLite the server sent of that name
 */

/**
 * The genres the server has sent, by name. @param {any} graph
 * @returns {Map<string, bigint[]>}
 */
function genresSent(graph) {
  const out = new Map();
  for (const o of graph.ofType("GenreLite")) {
    const name = o.loaded ? field(o, "Name") : undefined;
    if (typeof name !== "string") continue;
    out.set(name, (out.get(name) || []).concat([o.oid]));
  }
  return out;
}

/**
 * The genres a smart playlist's Focus requires and excludes, by name, read back from what the server sent (focus.js).
 * @param {any} graph @param {any} p  the Playlist object
 * @returns {{ require: string[], exclude: string[] } | null}  null: no Focus, or a list of it not read whole
 */
function genresOf(graph, p) {
  const f = focusFields(graph, p);
  return f ? genresIn(graph, f) : null;
}
/** The same, from the Focus's members already found. @param {any} graph @param {Record<string, any>} f */
function genresIn(graph, f) {
  const require = genreList(graph, f, "RequireGenreObjects"), exclude = genreList(graph, f, "ExcludeGenreObjects");
  return require && exclude ? { require: require.map((g) => g.name), exclude: exclude.map((g) => g.name) } : null;
}

/**
 * What differs between a smart playlist Roon lists and the Focus sent, as a clause ("its order read back otherwise
 * than sent"), or null when it holds that Focus: its genres, how they combine (any-of, as Rouen's are), its order and
 * direction, and every other filter (§12.15). One judge for a make believed and a playlist found already moved (§12.16).
 * @param {any} graph @param {any} x  the Playlist object @param {Mapped} focus
 * @returns {{ genres: { require: string[], exclude: string[] } | null, other: string | null }}
 */
function focusDiffers(graph, x, focus) {
  const f = focusFields(graph, x);
  if (!f) return { genres: null, other: "its Focus wasn't sent back" };
  const genres = genresIn(graph, f);
  const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) => [...a].sort().join("\n") === [...b].sort().join("\n");
  if (!genres || !same(genres.require, focus.include) || !same(genres.exclude, focus.exclude)) {
    return { genres, other: `its genres read back as ${genres ? JSON.stringify(genres) : "unreadable"}` };
  }
  const modeKey = Object.keys(f).find((k) => k.endsWith("::GenresMode"));
  const mode = modeKey && typeof f[modeKey] === "number" ? f[modeKey] : 0;   // left out at its default (§12.13): And
  if (focus.include.length && mode !== GENRES_ANY_OF) return { genres, other: "its genres must all match, where Rouen's are any of them" };
  const order = readOrder(f);
  if (!order || order.ordering !== focus.ordering || order.direction !== focus.direction) return { genres, other: "its order read back otherwise than sent" };
  const extra = readExtra(graph, f);
  if ("why" in extra) return { genres, other: extra.why };
  const d = differs(focus.extra || none(), extra);
  return { genres, other: d ? `its ${d} read back otherwise than sent` : null };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           profile: () => string | null, log?: (line: string) => void, settleMs?: number }} deps
 */
function createSmartMaker(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 15000;
  let busy = false;
  /** The names a make was sent for and not shown: none is sent again until Rouen restarts (§12.7.2: look in Roon first). */
  const unsure = new Set();

  const now = () => playlistsNow(deps);

  /**
   * What would be made: each genre's GenreLite, the name free, or why not. @param {string} name @param {Mapped} focus
   * @param {any} s @param {{ svc: any, playlists: any[] }} all
   */
  function plan(name, focus, s, all) {
    const sent = genresSent(s.graph);
    /** @type {string[]} */
    const why = [];
    const pick = (/** @type {string} */ g) => {
      const oids = sent.get(g) || [];
      if (oids.length !== 1) why.push(oids.length ? `Your server sent ${oids.length} genres named "${g}"; Rouen can't tell them apart.` : `Your server hasn't sent Rouen the genre "${g}".`);
      return oids[0];
    };
    const require = focus.include.map(pick), exclude = focus.exclude.map(pick);
    if (all.playlists.some((p) => field(p, "Name") === name)) why.push(`Your server already has a playlist named "${name}".`);
    const names = [...sent.keys()].sort();
    return { why, require, exclude, genresSent: { count: names.length, first: names.slice(0, SHOWN_GENRES) } };
  }

  /**
   * A smart playlist of that name Roon lists now, and whether its Focus is this one: genres, order and every other filter
   * (§12.16: Folk, made by the test, is already moved). Asks the server nothing.
   * @param {any} s @param {string} name @param {Mapped} focus
   * @returns {{ id: string } | { other: string } | null}  null: none of that name
   */
  function sameIn(s, name, focus) {
    const all = allPlaylists(s);
    const named = all ? all.playlists.filter((y) => field(y, "Name") === name) : [];
    if (!named.length) return null;
    const x = named.length === 1 && isSmart(named[0]) ? named[0] : null;
    if (!x) return { other: named.length > 1 ? `Your server has ${named.length} playlists named "${name}".` : `Your server has a playlist named "${name}" that isn't smart.` };
    if (focusDiffers(s.graph, x, focus).other !== null) {
      return { other: `Your server already has a smart playlist named "${name}" with another Focus: rename one of them.` };
    }
    const pid = field(x, "PlaylistId");
    return Buffer.isBuffer(pid) ? { id: pid.toString("hex") }
      : { other: `Your server has "${name}" with this Focus, but Rouen couldn't read its id, so Rouen's own copy stays too.` };
  }

  return {
    /**
     * The smart playlist of that name Roon already holds with this Focus, or another of that name, or none (§12.16).
     * @param {string} name @param {Mapped} focus @returns {Promise<{ id: string } | { other: string } | { notSent: string } | null>}
     */
    existing: (name, focus) => deps.inTurn(async () => {
      const at = now();
      if ("notSent" in at) return { notSent: at.notSent };
      return sameIn(at.s, name, focus);
    }),

    /**
     * What would be made, asking the server nothing. @param {string} name @param {Mapped} focus
     * @returns {Promise<Record<string, any>>}
     */
    preview: (name, focus) => deps.inTurn(async () => {
      const at = now();
      if ("notSent" in at) return { made: false, why: [at.notSent] };
      const p = plan(name, focus, at.s, at.all);
      return { made: false, wouldMake: !p.why.length, why: p.why, genresSent: p.genresSent };
    }),

    /**
     * Made, once, and believed once it lists as smart with the genres sent. @param {string} name @param {Mapped} focus
     * @returns {Promise<Record<string, any>>}
     */
    async make(name, focus) {
      if (busy) return { made: false, why: ["A make is already running."] };
      if (unsure.has(name)) {
        return { made: false, why: [`A make of "${name}" was sent and not shown. Look in Roon: if it isn't there, restart Rouen to try again.`] };
      }
      busy = true;
      try {
        // The send in its turn; the wait for it to show outside it, reading only what has arrived (the review).
        const sent = await deps.inTurn(async () => {
          const at = now();
          if ("notSent" in at) return { made: false, why: [at.notSent] };
          const p = plan(name, focus, at.s, at.all);
          if (p.why.length) return { made: false, why: p.why, genresSent: p.genresSent };
          const args = smartPlaylistArgs(at.s.g, at.profile.oid, name, { ordering: focus.ordering, direction: focus.direction, seed: focus.seed,
            require: /** @type {bigint[]} */ (p.require), exclude: /** @type {bigint[]} */ (p.exclude), extra: focus.extra });
          log(`making the smart playlist "${name}" (${focus.include.length} genre(s) required, ${focus.exclude.length} excluded, order ${focus.sort})`);
          /** @type {{ success: boolean, status?: string }} */
          let res;
          try { res = await at.s.g.call(at.all.svc.oid, SIG.createSmartPlaylist, args); }
          catch (e) {
            unsure.add(name);
            return { made: "unknown", why: ["Your server didn't answer (" + /** @type {any} */ (e).message + "). Look in Roon before trying again."] };
          }
          if (!res.success) return { made: false, why: [`Your server refused it ("${res.status}").`] };
          return { s: at.s };
        });
        if (!("s" in sent)) return sent;
        const s = sent.s;
        /** The smart playlist of that name, as it lists now, and what of its Focus differs from what was sent (null: none). */
        const listed = () => {
          const all = allPlaylists(s);
          const x = all ? all.playlists.find((y) => field(y, "Name") === name && isSmart(y)) : undefined;
          return x ? Object.assign({ x }, focusDiffers(s.graph, x, focus)) : undefined;
        };
        // Believed once it lists as smart AND its Focus reads back as sent: genres, order, every other filter (§12.7.2, §12.15).
        const shown = await waitFor(settleMs, () => { const l = listed(); return l && l.other === null ? l : undefined; });
        if (!shown) {
          unsure.add(name);
          const l = listed();
          log(`the smart playlist "${name}" was taken and ${l ? "listed with another Focus" : "not shown"} within ${settleMs / 1000} s`);
          return { made: "unknown", why: [!l ? "Your server took it, but didn't show a smart playlist of that name. Look in Roon before trying again."
            : `Your server made a smart playlist "${name}", but ${l.other}. Look in Roon.`] };
        }
        const num = (/** @type {any} */ x) => (typeof x === "number" ? x : typeof x === "bigint" ? Number(x) : null);
        const albums = num(field(shown.x, "AlbumCount")), tracks = num(field(shown.x, "TrackCount"));
        log(`the smart playlist "${name}" made: ${albums} albums, ${tracks} tracks`);
        const pid = field(shown.x, "PlaylistId");
        return { made: true, name, id: Buffer.isBuffer(pid) ? pid.toString("hex") : null, genres: shown.genres, albums, tracks };
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createSmartMaker, genresSent, genresOf, focusDiffers };
