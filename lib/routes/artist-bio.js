// @ts-check
"use strict";
/*
 * artist-bio.js — the artist page's header bio (moved out of index.js unchanged in 2.0.5-t1, dev/quality.md, "Splitting
 * the monoliths", step 5).
 *
 *   GET /api/artist-bio?artist=&album=   → { bio: { name, text, source, image } } or { bio: null }
 *
 * Wraps the wall display's validated lookup (Qobuz/Tidal album-matched first, then album-cross-checked Wikipedia) and
 * shares its bounded cache. `album` is one of the artist's own album titles — it pins the artist's identity, exactly as
 * on the display.
 */

/**
 * @param {{ get: Function }} app
 * @param {{ fetchDisplayArtistBio: (artist: string, album: string | null) => Promise<any> }} d  as index.js has it
 */
function mountArtistBio(app, d) {
  app.get("/api/artist-bio", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const artist = (req.query.artist || "").trim();
    const album  = (req.query.album  || "").trim();
    if (!artist) return res.status(400).json({ error: "artist required" });
    try {
      const bio = await d.fetchDisplayArtistBio(artist, album || null);
      if (!bio || !bio.description) return res.json({ bio: null });
      res.json({ bio: {
        name:   bio.name || artist,
        text:   bio.description,
        source: bio.source || "",
        image:  bio.image || null
      }});
    } catch (/** @type {any} */ e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { mountArtistBio };
