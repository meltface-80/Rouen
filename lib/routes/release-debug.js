// @ts-check
"use strict";
/*
 * release-debug.js — what Rouen holds of each album's catalogue number and kinds, album by album, and where it
 * came from (v1.9.67-t8, the owner: "give me a debug for a random 100 albums"; dev/design/catalogue.md §4).
 *
 *   GET /api/debug/release-facts            → a random 100 of the library: for each, the title, the artist, the
 *                                             label, what the Shelf shows (the number, the kinds, the source that
 *                                             won) and what each source said (the tags, Discogs, your server)
 *   GET /api/debug/release-facts?n=250      → more of them (up to 1000); ?n=0 for the whole library
 *   GET /api/debug/release-facts?q=warp     → the albums whose title, artist or label contains "warp", in the
 *                                             library's order, up to n (default 100; n=0 all of them)
 *   503 until the library index is built (an empty answer would read as an empty library)
 *
 * No Roon call: it reads the cache (lib/release-facts.js) as the Shelf does. For what your server itself holds of
 * an album, the probe: /api/debug/roon-album-edit-info. Random, so a hundred say what thirteen thousand would.
 */

/**
 * @typedef {{ title: string, subtitle: string }} Album
 * @param {{ get: Function }} app
 * @param {{ ready: () => boolean, albums: () => Album[], keysOf: (al: Album) => string[], labelOf: (al: Album) => string | null,
 *           facts: { forKeys: (keys: string[]) => any, layersOf: (keys: string[]) => any, counts: () => any }, random?: () => number }} d
 *   ready: the library index is built; albums: the library as the Shelf is given it; keysOf: an album's keys, as the cache is looked up; labelOf: its
 *   label as the Shelf names it; facts: the cache; random: Math.random, or a test's
 */
function mountReleaseDebug(app, d) {
  const random = d.random || Math.random;
  app.get("/api/debug/release-facts", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (!d.ready()) return res.status(503).json({ error: "The library index is not built yet" });
    const q = String(req.query.q || "").trim().toLowerCase();
    let n = parseInt(req.query.n, 10);
    if (!Number.isFinite(n) || n < 0) n = 100;
    if (n > 1000) n = 1000;
    const all = d.albums();
    // each album's label looked up once (a search reads it for every album; the review)
    /** @type {Array<{ al: Album, label: string | null }>} */
    let picked;
    if (q) {
      picked = [];
      for (const al of all) {
        const label = d.labelOf(al) || null;
        if ([al.title, al.subtitle, label || ""].some((s) => String(s || "").toLowerCase().includes(q))) picked.push({ al, label });
      }
    } else {
      picked = all.map((al) => ({ al, label: /** @type {string | null} */ (null) }));
      if (n && picked.length > n) {
        // a random n of them (a partial Fisher–Yates: the first n of a shuffle)
        for (let i = 0; i < n; i++) { const j = i + Math.floor(random() * (picked.length - i)); const t = picked[i]; picked[i] = picked[j]; picked[j] = t; }
      }
    }
    const matched = picked.length;
    if (n) picked = picked.slice(0, n);   // a search too: the first n matches, in the library's order
    const rows = picked.map(({ al, label: known }) => {
      const keys = d.keysOf(al), shown = d.facts.forKeys(keys), layers = d.facts.layersOf(keys);
      return { title: al.title, artist: al.subtitle, label: q ? known : d.labelOf(al) || null,
        shown: shown ? { catno: shown.catno, types: shown.types, src: shown.src } : null,
        sources: layers ? layers.by : {}, key: layers ? layers.key : keys[0] || null };
    });
    const withNumber = rows.filter((r) => r.shown && r.shown.catno).length, withKinds = rows.filter((r) => r.shown && r.shown.types.length).length;
    res.json({ albums: all.length, sample: rows.length, random: !q && !!n && all.length > n, q: q || null, matched: q ? matched : null, n: n || null,
      inSample: { withNumber, withKinds, withNeither: rows.length - rows.filter((r) => r.shown).length },
      held: d.facts.counts(), sources: { file: "the files' tags", discogs: "Discogs", roon: "your server (native mode's walk)" },
      note: "shown: what the Shelf shows, from the best source that has it (tags over your server over Discogs, fact by fact); sources: what each said. For what your server holds of one album, /api/debug/roon-album-edit-info?run=1&title=…",
      rows });
  });
}

module.exports = { mountReleaseDebug };
