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
  mountSmartMake({ get: (p, fn) => { routes[p] = fn; } }, { maker: () => (o.noMaker ? null : maker), list: () => o.list || list,
    matched: () => o.matched ?? 40,
    // As index.js's with Labels off: a playlist with a label filter.
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
  const w = rig({ sp: { view: { sort: "album", genre: ["Folk"], chan: ["2"] } } });
  assert.equal((await w.call({ name: "Jazz", make: "1" })).code, 404);
  const no = await w.call({ name: "Folk", make: "1" });
  assert.deepEqual([no.body.made, no.body.why], [false, ["its Channels filter (Roon's channel layout names aren't known)"]]);
  assert.deepEqual(w.asked, []);
  assert.equal((await rig({ noMaker: true }).call({ name: "Folk", make: "1" })).code, 409);
});

test("v1.9.60 (§12.15): a limit that cuts no longer stops it — made, and the answer says Roon holds them all", async () => {
  const w = rig({ matched: 340 });
  const out = await w.call({ name: "Folk", make: "1" });
  assert.deepEqual([out.body.made, out.body.notes], [true, ["Roon's smart playlists have no album limit: Roon holds all 340 albums it matches, not 100."]]);
  assert.deepEqual(w.asked, [["make", "Folk"]]);
});

test("the review: two of one name, refused; a label filter (kept on loading since v1.9.54) with Labels off stops it", async () => {
  const two = rig({ twice: true });
  assert.equal((await two.call({ name: "Folk", make: "1" })).code, 409);
  const off = rig({ list: [{ id: "d1", name: "Folk", view: { genre: ["Folk"], label: ["Topic"] }, limit: 100 }] });
  const out = await off.call({ name: "Folk", make: "1" });
  assert.deepEqual([out.body.made, out.body.why], [false, ["Labels is off."]], "with Labels on, a label is made (§12.15); off, Rouen can't say which");
  assert.deepEqual([...two.asked, ...off.asked], []);
});
