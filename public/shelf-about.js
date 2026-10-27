// @ts-check
/*
 * shelf-about.js — the album view's column under its cover (v1.9.68, the owner: under the play controls, the
 * album's review and the artist's other albums, "only that for now"): the review as the remote's album page has it
 * (/api/album/extras: the description, whose words they are, and the link to read on), and the library's other
 * albums by the album's lead artist (/api/album/more), each a cover to tap — the shelf turns to it and opens it.
 * Read once per album, when the view opens on it; nothing is read while the shelf moves.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h):
 *
 *   const about = ShelfAbout.create(h);
 *   about.html(a)      the column's two sections as they stand (reading…, read, or nothing to show)
 *   about.read(a)      read them, once; the view is drawn again when they come (h.back.repaint)
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { esc, jget, imageUrl, toast } = h;
    /** @type {Map<string, any>} album key → { review, more } | "loading" */
    const known = new Map();
    const keyOf = (/** @type {any} */ a) => a.t + "|" + a.a;

    /** @param {any} a */
    async function read(a) {
      const key = keyOf(a);
      if (known.has(key)) return;
      known.set(key, "loading");
      const q = `title=${encodeURIComponent(a.t)}&artist=${encodeURIComponent(a.a)}`;
      // each on its own: one that fails leaves the other's section standing
      const [extras, more] = await Promise.all([
        jget("/api/album/extras?" + q).catch(() => null),
        jget("/api/album/more?" + q).catch(() => null),
      ]);
      const al = extras && extras.album ? extras.album : null, from = al && al.description && al.description_source && al.description_source !== al.source;
      const got = {
        review: al && (al.description || (al.url && al.source)) ? { text: al.description || "", source: al.source || null, url: al.url || null,
          from: from ? al.description_source : null, fromUrl: from ? al.description_url || null : null } : null,
        more: more && Array.isArray(more.by) ? more.by.slice(0, 24) : [],
        artist: (more && more.artist) || a.a,
      };
      known.set(key, got);
      // one that could not be read is asked again the next time the album opens (Roon or the network may be back),
      // as the track list is (shelf-back.js readTracks)
      if (!extras || !more) setTimeout(() => { if (known.get(key) === got) known.delete(key); }, 4000);
      if (h.back) h.back.repaint(a);
    }

    /** @param {any} a */
    function html(a) {
      const got = known.get(keyOf(a));
      if (!got || got === "loading") return '<p class="ov-msg ov-reading">Reading about this album…</p>';
      let out = "";
      const r = got.review;
      if (r) {
        // Pitchfork's own words never leave the server (UK law): its link says so, as the remote's does.
        const link = r.url && r.source ? `<a class="ov-src" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source === "Pitchfork" ? "Read the full review on Pitchfork" : "View on " + r.source)}</a>` : "";
        out += `<section class="ov-review"><h3 class="ov-label">About this album</h3>${r.text ? `<p class="ov-text">${esc(r.text)}</p>` : ""}`
          + `${r.from ? `<p class="ov-from">From ${r.fromUrl ? `<a href="${esc(r.fromUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.from)}</a>` : esc(r.from)}</p>` : ""}${link}</section>`;
      }
      if (got.more.length) {
        out += `<section class="ov-more"><h3 class="ov-label">More by ${esc(got.artist)}</h3><div class="ov-grid">`
          + got.more.map((m, i) => `<button class="ov-tile" type="button" data-more="${i}"><span class="ov-tile-art">${m.image_key ? `<img src="${imageUrl(m.image_key, 300)}" alt="" loading="lazy" draggable="false">` : ""}</span><span class="ov-tile-t">${esc(m.title)}</span></button>`).join("")
          + "</div></section>";
      }
      return out;
    }

    /** A tile tapped: the shelf turns to that album and opens it, if the shelf holds it. @param {any} a @param {number} i */
    function open(a, i) {
      const got = known.get(keyOf(a));
      const m = got && got !== "loading" ? got.more[i] : null;
      if (!m) return;
      // by its offset: a reissue shares its title and artist with the album open (/api/album/more keeps both)
      const at = h.list.findIndex((/** @type {any} */ x) => x.o === m.offset);
      if (at < 0) { toast("That album isn’t on this shelf — clear the choices to find it"); return; }
      h.p = h.target = at; h.vp = 0; h.mode = "idle"; h.flippedV = at;
      h.updateInfo(true); h.settled(); h.kick();
    }

    return { read, html, open };
  }

  window.ShelfAbout = { create };
})();
