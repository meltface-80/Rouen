// @ts-check
/*
 * album-phone.js — the album view on a phone held upright, as Mandarin's (v2.0.3-t13, dev/design/album-phone.md):
 * a facts line under the cover (date · quality · length), the tabs TRACKS · CREDITS · ABOUT that stay at the top of the
 * screen, a line on About with the label, catalogue number, kind and Pitchfork score, and a note for a tab with nothing
 * in it. Its look is album-phone.css, loaded beside it; on any wider screen none of it shows.
 *
 * And the subtitle's extras, on every screen (moved out of app.js's renderExtras unchanged, v2.0.3-t13): the release
 * date, the label, the catalogue number and kind, the score and BNM after the artists, each marked .modal-sub-extra so a
 * phone can leave them off the artists' line. The phone's own parts are read back from those, from the cover's quality
 * badge and from the tracks' lengths, so what the subtitle says and what the phone shows can never disagree.
 *
 *   RouenAlbumHead.extras(sub, extras, date, onLabel)  the extras appended to the subtitle (app.js)
 *   RouenAlbumHead.tab(name)  "tracks" | "credits" | "about": the tab shown (tests, and a new album: tracks)
 */
(function albumPhone() {
  "use strict";
  const W = /** @type {any} */ (window);
  const modal = document.getElementById("album-modal");
  const body = modal && modal.querySelector(".modal-body");
  const art = modal && modal.querySelector(".modal-art");
  const aside = document.getElementById("modal-aside");
  const sub = document.getElementById("modal-subtitle");
  const tracks = document.getElementById("modal-tracks");
  const title = document.getElementById("modal-title");
  if (!modal || !body || !art || !aside || !sub || !tracks || !title) return;

  const here = document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src;
  document.body.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: here ? new URL("album-phone.css", here).href : "/album-phone.css" }));

  /** @param {string} tag @param {string} cls @param {string} [text] */
  const make = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  // ── The subtitle's extras (moved out of app.js) ─────────────────────────────────────────────────────────────────
  /**
   * @param {HTMLElement} box  the subtitle @param {any} extras  /api/album/extras's answer
   * @param {string} date  the release date as the page says it ("" for none)
   * @param {() => void} onLabel  the label tapped: its albums
   */
  function extras(box, extras, date, onLabel) {
    /** @param {HTMLElement} e */
    const add = (e) => { e.classList.add("modal-sub-extra"); box.appendChild(e); return e; };
    const sep = () => add(make("span", "modal-subtitle-year", " · "));
    const a = (extras && extras.album) || {};
    // modal-release-date: the one span app.js's refreshModalReleaseDate() may rewrite.
    if (date) add(make("span", "modal-subtitle-year modal-release-date", " · " + date));
    if (a.label) {
      sep();
      const labelBtn = /** @type {HTMLButtonElement} */ (add(make("button", "modal-artist-link", a.label)));
      labelBtn.type = "button";
      labelBtn.addEventListener("click", onLabel);
    }
    // Its catalogue number and kind of release (v1.9.67), as its files' tags say, after the label.
    for (const text of [a.catno, a.type].filter(Boolean)) add(make("span", "modal-subtitle-year modal-release-fact", " · " + text));
    if (typeof a.score === "number" && !isNaN(a.score)) {
      sep();
      add(make("span", "pitchfork-score", a.score % 1 === 0 ? a.score + ".0" : String(a.score)));
      if (a.isBestNewMusic) add(make("span", "bnm-badge", "BNM"));
    }
    paint();
  }

  // ── The phone's parts ───────────────────────────────────────────────────────────────────────────────────────────
  const facts = make("div", "album-facts");
  facts.id = "album-facts";
  art.after(facts);

  const tabs = make("div", "album-tabs");
  tabs.id = "album-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Album");
  /** @type {Record<string, HTMLButtonElement>} */
  const btn = {};
  for (const [key, label] of [["tracks", "Tracks"], ["credits", "Credits"], ["about", "About"]]) {
    const b = /** @type {HTMLButtonElement} */ (make("button", "album-tab", label));
    b.type = "button";
    b.dataset.tab = key;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => { tab(key); });
    btn[key] = b;
    tabs.appendChild(b);
  }
  // Before the tracks in the page's order (album-phone.css sets it); a direct child of the scrolling page, so it stays.
  body.appendChild(tabs);

  const aboutHead = make("div", "album-about-head");
  aboutHead.id = "album-about-head";
  const bio = document.getElementById("album-bio-section");
  aside.insertBefore(aboutHead, bio && bio.parentNode === aside ? bio : aside.firstChild);
  const empty = make("p", "album-tab-empty");
  empty.id = "album-tab-empty";
  body.appendChild(empty);

  /** Whether a part of the page is shown (not hidden by its class or its own style). @param {Element | null} e */
  const shown = (e) => !!e && !e.classList.contains("hidden") && /** @type {HTMLElement} */ (e).style.display !== "none";

  /** @param {string} name */
  function tab(name) {
    const key = btn[name] ? name : "tracks";
    modal.dataset.albumTab = key;
    for (const [k, b] of Object.entries(btn)) {
      b.classList.toggle("is-active", k === key);
      b.setAttribute("aria-selected", String(k === key));
    }
    paint();
    clip();
  }

  /** The tracks' own lengths summed, when every row has one; else null (never a part-sum). */
  function length() {
    const rows = [...tracks.querySelectorAll("li.t-row")];
    if (!rows.length) return null;
    let total = 0;
    for (const li of rows) {
      const t = li.querySelector(".t-len");
      const m = t && /^(?:(\d+):)?(\d+):(\d\d)$/.exec((t.textContent || "").trim());
      if (!m) return null;
      total += Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    const h = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
    const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return h ? `${h}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
  }

  let aboutSig = "";
  /** About's line, built from the subtitle's extras. */
  function about() {
    aboutHead.textContent = "";
    const bits = /** @type {HTMLElement[]} */ ([]);
    for (const e of /** @type {HTMLElement[]} */ ([...sub.querySelectorAll(".modal-sub-extra")])) {
      if (e.classList.contains("modal-release-date") || (e.classList.contains("modal-subtitle-year") && !e.classList.contains("modal-release-fact"))) continue;
      if (e.classList.contains("bnm-badge")) { bits.length && bits[bits.length - 1].appendChild(make("span", "bnm-badge", "BNM")); continue; }
      let c;
      if (e.tagName === "BUTTON") {
        c = /** @type {HTMLButtonElement} */ (make("button", "modal-artist-link", e.textContent || ""));
        c.type = "button";
        c.addEventListener("click", () => { /** @type {HTMLElement} */ (e).click(); });
      } else {
        c = make("span", e.className.replace(/\bmodal-sub-extra\b|\bmodal-subtitle-year\b|\bmodal-release-fact\b/g, "").trim() || "album-about-fact",
          (e.textContent || "").replace(/^\s*·\s*/, ""));
      }
      const holder = make("span", "album-about-bit");
      holder.appendChild(c);
      bits.push(holder);
    }
    // Each "·" goes with the part after it, so a wrapped line never ends on one (the review).
    bits.forEach((b, i) => { if (i) b.insertBefore(make("span", "album-fact-sep", "·"), b.firstChild); aboutHead.appendChild(b); });
    aboutHead.classList.toggle("hidden", !bits.length);
  }

  /** The facts line, the About line and the empty notes, read from what the page shows. */
  function paint() {
    // The facts line: the date, the quality, the length.
    facts.textContent = "";
    const date = sub.querySelector(".modal-release-date");
    const dateText = date ? (date.textContent || "").replace(/^\s*·\s*/, "").trim() : "";
    const q = document.getElementById("modal-quality");
    const parts = /** @type {HTMLElement[]} */ ([]);
    if (dateText) parts.push(make("span", "album-fact album-fact-date", dateText));
    // The quality follows UI Settings → Show sample rate, as the cover's badge did.
    if (q && !q.classList.contains("hidden") && q.textContent && document.body.classList.contains("show-quality")) {
      const chip = make("span", "album-fact album-fact-quality" + (q.classList.contains("is-hires") ? " is-hires" : ""), q.textContent);
      if (q.title) chip.title = q.title;
      parts.push(chip);
    }
    const len = length();
    if (len) parts.push(make("span", "album-fact album-fact-length", len));
    parts.forEach((p, i) => { if (i) facts.appendChild(make("span", "album-fact-sep", "·")); facts.appendChild(p); });
    facts.classList.toggle("is-empty", !parts.length);

    // About's line: the subtitle's extras but the date, as they are there (the label a link to the same place). Built
    // again only when they changed: it sits in the part of the page watched for changes, and would otherwise repaint
    // itself for ever.
    const sig = [...sub.querySelectorAll(".modal-sub-extra")].map((e) => e.className + "|" + e.textContent).join("\n");
    if (sig !== aboutSig) { aboutSig = sig; about(); }
    const bits = [...aboutHead.querySelectorAll(".album-about-bit")];

    // A tab with nothing in it says so.
    const key = modal.dataset.albumTab || "tracks";
    const credits = aside.querySelector(".credits-section");
    let note = "";
    if (key === "credits" && !shown(credits)) note = "No credits known for this album yet";
    if (key === "about" && !bits.length && ![...aside.children].some((c) => c !== aboutHead && c !== credits && shown(c))) {
      note = "Nothing more is known about this album yet";
    }
    empty.textContent = note;
    empty.classList.toggle("hidden", !note);
  }

  // ── What scrolls up past the tabs is clipped (Mandarin's items 358, 375) ───────────────────────────────────────
  const phone = W.matchMedia ? W.matchMedia("(max-width: 719px)") : null;
  const on = () => !!phone && phone.matches && !modal.classList.contains("np-mode") && !modal.classList.contains("hidden");
  /** @type {Map<HTMLElement, string>} */
  let clipped = new Map();
  // Each part's clip set only where it changes: the parts are watched for changes (above), and a clip written again
  // each time would repaint for ever.
  function clip() {
    /** @type {Map<HTMLElement, string>} */
    const want = new Map();
    if (on()) {
      const line = tabs.getBoundingClientRect().bottom;
      const held = tabs.getBoundingClientRect().top - body.getBoundingClientRect().top <= parseFloat(getComputedStyle(tabs).top || "0") + 1;
      // Only once the tabs are held at the top: until then nothing has reached them.
      const parts = held ? /** @type {HTMLElement[]} */ ([...body.querySelectorAll(":scope > *, :scope > .modal-info > *, :scope > .modal-info > #tab-album > *")]) : [];
      for (const e of parts) {
        if (e === tabs || e.contains(tabs) || e.classList.contains("modal-info") || e.id === "tab-album") continue;
        const r = e.getBoundingClientRect();
        if (r.height && r.top < line) want.set(e, `inset(${Math.round(Math.min(r.height, line - r.top))}px 0 0 0)`);
      }
    }
    for (const [e] of clipped) if (!want.has(e)) e.style.clipPath = "";
    for (const [e, v] of want) if (clipped.get(e) !== v) e.style.clipPath = v;
    clipped = want;
  }
  let queued = false;
  body.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; clip(); });
  }, { passive: true });
  if (phone && phone.addEventListener) phone.addEventListener("change", clip);

  // A new album opens on Tracks, at the top; what the page shows changing (the subtitle, the rows and their lengths,
  // the credits and the review arriving) is read again.
  let shownTitle = "";
  new MutationObserver(() => {
    const now = (title.textContent || "") + "\u0000" + (W.__currentAlbum ? JSON.stringify([W.__currentAlbum.title, W.__currentAlbum.subtitle || ""]) : "");
    if (now !== shownTitle) { shownTitle = now; tab("tracks"); return; }
    paint();
  }).observe(title, { childList: true, characterData: true, subtree: true });
  let again = false;
  // Next turn, not next frame: read again whether or not a frame is drawn meanwhile.
  const repaint = () => { if (again) return; again = true; setTimeout(() => { again = false; paint(); clip(); }, 0); };
  new MutationObserver(repaint).observe(sub, { childList: true, characterData: true, subtree: true });
  new MutationObserver(repaint).observe(tracks, { childList: true, subtree: true });
  new MutationObserver(repaint).observe(aside, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  new MutationObserver(repaint).observe(art, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true, characterData: true });
  new MutationObserver(() => { if (on()) repaint(); else clip(); }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(repaint).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  tab("tracks");

  W.RouenAlbumHead = { extras, tab };
})();
