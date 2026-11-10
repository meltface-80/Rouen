// @ts-check
"use strict";
/*
 * pitchfork-review.js — a Pitchfork review page read: the review's body, its score and its Best New Music flag. Moved
 * out of index.js in v2.0.3-t12, unchanged but for index.js's stripHtml passed in (dev/quality.md, "Splitting the
 * monoliths"); test/unit/pitchfork-review.test.js.
 */

// Extractor for a Pitchfork review PAGE: the review body from the JSON-LD
// Review block, plus the score / Best-New-Music flag from the inline preloaded
// state. Sole consumer is fetchPitchfork (album extras). The parsed body NEVER
// reaches a client (UK-law compliance — only score/BNM/link are emitted); it
// is read internally by fetchPitchfork's artist-verification guard. The body
// is stripped of HTML but NOT entity-decoded here; the consumer decodes.
/**
 * @param {string} html  the review page
 * @param {(html: string) => string} stripHtml  index.js's
 * @returns {{ description: string | null, score: number | null, isBestNewMusic: boolean }}
 */
function parsePitchforkReviewHtml(html, stripHtml) {
  /** @type {string | null} */
  let description = null;
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj["@type"] === "Review" && obj.reviewBody) {
        description = stripHtml(obj.reviewBody).trim() || null;
        break;
      }
    } catch (e) { /* malformed JSON-LD block — try the next one; loop continues */ }
  }
  /** @type {number | null} */
  let score = null;
  let isBestNewMusic = false;
  const scoreM = html.match(/"musicRating"\s*:\s*\{[^}]*?"score"\s*:\s*(\d+(?:\.\d+)?)/);
  if (scoreM) score = parseFloat(scoreM[1]);
  const bnmM = html.match(/"isBestNewMusic"\s*:\s*(true|false)/);
  if (bnmM) isBestNewMusic = bnmM[1] === "true";
  return { description, score: Number.isFinite(score) ? score : null, isBestNewMusic };
}

module.exports = { parsePitchforkReviewHtml };
