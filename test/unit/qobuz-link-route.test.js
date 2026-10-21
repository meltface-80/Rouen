"use strict";
// ---------------------------------------------------------------------------
// GET /api/qobuz-link (lib/routes/qobuz-link.js, moved out of index.js in
// v1.9.47): the Qobuz album id that opens the app, read from Qobuz's search
// page once and cached — misses too — under the first credited act.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountQobuzLink } = require("../../lib/routes/qobuz-link");
const shareLinks = require("../../lib/share-links");
const qobuzDeep = require("../../lib/qobuz-deeplink");

function rig(page) {
  const routes = {};
  const fetched = [];
  mountQobuzLink({ get: (p, fn) => { routes[p] = fn; } }, {
    normalize: (s) => String(s).toLowerCase(), shareLinks, qobuzDeep, qobuzWait: async () => {},
    httpText: async (url) => { fetched.push(url); if (page === null) throw new Error("offline"); return page; },
    browserUA: "test", debug: false,
  });
  const call = async (query) => {
    const res = { code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; },
      json(b) { this.body = b; return this; } };
    await routes["/api/qobuz-link"]({ query, headers: { "accept-language": "en-GB" } }, res);
    return res;
  };
  return { call, fetched };
}

test("no album: refused, nothing fetched", async () => {
  const w = rig("");
  assert.equal((await w.call({ artist: "Air" })).code, 400);
  assert.equal(w.fetched.length, 0);
});

test("a record Qobuz doesn't carry: null, and not asked again", async () => {
  const w = rig("<html>nothing here</html>");
  const first = await w.call({ album: "Moon Safari", artist: "Air & Friends" });
  assert.deepEqual(first.body, { url: null });
  assert.equal(first.headers["Cache-Control"], "public, max-age=604800");
  await w.call({ album: "Moon Safari", artist: "Air & Friends" });
  assert.equal(w.fetched.length, 1, "a miss asked for again");
});

test("offline: null, the search link stays", async () => {
  const w = rig(null);
  assert.deepEqual((await w.call({ album: "Moon Safari", artist: "Air" })).body, { url: null });
});
