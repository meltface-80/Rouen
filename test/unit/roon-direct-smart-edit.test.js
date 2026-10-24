"use strict";
// ---------------------------------------------------------------------------
// N2e-3b-4 (lib/roon-direct/smart-edit.js, v1.9.66-t16, native-remote.md
// §12.18): any of Roon's smart playlists edited from Rouen — given to the
// editor as its Focus reads now, saved with Playlists::UpdatePlaylist in
// §12.13's proven form, believed once it reads back — end to end against the
// fake server (fake-roon-playlists.js), which reads the call strictly and
// refuses a PlaylistId among the parameters, as the owner's server does. Not
// evidence that the real server takes an edit or a rename: the owner's Roon
// showing it is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { mapFocus } = require("../../lib/roon-direct/focus-map");
const { createSmartEditor } = require("../../lib/roon-direct/smart-edit");
const { allPlaylists } = require("../../lib/roon-direct/playlists");
const { field } = require("../../lib/roon-direct/objects");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
/** The target's id less "roon:", as the route passes it: its PlaylistId and the stamp of what its editor was given. */
const tid = (got) => got.target.id.slice("roon:".length);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }, { name: "r&b random", tracks: 30, items: 30, smart: true }];
const FOLK = { name: "Folk - My Dynamic Playlist", view: { sort: "album", dir: "asc", played: "any", genre: ["Folk"] } };
/** Made in Roon (§12.2): Random, its own seed, various artists by album title, and Folk that must all match. */
const ROONS = { n: 70, name: "Roon's Folk", smart: true, readOnly: true, tracks: 9, albums: 1, focus: { require: [28001n], exclude: [] }, uiLanguage: "fr",
  ordering: { Ordering: 7, Direction: 1, RandomSeed: 9, OrderVariousArtistsByAlbumTitle: true } };

async function rig(t, faults) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.map((a) => Object.assign({}, a)),
    playlists: PLAYLISTS.map((p) => Object.assign({}, p)).concat([Object.assign({}, ROONS)]), faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.66",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  const made = await s1.smartMaker.make(FOLK.name, mapFocus(FOLK, null, null).focus);
  assert.equal(made.made, true);
  /** A playlist's PlaylistId, by its name, as Roon's list gives it. */
  const idOf = async (name) => {
    let id = null;
    await until(() => {
      const all = allPlaylists(link.session());
      const x = all ? all.playlists.find((p) => field(p, "Name") === name) : null;
      id = x ? field(x, "PlaylistId").toString("hex") : null;
      return id;
    });
    return id;
  };
  const quick = (o) => createSmartEditor(Object.assign({ link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 400 }, o));
  const last = () => core.rec.playlistCalls[core.rec.playlistCalls.length - 1];
  return { core, s1, link, idOf, quick, last, editor: s1.smartMove.editor() };
}

test("THE one for §12.18: given to the editor as its Focus reads, asking nothing; saved in §12.13's form; believed once it reads back so", async (t) => {
  const w = await rig(t);
  const id = await w.idOf(FOLK.name);
  const before = w.core.rec.playlistCalls.length;
  const got = await w.editor.editable(id);
  assert.ok("target" in got, JSON.stringify(got));
  assert.deepEqual([got.target.id, got.target.name, got.target.roon, got.target.view.sort, got.target.view.dir, got.target.view.genre],
    [got.target.id, FOLK.name, true, "album", "asc", ["Folk"]]);
  assert.match(got.target.id, new RegExp(`^roon:${id}\\.[0-9a-f]{12}$`));
  assert.equal(w.core.rec.playlistCalls.length, before, "giving it to the editor asked something of the server");
  const view = Object.assign({}, got.target.view, { sort: "year", dir: "desc", genre: ["Folk", "!R&B"], decade: ["1970"] });
  const out = await w.editor.save(tid(got), FOLK.name, view);
  assert.deepEqual(out, { saved: true, name: FOLK.name });
  const call = w.last();
  assert.deepEqual([call.kind, call.playlist, call.playlistId, call.name, call.requireNames, call.excludeNames, call.ordering, call.genresMode],
    ["update", FOLK.name, undefined, FOLK.name, ["Folk"], ["R&B"], { Ordering: 2, Direction: 2 }, 1]);
  assert.ok(call.extra.MinDate && call.extra.MaxDate, "its decade wasn't sent");
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.ok(w.core.rec.signatures.includes(SIG.updateSmartPlaylist));
  // Opened again: as Roon now holds it.
  const again = await w.editor.editable(id);
  assert.deepEqual([again.target.view.sort, again.target.view.dir, again.target.view.decade], ["year", "desc", ["1970"]]);
});

test("the owner (§12.18): one made in Roon is edited too — its own order kept as it was (its seed, its various artists), renamed and believed on read-back", async (t) => {
  const w = await rig(t);
  const id = await w.idOf(ROONS.name);
  const got = await w.editor.editable(id);
  assert.ok("target" in got, JSON.stringify(got));
  assert.deepEqual([got.target.view.sort, got.target.view.seed], ["random", 9]);
  const out = await w.editor.save(tid(got), "Folk, shuffled", Object.assign({}, got.target.view, { seed: 1234, played: "never" }));
  assert.deepEqual(out, { saved: true, name: "Folk, shuffled" });
  assert.deepEqual([w.last().name, w.last().ordering], ["Folk, shuffled", { Ordering: 7, Direction: 1, OrderVariousArtistsByAlbumTitle: true, RandomSeed: 9 }],
    "its order not carried over as Roon held it");
  assert.equal(w.last().uiLanguage, "fr", "its UiLanguage made \"en\" (the review)");
  assert.equal(w.core.rec.playlists.find((p) => p.n === ROONS.n).name, "Folk, shuffled");
  // Its order changed: what was picked, and still its various artists as Roon held them.
  const next = await w.editor.editable(id);
  assert.equal((await w.editor.save(tid(next), "Folk, shuffled", Object.assign({}, next.target.view, { sort: "artist" }))).saved, true);
  assert.deepEqual(w.last().ordering, { Ordering: 0, Direction: 1, OrderVariousArtistsByAlbumTitle: true });
});

test("a Default direction stays Default when its order is left as it was; one changed is sent as picked", async (t) => {
  const w = await rig(t);
  w.core.rec.playlists.push({ n: 71, name: "Default", smart: true, readOnly: true, tracks: 9, albums: 1, focus: { require: [28001n], exclude: [] },
    ordering: { Ordering: 4, Direction: 0 } });
  await w.s1.smartMaker.make("Nudge", mapFocus({ name: "Nudge", view: { genre: ["R&B"] } }, null, null).focus);
  const id = await w.idOf("Default");
  const got = await w.editor.editable(id);
  assert.equal(got.target.view.dir, "asc");
  assert.equal((await w.editor.save(tid(got), "Default", Object.assign({}, got.target.view, { played: "never" }))).saved, true);
  assert.deepEqual(w.last().ordering, { Ordering: 4, Direction: 0 }, "a Default made Ascending");
  const next = await w.editor.editable(id);
  assert.equal((await w.editor.save(tid(next), "Default", Object.assign({}, next.target.view, { dir: "desc" }))).saved, true);
  assert.deepEqual(w.last().ordering, { Ordering: 4, Direction: 2 });
});

test("refused, said, nothing sent: what Roon can't hold, a name taken, a genre not sent, not opened first, changed in Roon since, not a smart playlist, not there", async (t) => {
  const w = await rig(t);
  const id = await w.idOf(FOLK.name);
  const before = w.core.rec.playlistCalls.length;
  assert.match((await w.editor.save(id, FOLK.name, FOLK.view)).why, /changed in Roon since you opened it/, "saved without being opened");
  const got = await w.editor.editable(id);
  const view = got.target.view;
  const t1 = tid(got);
  assert.equal((await w.editor.save(id + ".000000000000", FOLK.name, view)).kind, "stale", "saved with another editor's stamp");
  const can = await w.editor.save(t1, FOLK.name, Object.assign({}, view, { chan: ["2"] }));
  assert.deepEqual([can.saved, can.kind], [false, "refused"]);
  assert.match(can.why, /^Roon's smart playlists can't hold its Channels filter/);
  assert.match((await w.editor.save(t1, "Morning", view)).why, /already has a playlist named "Morning"/);
  assert.match((await w.editor.save(t1, FOLK.name, Object.assign({}, view, { genre: ["Jazz"] }))).why, /hasn't sent Rouen the genre "Jazz"/);
  assert.equal((await w.editor.save(t1, " ", view)).kind, "invalid");
  assert.equal((await w.editor.save("not hex", FOLK.name, view)).kind, "invalid");
  // Changed in Roon meanwhile: not overwritten.
  const folk = w.core.rec.playlists.find((p) => p.name === FOLK.name);
  folk.ordering = { Ordering: 0, Direction: 1 };
  await w.s1.smartMaker.make("Nudge", mapFocus({ name: "Nudge", view: { genre: ["R&B"] } }, null, null).focus);
  const stale = await w.editor.save(t1, FOLK.name, view);
  assert.deepEqual([stale.saved, stale.kind], [false, "stale"], JSON.stringify(stale));
  assert.equal(w.core.rec.playlistCalls.filter((c) => c.kind === "update").length, 0, "an update was sent");
  assert.ok(w.core.rec.playlistCalls.length > before);
  // Not smart; not there; one Rouen's editor can't show.
  assert.match((await w.editor.editable(await w.idOf("Morning"))).why, /isn't one of your server's smart playlists/);
  assert.match((await w.editor.editable("abcdef")).why, /doesn't list this playlist/);
  assert.match((await w.editor.editable(await w.idOf("r&b random"))).why, /can't show this smart playlist whole: .*RequireIsFavorite/);
});

test("taken and not shown: \"unknown\", said, and not sent again until Rouen restarts; not answered: the same", async (t) => {
  for (const fault of ["updateIgnored", "updateUnanswered"]) {
    const w = await rig(t, { [fault]: true });
    const ed = w.quick({ settleMs: 300 });
    const id = await w.idOf(FOLK.name);
    const got = await ed.editable(id);
    const out = await ed.save(tid(got), FOLK.name, Object.assign({}, got.target.view, { dir: "desc" }));
    assert.equal(out.saved, "unknown", fault + ": " + JSON.stringify(out));
    const sent = w.core.rec.playlistCalls.length;
    assert.match((await ed.save(tid(got), FOLK.name, Object.assign({}, got.target.view, { dir: "desc" }))).why, /was sent and not shown/);
    assert.equal(w.core.rec.playlistCalls.length, sent, fault + ": sent again");
  }
});

test("the review: two editors of one playlist — the second opened after a change in Roon doesn't let the first overwrite it; a rename in Roon since isn't put back", async (t) => {
  const w = await rig(t);
  const id = await w.idOf(FOLK.name);
  const a = await w.editor.editable(id);
  const folk = w.core.rec.playlists.find((p) => p.name === FOLK.name);
  folk.ordering = { Ordering: 0, Direction: 1 };
  await w.s1.smartMaker.make("Nudge", mapFocus({ name: "Nudge", view: { genre: ["R&B"] } }, null, null).focus);
  const b = await w.editor.editable(id);
  assert.notEqual(tid(a), tid(b));
  assert.equal((await w.editor.save(tid(a), FOLK.name, Object.assign({}, a.target.view, { dir: "desc" }))).kind, "stale", "the first editor overwrote Roon's change");
  // Renamed in Roon since: the views are the same, the name isn't.
  const c = await w.editor.editable(id);
  folk.name = "Folk, renamed in Roon";
  await w.s1.smartMaker.make("Nudge 2", mapFocus({ name: "Nudge 2", view: { genre: ["R&B"] } }, null, null).focus);
  assert.equal((await w.editor.save(tid(c), FOLK.name, c.target.view)).kind, "stale", "Roon's rename put back");
  assert.equal(w.core.rec.playlistCalls.filter((x) => x.kind === "update").length, 0);
});

test("the review: one that named no profile is believed once the server records the one the parameters named", async (t) => {
  const w = await rig(t, { recordProfile: true });
  // Made in Roon, as the fake sends it: no Profile.
  const id = await w.idOf(ROONS.name);
  const got = await w.editor.editable(id);
  const out = await w.quick({ settleMs: 1500 }).save(tid(got), ROONS.name, Object.assign({}, got.target.view, { played: "never" }));
  assert.deepEqual(out, { saved: true, name: ROONS.name });
  assert.ok(w.core.rec.playlists.find((p) => p.n === ROONS.n).profile, "the fake didn't record the profile");
});
