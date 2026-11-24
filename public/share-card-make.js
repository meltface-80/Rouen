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
 *   RouenShareMake.row(item, primary, sub, art)    a suggestion's row: opens its album view (2.0.6-t14)
 *   RouenShareMake.similar(list, acts)             the share card's "If you like this" rows
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
    // The album screen's date first (2.0.6-t13; the owner: "Why is the release date missing from the share card when
    // it's known from the album screen"): the date the Release date sort orders the album by, to the day where one is
    // known. Then MusicBrainz's year, found by the title (none under an edition's title, "(Bonus Tracks)"), then the
    // review's.
    if (j.release_date) f.releaseRaw = String(j.release_date);
    if (j.year && !f.releaseRaw) f.releaseRaw = j.year;
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
   * 464px, so the card asks for exactly that address and gets the browser's
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

  /*
   * ONE ROW BUILDER (moved out of app.js in 2.0.6-t14), used by the suggestions under the share card and by the Discover
   * screen. They ask different questions — "acts like this one" and "new records by acts you play" — but the answer is
   * the same KIND of thing in both: a record, in the library or not, and where a tap on it goes must not have two
   * implementations that can drift apart. The caller supplies the two lines; everything about where the row GOES lives
   * here, and there it is one place: THE album view, the one every grid opens, for the record shown (streaming.js
   * RouenStreaming.find; the owner, 2026-11-24: "You must make the share card and smart pick suggestions open to those
   * albums that are shown"). In the library it had queued the album, and not in it, opened a search (2.0.6-t12).
   * In the library the row says so (is-library, Roon's own strings and place go to the view); either way it says Open.
   *
   * @param {any} item        { name?, artist?, album?, in_library?, offset?, library_title?, library_subtitle?, image_key?, services? }
   * @param {string} primary  the bold line
   * @param {string} sub      the quiet line, or ""
   * @param {string} [art]    a cover's address: the row becomes cover and text (Discover)
   */
  function row(item, primary, sub, art) {
    const label = document.createElement("span");
    label.className = "share-similar-name";
    label.textContent = primary;
    const rec = document.createElement("span");
    rec.className = "share-similar-rec";
    if (sub) rec.textContent = sub;
    /*
     * WITH ARTWORK, the two lines become a column beside the cover; without it they stay direct children of the row.
     * Two shapes rather than one, deliberately: the suggestions under the share card are a compact list inside a sheet
     * and carry no artwork, while Discover is a full screen of RECORDS, where a wall of text is the odd one out.
     */
    /** @param {HTMLElement} r */
    const fill = (r) => {
      if (art) {
        const holder = document.createElement("span");
        holder.className = "row-text";
        holder.appendChild(label);
        if (sub) holder.appendChild(rec);
        r.appendChild(rowArt(art));
        r.appendChild(holder);
      } else { r.appendChild(label); if (sub) r.appendChild(rec); }
    };
    const W = /** @type {any} */ (window);
    const finder = W.RouenStreaming;
    const lib = !!item.in_library && typeof item.offset === "number";
    const found = { offset: lib ? item.offset : undefined, library_title: item.library_title, library_subtitle: item.library_subtitle,
      artist: item.name || item.artist || "", album: item.album || "", image_key: item.image_key || null, cover: art || item.cover || null,
      services: item.services || [] };
    /** @type {HTMLElement} */
    let r;
    if (finder && (lib || item.album) && finder.canFind(found)) {
      r = document.createElement("button");
      /** @type {HTMLButtonElement} */ (r).type = "button";
      r.className = "share-similar-act " + (lib ? "is-library" : "is-service");
      fill(r);
      r.appendChild(tagEl("Open"));
      r.addEventListener("click", () => finder.find(found));
    } else {
      // Nothing to open — no record was named. Still shown, because the name itself is the answer.
      r = document.createElement("div");
      r.className = "share-similar-act";
      fill(r);
    }
    if (art) r.classList.add("has-art");
    return r;
  }

  /*
   * A row's cover, in a box that holds its place whether or not the image ever arrives (moved out of app.js, 2.0.6-t14).
   * These covers come from a third party (Deezer, for a record the library does not have), so some will 404, be blocked
   * or not exist, and an <img> with a dead src draws the browser's broken-image glyph. On error the img removes itself
   * and the empty tile stands. What the tile was ASKED for is kept on the box (data-art-src), for a person looking at
   * the row and for a test asserting an in-library record used Roon's art.
   * @param {string} url
   */
  function rowArt(url) {
    const box = document.createElement("span");
    box.className = "row-art";
    box.dataset.artSrc = url;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.addEventListener("error", () => {
      box.dataset.artFailed = "1";
      if (img.parentNode) img.parentNode.removeChild(img);
    });
    img.src = url;
    box.appendChild(img);
    return box;
  }

  /**
   * The share card's "If you like this" (moved out of app.js's renderSimilar in 2.0.6-t14): an act's row, its record
   * and year the quiet line, and why it is here (v1.8.82, Mandarin v0.7.6): near which of your acts, or one you know
   * with a record you don't have. An act whose records could not be named is still shown, the record line left out.
   * @param {HTMLElement} list @param {any[]} acts
   */
  function similar(list, acts) {
    list.innerHTML = "";
    for (const act of (acts || [])) {
      if (!act || !act.name) continue;
      const r = row(act, act.name, act.album ? (act.year ? act.album + " \u00b7 " + act.year : act.album) : "");
      if (act.reason) {
        const why = document.createElement("span");
        why.className = "share-similar-why";
        why.textContent = act.reason;
        r.appendChild(why);
      }
      list.appendChild(r);
    }
  }

  /** @param {string} text */
  function tagEl(text) {
    const t = document.createElement("span");
    t.className = "share-similar-tag";
    t.textContent = text;
    return t;
  }

  (/** @type {any} */ (window)).RouenShareMake = { begin, ensureFont, extras, cardFields, coverUrlOf, prewarmCover, LOGO_URL, finish, row, similar };
})();
