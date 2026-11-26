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
    albumKey: (t, a) => (canon(t) ? canon(t) + "|" + canon(a) : null),
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
    signedIn: (service) => (opts.signedIn || []).includes(service),
    favourite: async (service, id) => { (asked.favourites = asked.favourites || []).push(service + ":" + id); },
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
  assert.deepEqual(r.p.tally(), { asked: 1, found: 1, heard: 1 });
  assert.deepEqual(r.p.tally(), { asked: 0, found: 0, heard: 0 }, "the tally isn't reset");
});

test("Roon's search with none of the artist's albums: a miss, kept; Rouen's own Qobuz is still asked where signed in", async () => {
  const none = resolver({ qobuz: false, roon: { hits: [HIT({ artist: "Other Act" })] } });
  assert.equal(await none.p.find("Real Act"), null);
  assert.deepEqual(none.sets, ["alb-roon:realact"], "an answer with nothing wasn't kept as Roon's miss, or was kept as the services' too");
  assert.deepEqual(none.p.tally(), { asked: 1, found: 0, heard: 1 });
  assert.equal(await none.p.find("Real Act"), null);
  assert.deepEqual(none.asked.roon, ["Real Act"], "Roon's kept miss asked again");
  const both = resolver({ roon: { hits: [] }, qobuzItems: [{ id: "q1", title: "Q", artist: "Real Act", image: "" }] });
  assert.equal((await both.p.find("Real Act")).service, "qobuz");
});

test("Roon's search unable to answer: Rouen's Qobuz answers; with nothing else, nothing is kept", async () => {
  const fall = resolver({ roon: { error: "no room" }, qobuzItems: [{ id: "q1", title: "Q", artist: "Real Act", image: "" }] });
  assert.deepEqual(await fall.p.find("Real Act"), { service: "qobuz", id: "q1", title: "Q", artist: "Real Act", image: "" });
  assert.ok(fall.logs.some((l) => /didn't answer: no room/.test(l)), "why Roon's search didn't answer isn't said");
  const alone = resolver({ qobuz: false, roon: { error: "Native mode isn't connected to your server right now." } });
  assert.equal(await alone.p.find("Real Act"), null);
  assert.equal(await alone.p.find("Other Act"), null);
  assert.deepEqual(alone.sets, [], "a miss kept a week though nothing answered");
  assert.deepEqual(alone.p.tally(), { asked: 0, found: 0, heard: 0 }, "a build that heard nothing would be kept as the day's answer");
  assert.equal(alone.logs.filter((l) => /didn't answer/.test(l)).length, 1, "the same why said for every candidate");
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

test("Roon's miss kept on its own: Rouen's Qobuz, signed in later, is still asked (the review)", async () => {
  const cache = new Map();
  const first = resolver({ qobuz: false, roon: { hits: [] } });
  assert.equal(await first.p.find("Real Act"), null);
  for (const k of first.sets) cache.set(k, first.cache.get(k));
  const later = resolver({ roon: { hits: [] }, qobuzItems: [{ id: "q1", title: "Q", artist: "Real Act", image: "" }] });
  for (const [k, v] of cache) later.cache.set(k, v);
  assert.equal((await later.p.find("Real Act")).id, "q1", "THE one: Roon's miss hid the album Qobuz has for a week");
  assert.deepEqual(later.asked.roon, [], "Roon's kept miss asked again");
});

test("a server whose searches never give a TIDAL or Qobuz album: native mode isn't taken as something to find albums with", async () => {
  const r = resolver({ qobuz: false, roon: { hits: [HIT({ contentSource: FILES })] } });
  assert.equal(r.p.ready(), true);
  for (let i = 0; i < 10; i++) await r.p.find("Act " + i);
  assert.equal(r.p.ready(), false, "THE one: a server of its own files only kept Smart Picks building nothing, saying it can");
  assert.ok(r.logs.some((l) => /no streaming service/.test(l)));
  const some = resolver({ qobuz: false, roon: { hits: [HIT({ artist: "Someone Else" })] } });
  for (let i = 0; i < 12; i++) await some.p.find("Act " + i);
  assert.equal(some.p.ready(), true, "a server with a service, whose searches found other artists', said to have none");
});

test("a profile with no Roon profile: the service favourite, as before, where Rouen is signed in and has the id (the review)", async () => {
  const WHY = require("../../lib/roon-direct/session").WHY_NOBODY;
  const r = resolver({ added: { error: WHY, status: 409 }, signedIn: ["qobuz"] });
  assert.equal(await r.p.add({ service: "qobuz", id: "q9", title: "T" }, "A", "1"), true);
  assert.deepEqual(r.asked.favourites, ["qobuz:q9"], "THE one: no add at all for a profile with no Roon profile");
  const noId = resolver({ added: { error: WHY, status: 409 }, signedIn: ["qobuz"] });
  assert.equal(await noId.p.add({ service: "qobuz", id: "", title: "T" }, "A", "1"), false);
  const out = resolver({ added: { error: WHY, status: 409 } });
  assert.equal(await out.p.add({ service: "qobuz", id: "q9", title: "T" }, "A", "1"), false);
  assert.equal(out.asked.favourites, undefined);
});

test("an answer kept from before counts as answered: a day whose every candidate was cached isn't built again and again", async () => {
  const r = resolver({ qobuzItems: [] });
  await r.p.find("Nobody");
  r.p.tally();
  await r.p.find("Nobody");
  assert.equal(r.p.tally().heard, 1, "THE one: a cached miss counted as nothing heard");
  assert.equal(r.asked.qobuz, 1);
});

test("a quote in a title or credit doesn't break Deezer's search for the cover", async () => {
  const r = resolver({ qobuz: false, roon: { hits: [HIT({ title: 'The "Chirping" Crickets' })] } });
  await r.p.find("Real Act");
  assert.ok(!/%22Chirping%22/.test(r.asked.deezer[0]), "the title's own quotes sent inside the search's");
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
