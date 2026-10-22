"use strict";
// ---------------------------------------------------------------------------
// N2e-2b's route (lib/routes/smart-make.js, v1.9.53, native-remote.md §12.7):
// a preview unless make=1; a Dynamic Playlist not Rouen's, or one that can't be
// made, said without asking the maker. The maker is a stand-in: its own test
// runs it against the fake server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountSmartMake } = require("../../lib/routes/smart-make");

const FOLK = { name: "Folk", view: { sort: "album", genre: ["Folk"] }, limit: 100 };
function rig(o = {}) {
  const asked = [];
  const maker = { async preview(name) { asked.push(["preview", name]); return { made: false, wouldMake: true, why: [] }; },
    async make(name) { asked.push(["make", name]); return { made: true, name }; } };
  const routes = {};
  const list = [Object.assign({ id: "d1" }, FOLK, o.sp)].concat(o.twice ? [Object.assign({ id: "d2" }, FOLK)] : []);
  mountSmartMake({ get: (p, fn) => { routes[p] = fn; } }, { maker: () => (o.noMaker ? null : maker), list: () => list,
    saved: () => o.saved || list, matched: () => o.matched ?? 40,
    // As index.js's: a label filter saved while Labels is off.
    unavailable: (sp) => (sp.view && sp.view.label && sp.view.label.length ? "Labels is off." : null) });
  const call = async (query) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/debug/roon-smart-make"]({ query }, res);
    return res;
  };
  return { call, asked };
}

test("a preview unless make=1; made with make=1 alone", async () => {
  const w = rig();
  assert.match((await w.call({})).body.how, /add &make=1 to make it/);
  const seen = await w.call({ name: "Folk" });
  assert.deepEqual([seen.body.wouldMake, seen.body.rouen.albumsMatched, seen.body.focus.include], [true, 40, ["Folk"]]);
  await w.call({ name: "Folk", make: "yes" });
  assert.deepEqual((await w.call({ name: "Folk", make: "1" })).body.made, true);
  assert.deepEqual(w.asked, [["preview", "Folk"], ["preview", "Folk"], ["make", "Folk"]]);
});

test("not Rouen's: 404; can't be made: why, the maker never asked; native mode not running: 409", async () => {
  const w = rig({ matched: 340 });
  assert.equal((await w.call({ name: "Jazz", make: "1" })).code, 404);
  const cut = await w.call({ name: "Folk", make: "1" });
  assert.deepEqual([cut.body.made, cut.body.why.length], [false, 1]);
  assert.deepEqual(w.asked, []);
  assert.equal((await rig({ noMaker: true }).call({ name: "Folk", make: "1" })).code, 409);
});

test("the review: two of one name, refused; a label filter saved with Labels off (and dropped on loading) stops it", async () => {
  const two = rig({ twice: true });
  assert.equal((await two.call({ name: "Folk", make: "1" })).code, 409);
  const off = rig({ saved: [{ id: "d1", name: "Folk", view: { genre: ["Folk"], label: ["Topic"] } }] });
  const out = await off.call({ name: "Folk", make: "1" });
  assert.deepEqual([out.body.made, out.body.why], [false, ["Labels is off."]]);
  assert.deepEqual([...two.asked, ...off.asked], []);
});
