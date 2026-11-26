"use strict";
// ---------------------------------------------------------------------------
// A Smart Pick's album, found and added (lib/smart-picks/resolve.js, dev/design/smart-picks.md §11, 2.0.8-t9). The
// owner, 2026-11-26: "How can we avoid having to rely on Qobuz being logged in or used. With native mode can we
// replace this." The services' part moved out of index.js unchanged; its tests (v1.7.41, smartpicks-build.test.js)
// are ported here as they were.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPickAlbums } = require("../../lib/smart-picks/resolve");

const canon = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const QOBUZ = 256, TIDAL = 128, FILES = 1;
const HIT = (o) => Object.assign({ title: "Roon Album", artist: "Real Act", contentSource: QOBUZ, albumId: "4242", inLibrary: false }, o);

function resolver(opts) {
  opts = opts || {};
  const cache = new Map();
  const sets = [];
  const asked = { roon: [], qobuz: 0, tidal: 0, deezer: [], adds: [], asRoonOf: [] };
  const logs = [];
  const p = createPickAlbums({
    canon, ttlMs: 1000,
    sameAlbum: (a, b) => canon(a.title) === canon(b.title) && canon(a.artist) === canon(b.artist),
    cacheGet: (k) => (cache.has(k) ? cache.get(k) : null),
    cacheSet: (k, v) => { cache.set(k, v); sets.push(k); },
    native: () => (opts.roon === undefined ? null : { albumsBy: async (name) => {
      asked.roon.push(name);
      if (opts.roonThrows) throw opts.roonThrows;
      return opts.roon;
    } }),
    qobuz: { ready: () => opts.qobuz !== false, albums: async () => {
      asked.qobuz++;
      if (opts.qobuzThrows) throw opts.qobuzThrows;
      return opts.qobuzItems || [];
    } },
    tidal: { ready: () => opts.tidal === true,
      artists: async () => { asked.tidal++; if (opts.tidalThrows) throw opts.tidalThrows; return opts.tidalArtists || { items: [], total: 0 }; },
      albums: async () => (opts.tidalAlbums || { items: [] }).items },
    deezer: async (path) => { asked.deezer.push(path); if (opts.deezerThrows) throw opts.deezerThrows; return opts.deezer || { data: [] }; },
    libraryAdd: () => (opts.noAdd ? null : { add: async (w) => { asked.adds.push(w); if (opts.addThrows) throw opts.addThrows; return opts.added || { ok: true, via: "roon", state: "waiting" }; } }),
    asRoonOf: (profile, fn) => { asked.asRoonOf.push(profile); return fn(); },
    rateLimited: (e) => !!(e && e.code === 429),
    log: (l) => logs.push(l), error: (l) => logs.push(l),
  });
  return { p, cache, sets, asked, logs };
}

test("THE one for the owner: with native mode in use and no service signed in, the album is Roon's", async () => {
  const r = resolver({ qobuz: false, roon: { hits: [
    HIT({ title: "In the library", inLibrary: true }),
    HIT({ title: "Someone else's", artist: "Other Act" }),
    HIT({ title: "Own files", contentSource: FILES }),
    HIT({ title: "No id", albumId: null }),
    HIT({ title: "The one", contentSource: TIDAL }),
    HIT({ title: "Second", contentSource: QOBUZ }),
  ] }, deezer: { data: [{ title: "The One", artist: { name: "Real Act" }, cover_big: "https://cdn.invalid/c.jpg" }] } });
  const got = await r.p.find("Real Act");
  assert.deepEqual(got, { service: "tidal", id: "", title: "The one", artist: "Real Act", image: "https://cdn.invalid/c.jpg" },
    "not the first credited to the artist, outside the library, on a service with an AlbumId — or a service id kept that isn't one");
  assert.deepEqual(r.asked.roon, ["Real Act"]);
  assert.equal(r.asked.qobuz, 0);
  assert.deepEqual(r.sets, ["alb:realact"], "a found album wasn't kept");
  assert.deepEqual(r.p.ready(), true, "native mode in use, and the build would still be skipped");
  assert.deepEqual(r.p.tally(), { asked: 1, found: 1 });
  assert.deepEqual(r.p.tally(), { asked: 0, found: 0 }, "the tally isn't reset");
});

test("Roon's search with none of the artist's albums: a miss, kept; Rouen's own Qobuz is still asked where signed in", async () => {
  const none = resolver({ qobuz: false, roon: { hits: [HIT({ artist: "Other Act" })] } });
  assert.equal(await none.p.find("Real Act"), null);
  assert.deepEqual(none.sets, ["alb:realact"], "an answer with nothing wasn't kept as a miss");
  assert.deepEqual(none.p.tally(), { asked: 1, found: 0 });
  const both = resolver({ roon: { hits: [] }, qobuzItems: [{ id: "q1", title: "Q", artist: "Real Act", image: "" }] });
  assert.equal((await both.p.find("Real Act")).service, "qobuz");
});

test("Roon's search unable to answer: Rouen's Qobuz answers; with nothing else, nothing is kept", async () => {
  const fall = resolver({ roon: { error: "no room" }, qobuzItems: [{ id: "q1", title: "Q", artist: "Real Act", image: "" }] });
  assert.deepEqual(await fall.p.find("Real Act"), { service: "qobuz", id: "q1", title: "Q", artist: "Real Act", image: "" });
  assert.ok(fall.logs.some((l) => /didn't answer: no room/.test(l)), "why Roon's search didn't answer isn't said");
  const alone = resolver({ qobuz: false, roon: { error: "Native mode isn't connected to your server right now." } });
  assert.equal(await alone.p.find("Real Act"), null);
  assert.deepEqual(alone.sets, [], "a miss kept a week though nothing answered");
  assert.deepEqual(alone.p.tally(), { asked: 0, found: 0 });
});

test("a cover Deezer can't give, or a Deezer that fails: the album still, with no picture", async () => {
  const other = resolver({ qobuz: false, roon: { hits: [HIT()] }, deezer: { data: [{ title: "Different", artist: { name: "Real Act" }, cover_big: "x" }] } });
  assert.equal((await other.p.find("Real Act")).image, "");
  const fails = resolver({ qobuz: false, roon: { hits: [HIT()] }, deezerThrows: new Error("down") });
  assert.equal((await fails.p.find("Real Act")).title, "Roon Album");
});

test("nothing at all to find with: not ready", () => {
  assert.equal(resolver({ qobuz: false }).p.ready(), false);
  assert.equal(resolver({}).p.ready(), true);
  assert.equal(resolver({ qobuz: false, tidal: true }).p.ready(), true);
});

test("the add: through Add to library, as the pick's profile; a Roon album named by title and artist, no service id", async () => {
  const r = resolver({});
  assert.equal(await r.p.add({ service: "qobuz", id: "", title: "The one", artist: "Real Act" }, "Real Act", "2"), true);
  assert.deepEqual(r.asked.adds, [{ title: "The one", artist: "Real Act", service: "qobuz", albumId: null }]);
  assert.deepEqual(r.asked.asRoonOf, ["2"], "added as another profile's Roon profile");
  const svc = resolver({});
  await svc.p.add({ service: "tidal", id: "77", title: "T" }, "The Pick's Artist", "1");
  assert.deepEqual(svc.asked.adds, [{ title: "T", artist: "The Pick's Artist", service: "tidal", albumId: "77" }]);
});

test("the add refused, or failing: false and said; too many requests stops the build", async () => {
  const no = resolver({ added: { error: "Rouen isn't signed in to Qobuz", status: 409 } });
  assert.equal(await no.p.add({ service: "qobuz", id: "", title: "T" }, "A", "1"), false);
  assert.ok(no.logs.some((l) => /could not add "T" \(qobuz\): Rouen isn't signed in/.test(l)));
  const busy = resolver({ added: { error: "slow down", status: 429 } });
  await assert.rejects(() => busy.p.add({ service: "qobuz", id: "", title: "T" }, "A", "1"), (e) => e.code === 429);
  const threw = resolver({ addThrows: new Error("connection reset") });
  assert.equal(await threw.p.add({ service: "qobuz", id: "", title: "T" }, "A", "1"), false);
  assert.equal(await resolver({ noAdd: true }).p.add({ service: "qobuz", id: "", title: "T" }, "A", "1"), false);
  assert.equal(await resolver({}).p.add({ service: "deezer", id: "", title: "T" }, "A", "1"), false);
});

// ---------------------------------------------------------------------------
// Ported unchanged from smartpicks-build.test.js ("resolveSmartAlbum caches only what it actually learned", v1.7.41).
test("resolveSmartAlbum caches only what it actually learned", { concurrency: 1 }, async (t) => {
  await t.test("a miss with NO service consulted is not cached", async () => {
    // THE one. Caching here writes a week of dead negatives on a machine with
    // nothing connected, and the user who then connects Qobuz gets an empty
    // feature until the TTL expires.
    const r = resolver({ qobuz: false, tidal: false });
    assert.equal(await r.p.find("Nobody"), null);
    assert.deepEqual(r.sets, [], "a negative was cached without any service having answered");
  });

  await t.test("a miss after a service ANSWERED is cached", async () => {
    const r = resolver({ qobuzItems: [] });
    assert.equal(await r.p.find("Nobody"), null);
    assert.equal(r.sets.length, 1, "a real negative must be cached or it is refetched daily");
  });

  await t.test("a miss after a service THREW is not cached", async () => {
    // A one-minute token blip must not become a week-long hole.
    const r = resolver({ qobuzThrows: new Error("connection reset") });
    assert.equal(await r.p.find("Nobody"), null);
    assert.deepEqual(r.sets, []);
  });

  await t.test("a 429 propagates instead of being cached as a miss", async () => {
    const e = new Error("rate limited"); e.code = 429;
    const r = resolver({ qobuzThrows: e });
    await assert.rejects(() => r.p.find("Nobody"), /rate limited/);
    assert.deepEqual(r.sets, []);
  });

  await t.test("a hit is cached and served from cache next time", async () => {
    const r = resolver({ qobuzItems: [{ id: 1, title: "A", artist: "Real Act", image: "" }] });
    const first = await r.p.find("Real Act");
    assert.equal(first.service, "qobuz");
    const before = r.sets.length;
    const second = await r.p.find("Real Act");
    assert.equal(second.title, "A");
    assert.equal(r.sets.length, before, "the cached answer was refetched");
  });

  await t.test("an artist Qobuz does not credit is rejected", async () => {
    // Qobuz search matches on title too, so an unfiltered top hit is often a
    // different act. Picking it would credit the wrong artist on the card.
    const r = resolver({ qobuzItems: [{ id: 1, title: "Tribute", artist: "Someone Else", image: "" }] });
    assert.equal(await r.p.find("Real Act"), null);
  });

  await t.test("TIDAL's paged shape is read correctly", async () => {
    // searchArtists returns { items, total }, not an array. Treating it as an
    // array threw on every lookup, which made Smart Picks permanently empty
    // for anyone without Qobuz.
    const r = resolver({
      qobuz: false, tidal: true,
      tidalArtists: { items: [{ id: 7, name: "Real Act" }], total: 1 },
      tidalAlbums:  { items: [{ id: 9, title: "TA", artist: "Real Act", image: "" }], total: 1 },
    });
    const got = await r.p.find("Real Act");
    assert.ok(got, "the TIDAL path returned nothing — it is misreading the paged wrapper");
    assert.equal(got.service, "tidal");
  });

  await t.test("an unrecognisable artist name never reaches the network", async () => {
    const r = resolver({ qobuzItems: [{ id: 1, title: "X", artist: "!!!", image: "" }], roon: { hits: [] } });
    assert.equal(await r.p.find("!!!"), null);
    assert.deepEqual(r.sets, []);
    assert.deepEqual(r.asked.roon, [], "Roon's search was asked for a name with nothing in it");
  });
});
