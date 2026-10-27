// @ts-check
"use strict";
// An album's version, as its title carries it (v1.9.68-t2, the owner: the Shelf's spine reads "artist, album name,
// album version (deluxe, limited edition etc)"): the trailing parts of a title that name an edition rather than the
// record — "(Deluxe Edition)", "[2011 Remaster]", " - Remastered 2019", "(Super Deluxe) [Live]" — taken off the end
// one by one while each names one. Anything else in brackets stays the title's: "Music for the Masses (Instrumental)"
// is a record of its own, "(What's the Story) Morning Glory?" is a title.

// Words that make a trailing part an edition. Whole words, any case. "Live" is not here: it is a kind of release
// (lib/release-facts.js), shown with the kinds; nor "Mix", which is a record of its own as often as not.
const VERSION_WORDS = /\b(deluxe|edition|editions|remaster|remastered|remasters|remastering|expanded|anniversary|limited|special|collector'?s|bonus|reissue|reissued|version|mono|stereo|legacy|centenary|definitive|super|box\s+set|hi-?res|24[- ]?bit|bit|mqa|sacd|vinyl)\b/i;

/**
 * The title without its version, and the version, when the title ends with one.
 * @param {string | null | undefined} title
 * @returns {{ base: string, version: string } | null}  null when the title names no version (or is only a version)
 */
function splitVersion(title) {
  let rest = String(title || "").trim();
  /** @type {string[]} */
  const parts = [];
  for (let k = 0; k < 4; k++) {
    // a trailing (…) or […], or " - …" after a spaced dash
    const m = /\s*(?:\(([^()]*)\)|\[([^[\]]*)\])\s*$/.exec(rest) || /\s+[-–—]\s+([^-–—]+)$/.exec(rest);
    if (!m) break;
    const inner = (m[1] || m[2] || "").trim();
    if (!inner || !VERSION_WORDS.test(inner)) break;
    parts.unshift(inner);
    rest = rest.slice(0, m.index).trim();
  }
  if (!parts.length || !rest) return null;
  return { base: rest, version: parts.join(" · ") };
}

module.exports = { splitVersion };
