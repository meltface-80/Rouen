// @ts-check
"use strict";
/*
 * smart-update.js — N2e-3a (dev/design/native-remote.md §12.9, v1.9.55): Roon's update tried once, by hand. A Roon
 * smart playlist's order changed with Playlists::UpdatePlaylist, its genres carried over as its Focus holds them,
 * for the owner to check in Roon before Rouen's Edit is built on it (N2e-3b).
 *
 *   preview: the Focus as it reads now, the new order, and why not — asks the server nothing.
 *   update:  sent once; believed once the playlist reads back smart with the new order and the same genres. Never
 *            run nor captured before this test.
 *
 * Only a Focus this test can carry over whole is sent: the parameters replace it. Each in its turn with reads,
 * hearts and searches.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, smartPlaylistArgs } = require("./methods");
const { BinaryWriter } = require("./wire");
const { allPlaylists, isSmart, playlistsNow } = require("./playlists");
const { readList, focusFields, genreList } = require("./focus");
const { ORDERING } = require("./focus-map");

/**
 * An update's form, varied by hand to find what the server refuses (§12.10): parameters left out (`omit`), or the
 * playlist's own carried over (`carry`). One list, the route's and the updater's.
 */
const OMITTABLE = Object.freeze(["playlistId", "profile"]);
const CARRIABLE = Object.freeze(["description", "folder"]);
/** The orders this test sends (§12.9). */
const UPDATE_SORTS = Object.freeze(["album", "artist", "year", "random"]);

/** The Focus members this test carries over (their values as read), or leaves to the server's default. */
const CARRIED = new Set(["Ordering", "UiLanguage", "GenresMode", "LabelsMode", "LanguagePreferences", "RequireGenreObjects", "ExcludeGenreObjects"]);
/** @param {string} k */
const short = (k) => k.slice(k.lastIndexOf("::") + 2);
/** A member left at its default: not stopping a carry-over. @param {any} v */
const isDefault = (v) => v === false || v === 0 || v === null || v === undefined || v === "";

/**
 * @typedef {{ name: string, oid: bigint }} Genre
 * @typedef {{ require: Genre[], exclude: Genre[], genresMode: number, ordering: number | null, direction: number | null,
 *             languages: string[] | null }} Focus
 */

/**
 * A smart playlist's album Focus as this test reads it: its genres (each a GenreLite sent, by reference), how they combine,
 * its order, and its languages; or what stops it being carried over whole.
 * @param {any} graph @param {any} p  the Playlist object
 * @returns {{ focus: Focus } | { why: string[] }}
 */
function readFocus(graph, p) {
  const f = focusFields(graph, p);
  if (!f) return { why: ["Its Focus hasn't been sent, or isn't an album Focus."] };
  // A null reference is no track Focus (the review).
  if (field(p, "TrackCriteria") != null) return { why: ["It carries a track Focus, which this test doesn't carry over."] };
  /** @type {string[]} */
  const why = [];
  const require = genreList(graph, f, "RequireGenreObjects"), exclude = genreList(graph, f, "ExcludeGenreObjects");
  // A genre list there and not read is not an empty one: sent as empty, it would change what the playlist holds (the review).
  if (!require) why.push("Its RequireGenreObjects couldn't be read whole.");
  if (!exclude) why.push("Its ExcludeGenreObjects couldn't be read whole.");
  /** @type {Focus} */
  const focus = { require: require || [], exclude: exclude || [], genresMode: 0, ordering: null, direction: null, languages: null };
  for (const k of Object.keys(f).filter((x) => x !== "$type")) {
    const name = short(k), v = f[k];
    if (name === "RequireGenreObjects" || name === "ExcludeGenreObjects") continue;
    const list = Buffer.isBuffer(v) ? readList(graph, k, v) : null;
    if (list && !list.whole) { why.push(`Its ${name} didn't read whole.`); continue; }
    if (name === "GenresMode") focus.genresMode = Number(v) || 0;
    else if (name === "LanguagePreferences") focus.languages = list ? list.items.map(String) : null;
    else if (name === "Ordering" && v && typeof v === "object") {
      // A member at its default (0) is left out of a value object (§12.13: Folk by artist read back `{ Direction: 1 }`
      // alone): in an AlbumQueryOrdering decoded, its absence is that 0 — Artist, Default — never "unknown". Anything
      // else (a type not known, a reference) isn't one read, and stays unknown (the review).
      const decoded = typeof v.$type === "string" && v.$type.endsWith(".AlbumQueryOrdering");
      const ord = Object.keys(v).find((x) => short(x) === "Ordering"), dir = Object.keys(v).find((x) => short(x) === "Direction");
      focus.ordering = ord ? Number(v[ord]) : decoded ? 0 : null;
      focus.direction = dir ? Number(v[dir]) : decoded ? 0 : null;
    } else if (!CARRIED.has(name) && (list ? (list.count || 0) > 0 : !isDefault(v))) {
      why.push(`Its Focus holds ${name}, which this test doesn't carry over.`);
    }
  }
  if (!why.length && !focus.require.length && !focus.exclude.length) why.push("Its Focus holds no genre (this test changes a Focus of genres).");
  return why.length ? { why } : { focus };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           profile: () => string | null, log?: (line: string) => void, settleMs?: number }} deps
 */
function createSmartUpdater(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 15000;
  let busy = false;
  /** The names an update was sent for and not shown: none is sent again until Rouen restarts (§12.9). */
  const unsure = new Set();

  /**
   * The smart playlist of that name, its Focus, and the order asked for; or why not.
   * @param {string} name @param {string} sort @param {string} dir
   */
  function plan(name, sort, dir) {
    const at = playlistsNow(deps);
    if ("notSent" in at) return { why: [at.notSent] };
    const same = at.all.playlists.filter((x) => field(x, "Name") === name);
    if (!same.length) return { why: [`Your server has no playlist named "${name}".`] };
    if (same.length > 1) return { why: [`Your server has ${same.length} playlists named "${name}"; Rouen can't tell them apart.`] };
    const p = same[0];
    if (!isSmart(p)) return { why: [`"${name}" isn't a smart playlist.`] };
    // Its own key only: "constructor" is no order (the review).
    // The four §12.9 tries by hand; focus-map's later sorts (§12.15) are the make's, not this test's (the review).
    const ordering = UPDATE_SORTS.includes(sort) ? /** @type {any} */ (ORDERING)[sort] : undefined;
    if (ordering === undefined) return { why: [`"${sort}" isn't an order this test sends (album, artist, year or random).`] };
    // The parameters name a Profile: the playlist's own, or it isn't sent (the review: a playlist of another profile).
    const owner = field(p, "Profile");
    if (isRef(owner) && owner.$ref !== at.profile.oid) return { why: [`"${name}" belongs to another profile than the one chosen in Settings → Native mode.`] };
    const id = field(p, "PlaylistId");
    if (!Buffer.isBuffer(id)) return { why: ["Your server sent the playlist without its id."] };
    const read = readFocus(at.s.graph, p);
    if ("why" in read) return { why: read.why };
    const direction = dir === "desc" ? 2 : 1;
    // An order it has already would read back "updated" whatever the server did: nothing to test (§12.9).
    if (read.focus.ordering === ordering && read.focus.direction === direction) return { why: [`"${name}" is in that order already; ask for another.`] };
    const num = (/** @type {any} */ v) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null);
    return { at, p, id, focus: read.focus, order: { ordering, direction, seed: sort === "random" ? 1 : null },
      counts: { albums: num(field(p, "AlbumCount")), tracks: num(field(p, "TrackCount")) } };
  }
  /** What the page shows of a plan. @param {any} pl */
  const said = (pl) => ({ now: { genres: { require: pl.focus.require.map((/** @type {Genre} */ g) => g.name), exclude: pl.focus.exclude.map((/** @type {Genre} */ g) => g.name) },
    genresMode: pl.focus.genresMode, ordering: pl.focus.ordering, direction: pl.focus.direction, languages: pl.focus.languages, ...pl.counts },
    sending: pl.order,
    notes: pl.focus.languages && pl.focus.languages.length ? [`Its LanguagePreferences (${pl.focus.languages.join(", ")}) is left to your server's default.`] : [] });

  return {
    /** @param {string} name @param {string} sort @param {string} dir @returns {Promise<Record<string, any>>} */
    preview: (name, sort, dir) => deps.inTurn(async () => {
      const pl = plan(name, sort, dir);
      if ("why" in pl) return { updated: false, why: pl.why };
      return Object.assign({ updated: false, wouldUpdate: true, why: [] }, said(pl));
    }),

    /**
     * @param {string} name @param {string} sort @param {string} dir
     * @param {{ omit?: string[], carry?: string[] }} [form]  OMITTABLE left out of the parameters, CARRIABLE carried over (§12.10)
     * @returns {Promise<Record<string, any>>}
     */
    async update(name, sort, dir, form = {}) {
      const omit = (form.omit || []).filter((x) => OMITTABLE.includes(x)), carry = (form.carry || []).filter((x) => CARRIABLE.includes(x));
      // What this try sent, in every answer (§12.10: the answer and the log say it).
      const tried = { omit, carry };
      if (busy) return { updated: false, tried, why: ["An update is already running."] };
      if (unsure.has(name)) return { updated: false, tried, why: [`An update of "${name}" was sent and not shown. Look in Roon: restart Rouen to try again.`] };
      busy = true;
      try {
        const sent = await deps.inTurn(async () => {
          const pl = plan(name, sort, dir);
          if ("why" in pl) return { updated: false, tried, why: pl.why };
          const desc = field(pl.p, "Description"), folder = field(pl.p, "PlaylistFolderId");
          // Its genres and how they combine as it holds them (the review: never Or in place of And), with the new order.
          const params = smartPlaylistArgs(pl.at.s.g, pl.at.profile.oid, name, Object.assign({ genresMode: pl.focus.genresMode,
            require: pl.focus.require.map((/** @type {Genre} */ g) => g.oid), exclude: pl.focus.exclude.map((/** @type {Genre} */ g) => g.oid) }, pl.order),
            omit.includes("playlistId") ? undefined : pl.id, { profile: omit.includes("profile"),
              description: carry.includes("description") ? (typeof desc === "string" ? desc : "") : undefined,
              folder: carry.includes("folder") ? (Buffer.isBuffer(folder) ? folder : null) : undefined });
          const args = Buffer.concat([new BinaryWriter().long(pl.p.oid).toBuffer(), params]);
          log(`updating the smart playlist "${name}": order ${sort}${dir === "desc" ? " descending" : ""}` +
            `${omit.length ? ", leaving out " + omit.join(", ") : ""}${carry.length ? ", carrying over " + carry.join(", ") : ""}`);
          /** @type {{ success: boolean, status?: string }} */
          let res;
          try { res = await pl.at.s.g.call(pl.at.all.svc.oid, SIG.updateSmartPlaylist, args); }
          catch (e) {
            const msg = /** @type {any} */ (e).message;
            unsure.add(name);
            log(`the update of "${name}" failed, with no answer read: ${msg}`);
            return { updated: "unknown", tried, why: ["Your server didn't answer (" + msg + "). Look in Roon before trying again."] };
          }
          if (!res.success) return { updated: false, tried, why: [`Your server refused it ("${res.status}").`] };
          return { pl };
        });
        if (!("pl" in sent)) return sent;
        const pl = /** @type {any} */ (sent.pl);
        const names = (/** @type {Genre[]} */ gs) => gs.map((g) => g.name).sort().join("\n");
        /** It as it reads now, when it shows the order sent and the genres it held. */
        const profileOf = (/** @type {any} */ x) => { const o = field(x, "Profile"); return isRef(o) ? o.$ref : null; };
        const profileBefore = profileOf(pl.p);
        /** The playlist sent, as it reads now (its own object, never another of its name: the review). */
        const shown = await waitFor(settleMs, () => {
          const x = pl.at.s.graph.get(pl.p.oid);
          // Still itself: its name, smart, and its profile kept (the review: a replace may clear what wasn't sent).
          if (!x || !x.loaded || field(x, "Name") !== name || !isSmart(x) || profileOf(x) !== profileBefore) return undefined;
          const r = readFocus(pl.at.s.graph, x);
          // The order AND its direction, the same genres combined the same way (§12.9; the review).
          return r && "focus" in r && r.focus.ordering === pl.order.ordering && r.focus.direction === pl.order.direction
            && r.focus.genresMode === pl.focus.genresMode && names(r.focus.require) === names(pl.focus.require)
            && names(r.focus.exclude) === names(pl.focus.exclude) ? { x, focus: r.focus } : undefined;
        });
        if (!shown) {
          unsure.add(name);
          const all = allPlaylists(pl.at.s);
          const same = all ? all.playlists.filter((y) => field(y, "Name") === name).length : 0;
          log(`the update of "${name}" was taken and not shown within ${settleMs / 1000} s (${same} playlist(s) of that name now)`);
          return { updated: "unknown", tried, why: [same > 1
            ? `Your server took it, and now lists ${same} playlists named "${name}": it may have made a new one. Look in Roon.`
            : "Your server took it, but the playlist didn't read back with the new order, its genres, its name and its profile. Look in Roon before trying again."] };
        }
        const num = (/** @type {any} */ v) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null);
        const albums = num(field(shown.x, "AlbumCount")), tracks = num(field(shown.x, "TrackCount"));
        const before = pl.counts;
        log(`the smart playlist "${name}" updated: ${albums} albums, ${tracks} tracks`);
        return { updated: true, name, tried, ordering: shown.focus.ordering, direction: shown.focus.direction,
          genres: { require: shown.focus.require.map((g) => g.name), exclude: shown.focus.exclude.map((g) => g.name) }, albums, tracks,
          before: { albums: before.albums, tracks: before.tracks } };
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createSmartUpdater, readFocus, OMITTABLE, CARRIABLE };
