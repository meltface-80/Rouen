// @ts-check
"use strict";
/*
 * debug-dates.js — what the Release date sort knows, album by album (v1.8.61; out of index.js in v1.9.70-t9, behaviour
 * unchanged):
 *
 *   /api/debug/dates              → coverage, services, and the first 40 of the newest-first order
 *   /api/debug/dates?limit=200    → more of that order
 *   /api/debug/dates?q=clinic     → the albums whose title or artist contains "clinic", wherever they sit in the order
 *
 * Each album carries its year and the source that set it, its day and the source that set THAT, the position the sort
 * gives it, its badge, and whether the /music walk and the Qobuz favourites know it — enough to say why any one album
 * sits where it does. Read-only: nothing here asks Roon or anyone else.
 */

/**
 * @typedef {object} DateReportDeps  index.js's, each read as the report is made
 * @property {(s: string) => string} normalize
 * @property {(q: { sort: string, dir: string }) => any[]} libraryView
 * @property {() => { albums: any[] }} albumIndex
 * @property {(al: any) => string} albumYearKey
 * @property {(al: any) => string} albumDateOf
 * @property {Map<string, string>} albumYearCache
 * @property {Map<string, string>} albumDateCache
 * @property {Map<string, string>} albumYearSource
 * @property {Map<string, string>} albumDateSource
 * @property {Map<string, { ts: number, year: any, day: any }>} dateFillTried
 * @property {() => any} roonServices
 * @property {() => boolean} qobuzReady
 * @property {() => boolean} tidalReady
 * @property {() => any} claimingServices
 * @property {() => boolean} fileScanRunning
 * @property {() => { running: boolean, lastKick: number }} dateFill
 * @property {(now: number) => any[]} releaseDayFillCandidates
 * @property {(title: string, subtitle: string, al: any) => any} albumBadge
 * @property {(title: string, subtitle: string, al: any) => any} albumSource
 * @property {() => Set<string>} localAlbumKeys
 * @property {() => Set<string>} qobuzAlbumKeys
 */

/**
 * The report.
 * @param {DateReportDeps} d @returns {(query: any) => any}
 */
function createDateReport(d) {
  return function releaseDateReport(query) {
    const limit = Math.max(1, Math.min(500, parseInt((query && query.limit) || "40", 10) || 40));
    const q = d.normalize(String((query && query.q) || ""));
    const view = d.libraryView({ sort: "year", dir: "desc" });
    const position = new Map(view.map((al, i) => [al, i + 1]));
    const all = d.albumIndex().albums;
    const rows = q ? all.filter((al) => al.nTitle.includes(q) || al.nArtist.includes(q)) : view;
    const coverage = { albums: all.length, to_the_day: 0, to_the_month: 0, year_only: 0, undated: 0 };
    for (const al of all) {
      const key = d.albumYearKey(al);
      const day = d.albumDateCache.get(key);
      if (!d.albumYearCache.get(key)) coverage.undated++;
      else if (day && day.length === 10) coverage.to_the_day++;
      else if (day && day.length === 7) coverage.to_the_month++;
      else coverage.year_only++;
    }
    const iso = (/** @type {number} */ ms) => (ms ? new Date(ms).toISOString() : null);
    const fill = d.dateFill();
    const local = d.localAlbumKeys(), qobuz = d.qobuzAlbumKeys();
    return {
      roon_services: d.roonServices(),
      extension_signed_in: { qobuz: d.qobuzReady(), tidal: d.tidalReady() },
      claiming_services: d.claimingServices(),
      coverage,
      file_walk_running: d.fileScanRunning(),
      // `waiting`: albums still dated only to the year and due a lookup — what a run would ask about if one started
      // now. Zero is "all done".
      day_lookups: { running: fill.running, last_started: iso(fill.lastKick), albums_asked: d.dateFillTried.size,
        waiting: d.releaseDayFillCandidates(Date.now()).length },
      albums: rows.slice(0, limit).map((al) => {
        const key = d.albumYearKey(al);
        const tried = d.dateFillTried.get(key);
        return {
          position: position.get(al) || null,
          title: al.title, artist: al.subtitle,
          year: d.albumYearCache.get(key) || null,
          year_source: d.albumYearSource.get(key) || null,
          date: d.albumDateCache.get(key) || null,
          date_source: d.albumDateSource.get(key) || null,
          sorts_as: d.albumDateOf(al),
          // What the tile shows (nothing, where badges would all say the same), and the answer behind it.
          badge: d.albumBadge(al.title, al.subtitle, al),
          source: d.albumSource(al.title, al.subtitle, al),
          local_file: (al.srcKeys || []).some((/** @type {string} */ k) => local.has(k)),
          qobuz_favourite: (al.srcKeys || []).some((/** @type {string} */ k) => qobuz.has(k)),
          musicbrainz_lookup: tried ? { at: iso(tried.ts), year: tried.year, day: tried.day } : null,
        };
      }),
    };
  };
}

/**
 * @param {{ get: Function }} app @param {DateReportDeps & { ready: () => boolean }} d
 */
function mountDatesDebug(app, d) {
  const report = createDateReport(d);
  app.get("/api/debug/dates", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.ready()) return res.status(503).json({ error: "Library index is not built yet" });
    res.json(report(req.query));
  });
}

module.exports = { createDateReport, mountDatesDebug };
