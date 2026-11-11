"use strict";
// ---------------------------------------------------------------------------
// GET /api/artist-bio (lib/routes/artist-bio.js), moved out of index.js unchanged in 2.0.5-t1 (dev/quality.md,
// "Splitting the monoliths"): the artist page's header bio from the wall display's lookup, or none.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountArtistBio } = require("../../lib/routes/artist-bio");

/** @param {(artist: string, album: string | null) => Promise<any>} fetchDisplayArtistBio */
function route(fetchDisplayArtistBio) {
  let fn = null;
  mountArtistBio({ get: (p, f) => { assert.equal(p, "/api/artist-bio"); fn = f; } }, { fetchDisplayArtistBio });
  return async (query) => {
    const out = { status: 200, body: null };
    await fn({ query }, { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } });
    return out;
  };
}

test("the bio as the page reads it; the album pins the artist; none without a description; 400 without an artist; 500 on a failure", async () => {
  const asked = [];
  const call = route(async (artist, album) => {
    asked.push([artist, album]);
    if (artist === "Nobody") return { name: "Nobody" };
    if (artist === "Broken") throw new Error("lookup failed");
    return { name: "INXS", description: "An Australian band.", source: "Wikipedia", image: null };
  });
  assert.deepEqual((await call({ artist: " inxs ", album: " Kick " })).body,
    { bio: { name: "INXS", text: "An Australian band.", source: "Wikipedia", image: null } });
  assert.deepEqual(asked[0], ["inxs", "Kick"], "trimmed; the album passed to pin the artist");
  await call({ artist: "INXS" });
  assert.deepEqual(asked[1], ["INXS", null], "no album: null");
  assert.deepEqual((await call({ artist: "Nobody" })).body, { bio: null });
  assert.deepEqual(await call({}), { status: 400, body: { error: "artist required" } });
  assert.deepEqual(await call({ artist: "Broken" }), { status: 500, body: { error: "lookup failed" } });
});
