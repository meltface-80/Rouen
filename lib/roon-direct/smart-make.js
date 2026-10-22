// @ts-check
"use strict";
/*
 * smart-make.js — N2e-2b (dev/design/native-remote.md §12.7, v1.9.53): the one test. One of Rouen's Dynamic Playlists
 * made by hand as a Roon smart playlist, for the owner to check in Roon.
 *
 *   preview: the mapping (focus-map.js), and each genre's GenreLite as found in what the server has sent — asks the
 *            server nothing.
 *   make:    Playlists::CreatePlaylistFromParameters with the profile, the name and the album Focus, believed once the
 *            Playlists object lists a smart playlist of that name whose Focus reads back with the genres sent.
 *            Never run nor captured before this test.
 *
 * Each in its turn with reads, hearts and searches. Nothing in Rouen changes.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, smartPlaylistArgs } = require("./methods");
const { profileObjectFor, profilesOf } = require("./session");
const { allPlaylists, isSmart } = require("./playlists");
const { readList } = require("./focus");

const SHOWN_GENRES = 20;

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
 * The genres a smart playlist's Focus requires and excludes, by name, read back from what the server sent.
 * @param {any} graph @param {any} p  the Playlist object
 * @returns {{ require: string[], exclude: string[] } | null}  null: no Focus, or a list of it not read whole
 */
function genresOf(graph, p) {
  const focus = field(p, "AlbumCriteria");
  const o = isRef(focus) ? graph.get(focus.$ref) : null;
  const f = o && o.loaded ? o.fields : focus;
  if (!f || typeof f !== "object") return null;
  /** @param {string} member @returns {string[] | null} */
  const names = (member) => {
    const key = Object.keys(f).find((k) => k.endsWith("::" + member));
    if (!key) return [];   // not sent: the default, an empty list
    const list = Buffer.isBuffer(f[key]) ? readList(graph, key, f[key]) : null;
    if (!list || !list.whole) return null;
    return list.items.map((x) => { const g = isRef(x) ? graph.get(x.$ref) : null; return g && g.loaded ? String(field(g, "Name")) : "?"; });
  };
  const require = names("RequireGenreObjects"), exclude = names("ExcludeGenreObjects");
  return require && exclude ? { require, exclude } : null;
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

  /** The session, the profile, the Playlists object and its playlists now; or why not. */
  function now() {
    if (!deps.on()) return { notSent: "Native mode is off." };
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { notSent: "Native mode isn't connected to your server right now." };
    if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
    const profiles = profilesOf(s.root);
    if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return { notSent: "Choose your profile in Settings → Native mode first." };
    const profile = profileObjectFor(s.root, deps.profile());
    if (!profile) return { notSent: "Your server sent no profile." };
    const all = allPlaylists(s);
    if (!all) return { notSent: "Your server hasn't sent its playlists, whole." };
    return { s, profile, all };
  }

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

  return {
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
            require: /** @type {bigint[]} */ (p.require), exclude: /** @type {bigint[]} */ (p.exclude) });
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
        const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) => [...a].sort().join("\n") === [...b].sort().join("\n");
        /** The smart playlist of that name, as it lists now, and its genres read back (null: not read whole). */
        const listed = () => {
          const all = allPlaylists(s);
          const x = all ? all.playlists.find((y) => field(y, "Name") === name && isSmart(y)) : undefined;
          return x ? { x, genres: genresOf(s.graph, x) } : undefined;
        };
        // Believed once it lists as smart AND its Focus reads back with the genres sent (§12.7.2).
        const shown = await waitFor(settleMs, () => {
          const l = listed();
          return l && l.genres && same(l.genres.require, focus.include) && same(l.genres.exclude, focus.exclude) ? l : undefined;
        });
        if (!shown) {
          unsure.add(name);
          const l = listed();
          log(`the smart playlist "${name}" was taken and ${l ? "listed with other genres" : "not shown"} within ${settleMs / 1000} s`);
          return { made: "unknown", why: [l
            ? `Your server made a smart playlist "${name}", but its genres read back as ${l.genres ? JSON.stringify(l.genres) : "unreadable"}. Look in Roon.`
            : "Your server took it, but didn't show a smart playlist of that name. Look in Roon before trying again."] };
        }
        const num = (/** @type {any} */ x) => (typeof x === "number" ? x : typeof x === "bigint" ? Number(x) : null);
        const albums = num(field(shown.x, "AlbumCount")), tracks = num(field(shown.x, "TrackCount"));
        log(`the smart playlist "${name}" made: ${albums} albums, ${tracks} tracks`);
        return { made: true, name, genres: shown.genres, albums, tracks };
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createSmartMaker, genresSent, genresOf };
