"use strict";
// ---------------------------------------------------------------------------
// "Add to library" (lib/library-add.js, v1.9.41, native-remote.md §9.2): your
// server's own add with native mode on; with it off, or when it couldn't send
// the add, the album a favourite on the service with Rouen's own sign-in (the
// owner, 2026-10-21). The adder and the services are stubs here: the adder's
// own tests run it over the link (roon-direct-add.test.js).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLibraryAdd, mountLibraryAdd } = require("../../lib/library-add");
const { createServiceFavourites, mountServiceFavourites } = require("../../lib/routes/service-favourites");

const key = (t, a) => `${t.toLowerCase()}||${a.toLowerCase()}`;

function rig(o = {}) {
  const calls = { adds: [], favourites: [], searches: [] };
  const library = new Map(Object.entries(o.library || {}));
  calls.forgotten = [];
  // Native mode off: the adder says so, and nothing else (adder.js).
  const adder = {
    async add(w) { calls.adds.push(w); return o.native === false ? { off: true } : o.adderSays || { state: "waiting", via: "roon", from: "tidal" }; },
    state: (t, a) => (o.adderState ? o.adderState(t, a) : { state: "none" }),
    forget: (t, a) => { calls.forgotten.push([t, a]); },
  };
  // Each service's search, answering as the service does: Qobuz's albums under `albums`, TIDAL's at the top.
  const search = (service) => async (q) => { calls.searches.push([service, q]); const items = o.found || []; return service === "qobuz" ? { albums: { items } } : { items }; };
  const la = createLibraryAdd({
    adder: () => adder,
    inLibrary: (t, a) => (library.has(key(t, a)) ? library.get(key(t, a)) : null),
    signedIn: (service) => (o.signedIn ? o.signedIn.includes(service) : true),
    favourite: async (service, id) => { calls.favourites.push([service, id]); if (o.favouriteFails) throw Object.assign(new Error("Qobuz said no"), { status: 429 }); },
    searchQobuz: search("qobuz"), searchTidal: search("tidal"),
    wanted: (t, a) => [key(t, a)], titleForms: (t, v) => (v ? [t, t + " " + v] : [t]), keyOf: key,
    errorStatus: (e) => e.status || 502,
  });
  return { la, calls };
}
const EVIL = { title: "Evil Twin", artist: "Green Eyes, Witch Hands", service: "tidal", albumId: null };

test("THE one: native mode on adds through your server, and no service favourite is made", async () => {
  const { la, calls } = rig();
  assert.deepEqual(await la.add(EVIL), { ok: true, via: "roon", state: "waiting", from: "tidal" });
  assert.deepEqual(calls.adds, [{ title: "Evil Twin", artist: "Green Eyes, Witch Hands", service: "tidal" }]);
  assert.deepEqual(calls.favourites, [], "a service favourite as well as the add");
  // The other service's copy added (v1.9.44): which one is passed on, for the page to say.
  const other = rig({ adderSays: { state: "waiting", via: "roon", from: "qobuz" } });
  assert.equal((await other.la.add(EVIL)).from, "qobuz");
});

test("an add native mode couldn't send falls back to the service favourite, found by the service's own search, and says why", async () => {
  const { la, calls } = rig({ adderSays: { notSent: "Your server's search didn't find this album on TIDAL." },
    // As TIDAL sends them: the lead artist, and every credited one.
    found: [{ id: 111, title: "Evil Twin", version: "Live", artist: { name: "Someone Else" } },
      { id: 222, title: "Evil Twin", artists: [{ name: "Green Eyes, Witch Hands" }] }] });
  const out = await la.add(EVIL);
  assert.deepEqual(out, { ok: true, via: "service", state: "waiting", why: "Your server's search didn't find this album on TIDAL." });
  assert.deepEqual(calls.searches, [["tidal", "Evil Twin Green Eyes, Witch Hands"]]);
  assert.deepEqual(calls.favourites, [["tidal", "222"]], "not the album of that title and artist");
  // A native add tried before and not taken no longer speaks for it (the review).
  assert.deepEqual(calls.forgotten, [["Evil Twin", "Green Eyes, Witch Hands"]]);
  assert.deepEqual(la.state("Evil Twin", "Green Eyes, Witch Hands"), { state: "waiting", via: "service" });
});

test("native mode off: today's way, by the id the pick already has, no search; no why to give", async () => {
  const { la, calls } = rig({ native: false });
  assert.deepEqual(await la.add(Object.assign({}, EVIL, { service: "qobuz", albumId: "q42" })), { ok: true, via: "service", state: "waiting", why: null });
  assert.deepEqual(calls.favourites, [["qobuz", "q42"]]);
  assert.deepEqual(calls.searches, []);
});

test("nothing to add: an album in the library, or one neither way can add — each said", async () => {
  const inLib = rig({ library: { [key("Evil Twin", "Green Eyes, Witch Hands")]: { offset: 41, title: "Evil Twin (Deluxe)", subtitle: "Green Eyes, Witch Hands" } } });
  // Where, and under Roon's own strings, which the album view opens it by.
  assert.deepEqual(await inLib.la.add(EVIL), { ok: true, state: "in-library", offset: 41, library_title: "Evil Twin (Deluxe)", library_subtitle: "Green Eyes, Witch Hands" });
  assert.deepEqual([inLib.calls.adds, inLib.calls.favourites], [[], []]);
  const signedOut = rig({ adderSays: { notSent: "Native mode isn't connected to your server right now." }, signedIn: [] });
  const out = await signedOut.la.add(EVIL);
  assert.equal(out.status, 409);
  assert.match(out.error, /^Native mode isn't connected .* Rouen isn't signed in to TIDAL/);
  const notFound = rig({ native: false, found: [] });
  assert.deepEqual(await notFound.la.add(EVIL), { error: "TIDAL's own search didn't find this album.", status: 404 });
  // Your server's search has it in your library, under a name Rouen's copy doesn't match: nothing added, and said.
  const owned = rig({ adderSays: { state: "in-library" } });
  assert.deepEqual(await owned.la.add(EVIL), { ok: true, via: "roon", state: "in-library" });
  assert.deepEqual(owned.calls.favourites, []);
  const refused = rig({ native: false, favouriteFails: true });
  assert.deepEqual(await refused.la.add(Object.assign({}, EVIL, { albumId: "9" })), { error: "Qobuz said no", status: 429 });
});

test("where an album stands: your server's add first, then the library, then a service favourite made here", async () => {
  const { la } = rig({ adderState: (t) => (t === "Sent" ? { state: "not-taken" } : { state: "none" }), library: { [key("Owned", "X")]: { offset: 7, title: "Owned", subtitle: "X" } } });
  assert.deepEqual(la.state("Sent", "X"), { via: "roon", state: "not-taken" });
  assert.deepEqual(la.state("Owned", "X"), { state: "in-library", offset: 7, library_title: "Owned", library_subtitle: "X" });
  assert.deepEqual(la.state("Other", "X"), { state: "none" });
});

test("the routes: a malformed request is 400; the add and its state answered; the favourite routes as before the move", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountLibraryAdd(app, rig().la);
  const set = [];
  mountServiceFavourites(app, createServiceFavourites({ qobuz: async (id, on) => { set.push(["qobuz", id, on]); }, tidal: async (id, on) => { set.push(["tidal", id, on]); } }), () => 502);
  const call = async (k, req) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](req, res);
    return res;
  };
  assert.equal((await call("POST /api/library/add", { body: { title: "X", artist: "Y", service: "spotify" } })).code, 400);
  assert.equal((await call("POST /api/library/add", { body: { title: " ", artist: "Y", service: "tidal" } })).code, 400);
  const ok = await call("POST /api/library/add", { body: { title: "Evil Twin", artist: "Green Eyes, Witch Hands", service: "tidal" } });
  assert.deepEqual([ok.code, ok.body], [200, { ok: true, via: "roon", state: "waiting", from: "tidal" }]);
  assert.deepEqual((await call("GET /api/library/add", { query: { title: "Evil Twin", artist: "Green Eyes, Witch Hands" } })).body, { state: "none" });
  assert.deepEqual((await call("POST /api/qobuz/favorite", { body: {} })).body, { ok: false, error: "album_id required" });
  assert.deepEqual((await call("POST /api/tidal/unfavorite", { body: { album_id: " 5 " } })).body, { ok: true });
  assert.deepEqual((await call("POST /api/qobuz/favorite", { body: { album_id: 6 } })).body, { ok: true });
  assert.deepEqual(set, [["tidal", "5", false], ["qobuz", "6", true]]);
});
