"use strict";
// ---------------------------------------------------------------------------
// N2e-3b-4 (lib/roon-direct/focus-unmap.js, v1.9.66-t16, native-remote.md
// §12.18): a Roon smart playlist's album Focus as the view of Rouen's Dynamic
// Playlist editor, the inverse of focus-map.js. Round trips run through the
// fake server (fake-roon-playlists.js): each view mapped, made, sent back as
// the server writes a Focus (sparse), and read again as the same view. A
// Focus the editor can't show whole is refused, named. Not evidence of what
// the real server writes: the owner's Roon playlists opened in the editor are.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { mapFocus, nullDate } = require("../../lib/roon-direct/focus-map");
const { viewOf, sourcesOf, decadesOf, playedOf } = require("../../lib/roon-direct/focus-unmap");
const { allPlaylists } = require("../../lib/roon-direct/playlists");
const { field } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }, { name: "r&b random", tracks: 30, items: 30, smart: true }];

async function rig(t) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.map((a) => Object.assign({}, a)),
    playlists: PLAYLISTS.map((p) => Object.assign({}, p)), faults: { sentOnce: true } });
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
  /** The playlist of that name as the connection holds it now. */
  const named = async (name) => {
    let x = null;
    await until(() => { const all = allPlaylists(link.session()); x = all ? all.playlists.find((p) => field(p, "Name") === name) : null; return x; });
    return x;
  };
  return { core, s1, link, named, graph: () => link.session().graph };
}

/** A view as the editor gives it: every facet, sorted, so two can be compared. */
const KEYS = ["genre", "decade", "source", "format", "rate", "bits", "label", "added", "type"];
function whole(v) {
  const out = { sort: v.sort, dir: v.dir, played: v.played || "any" };
  for (const k of KEYS) out[k] = [...(v[k] || [])].map(String).sort();
  if (v.sort === "random") out.seed = v.seed;
  return out;
}

/** Every filter the editor and Roon's Focus both hold, each at least once, and every order. */
const VIEWS = [
  { sort: "album", dir: "asc", played: "any", genre: ["Folk", "!R&B"] },
  { sort: "random", dir: "asc", seed: 42, played: "never", genre: ["Folk", "R&B"], decade: ["1970", "1980"] },
  { sort: "year", dir: "desc", played: "6", source: ["local"], format: ["FLAC", "!MPEG"], rate: ["96000"], bits: ["24", "!16"],
    label: ["Motown", "!Stax"], added: ["30"] },
  { sort: "added", dir: "desc", played: "12", source: ["qobuz", "tidal"], added: ["!90"] },
  { sort: "artist", dir: "asc", played: "any", source: ["!tidal"], decade: ["1990"] },
  // v1.9.67 (§12.19): the kinds of release, in and out.
  { sort: "album", dir: "asc", played: "any", type: ["ep", "single", "!compilation"] },
];

test("THE one for §12.18's reading: every view the editor can make, mapped, made and sent back, reads as the same view", async (t) => {
  const w = await rig(t);
  for (const [i, view] of VIEWS.entries()) {
    const name = "Round trip " + i;
    const m = mapFocus({ name, view, limit: undefined }, null, null);
    assert.ok("focus" in m, JSON.stringify(m));
    const made = await w.s1.smartMaker.make(name, m.focus);
    assert.equal(made.made, true, JSON.stringify(made));
    const back = viewOf(w.graph(), await w.named(name));
    assert.ok("view" in back, `${name}: ${JSON.stringify(back)}`);
    assert.deepEqual(whole(back.view), whole(view), name);
  }
});

test("refused, named: a Focus the editor can't show whole — a filter it hasn't, genres that must all match, an order it hasn't, years that aren't decades, a Played it hasn't", async (t) => {
  const w = await rig(t);
  // Roon's own (the fake's default Focus): favourites only, and album types.
  const rnb = viewOf(w.graph(), await w.named("r&b random"));
  // Its RequireTypes (Single) is a filter the editor has since v1.9.67; favourites only is still not.
  assert.ok("why" in rnb && rnb.why.some((x) => /RequireIsFavorite/.test(x)) && !rnb.why.some((x) => /RequireTypes/.test(x)), JSON.stringify(rnb));
  const made = (n, extra) => Object.assign({ n, smart: true, readOnly: true, tracks: 5, albums: 1, focus: { require: [28001n], exclude: [] },
    ordering: { Ordering: 4, Direction: 1 }, genresMode: 1 }, extra);
  w.core.rec.playlists.push(
    made(60, { name: "Folk and R&B", focus: { require: [28001n, 28000n], exclude: [] }, genresMode: 0 }),
    made(61, { name: "By composer", ordering: { Ordering: 3, Direction: 1 } }),
    made(62, { name: "Late seventies", extra: { MinDate: nullDate(1975, 0, 0), MaxDate: nullDate(1979, 12, 31) } }),
    made(63, { name: "Played lately", extra: { RequirePlayedInLastNDays: 30 } }),
    made(64, { name: "Folk, Default", ordering: { Ordering: 4, Direction: 0 } }),
    // Mapped exactly, and still not choices the editor has (the review): it would open with them on and unseen.
    made(65, { name: "Not in 3 months", extra: { ExcludePlayedInLastNDays: 90 } }),
    made(66, { name: "Played ever", extra: { RequirePlayedInLastNDays: 36500 } }),
    made(67, { name: "Added this fortnight", extra: { RequireImportedInLastNDays: 14 } }),
    // Roon's Unknown (5): no kind of Rouen's (v1.9.67).
    made(68, { name: "Of unknown kind", extra: { ExcludeTypes: [5] } }));
  // Sent to this connection once the list changes: a make pushes it again.
  assert.equal((await w.s1.smartMaker.make("Nudge", mapFocus({ name: "Nudge", view: { genre: ["Folk"] } }, null, null).focus)).made, true);
  const why = async (name) => { const r = viewOf(w.graph(), await w.named(name)); assert.ok("why" in r, `${name} shown: ${JSON.stringify(r)}`); return r.why.join(" "); };
  assert.match(await why("Folk and R&B"), /must all match/);
  assert.match(await why("By composer"), /its order \(Roon's 3\)/);
  assert.match(await why("Late seventies"), /isn't whole decades/);
  assert.match(await why("Played lately"), /Played filter/);
  assert.match(await why("Not in 3 months"), /Played filter/);
  assert.match(await why("Played ever"), /Played filter/);
  assert.match(await why("Added this fortnight"), /Added in the last 14 days/);
  assert.match(await why("Of unknown kind"), /album type Rouen's editor doesn't have \(Roon's 5\)/);
  // One genre that must all match is the same as any of it; a Default direction is the editor's ascending.
  const folk = viewOf(w.graph(), await w.named("Folk, Default"));
  assert.ok("view" in folk, JSON.stringify(folk));
  assert.deepEqual([folk.view.sort, folk.view.dir, folk.view.genre], ["album", "asc", ["Folk"]]);
  // A track Focus.
  assert.match(viewOf(w.graph(), { fields: { "Sooloos.Broker.Api.TrackQueryCriteria Sooloos.Broker.Api.Playlist::TrackCriteria": { $ref: 5n } } }).why[0], /track Focus/);
});

test("§12.11: genres by name beside their objects, as Roon's own app writes them, are the same genres; others are refused", async (t) => {
  const w = await rig(t);
  const m = mapFocus({ name: "Folk", view: { genre: ["Folk"] } }, null, null);
  assert.equal((await w.s1.smartMaker.make("Folk", m.focus)).made, true);
  const p = await w.named("Folk");
  const key = Object.keys(p.fields).find((k) => k.endsWith("::AlbumCriteria"));
  const BY_NAME = "System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::RequireGenres";
  const withNames = (names) => {
    const w2 = new BinaryWriter().flexInt(names.length);
    for (const n of names) w2.string(n);
    return { fields: Object.assign({}, p.fields, { [key]: Object.assign({}, p.fields[key], { [BY_NAME]: w2.toBuffer() }) }) };
  };
  const same = viewOf(w.graph(), withNames(["Folk"]));
  assert.ok("view" in same, JSON.stringify(same));
  assert.deepEqual(same.view.genre, ["Folk"]);
  assert.match(viewOf(w.graph(), withNames(["Jazz"])).why[0], /genres by name/);
  assert.ok("view" in viewOf(w.graph(), withNames([])), "an empty list of names refused");
});

test("the pieces: sources and formats, decades, Played", () => {
  assert.deepEqual(sourcesOf({ require: [15, 12], exclude: [] }), { source: ["qobuz", "tidal"], format: [] });
  assert.deepEqual(sourcesOf({ require: [1], exclude: [15, 12, 17, 4] }), { source: ["local"], format: ["FLAC", "!MPEG"] });
  assert.deepEqual(sourcesOf({ require: [], exclude: [12] }), { source: ["!tidal"], format: [] });
  assert.match(sourcesOf({ require: [17], exclude: [] }).why, /KKBox/);
  assert.match(sourcesOf({ require: [99], exclude: [] }).why, /Roon's 99/);
  assert.deepEqual(decadesOf(null), []);
  assert.deepEqual(decadesOf({ min: nullDate(1970, 0, 0), max: nullDate(1989, 12, 31) }), ["1970", "1980"]);
  assert.equal(decadesOf({ min: nullDate(1970, 0, 0), max: nullDate(1979, 12, 30) }), null);
  assert.equal(decadesOf({ min: nullDate(1970, 1, 0), max: nullDate(1979, 12, 31) }), null);
  assert.deepEqual([playedOf({ require: null, exclude: null }), playedOf({ require: null, exclude: 36500 }), playedOf({ require: 36500, exclude: null }),
    playedOf({ require: null, exclude: 90 }), playedOf({ require: null, exclude: 45 }), playedOf({ require: 30, exclude: null })],
  ["any", "never", "played", "3", null, null]);
});
