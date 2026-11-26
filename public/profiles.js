// @ts-check
/*
 * profiles.js — profiles on the screen (dev/design/profiles.md §6, 2.0.7-t2):
 *
 *   the side menu    at its top, this device's profile (its colour and initial, its name); a tap lists the profiles and
 *                    Guest, and choosing one switches this device (Home, the play counts and Recently played are read
 *                    again for it: the page reloads, Home's kept rows dropped first so the last profile's never show)
 *   Settings         Profiles: add, rename, colour, remove (its listening moved to a profile chosen there); Guest
 *                    always there, its listening counting for no one
 *   a zone's page    Audio Devices → the zone: "Listening here counts for", a profile or Guest (no one)
 *
 * Read and written through /api/profiles and /api/zone-profile (lib/profiles/routes.js). Its markup goes in before
 * app.js runs, so app.js finds the Settings pane as it finds the others; app.js itself is untouched.
 */
(function profilesUi() {
  /** @param {unknown} s */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  const HOME_CACHE_KEY = "rra-home-cache-v1";   // app.js's Home rows kept on the device
  const GUEST_COLOUR = "#8a8f99";
  /** @type {any} */
  let state = null;
  /** What other scripts reach; `reload` is how a switch reads the page again (a test replaces it, to stay on the page). */
  const api = { openPicker: () => openPicker(), reload: () => location.reload() };

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

  /** A profile's look: its colour and initial. @param {{ name: string, colour?: string }} p @param {number} size */
  function avatar(p, size) {
    const c = p.colour || GUEST_COLOUR;
    const initial = (Array.from(String(p.name || "?").trim())[0] || "?").toUpperCase();
    return `<span aria-hidden="true" style="flex:0 0 ${size}px;width:${size}px;height:${size}px;border-radius:50%;background:${esc(c)};`
      + `color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size * 0.45)}px">${esc(initial)}</span>`;
  }
  /** Every profile and Guest, as the picker lists them. */
  const everyone = () => state.profiles.concat([{ id: state.guest.id, name: state.guest.name, colour: GUEST_COLOUR }]);
  const current = () => everyone().find((/** @type {any} */ p) => p.id === state.current) || state.profiles[0];

  // ---- The side menu ---------------------------------------------------------------------------------------------------

  const head = document.querySelector("#menu-overlay .menu-head");
  if (head) {
    head.insertAdjacentHTML("afterend", `
      <button id="menu-profile" type="button" aria-haspopup="dialog" style="display:flex;align-items:center;gap:10px;width:100%;
        min-height:44px;padding:6px 16px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer">
        <span id="menu-profile-face"></span>
        <span id="menu-profile-name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">Profile</span>
        <span aria-hidden="true" style="opacity:.6">▾</span>
      </button>`);
  }
  function drawMenu() {
    const me = current();
    const face = document.getElementById("menu-profile-face");
    const name = document.getElementById("menu-profile-name");
    if (!face || !name || !me) return;
    face.innerHTML = avatar(me, 32);
    // On Guest, said: its play counts and Recently played are only what counted for no one, which can look like loss.
    name.textContent = me.id === state.guest.id ? "Guest · plays count for no one" : me.name;
    /** @type {HTMLElement} */ (document.getElementById("menu-profile")).setAttribute("aria-label", "Profile: " + me.name + ". Change");
  }

  /** @type {HTMLElement | null} */
  let picker = null;
  function closePicker() { if (picker) picker.classList.add("hidden"); }
  async function openPicker() {
    if (!picker) {
      document.body.insertAdjacentHTML("beforeend", `
        <div id="profile-picker" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="profile-picker-title">
          <div class="confirm-backdrop"></div>
          <div class="confirm-box" style="max-width:420px;width:100%;min-width:0;box-sizing:border-box;text-align:left">
            <h2 id="profile-picker-title" style="margin:0 0 10px;font-size:1.15em">Who's listening?</h2>
            <div id="profile-picker-list"></div>
            <p id="profile-picker-note" role="status" style="margin:8px 0 0;opacity:.8"></p>
            <div class="confirm-actions" style="margin-top:12px">
              <button class="confirm-btn" id="profile-picker-manage" type="button">Manage profiles</button>
              <button class="confirm-btn confirm-primary" id="profile-picker-close" type="button">Close</button>
            </div>
          </div>
        </div>`);
      picker = /** @type {HTMLElement} */ (document.getElementById("profile-picker"));
      /** @type {HTMLElement} */ (picker.querySelector(".confirm-backdrop")).addEventListener("click", closePicker);
      /** @type {HTMLElement} */ (document.getElementById("profile-picker-close")).addEventListener("click", closePicker);
      /** @type {HTMLElement} */ (document.getElementById("profile-picker-manage")).addEventListener("click", () => {
        closePicker();
        const shut = /** @type {HTMLElement | null} */ (document.querySelector("#menu-overlay [data-menu-close]"));
        if (shut) shut.click();
        const open = /** @type {any} */ (window).__openSettingsPane;
        if (typeof open === "function") open("profiles");
      });
    }
    const list = /** @type {HTMLElement} */ (document.getElementById("profile-picker-list"));
    /** @type {HTMLElement} */ (document.getElementById("profile-picker-note")).textContent = "";
    picker.classList.remove("hidden");
    try { state = await call("/api/profiles"); } catch (e) { list.innerHTML = `<p>Couldn't read the profiles: ${esc(/** @type {Error} */ (e).message)}</p>`; return; }
    list.innerHTML = everyone().map((/** @type {any} */ p) => `<button type="button" class="settings-nav-item" data-profile="${esc(p.id)}" role="radio"
        aria-checked="${p.id === state.current}" style="display:flex;align-items:center;gap:10px;width:100%;margin:0 0 6px">
        ${avatar(p, 30)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
        <span style="opacity:.7;font-size:.85em">${p.id === state.guest.id ? "counts for no one" : ""}${p.id === state.current ? " ✓" : ""}</span></button>`).join("");
    for (const b of Array.from(list.querySelectorAll("[data-profile]"))) b.addEventListener("click", () => choose(/** @type {HTMLElement} */ (b).dataset.profile || ""));
  }

  /** This device on another profile: kept by its cookie, then the page read again for it. @param {string} id */
  async function choose(id) {
    if (state && id === state.current) { closePicker(); return; }
    const note = /** @type {HTMLElement} */ (document.getElementById("profile-picker-note"));
    note.textContent = "Switching…";
    try { await call("/api/profiles/current", { id }); }
    catch (e) { note.textContent = "Couldn't switch: " + /** @type {Error} */ (e).message; return; }
    try { localStorage.removeItem(HOME_CACHE_KEY); } catch (e) { /* no storage (private mode): there are no kept rows to drop */ }
    api.reload();
  }

  const menuBtn = document.getElementById("menu-profile");
  if (menuBtn) menuBtn.addEventListener("click", openPicker);

  // ---- Settings → Profiles ---------------------------------------------------------------------------------------------

  // After Audio Devices (Native mode stays first, then Audio Devices: roon-settings.js).
  const navAfter = document.querySelector('.settings-nav-item[data-pane="playback"]');
  const paneAfter = document.querySelector('.settings-pane[data-pane="playback"]');
  if (navAfter && paneAfter) {
    navAfter.insertAdjacentHTML("afterend", `
          <button class="settings-nav-item" type="button" data-pane="profiles">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.2 4.5 1.9 5.2 4.9"/></svg>
            </span>
            <span class="settings-nav-txt"><span class="settings-nav-title">Profiles</span></span>
          </button>`);
    paneAfter.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="profiles">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Profiles</h2>
        </div>
        <p class="settings-pane-desc">Who is listening: each has their own play counts, Recently played, Smart Picks and Tune</p>
        <div class="settings-block" id="profiles-body"><p>Reading…</p></div>
        <div class="settings-block">
          <div class="settings-row" style="gap:8px">
            <input id="profiles-new" class="settings-input" type="text" maxlength="40" placeholder="New profile's name" aria-label="New profile's name" style="flex:1;min-width:0">
            <button id="profiles-add" class="settings-update-btn" type="button">Add</button>
          </div>
          <div class="settings-note" id="profiles-note" role="status">Each device chooses its profile from the side menu. A zone's own, for what is played there from elsewhere, is on its Audio Devices page.</div>
        </div>
      </div>`);
  }
  /** How long after "Read Roon's profiles again" the pane is read: a reconnect and the server's first pushes. */
  const REREAD_MS = 8000;
  const body = () => document.getElementById("profiles-body");
  const paneNote = (/** @type {string} */ t) => { const n = document.getElementById("profiles-note"); if (n) n.textContent = t; };

  function drawPane() {
    const b = body();
    if (!b || !state) return;
    const many = state.profiles.length > 1;
    b.innerHTML = roonHead() + state.profiles.map((/** @type {any} */ p) => `
      <div class="profile-row" data-id="${esc(p.id)}" style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          ${avatar(p, 34)}
          <input class="settings-input profile-name" type="text" maxlength="40" value="${esc(p.name)}" aria-label="Name of ${esc(p.name)}" style="flex:1;min-width:0">
          ${many ? `<button class="pick-block profile-remove" type="button">Remove</button>` : ""}
        </div>
        <div role="radiogroup" aria-label="Colour of ${esc(p.name)}" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0 44px">
          ${state.colours.map((/** @type {string} */ c) => `<button type="button" class="profile-colour" data-colour="${esc(c)}" role="radio" aria-checked="${c === p.colour}"
            aria-label="Colour ${esc(c)}" style="width:26px;height:26px;border-radius:50%;background:${esc(c)};border:${c === p.colour ? "3px solid var(--text)" : "1px solid var(--border)"};cursor:pointer"></button>`).join("")}
        </div>
        ${roonChoice(p)}
        <div class="profile-confirm" hidden style="margin:8px 0 0 44px"></div>
      </div>`).join("")
      + `<div style="display:flex;align-items:center;gap:10px;padding:8px 0">${avatar({ name: "Guest", colour: GUEST_COLOUR }, 34)}
          <span style="flex:1">Guest <span style="opacity:.7">— its listening counts for no one. Always here.</span></span></div>`;
  }

  /**
   * A profile's Roon profile (profiles.md §13.2, 2.0.8-t2), shown whenever native mode is in use: paired, its hearts, adds
   * and Roon's Listen later are that Roon profile's; none, it has none, never another's. Each Roon profile is paired with
   * one Rouen profile, so those already paired elsewhere are not offered; one your server no longer has is "Not in Roon now".
   * @param {any} p
   */
  function roonChoice(p) {
    const roon = state.roon;
    if (!roon || !roon.profiles) return "";
    const taken = new Set(state.profiles.filter((/** @type {any} */ o) => o.id !== p.id && o.roonProfile).map((/** @type {any} */ o) => o.roonProfile));
    return `<label style="display:flex;align-items:center;gap:8px;margin:8px 0 0 44px">Roon profile
      <select class="settings-select profile-roon" aria-label="Roon profile of ${esc(p.name)}" style="flex:1;min-width:0">
        <option value="">None: no favourites of its own</option>
        ${p.roonState === "gone" ? `<option value="${esc(p.roonProfile)}" selected>Not in Roon now</option>` : ""}
        ${p.roonState !== "paired" ? `<option value="create">${esc("Create in Roon as \u201c" + p.name + "\u201d")}</option>` : ""}
        ${roon.profiles.filter((/** @type {any} */ r) => !taken.has(r.id)).map((/** @type {any} */ r) => `<option value="${esc(r.id)}"${r.id === p.roonProfile ? " selected" : ""}>${esc(r.name)}</option>`).join("")}
      </select></label>`;
  }

  /** The pairing (§13.2), while a profile has no Roon profile, and the read of Roon's profiles again; native mode in use. */
  function roonHead() {
    if (!state.roon) return "";
    return (state.pairing ? `<div class="settings-note profile-pairing" role="note" style="margin:0 0 8px">Pair each profile with its Roon profile,
        or create it in Roon. Until then, it has no favourites, adds or Listen later of its own. Once every profile is paired, your other
        Roon profiles show up here as profiles too.</div>` : "")
      + `<div class="settings-row" style="justify-content:flex-end;margin:0 0 4px">
        <button id="profiles-reread" class="pick-block" type="button">Read Roon's profiles again</button></div>`;
  }

  async function loadPane() {
    const b = body();
    if (!b) return;
    try { state = await call("/api/profiles"); drawPane(); drawMenu(); }
    catch (e) { b.innerHTML = `<p>Couldn't read the profiles: ${esc(/** @type {Error} */ (e).message)}</p>`; }
  }

  /**
   * A change sent; the pane drawn from the answer. Whether it was taken. @param {string} url @param {any} data
   * @param {string} done
   */
  async function send(url, data, done) {
    paneNote("Saving…");
    try { state = await call(url, data); drawPane(); drawMenu(); paneNote(done); return true; }
    catch (e) { paneNote("Couldn't save: " + /** @type {Error} */ (e).message); await loadPane(); return false; }
  }

  document.addEventListener("change", (ev) => {
    const el = /** @type {HTMLElement} */ (ev.target);
    const row = el.closest && el.closest(".profile-row");
    if (row && el.classList.contains("profile-roon")) {
      const v = /** @type {HTMLSelectElement} */ (el).value || null;
      send("/api/profiles/" + encodeURIComponent(/** @type {HTMLElement} */ (row).dataset.id || ""), { roonProfile: v },
        v === "create" ? "Made in Roon and paired: this profile's hearts, adds and Listen later are its own there."
        : v ? "Saved. Hearts, Add to library and Roon's Listen later on this profile's devices are this Roon profile's."
          : "Saved. This profile has no Roon profile now: no favourites, adds or Listen later of its own.");
    }
    if (row && el.classList.contains("profile-name")) {
      send("/api/profiles/" + encodeURIComponent(/** @type {HTMLElement} */ (row).dataset.id || ""), { name: /** @type {HTMLInputElement} */ (el).value }, "Renamed.");
    }
  });
  document.addEventListener("click", (ev) => {
    const el = /** @type {HTMLElement | null} */ (ev.target instanceof Element ? ev.target.closest("button") : null);
    if (!el || !el.closest("#profiles-body, #profiles-add")) return;
    if (el.id === "profiles-add") {
      const input = /** @type {HTMLInputElement} */ (document.getElementById("profiles-new"));
      // A Rouen profile becomes a Roon profile (§13.2): made in Roon too while native mode is in use, and said so.
      send("/api/profiles", { name: input.value }, "Added. Choose it on a device from the side menu.").then((ok) => {
        if (!ok) return;
        input.value = "";
        if (state && state.inRoon) paneNote("Added, and made in Roon too. Choose it on a device from the side menu.");
      });
      return;
    }
    if (el.id === "profiles-reread") {
      paneNote("Reading your server's profiles again…");
      // One reconnect, as the nightly one: the list is read on the new connection, a few seconds on.
      call("/api/profiles/roon-reread", {}).then(() => setTimeout(() => { loadPane().then(() => paneNote("Asked your server again. One just made in Roon not here yet? Open this page again in a moment.")); }, REREAD_MS))
        .catch((e) => paneNote("Couldn't read them again: " + /** @type {Error} */ (e).message));
      return;
    }
    const row = /** @type {HTMLElement | null} */ (el.closest(".profile-row"));
    if (!row) return;
    const id = row.dataset.id || "";
    if (el.classList.contains("profile-colour")) { send("/api/profiles/" + encodeURIComponent(id), { colour: el.dataset.colour }, "Saved."); return; }
    if (el.classList.contains("profile-remove")) {
      const box = /** @type {HTMLElement} */ (row.querySelector(".profile-confirm"));
      const others = state.profiles.filter((/** @type {any} */ p) => p.id !== id);
      box.innerHTML = `<label style="display:block;margin-bottom:6px">Move its plays to
          <select class="settings-select profile-move" aria-label="Move its plays to">${others.map((/** @type {any} */ p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
        <button class="pick-block profile-remove-yes" type="button">Remove and move its plays</button>
        <button class="pick-block profile-remove-no" type="button">Keep it</button>`;
      box.hidden = false;
      return;
    }
    if (el.classList.contains("profile-remove-no")) { /** @type {HTMLElement} */ (row.querySelector(".profile-confirm")).hidden = true; return; }
    if (el.classList.contains("profile-remove-yes")) {
      const moveTo = /** @type {HTMLSelectElement} */ (row.querySelector(".profile-move")).value;
      const mine = state.current === id;
      const to = state.profiles.find((/** @type {any} */ p) => p.id === moveTo);
      send("/api/profiles/" + encodeURIComponent(id) + "/remove", { moveTo }, "Removed. Its plays are now " + (to ? to.name : "the other profile") + "'s.").then((ok) => {
        // This device was on it: it is on the first profile now, so the page is read again for that one, as a switch is.
        if (ok && mine) { try { localStorage.removeItem(HOME_CACHE_KEY); } catch (e) { /* no storage: no kept rows to drop */ } api.reload(); }
      });
    }
  });

  // The pane read whenever it comes on screen.
  const pane = document.querySelector('.settings-pane[data-pane="profiles"]');
  if (pane) {
    new MutationObserver(() => { if (!pane.classList.contains("hidden")) loadPane(); }).observe(pane, { attributes: true, attributeFilter: ["class"] });
  }

  // ---- A zone's page: "Listening here counts for" ----------------------------------------------------------------------

  let zone = "";
  const devicePane = document.querySelector('.settings-pane[data-pane="audio-device"]');
  const host = document.getElementById("ad-device-settings");
  if (devicePane && host) {
    host.insertAdjacentHTML("beforebegin", `
        <div class="settings-block" id="zone-profile-block" hidden>
          <div class="settings-row">
            <span class="settings-label">Listening here counts for</span>
            <select id="zone-profile" class="settings-select" aria-label="Listening here counts for"></select>
          </div>
          <div class="settings-note">What's played here from Roon's apps, a schedule or another remote counts for this profile. What a device starts from Rouen counts for that device's profile.</div>
          <div class="settings-note" id="zone-profile-note" role="status"></div>
        </div>`);
  }
  // The card tapped on Audio Devices names the zone (audio-devices.js keeps it to itself).
  document.addEventListener("click", (ev) => {
    const c = ev.target instanceof Element ? /** @type {HTMLElement | null} */ (ev.target.closest(".ad-card[data-pane]")) : null;
    if (!c) return;
    zone = c.dataset.zone || "";
    loadZone(zone);
  }, true);

  /** @param {string} z */
  async function loadZone(z) {
    const block = document.getElementById("zone-profile-block");
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("zone-profile"));
    if (!block || !sel) return;
    block.hidden = true;
    if (!z) return;
    try {
      const [p, zp] = await Promise.all([call("/api/profiles"), call("/api/zone-profile?zone=" + encodeURIComponent(z))]);
      if (z !== zone) return;   // another zone opened meanwhile
      state = p;
      sel.innerHTML = everyone().map((/** @type {any} */ x) => `<option value="${esc(x.id)}">${esc(x.id === state.guest.id ? "Guest (no one)" : x.name)}</option>`).join("");
      sel.value = zp.profile;
      block.hidden = false;
    } catch (e) {
      // A zone Rouen doesn't know (gone meanwhile) or no database: the page shows the rest without this row.
      block.hidden = true;
    }
  }
  const zsel = document.getElementById("zone-profile");
  if (zsel) {
    zsel.addEventListener("change", async () => {
      const note = /** @type {HTMLElement} */ (document.getElementById("zone-profile-note"));
      note.textContent = "";
      try { await call("/api/zone-profile", { zone, profile: /** @type {HTMLSelectElement} */ (zsel).value }); note.textContent = "Saved."; }
      catch (e) { note.textContent = "Couldn't save: " + /** @type {Error} */ (e).message; loadZone(zone); }
    });
  }

  // ---- Backup & restore: the profiles part's name (app.js names the parts it knows; this one is profiles.js's) --------

  const parts = document.getElementById("backup-parts");
  if (parts) {
    const name = () => {
      const input = parts.querySelector('input[data-part="profiles"]');
      const label = input && input.closest(".settings-row") && /** @type {HTMLElement} */ (input.closest(".settings-row")).querySelector(".settings-label");
      if (!input || !label || label.textContent === "Profiles (not their plays)") return;
      label.textContent = "Profiles (not their plays)";
      input.setAttribute("aria-label", "Profiles (not their plays)");
    };
    new MutationObserver(name).observe(parts, { childList: true });
  }

  // The menu's row, read once at start.
  call("/api/profiles").then((j) => { state = j; drawMenu(); }).catch(() => {
    // Not reachable at start (not signed in yet, or no database): the row stays "Profile" until the picker is opened.
  });
  /** @type {any} */ (window).RouenProfiles = api;
})();
