// @ts-check
/*
 * login.js — Rouen's account, on the page (v1.9.26, dev/design/login.md; the
 * password of v1.9.22 before it).
 *
 * Loaded first on all three pages — the remote, the wall display and Shelf —
 * so its fetch wrapper is in place before any screen asks for anything.
 *
 *   - THE SHEET. Rouen's account guards all of /api/ (the owner, 2026-10-14).
 *     The page asks GET /api/login: no account yet, and a full-screen sheet
 *     says "Create Rouen's account"; an account this device is not logged in
 *     to, "Log in to Rouen". It cannot be closed. Made or logged in, the page
 *     reloads, so every screen starts afresh, logged in. A 401 from any
 *     request ({ setup } or { login }) opens it the same way. An answer that
 *     says neither (no account field at all, or no answer) shows nothing.
 *     It carries its own styles — the wall display and Shelf do not load
 *     style.css — put in the body, never in <head> (dev/lessons.md).
 *   - SETTINGS → SYSTEM (the remote only, which has Settings): Updates, moved
 *     here from index.html in v1.9.22, and the Account section — who is
 *     logged in, change the password, change the username, log out.
 * The password itself goes only to /api/login*: never kept on the page.
 */
(function rouenLogin() {
  "use strict";
  const realFetch = window.fetch.bind(window);
  const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

  /** @param {string} url @param {any} [body] */
  async function post(url, body) {
    const r = await realFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* no JSON body: the status says enough */ }
    return { ok: r.ok, status: r.status, body: /** @type {any} */ (j) };
  }

  // ---- the sheet -------------------------------------------------------------
  document.body.insertAdjacentHTML("beforeend", `
  <style>
    #rouen-gate { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #0d0d0f; color: #f2f2f2; font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #rouen-gate.hidden { display: none; }
    #rouen-gate form { width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 12px; }
    #rouen-gate h1 { font-size: 22px; margin: 0; font-weight: 700; }
    #rouen-gate p { margin: 0; color: #a8a8ae; font-size: 14px; }
    #rouen-gate input { font: inherit; padding: 12px 14px; border-radius: 12px; border: 1px solid #3a3a40; background: #1b1b1f; color: inherit; }
    #rouen-gate input:focus { outline: none; border-color: #c9a45c; }
    #rouen-gate input.hidden { display: none; }
    #rouen-gate button { font: inherit; font-weight: 700; padding: 12px 14px; border-radius: 999px; border: 0; background: #c9a45c; color: #141414; cursor: pointer; }
    #rouen-gate button:disabled { opacity: .6; }
    #rouen-gate-error { color: #ff7b72; font-size: 14px; min-height: 1.4em; }
    @media (prefers-color-scheme: light) {
      #rouen-gate { background: #f6f5f2; color: #17171a; }
      #rouen-gate p { color: #5d5d64; }
      #rouen-gate input { background: #fff; border-color: #cfcfd4; }
      #rouen-gate-error { color: #b42318; }
    }
  </style>
  <div id="rouen-gate" class="hidden" role="dialog" aria-modal="true" aria-labelledby="rouen-gate-title">
    <form id="rouen-gate-form" autocomplete="on" novalidate>
      <h1 id="rouen-gate-title">Log in to Rouen</h1>
      <p id="rouen-gate-desc"></p>
      <input id="rouen-gate-user" type="text" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">
      <input id="rouen-gate-current" type="password" placeholder="The password Rouen already has" autocomplete="current-password">
      <input id="rouen-gate-password" type="password" placeholder="Password" autocomplete="current-password">
      <input id="rouen-gate-again" type="password" placeholder="Password again" autocomplete="new-password">
      <div id="rouen-gate-error" role="alert"></div>
      <button id="rouen-gate-go" type="submit">Log in</button>
    </form>
  </div>`);

  const gate = $("rouen-gate"), err = $("rouen-gate-error");
  /** @type {"" | "setup" | "legacy" | "login"} */
  let showing = "";

  /** @param {"setup" | "legacy" | "login"} kind */
  function show(kind) {
    if (showing === kind) return;
    showing = kind;
    const setup = kind === "setup", legacy = kind === "legacy";
    $("rouen-gate-title").textContent = kind === "login" ? "Log in to Rouen" : "Create Rouen's account";
    $("rouen-gate-desc").textContent = kind === "login"
      ? "This Rouen has an account. Log in with its username and password; this device stays logged in."
      : legacy
        ? "Rouen now has an account. Choose a username, and give the password this Rouen already has: together they are the account."
        : "Rouen needs an account before anyone can use it. Choose a username and a password (8 characters or more); this device stays logged in.";
    $("rouen-gate-current").classList.toggle("hidden", !legacy);
    $("rouen-gate-password").classList.toggle("hidden", legacy);
    $("rouen-gate-again").classList.toggle("hidden", !setup);
    $("rouen-gate-password").setAttribute("autocomplete", setup ? "new-password" : "current-password");
    $("rouen-gate-go").textContent = kind === "login" ? "Log in" : "Create account";
    err.textContent = "";
    gate.classList.remove("hidden");
    setTimeout(() => { $("rouen-gate-user").focus(); }, 50);
  }

  $("rouen-gate-form").addEventListener("submit", async (/** @type {Event} */ e) => {
    e.preventDefault();
    const user = $("rouen-gate-user").value, password = $("rouen-gate-password").value;
    if (!user.trim()) { err.textContent = "A username, please."; return; }
    /** @type {[string, any]} */
    let call;
    if (showing === "login") call = ["/api/login", { user, password }];
    else if (showing === "legacy") call = ["/api/login/setup", { user, current: $("rouen-gate-current").value }];
    else {
      if (password.length < 8) { err.textContent = "At least 8 characters for the password, please."; return; }
      if (password !== $("rouen-gate-again").value) { err.textContent = "The two passwords are not the same."; return; }
      call = ["/api/login/setup", { user, password }];
    }
    $("rouen-gate-go").disabled = true;
    try {
      const r = await post(call[0], call[1]);
      if (r.ok) { location.reload(); return; }
      // Someone else made the account first, or it was made on another device: log in instead.
      if (r.status === 409) { show("login"); err.textContent = r.body.error || ""; return; }
      err.textContent = r.body.error || "Couldn't do that.";
    } catch (e2) {
      err.textContent = "Rouen could not be reached.";
    } finally {
      $("rouen-gate-go").disabled = false;
    }
  });

  /** What GET /api/login (or a 401's body) says to show, if anything. @param {any} s */
  function judge(s) {
    if (!s || typeof s !== "object") return;
    if (s.setup === true) show(s.legacy === true ? "legacy" : "setup");
    else if (s.login === true || (s.account === true && s.loggedIn === false)) show("login");
  }

  // ---- fetch: a 401 { setup } or { login } opens the sheet --------------------
  /** @param {RequestInfo | URL} input */
  const isApi = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname.toLowerCase().startsWith("/api/");
  };
  window.fetch = async function (input, init) {
    const r = await realFetch(input, init);
    if (r.status === 401 && isApi(input)) {
      try { judge(await r.clone().json()); } catch (e) { /* not Rouen's answer: passed on as it came */ }
    }
    return r;
  };

  /** @type {any} */
  let account = null;
  /** Settings' Account line: drawn on the remote, which has Settings; nothing on the wall display and Shelf. */
  let paint = () => {};
  async function refresh() {
    try {
      const r = await realFetch("/api/login", { cache: "no-store" });
      if (!r.ok) return;
      account = await r.json();
      judge(account);
      paint();
    } catch (e) { /* offline for a moment: the next request that fails asks again */ }
  }

  // ---- Settings → System (the remote only) -----------------------------------
  const panes = document.querySelectorAll(".settings-pane");
  const lastPane = panes[panes.length - 1];
  if (lastPane) {
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
            <span class="settings-label">Account <button class="settings-info-btn" data-info="Rouen&#x27;s one account guards all of Rouen: without it a device sees only the login screen. Each device logs in once and stays logged in; changing the password logs every other device out. Forgotten it? Start Rouen&#x27;s container with ROUEN_RESET_PASSWORD=1: the account is removed, once, and the next device to open Rouen makes a new one." aria-label="About the account">&#9432;</button></span>
            <button id="login-logout" class="settings-update-btn" type="button">Log out</button>
          </div>
          <div id="login-status" class="settings-token-status" role="status" aria-live="polite"></div>
          <div class="settings-token-row">
            <input id="login-current" type="password" class="settings-token-input" placeholder="Current password" autocomplete="current-password">
          </div>
          <div class="settings-token-row">
            <input id="login-new" type="password" class="settings-token-input" placeholder="New password (8 characters or more)" autocomplete="new-password">
          </div>
          <div class="settings-token-row">
            <input id="login-again" type="password" class="settings-token-input" placeholder="New password again" autocomplete="new-password">
            <button id="login-save" class="settings-update-btn" type="button">Change</button>
          </div>
          <div class="settings-token-row">
            <input id="login-user" type="text" class="settings-token-input" placeholder="New username" autocomplete="username" autocapitalize="none" spellcheck="false">
            <button id="login-rename" class="settings-update-btn" type="button">Change</button>
          </div>
        </div>
      </div>`);

    const status = $("login-status");
    const clear = () => { for (const id of ["login-current", "login-new", "login-again", "login-user"]) $(id).value = ""; };
    paint = () => {
      status.textContent = account && account.loggedIn && account.user
        ? "Logged in as " + account.user + ". Changing either needs the current password."
        : "";
    };

    $("login-save").addEventListener("click", async () => {
      const next = $("login-new").value;
      if (next.length < 8) { status.textContent = "At least 8 characters for the password, please."; return; }
      if (next !== $("login-again").value) { status.textContent = "The two new passwords are not the same."; return; }
      try {
        const r = await post("/api/login/password", { current: $("login-current").value, password: next });
        if (!r.ok) { status.textContent = r.body.error || "Couldn't change the password."; return; }
        clear();
        status.textContent = "Password changed. Every other device logs in with it.";
      } catch (e) { status.textContent = "Rouen could not be reached; nothing was changed."; }
    });
    $("login-rename").addEventListener("click", async () => {
      try {
        const r = await post("/api/login/username", { current: $("login-current").value, user: $("login-user").value });
        if (!r.ok) { status.textContent = r.body.error || "Couldn't change the username."; return; }
        clear();
        await refresh();
        status.textContent = "Username changed to " + r.body.user + ".";
      } catch (e) { status.textContent = "Rouen could not be reached; nothing was changed."; }
    });
    $("login-logout").addEventListener("click", async () => {
      try { await post("/api/logout"); } catch (e) { /* the page reloads either way, and asks */ }
      location.reload();
    });
    document.addEventListener("click", (e) => {
      const t = /** @type {Element | null} */ (e.target);
      if (t && t.closest && t.closest('.settings-nav-item[data-pane="system"]')) refresh();
    });
  }
  refresh();
})();
