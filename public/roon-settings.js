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
            <span class="settings-label">Native mode (experimental) <button class="settings-info-btn" data-info="Rouen talks to your server the way its own apps do, through its private protocol, over one connection it keeps open (and opens afresh every night at 04:00, and after any drop or error). Your library is then your server&#x27;s own album list, each album with the source your server gives it. Nothing in your library is changed, unless you turn hearts on below: then a heart is your server&#x27;s own favourite. Album pages and playing still go through the official extension API for now. If a read fails, Rouen goes back to the official API&#x27;s list and says why here, and tries again on the next connection or library change. After every Rouen or server update it checks itself first, and turns itself off if the check fails. Unofficial: a server update may break it." aria-label="About native mode">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="roon-direct-enabled" aria-label="Native mode">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note">Your library is your server's own album list, each album with the source your server gives it: the Source counts in Focus and the source icon on album tiles, straight from your server.</div>
          <div id="roon-direct-status" class="settings-token-status" role="status" aria-live="polite"></div>
        </div>
        <!-- Hearts (v1.9.27, native-remote.md §8): off until turned on, after the favourites read are checked. -->
        <div class="settings-block hidden" id="roon-hearts-block">
          <div class="settings-row">
            <span class="settings-label">Hearts <button class="settings-info-btn" data-info="The heart on the album view, and Add to favourites for tracks, write your server&#x27;s own favourite, as its own apps do. Off until you turn it on: first check that the favourites Rouen read (below) match what your server shows. If your server refuses a heart, or doesn&#x27;t bear one out, that kind of heart turns itself off until the next reconnect, and this page says why." aria-label="About hearts">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="roon-hearts-enabled" aria-label="Hearts">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-row hidden" id="roon-hearts-profile-row">
            <span class="settings-label">Whose favourites</span>
            <select id="roon-hearts-profile" class="settings-select" aria-label="Whose favourites"></select>
          </div>
          <div id="roon-hearts-status" class="settings-token-status" role="status" aria-live="polite"></div>
        </div>
        <!-- Add to library, the check first (v1.9.32, native-remote.md §9.1): read only. -->
        <div class="settings-block hidden" id="roon-find-block">
          <div class="settings-row">
            <span class="settings-label">Add to library — check <button class="settings-info-btn" data-info="Before Rouen adds albums to your library through your server, as its own apps do, this checks that your server&#x27;s own search finds them: each Smart Pick and Listen Later album on TIDAL or Qobuz that isn&#x27;t in your library yet is searched for, one at a time. Nothing is changed. + Add uses the same search, then adds the album through your server; what it can&#x27;t add that way becomes a TIDAL or Qobuz favourite, as before." aria-label="About the check">&#9432;</button></span>
            <button type="button" class="action-btn primary" id="roon-find-run">Check now</button>
          </div>
          <div id="roon-find-status" class="settings-token-status" role="status" aria-live="polite"></div>
          <ul id="roon-find-list" class="settings-note"></ul>
        </div>
        <!-- Rouen's own playlists, copied to your server once (v1.9.42, native-remote.md §11.1). -->
        <div class="settings-block hidden" id="roon-copy-block">
          <div class="settings-row">
            <span class="settings-label">Copy Rouen&#x27;s playlists to your server <button class="settings-info-btn" data-info="With native mode on, playlists you make or add to in Rouen are your server&#x27;s own, and show in its own apps. This copies the ones made in Rouen before, once: each becomes a playlist on your server with the same name and tracks. A playlist whose name your server already has is left alone. Rouen&#x27;s own copies stay until you delete them." aria-label="About the copy">&#9432;</button></span>
            <button type="button" class="action-btn primary" id="roon-copy-run">Copy</button>
          </div>
          <div id="roon-copy-status" class="settings-token-status" role="status" aria-live="polite"></div>
          <ul id="roon-copy-list" class="settings-note"></ul>
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
  const hBox = /** @type {HTMLInputElement} */ (document.getElementById("roon-hearts-enabled"));
  const hRow = /** @type {HTMLElement} */ (document.getElementById("roon-hearts-profile-row"));
  const hPick = /** @type {HTMLSelectElement} */ (document.getElementById("roon-hearts-profile"));
  const hLine = /** @type {HTMLElement} */ (document.getElementById("roon-hearts-status"));

  /** Hearts' own block: the switch, whose, and what the read found to check first. @param {any} s */
  function showHearts(s) {
    const h = s.on ? s.hearts : null;
    hBlock.classList.toggle("hidden", !h);
    if (!h) return;
    hBox.checked = !!h.enabled;
    const several = (h.profiles || []).length > 1;
    hRow.classList.toggle("hidden", !several);
    if (several) {
      hPick.innerHTML = "";
      if (!h.profile) hPick.appendChild(new Option("Choose…", ""));
      for (const p of h.profiles) hPick.appendChild(new Option(p.name, p.id, false, p.id === h.profile));
    }
    const who = (h.profiles || []).find((/** @type {any} */ p) => p.id === h.profile) || (h.profiles || [])[0];
    /** @type {string[]} */
    const out = [];
    if (h.favourites !== null && h.favourites !== undefined) {
      out.push("Your server's list, as Rouen read it, has " + n(h.favourites) + " favourite album" + (h.favourites === 1 ? "" : "s") +
        (who ? " for " + who.name : "") + "." + (h.enabled ? "" : " Check that against your server's own before turning hearts on."));
    }
    if (h.enabled && h.off) out.push(h.off);
    // v1.9.28: favourites changed in your server's own apps, taken as they happened.
    if (h.live) out.push(n(h.live) + " favourite" + (h.live === 1 ? "" : "s") + " changed in your server's own apps since this connection opened, shown here as they happened.");
    hLine.textContent = out.join("\n");
    hLine.style.whiteSpace = "pre-line";
  }
  /** @param {string} url @param {any} body */
  async function send(url, body) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const s = await r.json();
      if (r.ok) show(s); else hLine.textContent = s.error || "Couldn't change that.";
    } catch (e) { hLine.textContent = "Rouen could not be reached; nothing was changed."; }
  }
  hBox.addEventListener("change", () => { send("/api/roon-direct/hearts", { on: hBox.checked }); });
  hPick.addEventListener("change", () => { if (hPick.value) send("/api/roon-direct/profile", { id: hPick.value }); });

  // ---- Rouen's own playlists, copied to your server once (v1.9.42, native-remote.md §11.1) ----
  const cBlock = /** @type {HTMLElement} */ (document.getElementById("roon-copy-block"));
  const cBtn = /** @type {HTMLButtonElement} */ (document.getElementById("roon-copy-run"));
  const cLine = /** @type {HTMLElement} */ (document.getElementById("roon-copy-status"));
  const cList = /** @type {HTMLElement} */ (document.getElementById("roon-copy-list"));
  /** What became of one playlist, in words. @param {any} d */
  const copied = (d) => (d.result === "copied"
    ? `"${d.name}": ${d.added} of ${d.of} tracks` + (d.missing && d.missing.length ? ` (not found: ${d.missing.slice(0, 5).join(", ")}${d.missing.length > 5 ? "…" : ""})` : "")
    : `"${d.name}": ${d.result === "skipped" ? "left alone" : "not copied"} — ${d.why}`);
  /** The copy as far as it has got; followed once a second while it runs. */
  async function followCopy() {
    /** @type {any} */
    let j;
    try { j = await (await fetch("/api/roon-playlists/copy", { cache: "no-store" })).json(); }
    catch (e) { cLine.textContent = "Rouen could not be reached; the copy may still be running."; cBtn.disabled = false; return; }
    cList.textContent = "";
    for (const d of j.done || []) { const li = document.createElement("li"); li.textContent = copied(d); cList.appendChild(li); }
    if (j.running) { cLine.textContent = `Copying… ${(j.done || []).length} of ${j.total}`; setTimeout(followCopy, 1000); return; }
    cBtn.disabled = false;
    cLine.textContent = j.error || (j.total ? `Done: ${(j.done || []).filter((/** @type {any} */ d) => d.result === "copied").length} of ${j.total} copied.` : "Rouen has no playlists of its own to copy.");
  }
  cBtn.addEventListener("click", async () => {
    cBtn.disabled = true;
    cLine.textContent = "Starting…";
    try {
      const r = await fetch("/api/roon-playlists/copy", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !/already/.test(j.error || "")) { cLine.textContent = j.error || "Couldn't start the copy."; cBtn.disabled = false; return; }
    } catch (e) { cLine.textContent = "Rouen could not be reached; nothing was copied."; cBtn.disabled = false; return; }
    followCopy();
  });

  // ---- Add to library, the check (v1.9.32, native-remote.md §9.1) ----
  const fBlock = /** @type {HTMLElement} */ (document.getElementById("roon-find-block"));
  const fBtn = /** @type {HTMLButtonElement} */ (document.getElementById("roon-find-run"));
  const fLine = /** @type {HTMLElement} */ (document.getElementById("roon-find-status"));
  const fList = /** @type {HTMLElement} */ (document.getElementById("roon-find-list"));
  /** The services a check asks about, by name, as the server gives them with its limit (one source, find.js). @type {Record<string, string>} */
  let services = {};
  /** A reply as JSON, or what it was instead (a login page, a proxy's error) in words. @param {Response} r */
  const reply = async (r) => { try { return await r.json(); } catch (e) { return { error: "Rouen answered with something other than the check (" + r.status + ")." }; } };
  /** What a finding says, in words. @param {any} f */
  function said(f) {
    const on = services[f.service] || f.service;
    const others = (f.hits || []).map((/** @type {any} */ h) => h.title + " — " + h.artist + " (" + h.source + (h.inLibrary ? ", in your library" : "") + ")");
    switch (f.verdict) {
      // The other service's copy, when the one asked for has none (find.js pickCopy, v1.9.44): what an add would take.
      case "found": return f.from && f.from !== f.service ? "✓ found on " + (services[f.from] || f.from) + ", not on " + on + ": your server could add that copy"
        : "✓ found on " + on + ": your server could add it";
      case "no-id": return "found on " + on + ", but without the id an add needs";
      case "in-library": return "already in your library";
      case "other-source": return "found, but not on " + on + ": " + others.join("; ");
      case "not-found": return "not found" + (others.length ? ". It found: " + others.join("; ") : "");
      case "incomplete": return (f.why || "couldn't be checked") + (others.length ? " It had found: " + others.join("; ") : "");
      default: return f.why || "couldn't be checked";
    }
  }
  /**
   * Each Smart Pick and Listen Later album on a service the check takes, not in the library, once, up to
   * max; and how many were looked at and left out, to say why when none is left (v1.9.35).
   * @param {number} max
   */
  async function candidates(max) {
    const get = async (/** @type {string} */ url) => { const r = await fetch(url, { cache: "no-store" }); return r.ok ? r.json() : {}; };
    const [picks, later] = await Promise.all([get("/api/smart-picks"), get("/api/listen-later?favs=0")]);
    const all = (picks.picks || []).map((/** @type {any} */ p) => ({ title: p.album, artist: p.artist, service: p.service, offset: p.offset }))
      .concat((later.albums || []).map((/** @type {any} */ e) => ({ title: e.title, artist: e.artist, service: e.service, offset: e.offset })));
    const seen = new Set();
    let inLibrary = 0, elsewhere = 0;
    const albums = all.filter((a) => {
      const k = String(a.title || "").toLowerCase() + "\u0000" + String(a.artist || "").toLowerCase();
      if (!a.title || seen.has(k)) return false;
      seen.add(k);
      if (a.offset !== null && a.offset !== undefined) { inLibrary++; return false; }
      if (!Object.prototype.hasOwnProperty.call(services, a.service)) { elsewhere++; return false; }
      return true;
    }).slice(0, max).map((a) => ({ title: String(a.title), artist: String(a.artist || ""), service: a.service }));
    return { albums, looked: seen.size, inLibrary, elsewhere };
  }
  /** Why there is nothing to check, in numbers. @param {{ looked: number, inLibrary: number, elsewhere: number }} c */
  function nothing(c) {
    if (!c.looked) return "Nothing to check: you have no Smart Picks or Listen Later albums yet.";
    const why = [];
    if (c.inLibrary) why.push(c.inLibrary + (c.inLibrary === 1 ? " is" : " are") + " in your library already");
    if (c.elsewhere) why.push(c.elsewhere + (c.elsewhere === 1 ? " isn't" : " aren't") + " on " + Object.values(services).join(" or "));
    return "Nothing to check. Of your " + c.looked + " Smart Pick" + (c.looked === 1 ? "" : "s") + " and Listen Later album" + (c.looked === 1 ? "" : "s") + ", " + why.join(" and ") + ".";
  }
  /** The check as far as it has got. @param {any} out */
  function render(out) {
    fList.textContent = "";
    for (const f of out.findings || []) {
      const li = document.createElement("li");
      li.textContent = f.title + " — " + f.artist + ": " + said(f);
      fList.appendChild(li);
    }
    const n = (out.findings || []).length;
    if (out.running) fLine.textContent = "Asking your server's search about " + out.total + " album" + (out.total === 1 ? "" : "s") + ", one at a time: " + n + " so far…";
    else if (out.error) fLine.textContent = out.error;
    else fLine.textContent = "Your server's search found " + out.findings.filter((/** @type {any} */ f) => f.verdict === "found").length + " of " + n + " on TIDAL or Qobuz, ready to add. Nothing was changed.";
  }
  /** Followed until it ends: the check runs on Rouen whatever becomes of this page (v1.9.33). */
  async function follow() {
    for (;;) {
      const r = await fetch("/api/roon-direct/find", { cache: "no-store" });
      const out = await reply(r);
      if (!r.ok || !Array.isArray(out.findings)) throw new Error(out.error || "no check");
      render(out);
      if (!out.running) return;
      await new Promise((res) => { setTimeout(res, 1000); });
    }
  }
  fBtn.addEventListener("click", async () => {
    fBtn.disabled = true;
    fList.textContent = "";
    let started = false;
    try {
      const r0 = await fetch("/api/roon-direct/find", { cache: "no-store" });
      const now = await reply(r0);
      // Not the check (a login page, a proxy's): said so, never taken for a check with nothing to ask.
      if (!r0.ok || !now.services || typeof now.max !== "number") { fLine.textContent = now.error || "The check couldn't run."; return; }
      services = now.services;
      // One already running (pressed again, or on another device): followed, not refused.
      if (!now.running) {
        fLine.textContent = "Looking at your Smart Picks and Listen Later…";
        const c = await candidates(now.max);
        const albums = c.albums;
        if (!albums.length) { fLine.textContent = nothing(c); return; }
        const r = await fetch("/api/roon-direct/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ albums }) });
        const out = await reply(r);
        if (!r.ok) {
          // Begun elsewhere since the look above: that one is followed.
          const again = await reply(await fetch("/api/roon-direct/find", { cache: "no-store" }));
          if (!again.running) { fLine.textContent = out.error || "The check couldn't run."; return; }
        }
      }
      started = true;
      await follow();
    } catch (e) {
      fLine.textContent = started ? "Rouen stopped answering during the check; it may still be running there. Press the button again in a while to see it."
        : "Rouen could not be reached; nothing was checked.";
    } finally {
      fBtn.disabled = false;
    }
  });

  /** @param {any} s */
  function show(s) {
    // Not chosen (login.md §5): the page says so, and its switch is no use (the row is hidden too, below).
    if (s.offered === false) {
      box.checked = false; box.disabled = true; hBlock.classList.add("hidden");
      line.textContent = "Native mode wasn't chosen for this Rouen. That changes only by removing Rouen and its data, and installing it again.";
      return;
    }
    box.disabled = false;
    showHearts(s);
    fBlock.classList.toggle("hidden", !(s.on && s.active));
    cBlock.classList.toggle("hidden", !(s.on && s.active));
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
