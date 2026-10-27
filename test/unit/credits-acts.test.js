"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t1 (lib/credits/acts.js, lookups.js, dev/design/album-credits.md
// §5, §7): each credited name's picture — FanArt.tv's with the key, else
// Wikidata's, else Deezer's (Mandarin's order), looked up in the background
// one name a turn — and a band's members NOW for its artist page (the owner:
// "only the current active members of the band", not those on the albums at
// the time of recording). Then the two routes, through a fake app.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createActs, RETRY_MS } = require("../../lib/credits/acts");
const { createCreditStore } = require("../../lib/credits/store");
const { currentMembers, pickRelease, wikidataPhoto, deezerPhoto } = require("../../lib/credits/lookups");
const { rolesOf } = require("../../lib/credits/rules");
const { mountAlbumCredits } = require("../../lib/routes/album-credits");

const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const BAND = "aaaaaaaa-2222-4333-8444-555555555555";
const id = (n) => `${String(n).padStart(8, "0")}-2222-4333-8444-555555555555`;
const member = (n, name, o) => Object.assign({ type: "member of band", direction: "backward", attributes: [], artist: { id: id(n), name } }, o);
// Anthrax as MusicBrainz answers it with its relations: a founder still in it, one who left, one who left and came
// back, one marked ended with no end date, a band Anthrax is a member of (forward), and its Wikidata link.
const ANTHRAX = { id: BAND, name: "Anthrax", relations: [
  member(1, "Scott Ian", { attributes: ["rhythm guitar", "original", "founder"], begin: "1981" }),
  member(2, "Dan Spitz", { attributes: ["lead guitar"], begin: "1983", end: "1995", ended: true }),
  member(3, "Joey Belladonna", { attributes: ["lead vocals"], begin: "1984", end: "1992", ended: true }),
  member(3, "Joey Belladonna", { attributes: ["lead vocals"], begin: "2010" }),
  member(4, "Rob Caggiano", { attributes: ["guitar"], ended: true }),
  { type: "member of band", direction: "forward", artist: { id: id(9), name: "Stormtroopers of Death" } },
  { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q207406" } },
] };
const WIKI = { entities: { Q207406: { claims: { P18: [{ mainsnak: { datavalue: { value: "Anthrax live 2012.jpg" } } }] } } } };

function rig(o = {}) {
  let t = 1_000_000;
  const asked = [], fetched = [];
  const store = createCreditStore({ db: () => null });
  const acts = createActs({ store, nameKey, userAgent: "test", fanartKey: () => o.key || "", now: () => t, later: (fn) => { fn(); },
    mb: async (p) => { asked.push(p); if (o.mbDown) throw new Error("HTTP 503"); if (p.startsWith("artist/?query")) return { artists: [{ id: BAND, name: "Anthrax" }] }; return ANTHRAX; },
    json: async (url) => { fetched.push(url); if (o.json) return o.json(url); throw new Error("HTTP 404"); } });
  return { acts, asked, fetched, store, advance: (ms) => { t += ms; } };
}
const settle = () => new Promise((r) => { setTimeout(r, 10); });

test("THE one for §7: a band's members now — one who left is not shown, one who left and came back is, each with their parts", () => {
  assert.deepEqual(currentMembers(ANTHRAX, rolesOf, nameKey), [
    { name: "Scott Ian", mbid: id(1), roles: ["Rhythm guitar"] }, { name: "Joey Belladonna", mbid: id(3), roles: ["Lead vocals"] }]);
  assert.deepEqual(currentMembers({ relations: [] }, rolesOf, nameKey), [], "a person, or an act with none listed: none");
  assert.deepEqual(currentMembers(null, rolesOf, nameKey), []);
});

test("a picture: FanArt.tv's with the key, else Wikidata's, else Deezer's; kept with the band's members", async () => {
  const fan = rig({ key: "k", json: (u) => (u.includes("fanart") ? { artistthumb: [{ url: "https://fanart/a.jpg" }] } : null) });
  fan.acts.want([{ name: "Anthrax", mbid: null }]);
  await settle();
  assert.equal(fan.acts.photo("Anthrax"), "https://fanart/a.jpg");
  assert.deepEqual(fan.asked, ['artist/?query=artist%3A%22Anthrax%22&limit=5', `artist/${BAND}?inc=url-rels+artist-rels`], "found by name, then its entry with its members and links");
  assert.deepEqual(fan.store.act("anthrax").members.map((m) => m.name), ["Scott Ian", "Joey Belladonna"]);
  const wiki = rig({ json: (u) => (u.includes("wikidata") ? WIKI : null) });
  wiki.acts.want([{ name: "Anthrax", mbid: BAND }]);
  await settle();
  assert.equal(wiki.acts.photo("Anthrax"), "https://commons.wikimedia.org/wiki/Special:FilePath/Anthrax_live_2012.jpg?width=640");
  assert.ok(!wiki.fetched.some((u) => u.includes("fanart")), "no key: FanArt.tv not asked");
  assert.equal(wiki.asked.length, 1, "the release's own id: not searched for by name");
  const deezer = rig({ json: (u) => (u.includes("deezer") ? { data: [{ name: "Anthrax Tribute", picture_xl: "x" }, { name: "anthrax", picture_xl: "https://e-cdns/artist//1.jpg" }, { name: "Anthrax", picture_xl: "https://e-cdns/artist/abc/1.jpg" }] } : null) });
  deezer.acts.want([{ name: "Anthrax", mbid: BAND }]);
  await settle();
  assert.equal(deezer.acts.photo("Anthrax"), "https://e-cdns/artist/abc/1.jpg", "the first of that name with a picture of its own");
});

test("MusicBrainz out of reach: kept as not looked up, asked again the next day and not before", async () => {
  const w = rig({ mbDown: true });
  w.acts.want([{ name: "Anthrax", mbid: null }]);
  await settle();
  assert.deepEqual([w.store.act("anthrax").ok, w.asked.length], [false, 1]);
  w.acts.want([{ name: "Anthrax", mbid: null }]);
  await settle();
  assert.equal(w.asked.length, 1);
  w.advance(RETRY_MS + 1);
  w.acts.want([{ name: "Anthrax", mbid: null }]);
  await settle();
  assert.equal(w.asked.length, 2);
});

test("the artist page's members, through the route: looked up when first asked, the members' pictures wanted then", async () => {
  const w = rig({ json: () => null });
  const routes = {};
  mountAlbumCredits({ get: (p, fn) => { routes[p] = fn; } }, { finder: { album: async () => ({ status: "ok", kept: null }), lastRead: () => null }, acts: w.acts, waitMs: 1000 });
  const ask = async (p, query) => { let out = null, code = 200; await routes[p]({ query }, { status(c) { code = c; return this; }, json(j) { out = j; } }); return { code, out }; };
  const got = await ask("/api/artist/members", { name: "Anthrax" });
  assert.deepEqual(got.out, { members: [{ name: "Scott Ian", roles: ["Rhythm guitar"], photo: null }, { name: "Joey Belladonna", roles: ["Lead vocals"], photo: null }], status: "ok" });
  await settle();
  assert.ok(w.asked.some((p) => p === `artist/${id(1)}?inc=url-rels+artist-rels`), "the members looked up for their pictures, by their own ids");
  assert.equal((await ask("/api/artist/members", {})).code, 400);
  assert.deepEqual((await ask("/api/album/credits", { title: "X", artist: "Y" })).out, { credits: [], status: "ok" });
  assert.equal((await ask("/api/album/credits", {})).code, 400);
});

test("pickRelease, wikidataPhoto, deezerPhoto — the rules alone", () => {
  const key = (t, a) => nameKey(t) + "||" + nameKey(a);
  const rel = (o) => Object.assign({ id: id(5), title: "Kings Among Scotland", "track-count": 18, "artist-credit": [{ name: "Anthrax", joinphrase: "" }] }, o);
  const album = { title: "Kings Among Scotland", artist: "Anthrax", tracks: 18 };
  assert.equal(pickRelease({ releases: [rel()] }, album, key), id(5));
  assert.equal(pickRelease({ releases: [rel({ "track-count": 17 })] }, album, key), null, "another track count: another edition");
  assert.equal(pickRelease({ releases: [rel({ "artist-credit": [{ name: "Anthrax Tribute" }] })] }, album, key), null);
  assert.equal(pickRelease({ releases: [rel({ id: "not-an-id" })] }, album, key), null);
  assert.equal(pickRelease({ releases: [rel()] }, Object.assign({}, album, { tracks: 0 }), key), null);
  assert.equal(wikidataPhoto({}, "Q1"), null);
  assert.equal(deezerPhoto({ data: [{ name: "Anthrax", picture_xl: "https://e-cdns/artist//1.jpg" }] }, "Anthrax", nameKey), null, "Deezer's blank is no picture");
});

test("MusicBrainz out of reach for a band's page: not asked again on every visit, only the next day (the review)", async () => {
  const w = rig({ mbDown: true });
  await w.acts.band("Anthrax", 1000);
  await w.acts.band("Anthrax", 1000);
  assert.equal(w.asked.length, 1);
  w.advance(RETRY_MS + 1);
  await w.acts.band("Anthrax", 1000);
  assert.equal(w.asked.length, 2);
});

test("a name in a script Rouen's keys drop is kept, compared as written (the review)", async () => {
  const { createAlbumCredits } = require("../../lib/credits");
  const c = createAlbumCredits({ db: () => null, roon: () => ({ album: async () => ({ read: true, album: [{ role: "Composer", type: 1, name: "坂本龍一" }], tracks: [], unnamed: 0, how: { trackEditInfo: "Success" } }) }),
    dirOf: () => null, readdir: () => [], parseFile: async () => ({}), mb: async () => { throw new Error("HTTP 404"); }, json: async () => null, fanartKey: () => "",
    albumKey: () => null, nameKey: () => "", userAgent: "t" });
  const got = await c.finder.album({ title: "戦場のメリークリスマス", artist: "坂本龍一", tracks: 0 }, 5000);
  assert.deepEqual(got.kept.rows.map((r) => [r.name, r.roles]), [["坂本龍一", ["Composer"]]]);
});

// ---- v1.9.70-t2: Wikipedia's members first ----

/** The rig with a Wikipedia whose band answer the test gives, and Anthrax's Wikidata item linking its article. */
function wikiRig(band, o = {}) {
  const wikiAsked = [];
  const store = createCreditStore({ db: () => null });
  let t = 1_000_000;
  const asked = [];
  const acts = createActs({ store, nameKey, userAgent: "test", fanartKey: () => "", now: () => t, later: (fn) => { fn(); },
    mb: async (p) => { asked.push(p); if (p.startsWith("artist/?query")) return { artists: [{ id: BAND, name: "Anthrax" }] };
      if (!p.startsWith(`artist/${BAND}`)) return { type: "Person", relations: [] }; // a member, looked up for their picture
      return o.person ? Object.assign({}, ANTHRAX, { type: "Person" }) : Object.assign({ type: "Group" }, ANTHRAX); },
    json: async (url) => (url.includes("wikidata") ? { entities: { Q207406: { sitelinks: { enwiki: { title: "Anthrax (American band)" } } } } } : null),
    wikipedia: { band: async (name, title) => { wikiAsked.push([name, title]); return band(); } } });
  return { acts, store, wikiAsked, asked, advance: (ms) => { t += ms; } };
}

test("a band's members: Wikipedia's first, found by the Wikidata item's link, with MusicBrainz's ids and, where Wikipedia gives none, its parts", async () => {
  const w = wikiRig(() => ({ article: "Anthrax (American band)", from: "section", members: [
    { name: "Scott Ian", roles: ["Rhythm guitar", "Backing vocals"] }, { name: "Joey Belladonna", roles: [] }, { name: "Jonathan Donais", roles: ["Lead guitar"] }] }));
  const got = await w.acts.band("Anthrax", 1000);
  assert.deepEqual(w.wikiAsked, [["Anthrax", "Anthrax (American band)"]]);
  assert.deepEqual(w.store.act("anthrax").members, [
    { name: "Scott Ian", mbid: id(1), roles: ["Rhythm guitar", "Backing vocals"] },
    { name: "Joey Belladonna", mbid: id(3), roles: ["Lead vocals"] },
    { name: "Jonathan Donais", mbid: null, roles: ["Lead guitar"] }], "Wikipedia's list; the one MusicBrainz hasn't caught up with shown");
  assert.equal(got.members.length, 3);
});

test("Wikipedia naming none, or a person: MusicBrainz's; Wikipedia out of reach: MusicBrainz's meanwhile, and asked again the next day", async () => {
  const none = wikiRig(() => ({ article: null, from: null, members: null }));
  await none.acts.band("Anthrax", 1000);
  assert.deepEqual(none.store.act("anthrax").members.map((m) => m.name), ["Scott Ian", "Joey Belladonna"]);
  const person = wikiRig(() => { throw new Error("asked"); }, { person: true });
  await person.acts.band("Anthrax", 1000);
  assert.deepEqual([person.wikiAsked, person.store.act("anthrax").ok], [[], true], "a person: Wikipedia not asked");
  const down = wikiRig(() => { throw new Error("HTTP 503"); });
  const got = await down.acts.band("Anthrax", 1000);
  assert.deepEqual([got.members.map((m) => m.name), down.store.act("anthrax").ok], [["Scott Ian", "Joey Belladonna"], false]);
  await down.acts.band("Anthrax", 1000);
  assert.equal(down.wikiAsked.length, 1);
  down.advance(RETRY_MS + 1);
  await down.acts.band("Anthrax", 1000);
  assert.equal(down.wikiAsked.length, 2);
});

test("the people an album credits are never asked of Wikipedia; a band kept before Wikipedia was asked is asked once its page opens (the review)", async () => {
  const asked = [], wikiAsked = [];
  const store = createCreditStore({ db: () => null });
  const acts = createActs({ store, nameKey, userAgent: "test", fanartKey: () => "", later: (fn) => { fn(); },
    mb: async (p) => { asked.push(p); return p.startsWith("artist/?query") ? { artists: [] } : { relations: [] }; },
    json: async () => null, wikipedia: { band: async (name) => { wikiAsked.push(name); return { article: "X", from: "infobox", members: [{ name: "Member One", roles: [] }] }; } } });
  acts.want([{ name: "Howie Weinberg", mbid: null }, { name: "Don Brautigam", mbid: null }]);
  await settle();
  assert.deepEqual(wikiAsked, [], "no MusicBrainz entry, credited on an album: not asked");
  assert.equal(store.act("howie weinberg").ok, true);
  store.saveAct({ key: "anthrax", name: "Anthrax", mbid: null, photo: null, source: null, at: Date.now(), ok: true, members: [] });
  const got = await acts.band("Anthrax", 1000);
  assert.deepEqual([wikiAsked, got.members.map((m) => m.name), store.act("anthrax").wiki], [["Anthrax"], ["Member One"], "asked"]);
  await acts.band("Anthrax", 1000);
  assert.equal(wikiAsked.length, 1, "asked once");
});

let Database = null;
try { Database = require("better-sqlite3"); } catch (e) {
  // Optional in environments without the native build; the test below skips rather than failing for a reason
  // unrelated to the code under test (as releasedays-store.test.js does).
}

test("a credit_acts table made by t1 gains its wiki column, its rows kept", { skip: !Database && "better-sqlite3 not built here" }, () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE credit_acts (key TEXT PRIMARY KEY, name TEXT NOT NULL, mbid TEXT, photo TEXT, photo_source TEXT, looked_at INTEGER NOT NULL, ok INTEGER NOT NULL, members TEXT);");
  db.prepare("INSERT INTO credit_acts VALUES ('anthrax', 'Anthrax', NULL, NULL, NULL, 5, 1, '[]')").run();
  const store = createCreditStore({ db: () => db });
  assert.deepEqual([store.act("anthrax").name, store.act("anthrax").wiki], ["Anthrax", null]);
  store.saveAct({ key: "anthrax", name: "Anthrax", mbid: null, photo: null, source: null, at: 6, ok: true, members: [], wiki: "asked" });
  assert.equal(createCreditStore({ db: () => db }).act("anthrax").wiki, "asked");
});
