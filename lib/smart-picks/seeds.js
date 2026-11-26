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
 *                  then square-rooted, an artist's albums added; nothing divided by albums owned), and a tenth for
 *                  each track played outside any album's run, at most one a day an artist (§3.1); a famous artist
 *                  (the hub chart) at a quarter (§3.2); each artist's score shared out by its albums' genres (an album
 *                  in two, half each) and decades
 *   chooseSeeds    the seed slots shared out by genre in proportion to the score (a genre at 5% or more has one at
 *                  least), dealt round-robin across decades within each, highest first (§3.3); topped up with the
 *                  most-owned artists not in the hub chart when listening gives too few (§3.4)
 *
 * Pure: the library, the plays, the genres and the years are handed in, so every rule is tested without a database.
 */

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
 *   genres: Map<string, number>, decades: Map<string, number> }} Scored
 */

/** The weight of one album play `age` ms old. @param {number} age */
function playWeight(age) {
  return 0.5 + 0.5 * Math.pow(2, -Math.max(0, age) / (HALF_LIFE_DAYS * DAY_MS));
}

/** @param {number | null} year */
const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 + "s" : "unknown");

/**
 * Every artist of the library, scored (§3.1, §3.2).
 * @param {{ albums: Album[], albumPlays: AlbumPlay[], trackPlays: TrackPlay[], hubs: Set<string>, now: number,
 *   pickKeys?: Set<string> }} o  pickKeys: albums Smart Picks put aside, whose tracks say nothing until they are played whole
 * @returns {Map<string, Scored>}
 */
function scoreArtists(o) {
  /** @type {Map<string, Album>} */
  const byKey = new Map();
  for (const al of o.albums) if (!byKey.has(al.key)) byKey.set(al.key, al);
  /** @type {Map<string, Scored>} */
  const out = new Map();
  const rec = (/** @type {{ canon: string, name: string }} */ a) => {
    let r = out.get(a.canon);
    if (!r) {
      r = { canon: a.canon, name: a.name, score: 0, raw: 0, hub: o.hubs.has(a.canon), owned: 0, albumPlays: 0, recentPlays: 0,
        tracks: 0, albums: [], genres: new Map(), decades: new Map() };
      out.set(a.canon, r);
    }
    return r;
  };
  for (const al of o.albums) for (const a of al.credits) rec(a).owned++;
  /** Score `w` of album `al` to artist `r`, by the album's genres and decade. @param {Scored} r @param {Album | undefined} al @param {number} w */
  const add = (r, al, w) => {
    r.raw += w;
    const genres = al && al.genres.length ? al.genres : [NO_GENRE];
    for (const g of genres) r.genres.set(g, (r.genres.get(g) || 0) + w / genres.length);
    const d = decadeOf(al ? al.year : null);
    r.decades.set(d, (r.decades.get(d) || 0) + w);
  };

  /** @type {Map<string, { sum: number, n: number, recent: number }>} */
  const perAlbum = new Map();
  for (const p of o.albumPlays) {
    if (!byKey.has(p.key)) continue;
    const a = perAlbum.get(p.key) || { sum: 0, n: 0, recent: 0 };
    a.sum += playWeight(o.now - p.ts);
    a.n++;
    if (o.now - p.ts <= HALF_LIFE_DAYS * DAY_MS) a.recent++;
    perAlbum.set(p.key, a);
  }
  for (const [key, a] of perAlbum) {
    const al = /** @type {Album} */ (byKey.get(key));
    const w = Math.sqrt(a.sum);
    for (const c of al.credits) {
      const r = rec(c);
      add(r, al, w);
      r.albumPlays += a.n;
      r.recentPlays += a.recent;
      r.albums.push({ title: al.title, plays: a.n });
    }
  }

  /** One track a day an artist (§3.1: a burst of it cannot say more). @type {Set<string>} */
  const counted = new Set();
  for (const t of o.trackPlays) {
    if (t.key && o.pickKeys && o.pickKeys.has(t.key) && !perAlbum.has(t.key)) continue;   // a pick being tried
    const day = Math.floor(t.ts / DAY_MS);
    for (const a of t.artists) {
      if (!out.has(a.canon)) continue;   // only the library's artists seed
      const k = a.canon + "|" + day;
      if (counted.has(k)) continue;
      counted.add(k);
      const r = rec(a);
      add(r, t.key ? byKey.get(t.key) : undefined, TRACK_WEIGHT);
      r.tracks++;
    }
  }

  for (const r of out.values()) {
    const f = r.hub ? HUB_FACTOR : 1;
    r.score = r.raw * f;
    if (f !== 1) {
      for (const [g, v] of r.genres) r.genres.set(g, v * f);
      for (const [d, v] of r.decades) r.decades.set(d, v * f);
    }
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
  // Too few: to the genres furthest under their share that still have artists.
  for (let guard = 0; used() < cap && guard < cap * 4; guard++) {
    const g = genres.filter((x) => /** @type {number} */ (slots.get(x)) < /** @type {number} */ (room.get(x)))
      .sort((a, b) => (/** @type {number} */ (exact.get(b)) - /** @type {number} */ (slots.get(b))) - (/** @type {number} */ (exact.get(a)) - /** @type {number} */ (slots.get(a))))[0];
    if (!g) break;
    slots.set(g, /** @type {number} */ (slots.get(g)) + 1);
  }
  return slots;
}

/**
 * The seeds: shared by genre, round-robin across decades, then topped up (§3.3, §3.4). Each seed says which genre it
 * was chosen for and why; `left` are the next artists that scored and were not chosen, for Why these picks (§6).
 * @param {Map<string, Scored>} scored  @param {number} cap
 * @returns {{ seeds: Array<Scored & { genre: string | null, decade: string | null, via: "listening" | "owned" }>,
 *   left: Scored[], slots: Map<string, number> }}
 */
function chooseSeeds(scored, cap) {
  const all = [...scored.values()];
  const listened = all.filter((r) => r.score > 0);
  /** @type {Map<string, number>} */
  const totals = new Map();
  /** @type {Map<string, number>} */
  const room = new Map();
  for (const r of listened) {
    for (const [g, v] of r.genres) {
      if (v <= 0) continue;
      totals.set(g, (totals.get(g) || 0) + v);
      room.set(g, (room.get(g) || 0) + 1);
    }
  }
  const slots = shareSlots(totals, room, cap);
  /** @type {Set<string>} */
  const taken = new Set();
  /** @type {Array<Scored & { genre: string | null, decade: string | null, via: "listening" | "owned" }>} */
  const seeds = [];
  const byName = (/** @type {Scored} */ a, /** @type {Scored} */ b) => (a.canon < b.canon ? -1 : a.canon > b.canon ? 1 : 0);
  const genres = [...slots.keys()];
  for (const g of genres) {
    let want = /** @type {number} */ (slots.get(g));
    if (!want) continue;
    // The genre's artists by decade (each by the decade it is most played in), each decade highest first.
    /** @type {Map<string, Scored[]>} */
    const byDecade = new Map();
    for (const r of listened) {
      if (!((r.genres.get(g) || 0) > 0) || taken.has(r.canon)) continue;
      const d = [...r.decades].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      if (!byDecade.has(d)) byDecade.set(d, []);
      /** @type {Scored[]} */ (byDecade.get(d)).push(r);
    }
    const gScore = (/** @type {Scored} */ r) => /** @type {number} */ (r.genres.get(g));
    for (const list of byDecade.values()) list.sort((a, b) => gScore(b) - gScore(a) || byName(a, b));
    const decades = [...byDecade.keys()].sort((a, b) =>
      /** @type {Scored[]} */ (byDecade.get(b)).reduce((s, r) => s + gScore(r), 0) - /** @type {Scored[]} */ (byDecade.get(a)).reduce((s, r) => s + gScore(r), 0) || (a < b ? -1 : 1));
    for (let round = 0; want > 0; round++) {
      let moved = false;
      for (const d of decades) {
        const list = /** @type {Scored[]} */ (byDecade.get(d));
        const r = list.find((x) => !taken.has(x.canon));
        if (!r || want <= 0) continue;
        taken.add(r.canon);
        seeds.push(Object.assign({}, r, { genre: g, decade: d, via: /** @type {"listening"} */ ("listening") }));
        want--;
        moved = true;
      }
      if (!moved) break;
    }
  }
  // Slots a genre couldn't fill (its artists were taken by another): the best scored left, whatever their genre.
  for (const r of listened.slice().sort((a, b) => b.score - a.score || byName(a, b))) {
    if (seeds.length >= cap) break;
    if (taken.has(r.canon)) continue;
    taken.add(r.canon);
    const g = [...r.genres].sort((a, b) => b[1] - a[1])[0];
    seeds.push(Object.assign({}, r, { genre: g ? g[0] : null, decade: null, via: /** @type {"listening"} */ ("listening") }));
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
 * What Why these picks shows of a build (§6): the seeds by genre, each with its score and what it came from, and the
 * artists that could not be seeds and why. Plain values, kept with the day's picks.
 * @param {string} day @param {ReturnType<typeof chooseSeeds>} chosen @param {string[]} noMbid  seeds MusicBrainz could not identify
 * @param {number} at
 */
function whyOf(day, chosen, noMbid, at) {
  const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const missing = new Set(noMbid);
  return {
    day, at,
    slots: [...chosen.slots].filter(([, n]) => n > 0),
    seeds: chosen.seeds.map((x) => ({ name: x.name, genre: x.genre, decade: x.decade, via: x.via, score: r2(x.score),
      albumPlays: x.albumPlays, recentPlays: x.recentPlays, tracks: x.tracks, hub: x.hub, albums: x.albums.slice(0, 3),
      used: !missing.has(x.name) })),
    left: chosen.left.map((x) => ({ name: x.name, score: r2(x.score), hub: x.hub })),
    numbers: { halfLifeDays: HALF_LIFE_DAYS, track: TRACK_WEIGHT, hub: HUB_FACTOR, minShare: MIN_SHARE },
  };
}

module.exports = { scoreArtists, chooseSeeds, shareSlots, whyOf, playWeight, HALF_LIFE_DAYS, TRACK_WEIGHT, HUB_FACTOR, MIN_SHARE, NO_GENRE };
