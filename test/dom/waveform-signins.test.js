"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t76: Services is gone (the owner, 2026-11-02: "Services from tidal and Qobuz logins are still showing in the
// app. You must remove these"; asked, the owner kept the sign-ins for waveforms only). The Qobuz and TIDAL sign-ins are
// under Settings → Audio Devices → Waveform, as "Qobuz waveforms" and "TIDAL waveforms", worked by app.js as before:
//   - no Services entry in the Settings list and no Services page;
//   - each sign-in's controls on Audio Devices, in the Waveform block, after the Waveform switch;
//   - their state read and shown there (Connected as …, Not connected), Disconnect only when connected.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/settings/qobuz") > -1) return window.__json({ connected: true, displayName: "Bob" });
  if (u.indexOf("/api/settings/tidal") > -1) return window.__json({ connected: false });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/settings/waveform") > -1) return window.__json({ enabled: true, qobuz_connected: false, qobuz_secret_set: false });
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(800);
  T("nav", Array.prototype.map.call(document.querySelectorAll("#settings-overlay .settings-nav > .settings-nav-item"),
    function (b) { return b.getAttribute("data-pane"); }));
  T("pane", document.querySelectorAll('.settings-pane[data-pane="streaming"]').length);
  window.__openSettingsPane("playback");
  await window.__sleep(300);
  var devices = document.querySelector('.settings-pane[data-pane="playback"]');
  var wave = document.getElementById("waveform-enabled").closest(".settings-block");
  var inWave = function (id) { var e = document.getElementById(id); return !!e && wave.contains(e) && devices.contains(e); };
  var after = function (id) { var e = document.getElementById(id); return !!e && !!(document.getElementById("waveform-enabled").compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); };
  T("placed", ["qobuz-connect", "qobuz-status", "qobuz-disconnect", "tidal-connect", "tidal-status", "tidal-disconnect"]
    .map(function (id) { return [id, inWave(id), after(id)]; }));
  T("labels", Array.prototype.map.call(wave.querySelectorAll(".settings-label"), function (l) { return l.firstChild.textContent.trim(); }));
  T("state", [document.getElementById("qobuz-status").textContent, document.getElementById("qobuz-disconnect").classList.contains("hidden"),
    document.getElementById("tidal-status").textContent, document.getElementById("tidal-disconnect").classList.contains("hidden")]);
  T("secret", document.getElementById("qobuz-secret-status").textContent);
  // The top-bar buttons are streaming.js's, which may run after this script: ones made later still follow the sign-ins.
  ["qobuz-toggle", "tidal-toggle"].forEach(function (id) {
    var old = document.getElementById(id); if (old) old.remove();
    var b = document.createElement("button"); b.id = id; b.className = "hidden"; document.body.appendChild(b);
  });
  window.RouenWaveformSignins.load();
  await window.__sleep(300);
  T("late", [document.getElementById("qobuz-toggle").classList.contains("hidden"), document.getElementById("tidal-toggle").classList.contains("hidden")]);
  T("services", (devices.textContent.match(/Services/g) || []).length);
`;

test("v1.9.72-t76: no Services; the Qobuz and TIDAL sign-ins are Audio Devices → Waveform's, for waveforms only", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "waveform-signins", windowSize: "390x844", stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: no Services entry and no Services page", () => {
    assert.ok(!r.nav.includes("streaming"), "Services is still in the Settings list: " + r.nav.join(", "));
    assert.equal(r.pane, 0);
  });
  await t.test("each sign-in's controls in the Waveform block, after its switch", () => {
    for (const [id, inWave, after] of r.placed) assert.deepEqual([id, inWave, after], [id, true, true]);
    assert.deepEqual(r.labels, ["Waveform", "Qobuz waveforms", "TIDAL waveforms"]);
  });
  await t.test("their state shown there, as app.js reads it", () => {
    assert.deepEqual(r.state, ["Connected as Bob", false, "Not connected", true]);
  });
  await t.test("top-bar buttons made after this script still follow the sign-ins (Qobuz shown, TIDAL hidden)", () => {
    assert.deepEqual(r.late, [false, true]);
  });
  await t.test("what the Qobuz sign-in means for waveforms points to it, not to Services", () => {
    assert.match(r.secret, /^Connect Qobuz above to enable this\./);
    assert.equal(r.services, 0, "Audio Devices still names Services");
  });
});
