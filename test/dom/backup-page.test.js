"use strict";
// ---------------------------------------------------------------------------
// v1.8.84: Settings → Backup & restore, on the real page.
//
//   1. The page lists the parts as switches (all on by default, the choice
//      remembered per device), and lists the server's backups newest first,
//      each with Restore / Download / Delete, a "Before restore" copy marked.
//   2. Back up now sends the parts that are ON, and only those.
//   3. Restore asks first, sends only the chosen parts the backup HOLDS, then
//      says it is restarting and locks the page — a second tap mid-restart
//      must not start another restore.
//   4. A backup holding none of what is switched on is refused with a message
//      naming what it does hold, before any dialog.
//   5. Nothing on the page runs off the side of a phone.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__posts = [];
window.__installFetch(function (u, opts) {
  var m = (opts && opts.method) || "GET";
  if (u.indexOf("/api/backups") > -1) {
    if (m !== "GET") window.__posts.push({ url: u, method: m, body: opts && typeof opts.body === "string" ? JSON.parse(opts.body) : null });
    var list = [
      { id: "rouen-before-restore-20261007-120500", kind: "before-restore", created: "2026-10-07T12:05:00.000Z",
        version: "1.8.84", parts: ["settings", "playlists", "later", "keys"], size: 30000 },
      { id: "rouen-backup-20261007-120000", kind: "manual", created: "2026-10-07T12:00:00.000Z",
        version: "1.8.84", parts: ["settings", "later"], size: 2048 },
      { id: "rouen-backup-20261001-090000", kind: "manual", created: "2026-10-01T09:00:00.000Z",
        version: "1.8.83", parts: ["keys"], size: 900 },
    ];
    if (u.indexOf("/restore") > -1) return window.__json({ ok: true, restored: ["settings"], before: "x", restarting: true });
    return window.__json({ boot: "b1", parts: ["settings", "playlists", "later", "keys"], keep: { manual: 10, before: 5 }, backups: list, ok: true });
  }
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(600);
  var still = document.createElement("style");
  still.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(still);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="backup"]').click();
  await window.__sleep(600);
  var pane = document.querySelector('.settings-pane[data-pane="backup"]');
  var sheet = document.querySelector("#settings-overlay .settings-sheet");
  T("pane_shown", !pane.classList.contains("hidden"));
  var sw = Array.prototype.slice.call(pane.querySelectorAll("#backup-parts input[data-part]"));
  T("parts", sw.map(function (i) { return i.dataset.part + ":" + i.checked; }));
  var rows = Array.prototype.slice.call(pane.querySelectorAll(".backup-row"));
  T("rows", rows.map(function (r) {
    return { id: r.dataset.id, kind: r.querySelector(".backup-kind").textContent,
             btns: Array.prototype.map.call(r.querySelectorAll("button"), function (b) { return b.textContent; }),
             sub: r.querySelector(".backup-sub").textContent };
  }));
  T("overflow_x", sheet.scrollWidth - sheet.clientWidth);
  var vw = window.innerWidth, out = [];
  pane.querySelectorAll(".backup-row button, #backup-now, #backup-upload").forEach(function (b) {
    var r = b.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) out.push(b.textContent);
  });
  T("offscreen", out);

  // 2. Keys off, then Back up now.
  var keys = pane.querySelector('#backup-parts input[data-part="keys"]');
  keys.click();
  await window.__sleep(100);
  var saved = null; try { saved = localStorage.getItem("rra-backup-parts"); } catch (e) {}
  T("saved_parts", saved);
  document.getElementById("backup-now").click();
  await window.__sleep(400);
  T("post1", window.__posts[0]);
  T("status1", document.getElementById("backup-status").textContent);

  // 4. The keys-only backup holds nothing that is on now.
  var keysRow = pane.querySelector('.backup-row[data-id="rouen-backup-20261001-090000"]');
  keysRow.querySelector(".backup-restore").click();
  await window.__sleep(300);
  T("refused_status", document.getElementById("backup-status").textContent);
  T("refused_dialog", !document.getElementById("confirm-overlay").classList.contains("hidden"));
  T("posts_after_refuse", window.__posts.length);

  // 3. Restore the settings+later backup: asked first, then only those parts.
  var row = pane.querySelector('.backup-row[data-id="rouen-backup-20261007-120000"]');
  row.querySelector(".backup-restore").click();
  await window.__sleep(300);
  var ov = document.getElementById("confirm-overlay");
  T("dialog", !ov.classList.contains("hidden"));
  T("dialog_msg", document.getElementById("confirm-msg").textContent);
  T("posts_before_yes", window.__posts.length);
  document.getElementById("confirm-yes").click();
  await window.__sleep(500);
  T("post2", window.__posts[1]);
  T("status2", document.getElementById("backup-status").textContent);
  T("locked", Array.prototype.every.call(pane.querySelectorAll(".backup-row button, #backup-now, #backup-upload"),
    function (b) { return b.disabled; }));
`;

test("Settings → Backup & restore", { skip: !harness.available }, () => {
  const out = harness.renderPage({ stub: STUB, driver: DRIVER, name: "backup-page", windowSize: "390x844" });
  harness.assertNoPageError(assert, out);
  assert.equal(out.pane_shown, true);
  assert.deepEqual(out.parts, ["settings:true", "playlists:true", "later:true", "keys:true"]);
  assert.equal(out.rows.length, 3);
  assert.equal(out.rows[0].kind, "Before restore");
  assert.equal(out.rows[1].kind, "Backup");
  assert.deepEqual(out.rows[1].btns, ["Restore", "Download", "Delete"]);
  assert.match(out.rows[1].sub, /Settings, Listen later/);
  assert.equal(out.overflow_x, 0);
  assert.deepEqual(out.offscreen, []);

  assert.equal(out.saved_parts, JSON.stringify(["settings", "playlists", "later"]));
  assert.equal(out.post1.method, "POST");
  assert.deepEqual(out.post1.body, { parts: ["settings", "playlists", "later"] });
  assert.match(out.status1, /^Backed up/);

  assert.match(out.refused_status, /holds none of what is switched on.*API keys/);
  assert.equal(out.refused_dialog, false);
  assert.equal(out.posts_after_refuse, 1);

  assert.equal(out.dialog, true);
  assert.match(out.dialog_msg, /Restore Settings, Listen later from/);
  assert.equal(out.posts_before_yes, 1, "nothing is restored before the answer");
  assert.match(out.post2.url, /\/api\/backups\/rouen-backup-20261007-120000\/restore$/);
  assert.deepEqual(out.post2.body, { parts: ["settings", "later"] });
  assert.match(out.status2, /Restarting/);
  assert.equal(out.locked, true);
});
