// @ts-check
"use strict";
/*
 * albumsearch.js — is one of these search results the album that is playing?
 *
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License.
 *
 * WHY THIS EXISTS. A streaming waveform needs the service's own album id, and
 * until now the only place one could be had was the user's FAVOURITES. That is
 * a real limit and it was stated honestly — but it means an album played from a
 * search, from an editorial list, or from Roon's own browser has no waveform
 * and never can, however long you wait. A probe run against 11,455 loaded
 * favourites reported `near: []` for the album playing at the time: not spelled
 * differently, not absent by accident — simply never favourited.
 *
 * The catalogue is searchable with the same token that reads the favourites, so
 * the id IS obtainable. What makes it safe to use is the decision below, and
 * what makes it safe to be WRONG is the duration gate downstream: a search hit
 * that is a different pressing fails TM.matchTrack and draws nothing, rather
 * than putting a confident picture of another recording under the seek bar.
 *
 * THE RULE: an exact identity match, and only when exactly one album has it.
 * Qobuz answers a query it cannot place with its nearest guess rather than with
 * nothing (v1.8.36 learned this the expensive way on the share-card links), so
 * "the first result" is never an answer here. Two different albums matching is
 * not a tie to break, it is a question we cannot answer.
 *
 * Pure: identities in, a decision out. The keying is the caller's, because the
 * caller owns the key space and both sides must use the one builder.
 */

/**
 * @param {string[]} wanted     the identity keys for what Roon is playing
 * @param {Array<{id:*, keys:string[]}>} candidates  the search results, keyed
 *        by the SAME builder the favourites index uses
 * @returns {{id:*|null, reason:string}}
 */
function pickAlbumId(wanted, candidates) {
  const want = new Set((Array.isArray(wanted) ? wanted : []).filter(Boolean));
  const list = Array.isArray(candidates) ? candidates : [];
  if (!want.size) return { id: null, reason: "nothing to match on" };
  if (!list.length) return { id: null, reason: "the search returned no albums" };

  // Distinct IDS, not distinct results: a service can return the same album
  // twice (once per credited artist, or across sections), and counting those as
  // two candidates would decline for ambiguity on a perfectly clear answer.
  const hits = new Map();          // id -> the key that matched, for the log
  for (const c of list) {
    if (!c || c.id === undefined || c.id === null || c.id === "") continue;
    for (const k of (Array.isArray(c.keys) ? c.keys : [])) {
      if (want.has(k)) {
        if (!hits.has(c.id)) hits.set(c.id, k);
        break;
      }
    }
  }

  if (!hits.size) {
    return { id: null,
             reason: "none of the " + list.length + " search results is this album " +
                     "(Qobuz answers with its nearest guess, so a result is not a match)" };
  }
  if (hits.size > 1) {
    // Two genuinely different albums under one identity. Picking either is a
    // coin flip, and the cost of losing it is a waveform drawn from the wrong
    // master — which looks authoritative and is a different recording.
    return { id: null,
             reason: hits.size + " different albums match this identity — ambiguous, " +
                     "so no id rather than a guess" };
  }
  const [id, via] = [...hits.entries()][0];
  return { id, reason: 'matched on "' + via + '"' };
}

/** Each service's credited names on an album it returned: the ones an identity key is built with. */
const NAMES_OF = Object.freeze({
  qobuz: (/** @type {any} */ a) => [a.artist && a.artist.name, a.performer && a.performer.name],
  tidal: (/** @type {any} */ a) => [a.artist && a.artist.name, ...(Array.isArray(a.artists) ? a.artists.map((/** @type {any} */ x) => x && x.name) : [])],
});

/**
 * A service's search results as pickAlbumId's candidates: each album's id, and its identity keys —
 * every title form (the caller's: the title, and with its version) with every credited name. One
 * builder for the waveform's Qobuz lookup and Add to library's (v1.9.41), so the two cannot drift.
 * @param {any[]} items  the service's albums, as it sent them
 * @param {(title: string, version: string | null) => string[]} titleForms
 * @param {(title: string, artist: string) => string | null} keyOf
 * @param {(a: any) => Array<string | null | undefined>} namesOf  NAMES_OF's, for the service
 * @returns {Array<{ id: any, keys: string[] }>}
 */
function candidatesOf(items, titleForms, keyOf, namesOf) {
  return (Array.isArray(items) ? items : []).map((a) => ({
    id: a && a.id,
    keys: /** @type {string[]} */ (titleForms(a && a.title, a && a.version)
      .flatMap((t) => namesOf(a || {}).filter(Boolean).map((who) => keyOf(t, /** @type {string} */ (who))))
      .filter(Boolean)),
  }));
}

module.exports = { pickAlbumId, candidatesOf, NAMES_OF };
