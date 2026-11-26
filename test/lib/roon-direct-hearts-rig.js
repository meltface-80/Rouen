"use strict";
// ---------------------------------------------------------------------------
// The hearts tests' rig (roon-direct-hearts.test.js, roon-direct-hearts-profiles.test.js): stage 1 over the link against
// the fake Core, which reads the bytes strictly (test/lib/fake-roon-hearts.js) but is not evidence that a real Core
// behaves this way (native-remote.md §2's "live" column is). Moved out unchanged in 2.0.8-t2, when the profiles' tests
// took the file past 500 lines.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { startFakeCore } = require("./fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { setHousehold } = require("../../lib/roon-direct/session");
const { CORE_ID, LIBRARY, assertTidy } = require("./roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
/** Releases and disposals are sent without waiting: tidy once the fake has read them all. */
async function tidy(rec) {
  await until(() => rec.released.length >= rec.retained.length && rec.disposed.length >= rec.opened.length);
  assertTidy(rec);
}
const BLUE = Array.from({ length: 10 }, (_, i) => `Blue ${i + 1}`);

/** @param {(n: number, core: any, s1: any) => Promise<void>} [hook]  run as each read ends, before stage 1 takes it */
/** @param {object} [extra]  more of stage 1's deps (2.0.7-t4: requestProfile) */
async function rig(t, faults, hook, edit, extra) {
  // And one more by the same artist whose title holds "Blue": only the album's id tells its tracks apart.
  const albums = LIBRARY.map((a) => Object.assign({}, a)).concat([{ title: "Blue (Deluxe)", artist: "Joni Mitchell", source: "local", tracks: 3 }]);
  if (edit) edit(albums);
  // As the owner's server does (v1.9.28): each object sent once a connection.
  const f = Object.assign({ sentOnce: true }, faults);
  // The household's Roon profile (profiles.md §13.2): Rouen's first profile's pairing, here a value or a function of the test's.
  if (f.household !== undefined) {
    const h = f.household;
    setHousehold(typeof h === "function" ? h : () => h);
    t.after(() => setHousehold(() => null));
  }
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, faults: f });
  let s1 = null;
  let reads = 0;
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => (faults && faults.saved) || null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.27",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, o) => { const r = await readAlbumsOn(s, o); reads++; if (hook) await hook(reads, core, s1); return r; },
    ...(extra || {}),
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads === 1 && s1.albums()), "the library was never read");
  return { core, s1, albums, faults: f, marks: s1.marks, reads: () => reads };
}

module.exports = { keyOf, until, tidy, BLUE, rig };
