// @ts-check
/*
 * share-card-make.js — what goes into the share card, and how long each part of making it took (v2.0.3-t5). Moved out
 * of app.js's share card overlay in v2.0.3-t5: the font wait, what the card shows from an extras answer, the cover's
 * address and the logo tile. New with it: the card's own timings.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 *   RouenShareMake.begin()                         a new card's timings, started now
 *   RouenShareMake.ensureFont(timing)              Promise: the card's face loaded, or two seconds gone
 *   RouenShareMake.extras(title, artist, timing)   Promise: the /api/album/extras answer, or null
 *   RouenShareMake.cardFields(j)                   what the card shows, from that answer
 *   RouenShareMake.coverUrlOf(imageKey) / prewarmCover(imageKey) / LOGO_URL
 *   RouenShareMake.finish(timing, result, error)   the card's timings, sent to the server's log
 *
 * WHY THE TIMINGS. A share card that took many seconds said nothing about where they went: the font, the server's
 * lookups (the year from MusicBrainz, the review from Pitchfork, Qobuz and Wikipedia), the pictures, the drawing or
 * the PNG. Each card's steps are now sent to POST /api/debug/share-card, kept beside what the server's lookups waited
 * on (GET /api/debug/share-card, which the Android app's saved log includes), and a card that took two seconds or more
 * also says so on the page's console, which the Android app's log keeps (PAGE) and a browser shows.
 */

(() => {
  "use strict";

  const SLOW_MS = 2000;
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());

  /** @typedef {Record<string, any> & { t0: number }} CardTiming */

  /** @returns {CardTiming} */
  function begin() { return { t0: now(), where: (/** @type {any} */ (window)).RouenPhone ? "app" : "browser" }; }

  // The card is drawn in Manrope, which ships with the app (public/fonts,
  // v1.8.74 — it used to come from Google Fonts). Waited for so the card's
  // text is measured in the face it is drawn in, but never for more than two
  // seconds: a font that has not arrived by then draws in the fallback rather
  // than holding the card up.
  /** @param {CardTiming} [timing] */
  async function ensureFont(timing) {
    if (!document.fonts || !document.fonts.load) return;
    const t = now();
    let failed = false, timedOut = false;
    const loaded = (async () => {
      await Promise.all([
        document.fonts.load('700 42px Manrope'),
        document.fonts.load('400 28px Manrope'),
        document.fonts.load('700 16px Manrope'),
        document.fonts.load('400 22px Manrope')
      ]);
      await document.fonts.ready;
    })().catch(() => { failed = true; /* fall back to the system face */ });
    await Promise.race([loaded, new Promise(r => { setTimeout(() => { timedOut = true; r(undefined); }, 2000); })]);
    if (timing) { timing.font_ms = now() - t; timing.font_timed_out = timedOut; timing.font_failed = failed; }
  }

  /**
   * The extras answer the card is drawn from, or null (the card is drawn without them). Asked as the share card
   * (for=card), so the server's log says who asked; its Server-Timing and its trace id go on the card's timings.
   * @param {string} title @param {string} artist @param {CardTiming} [timing]
   */
  async function extras(title, artist, timing) {
    const t = now();
    const params = new URLSearchParams({ title, artist, for: "card" });
    try {
      const r = await fetch("/api/album/extras?" + params, { cache: "no-store" });
      if (timing) {
        timing.extras_status = r.status;
        const id = r.headers && r.headers.get ? r.headers.get("X-Rouen-Trace") : null;
        if (id) timing.trace = id;
        const st = r.headers && r.headers.get ? r.headers.get("Server-Timing") : null;
        if (st) timing.server = st;
      }
      const j = r.ok ? await r.json() : null;
      if (timing) timing.extras_ms = now() - t;
      return j;
    } catch (e) {
      if (timing) { timing.extras_ms = now() - t; timing.extras_status = 0; }
      return null;   // no extras: the card is drawn without them
    }
  }

  // What the card shows, from an /api/album/extras answer (or none).
  /** @param {any} j */
  function cardFields(j) {
    // No label (v2.0.3-t5): the card's release line is the date alone, as Mandarin's (sharecard.js).
    /** @type {{ releaseRaw: string, reviewText: string, reviewSource: string, links: any, score: any, bestNew: boolean }} */
    const f = { releaseRaw: "", reviewText: "", reviewSource: "", links: null, score: null, bestNew: false };
    if (!j) return f;
    if (j.links) f.links = j.links;
    if (j.year) f.releaseRaw = j.year;
    if (j.album && j.album.year && !f.releaseRaw) f.releaseRaw = String(j.album.year);
    // Pitchfork's number and their Best New Music flag — never their prose,
    // which the server nulls before it leaves fetchAlbumBios. The chip under
    // the card is the link to read it at theirs.
    if (j.album && j.album.score != null) f.score = j.album.score;
    if (j.album && j.album.isBestNewMusic) f.bestNew = true;
    const desc = j.album && j.album.description;
    if (desc) {
      // Card height grows to fit, so show most of the review. Capped
      // generously (~10 sentences / 1400 chars) against a very long article.
      let t = String(desc).trim();
      const sentences = t.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 10) t = sentences.slice(0, 10).join(" ").trim();
      if (t.length > 1400) t = t.slice(0, 1398).replace(/\s+\S*$/, "") + "…";
      f.reviewText = t;
      // Whose prose the card ends up showing. NOT `source`, which says where
      // the link goes — index.js keeps them apart on purpose, or Wikipedia's
      // writing under a "read it at Pitchfork" link would be a misattribution
      // pointing the other way.
      if (j.album.description_source) f.reviewSource = String(j.album.description_source);
    }
    return f;
  }

  /*
   * THE COVER THE CARD DRAWS IS THE ONE ALREADY ON SCREEN (v1.8.82, Mandarin
   * v0.7.6). The card asked for the cover at 1000px with a timestamp on the
   * end — a size nothing else on the page uses and an address that could
   * never be cached — so every share meant the server decoding the full cover
   * and encoding it again, and the phone downloading it. The album view and
   * Now playing both show the cover at 800px, and the card's own cover pane is
   * 424px, so the card asks for exactly that address and gets the browser's
   * copy back. Mandarin measured 335 ms → 130 ms, and ~1.1 MB → nothing on a
   * repeat share.
   */
  const COVER_SIZE = 800;
  /** @param {string} [imageKey] */
  const coverUrlOf = (imageKey) => imageKey ? `/api/image/${encodeURIComponent(imageKey)}?size=${COVER_SIZE}` : "";
  /** @param {string} [imageKey] */
  function prewarmCover(imageKey) {
    if (!imageKey) return;
    try { const im = new Image(); im.src = coverUrlOf(imageKey); } catch (e) { /* only a head start */ }
  }
  // The Rouen tile, fetched once the page is idle, so the first card never
  // waits for it.
  const LOGO_URL = "/icons/rouen-tile.png";
  const idle = (/** @type {any} */ (window)).requestIdleCallback || ((/** @type {() => void} */ fn) => setTimeout(fn, 1500));
  idle(() => { try { const im = new Image(); im.src = LOGO_URL; } catch (e) { /* only a head start */ } });

  /**
   * The card's timings to the server's log, once it is drawn, failed or given up on (the sheet shut, or another
   * album's card asked for). Never waited on, and a failure to send is silent: the card is what matters.
   * @param {CardTiming} timing @param {string} result @param {any} [error]
   */
  function finish(timing, result, error) {
    if (!timing || timing.sent) return;
    timing.sent = true;
    const body = Object.assign({}, timing, { total_ms: now() - timing.t0, result });
    delete body.t0; delete body.sent; delete body.server;
    if (error) body.error = String((error && error.message) || error);
    try {
      fetch("/api/debug/share-card", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), keepalive: true }).catch(() => { /* the log misses one card; nothing else does */ });
    } catch (e) { /* no fetch to send it with: the log misses one card; nothing else does */ }
    if (body.total_ms >= SLOW_MS) {
      const ms = (/** @type {string} */ k) => (body[k] == null ? "?" : Math.round(body[k]) + " ms");
      console.warn(`share card slow (#${body.trace || "?"}, ${result}): ${ms("total_ms")} — font ${ms("font_ms")}` +
        (body.font_timed_out ? " (gave up)" : body.font_failed ? " (failed)" : "") + `, server ${ms("extras_ms")} (HTTP ${body.extras_status == null ? "?" : body.extras_status}` +
        (timing.server ? "; " + timing.server : "") + `), pictures ${ms("images_ms")}, drawing ${ms("draw_ms")}, PNG ${ms("encode_ms")}`);
    }
  }

  (/** @type {any} */ (window)).RouenShareMake = { begin, ensureFont, extras, cardFields, coverUrlOf, prewarmCover, LOGO_URL, finish };
})();
