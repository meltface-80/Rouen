// @ts-check
"use strict";
/*
 * update-status.js — what Roon's own extension panel says of Rouen's updates: the note on its
 * status line, and the Updates section of its Settings (moved out of index.js in v1.9.32,
 * dev/quality.md "Splitting the monoliths", item 1; behaviour unchanged).
 */

/** @typedef {{ apply: { phase: string }, checking?: boolean, error?: string | null, available?: boolean, latest?: string, notes?: string | null, pull?: string | null }} UpdateStatus */

/**
 * The note after the pairing state on Roon's status line, or "".
 * @param {UpdateStatus} st  the updater's getStatus()
 */
function updateNotice(st) {
  if (st.apply.phase === "downloading" || st.apply.phase === "extracting") return "  •  Updating…";
  if (st.apply.phase === "restarting") return "  •  Restarting to update…";
  if (st.available) return `  •  Update available: v${st.latest} — install from the web app or this Settings page`;
  return "";
}

/**
 * The Updates section of Roon's Settings panel for Rouen: its rows, in order.
 * @param {UpdateStatus} st  the updater's getStatus()
 * @param {string} displayBuild  the build shown in "Keep Build …"
 * @returns {any[]}
 */
function updateLayout(st, displayBuild) {
  const layout = [];
  layout.push({ type: "label", title: "─── Updates ───" });
  if (st.apply.phase === "downloading" || st.apply.phase === "extracting" || st.apply.phase === "restarting") {
    layout.push({ type: "label", title: "Installing update… the extension will restart shortly." });
  } else if (st.checking) {
    layout.push({ type: "label", title: "Checking GitHub for updates…" });
  } else if (st.error) {
    layout.push({ type: "label", title: "Update check problem: " + st.error });
  } else if (st.available) {
    layout.push({ type: "label", title: "An update is available: v" + st.latest + "." });
    if (st.notes) layout.push({ type: "label", title: "Notes: " + st.notes.slice(0, 280) });
    layout.push({
      type: "dropdown", title: "Install update", setting: "do_update",
      values: [
        { title: "Keep Build " + displayBuild, value: "no" },
        { title: "Install v" + st.latest + " now (restarts the extension)", value: "yes" }
      ]
    });
    // The published image can be pulled instead (v1.8.71) — offered beside
    // the switch, never in place of it.
    if (st.pull) layout.push({ type: "label", title: "Or pull the image itself: " + st.pull +
      ", then recreate the container from it (with Compose: docker compose pull && docker compose up -d)." });
  } else {
    layout.push({ type: "label", title: "You're on the latest version." });
    layout.push({
      type: "dropdown", title: "Check for updates", setting: "do_check",
      values: [
        { title: "No action", value: "no" },
        { title: "Check now", value: "yes" }
      ]
    });
  }
  return layout;
}

module.exports = { updateNotice, updateLayout };
