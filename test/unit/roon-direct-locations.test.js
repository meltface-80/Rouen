"use strict";
// ---------------------------------------------------------------------------
// The Locations probe's pieces (dev/design/roon-native.md §9.1): the bytes
// RequireLocations is sent as, the allowlist's edges for the album query, and
// the verdict that keeps "every count equal" from passing as a working filter.
// The probe end to end, against the fake Core, is in roon-direct-probe.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { refList, SIG, ALLOWED, guarded } = require("../../lib/roon-direct/methods");
const { ALBUM_QUERY_CRITERIA } = require("../../lib/roon-direct/schemas");
const { verdict, readCount } = require("../../lib/roon-direct/locations");

test("RequireLocations is a LengthPrefixed list: length, count, then each Location's id", () => {
  // 300 is two flex bytes (0x82 0x2c): the length counts bytes, not elements.
  assert.equal(refList([4n, 300n]).toString("hex"), "04" + "02" + "04" + "822c");
  assert.equal(refList([]).toString("hex"), "0100", "an empty list is a count of 0, length 1");
});

test("AlbumQueryCriteria: the upstream's 118 members, the lists Rouen sends declared LengthPrefixed (24)", () => {
  assert.equal(ALBUM_QUERY_CRITERIA.members.length, 118);
  const changed = ALBUM_QUERY_CRITERIA.members.filter(([n, p]) => (n.includes("IList<") || n.startsWith("Sooloos.NullDate ")) && p !== 23);
  // RequireLocations (the Locations probe, v1.9.13); the genre lists the smart-playlist test sends, as the owner's server
  // declares them (v1.9.53, native-remote.md §12.6–12.7); and every list and date a smart playlist is made with (v1.9.60,
  // §12.15). A list Rouen doesn't send keeps the upstream's declaration.
  // The album types too (v1.9.67, §12.19), declared as the owner's server declares every Require/Exclude list (§12.2).
  assert.deepEqual(changed.map(([n, p]) => [n.split("::")[1], p]), [["RequireTypes", 24], ["ExcludeTypes", 24], ["RequireLocations", 24], ["RequireLabels", 24], ["ExcludeLabels", 24],
    ["RequireGenreObjects", 24], ["ExcludeGenreObjects", 24], ["RequireSampleRates", 24], ["ExcludeSampleRates", 24], ["RequireBitsPerSample", 24],
    ["ExcludeBitsPerSample", 24], ["RequireFileFormats", 24], ["ExcludeFileFormats", 24], ["MinDate", 24], ["MaxDate", 24]],
    "the only changes from the upstream's generated schema");
});

test("the allowlist: the album query, its pages and its Dispose, and nothing that selects it", () => {
  assert.ok(ALLOWED.has(SIG.albumQuery));
  assert.ok(ALLOWED.has(SIG.albumDispose));
  const sent = [];
  const g = guarded(/** @type {any} */ ({ call: (_o, s) => { sent.push(s); return Promise.resolve({}); }, callNoReply: (_o, s) => { sent.push(s); return true; } }));
  for (const off of ["Sooloos.Broker.Api.VirtualAlbumLiteQuery::SelectAll(Base.ResultCallback)", "Sooloos.Broker.Api.Library::GetAlbumQueryInfo(System.Sooid, Sooloos.Broker.Api.AlbumQueryCriteria, Base.ResultCallback<Sooloos.Broker.Api.AlbumQueryInfo>)"]) {
    assert.throws(() => g.call(1n, off, Buffer.alloc(0)), /not on the allowlist/);
  }
  assert.deepEqual(sent, [], "refused before a byte left");
});

test("the verdict: filtered only on Counts a misread criterion cannot give", () => {
  const inf = (n) => ({ albums: n, inferred: "x" });
  // The owner's Core, if it works: Iron & Wine 19, TIDAL 6, the rest absent zeros.
  assert.match(verdict({ albums: 25 }, [{ albums: 19 }, { albums: 6 }, inf(0), inf(0)]), /^filtered: .*\(2 more read as an inferred 0/);
  assert.match(verdict({ albums: 25 }, [{ albums: 25 }, { albums: 25 }]), /^ignored: every Location counted 25/);
  assert.match(verdict({ albums: 25 }, [{ albums: 25 }, { albums: 25 }, inf(0)]), /^ignored:/, "a late Count read as 0 does not turn ignored into filtered");
  assert.match(verdict({ albums: 25 }, [{ albums: 25 }, inf(0)]), /^unknown: the Counts that arrived \(25\)/);
  assert.match(verdict({ albums: 25 }, [inf(0), inf(0)]), /^unknown: no Count arrived as a number/);
  assert.match(verdict({ albums: 25 }, [{ albums: 0 }, { albums: 0 }, { albums: 0 }]), /^misread: every Location whose Count arrived counted 0/, "THE one: all zeros differ from the control and are still no filter");
  assert.match(verdict({ albums: 25 }, [{ albums: 40 }, { albums: 40 }]), /^misread: a Location counted 40, more than the 25/);
  assert.match(verdict({ albums: 25 }, [{ albums: 7 }, { albums: 7 }]), /^unknown: the Counts that arrived \(7, 7\)/);
  assert.match(verdict({ albums: 25 }, [{ albums: 25 }, { albums: 0 }]), /^unknown:/, "nothing strictly between 0 and the control");
  assert.match(verdict({ albums: 25 }, [{ albums: 25 }]), /^unknown:/);
  assert.match(verdict({ albums: 0 }, [{ albums: 0 }, { albums: 0 }]), /^unknown: the control counted no albums/);
  assert.match(verdict({ albums: null }, [{ albums: 3 }]), /^unknown: the unfiltered control query failed/);
  assert.match(verdict({ albums: 25 }, [{ albums: null }]), /^unknown: no Location was counted/);
  assert.match(verdict({ albums: 25 }, [{ albums: 19 }, { albums: 6 }, { albums: null }]), /^filtered: .*\(1 Location\(s\) not counted\)/);
});

test("readCount: a number is read; an absent Count after the grace is an inferred 0; anything else is an error", async () => {
  const graph = (o) => /** @type {any} */ ({ get: () => o });
  assert.deepEqual(await readCount(graph({ fields: { "int X::Count": 7 } }), 1n, 500, 50), { count: 7 });
  assert.deepEqual(await readCount(graph({ fields: { "long X::Count": 7n } }), 1n, 500, 50), { count: 7 });
  assert.deepEqual(await readCount(graph({ fields: {} }), 1n, 200, 50), { count: 0, inferred: true });
  assert.deepEqual(await readCount(graph({ fields: { "int? X::Count": null } }), 1n, 200, 50), { error: "the query's Count was not a count: null" }, "THE one: present but not a count is not a 0");
  assert.deepEqual(await readCount(graph({ fields: { "int X::Count": -1 } }), 1n, 200, 50), { error: "the query's Count was not a count: -1" });
  assert.deepEqual(await readCount(graph(undefined), 1n, 200, 50), { error: "the query object never arrived" });
});

test("readCount: an object that arrives at the very end still gets its grace", async () => {
  const o = /** @type {any} */ ({ fields: {} });
  let t0 = Date.now();
  const graph = /** @type {any} */ ({ get: () => (Date.now() - t0 >= 150 ? o : undefined) });
  setTimeout(() => { o.fields["int X::Count"] = 4; }, 250);
  t0 = Date.now();
  assert.deepEqual(await readCount(graph, 1n, 200, 300), { count: 4 }, "arrived at 150 ms of 200, Count at 250 ms: read, not 'never arrived'");
});

// ---- v1.9.16: albumsource.js ------------------------------------------------
const { sourceOfLocation, tally, contentSourceVerdict, crossCheck, crossVerdict } = require("../../lib/roon-direct/albumsource");

test("a Location's source is read by category and type, never by name", () => {
  assert.equal(sourceOfLocation({ category: 100, type: 104 }), "local");
  assert.equal(sourceOfLocation({ category: 400, type: 406 }), "tidal", "TIDAL and TIDAL Library alike");
  assert.equal(sourceOfLocation({ category: 400, type: 407 }), "qobuz");
  assert.equal(sourceOfLocation({ category: 500, type: 501 }), null, "Internet Media stands for no source");
});

test("tally counts each value, a missing one as absent", () => {
  assert.deepEqual(tally([128, 128, undefined, 1, null]), { 128: 2, absent: 2, 1: 1 });
});

test("ContentSource: agrees, absent, disagrees, unknown", () => {
  assert.match(contentSourceVerdict([{ oid: "1", source: "tidal", contentSource: 128 }, { oid: "2", source: "local", contentSource: 1 }]), /^agrees: every one of the 2/);
  assert.match(contentSourceVerdict([{ oid: "1", source: "tidal", contentSource: undefined }]), /^absent:/);
  assert.match(contentSourceVerdict([{ oid: "1", source: "tidal", contentSource: 128 }, { oid: "2", source: "tidal", contentSource: undefined }]), /^incomplete: 1 of 2 agree, the other 1 carry none$/,
    "THE one: some albums carrying it is not all agreeing — and nothing disagreed");
  assert.match(contentSourceVerdict([{ oid: "1", source: "local", contentSource: 1 }, { oid: "2", source: "tidal", contentSource: 1 }]), /^disagrees: 1 of 2 agree, 1 name another source, 0 carry none \(tidal album says 1\)/,
    "a library TIDAL album saying Local is the plain Source's behaviour, and must not pass");
  assert.match(contentSourceVerdict([{ oid: "1", source: "tidal", contentSource: 128 }, { oid: "1", source: "tidal", contentSource: 128 }]), /every one of the 1 /, "an album in two Locations counts once");
  assert.match(contentSourceVerdict([{ oid: "1", source: "tidal", contentSource: { $ref: 5n } }]), /tidal album says \{"\$ref":"5"\}/, "a value of another shape is shown, not [object Object]");
  assert.match(contentSourceVerdict([]), /^unknown/);
});

test("the cross-check: same, differ, and unknown without tracks to compare with", () => {
  const L = { local: new Set(["1", "2"]), tidal: new Set(["3"]) };
  const same = crossCheck(L, { local: new Set(["1", "2"]), tidal: new Set(["3"]) });
  assert.match(crossVerdict(same), /^same: for local, tidal/);
  const differ = crossCheck(L, { local: new Set(["1", "9"]), tidal: new Set(["3"]) });
  assert.deepEqual(differ.local, { fromLocations: 2, fromTracks: 2, same: 1, onlyLocations: 1, onlyTracks: 1 });
  assert.match(crossVerdict(differ), /^differ: local 1 only by Location, 1 only by tracks/);
  assert.match(crossVerdict(crossCheck({ local: new Set(["1"]) }, { local: new Set(["1", "2"]) })), /^differ: local 0 only by Location, 1 only by tracks/,
    "an album its tracks have and its Location lacks is a difference too");
  const partial = crossCheck(L, { local: new Set(["1", "2"]) });
  assert.deepEqual(partial.tidal, { fromLocations: 1, fromTracks: null });
  assert.match(crossVerdict(partial), /^same: for local,/, "a source not read whole is left out, not counted as agreeing");
  assert.match(crossVerdict(crossCheck(L, {})), /^unknown: no source was read whole both ways/);
  assert.match(crossVerdict({}), /^unknown: no source to compare/);
  // A source only the tracks found is compared too: its Locations hold none of them.
  assert.match(crossVerdict(crossCheck({ local: new Set(["1"]) }, { local: new Set(["1"]), qobuz: new Set(["7"]) })), /^differ: qobuz 0 only by Location, 1 only by tracks/,
    "THE one: albums only the tracks found are not hidden behind 'same'");
  assert.match(crossVerdict({ local: { fromLocations: 1, fromTracks: 1, same: 1, onlyLocations: 0, onlyTracks: 0 }, tidal: { partial: "TIDAL: short" } }), /^same: for local, .* \(not compared: tidal\)$/);
});

test("imageKeyOf: the key from an Image's broker Url, inline or by reference", () => {
  const { imageKeyOf } = require("../../lib/roon-direct/locations");
  const album = (img) => ({ fields: { "Sooloos.Broker.Api.Image X::Image": img } });
  const graph = /** @type {any} */ ({ get: () => ({ fields: { "string Sooloos.Broker.Api.Image::Url": "broker:///image/abc123.png" } }) });
  assert.equal(imageKeyOf(graph, album({ "string Sooloos.Broker.Api.Image::Url": "broker:///image/k9.jpg" })), "k9");
  assert.equal(imageKeyOf(graph, album({ $ref: 7n })), "abc123");
  assert.equal(imageKeyOf(graph, album(null)), null);
  assert.equal(imageKeyOf(graph, album({ "string Sooloos.Broker.Api.Image::Url": "https://resources.tidal.com/x.jpg" })), null, "not a broker image: no key");
});
