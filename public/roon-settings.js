// @ts-check
/*
 * roon-settings.js — Settings → Native mode (v1.9.18; named so since v1.9.23,
 * the owner: the page names Roon once, in its notice, saying Rouen is not
 * affiliated with them — everywhere else it is "your server"): its switch and what
 * it is doing (dev/design/roon-native.md §10.4). Built here in script, as the
 * Random Album sheet is (index.html is at its length baseline).
 *
 * Loaded before app.js: app.js collects the Settings panes, names the ⓘ
 * buttons and answers their taps when it starts, so the page and its entry in
 * the Settings list must already be in place. Everything else is here: the
 * status read from /api/roon-direct, the switch posted back, and while a read
 * or a check runs, the status asked again every few seconds the page is open.
 */
(function roonSettings() {
  "use strict";
  // The notice's links (v1.9.20): Arthur Soares' project and his Roon Community
  // thread (as deep-roon-mcp's README gives them), Rouen's licence and issues.
  const REPO = "https://github.com/arthursoares/roon-api-reverse-engineering";
  const THREAD = "https://community.roonlabs.com/t/reverse-engineering-the-roon-desktop-clients-local-protocol-typescript-client-docs/321731";
  const LICENCE = "https://github.com/meltface-80/Rouen/blob/main/LICENSE";
  const ISSUES = "https://github.com/meltface-80/Rouen/issues";
  const after = document.querySelector('.settings-nav-item[data-pane="streaming"]');
  const paneAfter = document.querySelector('.settings-pane[data-pane="streaming"]');
  if (!after || !paneAfter) return;
  after.insertAdjacentHTML("afterend", `
          <button class="settings-nav-item" type="button" data-pane="roon">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Native mode</span>
            </span>
          </button>`);
  paneAfter.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="roon">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Native mode</h2>
        </div>
        <p class="settings-pane-desc">Your library, straight from your server</p>
        <!-- Read this first (v1.9.20, the owner's wording, after deep-roon-mcp's; v1.9.23: the one place
             the page names Roon, to say Rouen is not affiliated with them). -->
        <div class="settings-block roon-direct-notice">
          <div class="settings-note"><strong>Read this first.</strong> Native mode is an unofficial development. Rouen is
            <strong>not affiliated with Roon Labs</strong>, and native mode is not made, endorsed or supported by them — this is
            the only place Rouen names them. Native mode talks to your server through its private protocol, the one your
            server's own apps use, by way of Arthur Soares'
            <a href="${REPO}" target="_blank" rel="noopener noreferrer">reverse-engineering project</a>, which its makers allow
            for tinkering with your own system. Their CTO, Brian Luczkiewicz, on that protocol: it is “not hardened for 3rd
            party use”, it can change with any server update, and misuse can cause memory or compute leaks in your server.
            Read <a href="${THREAD}" target="_blank" rel="noopener noreferrer">Arthur's thread on the community forum</a>
            before you use it.</div>
          <div class="settings-note">Use it entirely at your own risk. It comes without any warranty (see the
            <a href="${LICENCE}" target="_blank" rel="noopener noreferrer">licence</a>). If your server misbehaves, turn native mode
            off and restart your server. Report problems <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">here</a>,
            never to your server's makers. Keep port 9332 on your own network, never forward it to the internet. A server update
            can break native mode until Rouen is updated. With native mode switched off (the switch below) only the official
            extension API is used.</div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Native mode (experimental) <button class="settings-info-btn" data-info="Rouen talks to your server the way its own apps do, through its private protocol, over one connection it keeps open (and opens afresh every night at 04:00, and after any drop or error). Your library is then your server&#x27;s own album list, each album with the source your server gives it. A heart is your server&#x27;s own favourite, and Listen later, Dynamic Playlists (its smart playlists) and playlists are its own, shared with its own apps: what Rouen kept of its own moves onto them by itself. Album pages and playing still go through the official extension API for now. If a read fails, Rouen goes back to the official API&#x27;s list and says why here, and tries again on the next connection or library change. After every Rouen or server update it checks itself first, and turns itself off if the check fails. Unofficial: a server update may break it." aria-label="About native mode">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="roon-direct-enabled" aria-label="Native mode">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note">Your library is your server's own album list, each album with the source your server gives it: the Source counts in Focus and the source icon on album tiles, straight from your server.</div>
          <div id="roon-direct-status" class="settings-token-status" role="status" aria-live="polite"></div>
        </div>
        <!-- Hearts are always on (v1.9.63, native-remote.md §13): only whose, when your server has several profiles. -->
        <div class="settings-block hidden" id="roon-hearts-block">
          <div class="settings-row">
            <span class="settings-label">Whose favourites <button class="settings-info-btn" data-info="Hearts are always on with native mode: the heart on the album view, and Add to favourites for tracks, write your server&#x27;s own favourite, as its own apps do, for the profile chosen here." aria-label="About whose favourites">&#9432;</button></span>
            <select id="roon-hearts-profile" class="settings-select" aria-label="Whose favourites"></select>
          </div>
          <div id="roon-hearts-status" class="settings-token-status" role="status" aria-live="polite"></div>
        </div>
        <!-- The status board (v1.9.63, native-remote.md §13): one row per thing native mode does, green, red or grey. -->
        <div class="settings-block hidden" id="roon-board-block">
          <div class="settings-row">
            <span class="settings-label">Status <button class="settings-info-btn" data-info="One row for each thing native mode does with your server. Green: its last read or write worked. Red: it is failing now, and the row says why. Grey: not used yet on this connection, or waiting. Listen later, Dynamic Playlists and Rouen&#x27;s own playlists move onto your server by themselves each time Rouen connects; one that can&#x27;t move stays Rouen&#x27;s, shown red here with why." aria-label="About the status board">&#9432;</button></span>
          </div>
          <ul id="roon-board" class="settings-note" style="list-style:none;padding-left:0"></ul>
        </div>
      </div>`);

  const pane = /** @type {HTMLElement} */ (document.querySelector('.settings-pane[data-pane="roon"]'));
  const box = /** @type {HTMLInputElement} */ (document.getElementById("roon-direct-enabled"));
  const line = /** @type {HTMLElement} */ (document.getElementById("roon-direct-status"));
  /** @type {ReturnType<typeof setTimeout> | null} */
  let again = null;

  const n = (/** @type {number} */ v) => Number(v || 0).toLocaleString();
  const when = (/** @type {number} */ t) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const took = (/** @type {number} */ ms) => (ms >= 60000 ? Math.floor(ms / 60000) + " min " + Math.round((ms % 60000) / 1000) + " s" : Math.max(1, Math.round(ms / 1000)) + " s");

  /** What the status says, in lines. @param {any} s */
  function describe(s) {
    if (!s.on) return s.offReason ? ["Turned itself off " + when(s.offAt) + ": " + s.offReason, "Turn it on again to try once more."] : ["Off."];
    if (s.checking) return ["Checking after an update (" + s.checking + ")…", "Until the check passes, Rouen works out sources itself."];
    if (s.reading && !s.lastRead) return ["Reading your library from your server…"];
    /** @type {string[]} */
    const out = [];
    const r = s.report, lib = s.library;
    // Native status (v1.9.21): the connection, and what the screens were given.
    const link = s.link;
    if (link && link.up) out.push("Connected to your server since " + when(link.since) + " · " + n(link.objects) + " objects held" + (link.reconnects ? " · reconnected " + n(link.reconnects) + "×" : "") + ".");
    else if (link) out.push("Connecting to your server…");
    // v1.9.24: kept open by keepalives; three in a row unanswered is worth saying.
    if (link && link.up && link.keepalive && link.keepalive.missed >= 3) out.push("Your server is not answering Rouen's keepalives.");
    if (link && link.lastDown) out.push("Last reconnect " + when(link.lastDown.at) + ": " + link.lastDown.why + ".");
    if (s.fellBack) out.push("The last read failed " + when(s.fellBack.at) + ": " + s.fellBack.why + " Until a read succeeds, your library is the official API's list.");
    if (lib) {
      out.push("Your library is your server's own list: " + n(lib.albums) + " albums — Local " + n(lib.bySource.local) + " · Qobuz " + n(lib.bySource.qobuz) + " · TIDAL " + n(lib.bySource.tidal) + (lib.bySource.none ? " · no source " + n(lib.bySource.none) : "") + ".");
      // Opened through the official API until album pages go native (N1b).
      if (lib.unpaired) out.push(n(lib.unpaired) + " of them the official API lists under another name: those open through your server's search.");
    } else if (r) {
      out.push("Matched " + n(r.matched) + " of " + n(r.albums) + " albums — Local " + n(r.bySource.local) + " · Qobuz " + n(r.bySource.qobuz) + " · TIDAL " + n(r.bySource.tidal) + ".");
      // Rouen's own guesses are not asked while Roon direct is on (v1.9.20).
      if (r.left) out.push(n(r.left) + " not matched, so shown with no source" + (r.twoSources ? " (" + n(r.twoSources) + " listed by your server under two sources)" : "") + ".");
    } else if (s.lastRead) out.push("Read " + n(s.lastRead.albums) + " albums from your server; the match follows once Rouen's own library list is ready.");
    if (s.lastRead) out.push("Last read " + when(s.lastRead.at) + ", in " + took(s.lastRead.ms) + "." + (s.reading ? " Reading again…" : ""));
    if (s.checked) out.push("Checked after " + s.checked.after + ", " + when(s.checked.at) + ": passed.");
    // Hearts (v1.9.27, native-remote.md §8): your server's own favourites; off for this connection when it would not bear one out.
    const h = s.hearts;
    if (h) {
      if (!h.album.on) out.push("Album hearts are off until the next reconnect: " + h.album.why);
      if (!h.track.on) out.push("Track hearts are off until the next reconnect: " + h.track.why);
      if (h.albumSet || h.trackSet) out.push("Hearts sent to your server: " + n(h.albumSet) + " album" + (h.albumSet === 1 ? "" : "s") +
        (h.albumConfirmed ? " (" + n(h.albumConfirmed) + " seen in its next read)" : "") + ", " + n(h.trackSet) + " track" + (h.trackSet === 1 ? "" : "s") + ".");
    }
    return out;
  }

  const hBlock = /** @type {HTMLElement} */ (document.getElementById("roon-hearts-block"));
  const hPick = /** @type {HTMLSelectElement} */ (document.getElementById("roon-hearts-profile"));
  const hLine = /** @type {HTMLElement} */ (document.getElementById("roon-hearts-status"));

  /** Whose favourites a heart writes (v1.9.27), shown only when your server has several profiles (§13). @param {any} s */
  function showHearts(s) {
    const h = s.on ? s.hearts : null;
    const several = !!h && (h.profiles || []).length > 1;
    hBlock.classList.toggle("hidden", !several);
    if (!several) return;
    hPick.innerHTML = "";
    if (!h.profile) hPick.appendChild(new Option("Choose…", ""));
    for (const p of h.profiles) hPick.appendChild(new Option(p.name, p.id, false, p.id === h.profile));
  }
  hPick.addEventListener("change", async () => {
    if (!hPick.value) return;
    hLine.textContent = "";
    try {
      const r = await fetch("/api/roon-direct/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: hPick.value }) });
      const s = await r.json();
      if (r.ok) { show(s); loadBoard(); } else hLine.textContent = s.error || "Couldn't change that.";
    } catch (e) { hLine.textContent = "Rouen could not be reached; nothing was changed."; }
  });

  // ---- The status board (v1.9.63, native-remote.md §13): one row per thing native mode does ----
  const bBlock = /** @type {HTMLElement} */ (document.getElementById("roon-board-block"));
  const bList = /** @type {HTMLElement} */ (document.getElementById("roon-board"));
  /** Each light's colour, and what it says to a screen reader. @type {Record<string, [string, string]>} */
  const LIGHTS = { green: ["#2ecc71", "working"], red: ["#e5484d", "failing"], grey: ["#8a8a8a", "not used yet"] };
  /** How often the board is asked again while the pane is open: its reads go to your server. */
  const BOARD_EVERY_MS = 30000;
  /** When the board was last asked for, and whether an ask is on its way: one at a time. */
  let boardAt = -Infinity, boarding = false;
  /** @param {any[]} rows */
  function renderBoard(rows) {
    bList.textContent = "";
    for (const r of rows) {
      const li = document.createElement("li");
      li.dataset.row = r.id;
      li.dataset.light = r.light;
      li.style.cssText = "display:flex;gap:10px;align-items:baseline;margin:8px 0";
      const [colour, said] = LIGHTS[r.light] || LIGHTS.grey;
      const dot = document.createElement("span");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", said);
      dot.style.cssText = `flex:none;width:10px;height:10px;border-radius:50%;background:${colour}`;
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = r.name;
      text.appendChild(name);
      text.appendChild(document.createTextNode(" — " + r.line));
      li.appendChild(dot);
      li.appendChild(text);
      bList.appendChild(li);
    }
  }
  async function loadBoard() {
    if (boarding) return;
    boarding = true;
    boardAt = Date.now();
    try {
      const r = await fetch("/api/native/status", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && Array.isArray(j.rows)) renderBoard(j.rows);
    } catch (e) { /* offline for a moment: the board keeps what it showed, and the next ask tries again */ }
    finally { boarding = false; }
  }

  /** @param {any} s */
  function show(s) {
    // Not chosen (login.md §5): the page says so, and its switch is no use (the row is hidden too, below).
    if (s.offered === false) {
      box.checked = false; box.disabled = true; hBlock.classList.add("hidden"); bBlock.classList.add("hidden");
      line.textContent = "Native mode wasn't chosen for this Rouen. That changes only by removing Rouen and its data, and installing it again.";
      return;
    }
    box.disabled = false;
    showHearts(s);
    // The board while native mode is on, asked again at most every 30 s (each pane open asks at once, below).
    bBlock.classList.toggle("hidden", !s.on);
    if (s.on && Date.now() - boardAt >= BOARD_EVERY_MS) loadBoard();
    box.checked = !!s.on;
    line.textContent = describe(s).join("\n");
    line.style.whiteSpace = "pre-line";
    // Which ones, and why (v1.9.20): the list, to read rather than guess.
    if (!s.library && s.report && s.report.left) {
      const a = document.createElement("a");
      a.href = "/api/roon-direct/unmatched";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "See which, and why";
      line.appendChild(document.createTextNode("\n"));
      line.appendChild(a);
    }
    if (again) { clearTimeout(again); again = null; }
    // While the page is open: a read or a check under way, or the connection's state (v1.9.24) — asked
    // again every few seconds, so what it says follows what happens.
    if ((s.reading || s.checking || s.link) && !pane.classList.contains("hidden")) again = setTimeout(load, s.link && s.link.up && !s.reading && !s.checking ? 10000 : 3000);
  }

  async function load() {
    try {
      const r = await fetch("/api/roon-direct", { cache: "no-store" });
      if (r.ok) show(await r.json());
    } catch (e) { /* offline for a moment: the line keeps what it said, and opening the page again asks again */ }
  }

  box.addEventListener("change", async () => {
    const on = box.checked;
    box.disabled = true;
    try {
      const r = await fetch("/api/roon-direct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
      const s = await r.json();
      show(s);
      if (!r.ok && s.error) line.textContent = s.error;
    } catch (e) {
      box.checked = !on;
      line.textContent = "Rouen could not be reached; nothing was changed.";
    } finally {
      box.disabled = false;
    }
  });

  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="roon"]')) { boardAt = -Infinity; load(); }
  });

  // Native mode not chosen at the one-time choice (login.md §5, v1.9.32): its page is never offered.
  // The choice as login.js asked it (once, for the whole page): already there, or when it comes.
  /** @param {any} c */
  const offer = (c) => {
    const row = document.querySelector('.settings-nav-item[data-pane="roon"]');
    if (row && c && c.made === true && c.native === false) row.classList.add("hidden");
  };
  offer(/** @type {any} */ (window).__rouenChoice);
  document.addEventListener("rouen:choice", (e) => { offer(/** @type {CustomEvent} */ (e).detail); });
})();
