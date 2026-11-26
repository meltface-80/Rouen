// @ts-check
"use strict";
/*
 * rule.js — what counts as a play (dev/design/listening.md §3, the owner, 2026-11-26: "Play 95% of a track should
 * count as a play count").
 *
 * A track is played when the time actually listened (the scrobbler's `heard`: forward steps of under 30 seconds, so a
 * seek is never listening) reaches 95% of its length. Roon reports a zone's position once a second, and the report of
 * a track's last second often never comes before the next track starts, so one second is allowed for it (§3.1).
 */

/** The share of a track that must be heard. */
const PLAYED_SHARE = 0.95;
/** The once-a-second report allowed for, in seconds. */
const REPORT_SLACK_S = 1;
/** A run of an album ends after this long with nothing of it played (§3.2). */
const RUN_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * Was a track played? Seconds heard against its length in seconds; a track with no length (a stream) never is.
 * @param {number} heard @param {number} duration
 */
function trackPlayed(heard, duration) {
  const h = Number(heard) || 0, d = Number(duration) || 0;
  if (d <= 0) return false;
  return h + REPORT_SLACK_S >= d * PLAYED_SHARE;
}

module.exports = { trackPlayed, PLAYED_SHARE, REPORT_SLACK_S, RUN_GAP_MS };
