"use strict";
// ---------------------------------------------------------------------------
// N2c-1 (lib/provider/public/streaming.js, v1.9.39, native-remote.md §10.3):
// TIDAL and Qobuz as Roon shows them, through the official browse API, against
// a fake browse tree (test/lib/fake-roon-browse.js) that records anything it
// is made to carry out. The action menus are album-open.js's own. The fake is
// not evidence of a real Core's tree (§10.2 is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStreaming, mountStreaming, parseWhere } = require("../../lib/provider/public/streaming");
const { createAlbumOpen } = require("../../lib/provider/public/album-open");
const { fakeBrowse, streamingTree } = require("../lib/fake-roon-browse");

function rig(o = {}) {
  const tree = streamingTree();
  // As the owner's server sends them: covers, and a catalogue album's credit with its artist as a link.
  const albums = tree.items[1].items[2].items[0].items;
  albums.forEach((a, i) => { a.image_key = "img" + i; });
  albums[0].subtitle = "[[3289978|Aphex Twin]]";
  const f = fakeBrowse(tree, { search: (input) => ({ title: "Search", items: [
    { title: "Albums", hint: "list", items: input === "homogenic" ? [tree.items[2].items[0].items[0]] : [] }] }) });
  const { drillActionMenu, matchAction } = createAlbumOpen({ browse: f.browse, load: f.load, roonBrowseError: (_d, what) => new Error(what + " didn't open") });
  const zonesAsked = [], loadsAsked = [];
  const s = createStreaming({ browse: (x) => { if (x.zone_or_output_id) zonesAsked.push(x.zone_or_output_id); return f.browse(x); },
    load: (x) => { loadsAsked.push([x.offset, x.count]); return f.load(x); }, withBrowseSession: f.withBrowseSession, drillActionMenu, matchAction,
    libraryOffset: o.libraryOffset || (() => null), defaultZone: () => "z-default", hasCore: () => o.paired !== false });
  return { f, s, zonesAsked, loadsAsked, tree };
}
const SAW = [["What's New", 2], ["New Albums", 0], ["Selected Ambient Works 85-92", 0]];

test("THE one for N2c-1: a service's levels, an album's page and its play — only what was asked is carried out, in the zone", async () => {
  const { f, s, zonesAsked } = rig({ libraryOffset: (t) => (t === "Kid A" ? 41 : null) });
  const top = await s.level({ service: "tidal", path: "[]" });
  assert.deepEqual(top.items.map((i) => [i.title, i.hint, i.pos]),
    [["Search TIDAL", "input", 0], ["Play My Mix", "action", 1], ["What's New", "list", 2], ["Artists", "list", 3], ["My Albums", "list", 4]]);
  const albums = await s.level({ service: "tidal", path: JSON.stringify(SAW.slice(0, 2)) });
  assert.deepEqual(albums.items.map((i) => [i.title, i.subtitle, i.image_key]),
    [["Selected Ambient Works 85-92", "Aphex Twin", "img0"], ["Kid A", "Radiohead", "img1"], ["Third", "Portishead", "img2"]]);
  const page = await s.level({ service: "tidal", path: JSON.stringify(SAW) });
  assert.equal(page.page.kind, "album");
  assert.deepEqual(page.page.self, { title: "Selected Ambient Works 85-92", subtitle: "Aphex Twin", hint: "list", image_key: "img0", pos: 0 });
  assert.deepEqual(page.page.actions.map((a) => a.kind), ["play_now", "play_next", "queue", "radio", "other"]);
  assert.deepEqual(page.page.tracks.map((t) => [t.title, t.pos]), [["1. Opening", 1]]);
  assert.equal(page.page.library_offset, null);
  const kidA = await s.level({ service: "tidal", path: JSON.stringify([...SAW.slice(0, 2), ["Kid A", 1]]) });
  assert.equal(kidA.page.library_offset, 41, "an album in the library not said so");
  assert.deepEqual(f.done, [], "reading carried something out");
  assert.deepEqual(await s.play({ service: "tidal", path: SAW, kind: "queue", zone_or_output_id: "z1" }), { invoked: "Queue" });
  assert.deepEqual(await s.playTrack({ service: "tidal", path: SAW, pos: 1, title: "1. Opening", kind: "play_now", zone_or_output_id: "z1" }),
    { invoked: "Play Now", track: "1. Opening" });
  assert.deepEqual(f.done, ["Queue @z1", "Play Now @z1"], "carried out more than was asked, or without the zone");
  assert.ok(zonesAsked.length > 4 && zonesAsked.every((z) => z === "z1"), "a step of a play walked without its zone");
});

test("a path is never walked through anything but lists: an action named on it is refused, and nothing carried out", async () => {
  const { f, s } = rig();
  await assert.rejects(s.level({ service: "tidal", path: JSON.stringify([["Play My Mix", 1]]) }), (e) => e.status === 409);
  await assert.rejects(s.play({ service: "tidal", path: [["Play My Mix", 1]], kind: "play_now", zone_or_output_id: "z1" }), (e) => e.status === 409);
  await assert.rejects(s.level({ service: "tidal", path: JSON.stringify([["Search TIDAL", 0]]) }), (e) => e.status === 409);
  assert.deepEqual(f.done, []);
});

test("a track on a level of tracks, with no page around it, is played by its place there, its title the proof", async () => {
  const { f, s } = rig();
  const tracks = await s.level({ service: "tidal", path: JSON.stringify([["What's New", 2], ["New Tracks", 1]]) });
  assert.equal(tracks.page, null);
  assert.deepEqual(tracks.items.map((i) => [i.title, i.hint, i.pos]), [["expectations", "action_list", 0], ["KOYSAR", "action_list", 1]]);
  assert.deepEqual(await s.playTrack({ service: "tidal", path: [["What's New", 2], ["New Tracks", 1]], pos: 1, title: "KOYSAR", kind: "queue", zone_or_output_id: "z2" }),
    { invoked: "Queue", track: "KOYSAR" });
  assert.deepEqual(f.done, ["Queue @z2"]);
});

test("an artist's page keeps the lists it holds beside its menu; a track named \"Play …\" is a track, not a page (the review)", async () => {
  const { f, s } = rig();
  const artist = await s.level({ service: "tidal", path: JSON.stringify([["Artists", 3], ["Aphex Twin", 0]]) });
  assert.equal(artist.page.kind, "other");
  assert.deepEqual(artist.page.actions.map((a) => a.kind), ["shuffle", "radio"]);
  assert.deepEqual(artist.items.map((i) => [i.title, i.hint, i.pos]), [["Albums", "list", 1]], "the artist's Albums dropped");
  const syro = await s.level({ service: "tidal", path: JSON.stringify([["Artists", 3], ["Aphex Twin", 0], ["Albums", 1], ["Syro", 0]]) });
  assert.equal(syro.page.kind, "album");
  const rock = [["What's New", 2], ["Rock Tracks", 2]];
  const tracks = await s.level({ service: "tidal", path: JSON.stringify(rock) });
  assert.equal(tracks.page, null, "a level of tracks taken for a page by its first track's title");
  assert.deepEqual(tracks.items.map((i) => i.title), ["Play the Game", "Under Pressure"]);
  assert.deepEqual(await s.playTrack({ service: "tidal", path: rock, pos: 0, title: "Play the Game", kind: "play_now", zone_or_output_id: "z1" }),
    { invoked: "Play Now", track: "Play the Game" });
  assert.deepEqual(f.done, ["Play Now @z1"]);
});

test("a long page: its items read once past the head, up to 500, and how many there are said", async () => {
  const { s, loadsAsked, tree } = rig();
  const album = tree.items[1].items[2].items[0].items[2];   // Third
  for (let i = 2; i <= 600; i++) album.items.push({ title: i + ". Track", subtitle: "Portishead", hint: "action_list", items: [{ title: "Play Now", hint: "action" }] });
  const path = [["What's New", 2], ["New Albums", 0], ["Third", 2]];
  const before = loadsAsked.length;
  const page = await s.level({ service: "tidal", path: JSON.stringify(path) });
  assert.equal(page.count, 601);
  assert.equal(page.page.shown, 500);
  assert.equal(page.page.tracks.length, 499);
  assert.deepEqual(page.page.tracks.slice(-1)[0], { title: "499. Track", subtitle: "Portishead", pos: 499 });
  const reads = loadsAsked.slice(before).filter(([off, n]) => n > 1);
  assert.ok(!reads.some(([off, n]) => off === 0 && n > 100), "the page's head read twice: " + JSON.stringify(reads));
});

test("a step found by its title when its position moved; one gone, said so", async () => {
  const { s } = rig();
  const moved = await s.level({ service: "tidal", path: JSON.stringify([["What's New", 0], ["New Albums", 7]]) });
  assert.equal(moved.items.length, 3);
  await assert.rejects(s.level({ service: "tidal", path: JSON.stringify([["Gone", 2]]) }), (e) => e.status === 404 && /isn't there any more/.test(e.message));
});

test("a track that moved is not played in its place", async () => {
  const { f, s } = rig();
  await assert.rejects(s.playTrack({ service: "tidal", path: SAW, pos: 1, title: "2. Something else", kind: "play_now", zone_or_output_id: "z1" }),
    (e) => e.status === 409);
  // Nor the page's own menu, taken for a track.
  await assert.rejects(s.playTrack({ service: "tidal", path: SAW, pos: 0, title: "Play Album", kind: "play_now", zone_or_output_id: "z1" }),
    (e) => e.status === 409);
  assert.deepEqual(f.done, []);
});

test("Roon's search, in the zone chosen or the first there is, opened as a service's levels are", async () => {
  const { s, zonesAsked } = rig();
  const found = await s.level({ service: "search", q: "homogenic", path: JSON.stringify([["Albums", 0]]) });
  assert.deepEqual(found.items.map((i) => i.title), ["Homogenic"]);
  assert.ok(zonesAsked.includes("z-default"), "searched with no zone");
  const page = await s.level({ service: "search", q: "homogenic", path: JSON.stringify([["Albums", 0], ["Homogenic", 0]]) });
  assert.equal(page.page.kind, "album");
  // Read in the zone chosen, as a play from it walks it (the review): the tree shown is the tree walked.
  const inZone = rig();
  await inZone.s.level({ service: "search", q: "homogenic", path: "[]", zone_or_output_id: "z9" });
  assert.deepEqual(inZone.zonesAsked, ["z9"]);
});

test("what a request may name: a service or a search, and a short path of titles with positions", () => {
  assert.ok(parseWhere({ service: "qobuz", path: "[]" }));
  assert.equal(parseWhere({ service: "spotify", path: "[]" }), null);
  assert.equal(parseWhere({ service: "search", path: "[]" }), null);
  assert.equal(parseWhere({ service: "tidal", path: "not json" }), null);
  assert.equal(parseWhere({ service: "tidal", path: JSON.stringify([["x", "0"]]) }), null);
  assert.equal(parseWhere({ service: "tidal", path: JSON.stringify(Array.from({ length: 11 }, () => ["x", 0])) }), null);
});

test("the routes: a malformed request is 400, unpaired 503, and a play needs a zone", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountStreaming(app, rig({ paired: false }).s);
  const call = async (k, req) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](req, res);
    return res;
  };
  assert.equal((await call("GET /api/streaming/level", { query: { service: "nope" } })).code, 400);
  assert.equal((await call("GET /api/streaming/level", { query: { service: "tidal", path: "[]" } })).code, 503);
  assert.equal((await call("POST /api/streaming/play", { body: { service: "tidal", path: SAW, kind: "play_now" } })).code, 400);
  assert.equal((await call("POST /api/streaming/play", { body: { service: "tidal", path: SAW, kind: "explode", zone_or_output_id: "z" } })).code, 400);
});
