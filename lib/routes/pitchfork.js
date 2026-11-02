// @ts-check
"use strict";
/*
 * lib/routes/pitchfork.js — the Pitchfork listing (the side-menu "Pitchfork" page): GET /api/pitchfork/reviews,
 * GET /api/pitchfork/review and the global search's Pitchfork section, moved out of index.js unchanged in
 * v1.9.72-t64 (dev/quality.md, step 5).
 *
 * PRIMARY source (both tabs): the listing pages' server-rendered
 * window.__PRELOADED_STATE__ (/reviews/albums/, /reviews/best/albums/), whose
 * review items carry everything a card needs — title (dangerousHed), artist
 * (subHed.name), numeric score + Best-New-Music flag (ratingValue), square
 * cover art (image.sources) and pubDate. The parse matches items on shape
 * (contentType "review" + ratingValue + url), not a fixed JSON path, so a
 * container reshuffle degrades to an empty list rather than crashing; results
 * are sorted newest-first by pubDate (the walk's traversal order is not the
 * page's display order).
 *
 * FALLBACK (Latest tab only): the RSS album-reviews feed — title/cover/date
 * but no score or artist (artist is derived from the URL slug). Used when the
 * listing yields nothing (blocked or reshaped page). Best New Music has no
 * equivalent feed. If every source fails, the route errors so the UI shows an
 * honest "couldn't load" instead of an empty page.
 *
 * Cached 6h per tab, non-empty results only — Pitchfork publishes only a few
 * reviews a day. Reuses the same spoofed browser UA + 1 req/s throttle as the
 * single-review scraper (index.js's fetchPitchfork).
 *
 * index.js keeps the per-album review behind the album view's extras (fetchPitchfork, parsePitchforkReviewHtml,
 * pitchforkCache) and what it shares with this listing: the 1 req/s throttle (pitchforkWait), the URL slug
 * (slugifyForPitchfork), stripHtml, normalize and the library search. It wires them here (createPitchfork).
 */

/**
 * What the listing uses: index.js's own, by the same names. Every one is a const or a function declaration there.
 * @typedef {object} PitchforkDeps
 * @property {boolean} DEBUG
 * @property {string} BROWSER_UA  the spoofed browser User-Agent the single-review scraper sends too
 * @property {(url: string, headers: Record<string, string>, timeoutMs?: number) => Promise<string>} httpText  lib/http.js
 * @property {() => Promise<void>} pitchforkWait  the 1 req/s throttle shared with index.js's fetchPitchfork
 * @property {(s: any) => string} slugifyForPitchfork
 * @property {(html: any) => string} stripHtml  strips tags and decodes entities
 * @property {(s: any) => string} normalize
 * @property {(query: string, limit: number) => any[]} searchAlbums  the search box's in-memory library search
 * @property {{ albums: any[] }} albumIndex  the library snapshot (index.js's const object, read live)
 */

/**
 * The Pitchfork listing, wired once by index.js.
 * @param {PitchforkDeps} d
 */
function createPitchfork(d) {
  const { DEBUG, BROWSER_UA, httpText, pitchforkWait, slugifyForPitchfork, stripHtml, normalize, searchAlbums,
    albumIndex } = d;
  const PITCHFORK_LIST_TTL   = 6 * 60 * 60 * 1000;
  // Per-tab listing cache. Deliberately NOT makeTtlCache: we must NOT cache an
  // EMPTY result (a parse miss or a served-but-unparseable page), or a recovery
  // would be blocked for the whole TTL. Only non-empty results are stored.
  const pitchforkLists       = new Map();  // type → { at, items }

  const PF_HEADERS = { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" };

  function unCdata(s) {
    return s == null ? s : String(s).replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
  }

  // Best-effort artist name from a review URL when the listing parse didn't give
  // a clean one: the slug is "<artist>-<album>", so strip the known album-slug
  // suffix and title-case what's left. Fallback only — casing is approximate.
  function artistFromReviewUrl(url, albumTitle) {
    const m = /\/reviews\/albums\/([^\/?#]+)/.exec(url || "");
    if (!m) return null;
    let artistSlug = m[1];
    const albumSlug = slugifyForPitchfork(albumTitle || "");
    if (albumSlug && artistSlug.endsWith("-" + albumSlug)) {
      artistSlug = artistSlug.slice(0, artistSlug.length - albumSlug.length - 1);
    }
    const words = artistSlug.split("-").filter(Boolean);
    if (!words.length) return null;
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  // Parse the RSS album-reviews feed → [{ url, album, cover, date }].
  async function fetchPitchforkRss() {
    await pitchforkWait();
    const xml = await httpText("https://pitchfork.com/feed/feed-album-reviews/rss", PF_HEADERS, 15000);
    const items = [];
    const itemRe = /<item\b[\s\S]*?<\/item>/gi;
    let im;
    while ((im = itemRe.exec(xml)) !== null) {
      const block = im[0];
      const pick = (re) => { const x = re.exec(block); return x ? unCdata(x[1]) : null; };
      const link = pick(/<link>([\s\S]*?)<\/link>/i);
      if (!link || !/\/reviews\/albums\//.test(link)) continue;
      // stripHtml entity-decodes internally; decoding FIRST would let an escaped
      // "&lt;em&gt;" in a title turn into a strippable tag and lose literal text.
      const album = stripHtml(pick(/<title>([\s\S]*?)<\/title>/i) || "").trim();
      const cover = (/<media:thumbnail[^>]*\burl=["']([^"']+)["']/i.exec(block) || [])[1] || null;
      const date  = pick(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      if (album) items.push({ url: link.split(/[?#]/)[0], album, cover, date });
    }
    return items;
  }

  // Extract window.__PRELOADED_STATE__ = {...} via brace-matching (a greedy regex
  // can't balance braces reliably on a ~2 MB page).
  function extractPreloadedState(html) {
    const marker = html.indexOf("__PRELOADED_STATE__");
    if (marker === -1) return null;
    const start = html.indexOf("{", marker);
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { if (--depth === 0) return html.slice(start, i + 1); }
    }
    return null;
  }

  // Square cover URL from a listing item's image.sources. lg (~1280px) first —
  // plenty for the biggest mosaic tile without pulling the oversized xxl; then
  // xxl, md, sm as availability fallbacks.
  function pfListingCover(node) {
    const s = node.image && node.image.sources;
    if (!s || typeof s !== "object") return null;
    return (s.lg && s.lg.url) || (s.xxl && s.xxl.url) || (s.md && s.md.url) || (s.sm && s.sm.url) || null;
  }

  // Walk the preloaded state and collect review-listing items. Verified shape
  // (2026): each item has contentType "review", a ratingValue object, a url, the
  // title in dangerousHed (HTML) — bare `hed` only exists nested under `source` —
  // the artist in subHed.name, and square covers under image.sources.{lg,md,sm}.
  // Matching on contentType + ratingValue + url (not a fixed path) keeps it
  // resilient to container reshuffles.
  function collectReviewItems(state) {
    const out = [];
    const seen = new Set();
    const stack = [state];
    let guard = 0;
    while (stack.length && guard++ < 500000) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) { for (const x of node) if (x && typeof x === "object") stack.push(x); continue; }
      if (node.contentType === "review" && node.ratingValue && typeof node.url === "string") {
        const full = (node.url.startsWith("http") ? node.url : "https://pitchfork.com" + node.url).split(/[?#]/)[0];
        if (!seen.has(full)) {
          seen.add(full);
          // Title: dangerousHed (HTML), falling back to source.hed (markdown-ish
          // asterisks) — tested AFTER stripping, so an empty/HTML-only
          // dangerousHed still consults the fallback. Non-strings are ignored
          // rather than stringified ("[object Object]" must never render).
          // stripHtml already entity-decodes, so no extra decode pass.
          let album = "";
          if (typeof node.dangerousHed === "string") album = stripHtml(node.dangerousHed).trim();
          if (!album && node.source && typeof node.source.hed === "string") {
            album = node.source.hed.replace(/\*/g, "").trim();
          }
          const artist = (node.subHed && typeof node.subHed.name === "string") ? node.subHed.name.trim() : null;
          const rv = node.ratingValue;
          const score = (rv.score != null && rv.score !== "") ? parseFloat(rv.score) : null;
          out.push({
            url:            full,
            album,
            artist,
            score:          Number.isFinite(score) ? score : null,
            isBestNewMusic: !!(rv.isBestNewMusic || rv.isBestNewReissue),
            cover:          pfListingCover(node),
            date:           node.pubDate || null
          });
        }
      }
      for (const k in node) { const v = node[k]; if (v && typeof v === "object") stack.push(v); }
    }
    return out;
  }

  async function fetchPitchforkListing(path) {
    await pitchforkWait();
    const html = await httpText("https://pitchfork.com" + path, PF_HEADERS, 15000);
    const raw = extractPreloadedState(html);
    if (!raw) { if (DEBUG) console.error("[pitchfork] no preloaded state in", path); return []; }
    let state;
    try { state = JSON.parse(raw); }
    catch (e) { if (DEBUG) console.error("[pitchfork] state parse failed:", e.message); return []; }
    return collectReviewItems(state);
  }

  function pfItemOut(x) {
    return {
      url:            x.url,
      album:          x.album || "",
      artist:         x.artist || null,
      cover:          x.cover || null,
      score:          x.score != null ? x.score : null,
      isBestNewMusic: !!x.isBestNewMusic,
      date:           x.date || null
    };
  }

  // The listing page carries everything we need (title, artist, score, BNM,
  // square cover), so it's the primary source for both tabs, sorted newest-first
  // by pubDate (the state walk's traversal order is oldest-first — verified
  // against the live pages). For the Latest tab only, if the listing FAILS —
  // network error/403 (the realistic scraper-block case) or a parse that yields
  // nothing — fall back to the RSS feed: covers + title, artist derived from the
  // slug, no score. Best New Music has no equivalent feed. Only when every
  // available source has failed does this throw, so the route 500s and the UI
  // shows an honest "couldn't load" instead of an empty page.
  async function buildPitchforkList(type) {
    if (type === "best") {
      return sortPfNewestFirst(
        (await fetchPitchforkListing("/reviews/best/albums/")).map(pfItemOut).filter(it => it.album));
    }
    let listErr = null;
    let items = [];
    try {
      items = (await fetchPitchforkListing("/reviews/albums/")).map(pfItemOut).filter(it => it.album);
    } catch (e) { listErr = e; /* fall through to the RSS fallback below */ }
    if (items.length) return sortPfNewestFirst(items);
    const rss = await fetchPitchforkRss().catch(e => {
      if (DEBUG) console.error("[pitchfork] rss fallback failed:", e.message);
      return [];
    });
    const out = rss
      .map(r => pfItemOut({ url: r.url, album: r.album, artist: artistFromReviewUrl(r.url, r.album),
                            cover: r.cover, date: r.date }))
      .filter(it => it.album);
    if (!out.length && listErr) throw listErr;   // both sources down — surface the error
    return out;   // RSS document order is already newest-first
  }

  // Stable newest-first sort on ISO pubDate (lexicographic compare is correct
  // for ISO-8601); undated items keep their relative order at the end.
  function sortPfNewestFirst(items) {
    return items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  const pitchforkListPending = new Map();   // type → in-flight build Promise
  async function getPitchforkReviews(type) {
    const hit = pitchforkLists.get(type);
    if (hit && (Date.now() - hit.at) < PITCHFORK_LIST_TTL) return hit.items;
    // In-flight dedup: concurrent cache misses (a tab open racing a global
    // search, or two searches) share one scrape instead of each hitting Pitchfork.
    if (pitchforkListPending.has(type)) return pitchforkListPending.get(type);
    const pending = (async () => {
      try {
        const items = await buildPitchforkList(type);
        // Cache only a non-empty result — an empty list means a parse miss or a
        // served-but-unparseable page, which we want to retry (not lock in for 6h).
        if (items.length) pitchforkLists.set(type, { at: Date.now(), items });
        return items;
      } finally {
        pitchforkListPending.delete(type);
      }
    })();
    pitchforkListPending.set(type, pending);
    return pending;
  }

  // Match the query against the cached review lists (both tabs, deduped by URL).
  // Cold cache triggers ONE shared scrape via the dedup above; a blocked/failed
  // source just yields no Pitchfork section rather than failing the search.
  async function searchPitchforkReviews(q, limit) {
    const nq = normalize(q);
    if (!nq) return [];
    const [latest, best] = await Promise.all([
      getPitchforkReviews("latest").catch(() => []),
      getPitchforkReviews("best").catch(() => [])
    ]);
    const seen = new Set();
    const out = [];
    for (const it of [...latest, ...best]) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      if (normalize(it.album).includes(nq) || normalize(it.artist || "").includes(nq)) {
        out.push(it);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // Confident library match for a review's album/artist, or null. Uses the same
  // in-memory search as the search box, but only accepts the top hit when the
  // album title matches closely (normalized equality or a prefix) so a "Play"
  // button never points at the wrong album.
  function matchLibraryAlbum(album, artist) {
    if (!album || !albumIndex.albums.length) return null;
    const hits = searchAlbums((artist ? artist + " " : "") + album, 3);
    const want = normalize(album);
    if (!want) return null;   // a punctuation-only title normalizes to "" — never match
    for (const h of hits) {
      const got = normalize(h.title);
      if (!got) continue;     // guard: "".startsWith("") etc. would false-match
      if (got === want || got.startsWith(want) || want.startsWith(got)) {
        return { offset: h.offset, title: h.title, subtitle: h.subtitle, image_key: h.image_key };
      }
    }
    return null;
  }

  return {
    /**
     * The listing for one tab ("latest" or "best"), from the 6-hour cache or one shared scrape.
     * @type {(type: string) => Promise<any[]>}
     */
    getPitchforkReviews,
    /**
     * The global search's Pitchfork section: up to `limit` cached reviews whose album or artist matches `q`.
     * @type {(q: string, limit: number) => Promise<any[]>}
     */
    searchPitchforkReviews,
    /**
     * A confident library match for a review's album and artist, or null.
     * @type {(album: string, artist: string) => any}
     */
    matchLibraryAlbum,
    /**
     * GET /api/pitchfork/reviews and GET /api/pitchfork/review, in that order.
     * @param {{ get: Function }} app
     */
    mount(app) {
      // Pitchfork magazine — a browsable listing of recent album reviews or Best New
      // Music (?type=latest|best). See getPitchforkReviews for the data sources.
      app.get("/api/pitchfork/reviews", async (req, res) => {
        const type = req.query.type === "best" ? "best" : "latest";
        try {
          const items = await getPitchforkReviews(type);
          res.json({ type, items });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });

      // Library match for one listing card (so the card's detail view can offer to
      // play the album if it's in the library).
      // COMPLIANCE (UK law): the written review is never served — the client links
      // to pitchfork.com instead. The review page is no longer fetched here AT ALL
      // (score/BNM already ship with the listing items), which also spares
      // pitchfork.com a throttled full-page scrape per detail open. `review` is
      // kept as null so any stale client reading the old shape sees no text.
      app.get("/api/pitchfork/review", (req, res) => {
        let u;
        try { u = new URL(String(req.query.url || "")); } catch (e) { return res.status(400).json({ error: "Invalid url" }); }
        if (u.hostname !== "pitchfork.com" || !u.pathname.startsWith("/reviews/albums/")) {
          return res.status(400).json({ error: "Not a Pitchfork album-review URL" });
        }
        const match = matchLibraryAlbum(String(req.query.album || ""), String(req.query.artist || ""));
        res.json({ review: null, match });
      });
    },
  };
}

module.exports = { createPitchfork };
