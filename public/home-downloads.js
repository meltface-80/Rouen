// @ts-check
/*
 * home-downloads.js — Home's "Downloaded" row in the Android app: the albums wholly on the phone, online and offline
 * alike (dev/design/android-app.md §4.19, v1.9.72-t32). The owner, 2026-10-30: "I want a downloads carousel to be
 * present when there are downloaded albums regardless of being offline. This downloads carousel will be added to the
 * home screen settings page and moveable like the others".
 *
 * The row is one of Home's rows (lib/routes/home-rows.js, "downloads", first by default): app.js puts it in its place
 * and hides it when switched off, as every row, by its data-row. It is only in the app (window.RouenPhone): a browser
 * has no downloads, so there it is neither on Home nor in Settings → Home Screen. With no album on the phone it hides
 * itself, as History does. A tile opens the album as any other: online Rouen's own album view, through Roon; offline
 * the download's (offline.js). Covers: phone-local.js's (the download's own offline, Roon's online).
 */
(function rouenHomeDownloads() {
  "use strict";
  const W = /** @type {any} */ (window);
  const bridge = W.RouenPhone;
  const app = !!(bridge && typeof bridge.albums === "function");

  const style = document.createElement("style");
  style.textContent = `
    .home-section-downloads.dl-empty { display: none; }
    html:not(.rouen-app) .home-row-item[data-row="downloads"] { display: none; }`;
  (document.head || document.documentElement).appendChild(style);
  if (!app) return;
  document.documentElement.classList.add("rouen-app");

  /** The albums wholly on the phone, as the page's album tiles (phone-local.js's). @returns {any[]} */
  const albums = () => (W.RouenLocal ? W.RouenLocal.albums() : []);

  // Made now, before app.js runs, so the row is there when Home's layout first puts the rows in order.
  const sections = document.getElementById("home-sections");
  const box = document.createElement("div");
  box.className = "home-section home-section-downloads dl-empty";
  box.dataset.row = "downloads";
  const head = document.createElement("h2");
  head.className = "home-section-title";
  head.textContent = "Downloaded";
  const row = document.createElement("div");
  row.id = "home-downloads";
  row.className = "home-carousel home-carousel-1row";
  box.append(head, row);
  if (sections) sections.insertBefore(box, sections.firstChild);

  /** Its tiles, afresh when the albums on the phone are not the ones shown: a download moves on each track, and its
   * tiles (their covers, a selection) stay as they are until an album comes or goes. */
  let shown = "";
  function paint() {
    const list = albums();
    box.classList.toggle("dl-empty", !list.length);
    if (typeof W.__buildAlbumTile !== "function") return;
    const sig = JSON.stringify(list);
    if (sig === shown) return;
    shown = sig;
    row.textContent = "";
    for (const a of list) row.appendChild(W.__buildAlbumTile(a));
  }

  /** Settings → Home Screen names it as Home does (once: app.js's list, with this row). */
  let named = false;
  function name() {
    const titles = W.__homeRowTitles;
    if (named || typeof titles !== "function") return;
    named = true;
    W.__homeRowTitles = () => Object.assign({}, titles(), { downloads: "Downloaded" });
  }

  const heard = W.__rouenDownloadsChanged;
  W.__rouenDownloadsChanged = () => {
    if (typeof heard === "function") heard();
    if (W.RouenLocal) W.RouenLocal.forget();
    paint();
  };
  const ready = () => { name(); paint(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
