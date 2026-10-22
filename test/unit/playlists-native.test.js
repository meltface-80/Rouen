"use strict";
// ---------------------------------------------------------------------------
// N2d's routes (lib/playlists-native.js, v1.9.42, native-remote.md §11.3): a
// change is believed once the official API's playlist list shows it; an add
// not sent or not shown answers `fallback`, for the page to keep the tracks in
// Rouen's own playlist; the copy of Rouen's own, by itself (v1.9.63, §13). The native calls and
// the official list are stubs here (roon-direct-playlists.test.js runs the
// calls over the link).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createNativePlaylists, mountNativePlaylists, countOf } = require("../../lib/playlists-native");

/** A server whose official list follows what is done, or (o.hidden) never shows it. */
function rig(o = {}) {
  const official = [{ title: "Morning", subtitle: o.noNumbers ? "" : "3 Tracks" }];
  const calls = [];
  // Your server's own count of Morning's tracks, as its Playlist object says it.
  let own = 3;
  const show = (fn) => { if (!o.hidden) fn(); };
  const native = {
    async list() { return o.off ? { notSent: "" } : { playlists: [{ id: "aa", name: "Morning", tracks: own, readOnly: false }, { id: "bb", name: "Daily Mix", tracks: 25, readOnly: true }] }; },
    async create(name) {
      calls.push(["create", name]);
      if (o.notSent) return { notSent: o.notSent };
      show(() => official.push({ title: name, subtitle: "0 Tracks" }));
      return { id: "cc", name };
    },
    async addTracks(id, tracks) {
      calls.push(["tracks", id, tracks.map((t) => t.title)]);
      if (o.refused) return { error: "Your server refused the tracks (\"Refused\")." };
      const p = official.find((x) => x.title === (id === "aa" ? "Morning" : "From Rouen"));
      // o.allFound: a server that takes every track; otherwise the last one sent isn't found.
      const miss = o.allFound ? 0 : 1;
      if (o.noNumbers) own += tracks.length - miss;
      else if (!o.countHidden) show(() => { p.subtitle = `${countOf(p.subtitle) + tracks.length - miss} Tracks`; });
      // partly: the last album's tracks not taken (o.partly) — said, for the page to keep them.
      if (o.partly) return { sent: 1, missing: [], failed: [tracks[tracks.length - 1].title], why: "Your server refused the tracks (\"Refused\")." };
      return { sent: tracks.length - miss, missing: miss ? [tracks[tracks.length - 1].title] : [], failed: [], why: null };
    },
    async addAlbums(id, albums) { calls.push(["albums", id, albums.length]); show(() => { official[0].subtitle = "14 Tracks"; }); return { sent: albums.length, missing: [], failed: [], why: null }; },
    async rename(id, name) { calls.push(["rename", id, name]); show(() => { official[0].title = name; }); return { ok: true }; },
    async remove(id) { calls.push(["remove", id]); show(() => { official.splice(0, 1); }); return { ok: true, name: "Morning" }; },
  };
  const moved = [];
  const np = createNativePlaylists({ playlists: () => native, pollMs: 1, waitMs: 30,
    official: async () => { if (o.unreadable) throw new Error("browse timed out"); return official.map((x) => Object.assign({}, x)); },
    rouen: () => (o.rouen || []).map((p) => Object.assign({}, p, { tracks: p.tracks.slice() })),   // copies, as index.js gives them
    // The copy by itself (§13): native mode on, the connection now, the library read on it; one copied whole leaves.
    on: () => o.on !== false, connection: () => (o.link ? o.link.now : null), ready: () => !!(o.link && o.link.read),
    // As index.js's: the leaving saves Rouen's list, and every save says changed().
    moved: (id) => { moved.push(id); if (o.rouen) o.rouen = o.rouen.filter((p) => p.id !== id); np.changed(); } });
  return { np, calls, official, moved };
}
const T = (title) => ({ title, album_title: "Blue", album_subtitle: "Joni Mitchell" });

test("THE one: a new playlist, believed once the official list shows it, then its tracks, once its count has gone up by them", async () => {
  const { np, calls } = rig();
  const out = await np.add({ name: "From Rouen", tracks: [T("All I Want"), T("My Old Man"), T("Not On It")] });
  assert.deepEqual(out, { ok: true, via: "roon", id: "cc", name: "From Rouen", added: 2, missing: ["Not On It"], kept: [], why: null });
  assert.deepEqual(calls, [["create", "From Rouen"], ["tracks", "cc", ["All I Want", "My Old Man", "Not On It"]]]);
  // To one already there, by its id; albums, shown by the count going up at all.
  const r = rig();
  assert.equal((await r.np.add({ id: "aa", tracks: [T("A"), T("B")] })).added, 1);
  assert.equal((await r.np.add({ id: "aa", albums: [{ title: "Dummy", subtitle: "Portishead" }] })).ok, true);
});

test("an add not sent, refused, or not shown answers fallback with why — the page keeps the tracks in Rouen", async () => {
  assert.deepEqual(await rig({ notSent: "Your server didn't send its playlists to Rouen." }).np.add({ name: "X", tracks: [T("A")] }),
    { ok: false, fallback: true, why: "Your server didn't send its playlists to Rouen.", name: "X", made: false });
  assert.deepEqual(await rig({ off: true }).np.add({ id: "aa", tracks: [T("A")] }), { ok: false, fallback: true, why: "", name: "", made: false });
  const hidden = await rig({ hidden: true }).np.add({ name: "X", tracks: [T("A")] });
  assert.deepEqual([hidden.fallback, hidden.why, hidden.made], [true, "Roon didn't show the new playlist \"X\".", true]);
  // Partly taken: believed for what was, and the rest handed back for the page to keep in Rouen.
  const partly = await rig({ partly: true }).np.add({ id: "aa", tracks: [T("A"), T("B")] });
  assert.deepEqual([partly.ok, partly.added, partly.kept, partly.why], [true, 1, ["B"], "Your server refused the tracks (\"Refused\")."]);
  const refused = await rig({ refused: true }).np.add({ id: "aa", tracks: [T("A"), T("B")] });
  assert.deepEqual([refused.fallback, refused.name], [true, "Morning"]);
  assert.match(refused.why, /refused the tracks/);
  assert.match((await rig().np.add({ id: "zz", tracks: [T("A")] })).why, /doesn't list that playlist/);
  // A list whose subtitle gives no number: your server's own count of the playlist's tracks decides.
  assert.equal((await rig({ noNumbers: true }).np.add({ id: "aa", tracks: [T("A"), T("B"), T("C")] })).added, 2);
  // Sent and answered, but its count never went up by them: not believed.
  const uncounted = await rig({ countHidden: true }).np.add({ id: "aa", tracks: [T("A"), T("B")] });
  assert.deepEqual([uncounted.fallback, uncounted.why], [true, "Roon didn't show what was added to \"Morning\"."]);
});

test("rename and delete: believed once one more of the name is shown, or one fewer; not shown, said", async () => {
  assert.deepEqual(await rig().np.rename("aa", "Evening"), { ok: true });
  assert.deepEqual(await rig().np.remove("aa"), { ok: true });
  assert.deepEqual(await rig({ hidden: true }).np.rename("aa", "Evening"), { error: "Roon didn't show the new name \"Evening\".", status: 504 });
  assert.deepEqual(await rig({ hidden: true }).np.remove("aa"), { error: "Roon still shows \"Morning\".", status: 504 });
  assert.deepEqual(await rig({ off: true }).np.list(), { available: false, why: "" });
  // Only the playlists that can be changed are offered.
  assert.deepEqual((await rig().np.list()).playlists.map((p) => p.name), ["Morning"]);
});

const settled = async (np) => { for (let i = 0; i < 100 && np.copyProgress().running; i++) await new Promise((r) => { setTimeout(r, 5); }); };

test("the copy: each of Rouen's own made in Roon with its tracks; one Roon already has left alone; followed as it goes", async () => {
  const link = { now: {}, read: true };
  const { np, calls, moved } = rig({ link, rouen: [{ id: "up_1", name: "Morning", tracks: [T("A")] }, { id: "up_2", name: "From Rouen", tracks: [T("A"), T("B"), T("C")] }] });
  assert.deepEqual(np.maybeCopy(), { running: true, total: 2 });
  assert.deepEqual(np.maybeCopy(), { idle: "A copy is already running." }, "two copies at once");
  await settled(np);
  const done = np.copyProgress();
  assert.equal(done.running, false);
  assert.deepEqual(done.done, [
    { name: "Morning", result: "skipped", why: "Roon already has a playlist of that name." },
    { name: "From Rouen", result: "copied", added: 2, of: 3, missing: ["C"], moved: false }]);
  assert.deepEqual(moved, [], "one copied with a track not found left Rouen's list");
  // A list that can't be read is not taken to say Roon has no playlist of that name (the review).
  const blind = rig({ link, unreadable: true, rouen: [{ id: "up_1", name: "Morning", tracks: [T("A")] }] });
  blind.np.maybeCopy();
  await settled(blind.np);
  assert.deepEqual(blind.np.copyProgress().done, [{ name: "Morning", result: "failed", why: "Your server's playlist list couldn't be read; nothing was made for it." }]);
  assert.deepEqual(blind.calls, [], "made a playlist Roon may already have");
  assert.deepEqual(calls.map((c) => c[0]), ["create", "tracks"], "the playlist Roon already had was touched");
});

// v1.9.63 (the owner, native-remote.md §13): no button — Rouen's own are copied by themselves, once a connection with
// the library read on it, and again after a save; one copied whole leaves Rouen's list, so the next connection's copy
// can't make again a playlist renamed or deleted in Roon.
test("THE one for v1.9.63: copied by itself once a connection, again after a save; one copied whole leaves Rouen's list", async () => {
  const link = { now: null, read: false };
  // A track not found keeps Rouen's own (below), so the copy can be seen to run again.
  const w = rig({ link, rouen: [{ id: "up_1", name: "From Rouen", tracks: [T("A"), T("Not On It")] }] });
  assert.deepEqual(w.np.maybeCopy(), { idle: "Your server's library isn't read on this connection yet." });
  link.now = {};
  assert.deepEqual(w.np.maybeCopy(), { idle: "Your server's library isn't read on this connection yet." });
  link.read = true;
  assert.deepEqual(w.np.maybeCopy(), { running: true, total: 1 });
  await settled(w.np);
  assert.deepEqual(w.np.copyProgress().done.map((d) => [d.name, d.result]), [["From Rouen", "copied"]]);
  assert.deepEqual(w.moved, [], "one with a track not found left Rouen's list");
  assert.deepEqual(w.np.maybeCopy(), { idle: "Nothing new to copy." }, "copied twice on one connection");
  w.np.changed();
  assert.deepEqual(w.np.maybeCopy(), { running: true, total: 1 }, "a save on this connection wasn't copied");
  await settled(w.np);
  link.now = {};
  w.np.maybeCopy();
  await settled(w.np);
  assert.equal(w.calls.filter((c) => c[0] === "create").length, 1, "a new connection made the playlist again");
  assert.deepEqual(rig({ on: false, link }).np.maybeCopy(), { idle: "Native mode is off." });
});

test("THE one for v1.9.63: every track found, Rouen's own copy leaves its list", async () => {
  const link = { now: {}, read: true };
  const w = rig({ link, allFound: true, rouen: [{ id: "up_1", name: "From Rouen", tracks: [T("A"), T("B")] }] });
  w.np.maybeCopy();
  await settled(w.np);
  assert.deepEqual(w.np.copyProgress().done.map((d) => [d.name, d.result, d.moved]), [["From Rouen", "copied", true]]);
  assert.deepEqual(w.moved, ["up_1"], "a playlist copied whole stayed Rouen's too");
  assert.deepEqual(w.np.maybeCopy(), { idle: "Nothing new to copy." }, "its leaving was taken for a change to copy");
  // A track added to Rouen's own while the copy ran: Rouen's stays, and the change is copied at the next chance.
  const rouen = [{ id: "up_1", name: "From Rouen", tracks: [T("A"), T("B")] }];
  const busy = rig({ link, allFound: true, rouen });
  busy.np.maybeCopy();
  rouen[0].tracks.push(T("C"));   // in place, as index.js's appendUserTracks adds (the review)
  await settled(busy.np);
  assert.deepEqual([busy.moved, busy.np.copyProgress().done[0].moved], [[], false], "a track added during the copy was lost with Rouen's own");
});

// The review of v1.9.63: what changes in Rouen while a copy runs, a failure on a connection, a partly copied playlist.
test("the review: deleted meanwhile is not made; renamed meanwhile stays; a failure is tried again; partly copied still says so", async () => {
  const link = { now: {}, read: true };
  // (The fake knows a new playlist by the name "From Rouen".)
  const rouen = [{ id: "up_1", name: "From Rouen", tracks: [T("A")] }, { id: "up_2", name: "Second", tracks: [T("A")] }];
  const w = rig({ link, allFound: true, rouen });
  w.np.maybeCopy();
  rouen.splice(1, 1);   // while the first is made: the second deleted in Rouen
  await settled(w.np);
  assert.deepEqual(w.np.copyProgress().done.map((d) => [d.name, d.result]), [["From Rouen", "copied"], ["Second", "gone"]]);
  assert.equal(w.calls.filter((c) => c[0] === "create").length, 1, "a playlist deleted in Rouen was made in Roon");

  const r = { list: [{ id: "up_1", name: "From Rouen", tracks: [T("A")] }] };
  const ren = rig({ link, allFound: true, rouen: r.list });
  ren.np.maybeCopy();
  r.list[0].name = "Renamed";
  await settled(ren.np);
  assert.deepEqual(ren.moved, [], "renamed while copied under its old name, and taken off Rouen's list");

  const blind = rig({ link, unreadable: true, rouen: [{ id: "up_1", name: "Morning", tracks: [T("A")] }] });
  blind.np.maybeCopy();
  await settled(blind.np);
  assert.deepEqual(blind.np.maybeCopy(), { running: true, total: 1 }, "a failure waits for the next connection");

  const part = rig({ link, rouen: [{ id: "up_1", name: "From Rouen", tracks: [T("A"), T("Not On It")] }] });
  part.np.maybeCopy();
  await settled(part.np);
  part.np.changed();
  part.np.maybeCopy();
  await settled(part.np);
  assert.deepEqual(part.np.copyProgress().done.map((d) => [d.result, d.missing]), [["copied", ["Not On It"]]],
    "partly copied, then said as one Roon had already");
});

// The second review of v1.9.63: an empty one is not copied; one made in Roon is never made again, renamed or failed.
test("the second review: empty not copied; made in Roon once, never again (renamed after a partial copy, or made then not shown)", async () => {
  const link = { now: {}, read: true };
  const empty = rig({ link, allFound: true, rouen: [{ id: "up_1", name: "From Rouen", tracks: [] }] });
  empty.np.maybeCopy();
  await settled(empty.np);
  assert.deepEqual([empty.calls, empty.moved, empty.np.copyProgress().done[0].result], [[], [], "empty"], "an empty playlist made in Roon");

  const rouen = [{ id: "up_1", name: "From Rouen", tracks: [T("A"), T("Not On It")] }];
  const part = rig({ link, rouen });
  part.np.maybeCopy();
  await settled(part.np);
  rouen[0].name = "Road trip";   // renamed in Rouen after a partial copy: Roon has no "Road trip"
  part.np.changed();
  part.np.maybeCopy();
  await settled(part.np);
  assert.equal(part.calls.filter((c) => c[0] === "create").length, 1, "renamed after a partial copy, made in Roon a second time");

  const hidden = rig({ link, hidden: true, rouen: [{ id: "up_1", name: "X", tracks: [T("A")] }] });
  hidden.np.maybeCopy();
  await settled(hidden.np);
  assert.deepEqual(hidden.np.copyProgress().done.map((d) => [d.result, d.made]), [["failed", true]]);
  assert.deepEqual(hidden.np.maybeCopy(), { idle: "Nothing new to copy." }, "made in Roon, then tried again as if it wasn't");
  hidden.np.changed();
  hidden.np.maybeCopy();
  await settled(hidden.np);
  assert.equal(hidden.calls.filter((c) => c[0] === "create").length, 1, "made in Roon a second time");
  assert.match(hidden.np.copyProgress().done[0].why, /check it there before copying again/, "the failure no longer said");
});

test("the routes: a malformed request is 400; what is answered is passed on", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountNativePlaylists(app, rig().np, { timers: false });
  const call = async (k, req) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](req, res);
    return res;
  };
  assert.equal((await call("POST /api/roon-playlists/add", { body: { name: "X" } })).code, 400, "nothing to add");
  assert.equal((await call("POST /api/roon-playlists/add", { body: { name: "X", tracks: [T("A")], albums: [{ title: "Y" }] } })).code, 400, "both");
  assert.equal((await call("POST /api/roon-playlists/add", { body: { id: "<nope>", tracks: [T("A")] } })).code, 400);
  assert.equal((await call("POST /api/roon-playlists/rename", { body: { id: "aa" } })).code, 400);
  assert.equal((await call("POST /api/roon-playlists/delete", { body: {} })).code, 400);
  const ok = await call("POST /api/roon-playlists/add", { body: { name: "From Rouen", tracks: [T("A"), T("B")] } });
  assert.deepEqual([ok.code, ok.body.ok, ok.body.added], [200, true, 1]);
  assert.deepEqual((await call("GET /api/roon-playlists", {})).body, { available: true, playlists: [{ id: "aa", name: "Morning", tracks: 3 }] });
});
