"use strict";
// ---------------------------------------------------------------------------
// The Discogs, FanArt.tv and Last.fm key routes (lib/routes/api-keys.js),
// moved out of index.js unchanged in v1.9.67: read masked with the key's
// check; saved trimmed, outranking the env seed, checked afresh; FanArt.tv's
// save clears the cached misses and says how many; an empty key is 400.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountApiKeys } = require("../../lib/routes/api-keys");

function rig() {
  const st = { discogs: { key: "", source: "" }, fanart: { key: "abcdef1234", source: "env" }, lastfm: { key: "", source: "" } };
  const checks = [], saved = [], after = [];
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  const slot = (name, afterSave) => ({ get: () => st[name], set: (k) => { st[name] = { key: k, source: "settings" }; }, afterSave });
  mountApiKeys(app, {
    keyCheck: async (kind, key, fresh) => { checks.push([kind, key, fresh]); return key ? "ok" : "unset"; },
    save: (patch) => { saved.push(patch); return true; },
    discogs: slot("discogs"), fanart: slot("fanart", (k) => { after.push(["fanart", k]); return 3; }), lastfm: slot("lastfm", (k) => { after.push(["lastfm", k]); }),
  });
  const call = async (key, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key]({ body }, res);
    for (let i = 0; i < 3 && res.body === null; i++) await new Promise((r) => { setImmediate(r); });
    return res;
  };
  return { st, checks, saved, after, call };
}

test("read: set, masked to its last four, its source, and the last check", async () => {
  const w = rig();
  assert.deepEqual((await w.call("GET /api/settings/fanart-key")).body, { set: true, masked: "••••••••1234", source: "env", check: "ok" });
  assert.deepEqual((await w.call("GET /api/settings/discogs-token")).body, { set: false, masked: "", source: "", check: "unset" });
  assert.deepEqual(w.checks, [["fanart", "abcdef1234", false], ["discogs", "", false]]);
});

test("save: trimmed, kept as settings', persisted under its own name, checked afresh; FanArt.tv's clears misses; empty is 400", async () => {
  const w = rig();
  const d = await w.call("POST /api/settings/discogs-token", { token: "  tok123  " });
  assert.deepEqual([d.body, w.st.discogs, w.saved[0]], [{ ok: true, saved: true, check: "ok" }, { key: "tok123", source: "settings" }, { discogsToken: "tok123" }]);
  const f = await w.call("POST /api/settings/fanart-key", { key: "fk9" });
  assert.deepEqual([f.body, w.saved[1], w.after], [{ ok: true, saved: true, cleared: 3, check: "ok" }, { fanartKey: "fk9" }, [["fanart", "fk9"]]]);
  const l = await w.call("POST /api/settings/lastfm-key", { key: "lk" });
  assert.deepEqual([l.body, w.saved[2], w.after[1]], [{ ok: true, saved: true, check: "ok" }, { lastfmKey: "lk" }, ["lastfm", "lk"]]);
  assert.deepEqual(w.checks.slice(-3), [["discogs", "tok123", true], ["fanart", "fk9", true], ["lastfm", "lk", true]]);
  const empty = await w.call("POST /api/settings/discogs-token", { token: " " });
  assert.deepEqual([empty.code, empty.body], [400, { ok: false, error: "token is empty" }]);
  assert.equal((await w.call("POST /api/settings/lastfm-key", {})).body.error, "key is empty");
});
