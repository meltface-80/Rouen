// @ts-check
"use strict";
/*
 * lastfm-similar.js — the album view's Last.fm sections (v1.9.3), moved out of index.js unchanged in v1.9.51
 * (dev/quality.md, step 5).
 *
 *   GET /api/lastfm/similar-artists?artist=   the lead act's similar artists, each told whether the library has them
 *   GET /api/lastfm/similar-albums?artist=    their albums: the library's own record where Roon has it, else Last.fm's page
 */

/**
 * @param {{ get: Function }} app
 * @param {{ key: () => string, lastfm: { similarArtists(a: string): Promise<any>, similarAlbums(a: string, n: number, wanted: () => boolean): Promise<any> },
 *           splitCreditIntoArtists: (credit: string) => string[], lastfmArtistJson: (a: any) => any, lastfmFailure: (e: any) => any,
 *           resolveLibraryAlbum: (title: string, artist: string) => any, slimAlbum: (al: any) => any }} d
 */
function mountLastfmSimilar(app, d) {
  app.get("/api/lastfm/similar-artists", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const credit = String(req.query.artist || "").trim();
    if (!credit) return res.status(400).json({ error: "artist required" });
    if (!d.key()) return res.json({ enabled: false });
    const artist = d.splitCreditIntoArtists(credit)[0] || credit;
    try {
      const sim = await d.lastfm.similarArtists(artist);
      res.json({ enabled: true, artist: sim.artist, url: sim.url,
                 artists: sim.artists.slice(0, 12).map(d.lastfmArtistJson) });
    } catch (e) {
      res.json(d.lastfmFailure(e));
    }
  });

  app.get("/api/lastfm/similar-albums", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const credit = String(req.query.artist || "").trim();
    if (!credit) return res.status(400).json({ error: "artist required" });
    if (!d.key()) return res.json({ enabled: false });
    const artist = d.splitCreditIntoArtists(credit)[0] || credit;
    // A page that has moved on to another album aborts this request. Each of the
    // nine is a call queued behind the last, so a request nobody is waiting for
    // stops asking — or a run of quick swipes would queue ahead of the album on
    // screen for tens of seconds.
    let gone = false;
    res.on("close", () => { if (!res.writableEnded) gone = true; });
    try {
      const r = await d.lastfm.similarAlbums(artist, 9, () => !gone);
      if (gone) return;
      res.json({ enabled: true, albums: r.albums.map((/** @type {any} */ al) => {
        // In the library → it opens there, as Roon names it; otherwise its
        // Last.fm page.
        const rec = d.resolveLibraryAlbum(al.title, al.artist);
        return { title: al.title, artist: al.artist, url: al.url, image: al.image || "",
                 album: rec ? d.slimAlbum(rec) : null };
      }) });
    } catch (e) {
      res.json(d.lastfmFailure(e));
    }
  });
}

module.exports = { mountLastfmSimilar };
