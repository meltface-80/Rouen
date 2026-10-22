"use strict";
// ---------------------------------------------------------------------------
// The Native mode status board (lib/roon-direct/health.js, lib/routes/native-status.js; v1.9.63,
// dev/design/native-remote.md §13): one row per thing native mode does, green (its last read or write worked),
// red (failing now, why) or grey (not used yet). The rows are pure; the route gathers what each feature keeps.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { boardRows } = require("../../lib/roon-direct/health");
const { mountNativeStatus } = require("../../lib/routes/native-status");

const UP = { on: true, active: true, link: { running: true, up: true, keepalive: { missed: 0 }, lastDown: null },
  library: { albums: 12968 }, hearts: { album: { on: true }, track: { on: true }, off: null, favourites: 1234 } };
const IDLE = { running: false, total: 0, done: [], error: null };
const ALL_WELL = { status: UP, later: { read: { entries: [1, 2] }, move: IDLE, rouen: 0 }, smart: { read: { playlists: [1] }, move: IDLE, rouen: 0 },
  playlists: { read: { available: true, playlists: [1, 2, 3] }, copy: IDLE, rouen: 0 }, add: null };
const lights = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.light]));
const lineOf = (rows, id) => rows.find((r) => r.id === id).line;
const merged = (patch) => Object.assign({}, ALL_WELL, patch);

test("THE one: all well — every row green but an add never asked for, in the pane's order", () => {
  const rows = boardRows(ALL_WELL);
  assert.deepEqual(rows.map((r) => r.id), ["connection", "library", "hearts", "later", "smart", "playlists", "add"]);
  assert.deepEqual(lights(rows), { connection: "green", library: "green", hearts: "green", later: "green", smart: "green", playlists: "green", add: "grey" });
  assert.equal(lineOf(rows, "library"), "Your server's own list: 12,968 albums.");
  assert.equal(lineOf(rows, "playlists"), "Your server's playlists: 3 playlists.");
  for (const r of rows) assert.ok(r.name && r.line, `${r.id} has no name or line`);
});

test("native mode off: every row grey, none red; turned itself off: red, why", () => {
  const off = { on: false, active: false, link: null, hearts: null };
  const rows = boardRows({ status: off, later: { read: null, move: null, rouen: 0 }, smart: { read: null, move: null, rouen: 0 },
    playlists: { read: null, copy: null, rouen: 0 }, add: null });
  assert.deepEqual(new Set(rows.map((r) => r.light)), new Set(["grey"]));
  const failed = boardRows(merged({ status: Object.assign({}, off, { offReason: "The check after an update failed." }) }));
  assert.deepEqual([lights(failed).library, lineOf(failed, "library")], ["red", "Native mode turned itself off: The check after an update failed."]);
});

test("each failure is red, with its reason", () => {
  const ka = boardRows(merged({ status: Object.assign({}, UP, { link: Object.assign({}, UP.link, { keepalive: { missed: 3 } }) }) }));
  assert.equal(lights(ka).connection, "red");
  const down = boardRows(merged({ status: Object.assign({}, UP, { link: { running: true, up: false, lastDown: { why: "the server closed it" } } }) }));
  assert.deepEqual([lights(down).connection, lineOf(down, "connection")], ["red", "Not connected: the server closed it. Rouen keeps trying."]);
  const nightly = boardRows(merged({ status: Object.assign({}, UP, { link: { running: true, up: false, lastDown: { why: "the nightly reconnect", planned: true } } }) }));
  assert.deepEqual([lights(nightly).connection, lineOf(nightly, "connection")], ["grey", "Reconnecting (the nightly reconnect)…"], "a planned reconnect said as a fault");
  const unreadHere = boardRows(merged({ status: Object.assign({}, UP, { readHere: false }) }));
  assert.equal(lights(unreadHere).library, "grey", "a new connection's library taken as read before its read");
  const connecting = boardRows(merged({ status: Object.assign({}, UP, { link: { running: true, up: false, lastDown: null } }) }));
  assert.equal(lights(connecting).connection, "grey", "connecting for the first time is not a failure");
  const fell = boardRows(merged({ status: Object.assign({}, UP, { fellBack: { why: "The Core refused page 3: Busy." } }) }));
  assert.equal(lights(fell).library, "red");
  const heart = boardRows(merged({ status: Object.assign({}, UP, { hearts: Object.assign({}, UP.hearts, { album: { on: false, why: "Your server refused an album heart." } }) }) }));
  assert.deepEqual([lights(heart).hearts, lineOf(heart, "hearts")], ["red", "Your server refused an album heart."]);
  const two = [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "Guest" }];
  const choose = boardRows(merged({ status: Object.assign({}, UP, { hearts: Object.assign({}, UP.hearts, { off: "Whose favourites?", profiles: two, profile: null }) }) }));
  assert.equal(lights(choose).hearts, "red", "a profile to choose is something to do");
  const waiting = boardRows(merged({ status: Object.assign({}, UP, { hearts: Object.assign({}, UP.hearts, { off: "Hearts wait for a read of your server's library to succeed." }) }) }));
  assert.equal(lights(waiting).hearts, "grey", "waiting for the read is not a failure");
  const later = boardRows(merged({ later: { read: { notRead: "no answer" }, move: null, rouen: 0 } }));
  assert.deepEqual([lights(later).later, lineOf(later, "later")], ["red", "Your server's Listen Later can't be read: no answer"]);
  const left = boardRows(merged({ later: { read: { entries: [] }, move: { running: false, total: 1, error: null,
    done: [{ title: "Blue", result: "not-shown", why: "not shown after the add" }] }, rouen: 1 } }));
  assert.deepEqual([lights(left).later, lineOf(left, "later")], ["red", "1 album on Rouen's own list isn't on your server's yet: \"Blue\": not shown after the add"]);
  const kept = boardRows(merged({ smart: { read: { playlists: [] }, move: { running: false, total: 1, error: null,
    done: [{ name: "Stereo", result: "kept", why: "its Channels filter" }] }, rouen: 1 } }));
  assert.deepEqual([lights(kept).smart, lineOf(kept, "smart")], ["red", "1 Dynamic Playlist stays Rouen's own: \"Stereo\": its Channels filter"]);
  const smartRouen = boardRows(merged({ smart: { read: { playlists: [] }, move: IDLE, rouen: 2 } }));
  assert.equal(lights(smartRouen).smart, "red", "Rouen still holding its own counted as moved");
  const part = boardRows(merged({ playlists: { read: { available: true, playlists: [] }, rouen: 1,
    copy: { running: false, total: 1, error: null, done: [{ name: "Mix", result: "copied", missing: ["A", "B"] }] } } }));
  assert.deepEqual([lights(part).playlists, lineOf(part, "playlists")], ["red", "1 playlist of Rouen's own stays in Rouen: \"Mix\": 2 tracks not found on your server"]);
  const meanwhile = boardRows(merged({ playlists: { read: { available: true, playlists: [] }, rouen: 1,
    copy: { running: false, total: 1, error: null, done: [{ name: "Mix", result: "copied", missing: [], moved: false }] } } }));
  assert.equal(lineOf(meanwhile, "playlists"), "1 playlist of Rouen's own stays in Rouen: \"Mix\": changed in Rouen while it was copied; your server has it as it was");
  const unread = boardRows(merged({ playlists: { read: { available: false, why: "browse timed out" }, copy: null, rouen: 0 } }));
  assert.equal(lights(unread).playlists, "red");
  const notSent = boardRows(merged({ add: { ok: false, why: "Native mode isn't connected to your server right now.", at: 1, title: "Syro" } }));
  assert.deepEqual([lights(notSent).add, lineOf(notSent, "add")], ["red", "Last: \"Syro\" wasn't sent: Native mode isn't connected to your server right now."]);
  const taken = boardRows(merged({ add: { ok: true, why: null, at: 1, title: "Syro" } }));
  assert.deepEqual([lights(taken).add, lineOf(taken, "add")], ["green", "Last: \"Syro\", taken."]);
});

test("a move or copy under way is grey, not red; one more than three left is counted", () => {
  const moving = boardRows(merged({ later: { read: { entries: [] }, move: { running: true, total: 4, done: [1], error: null }, rouen: 4 } }));
  assert.deepEqual([lights(moving).later, lineOf(moving, "later")], ["grey", "Moving Rouen's own onto your server's… 1 of 4"]);
  const five = Array.from({ length: 5 }, (_, i) => ({ name: "P" + i, result: "failed", why: "refused" }));
  const many = boardRows(merged({ playlists: { read: { available: true, playlists: [] }, copy: { running: false, total: 5, done: five, error: null }, rouen: 5 } }));
  assert.match(lineOf(many, "playlists"), /^5 playlists of Rouen's own stay in Rouen: "P0": refused; "P1": refused; "P2": refused; and 2 more$/);
});

/** The route against stubs: o.throws makes Roon's smart playlists' read throw. */
function rig(o = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; } };
  const kicked = [];
  const native = {
    status: () => (o.off ? { on: false, active: false, link: null, hearts: null } : UP),
    listenLater: { list: async () => ({ entries: [1] }), moveProgress: () => IDLE },
    smart: { list: async () => { if (o.throws) throw new Error("the Core did not answer"); return { playlists: [1] }; } },
    smartMove: { progress: () => IDLE },
    adder: { lastAdd: () => null },
  };
  const np = { list: async () => ({ available: true, playlists: [] }), copyProgress: () => IDLE };
  mountNativeStatus(app, { native: () => native, nativePlaylists: () => np, laterRows: () => 0, smartRows: () => 0, userRows: () => 0,
    kick: [() => { kicked.push(1); if (o.kickThrows) throw new Error("boom"); }, () => { kicked.push(2); }] });
  return async () => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["GET /api/native/status"]({ query: {} }, res);
    return { res, kicked };
  };
}

test("the route: the rows, a read that throws a red row of its own, the moves asked for only with native mode on", async () => {
  const { res, kicked } = await rig()();
  assert.deepEqual(lights(res.body.rows), { connection: "green", library: "green", hearts: "green", later: "green", smart: "green", playlists: "green", add: "grey" });
  assert.deepEqual(kicked, [1, 2], "the moves weren't asked for on an open of the board");
  const t = await rig({ throws: true, kickThrows: true })();
  assert.equal(t.res.code, 200, "a throw took the board down");
  assert.deepEqual(t.kicked, [1, 2], "one move's throw kept the next from its chance");
  assert.deepEqual([lights(t.res.body.rows).smart, lineOf(t.res.body.rows, "smart")], ["red", "Your server's smart playlists can't be read: the Core did not answer"]);
  assert.equal(lights(t.res.body.rows).later, "green", "one read's failure spread to another row");
  const off = await rig({ off: true })();
  assert.equal(off.kicked.length, 0, "moves asked for with native mode off");
  assert.deepEqual(new Set(off.res.body.rows.map((r) => r.light)), new Set(["grey"]));
});
