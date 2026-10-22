"use strict";
// ---------------------------------------------------------------------------
// The share-link settings (lib/routes/share-settings.js, moved out of index.js
// unchanged in v1.9.54), against the real lib/share-links.js tables: the
// defaults until a choice is saved; an empty list is "all off", never "not
// changed"; a stored id the table no longer knows is dropped on the way out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const shareLinks = require("../../lib/share-links");
const { mountShareSettings } = require("../../lib/routes/share-settings");

function rig(stored = {}) {
  const st = Object.assign({}, stored);
  const routes = {};
  mountShareSettings({ get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } },
    { shareLinks, load: () => st, save: (patch) => Object.assign(st, patch) });
  const call = (k, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    routes[k]({ body }, res);
    return res;
  };
  return { call, st };
}

test("the defaults until a choice is saved; an empty list turns them all off", () => {
  const w = rig();
  const got = w.call("GET /api/settings/share-links").body;
  assert.deepEqual(got.services.enabled, shareLinks.defaultServiceIds());
  assert.deepEqual(got.reviews.enabled, shareLinks.defaultReviewIds());
  assert.equal(got.services.all, shareLinks.SERVICES);
  assert.deepEqual(w.call("POST /api/settings/share-links", { services: [] }).body.services, []);
  assert.deepEqual(w.call("GET /api/settings/share-links").body.services.enabled, []);
  assert.deepEqual(w.call("GET /api/settings/share-links").body.reviews.enabled, shareLinks.defaultReviewIds(), "the reviews changed too");
});

test("nothing to change is a 400; a stored id the table no longer knows is dropped", () => {
  const w = rig({ shareServices: [shareLinks.knownServiceIds()[0], "gone-service"] });
  assert.equal(w.call("POST /api/settings/share-links", {}).code, 400);
  assert.deepEqual(w.call("GET /api/settings/share-links").body.services.enabled, [shareLinks.knownServiceIds()[0]]);
});
