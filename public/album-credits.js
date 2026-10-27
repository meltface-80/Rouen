// @ts-check
/*
 * album-credits.js — an album's credits on its page (v1.9.70-t1, dev/design/album-credits.md §1): who played, sang,
 * wrote and made it, from /api/album/credits, in the server's order (those who play first, then who wrote it, who made
 * the record, its sleeve). Each a row: a round picture (theirs once found, else their first letter), the name, and
 * their parts, with which tracks when they are not on every one. Eight at first, More for the rest; a tap opens that
 * name's artist page, whose Back returns here. Hidden until there is something to show; an answer for an album no
 * longer open is dropped; asked once more when the server is still reading it. Mandarin's album-credits.js, ported.
 *
 * The section is made here, first in the album page's side column (#modal-aside): on a phone that column follows the
 * tracks, so the credits come straight after them; from 720px up it heads the column under the cover.
 *
 *   RouenAlbumCredits.show(album, trackCount, { open(name), mine() })   app.js, once the tracks are drawn
 *   RouenAlbumCredits.reset()                                           app.js, as each album opens
 *
 * And a band's members now, on its artist page (§7, the owner: "only the current active members of the band"), in the
 * same rows, after its bio and before its albums; none for a person or an act with none listed.
 *   RouenAlbumCredits.members(name, grid, { open(name), mine() })      app.js, as the artist page opens
 */
(function albumCredits() {
  "use strict";
  const SHOWN = 8, AGAIN_MS = 6000;
  let seq = 0;
  /** @type {HTMLElement | null} */
  let sec = null;

  /** The section, made the first time it is needed. */
  function section() {
    if (sec) return sec;
    const aside = document.getElementById("modal-aside");
    if (!aside) return null;
    sec = document.createElement("div");
    sec.className = "more-section credits-section hidden";
    sec.id = "album-credits";
    const h = document.createElement("h3");
    h.className = "section-label";
    h.textContent = "Credits";
    const list = document.createElement("div");
    list.className = "credits-list";
    const toggle = document.createElement("button");
    toggle.type = "button"; toggle.className = "more-toggle hidden"; toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "More";
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      for (const el of list.querySelectorAll(".credit-extra")) el.classList.toggle("hidden", !open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Less" : "More";
    });
    sec.append(h, list, toggle);
    aside.insertBefore(sec, aside.firstChild);
    return sec;
  }

  /** Which tracks, runs of three or more as a range: "track 4", "tracks 1, 2", "tracks 1–3, 5". @param {number[]} tracks */
  function trackList(tracks) {
    const t = [...new Set(tracks)].sort((a, b) => a - b);
    if (!t.length) return "";
    const parts = [];
    for (let i = 0; i < t.length;) {
      let j = i;
      while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
      if (j - i >= 2) parts.push(t[i] + "–" + t[j]); else for (let k = i; k <= j; k++) parts.push(String(t[k]));
      i = j + 1;
    }
    return (t.length === 1 ? "track " : "tracks ") + parts.join(", ");
  }

  /** One of them: the picture, the name over their parts. @param {any} c @param {(name: string) => void} open */
  function row(c, open) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "credit";
    btn.setAttribute("aria-label", c.name);
    const pic = document.createElement("span");
    pic.className = "credit-pic";
    const initial = document.createElement("span");
    initial.className = "credit-initial";
    initial.textContent = (String(c.name || "").trim().charAt(0) || "?").toUpperCase();
    pic.appendChild(initial);
    if (c.photo) {
      const img = document.createElement("img");
      img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
      // None to be had: the initial stays.
      img.addEventListener("error", () => img.remove());
      img.src = c.photo;
      pic.appendChild(img);
    }
    const text = document.createElement("span");
    text.className = "credit-text";
    const name = document.createElement("span");
    name.className = "credit-name"; name.textContent = c.name;
    text.appendChild(name);
    const said = [(c.roles || []).join(", "), Array.isArray(c.tracks) ? trackList(c.tracks) : ""].filter(Boolean).join(" · ");
    if (said) { const r = document.createElement("span"); r.className = "credit-roles"; r.textContent = said; text.appendChild(r); }
    btn.append(pic, text);
    btn.addEventListener("click", () => open(c.name));
    return btn;
  }

  function reset() {
    seq++;
    if (!sec) return;
    sec.classList.add("hidden");
    const list = sec.querySelector(".credits-list"), toggle = sec.querySelector(".more-toggle");
    if (list) list.textContent = "";
    if (toggle) { toggle.classList.add("hidden"); toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "More"; }
  }

  /** @param {any[]} credits @param {(name: string) => void} open */
  function draw(credits, open) {
    const s = section();
    if (!s) return;
    const list = /** @type {HTMLElement} */ (s.querySelector(".credits-list"));
    const toggle = /** @type {HTMLElement} */ (s.querySelector(".more-toggle"));
    list.textContent = "";
    credits.forEach((c, i) => {
      const el = row(c, open);
      if (i >= SHOWN) el.classList.add("credit-extra", "hidden");
      list.appendChild(el);
    });
    toggle.classList.toggle("hidden", credits.length <= SHOWN);
    toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "More";
    s.classList.remove("hidden");
  }

  /**
   * The credits of [album], asked once its tracks are drawn.
   * @param {any} album @param {number} trackCount @param {{ open: (name: string) => void, mine: () => boolean }} ctx
   */
  async function show(album, trackCount, ctx) {
    if (!album || !album.title) return;
    const mineNow = ++seq;
    const mine = () => mineNow === seq && ctx.mine();
    const q = new URLSearchParams({ title: album.title || "", artist: String(album.subtitle || "").trim(), tracks: String(trackCount || 0) });
    for (let tries = 0; tries < 2; tries++) {
      let j = null;
      try { const r = await fetch("/api/album/credits?" + q); j = r.ok ? await r.json() : null; }
      catch (e) { return; /* the credits are extra: the page stands without them */ }
      if (!mine()) return;
      const credits = (j && Array.isArray(j.credits) ? j.credits : []).filter((/** @type {any} */ c) => c && c.name);
      if (credits.length) draw(credits, ctx.open);
      if (!j || j.status !== "pending") return;
      await new Promise((res) => { setTimeout(res, AGAIN_MS); });
      if (!mine()) return;
    }
  }

  /**
   * A band's members now, on its artist page.
   * @param {string} name @param {HTMLElement} grid  the artist page's @param {{ open: (name: string) => void, mine: () => boolean }} ctx
   */
  async function members(name, grid, ctx) {
    const q = new URLSearchParams({ name: name || "" });
    for (let tries = 0; tries < 2; tries++) {
      let j = null;
      try { const r = await fetch("/api/artist/members?" + q); j = r.ok ? await r.json() : null; }
      catch (e) { return; /* extra, as the credits: the page stands without it */ }
      if (!ctx.mine()) return;
      const list = (j && Array.isArray(j.members) ? j.members : []).filter((/** @type {any} */ m) => m && m.name);
      if (list.length) drawMembers(list, grid, ctx.open);
      if (!j || j.status !== "pending") return;
      await new Promise((res) => { setTimeout(res, AGAIN_MS); });
      if (!ctx.mine()) return;
    }
  }

  /** @param {any[]} list @param {HTMLElement} grid @param {(name: string) => void} open */
  function drawMembers(list, grid, open) {
    const old = Array.prototype.find.call(grid.children, (/** @type {any} */ x) => x.__tileKey === "artist-members");
    const box = document.createElement("div");
    box.className = "artist-members";
    /** @type {any} */ (box).__tileKey = "artist-members";   // a live re-read of the albums keeps it where it is
    const h = document.createElement("h3");
    h.className = "section-label"; h.textContent = "Members";
    const rows = document.createElement("div");
    rows.className = "credits-list";
    for (const m of list) rows.appendChild(row({ name: m.name, roles: m.roles, photo: m.photo }, open));
    box.append(h, rows);
    if (old) { old.replaceWith(box); return; }
    // After the bio, when it has come; else first (the bio, coming later, goes before it).
    const bio = Array.prototype.find.call(grid.children, (/** @type {any} */ x) => x.__tileKey === "artist-bio");
    if (bio) bio.after(box); else grid.prepend(box);
  }

  window.RouenAlbumCredits = { show, reset, members, trackList };
})();
