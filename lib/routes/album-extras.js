// @ts-check
"use strict";
/*
 * album-extras.js — an album's extras (the year, the review and whose words it is, the label, the places to hear and
 * read about it) and its stored release date. Moved out of index.js in v2.0.3-t5, unchanged (dev/quality.md,
 * "Splitting the monoliths"), and since then each extras answer is timed (lib/share-trace.js): the share card is drawn
 * only once this answers, and nothing said what a slow one had waited on.
 *
 *   GET  /api/album/extras?title=&artist=[&day=1][&for=card]   → { year, release_date, album, artist, links }
 *        and the headers Server-Timing (each step's time) and X-Rouen-Trace (the id GET /api/debug/share-card lists it
 *        under). day=1: the album view, which waits up to ALBUM_PAGE_DAY_WAIT_MS for the day; for=card: the share card.
 *   GET  /api/album/release-date?title=&artist=               → { release_date }   (stored, no lookup)
 *   GET  /api/debug/share-card                                 → { requests: [the last 30 extras answers, newest first] }
 *   POST /api/debug/share-card   { trace, total_ms, … }        → { kept }   the page's own steps for a card
 */

/**
 * @typedef {{
 *   normalize: (s: string) => string,
 *   lookUpAlbumDay: (key: string, title: string, artist: string) => Promise<any>,
 *   fetchAlbumYear: (title: string, artist: string) => Promise<any>,
 *   fetchAlbumBios: (title: string, artist: string) => Promise<any>,
 *   notePageYear: (key: string, year: any) => any,
 *   storedReleaseDate: (key: string) => any,
 *   albumReleaseOf: (al: { title: string, subtitle: string }) => any,
 *   labelDiskCache: Map<string, string>,
 *   TYPE_NAMES: Record<string, string>,
 *   ALBUM_PAGE_DAY_WAIT_MS: number,
 *   loadPersistedSettings: () => any,
 *   enabledServices: (shareLinks: any, st: any) => any,
 *   enabledReviews: (shareLinks: any, st: any) => any,
 *   shareLinks: any,
 *   trace: ReturnType<typeof import("../share-trace").createShareTrace>,
 * }} AlbumExtrasDeps
 */

/** Who asked, from the request: the share card says so; the album view asks for the day. @param {any} q */
function callerOf(q) {
  if (q.for === "card") return "card";
  if (q.day === "1") return "album";
  return "other";
}

/**
 * @param {{ get: Function, post: Function }} app @param {AlbumExtrasDeps} d
 */
function mountAlbumExtras(app, d) {
  const { normalize, trace, notePageYear, storedReleaseDate } = d;
  // The year and the day, each a step of the answer's trace (lib/share-trace.js); the route reads as it did in index.js.
  const fetchAlbumYear = (/** @type {string} */ t, /** @type {string} */ a) => trace.step("year", () => d.fetchAlbumYear(t, a));
  const lookUpAlbumDay = (/** @type {string} */ k, /** @type {string} */ t, /** @type {string} */ a) =>
    trace.step("day", () => d.lookUpAlbumDay(k, t, a));

  // Album metadata extras: release year (MusicBrainz) + bios (Discogs).
  // Frontend passes title and artist so we don't hit Roon twice per modal open.
  app.get("/api/album/extras", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const title  = String(req.query.title  || "");
    const artist = String(req.query.artist || "");
    if (!title) return res.status(400).json({ error: "title query parameter required" });
    const exKey = normalize(title) + "||" + normalize(artist);
    await trace.run({ caller: callerOf(req.query), key: exKey, title, artist }, async (tr) => {
      try {
        // The album VIEW asks for the day (day=1) and is the one screen that shows
        // it; the share card and the other callers get the date without paying for
        // a lookup. Asked alongside everything else, not after it.
        const dayLookup = req.query.day === "1" ? lookUpAlbumDay(exKey, title, artist) : null;
        let [year, bios] = await Promise.all([
          fetchAlbumYear(title, artist),
          d.fetchAlbumBios(title, artist)
        ]);
        // Opportunistically record the year so it feeds the Decade filter too —
        // only where the album has none (notePageYear).
        notePageYear(exKey, year);
        // The day, if it is back in time; if not, it will be on the next open.
        if (dayLookup) {
          await Promise.race([dayLookup, new Promise(r => {
            const t = setTimeout(r, d.ALBUM_PAGE_DAY_WAIT_MS);
            if (t.unref) t.unref();
          })]);
        }
        // Prefer MusicBrainz's first-release year (the album's original release)
        // over Qobuz's edition date, which can be a later reissue.
        if (bios && bios.album && year) bios.album.year = year;
        // Use the canonical label from the scan pipeline so the album modal and the
        // labels browser always agree on which label this album is under.
        const canonLabel = d.labelDiskCache.get(exKey);
        if (canonLabel) {
          if (!bios) bios = { album: null, artist: null };
          if (!bios.album) bios.album = {};
          bios.album.label = canonLabel;
        }
        // Its catalogue number and kind (v1.9.67), beside the label on the page's subtitle line.
        const rel = d.albumReleaseOf({ title, subtitle: artist });
        if (rel && (rel.catno || rel.types.length)) {
          if (!bios) bios = { album: null, artist: null };
          if (!bios.album) bios.album = {};
          if (rel.catno) bios.album.catno = rel.catno;
          if (rel.types.length) bios.album.type = rel.types.map((/** @type {string} */ t) => d.TYPE_NAMES[t] || t).join(" · ");   // its kinds, all of them (t4)
        }
        // Where to hear it and where to read about it. Pure string building, so
        // it costs nothing and rides along on the round trip the card already
        // makes — no second request, and the chips arrive with the card rather
        // than a moment after it.
        //
        // The resolved article and review are handed over when the pipeline above
        // found them, so a chip lands on the actual page rather than on a search
        // for it. `source` is what says which of them bios.album.url IS: the
        // aggregator prefers Pitchfork, then Qobuz, then Wikipedia, and one field
        // carries whichever won.
        const st       = d.loadPersistedSettings();
        const services = d.enabledServices(d.shareLinks, st);
        const reviews  = d.enabledReviews(d.shareLinks, st);
        const links = {
          services: d.shareLinks.serviceLinks(artist, title, {
            locale:  d.shareLinks.localeFromAcceptLanguage(req.headers["accept-language"]),
            enabled: services,
          }),
          reviews: d.shareLinks.reviewLinks(artist, title, {
            enabled: reviews,
            wikipediaUrl:       bios && bios.urls ? bios.urls.wikipediaAlbum  : null,
            pitchforkUrl:       bios && bios.urls ? bios.urls.pitchfork       : null,
            wikipediaArtistUrl: bios && bios.urls ? bios.urls.wikipediaArtist : null,
          }),
        };

        tr.status = "answered";
        res.set("Server-Timing", trace.serverTiming(tr));
        res.set("X-Rouen-Trace", String(tr.id));
        res.json({
          year,
          // The date the Release date sort orders this album by, to the day
          // wherever any source states one (v1.8.62) — what the album page shows.
          release_date: storedReleaseDate(exKey),
          album:  bios ? bios.album  : null,
          artist: bios ? bios.artist : null,
          links
        });
      } catch (e) {
        tr.status = "failed: " + String(e && /** @type {any} */ (e).message || e).slice(0, 80);
        res.status(500).json({ error: /** @type {any} */ (e).message });
      }
    });
  });

  // The release date alone, from what is already stored (v1.8.65). An open album
  // page asks for it when the release days move, so a day found after the page
  // opened — the lookup is waited on for 1.5 s at most — arrives on the page
  // where it is, instead of on the next visit. No lookup and no network: the
  // extras route above is what starts one.
  app.get("/api/album/release-date", (/** @type {any} */ req, /** @type {any} */ res) => {
    const title  = String(req.query.title  || "");
    const artist = String(req.query.artist || "");
    if (!title) return res.status(400).json({ error: "title query parameter required" });
    res.set("Cache-Control", "no-store");
    res.json({ release_date: storedReleaseDate(normalize(title) + "||" + normalize(artist)) });
  });

  // What the last extras answers waited on, and the page's own steps for each card (v2.0.3-t5). The Android app's
  // saved log includes it (dev/design/android-app.md §4.13).
  app.get("/api/debug/share-card", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json({ design: "lib/share-trace.js", requests: trace.recent() });
  });
  app.post("/api/debug/share-card", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json({ kept: trace.client(req.body) });
  });
}

module.exports = { mountAlbumExtras, callerOf };
