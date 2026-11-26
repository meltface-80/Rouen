// @ts-check
"use strict";
/*
 * json.js — a Smart Pick as the screens get it, and the streaming services' favourite ids it is checked against
 * (moved out of index.js unchanged in 2.0.7-t4):
 *
 *   pickJson     one stored pick (smart_picks' row) as GET /api/smart-picks answers it: where it is in the library now
 *                (playable), whether it is on Listen later, whether the service has it as a favourite, and where a tap
 *                goes when the library hasn't it
 *   favourites   the favourite album ids on each connected service; either side failing is null — "not asked" — never
 *                an empty set, which would tell the screens that nothing is added
 */

/**
 * @typedef {{ qobuz: Set<string> | null, tidal: Set<string> | null }} Favs
 * @param {{
 *   libraryRecord: (title: string, artist: string) => any,
 *   laterHas: (title: string, artist: string, rows: any[]) => boolean,
 *   serviceLinks: (row: any, linkOpts: any) => any[],
 *   qobuzReady: () => boolean, tidalReady: () => boolean,
 *   qobuzFavIds: () => { get: () => Promise<Set<string>> }, tidalFavIds: () => { get: () => Promise<Set<string>> },
 *   log?: (line: string) => void,
 * }} d
 *   libraryRecord: the library album a pick names now (index.js smartLibraryRecord); laterHas: on the Listen later list;
 *   serviceLinks: where a tap goes (index.js smartPickServiceLinks); the FavIds: index.js's 60 s caches
 */
function createPickJson(d) {
  const log = d.log || ((/** @type {string} */ line) => { console.error(line); });

  /** @param {any} row @param {Favs} favs @param {any[]} laterRows @param {any} linkOpts */
  function pickJson(row, favs, laterRows, linkOpts) {
    const id  = row.album_id || "";
    const set = row.service === "qobuz" ? favs.qobuz
              : row.service === "tidal" ? favs.tidal : null;
    const rec = d.libraryRecord(row.album, row.artist);
    return {
      kind:    row.kind,
      artist:  row.artist,
      mbid:    row.mbid || null,
      album:   row.album || "",
      album_id: id,
      service: row.service || "",
      image:   row.image || "",
      reason:  row.reason || "",
      genre:   row.genre || "",
      // null (not false) when the service could not be asked, so the client can
      // leave the button alone rather than claiming it is not added.
      added:   set ? set.has(id) : null,
      // In the Roon library right now — playable.
      offset:      rec ? rec.offset : null,
      library_title:    rec ? rec.title : "",
      library_subtitle: rec ? rec.subtitle : "",
      image_key:        rec ? (rec.image_key || null) : null,
      // On the Listen later list (v1.8.67), so the card can say so.
      later:            d.laterHas(row.album || "", row.artist, laterRows),
      // Not in the library: where a tap goes, by the device's default service.
      services:         rec ? [] : d.serviceLinks(row, linkOpts)
    };
  }

  /** The user's current favourite ids on each connected service. @returns {Promise<Favs>} */
  async function favourites() {
    /** @type {Favs} */
    const out = { qobuz: null, tidal: null };
    const jobs = [];
    if (d.qobuzReady()) {
      jobs.push(d.qobuzFavIds().get().then(s => { out.qobuz = s; })
        .catch(e => { log("[picks] Qobuz favourites unavailable: " + e.message); }));
    }
    if (d.tidalReady()) {
      jobs.push(d.tidalFavIds().get().then(s => { out.tidal = s; })
        .catch(e => { log("[picks] TIDAL favourites unavailable: " + e.message); }));
    }
    await Promise.all(jobs);
    return out;
  }

  return { pickJson, favourites };
}

module.exports = { createPickJson };
