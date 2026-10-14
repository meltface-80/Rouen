// @ts-check
/*
 * login.js — Rouen's password, on the page (v1.9.22, dev/design/login.md).
 *
 * Loaded before app.js, which collects the Settings pages and their ⓘ buttons
 * when it starts. So this:
 *   - builds Settings → System (moved here from index.html, unchanged, which
 *     is at its length baseline) with a Password section added: set one,
 *     change it, remove it, log this device out;
 *   - wraps fetch: a request Rouen answers 401 { login: true } (it needs the
 *     password, and this device has not logged in) opens a small sheet asking
 *     for it, and once logged in is sent again — so no screen has to know.
 *     Cancelled, the screen gets the 401 and says what it says on any error.
 *   - a backup's download, which is a link the browser follows rather than a
 *     fetch (app.js), asks first in the same way while this device is not
 *     logged in, then follows the link.
 * The password itself goes only to /api/login*: never kept on the page.
 */
(function rouenLogin() {
  "use strict";
  const panes = document.querySelectorAll(".settings-pane");
  const lastPane = panes[panes.length - 1];
  if (!lastPane) return;
  lastPane.insertAdjacentHTML("afterend", `
      <!-- System -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="system">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Updates</h2>
        </div>
        <p class="settings-pane-desc">Updates &amp; version</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Updates</span>
            <button id="check-update-btn" class="settings-update-btn" type="button">Check for updates</button>
          </div>
          <div id="settings-release-notes" class="settings-release-notes hidden"></div>
        </div>

        <div class="settings-block" id="login-block">
          <div class="settings-row">
            <span class="settings-label">Password <button class="settings-info-btn" data-info="Optional. With a password set, changing Rouen&#x27;s settings, its keys and sign-ins, backups, the update, native mode, plugins and anything in your library or a streaming account needs it — anyone on your network can still play, pause, change the volume and queue, as with your server&#x27;s own apps. Each device logs in once and stays logged in. Forgotten it? Start Rouen&#x27;s container with ROUEN_RESET_PASSWORD=1 and it is removed, once." aria-label="About the password">&#9432;</button></span>
          </div>
          <div class="settings-token-row" id="login-current-row">
            <input id="login-current" type="password" class="settings-token-input" placeholder="Current password" autocomplete="current-password">
          </div>
          <div class="settings-token-row" id="login-new-row">
            <input id="login-new" type="password" class="settings-token-input" placeholder="New password (8 characters or more)" autocomplete="new-password">
          </div>
          <div class="settings-token-row" id="login-again-row">
            <input id="login-again" type="password" class="settings-token-input" placeholder="New password again" autocomplete="new-password">
            <button id="login-save" class="settings-update-btn" type="button">Set</button>
          </div>
          <div class="settings-row" id="login-actions">
            <button id="login-remove" class="settings-update-btn" type="button">Remove password</button>
            <button id="login-logout" class="settings-update-btn" type="button">Log out</button>
          </div>
          <div id="login-status" class="settings-token-status" role="status" aria-live="polite"></div>
        </div>
      </div>`);

  document.body.insertAdjacentHTML("beforeend", `
  <div id="login-overlay" class="confirm-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="login-msg">
    <div class="confirm-backdrop"></div>
    <div class="confirm-box">
      <p class="confirm-msg" id="login-msg">This needs Rouen's password.</p>
      <div class="settings-token-row">
        <input id="login-password" type="password" class="settings-token-input" placeholder="Password" autocomplete="current-password">
      </div>
      <div id="login-error" class="settings-token-status" role="alert"></div>
      <div class="confirm-actions">
        <button class="confirm-btn" id="login-cancel" type="button">Cancel</button>
        <button class="confirm-btn confirm-primary" id="login-go" type="button">Log in</button>
      </div>
    </div>
  </div>`);

  const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
  const overlay = $("login-overlay"), field = $("login-password"), err = $("login-error");
  const status = $("login-status");
  const realFetch = window.fetch.bind(window);

  /** @param {string} url @param {any} [body] */
  async function post(url, body) {
    const r = await realFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* no JSON body: the status says enough */ }
    return { ok: r.ok, status: r.status, body: /** @type {any} */ (j) };
  }

  // ---- the sheet -----------------------------------------------------------
  /** @type {Promise<boolean> | null} */
  let asking = null;
  /** Asks for the password once, however many requests are waiting on it. Resolves true once logged in. */
  function ask() {
    if (asking) return asking;
    asking = new Promise((resolve) => {
      err.textContent = "";
      field.value = "";
      overlay.classList.remove("hidden");
      setTimeout(() => { field.focus(); }, 50);
      /** @param {boolean} ok */
      const done = (ok) => {
        overlay.classList.add("hidden");
        $("login-go").onclick = $("login-cancel").onclick = field.onkeydown = null;
        asking = null;
        resolve(ok);
        if (ok) refresh();
      };
      $("login-cancel").onclick = () => done(false);
      const go = async () => {
        $("login-go").disabled = true;
        try {
          const r = await post("/api/login", { password: field.value });
          if (r.ok) return done(true);
          err.textContent = r.body.error || "Couldn't log in.";
          field.select();
        } catch (e) {
          err.textContent = "Rouen could not be reached.";
        } finally {
          $("login-go").disabled = false;
        }
      };
      $("login-go").onclick = go;
      field.onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") go(); };
    });
    return asking;
  }

  // ---- fetch: a 401 { login: true } asks, then sends again -----------------
  /** @param {RequestInfo | URL} input */
  const isApi = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/login");
  };
  window.fetch = async function (input, init) {
    const r = await realFetch(input, init);
    if (r.status !== 401 || !isApi(input)) return r;
    let wantsLogin = false;
    try { wantsLogin = (await r.clone().json()).login === true; } catch (e) { /* not Rouen's login answer: passed on as it came */ }
    if (!wantsLogin || !(await ask())) return r;
    return realFetch(input, init);
  };

  // ---- Settings → System → Password ----------------------------------------
  let enabled = false;
  let loggedIn = false;
  /** @param {{ enabled: boolean, loggedIn: boolean }} s */
  function paint(s) {
    enabled = !!s.enabled;
    loggedIn = !!s.loggedIn;
    // The page's own .hidden: these rows are display:flex, which [hidden] does not beat.
    $("login-current-row").classList.toggle("hidden", !enabled);
    $("login-actions").classList.toggle("hidden", !enabled);
    $("login-logout").classList.toggle("hidden", !loggedIn);
    $("login-save").textContent = enabled ? "Change" : "Set";
    status.textContent = !enabled ? "No password: anyone on your network can change Rouen's settings."
      : s.loggedIn ? "On. Logged in on this device." : "On. This device is not logged in.";
  }
  async function refresh() {
    try {
      const r = await realFetch("/api/login", { cache: "no-store" });
      if (r.ok) paint(await r.json());
    } catch (e) { /* offline for a moment: the section keeps what it said, and opening Settings asks again */ }
  }
  const clear = () => { $("login-current").value = ""; $("login-new").value = ""; $("login-again").value = ""; };

  $("login-save").addEventListener("click", async () => {
    const next = $("login-new").value;
    if (next.length < 8) { status.textContent = "At least 8 characters, please."; return; }
    if (next !== $("login-again").value) { status.textContent = "The two new passwords are not the same."; return; }
    const had = enabled;
    const body = had ? { current: $("login-current").value, password: next } : { password: next };
    try {
      const r = await post("/api/login/password", body);
      if (!r.ok) { status.textContent = r.body.error || "Couldn't save the password."; return; }
      clear();
      await refresh();
      status.textContent = "Password " + (had ? "changed" : "set") + ". Other devices log in with it.";
    } catch (e) { status.textContent = "Rouen could not be reached; nothing was changed."; }
  });
  $("login-remove").addEventListener("click", async () => {
    try {
      const r = await post("/api/login/password/remove", { current: $("login-current").value });
      if (!r.ok) { status.textContent = r.body.error || "Couldn't remove the password."; return; }
      clear();
      await refresh();
      status.textContent = "Password removed.";
    } catch (e) { status.textContent = "Rouen could not be reached; nothing was changed."; }
  });
  $("login-logout").addEventListener("click", async () => {
    try { await post("/api/logout"); } catch (e) { /* the next guarded action asks for the password either way */ }
    refresh();
  });
  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="system"]')) refresh();
  });

  // A backup's download: a link, not a fetch, so the 401 would be saved as the
  // file. Not logged in (as last read): ask first, then follow it.
  document.addEventListener("click", (e) => {
    const a = /** @type {HTMLAnchorElement | null} */ (e.target instanceof Element ? e.target.closest("a[download]") : null);
    if (!a || !enabled || loggedIn || a.dataset.loginAsked || !/\/api\/backups\/[^/]+\/download$/.test(new URL(a.href, location.href).pathname)) return;
    e.preventDefault();
    const href = a.getAttribute("href") || a.href, name = a.download;
    ask().then((ok) => {
      if (!ok) return;
      const again = document.createElement("a");
      again.href = href;
      again.download = name;
      again.dataset.loginAsked = "1";
      document.body.appendChild(again);
      again.click();
      again.remove();
    });
  }, true);
  refresh();
})();
