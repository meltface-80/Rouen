// @ts-check
/*
 * album-versions.js — an album's other versions on its page (v2.0.3-t16, dev/design/album-versions.md): the library's
 * copies grouped as the album, its other releases in the library and the streaming services' releases, from
 * /api/album/versions (your server, through native mode). A row a version: its name, its format, track count and where
 * it is; the one open marked "This version", a copy hidden as a duplicate "Hidden". A tap on another opens its sheet:
 * its tracks, and Play and Shuffle, which play that copy whole on the chosen zone. Its look is album-versions.css.
 *
 * The section is made here, in the album page's side column after the credits. On a phone it is the VERSIONS tab
 * (album-phone.js shows the tab once this says there are versions: #album-modal[data-versions="some"]); from 720px up,
 * a section of the side column. None, or native mode off: no section and no tab. Asked when an album opens, and again
 * after 5 seconds while the server says it is still loading them (three times at most); an answer for an album no
 * longer open is dropped.
 *
 *   RouenAlbumVersions.load()   read the open album's versions again (tests)
 */
(function albumVersions() {
  "use strict";
  const W = /** @type {any} */ (window);
  const AGAIN_MS = 5000, AGAIN_MAX = 3;
  const modal = document.getElementById("album-modal");
  const aside = document.getElementById("modal-aside");
  const title = document.getElementById("modal-title");
  if (!modal || !aside || !title) return;

  const here = document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src;
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: here ? new URL("album-versions.css", here).href : "/album-versions.css" }));

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const sleep = (/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); });
  /** A length as the album's rows say one. @param {number} s */
  const clock = (s) => (W.RouenTrackTimes && W.RouenTrackTimes.clock ? W.RouenTrackTimes.clock(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

  const sec = el("div", "more-section versions-section hidden");
  sec.id = "album-versions";
  sec.appendChild(el("h3", "section-label", "Versions"));
  const list = el("div", "versions-list");
  sec.appendChild(list);
  /** Placed after the credits (made by album-credits.js when first needed), else at the column's head. */
  function place() {
    const credits = document.getElementById("album-credits");
    if (credits && credits.parentNode === aside) { if (credits.nextSibling !== sec) credits.after(sec); }
    else if (sec.parentNode !== aside) aside.insertBefore(sec, aside.firstChild);
  }
  place();

  /** The album open: its title and artist, as the page asks every album read. */
  function albumNow() {
    const a = W.__currentAlbum;
    return a && a.title ? { title: String(a.title), artist: String(a.subtitle || "").trim() } : null;
  }
  const open = () => !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");

  let seq = 0, shownFor = "";
  /** @type {{ title: string, artist: string } | null} */
  let album = null;

  /** No versions to show (none, or not yet). @param {string} state */
  function none(state) {
    list.textContent = "";
    sec.classList.add("hidden");
    modal.dataset.versions = state;
  }

  /** Its format, track count and where it is. @param {any} v */
  const lineOf = (v) => [v.format, typeof v.tracks === "number" ? `${v.tracks} track${v.tracks === 1 ? "" : "s"}` : null, v.where].filter(Boolean).join(" · ");

  /** The rows. @param {any[]} versions */
  function render(versions) {
    list.textContent = "";
    if (!versions.length) { none("none"); return; }
    for (const v of versions) {
      const row = el(v.current ? "div" : "button", "version-row" + (v.current ? " is-current" : ""));
      if (row instanceof HTMLButtonElement) { row.type = "button"; row.addEventListener("click", () => { openSheet(v, row); }); }
      const words = el("div", "version-words");
      words.appendChild(el("div", "version-name", v.name));
      const line = lineOf(v);
      if (line) words.appendChild(el("div", "version-line", line));
      row.appendChild(words);
      const mark = v.current ? "This version" : v.hidden ? "Hidden" : "";
      if (mark) row.appendChild(el("span", "version-mark", mark));
      list.appendChild(row);
    }
    place();
    sec.classList.remove("hidden");
    modal.dataset.versions = "some";
  }

  /** Read the open album's versions; again while the server is still loading them. */
  async function load() {
    if (!open()) return;
    const a = albumNow();
    const key = a ? JSON.stringify([a.title, a.artist]) : "";
    if (key === shownFor) return;
    shownFor = key;
    album = a;
    const mine = ++seq;
    closeSheet();
    none("");
    if (!a) return;
    const q = new URLSearchParams({ title: a.title, artist: a.artist });
    for (let tries = 0; ; tries++) {
      /** @type {any} */
      let j = null;
      try { const r = await fetch("/api/album/versions?" + q, { cache: "no-store" }); j = r.ok ? await r.json() : null; }
      catch (e) { j = null; }   // the versions are extra: the page stands without them, and the album opened again asks again
      if (mine !== seq) return;
      if (!j) { none("none"); return; }
      if (j.status === "ok") render(Array.isArray(j.versions) ? j.versions : []);
      else if (j.status !== "pending") { none("none"); return; }
      if ((j.status === "ok" && j.complete !== false) || tries >= AGAIN_MAX) { if (j.status !== "ok") none("none"); return; }
      await sleep(AGAIN_MS);
      if (mine !== seq) return;
    }
  }

  // ── A version's sheet ─────────────────────────────────────────────────────────────────────────────────────────
  /** @type {HTMLElement | null} */
  let wrap = null;
  /** @type {HTMLElement | null} */
  let from = null;
  let sheetSeq = 0;

  /** @param {any} v @param {HTMLElement} row  the row it was opened from, focused again when it closes (a tap focuses no button on every browser) */
  function openSheet(v, row) {
    if (!album) return;
    closeSheet();
    const a = album, mine = ++sheetSeq;
    from = row;
    wrap = el("div", "vs-wrap");
    const card = el("div", "vs-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "vs-title");
    const top = el("div", "vs-top");
    const h = el("h2", "vs-title", v.name);
    h.id = "vs-title";
    const x = /** @type {HTMLButtonElement} */ (el("button", "vs-close icon-btn", "×"));
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closeSheet);
    top.append(h, x);
    card.appendChild(top);
    const line = lineOf(v);
    if (line) card.appendChild(el("div", "vs-line", line + (v.hidden ? " · Hidden" : "")));
    const acts = el("div", "vs-actions");
    const play = /** @type {HTMLButtonElement} */ (el("button", "vs-play", "Play"));
    const shuffle = /** @type {HTMLButtonElement} */ (el("button", "vs-shuffle", "Shuffle"));
    const note = el("p", "vs-note hidden");
    note.setAttribute("role", "status");
    for (const [b, mixed] of /** @type {Array<[HTMLButtonElement, boolean]>} */ ([[play, false], [shuffle, true]])) {
      b.type = "button";
      b.addEventListener("click", () => { void playIt(a, v, mixed, [play, shuffle], note); });
      acts.appendChild(b);
    }
    card.append(acts, note);
    const tracks = el("ol", "vs-tracks");
    tracks.appendChild(el("li", "vs-wait", "Reading its tracks…"));
    card.appendChild(tracks);
    wrap.appendChild(card);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeSheet(); });
    document.body.appendChild(wrap);
    x.focus();
    void tracksOf(a, v, tracks, () => mine === sheetSeq);
  }

  /** Its tracks, read from the server. @param {{ title: string, artist: string }} a @param {any} v @param {HTMLElement} box @param {() => boolean} mine */
  async function tracksOf(a, v, box, mine) {
    /** @type {any} */
    let j = null;
    for (let tries = 0; tries <= AGAIN_MAX; tries++) {
      try {
        const r = await fetch("/api/album/version-tracks?" + new URLSearchParams({ title: a.title, artist: a.artist, id: v.id }), { cache: "no-store" });
        j = r.ok ? await r.json() : null;
      } catch (e) { j = null; }   // said below as tracks that couldn't be read; Play stands without them
      if (!mine()) return;
      if (!j || j.status !== "pending") break;
      await sleep(AGAIN_MS);
      if (!mine()) return;
    }
    box.textContent = "";
    const rows = j && j.status === "ok" && Array.isArray(j.tracks) ? j.tracks : [];
    if (!rows.length) { box.appendChild(el("li", "vs-wait", j && j.why ? j.why : "Its tracks couldn't be read.")); return; }
    const discs = new Set(rows.map((/** @type {any} */ t) => t.disc)).size > 1;
    for (const t of rows) {
      const li = el("li", "vs-track");
      li.appendChild(el("span", "vs-n", (discs ? t.disc + "-" : "") + (t.number || "")));
      li.appendChild(el("span", "vs-t", t.title || ""));
      if (typeof t.seconds === "number" && t.seconds > 0) li.appendChild(el("span", "vs-len", clock(t.seconds)));
      box.appendChild(li);
    }
  }

  /**
   * The copy played whole on the chosen zone; what came of it said under the buttons.
   * @param {{ title: string, artist: string }} a @param {any} v @param {boolean} shuffle @param {HTMLButtonElement[]} buttons @param {HTMLElement} note
   */
  async function playIt(a, v, shuffle, buttons, note) {
    const zone = (() => { try { return String((W.__selectedZoneId && W.__selectedZoneId()) || ""); } catch (e) { return ""; } })();   // no zone chosen yet: said below
    const say = (/** @type {string} */ t) => { note.textContent = t; note.classList.toggle("hidden", !t); };
    if (!zone) { say("Choose a zone to play on first."); return; }
    for (const b of buttons) b.disabled = true;
    say(shuffle ? "Shuffling…" : "Playing…");
    /** @type {any} */
    let j = null;
    try {
      const r = await fetch("/api/album/version-play", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: a.title, artist: a.artist, id: v.id, zone_id: zone, shuffle }) });
      j = await r.json().catch(() => null);
    } catch (e) { j = null; }   // said below: Rouen didn't answer
    for (const b of buttons) b.disabled = false;
    if (j && j.ok) { say(""); closeSheet(); return; }
    say(j && (j.notShown || j.notSent || j.error) ? String(j.notShown || j.notSent || j.error) : "Rouen didn't answer.");
  }

  function closeSheet() {
    if (!wrap) return;
    wrap.remove();
    wrap = null;
    sheetSeq++;
    if (from && document.contains(from) && open()) from.focus({ preventScroll: true });
    from = null;
  }

  document.addEventListener("keydown", (e) => {
    if (!wrap) return;
    if (e.key === "Escape") { e.stopPropagation(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    // The sheet is modal: Tab goes round its own buttons.
    const all = /** @type {HTMLElement[]} */ ([...wrap.querySelectorAll("button:not([disabled])")]);
    if (!all.length) return;
    const at = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + all.length) % all.length;
    e.preventDefault();
    all[next].focus();
  }, true);

  // An album opened (its title drawn), Now playing over it and back, the page closed: read again when it is shown.
  const changed = () => { if (!open()) { closeSheet(); if (modal.classList.contains("hidden")) shownFor = ""; return; } void load(); };
  new MutationObserver(changed).observe(title, { childList: true, characterData: true, subtree: true });
  new MutationObserver(changed).observe(modal, { attributes: true, attributeFilter: ["class"] });
  // The credits' section made later: the versions kept after it.
  new MutationObserver(() => { if (document.getElementById("album-credits") && !sec.classList.contains("hidden")) place(); }).observe(aside, { childList: true });
  W.RouenAlbumVersions = { load: () => { shownFor = ""; return load(); } };
})();
