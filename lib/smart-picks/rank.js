// @ts-check
"use strict";
/*
 * rank.js — Smart Picks' candidates: folded from the similar-artist rows, ranked by distance, dealt round-robin over
 * the seeds, and what excludes one; the sentence under a pick (moved out of index.js unchanged in 2.0.6-t22,
 * dev/design/smart-picks.md §8). collectSmartCandidates takes index.js's canonArtist, the one key every exclusion set
 * is built with.
 */

/**
 * @typedef {{ mbid: string, name: string, canon: string, comment: string, score: number, seeds: string[], seedNames: string[] }} Candidate
 */

// Fold similar-artist rows into one entry per candidate, remembering EVERY seed
// each was reached from — that count is the distance signal, so a candidate
// arriving twice must not overwrite itself.
/**
 * @param {Array<{ mbid?: string, name?: string, comment?: string, score: number, seed?: string }> | null | undefined} rows
 * @param {Map<string, string> | null | undefined} seedNameByMbid
 * @param {(name: string) => string} canonArtist  index.js's
 * @returns {Candidate[]}
 */
function collectSmartCandidates(rows, seedNameByMbid, canonArtist) {
  /** @type {Map<string, Candidate>} */
  const byMbid = new Map();
  for (const r of rows || []) {
    if (!r || !r.mbid || !r.name) continue;
    const canon = canonArtist(r.name);
    if (!canon) continue;
    let rec = byMbid.get(r.mbid);
    if (!rec) {
      rec = { mbid: r.mbid, name: r.name, canon, comment: r.comment || "",
              score: 0, seeds: [], seedNames: [] };
      byMbid.set(r.mbid, rec);
    }
    if (r.score > rec.score) rec.score = r.score;
    if (r.seed && rec.seeds.indexOf(r.seed) === -1) {
      rec.seeds.push(r.seed);
      const sn = seedNameByMbid && seedNameByMbid.get(r.seed);
      if (sn) rec.seedNames.push(sn);
    }
  }
  return Array.from(byMbid.values());
}

// Rank by distance from the library rather than by similarity to it.
//
// Fewest connections back first. With a couple of dozen seeds most candidates
// sit in the one-seed bucket, so score decides within it — which is why hub
// candidates have to be filtered out before this runs, or the strongest score
// in that bucket is simply the most famous name in it.
/** @param {Candidate[] | null | undefined} cands */
function rankSmartCandidates(cands) {
  return (cands || []).slice().sort((a, b) =>
    a.seeds.length - b.seeds.length ||
    b.score - a.score ||
    (a.canon < b.canon ? -1 : a.canon > b.canon ? 1 : 0));
}

// Spread the day's picks across DIFFERENT corners of the library.
//
// Ranking alone produces a monoculture, and measurably so: on a test library
// seeded from Bark Psychosis, Slint, Stars of the Lid, Labradford and Tortoise,
// the top five candidates were all neighbours of Stars of the Lid — five
// ambient records that between them said one thing. The distance sort cannot
// prevent that, because once most candidates sit in the one-seed bucket it
// decides on score alone, and the loudest seed owns every slot.
//
// So the ranked list is dealt round-robin: the best candidate from each seed,
// then each seed's second, and so on. Rank order is preserved WITHIN a seed,
// and the seed queues are already in rank order, so the strongest candidate
// overall still comes first — it just no longer brings four relatives with it.
/** @param {Candidate[] | null | undefined} ranked */
function diversifySmartCandidates(ranked) {
  /** @type {Map<string, Candidate[]>} */
  const bySeed = new Map();
  for (const c of ranked || []) {
    // A candidate's first seed is its strongest connection: `seeds` is filled
    // in arrival order from a list the endpoint returns strongest-first.
    const key = (c.seeds && c.seeds[0]) || "";
    if (!bySeed.has(key)) bySeed.set(key, []);
    /** @type {Candidate[]} */ (bySeed.get(key)).push(c);
  }
  const queues = Array.from(bySeed.values());
  const out = [];
  for (let round = 0; ; round++) {
    let moved = false;
    for (const q of queues) {
      if (round < q.length) { out.push(q[round]); moved = true; }
    }
    if (!moved) break;   // every queue exhausted
  }
  return out;
}

// Everything a candidate must not be. Kept as one function so the adjacent and
// every path agrees on what counts as "already known".
/**
 * @param {string} canon
 * @param {{ library: Set<string>, hubs: Set<string>, blocked: Set<string>, seen: Set<string> }} sets
 */
function smartPickExcluded(canon, sets) {
  if (!canon) return true;
  if (sets.library.has(canon)) return true;   // already owned
  if (sets.hubs.has(canon)) return true;      // famous is not a discovery
  if (sets.blocked.has(canon)) return true;   // user said "not for me"
  if (sets.seen.has(canon)) return true;      // shown recently
  return false;
}

// The sentence under a pick. Built from the chain that produced it, so it is
// always true — an LLM would write a nicer one and would sometimes be wrong,
// and a recommendation nobody can check is a recommendation nobody trusts.
/** @param {{ seedNames?: string[] }} rec */
function smartPickReason(rec) {
  const names = (rec.seedNames || []).filter(Boolean);
  if (!names.length) return "Close to what you already listen to";
  if (names.length === 1) return "Because you play " + names[0];
  return "Because you play " + names[0] + " and " + names[1];
}

module.exports = { collectSmartCandidates, rankSmartCandidates, diversifySmartCandidates, smartPickExcluded, smartPickReason };
