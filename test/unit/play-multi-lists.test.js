"use strict";
// ---------------------------------------------------------------------------
// v1.9.2: every album in a multi-select is opened in the list its offset
// indexes.
//
// The page sent ONE filter for the whole selection — the active one — and the
// server opened every album in that list. A selection made on the artist page
// (or a label's albums) while a genre filter was on is whole-library offsets,
// so each was looked up in the genre's list instead: the album-view bug of the
// same report, reached through Play / Queue / Play next on a selection. An
// item names its own list now; one that names none takes the request's, which
// is what every page before v1.9.2 sends.
//
// The handler is the SHIPPING source, sliced out of index.js (as in
// play-multi-next.test.js), with the real parseFilter.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { indexSource, loadIndexFunctions } = require("../lib/extract");
const { sendOrderFor } = require("../../lib/queue-history");

const { parseFilter } = loadIndexFunctions(["parseFilter"]);

function loadHandler() {
  const src = indexSource();
  const at = src.indexOf('app.post("/api/play-multi", ');
  assert.ok(at > 0, "the play-multi route moved");
  const start = src.indexOf("async (req, res) =>", at);
  const end = src.indexOf("\n});", start);
  const body = src.slice(start, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function("core", "parseFilter", "openAlbumByOffset", "sendOrderFor", "playMultiZones",
                      "return (" + body + ");");
}

const listName = (f) => (f ? f.type + ":" + f.value + (f.parent ? "<" + f.parent : "") : "library");

function run(body) {
  const opened = [];
  const handler = loadHandler()(
    {},                                         // core: paired
    parseFilter,
    async (offset, zone, kind, filter) => { opened.push({ offset, kind, list: listName(filter) }); },
    sendOrderFor,
    new Set(),
  );
  let status = 200, out = null;
  const res = { status(c) { status = c; return this; }, json(b) { out = b; return this; } };
  return handler({ body: Object.assign({ zone_or_output_id: "z1" }, body) }, res)
    .then(() => ({ status, body: out, opened }));
}

const GENRE = { filter_type: "genre", filter_value: "International", filter_parent: "" };
// The artist page's albums: whole-library offsets, said so outright.
const ARTIST_A = { offset: 2527, title: "Concert très très privé RTL2", subtitle: "Jean-Jacques Goldman",
                   filter_type: "", filter_value: "", filter_parent: "" };
const ARTIST_B = { offset: 2530, title: "Entre gris clair et gris foncé", subtitle: "Jean-Jacques Goldman",
                   filter_type: "", filter_value: "", filter_parent: "" };
// A tile from the genre wall: an offset in the genre's list.
const WALL = Object.assign({ offset: 231, title: "La collection 81-89", subtitle: "Jean-Jacques Goldman" }, GENRE);

test("each album is opened in the list it names, whatever the request's filter (v1.9.2)", async (t) => {
  await t.test("THE one: the artist page's albums under a genre filter go to the whole library", async () => {
    for (const kind of ["play_now", "queue", "play_next"]) {
      // A page that still sends the active filter at the top level, as v1.9.1 did.
      const r = await run(Object.assign({ kind, items: [ARTIST_A, ARTIST_B] }, GENRE));
      assert.equal(r.status, 200, kind + ": " + JSON.stringify(r.body));
      assert.deepEqual(r.opened.map((o) => o.list), ["library", "library"],
        kind + ": a whole-library offset was opened in the genre's list");
    }
  });
  await t.test("one selection can hold both lists, and each album keeps its own", async () => {
    const r = await run({ kind: "queue", items: [WALL, ARTIST_A] });
    assert.deepEqual(r.opened.map((o) => o.offset + "@" + o.list),
      ["231@genre:International", "2527@library"]);
  });
  await t.test("Play next keeps each album's list through the reversal", async () => {
    const r = await run({ kind: "play_next", items: [WALL, ARTIST_A] });
    assert.deepEqual(r.opened.map((o) => o.offset + "@" + o.list),
      ["2527@library", "231@genre:International"]);
  });
  await t.test("a sub-genre's parent travels with the item", async () => {
    const sub = Object.assign({}, WALL, { filter_value: "Chanson", filter_parent: "International" });
    const r = await run({ kind: "queue", items: [sub] });
    assert.deepEqual(r.opened.map((o) => o.list), ["genre:Chanson<International"]);
  });
  await t.test("control: an item naming no list takes the request's, as every page before v1.9.2 sends", async () => {
    const old = { offset: 231, title: "La collection 81-89", subtitle: "Jean-Jacques Goldman" };
    const r = await run(Object.assign({ kind: "queue", items: [old, old] }, GENRE));
    assert.deepEqual(r.opened.map((o) => o.list), ["genre:International", "genre:International"]);
  });
  await t.test("control: bare offsets take the request's list", async () => {
    const r = await run(Object.assign({ kind: "queue", offsets: [231, 232] }, GENRE));
    assert.deepEqual(r.opened.map((o) => o.list), ["genre:International", "genre:International"]);
  });
});
