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
            <span class="settings-label">Native mode (experimental) <button class="settings-info-btn" data-info="Rouen talks to your server the way its own apps do, through its private protocol, over one connection it keeps open (and opens afresh every night at 04:00, and after any drop or error). Your library is then your server&#x27;s own album list, each album with the source your server gives it. Read only: nothing in your library is changed. Album pages and playing still go through the official extension API for now. If a read fails, Rouen goes back to the official API&#x27;s list and says why here, and tries again on the next connection or library change. After every Rouen or server update it checks itself first, and turns itself off if the check fails. Unofficial: a server update may break it." aria-label="About native mode">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="roon-direct-enabled" aria-label="Native mode">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note">Your library is your server's own album list, each album with the source your server gives it: the Source counts in Focus and the source icon on album tiles, straight from your server.</div>
          <div id="roon-direct-status" class="settings-token-status" role="status" aria-live="polite"></div>
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
    return out;
  }

  /** @param {any} s */
  function show(s) {
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
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="roon"]')) load();
  });
})();
