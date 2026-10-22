"use strict";
// ---------------------------------------------------------------------------
// N2e-3a's route (lib/roon-direct/route.js mountSmartUpdate, v1.9.55,
// native-remote.md §12.9): how-to without a name and an order; a preview
// unless update=1. The updater is a stand-in: its own test runs it against
// the fake server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountSmartUpdate } = require("../../lib/roon-direct/route");

test("how-to without a name and an order; a preview unless update=1; the direction passed as asked", async () => {
  const asked = [];
  const updater = { async preview(...a) { asked.push(["preview", ...a]); return { wouldUpdate: true }; },
    async update(...a) { asked.push(["update", ...a]); return { updated: true }; } };
  const routes = {};
  mountSmartUpdate({ get: (p, fn) => { routes[p] = fn; } }, updater);
  const call = async (query) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/debug/roon-smart-update"]({ query }, res);
    return res;
  };
  assert.match((await call({ name: "Folk" })).body.how, /&update=1 to send it/);
  assert.deepEqual((await call({ name: "Folk", sort: "artist" })).body, { wouldUpdate: true });
  await call({ name: "Folk", sort: "artist", update: "yes" });
  assert.deepEqual((await call({ name: "Folk", sort: "artist", dir: "desc", update: "1" })).body, { updated: true });
  assert.equal((await call({ name: "Folk", sort: "artist", omit: "playlistId,name", update: "1" })).code, 400, "the name may never be left out");
  assert.equal((await call({ name: "Folk", sort: "artist", carry: "secret", update: "1" })).code, 400);
  // A repeated parameter, a space and a trailing comma (the review).
  await call({ name: "Folk", sort: "artist", omit: ["playlistId", " profile,"], carry: "folder", update: "1" });
  assert.deepEqual(asked, [["preview", "Folk", "artist", "asc"], ["preview", "Folk", "artist", "asc"],
    ["update", "Folk", "artist", "desc", { omit: [], carry: [] }], ["update", "Folk", "artist", "asc", { omit: ["playlistId", "profile"], carry: ["folder"] }]]);
});
