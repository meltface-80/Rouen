"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t1 (lib/provider/public/playlist-open.js, moved out of index.js in this build): one Roon playlist through the
// official API's browse, its rows read a page at a time. gert_mogensen (the Roon forum, 2026-11-10): a playlist of
// 1,515 tracks showed 999 — one load of 1,000 rows, its Play row the thousandth — and the 26 tracks added last, at its
// end, never showed. The browse here is a stand-in that pages as Roon's does (offset, count, list.count); it is not
// evidence of the server's paging, which the owner's playlist is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistOpen, PLAYLIST_ITEMS, PAGE, LEAD } = require("../../lib/provider/public/playlist-open");

const PLAY_ROW = { title: "Play Playlist", hint: "action_list", item_key: "play" };
const trackRow = (i) => ({ title: `Track ${i + 1}`, subtitle: "Artist", hint: "action_list", item_key: `t${i}` });

/**
 * A browse with one playlist, "Big", of `n` tracks after its Play row. Each load is recorded with the rows it asked for.
 * @param {number} n @param {object} [o]
 */
function rig(n, o = {}) {
  const rows = [PLAY_ROW].concat(Array.from({ length: n }, (_, i) => trackRow(i)));
  if (o.edit) o.edit(rows);
  let level = "root";
  const loads = [], invoked = [];
  const deps = {
    browse: async (b) => {
      if (b.pop_all) level = "root";
      else if (b.item_key === "pl") level = "inside";
      else if (b.item_key === "act") invoked.push(b.item_key);
      return { action: "list" };
    },
    load: async (l) => {
      if (level === "root") return { items: [{ title: "Big", item_key: "pl" }], list: { count: 1 } };
      loads.push({ offset: l.offset, count: l.count });
      return { items: rows.slice(l.offset, l.offset + l.count), list: { count: rows.length } };
    },
    withBrowseSession: (fn) => fn("sk"),
    findItemByTitle: async () => null,
    playlistKeyOf: (t) => String(t || "").trim().toLowerCase(),
    PLAYLIST_MAX: 5000, PLAYLIST_CTX: "playlists:root",
    isTrackItem: (t, playMenu) => t !== playMenu,
    stripTrackNumber: (s) => s,
    normalize: (s) => String(s || "").toLowerCase(),
    roonBrowseError: () => new Error("not a list"),
    noActionError: () => new Error("no action"),
    drillActionMenu: async (h, sk, key) => { invoked.push("menu:" + key); return [{ title: "Play Now", item_key: "act" }]; },
    matchAction: (actions) => actions[0],
  };
  const open = createPlaylistOpen(Object.assign(deps, o.deps || {}));
  return { open, loads, invoked };
}

test("THE bug: a 1,515-track playlist is read whole, the tracks added last among them, a page at a time", async () => {
  const { open, loads } = rig(1515);
  const got = await open.loadPlaylistSession("sk", 0, "Big", "z1");
  const tracks = got.items.filter((t) => t !== got.playMenu);
  assert.equal(tracks.length, 1515, "every track, not the 999 one load of 1,000 rows left");
  assert.equal(tracks[1514].title, "Track 1515", "the last track added is there");
  assert.equal(got.total, 1516, "Roon's count of the level's rows, its Play row among them");
  assert.deepEqual(loads, [{ offset: 0, count: PAGE }, { offset: PAGE, count: PAGE }], "two pages of 1,000, the second short");
  assert.equal(PLAYLIST_ITEMS, 10000);
});

test("a playlist under a page is one load; one at the ceiling stops there and says how many Roon counts", async () => {
  const small = rig(12);
  const s = await small.open.loadPlaylistSession("sk", 0, "Big", null);
  assert.equal(s.items.length, 13);
  assert.equal(small.loads.length, 1);

  const capped = rig(250, { deps: { maxItems: 100, pageSize: 40 } });
  const c = await capped.open.loadPlaylistSession("sk", 0, "Big", null);
  assert.equal(c.items.length, 100, "the ceiling, not a row more");
  assert.equal(c.total, 251, "so the page can say it was cut short");
  assert.deepEqual(capped.loads.map((l) => l.count), [40, 40, 20], "the last page asks only for what the ceiling leaves");
});

test("a page that comes back empty ends the read (the playlist shrank under it): what was read is kept", async () => {
  let calls = 0;
  const { open } = rig(30, { deps: { pageSize: 10, load: async (l) => {
    calls++;
    if (l.offset === 0 && l.count === 1 && calls === 1) return { items: [{ title: "Big", item_key: "pl" }], list: { count: 1 } };
    const rows = [PLAY_ROW].concat(Array.from({ length: 30 }, (_, i) => trackRow(i)));
    return { items: l.offset >= 20 ? [] : rows.slice(l.offset, l.offset + l.count), list: { count: 31 } };
  } } });
  const got = await open.loadPlaylistSession("sk", 0, "Big", null);
  assert.equal(got.items.length, 20);
  assert.equal(got.total, 31);
});

test("a tapped track reads only as far as its row: track 1,200 of 1,515 is played after 1,209 rows, not all of them", async () => {
  const { open, loads, invoked } = rig(1515);
  const r = await open.invokePlaylistTrackAction(0, "Big", 1199, "Track 1200", "z1", "play_now");
  assert.deepEqual(r, { invoked: "Play Now", track: "Track 1200" });
  assert.deepEqual(invoked, ["menu:t1199", "act"]);
  const rows = loads.reduce((n, l) => n + l.count, 0);
  assert.equal(rows, 1199 + 1 + LEAD, "its index, its Play row and a few to spare");
});

test("a track moved since the page was read is found by its title in the rest of the playlist", async () => {
  // "Track 5" now sits at the end: at its index is another track, and in the first rows there is none of its title.
  const { open, loads, invoked } = rig(1515, { edit: (rows) => { const [moved] = rows.splice(5, 1); rows.push(moved); } });
  const r = await open.invokePlaylistTrackAction(0, "Big", 4, "Track 5", "z1", "queue");
  assert.equal(r.track, "Track 5");
  assert.deepEqual(invoked, ["menu:t4", "act"], "the row of that title, found past the first read");
  assert.ok(loads.reduce((n, l) => n + l.count, 0) > 1515, "the first rows, then the whole playlist");
});

test("a track gone from the playlist is still said stale, after the whole of it is read", async () => {
  const { open } = rig(40, { edit: (rows) => { rows.splice(10, 1); } });
  await assert.rejects(open.invokePlaylistTrackAction(0, "Big", 9, "Track 10", "z1", "play_now"),
    (e) => e.stale === true && /changed/.test(e.message));
});

test("the whole playlist played reads only its first rows, where its Play row is", async () => {
  const { open, loads, invoked } = rig(1515);
  const r = await open.invokePlaylistAction(0, "Big", "z1", "play_now");
  assert.deepEqual(r, { invoked: "Play Now", playlist: "Big" });
  assert.deepEqual(invoked, ["menu:play", "act"]);
  assert.deepEqual(loads, [{ offset: 0, count: LEAD }]);
});

test("the review: a title met early in a partial read never stands for the row tapped further down", async () => {
  // Two rows called "Intro": the second, at track 1,300, is tapped; a header row before the tracks pushes it past the
  // rows a partial read takes. The early "Intro" must not be played: the whole playlist is read and its own row found.
  const { open, invoked } = rig(1515, { edit: (rows) => {
    rows[1].title = "Intro"; rows[1300].title = "Intro";
    rows.splice(1, 0, ...Array.from({ length: LEAD + 2 }, (_, i) => ({ title: `Header ${i}`, hint: "header" })));
  }, deps: { isTrackItem: (t, playMenu) => t !== playMenu && t.hint !== "header" } });
  const r = await open.invokePlaylistTrackAction(0, "Big", 1299, "Intro", "z1", "play_now");
  assert.equal(r.track, "Intro");
  assert.deepEqual(invoked, ["menu:t1299", "act"], "the row at its own place, not t0");
});
