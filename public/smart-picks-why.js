// @ts-check
/*
 * smart-picks-why.js — Why these picks (dev/design/smart-picks.md §6, 2.0.6-t22). On the Smart Picks screen, above
 * the picks, a "Why these picks" button; tapped, a sheet lists the day's seeds by genre, each with its score and what
 * it came from (whole albums played, the last 90 days and all time; tracks played on their own; "reduced: widely
 * played" where a famous artist counts a quarter), then the artists that came next and were not chosen, and the
 * numbers the scores are made with. Read from GET /api/smart-picks/why, the last build's.
 *
 * Its own script (app.js and index.html are at their length baselines): it watches the album grid for the Smart Picks
 * list (app.js showSmartPicks, the grid's .pick-list that is not Listen later's) and puts its button before it, so
 * app.js is untouched, with Tune's beside it (2.0.7-t1, smart-picks-tune.js). The sheet borrows the confirm dialog's
 * look (menus.js). A build's Tune is said at the top: what was set other than "As I listen".
 */
(function smartPicksWhy() {
  const grid = document.getElementById("album-grid");
  if (!grid) return;

  /** @param {string} s */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  const n = (/** @type {number} */ v, /** @type {string} */ one, /** @type {string} */ many) => v + " " + (v === 1 ? one : many);

  /** One seed's line: what it scored on. @param {any} s */
  function seedLine(s) {
    const parts = [];
    if (s.via === "owned") parts.push("among the artists you own most of (not enough listening yet)");
    else if (s.via === "more") parts.push("you asked for more from this artist (Tune)");
    else {
      if (s.albumPlays) parts.push(n(s.albumPlays, "whole-album play", "whole-album plays") + " (" + s.recentPlays + " in the last 90 days)");
      if (s.tracks) parts.push(n(s.tracks, "day", "days") + " of its tracks played on their own");
      if (s.hub) parts.push("reduced: widely played");
    }
    if (s.used === false) parts.push("not found on MusicBrainz, so not used");
    const albums = (s.albums || []).map((/** @type {any} */ a) => a.title).filter(Boolean);
    return `<li style="margin:0 0 10px"><strong>${esc(s.name)}</strong>${s.decade && s.decade !== "unknown" ? " · " + esc(s.decade) : ""}`
      + (s.via === "owned" ? "" : ` · score ${esc(s.score)}`)
      + `<br><span style="opacity:.75">${esc(parts.join("; "))}${albums.length ? "<br>" + esc(albums.join(", ")) : ""}</span></li>`;
  }

  /** The sheet's content. @param {any} w */
  function render(w) {
    if (!w) return "<p>Why these picks appears after the next daily build.</p>";
    /** @type {Map<string, any[]>} */
    const byGenre = new Map();
    for (const s of w.seeds || []) {
      const g = s.via === "owned" ? "Not enough listening yet" : s.via === "more" ? "More from (Tune)" : (s.genre || "Other");
      if (!byGenre.has(g)) byGenre.set(g, []);
      /** @type {any[]} */ (byGenre.get(g)).push(s);
    }
    let html = `<p style="opacity:.75;margin:0 0 12px">Built ${esc(new Date(w.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}. `
      + "Smart Picks starts from these artists of yours, shared out by genre as you listen, and looks for artists near them.</p>"
      + ((w.tuned || []).length ? `<p style="margin:0 0 12px"><strong>Tuned:</strong> ${esc(w.tuned.join("; "))}.</p>` : "");
    for (const [g, list] of byGenre) {
      html += `<h3 style="margin:14px 0 6px;font-size:1em">${esc(g)} · ${n(list.length, "seed", "seeds")}</h3><ul style="list-style:none;padding:0;margin:0">`
        + list.map(seedLine).join("") + "</ul>";
    }
    if ((w.left || []).length) {
      html += '<h3 style="margin:14px 0 6px;font-size:1em">Next in line, not chosen today</h3><p style="margin:0;opacity:.75">'
        + esc(w.left.map((/** @type {any} */ x) => x.name + " (" + x.score + ")").join(", ")) + "</p>";
    }
    const k = w.numbers || {};
    html += `<p style="opacity:.6;margin:14px 0 0;font-size:.9em">`
      + (k.halfLifeDays == null ? "Every whole album played counts 1, however long ago (Listening window: All time); "
        : `A whole album played counts 0.5, and up to 1 when recent (half-life ${esc(k.halfLifeDays)} days); `)
      + `an album's plays are square-rooted, so one record played often doesn't drown out the rest. A track played on its own counts ${esc(k.track)} of an album play, `
      + "once a day, weighed by age the same way, and all of an artist's together count no more than its albums' plays would. "
      + `A widely played artist counts ${esc(Math.round((k.hub || 0) * 100))}% of its score. A genre with ${esc(Math.round((k.minShare || 0) * 100))}% of your listening has a seed at least.</p>`;
    return html;
  }

  /** @type {HTMLElement | null} */
  let sheet = null;
  async function open() {
    if (!sheet) {
      document.body.insertAdjacentHTML("beforeend", `
        <div id="why-picks" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="why-picks-title">
          <div class="confirm-backdrop"></div>
          <div class="confirm-box" style="max-width:560px;width:100%;max-height:80vh;overflow:auto;text-align:left">
            <h2 id="why-picks-title" style="margin:0 0 10px;font-size:1.15em">Why these picks</h2>
            <div id="why-picks-body"></div>
            <div class="confirm-actions" style="margin-top:14px"><button class="confirm-btn confirm-primary" id="why-picks-close" type="button">Close</button></div>
          </div>
        </div>`);
      sheet = /** @type {HTMLElement} */ (document.getElementById("why-picks"));
      const close = () => /** @type {HTMLElement} */ (sheet).classList.add("hidden");
      /** @type {HTMLElement} */ (document.getElementById("why-picks-close")).addEventListener("click", close);
      /** @type {HTMLElement} */ (sheet.querySelector(".confirm-backdrop")).addEventListener("click", close);
    }
    const body = /** @type {HTMLElement} */ (document.getElementById("why-picks-body"));
    body.innerHTML = "<p>Reading…</p>";
    sheet.classList.remove("hidden");
    /** @type {Response | null} */
    let r = null;
    try { r = await fetch("/api/smart-picks/why", { cache: "no-store" }); }
    catch (e) { body.innerHTML = "<p>Rouen could not be reached.</p>"; return; }
    if (!r.ok) { body.innerHTML = `<p>Couldn't read why these picks (HTTP ${r.status}).</p>`; return; }
    try { body.innerHTML = render((await r.json()).why); }
    catch (e) { body.innerHTML = "<p>Couldn't read why these picks: " + esc(/** @type {Error} */ (e).message) + "</p>"; }
  }

  /** The buttons, Why these picks and Tune, before the Smart Picks list whenever it is on the grid. */
  function place() {
    const list = Array.prototype.find.call(grid.children, (/** @type {Element} */ el) => el.classList.contains("pick-list") && !el.classList.contains("later-list"));
    const row = document.getElementById("picks-tools");
    if (!list) { if (row) row.remove(); return; }
    if (row && row.nextElementSibling === list) return;
    const r = row || Object.assign(document.createElement("div"), { id: "picks-tools" });
    if (!row) {
      r.style.cssText = "grid-column:1 / -1;display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px";
      const why = Object.assign(document.createElement("button"), { id: "why-picks-open", type: "button", className: "confirm-btn", textContent: "Why these picks" });
      why.style.cssText = "flex:0 0 auto;padding:0 14px";
      why.addEventListener("click", open);
      const tune = Object.assign(document.createElement("button"), { id: "tune-picks-open", type: "button", className: "confirm-btn", textContent: "Tune" });
      tune.style.cssText = "flex:0 0 auto;padding:0 14px";
      tune.addEventListener("click", () => { const t = /** @type {any} */ (window).RouenTune; if (t) t.open(); });
      r.append(why, tune);
    }
    grid.insertBefore(r, list);
  }
  new MutationObserver(place).observe(grid, { childList: true });
  place();
})();
