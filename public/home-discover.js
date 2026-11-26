// @ts-check
/*
 * home-discover.js — Home's "Discover" row (2.0.8-t8). The owner, 2026-11-26: "Discover and smart picks just aren't
 * showing on home screen and they are set to". Home had no Discover row: Discover was only a screen of the side menu.
 * Now it is one of Home's rows (lib/routes/home-rows.js, "discover", after Smart Picks): app.js puts it in its place and
 * hides it when switched off, as every row, by its data-row; Settings → Home Screen lists it. It shows Discover's newest
 * records, as its screen draws them (share-card-make.js row: a record you have opens its album, one you don't opens it
 * through Roon's search, 2.0.6-t14), the first SHOWN of them; its title opens the whole screen. With nothing new it
 * says so rather than hide; Discover switched off (Settings → Discover), it is not shown.
 */
(function rouenHomeDiscover() {
  "use strict";
  const W = /** @type {any} */ (window);
  /** How many records the row shows; the title opens them all. */
  const SHOWN = 6;
  /** How often the row asks again while the page is open: Discover is built once a day. After a failed ask, and while
   * a build runs, sooner. */
  const EVERY_MS = 30 * 60 * 1000, RETRY_MS = 60 * 1000, BUILDING_MS = 2 * 60 * 1000;

  const sections = document.getElementById("home-sections");
  const box = document.createElement("div");
  box.className = "home-section home-section-discover hidden";
  box.dataset.row = "discover";
  const head = document.createElement("h2");
  head.className = "home-section-title home-section-link";
  head.id = "home-discover-title";
  head.textContent = "Discover";
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  const list = document.createElement("div");
  list.id = "home-discover";
  // Its own class, not the screen's (.discover-list): the screen and its tests find their list by that one alone.
  list.className = "home-discover-list";
  const note = document.createElement("div");
  note.className = "home-carousel-empty";
  box.append(head, list, note);
  /** After Smart Picks, else last. */
  function place() {
    if (!sections) return;
    const picks = sections.querySelector('[data-row="picks"]');
    if (picks && picks.parentElement === sections) sections.insertBefore(box, picks.nextSibling);
    else sections.appendChild(box);
  }
  place();
  // app.js lays Home out by appending the rows its layout lists, in order; a row it doesn't list stays where it was,
  // ahead of them all. The server's layout always lists Discover (home-rows.js), but app.js's own default, used while
  // the server can't be asked, doesn't: a layout pass (rows moved at once) that leaves this row out puts it back.
  if (sections && typeof MutationObserver === "function") {
    new MutationObserver((records) => {
      const moved = records.flatMap((r) => Array.from(r.addedNodes)).filter((n) => n instanceof HTMLElement && n.dataset.row);
      if (moved.length > 1 && !moved.includes(box)) place();
    }).observe(sections, { childList: true });
  }

  const open = () => { if (typeof W.__showDiscover === "function") W.__showDiscover(); };
  head.addEventListener("click", open);
  head.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });

  /**
   * A release date as the Discover screen says it (app.js discoverWhen, its wording kept the same here: app.js gives no
   * way to it): "today", "3 days ago", "2 weeks ago", then the month. @param {unknown} dateStr
   */
  function whenOf(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
    if (!m) return "";
    const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const midnight = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((midnight(new Date()) - midnight(then)) / 86400000);
    if (!Number.isFinite(days) || days < 0) return "";
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    if (days < 14) return "last week";
    if (days < 60) return Math.floor(days / 7) + " weeks ago";
    return then.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  /** A record's quiet line: who made it, and when. @param {any} r */
  const subOf = (r) => [r.artist, whenOf(r.release_date)].filter(Boolean).join(" · ");
  /** Its cover: the library's when it has the album, else the record's own. @param {any} r */
  const artOf = (r) => (r.image_key ? "/api/image/" + encodeURIComponent(r.image_key) + "?size=160" : r.cover || "");

  /** Whether Discover is switched on, as the server last said (the layout's own switch is app.js's). */
  let enabled = true;
  /** @param {any} j */
  function paint(j) {
    enabled = !(j && j.enabled === false);
    if (!enabled) { box.classList.add("discover-off"); return; }
    box.classList.remove("discover-off");
    const releases = (j && Array.isArray(j.releases) ? j.releases : []).filter((r) => r && r.album).slice(0, SHOWN);
    list.textContent = "";
    note.textContent = "";
    if (!releases.length) {
      note.textContent = j && j.building ? "Looking for new records by the artists you play — they appear here when found."
        : "Nothing new from the artists you play just now. Discover looks again every day.";
      return;
    }
    if (typeof W.__goRow !== "function") { note.textContent = "Couldn't draw Discover — reload the app."; return; }
    for (const r of releases) list.appendChild(W.__goRow(r, r.album, subOf(r), artOf(r)));
  }

  /** The next look, sooner than EVERY_MS: after a failed one, and while a build is under way (the review). */
  let soon = /** @type {any} */ (null);
  /** @param {number} ms */
  const again = (ms) => { if (soon) clearTimeout(soon); soon = setTimeout(() => { soon = null; load(); }, W.__rouenDiscoverSoonMs || ms); };   // tests: sooner
  let loaded = false;
  async function load() {
    // Switched off in Settings → Home Screen (app.js hides it): not asked, once it has been laid out.
    if (loaded && box.classList.contains("hidden")) return;
    try {
      const r = await fetch("/api/discover", { cache: "no-store" });
      if (!r.ok) { again(RETRY_MS); return; }   // not paired yet (a restart), or a moment's fault: again within a minute
      const j = await r.json();
      loaded = true;
      paint(j);
      if (j && j.building) again(BUILDING_MS);
    } catch (e) { again(RETRY_MS); }   // unreachable for a moment: the row keeps what it had, and asks again soon
  }

  /** Settings → Home Screen names it as Home does (once: app.js's list, with this row). */
  let named = false;
  function name() {
    const titles = W.__homeRowTitles;
    if (named || typeof titles !== "function") return;
    named = true;
    W.__homeRowTitles = () => Object.assign({}, titles(), { discover: "Discover" });
  }

  const style = document.createElement("style");
  // The Discover screen's rows' look (style.css .discover-list), under this row's own class.
  style.textContent = `.home-section-discover.discover-off { display: none !important; }
    .home-discover-list { display: flex; flex-direction: column; gap: 8px; }
    .home-discover-list .share-similar-act { align-items: center; flex-wrap: wrap; row-gap: 4px; padding: 10px 12px; border-radius: 12px; }
    .home-discover-list .share-similar-act:not(.has-art) .share-similar-name { flex: 1 1 100%; min-width: 0; white-space: normal;
      font-size: calc(15px * var(--ui-chrome, 1)); line-height: 1.3; }
    .home-discover-list .share-similar-rec { font-size: calc(12.5px * var(--ui-chrome, 1)); }
    .home-discover-list .share-similar-act.has-art { align-items: center; padding: 10px; }`;
  (document.head || document.documentElement).appendChild(style);

  const ready = () => { name(); load(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(load, EVERY_MS);
})();
