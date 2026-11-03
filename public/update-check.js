// @ts-check
/*
 * update-check.js — Settings → Updates, the server's row (v2.0.0-beta2; the owner, 2026-11-03: "I want Rouen's update
 * screen to be like Mandarin. Rouen's is confusing"). Mandarin's page is two rows, each its version and one button:
 * "Server v…" with Check for update here, and "Android app v…" with its own in the app (phone-settings.js).
 *
 * Check for update asks the server to look, then: an update found turns the button into "Update to v…" (or "Roll back
 * to v…"), in brass, with the release notes under it, and a second tap installs it through the update banner (which
 * sits behind Settings, so Settings closes onto it); nothing newer says "Up to date" for a few seconds; a failed look
 * says so. Moved out of public/app.js (initCheckUpdate), its words Mandarin's.
 */
(function initCheckUpdate() {
  "use strict";
  const W = /** @type {any} */ (window);
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById("check-update-btn"));
  const notesDiv = document.getElementById("settings-release-notes");
  const label = document.getElementById("server-version");
  if (!btn) return;
  const CHECK = "Check for update";

  /** The server's version on its row, as the updater has it. */
  async function paintVersion() {
    if (!label) return;
    try {
      const r = await fetch("/api/update/status", { cache: "no-store" });
      const s = r.ok ? await r.json() : null;
      if (s && s.current) label.textContent = "Server v" + s.current;
    } catch (e) { /* not reached just now: the row keeps saying "Server", and the next opening asks again */ }
  }
  paintVersion();
  document.addEventListener("click", (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (t && t.closest && t.closest('.settings-nav-item[data-pane="system"]')) paintVersion();
  });

  // After a check finds an update, the button itself becomes the install action (the update banner sits BEHIND the
  // Settings sheet, so there is no other button to tap).
  let pendingUpdate = false;
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;

    if (pendingUpdate) {
      // Second tap: install. Close Settings so the update banner (which owns the download/unpack/restart progress)
      // is visible, then hand off; this button is reset so a reopened Settings offers a fresh check.
      pendingUpdate = false;
      btn.classList.remove("is-update-ready");
      const closer = /** @type {HTMLElement | null} */ (document.querySelector("#settings-overlay [data-settings-close]"));
      if (closer) closer.click();
      if (W.__applyUpdateNow) W.__applyUpdateNow();
      btn.textContent = CHECK;
      return;
    }

    btn.disabled = true;
    btn.textContent = "Checking…";
    if (notesDiv) notesDiv.classList.add("hidden");
    try {
      await fetch("/api/update/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const r = await fetch("/api/update/status", { cache: "no-store" });
      const s = await r.json();
      if (s && s.current && label) label.textContent = "Server v" + s.current;
      if (s && s.available && s.latest) {
        pendingUpdate = true;
        btn.disabled = false;
        btn.classList.add("is-update-ready");
        btn.textContent = (s.isDowngrade ? "Roll back to v" : "Update to v") + s.latest;
        // The published image can also be pulled (v1.8.71): the server sends the command only when this release
        // exists as an image, and it sits under the notes as the alternative to the button, never instead of it.
        const notes = [s.notes, s.pull && ((s.isDowngrade ? "Or go back by pulling the image:\n"
                                                           : "Or pull the image itself:\n") + s.pull +
          "\nthen recreate the container from it (with Compose: docker compose pull && docker compose up -d).")]
          .filter(Boolean).join("\n\n");
        if (notesDiv && notes) {
          notesDiv.textContent = notes;
          notesDiv.classList.remove("hidden");
        }
      } else {
        btn.textContent = "Up to date";
        setTimeout(() => { btn.disabled = false; btn.textContent = CHECK; }, 4000);
      }
    } catch (e) {
      btn.textContent = "Check failed";
      setTimeout(() => { btn.disabled = false; btn.textContent = CHECK; }, 3000);
    }
  });
})();
