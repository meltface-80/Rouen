"use strict";
// ---------------------------------------------------------------------------
// Profiles on the screen (2.0.7-t2, dev/design/profiles.md §6; public/profiles.js). The owner (2026-11-26): "Profiles
// would be selectable from the side menu with a profile icon towards the top". The side menu's row and its picker (the
// profiles and Guest; choosing one switches this device, Home's kept rows dropped first), Settings → Profiles (add,
// rename, remove with its plays moved), and a zone's "Listening here counts for". In the real page at phone width,
// against stubbed routes. Broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONES = [{ zone_id: "16aa01", display_name: "Kitchen", state: "paused", outputs: [{ output_id: "o1", display_name: "Kitchen" }] }];
const PROFILES = { profiles: [{ id: "1", name: "Alex", colour: "#5b8def", first: true },
  { id: "9", name: "Bartholomew-Maximilian Featherstonehaugh the Third", colour: "#4fb286", first: false }, { id: "2", name: "Sam", colour: "#e0795a", first: false }],
  guest: { id: "guest", name: "Guest" }, current: "1", colours: ["#5b8def", "#e0795a", "#4fb286"] };

const stubFor = (v) => `
window.__posts = [];
var view = ${JSON.stringify(v)};
window.__installFetch(function (u, opts) {
  if (opts && opts.method === "POST") {
    var body = JSON.parse(opts.body);
    window.__posts.push({ url: u, body: body });
    if (u === "/api/profiles/current") { view.current = body.id; return window.__json(view); }
    if (u === "/api/profiles") { view.profiles.push({ id: "3", name: body.name, colour: "#4fb286", first: false }); return window.__json(Object.assign({ added: "3" }, view)); }
    if (/\\/remove$/.test(u)) { view.profiles = view.profiles.filter(function (p) { return u.indexOf("/" + p.id + "/") < 0; }); return window.__json(view); }
    if (u === "/api/zone-profile") return window.__json({ zone: body.zone, profile: body.profile });
    if (u.indexOf("/api/profiles/") === 0) { view.profiles.forEach(function (p) { if (u === "/api/profiles/" + p.id) { p.name = body.name || p.name; if ("roonProfile" in body) p.roonProfile = body.roonProfile; } }); return window.__json(view); }
  }
  if (u.indexOf("/api/profiles") > -1) return window.__json(view);
  if (u.indexOf("/api/zone-profile") > -1) return window.__json({ zone: "16aa01", profile: "1" });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: ${JSON.stringify(ZONES)} });
  if (u.indexOf("/api/backups") > -1) return window.__json({ boot: "b1", parts: ["settings", "playlists", "later", "keys", "profiles"], keep: { manual: 10, before: 5 }, backups: [] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
const STUB = stubFor(PROFILES);

const DRIVER = `
  await window.__sleep(500);
  window.RouenProfiles.reload = function () { window.__reloaded = (window.__reloaded || 0) + 1; };
  localStorage.setItem("rra-home-cache-v1", JSON.stringify({ unplayed: ["Alex's"] }));
  document.getElementById("menu-toggle").click();
  await window.__sleep(300);
  var row = document.getElementById("menu-profile");
  var r = row.getBoundingClientRect();
  T("menu", { name: document.getElementById("menu-profile-name").textContent, face: document.getElementById("menu-profile-face").textContent,
    height: Math.round(r.height), first: row.previousElementSibling && row.previousElementSibling.className, wide: r.right <= window.innerWidth });
  row.click();
  await window.__sleep(300);
  var opts = Array.prototype.map.call(document.querySelectorAll("#profile-picker [data-profile]"), function (b) {
    return b.dataset.profile + ":" + b.getAttribute("aria-checked"); });
  // A long name on one line, cut short (§6): the row stays 44 px.
  T("long", (function () {
    var n = document.getElementById("menu-profile-name");
    var keep = n.textContent;
    n.textContent = "Bartholomew-Maximilian Featherstonehaugh the Third";
    var out = { h: Math.round(row.getBoundingClientRect().height), cut: n.scrollWidth > n.clientWidth, style: getComputedStyle(n).textOverflow };
    n.textContent = keep;
    return out;
  })());
  T("picker", { open: !document.getElementById("profile-picker").classList.contains("hidden"), opts: opts,
    guest: document.querySelector('#profile-picker [data-profile="guest"]').textContent.replace(/\\s+/g, " ").trim() });
  document.querySelector('#profile-picker [data-profile="2"]').click();
  await window.__sleep(300);
  T("switched", { post: window.__posts[0], reloaded: window.__reloaded || 0, cache: localStorage.getItem("rra-home-cache-v1") });
  // Settings → Profiles
  document.getElementById("profile-picker-close").click();
  document.querySelector("#menu-overlay [data-menu-close]").click();
  window.__openSettingsPane("profiles");
  await window.__sleep(500);
  var names = Array.prototype.map.call(document.querySelectorAll("#profiles-body .profile-name"), function (i) { return i.value; });
  var navOrder = Array.prototype.map.call(document.querySelectorAll(".settings-nav-item[data-pane]"), function (b) { return b.dataset.pane; });
  T("pane", { names: names, guest: /Guest/.test(document.getElementById("profiles-body").textContent),
    afterDevices: navOrder.indexOf("profiles") === navOrder.indexOf("playback") + 1 });
  document.getElementById("profiles-new").value = "Kim";
  document.getElementById("profiles-add").click();
  await window.__sleep(300);
  var kim = document.querySelector('#profiles-body .profile-row[data-id="3"]');
  T("added", { post: window.__posts[window.__posts.length - 1], there: !!kim, cleared: document.getElementById("profiles-new").value });
  var nameInput = document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-name');
  nameInput.value = "Samira";
  nameInput.dispatchEvent(new Event("change", { bubbles: true }));
  await window.__sleep(300);
  T("renamed", window.__posts[window.__posts.length - 1]);
  document.querySelector('#profiles-body .profile-row[data-id="3"] .profile-remove').click();
  var move = document.querySelector('#profiles-body .profile-row[data-id="3"] .profile-move');
  T("moveChoices", Array.prototype.map.call(move.options, function (o) { return o.value; }));
  move.value = "2";
  document.querySelector('#profiles-body .profile-row[data-id="3"] .profile-remove-yes').click();
  await window.__sleep(300);
  T("removed", { post: window.__posts[window.__posts.length - 1], left: document.querySelectorAll("#profiles-body .profile-row").length,
    reloads: window.__reloaded || 0 });
  // Removing the profile this device is on (Sam, chosen above): the page read again for the one it's on now.
  document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-remove').click();
  document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-remove-yes').click();
  await window.__sleep(300);
  T("removedMine", window.__reloaded || 0);
  // A zone's page
  window.__openSettingsPane("playback");
  await window.__sleep(600);
  document.querySelector("#ad-devices .ad-card").click();
  await window.__sleep(500);
  var sel = document.getElementById("zone-profile");
  T("zone", { shown: !document.getElementById("zone-profile-block").hidden, value: sel.value,
    opts: Array.prototype.map.call(sel.options, function (o) { return o.textContent; }) });
  sel.value = "guest";
  sel.dispatchEvent(new Event("change"));
  await window.__sleep(300);
  T("zoneSaved", window.__posts[window.__posts.length - 1]);
  window.__openSettingsPane("playback");
  await window.__sleep(200);
  document.querySelector('.settings-nav-item[data-pane="backup"]').click();   // as Settings' own list opens it
  await window.__sleep(600);
  var part = document.querySelector('#backup-parts input[data-part="profiles"]');
  T("backup", part ? part.closest(".settings-row").querySelector(".settings-label").textContent : null);
`;

test("profiles: the side menu's row and picker; Settings → Profiles; a zone's \"Listening here counts for\"", () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "profiles", windowSize: "390x844", budgetMs: 25000, stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.menu.name, "Alex", "THE one: no profile at the top of the side menu");
  assert.equal(r.menu.face, "A");
  assert.ok(r.menu.height >= 44, "the row under a finger's 44 px");
  assert.equal(r.menu.first, "menu-head", "not at the top");
  assert.equal(r.menu.wide, true);
  assert.equal(r.picker.open, true);
  assert.deepEqual(r.long, { h: r.menu.height, cut: true, style: "ellipsis" }, "a long name wrapped the row or ran off it");
  assert.deepEqual(r.picker.opts, ["1:true", "9:false", "2:false", "guest:false"]);
  assert.match(r.picker.guest, /Guest counts for no one/);
  assert.deepEqual(r.switched.post, { url: "/api/profiles/current", body: { id: "2" } });
  assert.equal(r.switched.reloaded, 1, "the page not read again for the profile");
  assert.equal(r.switched.cache, null, "the last profile's Home rows kept, to flash on the next open");
  assert.deepEqual(r.pane.names, ["Alex", "Bartholomew-Maximilian Featherstonehaugh the Third", "Sam"]);
  assert.equal(r.pane.guest, true);
  assert.equal(r.pane.afterDevices, true, "Profiles not just after Audio Devices");
  assert.deepEqual(r.added.post, { url: "/api/profiles", body: { name: "Kim" } });
  assert.equal(r.added.there, true);
  assert.equal(r.added.cleared, "");
  assert.deepEqual(r.renamed, { url: "/api/profiles/2", body: { name: "Samira" } });
  assert.deepEqual(r.moveChoices, ["1", "9", "2"], "a profile offered to move its plays to itself");
  assert.deepEqual(r.removed.post, { url: "/api/profiles/3/remove", body: { moveTo: "2" } });
  assert.equal(r.removed.left, 3);
  assert.equal(r.removed.reloads, 1, "another profile's removal reloaded this device");
  assert.equal(r.removedMine, 2, "THE one (the review): this device's own profile removed, its Home left showing it");
  assert.equal(r.zone.shown, true, "no \"Listening here counts for\" on the zone's page");
  assert.equal(r.zone.value, "1");
  assert.deepEqual(r.zone.opts, ["Alex", "Bartholomew-Maximilian Featherstonehaugh the Third", "Guest (no one)"]);
  assert.deepEqual(r.zoneSaved, { url: "/api/zone-profile", body: { zone: "16aa01", profile: "guest" } });
  assert.equal(r.backup, "Profiles (not their plays)", "the backup's profiles part unnamed, or said to hold the plays");
});

// P2 (2.0.7-t4, §5, §6): each profile's Roon profile, on Settings → Profiles, when the server has more than one.
const ROON = { profiles: [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "Kid" }] };
const LINK_DRIVER = `
  await window.__sleep(500);
  window.__openSettingsPane("profiles");
  await window.__sleep(500);
  var sels = document.querySelectorAll("#profiles-body .profile-roon");
  var sam = document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-roon');
  var head = document.querySelector("#profiles-body .profile-pairing");
  T("head", { pairing: head ? head.textContent.replace(/\\s+/g, " ").trim() : null, reread: !!document.getElementById("profiles-reread") });
  T("shown", { count: sels.length, opts: sam ? Array.prototype.map.call(sam.options, function (o) { return o.value + ":" + o.textContent; }) : null,
    value: sam ? sam.value : null, wide: sam ? sam.getBoundingClientRect().right <= window.innerWidth : null });
  if (sam) {
    sam.value = "deadbeef";
    sam.dispatchEvent(new Event("change", { bubbles: true }));
    await window.__sleep(300);
    T("linked", { post: window.__posts[window.__posts.length - 1], value: document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-roon').value,
      note: document.getElementById("profiles-note").textContent });
    var make = document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-roon');
    make.value = "create";
    make.dispatchEvent(new Event("change", { bubbles: true }));
    await window.__sleep(300);
    T("made", { post: window.__posts[window.__posts.length - 1], note: document.getElementById("profiles-note").textContent });
    var again = document.querySelector('#profiles-body .profile-row[data-id="2"] .profile-roon');
    again.value = "";
    again.dispatchEvent(new Event("change", { bubbles: true }));
    await window.__sleep(300);
    T("unlinked", { post: window.__posts[window.__posts.length - 1], note: document.getElementById("profiles-note").textContent });
    var gone = document.querySelector('#profiles-body .profile-row[data-id="9"] .profile-roon');
    T("gone", { value: gone.value, text: gone.options[gone.selectedIndex].textContent });
    document.getElementById("profiles-reread").click();
    await window.__sleep(200);
    T("reread", { post: window.__posts[window.__posts.length - 1], note: document.getElementById("profiles-note").textContent });
  }
`;

test("§13.2: each profile's Roon profile, paired on Settings → Profiles, one each; the pairing said; Read Roon's profiles again; native mode not in use, none of it", () => {
  if (!harness.available) return;
  // Alex is paired with Owner; Bartholomew with a Roon profile the server no longer has; Sam with none.
  const paired = { "1": ["cafebabe", "paired"], "9": ["00ff00", "gone"], "2": [null, "none"] };
  const two = Object.assign({}, PROFILES, { roon: ROON, pairing: true,
    profiles: PROFILES.profiles.map((p) => Object.assign({}, p, { roonProfile: paired[p.id][0], roonState: paired[p.id][1] })) });
  const r = harness.renderPage({ name: "profiles-roon", windowSize: "390x844", budgetMs: 15000, stub: stubFor(two), driver: LINK_DRIVER });
  harness.assertNoPageError(assert, r);
  assert.match(r.head.pairing, /^Pair each profile with its Roon profile, or create it in Roon\. Until then, it has no favourites/, "THE one: the pairing not said");
  assert.equal(r.head.reread, true, "no way to read Roon's profiles again");
  assert.equal(r.shown.count, 3, "no Roon profile to choose for each profile");
  assert.deepEqual(r.shown.opts, [":None: no favourites of its own", "create:Create in Roon as \u201cSam\u201d", "deadbeef:Kid"],
    "THE one: Owner, Alex's, offered to Sam too; or (P3b) Sam not offered to be made in Roon");
  assert.deepEqual(r.made.post, { url: "/api/profiles/2", body: { roonProfile: "create" } }, "P3b: Create in Roon not sent");
  assert.match(r.made.note, /^Made in Roon and paired/);
  assert.equal(r.shown.value, "", "a profile not paired shown as paired");
  assert.equal(r.shown.wide, true, "the select runs off a phone's screen");
  assert.deepEqual(r.linked.post, { url: "/api/profiles/2", body: { roonProfile: "deadbeef" } });
  assert.match(r.linked.note, /^Saved\. Hearts, Add to library and Roon's Listen later on this profile's devices/);
  assert.deepEqual(r.unlinked.post, { url: "/api/profiles/2", body: { roonProfile: null } });
  assert.equal(r.unlinked.note, "Saved. This profile has no Roon profile now: no favourites, adds or Listen later of its own.",
    "THE one for the owner's report: taking a pairing off said another's favourites would show");
  assert.deepEqual(r.gone, { value: "00ff00", text: "Not in Roon now" }, "a pairing the server no longer has shown as none at all");
  assert.deepEqual(r.reread.post, { url: "/api/profiles/roon-reread", body: {} });
  assert.equal(r.reread.note, "Reading your server's profiles again…");
  const off = harness.renderPage({ name: "profiles-roon-off", windowSize: "390x844", budgetMs: 15000,
    stub: stubFor(Object.assign({}, PROFILES, { roon: null })), driver: LINK_DRIVER });
  harness.assertNoPageError(assert, off);
  assert.deepEqual([off.shown.count, off.head.pairing, off.head.reread], [0, null, false], "a Roon profile to choose with native mode not in use");
  const one = harness.renderPage({ name: "profiles-roon-one", windowSize: "390x844", budgetMs: 15000,
    stub: stubFor(Object.assign({}, PROFILES, { roon: { profiles: [ROON.profiles[0]] }, pairing: false })), driver: LINK_DRIVER });
  harness.assertNoPageError(assert, one);
  assert.equal(one.shown.count, 3, "§13.2: a server of one Roon profile pairs too, so a second Rouen profile has none of its own");
  assert.equal(one.head.pairing, null);
});

