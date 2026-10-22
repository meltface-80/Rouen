// @ts-check
"use strict";
/*
 * focus-map.js — N2e-2b (dev/design/native-remote.md §12.7.1, v1.9.53): one of Rouen's Dynamic Playlists as the
 * album Focus of a Roon smart playlist, or what stops it.
 *
 * The owner (§12.6): a Dynamic Playlist that uses anything Roon can't express exactly is not made in Roon, and Rouen
 * says which part. In this test only a genre (included or excluded) and the Album name, Artist, Release date and
 * Random sorts are made; everything else is named as what stops it. The album limit stops it only when it cuts:
 * Roon's smart playlists have none. Rouen's random track order is how it plays, said as "use Shuffle in Roon".
 *
 * Pure: nothing here reads the server or Rouen's settings.
 */

/** Roon's AlbumOrdering for each of Rouen's sorts that maps exactly (the catalogue's enum). */
const ORDERING = Object.freeze({ album: 4, artist: 0, year: 2, random: 7 });
/** Roon's OrderingDirection. */
const ASCENDING = 1, DESCENDING = 2;
/** Rouen's sorts that don't map exactly, and why (§12.7.1). */
const SORT_NOT = Object.freeze({
  added: "its Recently added order (Rouen's added dates are its own, not Roon's)",
  plays: "its Most played order (Rouen's play counts are its own, not Roon's)",
  lastplayed: "its Last played order (Roon has no such album order)",
});
/** Rouen's facets, by what the page calls them, that this test doesn't make. */
const FACET_NOT = Object.freeze({ source: "Source", decade: "Decade", label: "Label", format: "Format", rate: "Sample rate",
  bits: "Bit depth", chan: "Channels", letter: "First letter", added: "Recently added" });

/**
 * @typedef {{ name: string, view?: Record<string, any>, limit?: number, mode?: string, order?: string }} Dynamic
 *   a Dynamic Playlist as Rouen keeps it (settings.json smartPlaylists)
 * @typedef {{ include: string[], exclude: string[], ordering: number, direction: number, seed: number | null, sort: string }} Mapped
 */

/**
 * @param {Dynamic} sp
 * @param {number | null} matched  how many albums its Focus matches in Rouen's library now; null when not yet known
 * @param {string | null} unavailable  why Rouen itself can't use it now (Labels off), or null
 * @returns {{ focus: Mapped, notes: string[] } | { why: string[] }}
 */
function mapFocus(sp, matched, unavailable) {
  const v = sp.view || {};
  /** @type {string[]} */
  const why = [];
  if (unavailable) why.push(unavailable);
  for (const id of Object.keys(FACET_NOT)) {
    const sel = v[id];
    if (Array.isArray(sel) && sel.length) why.push(`its ${/** @type {any} */ (FACET_NOT)[id]} filter (not made in Roon by this test)`);
  }
  const played = String(v.played || "any");
  if (played !== "any") why.push("its Played filter (Rouen's play history is what Rouen saw, not Roon's)");
  const sort = String(v.sort || "album");
  if (/** @type {any} */ (SORT_NOT)[sort]) why.push(/** @type {any} */ (SORT_NOT)[sort]);
  else if (/** @type {any} */ (ORDERING)[sort] === undefined) why.push(`its "${sort}" order (Rouen doesn't know it)`);
  const genres = Array.isArray(v.genre) ? v.genre.map(String) : [];
  const include = genres.filter((g) => !g.startsWith("!"));
  const exclude = genres.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  if (!include.length && !exclude.length) why.push("no genre (this test makes a Dynamic Playlist of genres)");
  const limit = Number.isFinite(sp.limit) ? Number(sp.limit) : null;
  if (matched === null) why.push("Rouen's library isn't read yet, so its album limit can't be checked");
  else if (limit !== null && matched > limit) {
    why.push(`its album limit (Rouen plays ${limit} of the ${matched} albums it matches; Roon's would hold all ${matched})`);
  }
  if (why.length) return { why };
  /** @type {string[]} */
  const notes = [];
  if (sp.order === "random") notes.push("Rouen plays it in random order: in Roon, play it with Shuffle.");
  // Roon's RandomSeed is an int: a seed past it is brought into range, not wrapped to a negative one (the review).
  const seed = Number.isFinite(Number(v.seed)) && Number(v.seed) > 0 ? (Math.floor(Number(v.seed)) % 2147483647) || 1 : 1;
  return { focus: { include, exclude, ordering: /** @type {any} */ (ORDERING)[sort], direction: v.dir === "desc" ? DESCENDING : ASCENDING,
    seed: sort === "random" ? seed : null, sort }, notes };
}

module.exports = { mapFocus, ORDERING };
