// @ts-check
/*
 * roon-settings.js — Settings → Roon (v1.9.18): Roon direct's switch and what
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
              <span class="settings-nav-title">Roon</span>
            </span>
          </button>`);
  paneAfter.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="roon">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Roon</h2>
        </div>
        <p class="settings-pane-desc">Your library, straight from your Roon Core</p>
        <!-- Read this first (v1.9.20, the owner's wording, after deep-roon-mcp's). -->
        <div class="settings-block roon-direct-notice">
          <div class="settings-note"><strong>Read this first.</strong> Roon direct is unofficial: it is not made, endorsed or supported by
            Roon Labs. It uses Roon's internal protocol — the one Roon's own apps use — through Arthur Soares'
            <a href="${REPO}" target="_blank" rel="noopener noreferrer">roon-api-reverse-engineering</a>, which Roon Labs allows for
            tinkering with your own system. Brian Luczkiewicz (Roon Labs) on that protocol: it is “not hardened for 3rd party use”,
            it can change with any Roon update, and misuse can cause memory or compute leaks in the Core. Read
            <a href="${THREAD}" target="_blank" rel="noopener noreferrer">Arthur's thread on the Roon Community</a> before you use it.</div>
          <div class="settings-note">Use it entirely at your own risk. It comes without any warranty (see the
            <a href="${LICENCE}" target="_blank" rel="noopener noreferrer">licence</a>). If your Core misbehaves, turn Roon direct off
            and restart the Core. Report problems <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">here</a>, not to
            Roon's support. Keep port 9332 on your own network, never forward it to the internet. A Roon update can break Roon direct
            until Rouen is updated. With Roon direct switched off (the switch below) only Roon's official extension API is used.</div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Roon direct (experimental) <button class="settings-info-btn" data-info="Asks your Roon Core itself which albums are local files, Qobuz or TIDAL, through Roon&#x27;s own private protocol — the one the Roon apps use. Read only: nothing in your Roon library is changed. Rouen reads the whole album list when you turn it on, after each library change (at most every 30 minutes), and after every Rouen or Roon update, as a check. If anything fails, it turns itself off and says why here, and Rouen goes back to working out sources itself. Unofficial: a Roon update may break it." aria-label="About Roon direct">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="roon-direct-enabled" aria-label="Roon direct">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note">The Source counts in Focus and the source icon on album tiles, straight from Roon. An album Roon's list and Rouen's can't be matched on keeps Rouen's own answer.</div>
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
    if (s.reading && !s.lastRead) return ["Reading your library from Roon…"];
    /** @type {string[]} */
    const out = [];
    const r = s.report;
    if (r) {
      out.push("Matched " + n(r.matched) + " of " + n(r.albums) + " albums — Local " + n(r.bySource.local) + " · Qobuz " + n(r.bySource.qobuz) + " · TIDAL " + n(r.bySource.tidal) + ".");
      // Rouen's own guesses are not asked while Roon direct is on (v1.9.20).
      if (r.left) out.push(n(r.left) + " not matched, so shown with no source" + (r.twoSources ? " (" + n(r.twoSources) + " listed by Roon under two sources)" : "") + ".");
    } else if (s.lastRead) out.push("Read " + n(s.lastRead.albums) + " albums from Roon; the match follows once Rouen's own library list is ready.");
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
    if (s.report && s.report.left) {
      const a = document.createElement("a");
      a.href = "/api/roon-direct/unmatched";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "See which, and why";
      line.appendChild(document.createTextNode("\n"));
      line.appendChild(a);
    }
    if (again) { clearTimeout(again); again = null; }
    if ((s.reading || s.checking) && !pane.classList.contains("hidden")) again = setTimeout(load, 3000);
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
