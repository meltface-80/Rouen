// @ts-check
"use strict";
/*
 * album-search.js — finding an album by name through Roon's official
 * extension API, when the offset an album was opened at no longer holds it
 * (the public provider, dev/design/native-remote.md §3.1). Moved out of
 * index.js unchanged in v1.9.21; what it reads of Rouen's is passed in.
 */

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
    const query = (t + " " + (artist || "")).trim();
    const tN = normalize(t);

    // This resolves which album to PLAY, so a loose match starts the wrong music.
    // The artist (when we know one) must be a credited artist by whole-name
    // equality — a substring test would happily pick Bonnie "Prince" Billy's
    // "1999" for Prince's. With no artist to check against we never guess from
    // an arbitrary result: the caller's stale-offset error is far better than
    // playing an unrelated album.
    const artistOk = (i) => !artist || creditHasArtist(i.subtitle, artist);
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
    const albumFromResults = async (hier) => {
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

    // Primary: the dedicated "search" hierarchy — a documented top-level
    // hierarchy that takes the query as `input` directly at the root, no root
    // crawl needed. (The v1.6.48 attempt crawled the "browse" root for a Search
    // entry and missed 12/12 in production: that root exposes no Search entry
    // on this session. Kept below as the secondary path.)
    try {
      await browse({ hierarchy: "search", input: query, pop_all: true,
                     multi_session_key: sessionKey, zone_or_output_id: zone });
      const hit = await albumFromResults("search");
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
      const hit = await albumFromResults("browse");
      if (hit) return { item: hit, hierarchy: "browse" };
    } catch (e) {
      console.log("[album:search] browse-root lookup failed: " + e.message);
    }
    return null;
  }

  return { findAlbumViaSearch };
}

module.exports = { createAlbumSearch };
