// @ts-check
"use strict";
/*
 * debug-discover.js — GET /api/debug/discover?artist=<name> (out of index.js in v1.9.72-t2, behaviour unchanged).
 *
 * What Deezer actually said, and what each rule made of it.
 *
 * THIS EXISTS BECAUSE TWO ROUNDS OF THIS FEATURE HAVE NOW TURNED ON A FIELD
 * NOBODY HAD LOOKED AT. The cover was read from `cover_medium` for five
 * versions without anything ever drawing it, and singles were reported on a
 * screen that filters `record_type === "album"` — both are questions a single
 * look at the payload answers and no amount of reading the code does. It is
 * the same lesson as the waveform probe in v1.8.30: shipping a build to test a
 * hypothesis is the most expensive way to ask a question.
 *
 * Bypasses the cache on purpose — a cached listing is the answer to what
 * Deezer said A WEEK AGO, which is not what anyone is asking when they open
 * this.
 */

/**
 * @param {{ get: Function }} app
 * @param {{ seeds: () => Array<{ name: string, days: number }>, httpJson: (url: string) => Promise<any>,
 *   similar: { SEARCH_ROWS: number, readDeezerArtists: Function }, newRel: { classify: Function, coverOf: Function } }} deps
 */
function mountDebugDiscover(app, deps) {
  app.get("/api/debug/discover", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const artist = String(req.query.artist || "").trim();
    if (!artist) {
      // With no artist, name the ones the build would actually ask about — that
      // is usually the real question ("why is nothing from X on here?").
      return res.json({
        seeds: deps.seeds().map((/** @type {any} */ s) => ({ name: s.name, days_played: s.days })),
        hint: "add ?artist=<name> to see Deezer's rows for one of these",
      });
    }
    try {
      const search = await deps.httpJson("https://api.deezer.com/search/artist?limit=" +
        deps.similar.SEARCH_ROWS + "&q=" + encodeURIComponent(artist));
      const candidates = deps.similar.readDeezerArtists(search, artist);
      const exact = candidates.filter((/** @type {any} */ c) => c.exact);
      /** @type {any} */
      const out = {
        artist,
        matched: candidates.map((/** @type {any} */ c) => ({ name: c.name, id: c.id, exact: c.exact })),
        // The seed match is EXACT here, unlike everywhere else — see
        // discoverArtistReleases for why.
        used: exact.length ? exact[0] : null,
        rows: [],
      };
      if (!exact.length) {
        out.note = "no exact name match on Deezer — this act is skipped";
        return res.json(out);
      }
      const listing = await deps.httpJson("https://api.deezer.com/artist/" +
        encodeURIComponent(exact[0].id) + "/albums?limit=50");
      const rows = (listing && Array.isArray(listing.data)) ? listing.data : [];
      out.row_count = rows.length;
      // Every field the rules read, raw, plus this row's verdict from the SAME
      // classifier the build uses.
      out.rows = rows.map((/** @type {any} */ a) => {
        const v = deps.newRel.classify(a);
        return {
          title:        a && a.title,
          record_type:  a && a.record_type,
          nb_tracks:    a && a.nb_tracks,
          release_date: a && a.release_date,
          cover_fields: a ? {
            cover_medium: !!a.cover_medium, cover_big: !!a.cover_big,
            cover_small: !!a.cover_small, cover_xl: !!a.cover_xl,
            cover: !!a.cover, md5_image: !!a.md5_image,
          } : null,
          cover_used:   a ? deps.newRel.coverOf(a) : null,
          kept:         v.ok,
          rejected_because: v.ok ? null : v.reason,
        };
      });
      const kept = out.rows.filter((/** @type {any} */ r) => r.kept).length;
      out.summary = kept + " of " + rows.length + " rows are albums this screen " +
                    "would consider; the window and the library check are applied after.";
      res.json(out);
    } catch (e) {
      res.status(502).json({ error: /** @type {Error} */ (e).message });
    }
  });
}

module.exports = { mountDebugDiscover };
