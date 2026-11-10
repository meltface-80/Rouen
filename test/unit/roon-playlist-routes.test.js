"use strict";
// ---------------------------------------------------------------------------
// One Roon playlist through the official API (lib/routes/roon-playlist.js, moved out of index.js in v2.0.3-t4,
// unchanged): its tracks as the page gets them, the read ceiling said honestly, and the play routes' checks. The
// browse walk is a stand-in.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountRoonPlaylist } = require("../../lib/routes/roon-playlist");
const { createOrderedPlay } = require("../../lib/ordered-play");

function mount(over) {
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  const calls = [];
  mountRoonPlaylist(app, Object.assign({
    core: () => ({}),
    withBrowseSession: (fn) => fn("sk"),
    loadPlaylistSession: async (sk, offset, title, zone) => {
      calls.push({ offset, title, zone });
      return { item: { title: "Late Night", subtitle: "3 tracks", image_key: "pk" }, playMenu: { title: "Play Playlist" }, total: 4,
        items: [{ title: "Play Playlist", hint: "action_list" }, { title: "1. Rosanna", subtitle: "David Paich", image_key: "t1" },
          { title: "Africa", subtitle: "David Paich, Jeff Porcaro" }, { title: "Hold the Line", subtitle: "" }] };
    },
    isTrackItem: (t) => t.hint !== "action_list",
    stripTrackNumber: (s) => s.replace(/^\d+\.\s*/, ""),
    trackNumberOf: (s) => { const m = /^(\d+)\.\s/.exec(s); return m ? Number(m[1]) : null; },
    PLAYLIST_ITEMS: 1000,
    invokePlaylistAction: async () => ({ invoked: "Play Now" }),
    invokePlaylistTrackAction: async (...a) => ({ invoked: "Play Now", args: a }),
    orderedPlay: createOrderedPlay({ log: () => {} }),
  }, over));
  const call = async (key, req) => {
    let status = 200, body = null;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; }, set() { return this; } };
    await routes[key](Object.assign({ query: {}, body: {} }, req), res);
    return { status, body };
  };
  return { call, calls };
}

test("GET /api/playlist: the tracks as the page gets them, the zone passed to the walk", async () => {
  const { call, calls } = mount();
  const r = await call("GET /api/playlist", { query: { offset: "3", title: "Late Night", zone: "z1" } });
  assert.deepEqual(calls, [{ offset: 3, title: "Late Night", zone: "z1" }]);
  assert.deepEqual(r.body.tracks, [
    { index: 0, title: "Rosanna", subtitle: "David Paich", image_key: "t1", track_no: 1 },
    { index: 1, title: "Africa", subtitle: "David Paich, Jeff Porcaro", image_key: null, track_no: null },
    { index: 2, title: "Hold the Line", subtitle: "", image_key: null, track_no: null },
  ]);
  assert.equal(r.body.truncated, false, "three tracks of a four-row level (its Play row) is not cut short");
  assert.equal(r.body.can_play, true);
  assert.equal(r.body.title, "Late Night");
});

test("GET /api/playlist: 503 unpaired, 400 without an offset, 409 for a stale one", async () => {
  assert.equal((await mount({ core: () => null }).call("GET /api/playlist", { query: { offset: "0" } })).status, 503);
  assert.equal((await mount().call("GET /api/playlist", { query: {} })).status, 400);
  const stale = mount({ loadPlaylistSession: async () => { const e = new Error("moved"); e.stale = true; throw e; } });
  const r = await stale.call("GET /api/playlist", { query: { offset: "0", title: "X" } });
  assert.deepEqual([r.status, r.body.stale], [409, true]);
});

test("POST /api/playlist/play-track: each field checked before Roon is asked; the track sent by index and title", async () => {
  const { call } = mount();
  assert.equal((await call("POST /api/playlist/play-track", { body: { offset: 0, zone_or_output_id: "z", kind: "play_now" } })).status, 400);
  assert.equal((await call("POST /api/playlist/play", { body: { offset: 0, kind: "queue" } })).status, 400);
  const r = await call("POST /api/playlist/play-track", { body: { offset: 2, title: "Late Night", track_index: 1, track_title: "Africa", zone_or_output_id: "z", kind: "play_now" } });
  assert.deepEqual(r.body.args, [2, "Late Night", 1, "Africa", "z", "play_now"]);
});

// --- v2.0.3-t11: the tracks in the order the page shows them (dev/design/playlist-artists.md §7) ---------------------

const ORDERED = { offset: 2, title: "Late Night", zone_or_output_id: "z", kind: "play_now",
  tracks: [{ index: 2, title: "Hold the Line" }, { index: 0, title: "Rosanna" }, { index: 1, title: "Africa" }] };
const settle = () => new Promise((r) => { setTimeout(r, 10); });

test("POST /api/playlist/play-ordered: answers at once, then sends each track by index and title, the first to play", async () => {
  const sent = [];
  const { call } = mount({ invokePlaylistTrackAction: async (...a) => { sent.push(a); } });
  const r = await call("POST /api/playlist/play-ordered", { body: ORDERED });
  assert.deepEqual([r.status, r.body.ok, r.body.job.total, r.body.job.sent, r.body.job.done, r.body.job.title, r.body.job.offset],
    [200, true, 3, 0, false, "Late Night", 2]);
  await settle();
  assert.deepEqual(sent, [[2, "Late Night", 2, "Hold the Line", "z", "play_now"], [2, "Late Night", 0, "Rosanna", "z", "queue"],
    [2, "Late Night", 1, "Africa", "z", "queue"]]);
  const long = await call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { zone_or_output_id: "y", title: "n".repeat(2000) }) });
  assert.equal(long.body.job.title.length, 500, "a run keeps a name no longer than a name is");
  const s = await call("GET /api/playlist/play-ordered/status", { query: { zone: "z" } });
  assert.deepEqual([s.body.job.id, s.body.job.done, s.body.job.queued, s.body.job.stopped], [r.body.job.id, true, 3, null]);
  assert.equal((await call("GET /api/playlist/play-ordered/status", { query: { zone: "elsewhere" } })).body.job, null);
  assert.equal((await call("GET /api/playlist/play-ordered/status", {})).body.job, null);
});

test("POST /api/playlist/play-ordered: each field checked, and nothing sent for a body that fails", async () => {
  const sent = [];
  const { call } = mount({ invokePlaylistTrackAction: async (...a) => { sent.push(a); } });
  const bad = async (over) => (await call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, over) })).status;
  assert.equal((await mount({ core: () => null }).call("POST /api/playlist/play-ordered", { body: ORDERED })).status, 503);
  assert.equal(await bad({ offset: "x" }), 400);
  assert.equal(await bad({ title: "" }), 400, "the name is what says the offset still points at this playlist");
  assert.equal(await bad({ zone_or_output_id: "" }), 400);
  assert.equal(await bad({ kind: "radio" }), 400, "only the two kinds a run of tracks can take");
  assert.equal(await bad({ kind: undefined }), 400);
  assert.equal(await bad({ tracks: [] }), 400);
  assert.equal(await bad({ tracks: "all" }), 400);
  assert.equal(await bad({ tracks: [{ index: 0, title: "a" }, { title: "no index" }] }), 400);
  assert.equal(await bad({ tracks: [{ index: -1, title: "a" }] }), 400);
  assert.equal(await bad({ tracks: Array.from({ length: 1001 }, (_, i) => ({ index: i, title: "t" })) }), 400, "no more than a playlist's read");
  await settle();
  assert.deepEqual(sent, []);
  assert.equal((await call("POST /api/playlist/play-ordered/stop", { body: {} })).status, 400);
  assert.deepEqual((await call("POST /api/playlist/play-ordered/stop", { body: { zone_or_output_id: "z" } })).body, { job: null });
});

test("a run is ended by Stop, and by Play now on the zone; a Queue leaves it going", async () => {
  /** @type {Array<() => void>} */
  let held = [];
  const sent = [];
  const slow = (...a) => new Promise((resolve) => { sent.push(a[2]); held.push(() => resolve({ invoked: "x" })); });
  const letOne = async () => { await settle(); held.shift()(); await settle(); };
  const tracks = Array.from({ length: 6 }, (_, i) => ({ index: i, title: "t" + i }));

  const { call } = mount({ invokePlaylistTrackAction: slow });
  await call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { tracks }) });
  await letOne();                                    // track 0 lands, track 1 is with Roon
  const stopping = call("POST /api/playlist/play-ordered/stop", { body: { zone_or_output_id: "z" } });
  await letOne();
  const stopped = (await stopping).body.job;
  assert.deepEqual([stopped.done, stopped.stopped, stopped.sent], [true, "user", 2]);
  assert.deepEqual(sent, [0, 1]);

  // Stop with a run's id: another run the zone has been given since is left going.
  held = []; sent.length = 0;
  const three = mount({ invokePlaylistTrackAction: slow });
  const old = (await three.call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { tracks }) })).body.job;
  await letOne();
  const newer = (await three.call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { tracks }) })).body.job;
  const notMine = (await three.call("POST /api/playlist/play-ordered/stop", { body: { zone_or_output_id: "z", id: old.id } })).body.job;
  assert.deepEqual([notMine.id, notMine.done], [newer.id, false]);
  const mine = three.call("POST /api/playlist/play-ordered/stop", { body: { zone_or_output_id: "z", id: newer.id } });
  await letOne();
  assert.deepEqual([(await mine).body.job.id, (await mine).body.job.stopped], [newer.id, "user"]);

  held = []; sent.length = 0;
  const two = mount({ invokePlaylistTrackAction: slow, invokePlaylistAction: async () => { sent.push("whole"); return { invoked: "Queue" }; } });
  await two.call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { tracks }) });
  await letOne();
  await two.call("POST /api/playlist/play", { body: { offset: 2, title: "Late Night", zone_or_output_id: "z", kind: "queue" } });
  assert.equal((await two.call("GET /api/playlist/play-ordered/status", { query: { zone: "z" } })).body.job.done, false, "a Queue does not end it");
  await two.call("POST /api/playlist/play", { body: { offset: 2, title: "Late Night", zone_or_output_id: "other zone", kind: "play_now" } });
  assert.equal((await two.call("GET /api/playlist/play-ordered/status", { query: { zone: "z" } })).body.job.done, false, "nor does another zone's Play now");
  const playing = two.call("POST /api/playlist/play-track", { body: { offset: 2, title: "Late Night", track_index: 5, track_title: "t5", zone_or_output_id: "z", kind: "play_now" } });
  await settle();
  assert.deepEqual(sent, [0, 1, "whole", "whole"], "the tap waits for the run's track in flight");
  held.shift()();                                    // the run's track 1 lands; the tap's own send follows
  await settle();
  assert.deepEqual(sent, [0, 1, "whole", "whole", 5]);
  held.shift()();
  await playing;
  const after = (await two.call("GET /api/playlist/play-ordered/status", { query: { zone: "z" } })).body.job;
  assert.deepEqual([after.done, after.stopped, after.sent], [true, "other", 2]);
});

test("Play now on the whole playlist ends the zone's run too, and a run started while it is out waits for it", async () => {
  /** @type {Array<() => void>} */
  const held = [];
  const order = [];
  const slow = (name) => (...a) => new Promise((resolve) => { order.push(name + (name === "t" ? a[2] : "")); held.push(() => resolve({ invoked: "x" })); });
  const letOne = async () => { await settle(); held.shift()(); await settle(); };
  const tracks = Array.from({ length: 4 }, (_, i) => ({ index: i, title: "t" + i }));
  const { call } = mount({ invokePlaylistTrackAction: slow("t"), invokePlaylistAction: slow("whole") });

  await call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { tracks }) });
  await settle();                                    // track 0 is with Roon
  const playing = call("POST /api/playlist/play", { body: { offset: 2, title: "Late Night", zone_or_output_id: "z", kind: "play_now" } });
  await settle();
  assert.deepEqual(order, ["t0"], "the whole-playlist Play now waits for the run's track in flight");
  const next = (await call("POST /api/playlist/play-ordered", { body: Object.assign({}, ORDERED, { tracks: tracks.slice(2) }) })).body.job;
  await letOne();                                    // t0 lands: the run is over, the Play now goes
  assert.deepEqual(order, ["t0", "whole"], "and the run pressed meanwhile waits for that Play now");
  await letOne();
  assert.equal((await playing).status, 200);
  await letOne(); await letOne();
  assert.deepEqual(order, ["t0", "whole", "t2", "t3"]);
  const end = (await call("GET /api/playlist/play-ordered/status", { query: { zone: "z" } })).body.job;
  assert.deepEqual([end.id, end.done, end.queued], [next.id, true, 2]);

  // A Play now that fails says so as before (409 for a playlist that changed), and the zone is not left held.
  const stale = mount({ invokePlaylistAction: async () => { const e = new Error("moved"); e.stale = true; throw e; } });
  const r = await stale.call("POST /api/playlist/play", { body: { offset: 2, title: "Late Night", zone_or_output_id: "z", kind: "play_now" } });
  assert.deepEqual([r.status, r.body.stale], [409, true]);
});

test("2.0.4-t1, THE bug: a playlist read short of Roon's count says so, though its Play row made it 999 tracks", async () => {
  // gert_mogensen's 1,515 tracks under the old ceiling: 1,000 rows read, the Play row among them, of 1,516 Roon counts.
  // "tracks.length >= 1000" was false at 999, so the page never said "Showing the first 999 of …".
  const rows = [{ title: "Play Playlist", hint: "action_list" }].concat(Array.from({ length: 999 }, (_, i) => ({ title: `T${i}` })));
  const { call } = mount({ loadPlaylistSession: async () => ({ item: { title: "Big" }, playMenu: rows[0], total: 1516, items: rows }) });
  const r = await call("GET /api/playlist", { query: { offset: "0", title: "Big" } });
  assert.equal(r.body.tracks.length, 999);
  assert.equal(r.body.truncated, true);
  assert.equal(r.body.total, 1516);
  // Read whole: not cut short, whatever its length.
  const whole = rows.concat(Array.from({ length: 516 }, (_, i) => ({ title: `U${i}` })));
  const w = await mount({ loadPlaylistSession: async () => ({ item: { title: "Big" }, playMenu: rows[0], total: 1516, items: whole }) })
    .call("GET /api/playlist", { query: { offset: "0", title: "Big" } });
  assert.equal(w.body.tracks.length, 1515);
  assert.equal(w.body.truncated, false);
});
