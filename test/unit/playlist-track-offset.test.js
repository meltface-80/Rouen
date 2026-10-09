"use strict";
// ---------------------------------------------------------------------------
// v1.9.2: a track added to a playlist is stored at its album's WHOLE-LIBRARY
// position.
//
// A stored entry is played later with no list at all. Added from an album view
// opened on a genre wall, it carried that genre list's offset — so every play
// of it opened the wrong list and leaned on relocation by identity, failing
// outright whenever the snapshot and Roon's search both could not place it.
// The page now says which list the offset came from, and the server stores
// the snapshot's whole-library position instead. The real storedAlbumOffset
// and parseFilter, sliced out of index.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");

const X = { album_title: "Concert très très privé RTL2", album_subtitle: "Jean-Jacques Goldman" };

function load(snapshotHas) {
  const asked = [];
  const F = loadIndexFunctions(["storedAlbumOffset", "parseFilter"], {
    relocateAlbumOffset: (expect) => { asked.push(expect.title); return snapshotHas; },
  });
  return { F, asked };
}

test("a playlist track is stored at its album's whole-library position (v1.9.2)", async (t) => {
  await t.test("THE one: added from the genre wall, the genre offset is replaced by the library's", () => {
    const { F } = load(2527);
    const out = F.storedAlbumOffset(Object.assign({ album_offset: 231, album_filter_type: "genre",
                                                    album_filter_value: "International" }, X));
    assert.equal(out.album_offset, 2527);
  });
  await t.test("one the snapshot cannot place is stored as sent: playback relocates it by identity", () => {
    const { F } = load(-1);
    const out = F.storedAlbumOffset(Object.assign({ album_offset: 231, album_filter_type: "genre",
                                                    album_filter_value: "International" }, X));
    assert.equal(out.album_offset, 231);
  });
  await t.test("control: an offset already in the whole library is stored untouched, with no lookup", () => {
    const { F, asked } = load(9999);
    for (const list of [{}, { album_filter_type: "" }, { album_filter_type: "decade", album_filter_value: "1980s" }]) {
      const out = F.storedAlbumOffset(Object.assign({ album_offset: 2527 }, X, list));
      assert.equal(out.album_offset, 2527, JSON.stringify(list));
    }
    assert.deepEqual(asked, []);
  });
  await t.test("control: what is not an object passes through for the record check to refuse", () => {
    const { F } = load(1);
    assert.equal(F.storedAlbumOffset(null), null);
    assert.equal(F.storedAlbumOffset("x"), "x");
  });
});
