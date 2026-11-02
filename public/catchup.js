// @ts-check
/*
 * catchup.js — Settings → Setup → Catch-up (v1.9.72-t59, dev/design/android-app.md §4.22, slice 3c): the switch for
 * Rouen's catch-up and how it is getting on. On, what This phone plays is replayed to Roon, fast, on a silent player
 * called "Rouen catch-up", so Roon counts each play (and Roon's own Last.fm scrobbles it, when that is on); off, This
 * phone's plays reach neither Roon nor Last.fm (the owner, 2026-11-02). The player has to be enabled once in Roon
 * (Settings → Audio), as any new device; the page says so until it is.
 *
 * Loaded before app.js, as away.js is: app.js collects the Settings pages and answers the ⓘ buttons when it starts, so
 * the page and its entry in Setup must already be in place. The status is read from GET /api/catchup when the page
 * comes on screen (however it is opened) and again every few seconds while it stays there, and no longer once it or
 * Settings is closed; the switch is POST /api/catchup {enabled}. An answer older than the switch's is not shown.
 */
(function catchupSettings() {
  "use strict";
  const setupNav = document.querySelector('.settings-pane[data-pane="setup"] .settings-nav');
  const setupPane = document.querySelector('.settings-pane[data-pane="setup"]');
  if (!setupNav || !setupPane) return;
  setupNav.insertAdjacentHTML("beforeend", `
          <button class="settings-nav-item" type="button" data-pane="catchup">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/><path d="M12 8v4l3 2"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Catch-up</span>
            </span>
          </button>`);
  setupPane.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="catchup" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Catch-up</h2>
        </div>
        <p class="settings-pane-desc">This phone's plays, counted by Roon</p>
        <div class="settings-block">
          <div class="settings-note">What the Rouen app plays on This phone doesn't go through Roon, so Roon doesn't count
            it. With catch-up on, Rouen replays each of those plays to Roon, fast and silently, on a player called
            “Rouen catch-up”, each track to where you stopped it: Roon counts it as it would have live, and Roon's own
            Last.fm scrobbles it when that is on. Off, This phone's plays reach neither Roon nor Last.fm.</div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Catch-up <button class="settings-info-btn" data-info="Off unless you switch it on. Roon stamps a play with the time it happens and can't back-date one, so a caught-up play shows in Roon's history (and Last.fm) at the time it was caught up, not when you heard it. “Rouen catch-up” shows among Roon's own zones, as it must for Roon to count its plays; Rouen never shows it or plays to it. Switched off, the plays not yet replayed stay kept, and go on when it is switched on again." aria-label="About catch-up">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="catchup-enabled" aria-label="Catch-up">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note" id="catchup-status">Asking…</div>
          <div class="settings-note hidden" id="catchup-counts"></div>
        </div>
        <div class="settings-block hidden" id="catchup-recent-block">
          <div class="settings-block-title">Lately</div>
          <ul class="settings-note" id="catchup-recent"></ul>
        </div>
      </div>`);

  const pane = /** @type {HTMLElement} */ (document.querySelector('.settings-pane[data-pane="catchup"]'));
  const overlay = document.getElementById("settings-overlay");
  const box = /** @type {HTMLInputElement} */ (document.getElementById("catchup-enabled"));
  const line = /** @type {HTMLElement} */ (document.getElementById("catchup-status"));
  const counts = /** @type {HTMLElement} */ (document.getElementById("catchup-counts"));
  const recentBlock = /** @type {HTMLElement} */ (document.getElementById("catchup-recent-block"));
  const recent = /** @type {HTMLElement} */ (document.getElementById("catchup-recent"));
  /** Shown at most in Lately. */
  const RECENT = 8;
  /** @type {any} */
  let again = null;
  /** Each ask's turn: an answer to an older ask than the last shown (a poll overtaken by the switch) is not shown. */
  let asked = 0, shownTurn = 0;

  /** The page is on screen: its own pane open, in Settings open. */
  const onScreen = () => !pane.classList.contains("hidden") && !(overlay && overlay.classList.contains("hidden"));

  /** Asked again in [ms] while on screen; not at all once it isn't. @param {number} ms */
  function later(ms) {
    if (again) { clearTimeout(again); again = null; }
    if (onScreen()) again = setTimeout(load, ms);
  }

  /** @param {number} n @param {string} one @param {string} many */
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  /** What the catch-up is doing, in a line. @param {any} s */
  function words(s) {
    const p = s.player || {};
    const name = s.zone_name || "Rouen catch-up";
    // The play being replayed is still among those waiting (the head of the queue): the rest are "more".
    const left = Math.max(0, (s.waiting || 0) - (s.replaying ? 1 : 0));
    const waiting = left > 0 ? " " + plural(left, s.replaying ? "more play waits" : "play waits", s.replaying ? "more plays wait" : "plays wait") + " to be replayed." : "";
    if (!s.enabled) return "Off: This phone's plays reach neither Roon nor Last.fm." + (s.waiting > 0 ? " " + plural(s.waiting, "play is", "plays are") + " kept for when it is switched on." : "");
    if (!p.running) return "Waiting for Rouen to be paired with your Roon Core." + waiting;
    if (!p.connected) return "Joining your Roon Core…" + (p.lastError ? " (" + p.lastError + ")" : "") + waiting;
    if (!s.zone) return "“" + name + "” has joined Roon. Enable it once in Roon: Settings → Audio, where it is listed under Squeezebox, then Enable." + waiting;
    if (s.replaying) return "Replaying “" + s.replaying.track + "” (" + s.replaying.album + ") to Roon…" + waiting;
    if (left > 0) return waiting.trim();
    return "Up to date: every play from This phone has reached Roon.";
  }

  /** One of Lately's lines. @param {any} r */
  function item(r) {
    const li = document.createElement("li");
    const how = r.result === "replayed" ? "replayed" : r.result === "waiting" ? "to be tried again" : "dropped";
    li.textContent = "“" + r.track + "” (" + r.album + "): " + how + (r.why ? " — " + r.why : "");
    return li;
  }

  /** [s], the answer to ask number [turn], unless a later ask's answer is up already. @param {any} s @param {number} turn */
  function show(s, turn) {
    if (turn < shownTurn) return;
    shownTurn = turn;
    box.checked = !!s.enabled;
    line.textContent = words(s);
    if (s.replayed > 0 || s.dropped > 0) {
      counts.textContent = "Since Rouen started: " + plural(s.replayed || 0, "play", "plays") + " replayed" +
        (s.dropped > 0 ? ", " + s.dropped + " dropped (Lately says why)" : "") + ".";
      counts.classList.remove("hidden");
    } else counts.classList.add("hidden");
    const list = Array.isArray(s.recent) ? s.recent.slice(0, RECENT) : [];
    recent.replaceChildren(...list.map(item));
    recentBlock.classList.toggle("hidden", list.length === 0);
    // While on screen, asked again: often while a play is being replayed, now and then otherwise (waiting on Roon
    // or on you can last, and needs no hurry).
    later(s.enabled && s.replaying ? 2000 : 5000);
  }

  async function load() {
    const turn = ++asked;
    try {
      const r = await fetch("/api/catchup", { cache: "no-store" });
      if (r.ok) { show(await r.json(), turn); return; }
      if (turn >= shownTurn) line.textContent = "Rouen couldn't say how the catch-up is (HTTP " + r.status + ").";
    } catch (e) {
      // Offline for a moment, or an answer that isn't the status: the line keeps what it said, and it is asked again.
    }
    later(5000);
  }

  box.addEventListener("change", async () => {
    const on = box.checked;
    box.disabled = true;
    const turn = ++asked;
    // Shown from now on over any poll asked before it.
    shownTurn = turn;
    try {
      const r = await fetch("/api/catchup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: on }) });
      // An error page that isn't Rouen's JSON (a proxy's, a login gone stale) still says what happened.
      const s = await r.json().catch(() => ({}));
      if (r.ok) show(s, turn);
      else { box.checked = !on; line.textContent = s.error || "Rouen refused that (HTTP " + r.status + ")."; }
    } catch (e) {
      box.checked = !on;
      line.textContent = "Rouen could not be reached; nothing was changed.";
    }
    box.disabled = false;
  });

  // Asked when the page comes on screen, however it is opened (its row in Setup, or straight to it); not asked again
  // once it is off screen (Back, or Settings closed).
  let was = false;
  const watch = new MutationObserver(() => {
    const now = onScreen();
    if (now && !was) load();
    if (!now) later(0);
    was = now;
  });
  watch.observe(pane, { attributes: true, attributeFilter: ["class"] });
  if (overlay) watch.observe(overlay, { attributes: true, attributeFilter: ["class"] });
})();
