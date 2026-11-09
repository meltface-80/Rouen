"use strict";
// ---------------------------------------------------------------------------
// One Roon playlist through the official API (lib/routes/roon-playlist.js, moved out of index.js in v2.0.3-t4,
// unchanged): its tracks as the page gets them, the read ceiling said honestly, and the play routes' checks. The
// browse walk is a stand-in.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountRoonPlaylist } = require("../../lib/routes/roon-playlist");

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
  }, over));
  const call = async (key, req) => {
    let status = 200, body = null;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
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
