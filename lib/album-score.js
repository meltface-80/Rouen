// @ts-check
"use strict";
/*
 * album-score.js — how well an album answers a search (moved out of index.js unchanged in 2.0.6-t14, dev/quality.md's
 * move-out). Pure: an album's normalised title and artist, and their tokens, in; a score out. index.js searchAlbums
 * builds them (indexRecord) and ranks by the score.
 */

// Earliest index i where qTokens[k] is a prefix of tokens[i+k] for every k
// (a consecutive run). Returns that start index, or -1.
//   tokens=["the","the"], qTokens=["the","t"]  -> 0   (this is the "The The" case)
/** @param {string[]} tokens @param {string[]} qTokens */
function consecutivePrefixStart(tokens, qTokens) {
  const last = tokens.length - qTokens.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let k = 0; k < qTokens.length; k++) {
      if (!tokens[i + k].startsWith(qTokens[k])) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}
// Every query token is a prefix of some distinct title token (order-independent),
// so "dark moon" still finds "Dark Side of the Moon".
/** @param {string[]} tokens @param {string[]} qTokens */
function allTokensPrefixSomewhere(tokens, qTokens) {
  const used = new Array(tokens.length).fill(false);
  for (const qt of qTokens) {
    let found = false;
    for (let i = 0; i < tokens.length; i++) {
      if (!used[i] && tokens[i].startsWith(qt)) { used[i] = true; found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}
// Loose typo tolerance: all chars of q appear in order within s.
/** @param {string} q @param {string} s */
function isSubsequence(q, s) {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

// Higher score = better match. Title hits outrank artist hits of similar
// quality; exact/prefix outrank substring; fuzzy is a last resort.
/**
 * @param {{ nTitle: string, tTitle: string[], jTitle: string, nArtist: string, tArtist: string[], jArtist: string }} al
 * @param {string} q @param {string[]} qTokens @param {string} qJoined @param {boolean} singleChar
 */
function scoreAlbum(al, q, qTokens, qJoined, singleChar) {
  let s = 0;

  // ---- Title (primary) ----
  if (al.nTitle === q) return 1000;
  if (al.nTitle.startsWith(q)) {
    s = Math.max(s, 920 - Math.min(al.nTitle.length - q.length, 60));
  }
  {
    const start = consecutivePrefixStart(al.tTitle, qTokens);
    if (start === 0)                   s = Math.max(s, 900 - Math.min(al.tTitle.length, 40));
    else if (start > 0 && !singleChar) s = Math.max(s, 820 - start * 4);
  }
  if (al.jTitle.startsWith(qJoined)) {
    s = Math.max(s, 870 - Math.min(al.jTitle.length - qJoined.length, 60));
  }
  if (!singleChar) {
    if (s < 760 && qTokens.length > 1 && allTokensPrefixSomewhere(al.tTitle, qTokens)) {
      s = Math.max(s, 760);
    }
    if (s < 650 && al.nTitle.includes(q)) {
      s = Math.max(s, 650 - Math.min(al.nTitle.indexOf(q), 40));
    }
  }

  // ---- Artist (secondary) ----
  if (al.nArtist) {
    if (al.nArtist === q)         s = Math.max(s, 770);
    if (al.nArtist.startsWith(q)) s = Math.max(s, 740 - Math.min(al.nArtist.length - q.length, 60));
    {
      const start = consecutivePrefixStart(al.tArtist, qTokens);
      if (start === 0)                   s = Math.max(s, 720 - Math.min(al.tArtist.length, 40));
      else if (start > 0 && !singleChar) s = Math.max(s, 660 - start * 4);
    }
    if (al.jArtist.startsWith(qJoined)) s = Math.max(s, 700 - Math.min(al.jArtist.length - qJoined.length, 60));
    if (!singleChar) {
      if (s < 600 && qTokens.length > 1 && allTokensPrefixSomewhere(al.tArtist, qTokens)) s = Math.max(s, 600);
      if (s < 520 && al.nArtist.includes(q)) s = Math.max(s, 520 - Math.min(al.nArtist.indexOf(q), 40));
    }
  }

  // ---- Fuzzy fallback (typos), only for longer queries with no real hit ----
  if (s === 0 && !singleChar && qJoined.length >= 4) {
    if (isSubsequence(qJoined, al.jTitle))       s = 300;
    else if (isSubsequence(qJoined, al.jArtist)) s = 260;
  }

  return s;
}

module.exports = { scoreAlbum, consecutivePrefixStart, allTokensPrefixSomewhere, isSubsequence };
