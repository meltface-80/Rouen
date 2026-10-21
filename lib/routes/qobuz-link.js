// @ts-check
"use strict";
/*
 * qobuz-link.js — GET /api/qobuz-link?album=&artist=, moved out of index.js unchanged in v1.9.47
 * (dev/quality.md, step 5).
 *
 * The Qobuz link that opens the Qobuz APP, or null.
 *
 * WHY THIS IS A SECOND REQUEST AND NOT PART OF THE LINK ROW. Every other
 * service link is a pure string built from the title and the artist —
 * lib/share-links.js, no network at all. Qobuz is the one that cannot be: a
 * search URL lands on their download store and never opens the app, and only
 * an album ID does (see lib/qobuz-deeplink.js for the full reason). Getting
 * that id costs a page read, so it happens AFTER the row is drawn and never
 * before it: nothing here may hold up a suggestion appearing, and a failure
 * leaves the search link that was already there, which is not nothing.
 *
 * Cached including the misses. A record Qobuz does not carry is a fact about
 * the record, and re-asking every time the same card opens would spend a
 * request to be told so again.
 */

const QOBUZ_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // a catalogue moves, but not in a week
const QOBUZ_LINK_CACHE_MAX = 500;

/**
 * @param {{ get: Function }} app
 * @param {{ normalize: (s: string) => string,
 *           shareLinks: { searchQuery(artist: string, album: string): string | null, qobuzStorefront(locale: any): string,
 *                         localeFromAcceptLanguage(h: any): any, primaryArtist(artist: string): string },
 *           qobuzDeep: { searchUrl(store: string, query: string): string, pickAlbumId(html: string, store: string, artist: string, album: string): string | null,
 *                        deepLink(id: string | null): string | null },
 *           qobuzWait: () => Promise<void>, httpText: (url: string, headers: Record<string, string>) => Promise<string>,
 *           browserUA: string, debug: boolean, now?: () => number }} d
 */
function mountQobuzLink(app, d) {
  const now = d.now || Date.now;
  /** "store|artist|album" -> id or "" @type {Map<string, { at: number, id: string }>} */
  const qobuzLinkCache = new Map();

  /** @param {string} store @param {string} artist @param {string} album */
  async function fetchQobuzAlbumId(store, artist, album) {
    const key = store + "|" + d.normalize(artist || "") + "|" + d.normalize(album || "");
    const hit = qobuzLinkCache.get(key);
    if (hit && (now() - hit.at) < QOBUZ_LINK_TTL_MS) return hit.id || null;

    let id = "";
    try {
      const query = d.shareLinks.searchQuery(artist, album);
      if (query) {
        await d.qobuzWait();
        const html = await d.httpText(d.qobuzDeep.searchUrl(store, query),
          { "User-Agent": d.browserUA, "Accept-Language": "en-US,en;q=0.9" });
        id = d.qobuzDeep.pickAlbumId(html, store, artist, album) || "";
      }
    } catch (e) {
      if (d.debug) console.error("[qobuz-link]", /** @type {any} */ (e).message);
      id = "";
    }

    if (qobuzLinkCache.size >= QOBUZ_LINK_CACHE_MAX) {
      qobuzLinkCache.delete(/** @type {string} */ (qobuzLinkCache.keys().next().value));
    }
    qobuzLinkCache.set(key, { at: now(), id });
    return id || null;
  }

  app.get("/api/qobuz-link", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const album  = String(req.query.album  || "").trim();
    const artist = String(req.query.artist || "").trim();
    if (!album) return res.status(400).json({ error: "album query parameter required" });
    const store = d.shareLinks.qobuzStorefront(
      d.shareLinks.localeFromAcceptLanguage(req.headers["accept-language"]));
    try {
      // The FIRST credited act, the same rule every other link here uses.
      const id = await fetchQobuzAlbumId(store, d.shareLinks.primaryArtist(artist), album);
      res.set("Cache-Control", "public, max-age=604800");
      res.json({ url: d.qobuzDeep.deepLink(id) });
    } catch (e) {
      res.json({ url: null });   // the search link is still there
    }
  });
}

module.exports = { mountQobuzLink };
