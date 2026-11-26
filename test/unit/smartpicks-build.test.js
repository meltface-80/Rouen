"use strict";
// ---------------------------------------------------------------------------
// v1.7.41: the Smart Picks build loop and the album resolver.
//
// smartpicks.test.js covers the selection POLICY; this covers the loop that
// spends money on it. Everything here is about not hammering somebody's
// streaming account:
//
//   1. THE RESOLVE LOOP IS CAPPED. Every candidate TRIED costs a search whether
//      or not it becomes a pick, so the pool size is not the bound. A day with
//      an expired token would otherwise walk the whole pool, then every outside
//      genre times its whole roster — thousands of live calls against the
//      UNOFFICIAL Qobuz/TIDAL APIs, on the same account the favourites and the
//      source badges depend on.
//   2. A NEGATIVE IS ONLY CACHED WHEN A SERVICE ACTUALLY ANSWERED. Caching "no
//      album" after consulting nothing writes a week of dead entries, and the
//      user who then connects Qobuz gets an empty feature with no way to tell
//      why.
//   3. AN EMPTY HUB CHART ABORTS. With no hubs the seed filter stops filtering
//      and the feature seeds from the library's most famous artists — the exact
//      inversion it exists to avoid, silently.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");

// The pure helpers are EXTRACTED so the loop runs against the shipping policy;
// only I/O and state are injected.
// The candidates' helpers moved to lib/smart-picks/rank.js, and the seeds to seeds.js (2.0.6-t22): required, not extracted.
const RANK = require("../../lib/smart-picks/rank");
const { whyOf } = require("../../lib/smart-picks/seeds");
// Tune (2.0.7-t1): the build reads it once, for the seeds, the ranking and Why these picks.
const { defaultTune, halfLifeOf, describeTune } = require("../../lib/smart-picks/tune");
const SHARED = [
  "smartRateLimited", "smartAdjacentCount",
  "smartSeedCount", "smartPoolCount", "smartPickKinds",
  "smartMaxResolves", "smartAlbumTtlMs", "smartAttemptKey", "smartAttemptedToday",
  "normalize", "canonText", "canonArtist",
];
// The build tests inject resolveSmartAlbum (to count its calls); the resolver moved to lib/smart-picks/resolve.js
// (2.0.8-t9), and its tests to smart-picks-resolve.test.js.
const BUILD_FNS   = ["buildSmartPicks", "buildSmartPicksFor"].concat(SHARED);   // each active profile's (2.0.7-t3)

// A build harness. `opts` overrides any injected dependency; the counters it
// returns are what the assertions read.
function harness(opts) {
  opts = opts || {};
  const calls = { resolves: [], cacheSets: [], persisted: null, autoAdded: [], later: [], logs: [], errors: [], asRoonOf: [] };
  const cache = new Map(Object.entries(opts.cache || {}));

  const candidates = opts.candidates !== undefined ? opts.candidates
    : Array.from({ length: 60 }, (_, i) => ({
        mbid: "mb" + i, name: "Cand " + i, score: 1000 - i, seed: "s" + (i % 6)
      }));

  const inj = {
    DEBUG: false,
    console: {
      log:   (m) => calls.logs.push(String(m)),
      error: (m) => calls.errors.push(String(m))
    },
    albumIndex: opts.profile && !opts.profile.size ? { albums: [], builtAt: 1, count: 0 } : { albums: new Array(1000), builtAt: 1, count: 1000 },

    smartCachePrune: () => {},
    smartCacheGet: (k, ttl) => (cache.has(k) ? cache.get(k) : null),
    smartCacheSet: (k, v) => { cache.set(k, v); calls.cacheSets.push(k); },

    smartPicksServiceReady: () => opts.serviceReady !== false,
    smartNoServiceSaid: "",
    // What Roon's search answered in the build (smart-picks.md §11), for its log line.
    pickAlbums: { tally: () => opts.roonTally || { asked: 0, found: 0 } },
    qobuzReady: () => opts.qobuzReady !== false,
    tidalReady: () => opts.tidalReady === true,

    // The seeds (lib/smart-picks/seeds.js, tested in smart-picks-seeds.test.js): these three, or none.
    ...RANK, whyOf, halfLifeOf, describeTune,
    smartTune: () => opts.tune || defaultTune(),
    // One active profile unless a test says more; none has today's picks yet (2.0.7-t3).
    // asRoonOf (2.0.7-t5): a profile's pick put aside as its devices act in Roon; noted, so the test sees whose.
    profiles: { picksProfiles: () => opts.profiles || ["1"], asRoonOf: (p, fn) => { calls.asRoonOf.push(p); return fn(); } },
    ...require("../../lib/smart-picks/daily"),   // buildEach: each profile in turn (moved out of index.js)
    readSmartPicks: (day, p) => (opts.builtFor || []).includes(p) ? [{}] : [],
    smartSeedsFor: (hubs, tune, profile) => (calls.seedTune = tune, (calls.seedsFor = calls.seedsFor || []).push(profile), { seeds: [...(opts.profile || new Map([
      ["seeda", { canon: "seeda", name: "Seed A" }], ["seedb", { canon: "seedb", name: "Seed B" }], ["seedc", { canon: "seedc", name: "Seed C" }],
    ])).values()].map((r) => Object.assign({ score: 1, albumPlays: 1, recentPlays: 1, tracks: 0, hub: false, albums: [], genre: "Jazz", decade: "1970s", via: "listening" }, r)),
    left: [], slots: new Map([["Jazz", 3]]) }),
    smartHubSet: async () => new Set(opts.hubs !== undefined ? opts.hubs : ["famousact"]),
    linkableArtistSet: () => new Set(["seeda", "seedb", "seedc"]),
    smartBlockedSet: (p) => ((calls.setsFor = calls.setsFor || []).push("blocked:" + p), new Set(opts.blocked || [])),
    smartSeenSet: (p) => ((calls.setsFor = calls.setsFor || []).push("seen:" + p), new Set(opts.seen || [])),

    fetchArtistMbid: async (name) => (opts.noMbid ? null : "mbid-" + name.toLowerCase().replace(/ /g, "")),
    smartSimilarRows: async () => candidates,

    resolveSmartAlbum: async (name) => {
      calls.resolves.push(name);
      if (opts.resolveThrows) throw opts.resolveThrows;
      return opts.resolveAll === false ? null
        : { service: "qobuz", id: "id" + calls.resolves.length, title: "T", image: "" };
    },
    // v1.7.42: the five genre picks are favourited at build time so Roon can
    // import them overnight. Recorded here so the tests can prove WHICH picks
    // get that treatment.
    // v1.8.67: a destination rather than a switch. `autoAdd: false` is the
    // old "off", which is "ask" now.
    smartPicksDest: opts.dest || (opts.autoAdd === false ? "ask" : "library"),
    autoAddSmartAlbum: async (album, artist, profile) => { calls.autoAdded.push(album.id); (calls.addedAs = calls.addedAs || []).push(artist + "@" + profile); return true; },
    // The list in force (lib/routes/listen-later.js put, v1.9.45): Roon's with native mode on, else Rouen's.
    listenLater: { put: async (entry) => { calls.later.push(entry); } },
    persistSmartPicks: (day, picks, profile) => { calls.persisted = picks; (calls.persistedFor = calls.persistedFor || []).push(profile); },
  };
  return { F: loadIndexFunctions(BUILD_FNS, Object.assign(inj, opts.inject || {})), calls, cache };
}

// ---------------------------------------------------------------------------
test("the build is bounded in how many lookups it makes", { concurrency: 1 }, async (t) => {
  await t.test("a day where nothing resolves stops at the resolve cap", async () => {
    // THE one. Without the cap this walks all 60 candidates (150 in production)
    // and then every outside genre times its whole roster.
    const h = harness({ resolveAll: false });
    await h.F.buildSmartPicks("2026-08-05");
    const adjacentTries = h.calls.resolves.filter(n => n.startsWith("Cand ")).length;
    assert.equal(adjacentTries, h.F.smartMaxResolves(),
      "the adjacent loop made " + adjacentTries + " lookups — it is walking the " +
      "whole pool rather than stopping at the cap");
  });

  await t.test("a normal day stops as soon as it has its picks", async () => {
    // The cap is a backstop, not the usual path: when candidates resolve, the
    // loop must stop at five and not keep spending.
    const h = harness({});
    await h.F.buildSmartPicks("2026-08-05");
    const adjacentTries = h.calls.resolves.filter(n => n.startsWith("Cand ")).length;
    assert.equal(adjacentTries, h.F.smartAdjacentCount());
    assert.equal(h.calls.persisted.filter(p => p.kind === "adjacent").length, 5);
    assert.equal(h.calls.persisted.length, 5, "a kind other than adjacent was built");
  });

  await t.test("Why these picks is kept with the picks it explains, never for a build that kept none (2.0.6-t22)", async () => {
    const h = harness({});
    await h.F.buildSmartPicks("2026-08-05");
    const why = h.cache.get("why:1");
    assert.ok(why, "no why kept for the day's picks");
    assert.deepEqual([why.day, why.seeds.map((s) => s.name)], ["2026-08-05", ["Seed A", "Seed B", "Seed C"]]);
    const none = harness({ noMbid: true, cache: { "why:1": { day: "yesterday" } } });
    await none.F.buildSmartPicks("2026-08-05");
    assert.deepEqual(none.cache.get("why:1"), { day: "yesterday" }, "THE one (the review): today's seeds beside yesterday's picks");
  });

  await t.test("the Tune reaches the seeds, the ranking and Why these picks (2.0.7-t1)", async () => {
    // Far (before Tune): the candidate reached from one seed first. Close: the one reached from three.
    const candidates = [{ mbid: "one", name: "Lone", score: 900, seed: "s0" },
      ...["s0", "s1", "s2"].map((seed) => ({ mbid: "three", name: "Crowd", score: 500, seed }))];
    const far = harness({ candidates, tune: Object.assign(defaultTune(), { adventure: 4 }) });
    await far.F.buildSmartPicks("2026-08-05");
    assert.equal(far.calls.resolves[0], "Lone");
    const tune = Object.assign(defaultTune(), { adventure: 0, window: 4, genres: { Jazz: "more" } });
    const close = harness({ candidates, tune });
    await close.F.buildSmartPicks("2026-08-05");
    assert.equal(close.calls.resolves[0], "Crowd", "THE one: Adventure never reached the ranking");
    assert.equal(close.calls.seedTune, tune, "the seeds weren't chosen with the Tune");
    const why = close.cache.get("why:1");
    assert.deepEqual(why.tuned, ["Listening window: All time", "Adventure: Close", "Jazz: More"]);
    assert.equal(why.numbers.halfLifeDays, null);
    assert.deepEqual(why.picks.map((p) => p.artist), ["Crowd", "Lone"]);
    assert.ok(why.picks.every((p) => Array.isArray(p.seeds)), "a pick's starting artists weren't kept for its More / Never");
  });
});

// ---------------------------------------------------------------------------
// v1.7.42. The picks are favourited at build time so Roon has all night to
// import them and they simply play by morning. v1.7.48 removed the sixth
// "stretch" pick, which was the one exception to this — it was never
// auto-added because it was the one the user was meant to judge.
// ---------------------------------------------------------------------------
test("picks are added automatically when the setting says so", { concurrency: 1 }, async (t) => {
  await t.test("the five picks are auto-added", async () => {
    const h = harness({});
    await h.F.buildSmartPicks("2026-08-05");
    const adjacent = h.calls.persisted.filter(p => p.kind === "adjacent");
    assert.equal(adjacent.length, 5);
    assert.equal(h.calls.autoAdded.length, 5,
      "the genre picks were not added, so Roon has nothing to import and they " +
      "cannot be ready to play");
    assert.ok(adjacent.every(p => p.autoAdded === true));
  });

  await t.test("the setting turns auto-add off for everything", async () => {
    const h = harness({ autoAdd: false });
    await h.F.buildSmartPicks("2026-08-05");
    assert.deepEqual(h.calls.autoAdded, [],
      "auto-add ran despite the setting being off");
    assert.equal(h.calls.persisted.length, 5, "the picks themselves must still be built");
    assert.deepEqual(h.calls.later, [], "\"ask\" put picks on Listen later");
  });

  // v1.8.67, asked for by a user: picks set aside WITHOUT touching the
  // streaming library. Both halves matter — sent to Listen later, and NOT
  // favourited, or the setting is "library plus a list".
  await t.test("the Listen later destination puts every pick aside and favourites none", async () => {
    const h = harness({ dest: "later" });
    await h.F.buildSmartPicks("2026-08-05");
    assert.equal(h.calls.persisted.length, 5, "the picks themselves must still be built");
    assert.deepEqual(h.calls.autoAdded, [],
      "picks sent to Listen later were favourited on the service as well");
    assert.equal(h.calls.later.length, 5, "not every pick went to Listen later");
    for (const e of h.calls.later) {
      assert.equal(e.source, "picks");
      assert.equal(e.service, "qobuz", "the entry lost the service it can be added from");
      assert.ok(e.album_id, "the entry lost the album id it can be added from");
      assert.ok(e.title, "the entry has no album title");
      assert.equal(e.profile, "1", "2.0.7-t5: the pick not put aside as its profile's (profiles.md §12)");
    }
    assert.deepEqual(h.calls.asRoonOf, ["1", "1", "1", "1", "1"], "not put aside as its profile's devices act in Roon (a linked one's own list)");
  });

  await t.test("the library destination does not also fill Listen later", async () => {
    const h = harness({ dest: "library" });
    await h.F.buildSmartPicks("2026-08-05");
    assert.equal(h.calls.autoAdded.length, 5);
    assert.deepEqual(h.calls.later, []);
  });

  await t.test("a build a Tune change asked for favourites nothing, even to the library; Listen later is unchanged (2.0.7-t1)", async () => {
    const h = harness({ dest: "library" });
    await h.F.buildSmartPicks("2026-08-05", { tuned: true });
    assert.deepEqual(h.calls.autoAdded, [], "THE one (the owner: \"Show, don't add\"): each Tune tap favourited five albums");
    assert.equal(h.calls.persisted.length, 5, "its picks still shown, with Add");
    const later = harness({ dest: "later" });
    await later.F.buildSmartPicks("2026-08-05", { tuned: true });
    assert.equal(later.calls.later.length, 5);
  });
});

// ---------------------------------------------------------------------------
test("an empty hub chart aborts rather than degrading silently",
  { concurrency: 1 }, async (t) => {
    await t.test("no picks are built and nothing is persisted", async () => {
      // With no hubs, the famous seed at full weight and famous candidates are
      // no longer rejected (lib/smart-picks/seeds.js, smart-picks.md §3.2). A day
      // with no picks is recoverable; a day of picks that discredit the feature
      // is not.
      const h = harness({ hubs: [] });
      await h.F.buildSmartPicks("2026-08-05");
      assert.equal(h.calls.persisted, null, "picks were built from an unfiltered seed list");
      assert.equal(h.calls.resolves.length, 0, "it spent lookups anyway");
      assert.ok(h.calls.errors.some(m => /chart came back empty/i.test(m)),
        "the abort was silent — nothing in the log says why there are no picks");
    });

    await t.test("a populated chart proceeds normally", () => {
      // Mutation guard: an abort that always fired would pass the test above.
      return harness({}).F.buildSmartPicks("2026-08-05").then(function () {});
    });
  });

// ---------------------------------------------------------------------------
test("a build that cannot possibly work does not run", { concurrency: 1 }, async (t) => {
  await t.test("nothing to find albums with — skipped, NOT marked, said once (smart-picks.md §11, 2.0.8-t9)", async () => {
    // THE one for the owner (2026-11-26): a day marked tried with no service stayed empty after Qobuz was signed in.
    // kickSmartPicks starts no job while nothing is ready, so the unmarked day costs nothing until one is.
    const h = harness({ serviceReady: false });
    await h.F.buildSmartPicks("2026-08-05");
    assert.equal(h.calls.resolves.length, 0);
    assert.equal(h.cache.has(h.F.smartAttemptKey("2026-08-05", "1")), false,
      "the day was marked tried, so a service or native mode up later the same day builds nothing till tomorrow");
    assert.equal(h.calls.logs.filter((m) => /neither native mode nor a streaming service/.test(m)).length, 1);
  });

  await t.test("an empty library is NOT marked attempted", async () => {
    // Different case, deliberately: the library is still arriving, so today
    // should be retried once it has. Marking it would lose the whole first day.
    const h = harness({ profile: new Map() });
    await h.F.buildSmartPicks("2026-08-05");
    assert.equal(h.cache.has(h.F.smartAttemptKey("2026-08-05", "1")), false);
  });

  await t.test("a completed build marks the day even when it found nothing", async () => {
    // Otherwise "did we build today?" is answered by "are there rows?", and a
    // zero-pick day re-runs the entire pipeline on every request.
    const h = harness({ resolveAll: false });
    await h.F.buildSmartPicks("2026-08-05");
    assert.ok(h.cache.has(h.F.smartAttemptKey("2026-08-05", "1")));
  });
});

// ---------------------------------------------------------------------------
test("rate limiting stops the build instead of pushing harder",
  { concurrency: 1 }, async (t) => {
    await t.test("a 429 ends the build and keeps what resolved first", async () => {
      const e = new Error("rate limited"); e.code = 429;
      let n = 0;
      const h = harness({ inject: { resolveSmartAlbum: async (name) => {
        if (++n > 2) throw e;
        return { service: "qobuz", id: "x" + n, title: "T", image: "" };
      } } });
      await h.F.buildSmartPicks("2026-08-05");
      assert.ok(Array.isArray(h.calls.persisted), "the build threw instead of stopping");
      assert.equal(h.calls.persisted.length, 2, "it discarded the picks it already had");
      assert.ok(h.calls.errors.some(m => /rate limited/i.test(m)));
    });

    await t.test("a non-429 failure is not swallowed as a rate limit", async () => {
      // A programming error inside the loop must surface, not be quietly
      // reported as "the service is busy".
      const h = harness({ resolveThrows: new TypeError("x.find is not a function") });
      await assert.rejects(() => h.F.buildSmartPicks("2026-08-05"), /not a function/);
    });
  });

test("each active profile gets its own build; one built today is left alone; a rebuild builds its profile only (2.0.7-t3)", async () => {
  const h = harness({ profiles: ["1", "2", "3"], builtFor: ["2"] });
  await h.F.buildSmartPicks("2026-08-05");
  assert.deepEqual(h.calls.persistedFor, ["1", "3"], "THE one: one set for everyone, or a profile's set of today replaced");
  assert.deepEqual(h.calls.seedsFor, ["1", "3"], "the seeds weren't each profile's own");
  assert.deepEqual(h.calls.setsFor, ["blocked:1", "seen:1", "blocked:3", "seen:3"], "one profile's Not for me or seen used for another");
  assert.ok(h.cache.has("why:1") && h.cache.has("why:3") && !h.cache.has("why:2"));
  const one = harness({ profiles: ["1", "2"], builtFor: ["1", "2"] });
  await one.F.buildSmartPicks("2026-08-05", { profile: "2", tuned: true });
  assert.deepEqual(one.calls.persistedFor, ["2"], "a profile's Rebuild rebuilt another's set too");
});

test("a pick added is added as its own profile, by its artist; the log says what Roon's search found (smart-picks.md §11)", async () => {
  const h = harness({ profiles: ["2"], roonTally: { asked: 7, found: 5 } });
  await h.F.buildSmartPicks("2026-08-05");
  assert.deepEqual(h.calls.addedAs, ["Cand 0@2", "Cand 1@2", "Cand 2@2", "Cand 3@2", "Cand 4@2"], "THE one: added as another profile, or without its artist");
  assert.ok(h.calls.logs.some((m) => /Roon's search found an album for 5 of 7\)/.test(m)), "the build's log line doesn't say what Roon's search found");
});

test("nothing to find albums with: no build job is started, unless asked for by hand (smart-picks.md §11)", () => {
  // The day isn't marked tried with nothing ready, so without this every Home visit and timer tick queued a job, and
  // each job's finish bumped picksVersion, which wakes the screens to ask — and kick — again.
  const kick = (ready) => {
    const jobs = [];
    const F = loadIndexFunctions(["kickSmartPicks"], {
      smartPicksEnabled: true, smartDayKey: () => "2026-08-05", _smartBuilding: null, picksVersion: 0,
      smartPicksServiceReady: () => ready, profiles: { picksProfiles: () => ["1"] }, readSmartPicks: () => [],
      smartAttemptedToday: () => false, smartPicksDue: () => true, buildSmartPicks: () => {},
      bgRun: (why) => { jobs.push(why); return Promise.resolve(); },
    });
    F.kickSmartPicks("requested");
    F.kickSmartPicks("rebuild", true);
    return jobs;
  };
  assert.deepEqual(kick(false), ["smart picks (rebuild)"], "THE one: a job started with nothing to find albums with");
  assert.deepEqual(kick(true), ["smart picks (requested)"]);
});
