// @ts-check
/*
 * waveform-signins.js — the Qobuz and TIDAL sign-ins, under Settings → Audio Devices → Waveform (v1.9.72-t76; the owner,
 * 2026-11-02: "Services from tidal and Qobuz logins are still showing in the app. You must remove these and their
 * code", and, asked, kept the sign-ins for waveforms only; dev/design/roon-native.md §8, decision 1). Moved out of
 * public/app.js unchanged but for its words (Services is gone; the sign-ins are "above" the waveform note now):
 *
 *  - Qobuz: signs in on Qobuz's own page (/api/qobuz/oauth/start), the address it lands on pasted back when this
 *    device isn't on the home network (/api/qobuz/oauth/paste); Disconnect.
 *  - TIDAL: the device flow (/api/settings/tidal/start, then …/status every 3 s while it waits); Disconnect.
 *  - What the Qobuz sign-in means for waveforms (#qobuz-secret-status), from /api/settings/waveform's answer.
 *
 * Until v1.9.72-t77 each sign-in also showed or hid a top-bar button for Rouen's own Qobuz or TIDAL browser; those
 * browsers went in that build, and with them the buttons and the reading of both sign-ins at start, which existed
 * only for them.
 *
 * app.js calls window.RouenWaveformSignins: load() when Settings opens, closed() when it closes (a TIDAL sign-in still
 * waiting is no longer watched; the server finishes it), secret(answer) with the waveform setting. Loaded by
 * settings-sheet.js, after the markup it works on; app.js asks for it only when Settings opens or closes. Its toasts
 * are app.js's (window.__showToast).
 */
(function waveformSignins() {
  "use strict";
  /** app.js's toast, there by the time anything here is tapped. @param {string} msg @param {string} [kind] */
  const showToast = (msg, kind) => { const t = /** @type {any} */ (window).__showToast; if (typeof t === "function") t(msg, kind); };

  const qobuzPasteRow   = document.getElementById("qobuz-signin-paste");
  const qobuzPasteUrl   = document.getElementById("qobuz-signin-url");
  const qobuzPasteGo    = document.getElementById("qobuz-signin-finish");
  const qobuzConnect    = document.getElementById("qobuz-connect");
  const qobuzDisconnect = document.getElementById("qobuz-disconnect");
  const qobuzStatus     = document.getElementById("qobuz-status");

  // Shows the Qobuz connection and gates Connect / Disconnect on it.
  async function loadQobuzStatus() {
    try {
      const r = await fetch("/api/settings/qobuz");
      const j = await r.json();
      if (qobuzStatus) qobuzStatus.textContent = j.connected
        ? ("Connected" + (j.displayName ? " as " + j.displayName : ""))
        : "Not connected";
      if (qobuzDisconnect) qobuzDisconnect.classList.toggle("hidden", !j.connected);
      // The sign-in landed by itself; the recovery field has nothing left to do.
      if (qobuzPasteRow && j.connected) qobuzPasteRow.hidden = true;
      if (qobuzConnect) qobuzConnect.classList.toggle("hidden", !!j.connected);
    } catch (_) { /* display-only status — stale on failure is fine */ }
  }

  // One sign-in for everything Qobuz. It happens on Qobuz's own page, so no
  // password is typed into this app, and the token it returns serves the
  // waveforms (and, until they go, Rouen's own Qobuz favourites).
  if (qobuzConnect) {
    qobuzConnect.addEventListener("click", async () => {
      qobuzConnect.disabled = true;
      try {
        const r = await fetch("/api/qobuz/oauth/start");
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.url) throw new Error(j.error || "Couldn't start the Qobuz sign-in");
        // Opened rather than navigated, so this page keeps its state; the tab
        // that comes back carries the code straight to the server.
        window.open(j.url, "_blank", "noopener");
        if (qobuzPasteRow) qobuzPasteRow.hidden = false;
        if (qobuzStatus) {
          qobuzStatus.textContent = "Sign in on the Qobuz tab, then come back here. " +
            "If it does not connect by itself, paste the address you landed on below.";
        }
      } catch (e) {
        showToast(e.message, "error");
      } finally {
        qobuzConnect.disabled = false;
      }
    });
  }

  if (qobuzPasteGo && qobuzPasteUrl) {
    qobuzPasteGo.addEventListener("click", async () => {
      qobuzPasteGo.disabled = true;
      try {
        const r = await fetch("/api/qobuz/oauth/paste", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: qobuzPasteUrl.value })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || "Couldn't finish signing in");
        qobuzPasteUrl.value = "";
        if (qobuzPasteRow) qobuzPasteRow.hidden = true;
        showToast("Qobuz connected", "ok");
        loadQobuzStatus();
      } catch (e) {
        showToast(e.message, "error");
      } finally { qobuzPasteGo.disabled = false; }
    });
  }

  if (qobuzDisconnect) {
    qobuzDisconnect.addEventListener("click", async () => {
      qobuzDisconnect.disabled = true;
      try {
        await fetch("/api/settings/qobuz/disconnect", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        showToast("Qobuz disconnected", "ok");
        loadQobuzStatus();
      } catch (e) {
        showToast("Failed: " + e.message, "error");
      } finally {
        qobuzDisconnect.disabled = false;
      }
    });
  }

  /* ---- Tidal account (OAuth device flow — no password entered here) ---- */
  const tidalConnect     = document.getElementById("tidal-connect");
  const tidalDisconnect  = document.getElementById("tidal-disconnect");
  const tidalStatus      = document.getElementById("tidal-status");
  const tidalAuthPending = document.getElementById("tidal-auth-pending");

  // Loads connection state, and gates Disconnect on it.
  async function loadTidalStatus() {
    try {
      const r = await fetch("/api/settings/tidal");
      const j = await r.json();
      if (tidalDisconnect) tidalDisconnect.classList.toggle("hidden", !j.connected);
      if (!tidalStatus) return;
      if (j.connected) {
        tidalStatus.textContent = "Connected" + (j.displayName ? " as " + j.displayName : "");
        return;
      }
      // Not connected — surface the outcome of a device-flow attempt the
      // server finished (or is still driving) while Settings was closed, so
      // a failure isn't silently swallowed into a bare "Not connected".
      let extra = "";
      try {
        const s = await (await fetch("/api/settings/tidal/status", { cache: "no-store" })).json();
        if (s.state === "error" && s.error) extra = " — last login attempt failed: " + s.error;
        else if (s.state === "pending") extra = " — a login is awaiting authorization on tidal.com";
      } catch (_) { /* best-effort detail — a plain "Not connected" is fine */ }
      tidalStatus.textContent = "Not connected" + extra;
    } catch (_) { /* display-only status — stale on failure is fine */ }
  }

  // Device-flow poll timer: one active poll at most. A new Connect supersedes
  // any previous pending authorization; closing Settings also stops the poll
  // (the SERVER keeps polling Tidal — reopening Settings shows the outcome).
  let tidalPollTimer = null;
  function stopTidalPoll() {
    if (tidalPollTimer) { clearInterval(tidalPollTimer); tidalPollTimer = null; }
  }

  function hideTidalPending() {
    if (tidalAuthPending) { tidalAuthPending.classList.add("hidden"); tidalAuthPending.innerHTML = ""; }
  }

  // Ends the client side of the device flow: stop polling, clear the pending
  // block, re-enable Connect and refresh the status line.
  function finishTidalAuth() {
    stopTidalPoll();
    hideTidalPending();
    if (tidalConnect) tidalConnect.disabled = false;
    loadTidalStatus();
  }

  // Shows the device-authorization instructions: a link to Tidal's own page,
  // the user code in large monospace, and a waiting line. Built with
  // createElement/textContent so nothing from the server is injected as HTML.
  function showTidalPending(j) {
    if (!tidalAuthPending) return;
    tidalAuthPending.innerHTML = "";
    const link = document.createElement("a");
    link.className = "tidal-auth-link";
    link.href = j.verification_uri_complete || j.verification_uri;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open the Tidal authorization page";
    tidalAuthPending.appendChild(link);
    if (j.user_code) {
      const code = document.createElement("div");
      code.className = "tidal-auth-code";
      code.textContent = j.user_code;
      tidalAuthPending.appendChild(code);
    }
    const wait = document.createElement("div");
    wait.className = "tidal-auth-wait";
    wait.textContent = "Waiting for you to authorize in the Tidal page…";
    tidalAuthPending.appendChild(wait);
    tidalAuthPending.classList.remove("hidden");
  }

  // Poll the server every 3 s while an authorization is pending. The server
  // does the actual Tidal polling; this only watches for the outcome.
  function startTidalPoll() {
    stopTidalPoll();
    let pollFailures = 0;
    tidalPollTimer = setInterval(async () => {
      try {
        const r = await fetch("/api/settings/tidal/status", { cache: "no-store" });
        const j = await r.json();
        pollFailures = 0;
        if (j.state === "connected") {
          showToast("Tidal connected" + (j.displayName ? " as " + j.displayName : ""), "ok");
          finishTidalAuth();
        } else if (j.state === "error") {
          // finishTidalAuth → loadTidalStatus renders the persistent error
          // line ("Not connected — last login attempt failed: …").
          showToast(j.error || "Tidal authorization failed", "error");
          finishTidalAuth();
        } else if (j.state === "idle") {
          // The server no longer has a pending authorization (expired/reset).
          showToast("Tidal authorization expired — tap Connect to try again", "error");
          finishTidalAuth();
        }
        // state "pending" — keep polling
      } catch (e) {
        // Transient network failures shouldn't abort a flow the server is
        // still driving — but three misses in a row means we can no longer
        // observe the outcome, so surface it and stop.
        pollFailures++;
        if (pollFailures >= 3) {
          showToast("Lost contact while waiting for Tidal: " + e.message, "error");
          finishTidalAuth();
        }
      }
    }, 3000);
  }

  if (tidalConnect) {
    tidalConnect.addEventListener("click", async () => {
      if (tidalConnect.disabled) return;
      tidalConnect.disabled = true;
      stopTidalPoll(); // a new start supersedes any previous pending authorization
      hideTidalPending();
      try {
        const r = await fetch("/api/settings/tidal/start", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
        if (!j.verification_uri_complete && !j.verification_uri) {
          throw new Error("Tidal did not return an authorization link");
        }
        showTidalPending(j);
        startTidalPoll();
        // Connect stays disabled while the poll runs; finishTidalAuth re-enables it.
      } catch (e) {
        showToast("Tidal connect failed: " + e.message, "error");
        tidalConnect.disabled = false;
      }
    });
  }

  if (tidalDisconnect) {
    tidalDisconnect.addEventListener("click", async () => {
      tidalDisconnect.disabled = true;
      try {
        await fetch("/api/settings/tidal/disconnect", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        showToast("Tidal disconnected", "ok");
        loadTidalStatus();
      } catch (e) {
        showToast("Failed: " + e.message, "error");
      } finally {
        tidalDisconnect.disabled = false;
      }
    });
  }


  // ----- Qobuz app secret (streaming waveforms) -----
  // Blank is the default and the off switch: with no secret the server never
  // asks Qobuz for audio and streaming tracks keep the plain bar.
  const qSecStatus = document.getElementById("qobuz-secret-status");

  // No controls of its own: the Qobuz sign-in just above it (Qobuz waveforms)
  // is what waveforms use, so this only reports what that sign-in means for them.
  function showQobuzSecretState(j) {
    if (!qSecStatus) return;
    if (j && j.qobuz_connected) {
      qSecStatus.textContent = "Using your Qobuz sign-in. Qobuz tracks will show a " +
        "waveform once analysed.";
      return;
    }
    if (j && j.qobuz_secret_set) {
      qSecStatus.textContent = "Using saved credentials from an earlier version. " +
        "Reconnect Qobuz above to replace them.";
      return;
    }
    qSecStatus.textContent = "Connect Qobuz above to enable this. " +
      "Qobuz tracks keep the plain bar until then.";
  }


  /** @type {any} */ (window).RouenWaveformSignins = {
    load() { loadQobuzStatus(); loadTidalStatus(); },
    closed() { if (tidalPollTimer) finishTidalAuth(); },
    /** @param {any} j */
    secret(j) { showQobuzSecretState(j); },
  };
})();
