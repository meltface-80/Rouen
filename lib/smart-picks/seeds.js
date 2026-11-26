// @ts-check
"use strict";
/*
 * seeds.js — which of your artists Smart Picks starts from (dev/design/smart-picks.md §3, 2.0.6-t22).
 *
 * A user's report (2026-11-26): Smart Picks kept to 1980s pop and soul, under a tenth of their listening. Seeds were
 * the 24 artists with the most plays per album owned, over all time, counting every started track, matched to albums
 * by title (listening.md fixed the counting). Now:
 *
 *   scoreArtists   each artist's score from whole albums played (each 0.5 + 0.5 × 2^(−age/90 days), an album's summed
 *                  then square-rooted, an artist's albums added; nothing divided by albums owned), and the tracks played
 *                  outside any album's run, at most one a day an artist, weighed by age as album plays are, all of an
 *                  artist's together summed, square-rooted and counted a tenth (one track, a tenth of an album play; a
 *                  year of radio never outweighs albums listened to) (§3.1); a famous artist (the hub
 *                  chart) at a quarter (§3.2); each artist's score shared out by its albums' genres (an album in two,
 *                  half each) and decades, and its main genre (where most of it is)
 *   chooseSeeds    the seed slots shared out by genre in proportion to the listening (each album's counted once, however
 *                  many artists it credits; a genre at 5% or more has one at least), each genre's filled from the
 *                  artists whose main genre it is, dealt round-robin across decades, highest first (§3.3); topped up with
 *                  the most-owned artists not in the hub chart when listening gives too few (§3.4)
 *
 * Tune (§5, 2.0.7-t1, tune.js) reaches both: the Listening window is scoreArtists' half-life; chooseSeeds takes the
 * genres' and decades' factors (a genre's share × 0, 0.5, 1 or 2; a decade dealt that many times as often, Never: none
 * of its artists), puts More from X first and never makes Never start from X a seed.
 *
 * Pure: the library, the plays, the genres and the years are handed in, so every rule is tested without a database.
 */

const { RUN_GAP_MS } = require("../listening/rule");

const DAY_MS = 24 * 60 * 60 * 1000;
/** The half-life of an album play's extra weight (§3.1: recent listening counts up to twice as much). */
const HALF_LIFE_DAYS = 90;
/** A track played outside any album's run, against a whole album played (§3.1). */
const TRACK_WEIGHT = 0.1;
/** A famous artist's share of its score (§3.2, the owner: "Yes, I think"). */
const HUB_FACTOR = 0.25;
/** A genre with this share of the score or more has a seed at least (§3.3). */
const MIN_SHARE = 0.05;
/** An album with no genre Roon gave. */
const NO_GENRE = "Other";

/**
 * @typedef {{ key: string, title: string, credits: Array<{ canon: string, name: string }>, genres: string[], year: number | null }} Album
 * @typedef {{ key: string, ts: number }} AlbumPlay
 * @typedef {{ key: string | null, artists: Array<{ canon: string, name: string }>, ts: number }} TrackPlay
 * @typedef {{ canon: string, name: string, score: number, raw: number, hub: boolean, owned: number,
 *   albumPlays: number, recentPlays: number, tracks: number, albums: Array<{ title: string, plays: number }>,
 *   genres: Map<string, number>, decades: Map<string, number>, share: Map<string, number>, main: string | null,
 *   ownGenre: string | null, ownDecade: string }} Scored
 *   genres: the artist's score by genre; share: its part of the listening by genre (an album credited to three artists
 *   counts a third to each), what the slots are shared by; ownGenre, ownDecade: the genre and decade most of the
 *   artist's own albums are in, for an artist not played (Tune's Never reaches it too, §5)
 */

/**
 * The weight of one album play `age` ms old. @param {number} age
 * @param {number} [halfLifeDays]  Tune's Listening window (§5); Infinity (All time): 2^0, every play weighs 1
 */
function playWeight(age, halfLifeDays = HALF_LIFE_DAYS) {
  return 0.5 + 0.5 * Math.pow(2, -Math.max(0, age) / (halfLifeDays * DAY_MS));
}

/** @param {number | null} year */
const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 + "s" : "unknown");

/**
 * Every artist of the library, scored (§3.1, §3.2).
 * @param {{ albums: Album[], albumPlays: AlbumPlay[], trackPlays: TrackPlay[], hubs: Set<string>, now: number,
 *   pickKeys?: Set<string>, halfLifeDays?: number }} o  pickKeys: albums Smart Picks put aside, whose tracks say nothing
 *   until they are played whole; halfLifeDays: Tune's Listening window (§5), 90 days when not given
 * @returns {Map<string, Scored>}
 */
function scoreArtists(o) {
  /** @type {Map<string, Album>} */
  const byKey = new Map();
  for (const al of o.albums) if (!byKey.has(al.key)) byKey.set(al.key, al);
  /** @type {Map<string, Scored>} */
  const out = new Map();
  const halfLife = o.halfLifeDays === undefined ? HALF_LIFE_DAYS : o.halfLifeDays;
  const rec = (/** @type {{ canon: string, name: string }} */ a) => {
    let r = out.get(a.canon);
    if (!r) {
      r = { canon: a.canon, name: a.name, score: 0, raw: 0, hub: o.hubs.has(a.canon), owned: 0, albumPlays: 0, recentPlays: 0,
        tracks: 0, albums: [], genres: new Map(), decades: new Map(), share: new Map(), main: null, ownGenre: null, ownDecade: "unknown" };
      out.set(a.canon, r);
    }
    return r;
  };
  /** Each artist's library albums: where a track played from outside the library is filed. @type {Map<string, Album[]>} */
  const owns = new Map();
  for (const al of o.albums) {
    for (const a of al.credits) {
      rec(a).owned++;
      if (!owns.has(a.canon)) owns.set(a.canon, []);
      /** @type {Album[]} */ (owns.get(a.canon)).push(al);
    }
  }
  /**
   * Score `w` of album `al` to artist `r`, by the album's genres and decade; its share of the listening divided by the
   * album's credits. @param {Scored} r @param {Album | undefined} al @param {number} w @param {number} credits
   */
  const add = (r, al, w, credits) => {
    r.raw += w;
    const genres = al && al.genres.length ? al.genres : [NO_GENRE];
    for (const g of genres) {
      r.genres.set(g, (r.genres.get(g) || 0) + w / genres.length);
      r.share.set(g, (r.share.get(g) || 0) + w / genres.length / Math.max(1, credits));
    }
    const d = decadeOf(al ? al.year : null);
    r.decades.set(d, (r.decades.get(d) || 0) + w);
  };

  /** @type {Map<string, { sum: number, n: number, recent: number }>} */
  const perAlbum = new Map();
  for (const p of o.albumPlays) {
    if (!byKey.has(p.key)) continue;
    const a = perAlbum.get(p.key) || { sum: 0, n: 0, recent: 0 };
    a.sum += playWeight(o.now - p.ts, halfLife);
    a.n++;
    if (o.now - p.ts <= HALF_LIFE_DAYS * DAY_MS) a.recent++;
    perAlbum.set(p.key, a);
  }
  for (const [key, a] of perAlbum) {
    const al = /** @type {Album} */ (byKey.get(key));
    const w = Math.sqrt(a.sum);
    for (const c of al.credits) {
      const r = rec(c);
      add(r, al, w, al.credits.length);
      r.albumPlays += a.n;
      r.recentPlays += a.recent;
      r.albums.push({ title: al.title, plays: a.n });
    }
  }

  /** When each album was played whole: a one-track release's track is that album play, not one more. @type {Map<string, number[]>} */
  const playedAt = new Map();
  for (const p of o.albumPlays) { if (!playedAt.has(p.key)) playedAt.set(p.key, []); /** @type {number[]} */ (playedAt.get(p.key)).push(p.ts); }
  /** One track a day an artist, by the local day (§3.1: a burst of it cannot say more). @type {Set<string>} */
  const counted = new Set();
  /** Each artist's tracks played alone, by the album they came from (or none), weighed by age. @type {Map<string, Map<Album | null, number>>} */
  const tracksBy = new Map();
  for (const t of o.trackPlays) {
    if (t.key && o.pickKeys && o.pickKeys.has(t.key) && !perAlbum.has(t.key)) continue;   // a pick being tried
    if (t.key && (playedAt.get(t.key) || []).some((ts) => Math.abs(ts - t.ts) <= RUN_GAP_MS)) continue;
    const day = new Date(t.ts).toDateString();
    for (const a of t.artists) {
      if (!out.has(a.canon)) continue;   // only the library's artists seed
      const k = a.canon + "|" + day;
      if (counted.has(k)) continue;
      counted.add(k);
      rec(a).tracks++;
      if (!tracksBy.has(a.canon)) tracksBy.set(a.canon, new Map());
      const m = /** @type {Map<Album | null, number>} */ (tracksBy.get(a.canon));
      const al = (t.key && byKey.get(t.key)) || null;
      m.set(al, (m.get(al) || 0) + playWeight(o.now - t.ts, halfLife));
    }
  }
  // All of an artist's together, as one album's plays are: summed, square-rooted, and a tenth of that (one track, a
  // tenth of an album play; a year of them, a tenth of an album played a year's worth). A track from outside the
  // library is filed by the artist's own library albums, not under "Other".
  for (const [canon, m] of tracksBy) {
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    const scaled = TRACK_WEIGHT * Math.sqrt(total);
    const r = /** @type {Scored} */ (out.get(canon));
    for (const [al, v] of m) {
      const part = scaled * v / total;
      if (al) { add(r, al, part, al.credits.length); continue; }
      const mine = owns.get(canon) || [];
      if (!mine.length) { add(r, undefined, part, 1); continue; }
      for (const own of mine) add(r, own, part / mine.length, own.credits.length);
    }
  }

  for (const r of out.values()) {
    const f = r.hub ? HUB_FACTOR : 1;
    r.score = r.raw * f;
    if (f !== 1) {
      for (const [g, v] of r.genres) r.genres.set(g, v * f);
      for (const [g, v] of r.share) r.share.set(g, v * f);
      for (const [d, v] of r.decades) r.decades.set(d, v * f);
    }
    const top = [...r.genres].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    r.main = top && top[1] > 0 ? top[0] : null;
    /** @type {Map<string, number>} */
    const g = new Map();
    /** @type {Map<string, number>} */
    const dec = new Map();
    for (const own of owns.get(r.canon) || []) {
      for (const x of own.genres.length ? own.genres : [NO_GENRE]) g.set(x, (g.get(x) || 0) + 1);
      dec.set(decadeOf(own.year), (dec.get(decadeOf(own.year)) || 0) + 1);
    }
    const most = (/** @type {Map<string, number>} */ m) => { const e = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]; return e ? e[0] : null; };
    r.ownGenre = most(g);
    r.ownDecade = most(dec) || "unknown";
    r.albums.sort((x, y) => y.plays - x.plays || (x.title < y.title ? -1 : 1));
  }
  return out;
}

/**
 * The seed slots shared out by genre: each in proportion to its share of the score, a genre at MIN_SHARE or more
 * with one at least, the rest by the largest remainders; never more than a genre has artists to fill.
 * @param {Map<string, number>} totals  genre → score  @param {Map<string, number>} room  genre → artists it has
 * @param {number} cap
 */
function shareSlots(totals, room, cap) {
  const sum = [...totals.values()].reduce((s, v) => s + v, 0);
  /** @type {Map<string, number>} */
  const slots = new Map();
  if (!sum || cap <= 0) return slots;
  const genres = [...totals.keys()].sort((a, b) => /** @type {number} */ (totals.get(b)) - /** @type {number} */ (totals.get(a)) || (a < b ? -1 : 1));
  const exact = new Map(genres.map((g) => [g, /** @type {number} */ (totals.get(g)) / sum * cap]));
  for (const g of genres) {
    const min = /** @type {number} */ (totals.get(g)) / sum >= MIN_SHARE ? 1 : 0;
    slots.set(g, Math.min(Math.max(Math.floor(/** @type {number} */ (exact.get(g))), min), /** @type {number} */ (room.get(g))));
  }
  const used = () => [...slots.values()].reduce((s, v) => s + v, 0);
  // Too many (the minimums): taken back from the genres furthest over their share, never below their minimum.
  while (used() > cap) {
    const g = genres.filter((x) => /** @type {number} */ (slots.get(x)) > 1)
      .sort((a, b) => (/** @type {number} */ (slots.get(b)) - /** @type {number} */ (exact.get(b))) - (/** @type {number} */ (slots.get(a)) - /** @type {number} */ (exact.get(a))))[0];
    if (!g) break;
    slots.set(g, /** @type {number} */ (slots.get(g)) - 1);
  }
  // Still too many (more genres at 5% than slots): the smallest shares give theirs up; the cap is never passed.
  while (used() > cap) {
    const g = genres.filter((x) => /** @type {number} */ (slots.get(x)) > 0).sort((a, b) => /** @type {number} */ (exact.get(a)) - /** @type {number} */ (exact.get(b)))[0];
    slots.set(g, /** @type {number} */ (slots.get(g)) - 1);
  }
  // Too few: to the genres furthest under their share that still have artists.
  for (let guard = 0; used() < cap && guard < cap * 4; guard++) {
    const g = genres.filter((x) => /** @type {number} */ (slots.get(x)) < /** @type {number} */ (room.get(x)))
      .sort((a, b) => (/** @type {number} */ (exact.get(b)) - /** @type {number} */ (slots.get(b))) - (/** @type {number} */ (exact.get(a)) - /** @type {number} */ (slots.get(a))))[0];
    if (!g) break;
    slots.set(g, /** @type {number} */ (slots.get(g)) + 1);
  }
  return slots;
}

/** An artist's decade: the one it is most played in. @param {Scored} r */
const decadeOfArtist = (r) => (r.decades.size ? [...r.decades].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : "unknown");

/**
 * @typedef {{ genre: (g: string) => number, decade: (d: string) => number, more: string[], never: Set<string> }} SeedTune
 * @typedef {Scored & { genre: string | null, decade: string | null, via: "listening" | "owned" | "more" }} Seed
 */
/** @type {SeedTune} */
const AS_I_LISTEN = { genre: () => 1, decade: () => 1, more: [], never: new Set() };

/**
 * The seeds: More from X first (Tune, §5), then shared by genre, round-robin across decades, then topped up (§3.3,
 * §3.4). Each seed says which genre it was chosen for and why; `left` are the next artists that scored and were not
 * chosen, for Why these picks (§6).
 * @param {Map<string, Scored>} scored  @param {number} cap  @param {SeedTune} [tune]  tune.js seedTune
 * @returns {{ seeds: Seed[], left: Scored[], slots: Map<string, number> }}
 */
function chooseSeeds(scored, cap, tune) {
  const t = tune || AS_I_LISTEN;
  /** @type {Set<string>} */
  const taken = new Set();
  /** @type {Seed[]} */
  const seeds = [];
  const byName = (/** @type {Scored} */ a, /** @type {Scored} */ b) => (a.canon < b.canon ? -1 : a.canon > b.canon ? 1 : 0);
  // More from X: always a seed, whatever its genre or decade is set to; one no longer in the library can't be.
  for (const canon of t.more) {
    const r = scored.get(canon);
    if (!r || taken.has(canon) || t.never.has(canon) || seeds.length >= cap) continue;
    taken.add(canon);
    seeds.push(Object.assign({}, r, { genre: r.main, decade: r.decades.size ? decadeOfArtist(r) : null, via: /** @type {"more"} */ ("more") }));
  }
  // Never start from X, and every artist whose main genre or decade is set to Never: not a seed by any route.
  // An artist not played (§3.4's top-up) is judged by its own albums' genre and decade.
  const allowed = (/** @type {Scored} */ r) => {
    if (t.never.has(r.canon) || taken.has(r.canon)) return false;
    const g = r.main || r.ownGenre;
    return (!g || t.genre(g) > 0) && t.decade(r.decades.size ? decadeOfArtist(r) : r.ownDecade) > 0;
  };
  const all = [...scored.values()].filter(allowed);
  const listened = all.filter((r) => r.score > 0);
  /** @type {Map<string, number>} */
  const totals = new Map();
  /** @type {Map<string, number>} */
  const room = new Map();
  for (const r of listened) {
    for (const [g, v] of r.share) if (v > 0 && t.genre(g) > 0) totals.set(g, (totals.get(g) || 0) + v * t.genre(g));
    if (r.main) room.set(r.main, (room.get(r.main) || 0) + 1);
  }
  for (const g of totals.keys()) if (!room.has(g)) room.set(g, 0);
  const slots = shareSlots(totals, room, cap - seeds.length);
  for (const g of slots.keys()) {
    let want = /** @type {number} */ (slots.get(g));
    if (!want) continue;
    // The genre's artists by decade (each by the decade it is most played in), each decade highest first.
    /** @type {Map<string, Scored[]>} */
    const byDecade = new Map();
    // A genre's own artists: those whose main genre it is (one stray track elsewhere doesn't take an artist away).
    for (const r of listened) {
      if (r.main !== g || taken.has(r.canon)) continue;
      const d = decadeOfArtist(r);
      if (!byDecade.has(d)) byDecade.set(d, []);
      /** @type {Scored[]} */ (byDecade.get(d)).push(r);
    }
    const gScore = (/** @type {Scored} */ r) => /** @type {number} */ (r.genres.get(g));
    for (const list of byDecade.values()) list.sort((a, b) => gScore(b) - gScore(a) || byName(a, b));
    const decades = [...byDecade.keys()].sort((a, b) =>
      /** @type {Scored[]} */ (byDecade.get(b)).reduce((s, r) => s + gScore(r), 0) - /** @type {Scored[]} */ (byDecade.get(a)).reduce((s, r) => s + gScore(r), 0) || (a < b ? -1 : 1));
    // Each round deals a decade its factor's worth: As I listen one, More two, Less one every other round.
    const left = () => decades.some((d) => /** @type {Scored[]} */ (byDecade.get(d)).some((x) => !taken.has(x.canon)));
    for (let round = 0; want > 0 && seeds.length < cap && left() && round <= cap * 2 + 2; round++) {
      for (const d of decades) {
        const f = t.decade(d);
        let deal = Math.floor((round + 1) * f) - Math.floor(round * f);
        const list = /** @type {Scored[]} */ (byDecade.get(d));
        for (; deal > 0 && want > 0 && seeds.length < cap; deal--) {
          const r = list.find((x) => !taken.has(x.canon));
          if (!r) break;
          taken.add(r.canon);
          seeds.push(Object.assign({}, r, { genre: g, decade: d, via: /** @type {"listening"} */ ("listening") }));
          want--;
        }
      }
    }
  }
  // Slots a genre couldn't fill (its artists were taken by another): the best scored left, whatever their genre.
  for (const r of listened.slice().sort((a, b) => b.score - a.score || byName(a, b))) {
    if (seeds.length >= cap) break;
    if (taken.has(r.canon)) continue;
    taken.add(r.canon);
    seeds.push(Object.assign({}, r, { genre: r.main, decade: null, via: /** @type {"listening"} */ ("listening") }));
  }
  // §3.4: too little listening yet — the most-owned artists not in the hub chart, as before.
  for (const r of all.filter((x) => !x.hub && !taken.has(x.canon)).sort((a, b) => b.owned - a.owned || byName(a, b))) {
    if (seeds.length >= cap) break;
    taken.add(r.canon);
    seeds.push(Object.assign({}, r, { genre: null, decade: null, via: /** @type {"owned"} */ ("owned") }));
  }
  const left = listened.filter((r) => !taken.has(r.canon)).sort((a, b) => b.score - a.score || byName(a, b)).slice(0, 12);
  return { seeds, left, slots };
}

/**
 * What Why these picks shows of a build (§6): the seeds by genre, each with its score and what it came from, the
 * artists that could not be seeds and why, each pick's seeds (for its More / Never), and the Tune in force.
 * Plain values, kept with the day's picks.
 * @param {string} day @param {ReturnType<typeof chooseSeeds>} chosen @param {string[]} noMbid  seeds MusicBrainz could not identify
 * @param {number} at
 * @param {{ halfLifeDays?: number, tuned?: string[], picks?: Array<{ artist: string, seedNames?: string[] }> }} [opts]
 */
function whyOf(day, chosen, noMbid, at, opts) {
  const o = opts || {};
  const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const missing = new Set(noMbid);
  const halfLife = o.halfLifeDays === undefined ? HALF_LIFE_DAYS : o.halfLifeDays;
  return {
    day, at,
    slots: [...chosen.slots].filter(([, n]) => n > 0),
    seeds: chosen.seeds.map((x) => ({ name: x.name, genre: x.genre, decade: x.decade, via: x.via, score: r2(x.score),
      albumPlays: x.albumPlays, recentPlays: x.recentPlays, tracks: x.tracks, hub: x.hub, albums: x.albums.slice(0, 3),
      used: !missing.has(x.name) })),
    left: chosen.left.map((x) => ({ name: x.name, score: r2(x.score), hub: x.hub })),
    picks: (o.picks || []).map((p) => ({ artist: p.artist, seeds: (p.seedNames || []).slice(0, 4) })),
    tuned: o.tuned || [],
    // JSON has no Infinity: All time is said as null.
    numbers: { halfLifeDays: Number.isFinite(halfLife) ? halfLife : null, track: TRACK_WEIGHT, hub: HUB_FACTOR, minShare: MIN_SHARE },
  };
}

module.exports = { scoreArtists, chooseSeeds, shareSlots, whyOf, playWeight, HALF_LIFE_DAYS, TRACK_WEIGHT, HUB_FACTOR, MIN_SHARE, NO_GENRE };
