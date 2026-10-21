"use strict";
// ---------------------------------------------------------------------------
// N2d's routes (lib/playlists-native.js, v1.9.42, native-remote.md §11.3): a
// change is believed once the official API's playlist list shows it; an add
// not sent or not shown answers `fallback`, for the page to keep the tracks in
// Rouen's own playlist; the one-time copy of Rouen's own. The native calls and
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
      if (o.noNumbers) own += tracks.length - 1;
      else if (!o.countHidden) show(() => { p.subtitle = `${countOf(p.subtitle) + tracks.length - 1} Tracks`; });
      // partly: the last album's tracks not taken (o.partly) — said, for the page to keep them.
      if (o.partly) return { sent: 1, missing: [], failed: [tracks[tracks.length - 1].title], why: "Your server refused the tracks (\"Refused\")." };
      return { sent: tracks.length - 1, missing: [tracks[tracks.length - 1].title], failed: [], why: null };
    },
    async addAlbums(id, albums) { calls.push(["albums", id, albums.length]); show(() => { official[0].subtitle = "14 Tracks"; }); return { sent: albums.length, missing: [], failed: [], why: null }; },
    async rename(id, name) { calls.push(["rename", id, name]); show(() => { official[0].title = name; }); return { ok: true }; },
    async remove(id) { calls.push(["remove", id]); show(() => { official.splice(0, 1); }); return { ok: true, name: "Morning" }; },
  };
  const np = createNativePlaylists({ playlists: () => native, pollMs: 1, waitMs: 30,
    official: async () => { if (o.unreadable) throw new Error("browse timed out"); return official.map((x) => Object.assign({}, x)); },
    rouen: () => o.rouen || [] });
  return { np, calls, official };
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

test("the copy: each of Rouen's own made in Roon with its tracks; one Roon already has left alone; followed as it goes", async () => {
  const { np, calls } = rig({ rouen: [{ name: "Morning", tracks: [T("A")] }, { name: "From Rouen", tracks: [T("A"), T("B"), T("C")] }] });
  assert.deepEqual(np.startCopy(), { running: true, total: 2 });
  assert.equal(np.startCopy().status, 409, "two copies at once");
  for (let i = 0; i < 100 && np.copyProgress().running; i++) await new Promise((r) => { setTimeout(r, 5); });
  const done = np.copyProgress();
  assert.equal(done.running, false);
  assert.deepEqual(done.done, [
    { name: "Morning", result: "skipped", why: "Roon already has a playlist of that name." },
    { name: "From Rouen", result: "copied", added: 2, of: 3, missing: ["C"] }]);
  // A list that can't be read is not taken to say Roon has no playlist of that name (the review).
  const blind = rig({ unreadable: true, rouen: [{ name: "Morning", tracks: [T("A")] }] });
  blind.np.startCopy();
  for (let i = 0; i < 100 && blind.np.copyProgress().running; i++) await new Promise((r) => { setTimeout(r, 5); });
  assert.deepEqual(blind.np.copyProgress().done, [{ name: "Morning", result: "failed", why: "Your server's playlist list couldn't be read; nothing was made for it." }]);
  assert.deepEqual(blind.calls, [], "made a playlist Roon may already have");
  assert.deepEqual(calls.map((c) => c[0]), ["create", "tracks"], "the playlist Roon already had was touched");
});

test("the routes: a malformed request is 400; what is answered is passed on", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountNativePlaylists(app, rig().np);
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
