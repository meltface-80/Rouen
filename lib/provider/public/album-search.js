// @ts-check
"use strict";
/*
 * album-search.js — finding an album by name through Roon's official
 * extension API, when the offset an album was opened at no longer holds it
 * (the public provider, dev/design/native-remote.md §3.1). Moved out of
 * index.js unchanged in v1.9.21; what it reads of Rouen's is passed in.
 */

const { plainCredit } = require("../../roon-direct/find");

/**
 * @param {{ load: Function, browse: Function, normalize: (s: string) => string,
 *           creditHasArtist: (credit: string, artist: string) => boolean, zones: () => Record<string, any> }} deps
 */
function createAlbumSearch(deps) {
  // Resolve an album LIVE by name via Roon's own browse "search" hierarchy —
  // offset-free and always current. Used as the fallback when a tile's stored
  // offset is stale (the snapshot hasn't caught up to a Roon library change), so
  // playback never fails just because the index is old. Returns { item, hierarchy }
  // — the matching album item plus the hierarchy it was found in ("search" or
  // "browse"; drill item_key there for tracks + the Play action) — or null when
  // the album genuinely isn't in the library.
  async function findAlbumViaSearch(sessionKey, title, artist, zoneId) {
    const { load, browse, normalize, creditHasArtist } = deps, zones = deps.zones();
    const t = (title || "").trim();
    if (!t) return null;
    // Roon's search is ZONE-scoped and the zone is required for the later play
    // action — use the play zone, or any live zone as context when opening
    // detail without one.
    const zone  = zoneId || Object.keys(zones)[0] || undefined;
    const tN = normalize(t);

    // This resolves which album to PLAY, so a loose match starts the wrong music.
    // The artist (when we know one) must be a credited artist by whole-name
    // equality — a substring test would happily pick Bonnie "Prince" Billy's
    // "1999" for Prince's. With no artist to check against we never guess from
    // an arbitrary result: the caller's stale-offset error is far better than
    // playing an unrelated album.
    // A catalogue album's credit comes with each artist as a link, "[[4707962|Count Basie Orchestra]]" (find.js
    // plainCredit; the library's come plain): matched by the names alone (2.0.6-t16). Unread, no catalogue album, so
    // no suggestion not in the library, ever matched (the owner, 2026-11-24: "April In Paris", The Count Basie Orchestra).
    const artistOk = (i) => !artist || creditHasArtist(plainCredit(String(i.subtitle || "")), artist);
    // Exact title always outranks a loose one — otherwise "Live" could beat an
    // exact "Live at Leeds" just because the loose row's credit matched first.
    // A title that normalises to nothing ("+", "=", "στίγμα", v1.9.21) is
    // matched by its own string, and never loosely: "" is in every title.
    const sameTitle = (i) => (tN ? normalize(i.title) === tN : String(i.title || "").trim() === t);
    const pickFrom = (list) =>
         list.find(i => sameTitle(i) && artistOk(i))
      || (!artist ? list.find(sameTitle) : null)
      || (tN ? list.find(i => { const n = normalize(i.title); return n && (n.includes(tN) || tN.includes(n)) && artistOk(i); }) : null)
      || null;

    // Load the current search-result level, drill its Albums section, match by
    // name. Shared by both lookup paths; every stage logs unconditionally so a
    // miss pinpoints the failing step in the log.
    const albumFromResults = async (hier, query) => {
      const results = await load({ hierarchy: hier, offset: 0, count: 100, multi_session_key: sessionKey });
      const sections = results.items || [];
      const albumsSection = sections.find(sec => /album/i.test(sec.title || "") && sec.item_key);
      if (!albumsSection) {
        console.log("[album:search] no Albums section in " + hier + " results for " + JSON.stringify(query) +
                    "; sections=" + JSON.stringify(sections.slice(0, 8).map(sec => sec.title)));
        return null;
      }
      await browse({ hierarchy: hier, multi_session_key: sessionKey, item_key: albumsSection.item_key });
      const albs = await load({ hierarchy: hier, offset: 0, count: 50, multi_session_key: sessionKey });
      const hit = pickFrom(albs.items || []);
      if (!hit || !hit.item_key) {
        console.log("[album:search] no album match for " + JSON.stringify(t) + " among " +
                    JSON.stringify((albs.items || []).slice(0, 6).map(i => i.title)));
        return null;
      }
      console.log("[album:search] resolved " + JSON.stringify(t) + " -> " + JSON.stringify(hit.title) +
                  " / " + JSON.stringify(hit.subtitle) + " via " + hier);
      return hit;
    };

    // One search, by both paths. @param {string} query
    const lookup = async (query) => {
      // Primary: the dedicated "search" hierarchy — a documented top-level
      // hierarchy that takes the query as `input` directly at the root, no root
      // crawl needed. (The v1.6.48 attempt crawled the "browse" root for a Search
      // entry and missed 12/12 in production: that root exposes no Search entry
      // on this session. Kept below as the secondary path.)
      try {
        await browse({ hierarchy: "search", input: query, pop_all: true,
                       multi_session_key: sessionKey, zone_or_output_id: zone });
        const hit = await albumFromResults("search", query);
        if (hit) return { item: hit, hierarchy: "search" };
      } catch (e) {
        console.log("[album:search] search-hierarchy lookup failed: " + e.message);
      }

      // Secondary: general "browse" root -> Search entry (the now-playing
      // resolver's pattern).
      try {
        await browse({ hierarchy: "browse", pop_all: true, multi_session_key: sessionKey, zone_or_output_id: zone });
        const root = await load({ hierarchy: "browse", offset: 0, count: 100, multi_session_key: sessionKey });
        const items0 = root.items || [];
        const searchItem = items0.find(i => i.input_prompt) || items0.find(i => /search/i.test(i.title || ""));
        if (!searchItem) {
          console.log("[album:search] no Search entry at browse root; root items=" +
                      JSON.stringify(items0.slice(0, 8).map(i => i.title)));
          return null;
        }
        await browse({ hierarchy: "browse", multi_session_key: sessionKey,
                       item_key: searchItem.item_key, input: query, zone_or_output_id: zone });
        const hit = await albumFromResults("browse", query);
        if (hit) return { item: hit, hierarchy: "browse" };
      } catch (e) {
        console.log("[album:search] browse-root lookup failed: " + e.message);
      }
      return null;
    };
    // The title as given; then, when Roon's search finds nothing for it, without a trailing edition in brackets (the
    // owner's server, 2026-11-26: nothing for "Pink Flag (2006 Remastered Version) Wire", the album for "Pink Flag
    // Wire"). The album taken is still matched against the whole title first, as Roon titles it.
    const bare = t.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
    for (const words of bare && bare !== t ? [t, bare] : [t]) {
      const found = await lookup((words + " " + (artist || "")).trim());
      if (found) return found;
    }
    return null;
  }

  return { findAlbumViaSearch };
}

/**
 * An album opened in the level it was found in, and its contents read (2.0.6-t19; out of index.js loadAlbumSession).
 * An album in Roon's search opens a level holding that one album alone, by the same name, and only that opens its
 * tracks and its Play menu (the owner's server, v1.9.39; public/streaming.js enters it the same way). It is entered,
 * once: the album view had opened the level and shown the album itself as its one track, with no way to play it (the
 * owner, 2026-11-24, Eurythmics' "Greatest Hits" from the share card: "Roon offered no playback options").
 * @param {{ browse: Function, load: Function }} deps
 * @param {string} hierarchy @param {string} sessionKey @param {any} albumItem
 * @returns {Promise<{ drill: any, inside: any, albumItem: any }>}  drill: Roon's answer to the opening (not a list: the
 *   caller says why); inside: the album's level, up to 500 rows; albumItem: the album as the level that holds it named it
 */
async function enterAlbum(deps, hierarchy, sessionKey, albumItem) {
  const open = (/** @type {any} */ item) => deps.browse({ hierarchy, item_key: item.item_key, multi_session_key: sessionKey });
  const read = () => deps.load({ hierarchy, offset: 0, count: 500, multi_session_key: sessionKey });
  let drill = await open(albumItem);
  if (drill.action !== "list") return { drill, inside: null, albumItem };
  let inside = await read();
  const only = (inside.items || [])[0];
  const same = (/** @type {any} */ a, /** @type {any} */ b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  if ((inside.items || []).length === 1 && (!inside.list || inside.list.count === 1) && only && only.hint === "list" && only.item_key
      && same(only.title, albumItem.title)) {
    drill = await open(only);
    if (drill.action !== "list") return { drill, inside: null, albumItem: only };
    inside = await read();
    albumItem = only;
  }
  return { drill, inside, albumItem };
}

module.exports = { createAlbumSearch, enterAlbum };
