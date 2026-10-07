"use strict";
/*
 * similar.js — acts worth hearing next, given the one that is playing.
 *
 * Ported from MusicD Share Card (Similar.kt). Pure: every function here takes
 * a parsed JSON body and returns a decision. The fetching lives in index.js.
 *
 * ARTISTS, NOT ALBUMS, AND THE NAME OF THE FEATURE IS A COMPROMISE. Nothing
 * keyless does album-to-album similarity. Every route available without a
 * developer account answers "artists like this artist", so what this finds is
 * a handful of acts and then ONE record by each — which is why the row says
 * "If you like this" rather than promising a recommendation engine.
 *
 * DEEZER ONLY, AND THAT IS A DELIBERATE NARROWING OF THE PORT. The original
 * tries ListenBrainz first, keyed on a MusicBrainz artist id, and falls back
 * to Deezer. Its own note on that path reads "this has never once answered in
 * the field", and the dataset name its query needs was never verified from the
 * machine it was written on. Porting a path that has never worked would be
 * porting the appearance of a feature, so this carries the half that does. If
 * ListenBrainz's similar-artists endpoint is ever confirmed working, it slots
 * in ahead of readDeezerArtists with the same shape.
 *
 * NOTHING HERE GOES ON THE CARD. The card is the whole message and what it
 * says is what is playing; a suggestion is the page's business.
 */

const WANTED      = 3;    // acts to suggest
const SEARCH_ROWS = 10;   // artist-search rows to consider
const CANDIDATES  = 3;    // how many of them are worth a second call

/*
 * Whether two act names are the same act. Mirrors index.js's namesOverlap:
 * whole-name containment either way, then a leading "The" discounted.
 *
 * A COPY, AND FOR THE SAME REASON AS lib/wiki-match.js — the rule and the
 * decision it drives belong together, and this module has to be usable without
 * dragging index.js in. The test runs both over one battery.
 */
function normalize(s) {
  return String(s == null ? "" : s).toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function namesOverlap(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return false;
  const pad = s => " " + s + " ";
  if (pad(a).includes(pad(b)) || pad(b).includes(pad(a))) return true;
  const strip = s => s.replace(/^the /, "");
  return strip(a) === strip(b);
}

/**
 * The Deezer artists worth trying for this name, best first.
 *
 * THE NAME GUARD APPLIES TO EVERY ROW, not just the first: a search that
 * returns SOMETHING is not evidence that it returned this act. Deezer answers
 * "Sting" with a dozen tribute acts and covers bands, and taking row one on
 * trust suggests records by whoever happens to rank highest.
 *
 * AN EXACT NAME BEATS A CONTAINING ONE, WHICH IS A DEVIATION FROM THE PORT.
 * The shared namesOverlap() is whole-WORD containment in either direction,
 * because it also has to call "Prince" and "Prince & The Revolution" the same
 * act. That permissiveness lets "Sting Tribute Band" through the guard, and
 * the original then orders purely by follower count — so a tribute act with
 * more followers than the artist would be asked for related acts first. Rare,
 * but the failure is silent and the whole row would be wrong. Exact matches
 * sort ahead of partial ones here; `nb_fan` breaks ties within each group.
 *
 * `nb_fan` is a TIE-BREAK, never the filter — it orders acts that already
 * carry the right name and never promotes one that does not.
 */
function readDeezerArtists(json, artist) {
  const data = (json && Array.isArray(json.data)) ? json.data : null;
  if (!data) return [];
  const out = [];
  for (const a of data) {
    if (!a) continue;
    const id = a.id == null ? null : String(a.id);
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!id || !name) continue;
    if (!namesOverlap(name, artist)) continue;
    out.push({ id, name, fans: Number(a.nb_fan) || 0,
               exact: normalize(name) === normalize(artist) });
  }
  return out.sort((x, y) => (Number(y.exact) - Number(x.exact)) || (y.fans - x.fans));
}

/** Up to WANTED related acts, in Deezer's order, de-duplicated by id. */
function readDeezerRelated(json, wanted) {
  const limit = wanted || WANTED;
  const data = (json && Array.isArray(json.data)) ? json.data : null;
  if (!data) return [];
  const seen = new Set();
  const out = [];
  for (const a of data) {
    if (!a) continue;
    const id = a.id == null ? null : String(a.id);
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, picture: a.picture_medium || a.picture || null });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * One record by an act: their EARLIEST full album.
 *
 * Not their newest and not their most popular. A suggestion is "start here",
 * and a debut is the record that answers that question — where the newest is
 * whatever they happen to have put out, and the most popular is usually a
 * compilation.
 *
 * `record_type` must be "album": Deezer's artist listing mixes in singles and
 * EPs, and a two-track single is not an answer to "what should I hear".
 */
function readDeezerAlbums(json) {
  const data = (json && Array.isArray(json.data)) ? json.data : null;
  if (!data) return { title: null, year: null, cover: null };
  let best = null;
  for (const album of data) {
    if (!album) continue;
    if (String(album.record_type || "").toLowerCase() !== "album") continue;
    const title = typeof album.title === "string" ? album.title.trim() : "";
    if (!title) continue;
    const year = yearOf(album.release_date);
    if (year == null) continue;
    if (!best || year < best.year) {
      best = { title, year, cover: album.cover_medium || album.cover || null };
    }
  }
  return best || { title: null, year: null, cover: null };
}

/** The year from a Deezer "YYYY-MM-DD", or null for anything else. */
function yearOf(releaseDate) {
  const m = /^(\d{4})/.exec(String(releaseDate == null ? "" : releaseDate).trim());
  if (!m) return null;
  const y = Number(m[1]);
  // A release date of 0000-00-00 is Deezer's "we do not know", and a year in
  // the future is a typo in their catalogue rather than a record to recommend.
  if (!Number.isFinite(y) || y < 1900 || y > new Date().getFullYear() + 1) return null;
  return y;
}

/**
 * An act is worth showing even when no record by them could be named — the row
 * degrades to names rather than disappearing.
 */
function toAct(artist, album) {
  return {
    name:  artist.name,
    id:    artist.id,
    album: (album && album.title) || null,
    year:  (album && album.year) || null,
    cover: (album && album.cover) || artist.picture || null,
  };
}

/*
 * ------------------------------------------------------------------------
 * SMART SUGGESTIONS (v1.8.82, from Mandarin v0.7.6 and v0.7.9): weighted by
 * listening, two of three unheard-of.
 *
 * Deezer's related list for the playing act is the pool (RELATED_ROWS of
 * them, not three). Each act in it is scored by where Deezer ranks it for
 * this act AND by how near it sits to what you play: the taste graph, built
 * daily from the related lists of your most-played acts. An act near nothing
 * you play scores next to nothing — which is what keeps a children's act or
 * a wrong-genre act off the row without a genre field to filter on.
 *
 * Three slots: two for acts you have not heard of (not in the library, never
 * played), one for an act you know with a record you don't own — and never
 * an act you play heavily, who needs no introduction. The draw is weighted
 * random among the best, and what was shown is remembered for a month, so
 * the same record shared twice gives a different three.
 * ------------------------------------------------------------------------
 */
const RELATED_ROWS = 20;   // related acts to consider for the playing act
const POOL         = 8;    // the best of them the draw is made from
const UNKNOWN      = 2;    // slots for acts not heard of
const SHOWN_KEEP   = 30;   // acts remembered as shown, per playing act
const MIN_FANS     = 1000; // below this, Deezer's "related" is mostly tribute acts

/** Related acts with what the scoring needs: rank, followers, picture. */
function readDeezerPool(json, limit) {
  const data = (json && Array.isArray(json.data)) ? json.data : null;
  if (!data) return [];
  const seen = new Set();
  const out = [];
  for (const a of data) {
    if (!a) continue;
    const id = a.id == null ? null : String(a.id);
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, rank: out.length, fans: a.nb_fan == null ? null : Number(a.nb_fan) || 0,
               picture: a.picture_medium || a.picture || null });
    if (out.length >= (limit || RELATED_ROWS)) break;
  }
  return out;
}

/**
 * The taste graph: for every act related to something you play, how near it
 * is to your listening, 0..1, and through which of your acts.
 *
 * `seeds` are your played acts as lib/newreleases.js playedArtists lists them
 * ({name, days, last}: distinct days played, last play); `relatedOf(name)`
 * is their related list (synchronous: the caller has them cached). A seed
 * counts for the days it was played, discounted when those plays are old;
 * each related act takes that weight, tapering down its list.
 */
function tasteGraph(seeds, relatedOf, now) {
  now = now || Date.now();
  const g = new Map();
  for (const seed of seeds || []) {
    if (!seed || !seed.name) continue;
    const age = (now - (Number(seed.last) || 0)) / 86400000;
    const recency = age <= 30 ? 1 : age <= 90 ? 0.6 : 0.3;
    const w = Math.max(1, Number(seed.days) || 1) * recency;
    const rel = relatedOf(seed.name) || [];
    rel.forEach((act, i) => {
      if (!act || !act.name) return;
      const key = normalize(act.name);
      if (!key || key === normalize(seed.name)) return;
      const e = g.get(key) || { score: 0, via: [] };
      e.score += w * (1 - i / (2 * Math.max(1, rel.length)));
      if (!e.via.includes(seed.name)) e.via.push(seed.name);
      g.set(key, e);
    });
  }
  let max = 0;
  for (const e of g.values()) if (e.score > max) max = e.score;
  if (max > 0) for (const e of g.values()) e.score /= max;
  return g;
}

/**
 * Score the pool for one share. `known(name)` → "library" | "played" | null;
 * `heavy` is the set of normalized names you play most (never suggested);
 * `shown` the ids shown for this playing act lately; `taste` the graph.
 */
function rankActs(pool, { playing, taste, known, heavy, shown } = {}) {
  taste = taste || new Map();
  known = known || (() => null);
  heavy = heavy || new Set();
  shown = shown || new Set();
  const n = Math.max(1, (pool || []).length);
  const out = [];
  for (const act of pool || []) {
    const key = normalize(act.name);
    if (!key || key === normalize(playing || "")) continue;
    if (heavy.has(key)) continue;
    const t = taste.get(key);
    // Nearness to your listening counts for more than Deezer's rank, and its
    // square root so an act near a lightly played seed still stands well
    // clear of one near nothing you play.
    let score = 0.3 * (1 - act.rank / n) + (t ? Math.sqrt(t.score) : 0);
    if (act.fans != null && act.fans < MIN_FANS) score *= 0.5;
    // Shown lately: behind the others, not out of the running (0.5, Mandarin v0.7.9 —
    // at 0.3 the good ones, once shown, fell below acts near nothing you play).
    if (shown.has(act.id)) score *= 0.5;
    const how = known(act.name);
    out.push(Object.assign({}, act, { score, known: how, near: !!t, via: t ? t.via.slice(0, 2) : [] }));
  }
  return out.sort((a, b) => b.score - a.score);
}

/** A weighted draw: probability rises with the square of the score. */
function draw(list, rnd) {
  let total = 0;
  const w = list.map(x => { const v = Math.max(0.01, x.score) ** 2; total += v; return v; });
  let r = (rnd ? rnd() : Math.random()) * total;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return list.length - 1;
}

/** Three acts from the ranking: UNKNOWN not heard of, one you know, filled from the rest. */
function choose(ranked, { want = WANTED, rnd } = {}) {
  // Acts near what you play first (Mandarin v0.7.9): one near nothing you play — a
  // children's choir on a pop record's related list — only fills a slot the
  // near ones can't. With no listening yet, nothing is near and Deezer's
  // order stands, as before.
  const byNear = list => list.filter(a => a.near).concat(list.filter(a => !a.near));
  const unknown = byNear(ranked.filter(a => !a.known)).slice(0, POOL);
  const familiar = ranked.filter(a => a.known).slice(0, POOL);
  const picks = [];
  const take = (from) => {
    if (!from.length) return false;
    const near = from.some(a => a.near) ? from.filter(a => a.near) : from;
    const pick = near[draw(near, rnd)];
    from.splice(from.indexOf(pick), 1);
    picks.push(pick);
    return true;
  };
  for (let i = 0; i < UNKNOWN && picks.length < want; i++) if (!take(unknown)) break;
  if (picks.length < want) take(familiar);
  while (picks.length < want && (take(unknown) || take(familiar)));
  return picks;
}

/** Why an act is on the row, in a few words. */
function reasonFor(act, playing) {
  if (act.known === "library") return "In your library — a record you don't have";
  if (act.known === "played") return "Something you've played — a record you don't have";
  const via = (act.via || []).filter(v => normalize(v) !== normalize(playing || ""));
  if (via.length >= 2) return `Near ${via[0]} and ${via[1]}, which you play`;
  if (via.length === 1) return `Near ${via[0]}, which you play`;
  return playing ? `Near ${playing}` : "";
}

/**
 * An act's best-known record from their top tracks: the album most of those
 * tracks are from. Not a debut (obscure, or a mis-dated reissue) and not the
 * newest (whatever they happen to have put out).
 */
function readDeezerTop(json) {
  const data = (json && Array.isArray(json.data)) ? json.data : null;
  if (!data) return null;
  const tally = new Map();
  for (const t of data) {
    const al = t && t.album;
    if (!al || al.id == null) continue;
    const id = String(al.id);
    const e = tally.get(id) || { id, title: typeof al.title === "string" ? al.title.trim() : "", cover: al.cover_medium || al.cover || null, n: 0 };
    e.n++;
    tally.set(id, e);
  }
  let best = null;
  for (const e of tally.values()) if (e.title && (!best || e.n > best.n)) best = e;
  return best;
}

/** Every full album from an artist's listing, newest first. */
function readDeezerAlbumList(json) {
  const data = (json && Array.isArray(json.data)) ? json.data : null;
  if (!data) return [];
  const out = [];
  for (const album of data) {
    if (!album || album.id == null) continue;
    if (String(album.record_type || "").toLowerCase() !== "album") continue;
    const title = typeof album.title === "string" ? album.title.trim() : "";
    if (!title) continue;
    out.push({ id: String(album.id), title, year: yearOf(album.release_date), cover: album.cover_medium || album.cover || null });
  }
  return out.sort((a, b) => (b.year || 0) - (a.year || 0));
}

/**
 * The record to name for an act. Unknown act: their best-known (year filled
 * in from the listing). Known act: their newest full album you don't own,
 * else their best-known if you don't own that either.
 */
function recordFor(act, top, albums, ownedTitles, titleKey) {
  // How a title is compared with the library's. index.js passes an
  // edition-blind key, so Deezer's "Rumours (Super Deluxe)" counts as the
  // "Rumours" you own rather than a record you don't have.
  const key = typeof titleKey === "function" ? titleKey : normalize;
  const owned = new Set((ownedTitles || []).map(key));
  const withYear = (a) => { if (!a) return null; const hit = (albums || []).find(x => x.id === a.id); return { title: a.title, year: a.year != null ? a.year : (hit ? hit.year : null), cover: a.cover || (hit ? hit.cover : null) }; };
  if (act.known) {
    const fresh = (albums || []).find(a => a.year != null && !owned.has(key(a.title)));
    if (fresh) return withYear(fresh);
    if (top && !owned.has(key(top.title))) return withYear(top);
    return null;
  }
  return withYear(top) || withYear((albums || [])[0]);
}

module.exports = {
  WANTED, SEARCH_ROWS, CANDIDATES,
  normalize, namesOverlap,
  readDeezerArtists, readDeezerRelated, readDeezerAlbums, yearOf, toAct,
  RELATED_ROWS, POOL, UNKNOWN, SHOWN_KEEP, MIN_FANS,
  readDeezerPool, tasteGraph, rankActs, draw, choose, reasonFor, readDeezerTop, readDeezerAlbumList, recordFor,
};
