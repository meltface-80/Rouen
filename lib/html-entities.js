// @ts-check
"use strict";
/*
 * html-entities.js — an HTML entity decoder for the text Rouen shows from web pages (reviews, bios): moved out of
 * index.js unchanged in 2.0.6-t15 (dev/quality.md's move-out). Pure.
 */

// Decode HTML entities — named (incl. &copy; &reg; &trade;) and numeric
// (&#169; / &#xA9;), with or without the trailing semicolon. Unknown entities
// are left untouched. NOTE: "&copy" reached a share card before because the old
// stripHtml decoded a handful of entities by hand but not this one.
/** @type {Record<string, string>} */
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
  nbsp: " ", hellip: "...", mdash: "\u2014", ndash: "\u2013",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  deg: "\u00B0"
};
/** @param {number} n */
function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ""; }   // a code point past Unicode's: dropped, never thrown
}
/** @param {unknown} input @returns {string} */
function decodeEntities(input) {
  if (!input) return "";
  return String(input)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g,        (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);?/gi, (m, name) => {
      const v = NAMED_ENTITIES[name.toLowerCase()];
      return v !== undefined ? v : m;
    });
}

module.exports = { decodeEntities };
