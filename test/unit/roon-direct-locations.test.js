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

test("AlbumQueryCriteria: the upstream's 118 members, RequireLocations declared LengthPrefixed (24)", () => {
  assert.equal(ALBUM_QUERY_CRITERIA.members.length, 118);
  const changed = ALBUM_QUERY_CRITERIA.members.filter(([n, p]) => n.includes("IList<") && p !== 23);
  assert.deepEqual(changed.map(([n, p]) => [n.split("::")[1], p]), [["RequireLocations", 24]], "THE one change from the upstream's generated schema");
});

test("the allowlist: the album query and its Dispose, and nothing that pages or selects it", () => {
  assert.ok(ALLOWED.has(SIG.albumQuery));
  assert.ok(ALLOWED.has(SIG.albumDispose));
  const sent = [];
  const g = guarded(/** @type {any} */ ({ call: (_o, s) => { sent.push(s); return Promise.resolve({}); }, callNoReply: (_o, s) => { sent.push(s); return true; } }));
  for (const off of ["Sooloos.Broker.Api.VirtualAlbumLiteQuery::RetainPage(int, Base.ResultCallback)", "Sooloos.Broker.Api.VirtualAlbumLiteQuery::SelectAll(Base.ResultCallback)"]) {
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
