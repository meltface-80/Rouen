// @ts-check
/*
 * smart-picks-tune.js — Tune (dev/design/smart-picks.md §5, 2.0.7-t1). A sheet with the Listening window and Adventure
 * (five stops each), your top genres and the decades you play (each Never / Less / As I listen / More), and the
 * artists set to More from or Never start from; Reset puts the sheet back to "As I listen", and Save keeps it and
 * rebuilds today's picks. Opened from Settings → Setup → Smart Picks → Tune (#picks-tune) and from the Smart Picks
 * screen's Tune button (smart-picks-why.js); each pick's own Tune button shows the artists it came from, each with
 * More from and Never start from. Read and written through /api/smart-picks/tune (lib/routes/smart-picks-actions.js);
 * a pick's starting artists come from /api/smart-picks/why.
 *
 * Its own script, so app.js is untouched: it watches the album grid for the Smart Picks list's cards. The sheets
 * borrow the confirm dialog's look (menus.js), above Settings.
 */
(function smartPicksTune() {
  /** @param {string} s */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  const LEVELS = [["never", "Never"], ["less", "Less"], ["as", "As I listen"], ["more", "More"]];
  const same = (/** @type {string} */ a, /** @type {string} */ b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  /** @type {HTMLElement | null} */
  let sheet = null;
  /** The sheet's view as last read (GET /api/smart-picks/tune), and the Tune being edited. @type {any} */
  let view = null;
  /** @type {any} */
  let draft = null;
  /** Which opening of the sheet is showing: an answer or a timer of an earlier one leaves a newer one alone. */
  let opened = 0;

  /** The overlay, made once; `kind` says which content it holds now. */
  function ensureSheet() {
    if (sheet) return sheet;
    document.body.insertAdjacentHTML("beforeend", `
      <div id="tune-picks" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="tune-picks-title">
        <div class="confirm-backdrop"></div>
        <div class="confirm-box" style="max-width:560px;width:100%;min-width:0;box-sizing:border-box;max-height:85vh;overflow:auto;text-align:left">
          <h2 id="tune-picks-title" style="margin:0 0 10px;font-size:1.15em">Tune Smart Picks</h2>
          <div id="tune-picks-body"></div>
          <p id="tune-picks-note" role="status" style="margin:10px 0 0;opacity:.8"></p>
          <div class="confirm-actions" id="tune-picks-actions" style="margin-top:14px"></div>
        </div>
      </div>`);
    sheet = /** @type {HTMLElement} */ (document.getElementById("tune-picks"));
    /** @type {HTMLElement} */ (sheet.querySelector(".confirm-backdrop")).addEventListener("click", close);
    return sheet;
  }
  function close() { if (sheet) sheet.classList.add("hidden"); }
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const note = (/** @type {string} */ text) => { $("tune-picks-note").textContent = text; };
  /** @param {Array<[string, string, string]>} buttons  [id, label, class] */
  function actions(buttons) {
    $("tune-picks-actions").innerHTML = buttons.map(([id, label, cls]) =>
      `<button class="confirm-btn ${cls}" id="${id}" type="button">${esc(label)}</button>`).join("");
  }

  /** @param {string} url @param {any} [body] */
  async function call(url, body) {
    /** @type {Response} */
    let r;
    try {
      r = await fetch(url, body === undefined ? { cache: "no-store" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { throw new Error("Rouen could not be reached."); }
    /** @type {any} */
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }   // an answer that isn't JSON is said below by its status
    if (!r.ok || !j) throw new Error((j && j.error) || "HTTP " + r.status);
    return j;
  }

  // ---- The Tune sheet ----------------------------------------------------------------------------------------------

  /** A five-stop slider. @param {string} id @param {string} label @param {string[]} stops @param {number} v */
  function slider(id, label, stops, v) {
    return `<label for="${id}" style="display:block;margin:12px 0 2px;font-weight:600">${esc(label)}: <span id="${id}-v">${esc(stops[v])}</span></label>`
      + `<input id="${id}" type="range" min="0" max="4" step="1" value="${v}" style="width:100%" aria-valuetext="${esc(stops[v])}">`
      + `<div style="display:flex;justify-content:space-between;font-size:.85em;opacity:.7"><span>${esc(stops[0])}</span><span>${esc(stops[4])}</span></div>`;
  }

  /** One genre's or decade's Never / Less / As I listen / More. @param {string} group @param {{ name: string, share: number }} it */
  function chips(group, it) {
    const cur = (draft[group] || {})[it.name] || "as";
    const pct = it.share ? " " + Math.round(it.share * 100) + "%" : "";
    return `<div style="margin:8px 0"><div style="font-size:.95em">${esc(it.name)}<span style="opacity:.6">${esc(pct)}</span></div>`
      + `<div role="radiogroup" aria-label="${esc(it.name)}" style="display:flex;gap:4px;margin-top:4px">`
      + LEVELS.map(([lv, word]) => `<button type="button" role="radio" aria-checked="${cur === lv}" data-group="${esc(group)}" data-key="${esc(it.name)}" data-level="${lv}"`
        + ` class="pick-block" style="flex:1 1 0;padding:4px 3px;min-width:0;white-space:normal;line-height:1.15;font-size:.85em${cur === lv ? ";border-color:var(--accent);color:var(--text)" : ""}">${esc(word)}</button>`).join("")
      + "</div></div>";
  }

  /** The artists set to More from or Never start from, each with ✕. @param {"more" | "never"} which @param {string} title */
  function people(which, title) {
    const list = draft[which] || [];
    return `<h3 style="margin:16px 0 6px;font-size:1em">${esc(title)}</h3>`
      + (list.length ? list.map((/** @type {string} */ name) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(name)}</span>`
        + `<button type="button" class="pick-block" data-remove="${which}" data-name="${esc(name)}" aria-label="Remove ${esc(name)}">✕</button></div>`).join("")
        : '<p style="margin:0;opacity:.7">None. A pick\'s Tune button adds one.</p>');
  }

  /** Genres and decades listed: those of your listening, then any set before that are no longer among them. @param {string} group */
  function itemsOf(group) {
    const listed = (view[group] || []).slice();
    for (const k of Object.keys(draft[group] || {})) if (!listed.some((/** @type {any} */ x) => x.name === k)) listed.push({ name: k, share: 0 });
    return listed;
  }

  function renderTune() {
    const g = itemsOf("genres");
    const d = itemsOf("decades");
    $("tune-picks-title").textContent = "Tune Smart Picks";
    $("tune-picks-body").innerHTML =
      '<p style="opacity:.75;margin:0 0 4px">Where Smart Picks starts from, and how far it goes. Left at 3 months, Far and \u201cAs I listen\u201d, it works as it does untuned.</p>'
      + slider("tune-window", "Listening window", view.windows, draft.window)
      + slider("tune-adventure", "Adventure", view.adventures, draft.adventure)
      + '<h3 style="margin:16px 0 2px;font-size:1em">Genres</h3>'
      + (g.length ? g.map((it) => chips("genres", it)).join("") : '<p style="margin:0;opacity:.7">None yet: they come from whole albums played.</p>')
      + '<h3 style="margin:16px 0 2px;font-size:1em">Decades</h3>'
      + (d.length ? d.map((it) => chips("decades", it)).join("") : '<p style="margin:0;opacity:.7">None yet.</p>')
      + people("more", "More from") + people("never", "Never start from");
    actions([["tune-picks-reset", "Reset", ""], ["tune-picks-cancel", "Cancel", ""], ["tune-picks-save", "Save", "confirm-primary"]]);
    for (const [id, stops, key] of /** @type {Array<[string, string[], string]>} */ ([["tune-window", view.windows, "window"], ["tune-adventure", view.adventures, "adventure"]])) {
      const input = /** @type {HTMLInputElement} */ ($(id));
      input.addEventListener("input", () => {
        draft[key] = Number(input.value);
        $(id + "-v").textContent = stops[draft[key]];
        input.setAttribute("aria-valuetext", stops[draft[key]]);
      });
    }
    $("tune-picks-reset").addEventListener("click", () => {
      draft = { window: 2, adventure: 4, genres: {}, decades: {}, more: [], never: [] };   // tune.js defaultTune
      renderTune();
      note("Back to “As I listen”. Save to keep it.");
    });
    $("tune-picks-cancel").addEventListener("click", close);
    $("tune-picks-save").addEventListener("click", save);
  }

  async function save() {
    const btn = /** @type {HTMLButtonElement} */ ($("tune-picks-save"));
    btn.disabled = true;
    note("Saving…");
    const mine = opened;
    try {
      const j = await call("/api/smart-picks/tune", { tune: draft });
      if (mine !== opened) return;
      view = j;
      note(j.note || "Saved. Today's picks are being rebuilt: they appear on the Smart Picks screen in a minute or two.");
      setTimeout(() => { if (mine === opened) close(); }, 1600);
    } catch (e) {
      if (mine !== opened) return;
      note("Couldn't save: " + /** @type {Error} */ (e).message);
      btn.disabled = false;
    }
  }

  /** Opens the Tune sheet. */
  async function open() {
    ensureSheet();
    const mine = ++opened;
    $("tune-picks-title").textContent = "Tune Smart Picks";
    $("tune-picks-body").innerHTML = "<p>Reading…</p>";
    actions([["tune-picks-cancel", "Close", ""]]);
    $("tune-picks-cancel").addEventListener("click", close);
    note("");
    /** @type {HTMLElement} */ (sheet).classList.remove("hidden");
    /** @type {any} */
    let v;
    try { v = await call("/api/smart-picks/tune"); }
    catch (e) { if (mine === opened) $("tune-picks-body").innerHTML = `<p>Couldn't read Tune: ${esc(/** @type {Error} */ (e).message)}</p>`; return; }
    if (mine !== opened) return;
    view = v;
    draft = JSON.parse(JSON.stringify(view.tune));
    renderTune();
  }

  // Chips and ✕, by delegation: the sheet's content is redrawn on every change.
  document.addEventListener("click", (ev) => {
    const el = /** @type {HTMLElement | null} */ (ev.target instanceof Element ? ev.target.closest("[data-level],[data-remove]") : null);
    if (!el || !sheet || !sheet.contains(el) || !draft) return;
    if (el.dataset.level) {
      const group = /** @type {string} */ (el.dataset.group);
      const key = /** @type {string} */ (el.dataset.key);
      draft[group] = Object.assign({}, draft[group]);
      if (el.dataset.level === "as") delete draft[group][key]; else draft[group][key] = el.dataset.level;
    } else {
      const which = /** @type {string} */ (el.dataset.remove);
      draft[which] = draft[which].filter((/** @type {string} */ n) => n !== el.dataset.name);
    }
    const y = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (sheet).querySelector(".confirm-box")).scrollTop;
    renderTune();
    /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (sheet).querySelector(".confirm-box")).scrollTop = y;
  });

  // ---- One pick's starting artists -----------------------------------------------------------------------------------

  /** The pick's sheet: the artists it came from, each More from / Never start from. @param {string} artist */
  async function openPick(artist) {
    ensureSheet();
    const mine = ++opened;
    $("tune-picks-title").textContent = "Tune: " + artist;
    $("tune-picks-body").innerHTML = "<p>Reading…</p>";
    actions([["tune-picks-all", "All Tune settings", ""], ["tune-picks-cancel", "Close", "confirm-primary"]]);
    $("tune-picks-all").addEventListener("click", () => { open(); });
    $("tune-picks-cancel").addEventListener("click", close);
    note("");
    /** @type {HTMLElement} */ (sheet).classList.remove("hidden");
    /** @type {string[]} */
    let seeds = [];
    /** @type {any} */
    let v = null;
    try {
      const why = (await call("/api/smart-picks/why")).why;
      const entry = why && (why.picks || []).find((/** @type {any} */ p) => same(p.artist, artist));
      seeds = entry ? entry.seeds : [];
      // Each one's More / Never as the server matches names, never guessed here.
      if (seeds.length) v = await call("/api/smart-picks/tune?names=" + encodeURIComponent(JSON.stringify(seeds)));
    } catch (e) {
      if (mine === opened) $("tune-picks-body").innerHTML = `<p>Couldn't read this pick's starting artists: ${esc(/** @type {Error} */ (e).message)}</p>`;
      return;
    }
    if (mine !== opened) return;
    if (!seeds.length) {
      $("tune-picks-body").innerHTML = "<p>Where this pick came from is kept from the next build on. Rebuild today's picks, or use All Tune settings.</p>";
      return;
    }
    view = v;
    drawPick(artist, seeds, mine);
  }

  /** @param {string} artist @param {string[]} seeds @param {number} mine  the opening it belongs to */
  function drawPick(artist, seeds, mine) {
    const states = view.states || {};
    $("tune-picks-body").innerHTML = `<p style="opacity:.75;margin:0 0 8px">${esc(artist)} was suggested because you play `
      + esc(seeds.join(" and ")) + ". Each change rebuilds today's picks.</p>"
      + seeds.map((name) => {
        const more = states[name] === "more";
        const never = states[name] === "never";
        const b = (/** @type {string} */ as, /** @type {string} */ label, /** @type {boolean} */ on) =>
          `<button type="button" class="pick-block" data-seed="${esc(name)}" data-as="${on ? "none" : as}" aria-pressed="${on}"`
          + ` style="flex:1 1 0;min-width:0;white-space:normal;padding:6px 10px${on ? ";border-color:var(--accent);color:var(--text)" : ""}">${esc(label)}</button>`;
        return `<div style="margin:10px 0"><div style="font-weight:600;margin-bottom:4px">${esc(name)}</div>`
          + `<div style="display:flex;gap:6px">${b("more", "More from " + name, more)}${b("never", "Never start from " + name, never)}</div></div>`;
      }).join("");
    for (const btn of Array.from(/** @type {HTMLElement} */ ($("tune-picks-body")).querySelectorAll("[data-seed]"))) {
      btn.addEventListener("click", async () => {
        const el = /** @type {HTMLButtonElement} */ (btn);
        // One change at a time: two in flight could answer out of order.
        const all = Array.from(/** @type {NodeListOf<HTMLButtonElement>} */ ($("tune-picks-body").querySelectorAll("[data-seed]")));
        for (const b of all) b.disabled = true;
        note("Saving…");
        try {
          const v = await call("/api/smart-picks/tune/artist", { name: el.dataset.seed, as: el.dataset.as, names: seeds });
          if (mine !== opened) return;
          view = v;
          drawPick(artist, seeds, mine);
          note(view.note || "Saved. Today's picks are being rebuilt.");
        } catch (e) {
          if (mine !== opened) return;
          note("Couldn't save: " + /** @type {Error} */ (e).message);
          for (const b of all) b.disabled = false;
        }
      });
    }
  }

  // ---- Where it opens from -------------------------------------------------------------------------------------------

  document.addEventListener("click", (ev) => {
    if (ev.target instanceof Element && ev.target.closest("#picks-tune")) open();
  });

  /** Each Smart Picks card (not Listen later's) gains its Tune button. */
  function placeOnPicks() {
    const grid = document.getElementById("album-grid");
    if (!grid) return;
    for (const acts of Array.from(grid.querySelectorAll(".pick-list:not(.later-list) .pick-card-full .pick-actions"))) {
      if (acts.querySelector(".pick-tune")) continue;
      const card = /** @type {HTMLElement} */ (acts.closest(".pick-card"));
      const name = ((card.querySelector(".pick-artist") || {}).textContent || "").trim();
      if (!name) continue;
      const b = Object.assign(document.createElement("button"), { type: "button", className: "pick-block pick-tune", textContent: "Tune" });
      b.setAttribute("aria-label", "Tune: where " + name + " came from");
      b.addEventListener("click", (e) => { e.stopPropagation(); openPick(name); });
      acts.appendChild(b);
    }
  }
  const grid = document.getElementById("album-grid");
  if (grid) new MutationObserver(placeOnPicks).observe(grid, { childList: true, subtree: true });
  placeOnPicks();

  /** @type {any} */ (window).RouenTune = { open, openPick };
})();
