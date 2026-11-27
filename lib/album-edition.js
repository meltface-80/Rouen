// @ts-check
"use strict";
/*
 * album-edition.js — an album's title without its edition (2.0.8-t11).
 *
 * Roon's own search finds nothing for a title that carries its edition, and finds the album for the title without it
 * (the owner's server: nothing for "Pink Flag (2006 Remastered Version) Wire" or "The Chameleons Script Of The Bridge
 * - 25th Anniversary Edition", the album for each without its edition). Deezer, asked for a cover, titles them without
 * it too. The owner, 2026-11-27: "Need to normalise the search. Remove things like 25th edition etc and then it finds
 * it." Used where a title is searched for (lib/provider/public/album-search.js) and matched against a cover's
 * (lib/smart-picks/resolve.js); the album found is still matched against its whole title first.
 *
 * Taken off the end, as often as either is there:
 *   - a bracketed chunk: "(2006 Remastered Version)", "[Super Deluxe]", "(30th Anniversary Sessions)";
 *   - a dash and what follows it, ONLY when that names an edition: "- 25th Anniversary Edition", "- Remastered".
 *     "Selected Ambient Works - Volume II" is a different record, not an edition, and stays.
 * The same two rules index.js's albumTitleVariants keys the library by, applied until nothing more comes off. A title
 * that would be left empty ("(Untitled)") is kept whole.
 */

const BRACKETED = /\s*[([][^()[\]]*[)\]]\s*$/;
const EDITION_AFTER_DASH = /\s+[-–—]\s+[^-–—]*\b(remaster(ed)?|deluxe|edition|expanded|anniversary|bonus|reissue|mono|stereo|version|remix(ed)?|legacy)\b[^-–—]*$/i;

/** @param {unknown} title @returns {string} */
function withoutEdition(title) {
  const whole = String(title || "").trim();
  let t = whole;
  for (let i = 0; i < 6; i++) {
    const next = t.replace(BRACKETED, "").replace(EDITION_AFTER_DASH, "").trim();
    if (next === t) break;
    t = next;
  }
  return t || whole;
}

module.exports = { withoutEdition };
