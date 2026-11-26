"use strict";
// ---------------------------------------------------------------------------
// A Smart Pick as the screens get it, and the services' favourite ids (lib/smart-picks/json.js, moved out of index.js
// unchanged in 2.0.7-t4). Broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPickJson } = require("../../lib/smart-picks/json");

const ROW = { kind: "adjacent", artist: "Seefeel", album: "Quique", album_id: "42", service: "qobuz", image: "i", reason: "r", genre: "g", mbid: null };
function rig(o = {}) {
  const logged = [];
  const j = createPickJson({
    libraryRecord: (t) => (o.inLibrary && t === "Quique" ? { offset: 7, title: "Quique (Redux)", subtitle: "Seefeel", image_key: "k" } : null),
    laterHas: (t, a, rows) => rows.includes(t), serviceLinks: () => [{ id: "qobuz", url: "u" }],
    qobuzReady: () => o.qobuz !== false, tidalReady: () => !!o.tidal,
    qobuzFavIds: () => ({ get: async () => { if (o.qobuzFails) throw new Error("down"); return new Set(["42"]); } }),
    tidalFavIds: () => ({ get: async () => new Set() }), log: (l) => logged.push(l),
  });
  return { j, logged };
}

test("a pick: added by its service's favourites, null when the service couldn't be asked; playable from the library", () => {
  const { j } = rig();
  const out = j.pickJson(ROW, { qobuz: new Set(["42"]), tidal: null }, ["Quique"], {});
  assert.deepEqual([out.added, out.later, out.offset, out.services.length], [true, true, null, 1]);
  assert.equal(j.pickJson(Object.assign({}, ROW, { service: "tidal" }), { qobuz: null, tidal: null }, [], {}).added, null,
    "a service not asked said not added");
  const lib = rig({ inLibrary: true }).j.pickJson(ROW, { qobuz: null, tidal: null }, [], {});
  assert.deepEqual([lib.offset, lib.library_title, lib.image_key, lib.services], [7, "Quique (Redux)", "k", []]);
});

test("favourites: each connected service's ids; one failing is null and said, never empty", async () => {
  assert.deepEqual(await rig({ tidal: true }).j.favourites(), { qobuz: new Set(["42"]), tidal: new Set() });
  const failing = rig({ qobuzFails: true });
  assert.deepEqual(await failing.j.favourites(), { qobuz: null, tidal: null });
  assert.match(failing.logged[0], /Qobuz favourites unavailable: down/);
  assert.deepEqual(await rig({ qobuz: false }).j.favourites(), { qobuz: null, tidal: null });
});

test("a pick Roon found (smart-picks.md §11): no service id to ask by, so added is null, not false", () => {
  const { j } = rig();
  const out = j.pickJson(Object.assign({}, ROW, { album_id: "" }), { qobuz: new Set(["42"]), tidal: null }, [], {});
  assert.equal(out.added, null, "THE one: said not added though nothing could be asked");
  assert.equal(out.album_id, "");
});
