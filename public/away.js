// @ts-check
/*
 * away.js — Settings → Setup → Away from home (v1.9.72-t7, dev/design/android-app.md §4.7): Tailscale built into
 * Rouen, as Mandarin's. Signed in once here, Rouen is a machine on your tailnet by itself, and the Rouen app on your
 * phone reaches it there when home does not answer. Nothing to install on the machine Rouen runs on, and no VPN.
 *
 * Loaded before app.js: app.js collects the Settings pages and answers the ⓘ buttons when it starts, so the page and
 * its entry in Setup must already be in place. Everything else is here: the status read from /api/tailscale (asked
 * again every few seconds while the page is open), the switch, Sign in (a link to Tailscale's own page, opened in a
 * new tab) and Sign out. Away, the page says how it is but changes nothing: it is how you are connected.
 *
 * In the Rouen app (v1.9.72-t10; the owner: "Mandarin logs the server in and then I add the app/phone"), a second part,
 * This phone: the phone's own built-in Tailscale, through the app's bridge (window.RouenPhone: tailscale, tailscaleLook,
 * tailscaleSignIn, tailscaleSignOut, tailscaleUse) — its state, Sign in with the same Tailscale account, Sign out, and
 * its switch. The app says when it moved with the page's "rouen:phone" event (phone-settings.js passes it on).
 */
(function awaySettings() {
  "use strict";
  const setupNav = document.querySelector('.settings-pane[data-pane="setup"] .settings-nav');
  const setupPane = document.querySelector('.settings-pane[data-pane="setup"]');
  if (!setupNav || !setupPane) return;
  setupNav.insertAdjacentHTML("beforeend", `
          <button class="settings-nav-item" type="button" data-pane="away">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Away from home</span>
            </span>
          </button>`);
  setupPane.insertAdjacentHTML("afterend", `
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="away" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Away from home</h2>
        </div>
        <p class="settings-pane-desc">Tailscale built in, for the Rouen app away from home</p>
        <div class="settings-block">
          <div class="settings-note">Signed in once, Rouen joins your Tailscale network (your tailnet) by itself: nothing to
            install on the machine it runs on, and no VPN. Away from home, the Rouen app on your phone reaches it there, and
            plays as it does at home. Only Rouen joins; your Roon server stays on your home network.</div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Built-in Tailscale <button class="settings-info-btn" data-info="On unless you switch it off. Off, Rouen leaves your tailnet until it is switched on again, and the app plays at home only (or through a VPN of your own). Signing out, below, makes Rouen leave your tailnet for good: switched on again it asks to be signed in afresh." aria-label="About built-in Tailscale">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="away-enabled" aria-label="Built-in Tailscale">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note" id="away-status">Asking…</div>
          <div class="settings-note hidden" id="away-address"></div>
        </div>
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Sign in to Tailscale</span>
            <button id="away-login" class="settings-update-btn" type="button">Sign in</button>
          </div>
          <div class="settings-note hidden" id="away-link"></div>
          <div class="settings-row">
            <span class="settings-label">Leave your tailnet</span>
            <button id="away-logout" class="settings-update-btn" type="button">Sign out</button>
          </div>
        </div>
        <div class="settings-divider hidden" id="away-phone-divider"></div>
        <div class="settings-block hidden" id="away-phone">
          <div class="settings-block-title">This phone</div>
          <div class="settings-note">With Rouen on your tailnet, add this phone too: sign it in with the same Tailscale
            account, and the app reaches Rouen from anywhere. In your Tailscale console it is <span id="away-phone-host"></span>.</div>
          <div class="settings-row">
            <span class="settings-label">This phone's built-in Tailscale</span>
            <label class="switch">
              <input type="checkbox" id="away-phone-on" aria-label="This phone's built-in Tailscale">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note" id="away-phone-status"></div>
          <div class="settings-note" id="away-phone-way"></div>
          <div class="settings-row">
            <span class="settings-label">Sign this phone in</span>
            <button id="away-phone-login" class="settings-update-btn" type="button">Sign in</button>
          </div>
          <div class="settings-row">
            <span class="settings-label">Take this phone off your tailnet</span>
            <button id="away-phone-logout" class="settings-update-btn" type="button">Sign out</button>
          </div>
        </div>
      </div>`);

  const pane = /** @type {HTMLElement} */ (document.querySelector('.settings-pane[data-pane="away"]'));
  const box = /** @type {HTMLInputElement} */ (document.getElementById("away-enabled"));
  const line = /** @type {HTMLElement} */ (document.getElementById("away-status"));
  const where = /** @type {HTMLElement} */ (document.getElementById("away-address"));
  const link = /** @type {HTMLElement} */ (document.getElementById("away-link"));
  const login = /** @type {HTMLButtonElement} */ (document.getElementById("away-login"));
  const logout = /** @type {HTMLButtonElement} */ (document.getElementById("away-logout"));
  /** @type {any} */
  let again = null;

  /** What the status says, in a line. @param {any} s */
  function words(s) {
    if (!s.available) return "Tailscale is not in this install. Update Rouen with its newest image (docker pull) to have it.";
    if (!s.enabled) return "Switched off: Rouen is not on your tailnet.";
    if (s.state === "Downloading") return "Fetching Tailscale for this install…";
    if (s.state === "Running" && s.address) return "On your tailnet as " + (s.dns_name || s.hostname) + (s.online === false ? ", but not online right now: it will try again by itself." : ".");
    if (s.state === "Running") return "On your tailnet, opening Rouen's port there…";
    if (s.state === "NeedsLogin") return "Not signed in yet: Sign in, below.";
    if (s.state === "NeedsMachineAuth") return "Signed in; waiting for this machine to be approved in Tailscale's admin console.";
    if (s.error) return "Tailscale: " + s.error;
    return "Starting…";
  }

  /** @param {string} href */
  function showLink(href) {
    link.textContent = "";
    link.append("Open ");
    const a = Object.assign(document.createElement("a"), { href, target: "_blank", rel: "noopener noreferrer", textContent: "Tailscale's sign-in page" });
    link.append(a, " and sign in there; this page follows.");
    link.classList.remove("hidden");
  }

  /** @param {any} s */
  function show(s) {
    box.checked = !!s.enabled;
    box.disabled = !s.available || !!s.away;
    line.textContent = words(s) + (s.away ? " You are away: change this from home." : "");
    if (s.address) {
      where.textContent = "The app reaches it at " + s.address + (s.dns_name ? " (" + s.dns_name + ")" : "") + ".";
      where.classList.remove("hidden");
    } else where.classList.add("hidden");
    if (s.auth_url && s.state !== "Running") showLink(s.auth_url); else link.classList.add("hidden");
    login.disabled = !s.available || !s.enabled || !!s.away || s.state === "Running";
    logout.disabled = !s.running || !!s.away || s.state !== "Running";
    if (again) { clearTimeout(again); again = null; }
    // While the page is open, asked again: often until it is on the tailnet, now and then after.
    if (!pane.classList.contains("hidden")) again = setTimeout(load, s.state === "Running" && s.address ? 10000 : 3000);
  }

  async function load() {
    try {
      const r = await fetch("/api/tailscale", { cache: "no-store" });
      if (r.ok) show(await r.json());
    } catch (e) { /* offline for a moment: the line keeps what it said, and opening the page again asks again */ }
  }

  /** @param {string} route @param {any} [body] */
  async function post(route, body) {
    try {
      const r = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const s = await r.json();
      if (!r.ok) { line.textContent = s.error || "Rouen refused that."; return null; }
      show(s);
      return s;
    } catch (e) {
      line.textContent = "Rouen could not be reached; nothing was changed.";
      return null;
    }
  }

  box.addEventListener("change", async () => {
    const on = box.checked;
    box.disabled = true;
    if (!(await post("/api/tailscale/enable", { on }))) box.checked = !on;
    box.disabled = false;
  });
  login.addEventListener("click", async () => {
    login.disabled = true;
    line.textContent = "Asking Tailscale for a sign-in link…";
    const s = await post("/api/tailscale/login");
    if (s && s.auth_url) window.open(s.auth_url, "_blank", "noopener");
  });
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    await post("/api/tailscale/logout");
  });

  // ---- This phone, in the Rouen app only (the app's bridge) ---------------------------------------------------
  const bridge = /** @type {any} */ (window).RouenPhone;
  const phone = !!bridge && typeof bridge.tailscale === "function";
  const phoneBox = /** @type {HTMLElement} */ (document.getElementById("away-phone"));
  const phoneOn = /** @type {HTMLInputElement} */ (document.getElementById("away-phone-on"));
  const phoneLine = /** @type {HTMLElement} */ (document.getElementById("away-phone-status"));
  const phoneWay = /** @type {HTMLElement} */ (document.getElementById("away-phone-way"));
  const phoneIn = /** @type {HTMLButtonElement} */ (document.getElementById("away-phone-login"));
  const phoneOut = /** @type {HTMLButtonElement} */ (document.getElementById("away-phone-logout"));
  /** @type {any} */
  let phoneAgain = null;

  /** The bridge's answer as an object (an error when it is not one). @param {() => string} f */
  function askPhone(f) {
    try {
      return JSON.parse(f()) || {};
    } catch (e) {
      return { error: "The app could not be asked: " + /** @type {Error} */ (e).message };
    }
  }

  /** This phone's part, as the app says it is. */
  function paintPhone() {
    if (!phone) return;
    const t = askPhone(() => bridge.tailscale());
    if (t.error && t.text === undefined) { phoneLine.textContent = t.error; return; }
    /** @type {HTMLElement} */ (document.getElementById("away-phone-host")).textContent = t.hostname ? "“" + t.hostname + "”" : "this phone";
    phoneOn.checked = !!t.on;
    phoneOn.disabled = !t.installed;
    phoneLine.textContent = t.text || "";
    phoneWay.textContent = t.way || "";
    phoneIn.disabled = !t.installed || !t.on || !!t.signedIn;
    phoneOut.disabled = !t.canSignOut;
  }

  /** While the page is open: the app asked to look every few seconds; what it finds comes back as "rouen:phone". */
  function lookPhone() {
    if (phoneAgain) { clearTimeout(phoneAgain); phoneAgain = null; }
    if (!phone || pane.classList.contains("hidden")) return;
    askPhone(() => bridge.tailscaleLook());
    phoneAgain = setTimeout(lookPhone, 3000);
  }

  if (phone) {
    phoneBox.classList.remove("hidden");
    /** @type {HTMLElement} */ (document.getElementById("away-phone-divider")).classList.remove("hidden");
    phoneOn.addEventListener("change", () => { askPhone(() => bridge.tailscaleUse(String(phoneOn.checked))); paintPhone(); });
    phoneIn.addEventListener("click", () => { phoneIn.disabled = true; askPhone(() => bridge.tailscaleSignIn()); paintPhone(); });
    phoneOut.addEventListener("click", () => { phoneOut.disabled = true; askPhone(() => bridge.tailscaleSignOut()); paintPhone(); });
    document.addEventListener("rouen:phone", paintPhone);
  }

  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="away"]')) setTimeout(() => { load(); paintPhone(); lookPhone(); }, 0);
  });
})();
