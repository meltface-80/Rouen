"use strict";
// ---------------------------------------------------------------------------
// A list of tracks sent to a zone one at a time, in the order given (lib/ordered-play.js, v2.0.3-t11): the order, which
// track gets the kind asked, what a refusal costs, when a run gives up, that a run replaced or stopped sends nothing
// more, and that one thing is sent to a zone at a time. Roon is a stand-in: `send` is a function that resolves or
// rejects.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOrderedPlay, GIVE_UP_AFTER } = require("../../lib/ordered-play");

const T = (n) => Array.from({ length: n }, (_, i) => ({ index: i, title: "t" + i }));
const quiet = () => {};

/** A send the test lets through one call at a time. */
function gate() {
  const waiting = [];
  const sent = [];
  const send = (t, kind) => new Promise((resolve, reject) => { waiting.push({ t, kind, resolve, reject }); sent.push([t.index, kind]); });
  const tick = () => new Promise((r) => { setImmediate(r); });
  return { send, sent, waiting, tick, async pass() { await tick(); waiting.shift().resolve(); await tick(); },
    async refuse(msg) { await tick(); waiting.shift().reject(new Error(msg)); await tick(); } };
}

test("the tracks go in the order given: the first with the kind asked, the rest queued", async () => {
  const op = createOrderedPlay({ log: quiet });
  const sent = [];
  const job = op.start("z1", [{ index: 4 }, { index: 0 }, { index: 2 }], "play_now", async (t, k) => { sent.push([t.index, k]); }, { title: "Mix", offset: 3 });
  assert.deepEqual([job.total, job.sent, job.done, job.title, job.offset, job.kind], [3, 0, false, "Mix", 3, "play_now"],
    "it answers at once, before anything is sent");
  await new Promise((r) => { setTimeout(r, 10); });
  assert.deepEqual(sent, [[4, "play_now"], [0, "queue"], [2, "queue"]]);
  const s = op.status("z1");
  assert.deepEqual([s.id, s.sent, s.queued, s.failed, s.done, s.stopped], [job.id, 3, 3, 0, true, null]);
  assert.deepEqual(Object.keys(s).sort(), ["done", "failed", "first_error", "id", "kind", "offset", "queued", "seconds", "sent", "stopped", "title", "total"],
    "the page is told nothing of the tracks");
});

test("the kind asked goes to the first track Roon accepts, not the first tried", async () => {
  const op = createOrderedPlay({ log: quiet });
  const g = gate();
  op.start("z1", T(4), "play_now", g.send);
  await g.refuse("gone"); await g.refuse("gone too"); await g.pass(); await g.pass();
  assert.deepEqual(g.sent, [[0, "play_now"], [1, "play_now"], [2, "play_now"], [3, "queue"]]);
  const s = op.status("z1");
  assert.deepEqual([s.sent, s.queued, s.failed, s.first_error, s.done, s.stopped], [4, 2, 2, "gone", true, null]);
});

test("a refusal does not end the run; five in a row do", async () => {
  assert.equal(GIVE_UP_AFTER, 5, "the number the design gives (playlist-artists.md §7.2)");
  const op = createOrderedPlay({ log: quiet });
  const g = gate();
  op.start("z1", T(20), "queue", g.send);
  await g.pass();
  for (let i = 0; i < GIVE_UP_AFTER - 1; i++) await g.refuse("no " + i);
  await g.pass();                                    // the count starts again
  assert.equal(op.status("z1").done, false);
  for (let i = 0; i < GIVE_UP_AFTER; i++) await g.refuse("down");
  const s = op.status("z1");
  assert.deepEqual([s.done, s.stopped, s.sent, s.queued, s.failed, s.first_error], [true, "failures", 2 + 2 * GIVE_UP_AFTER - 1, 2, 2 * GIVE_UP_AFTER - 1, "no 0"]);
  assert.equal(g.waiting.length, 0, "nothing more is sent");
});

test("Stop: the send in flight lands, nothing follows, and the answer waits for it", async () => {
  const op = createOrderedPlay({ log: quiet });
  const g = gate();
  op.start("z1", T(5), "play_now", g.send);
  await g.pass();
  await g.tick();
  let answered = null;
  const stopping = op.stop("z1", "user").then((v) => { answered = v; });
  await g.tick();
  assert.equal(answered, null, "the second track is still with Roon");
  await g.pass();
  await stopping;
  assert.deepEqual([answered.done, answered.stopped, answered.sent, answered.queued], [true, "user", 2, 2]);
  assert.deepEqual(g.sent, [[0, "play_now"], [1, "queue"]]);
  assert.equal(await op.stop("nowhere"), null);
  assert.equal(op.status("nowhere"), null);
});

test("a Stop as the last track goes is a run that finished", async () => {
  const op = createOrderedPlay({ log: quiet });
  const g = gate();
  op.start("z1", T(1), "queue", g.send);
  await g.tick();
  const stopping = op.stop("z1", "user");
  await g.pass();
  assert.deepEqual([(await stopping).stopped, op.status("z1").queued], [null, 1]);
});

test("a second run on the zone ends the first, and waits for its send in flight before sending", async () => {
  const op = createOrderedPlay({ log: quiet });
  const a = gate(), b = gate();
  const first = op.start("z1", T(5), "play_now", a.send, { title: "A" });
  await a.pass();
  await a.tick();                                    // A's second track is with Roon
  const second = op.start("z1", T(3), "play_now", b.send, { title: "B" });
  assert.notEqual(first.id, second.id);
  await b.tick();
  assert.equal(b.sent.length, 0, "B holds while A's track is in flight");
  await a.pass();
  await b.pass(); await b.pass(); await b.pass();
  assert.equal(a.sent.length, 2, "A sent nothing after it was replaced");
  assert.deepEqual(b.sent, [[0, "play_now"], [1, "queue"], [2, "queue"]]);
  const s = op.status("z1");
  assert.deepEqual([s.title, s.done, s.stopped, s.queued], ["B", true, null, 3]);
});

test("zones run side by side; a run's seconds stop at its end", async () => {
  let clock = 1000;
  const lines = [];
  const op = createOrderedPlay({ log: (l) => lines.push(l), now: () => clock });
  const g1 = gate(), g2 = gate();
  op.start("z1", T(1), "queue", g1.send, { title: "One" });
  op.start("z2", T(1), "queue", g2.send);
  clock += 4000;
  await g1.pass();
  clock += 9000;
  assert.equal(op.status("z1").seconds, 4);
  assert.equal(op.status("z2").seconds, 13);
  assert.equal(op.status("z2").done, false);
  await g2.pass();
  assert.match(lines[0], /ordered play "One": 1 of 1 tracks sent in 4 s$/);
});

test("three runs one after another: the middle one sends nothing, and no two are ever sending at once", async () => {
  const op = createOrderedPlay({ log: quiet });
  let flying = 0, most = 0;
  const order = [];
  const waiting = [];
  const send = (name) => (t) => new Promise((resolve) => {
    order.push(name + t.index);
    most = Math.max(most, ++flying);
    waiting.push(() => { flying--; resolve(); });
  });
  const tick = () => new Promise((r) => { setImmediate(r); });
  const land = async () => { await tick(); waiting.shift()(); await tick(); };
  op.start("z1", T(5), "play_now", send("a"));
  await land();                                      // a0 lands, a1 is with Roon
  op.start("z1", T(4), "play_now", send("b"));       // waits on a1
  const c = op.start("z1", T(2), "play_now", send("c"));
  await tick();
  assert.deepEqual(order, ["a0", "a1"], "neither sends while a1 is in flight");
  await land(); await land(); await land();
  assert.deepEqual(order, ["a0", "a1", "c0", "c1"]);
  assert.equal(most, 1);
  assert.deepEqual([op.status("z1").id, op.status("z1").done, op.status("z1").queued], [c.id, true, 2]);
});

test("Stop for a run still waiting its turn: answered once the zone is free, with nothing sent", async () => {
  const op = createOrderedPlay({ log: quiet });
  const a = gate(), b = gate();
  op.start("z1", T(3), "queue", a.send);
  await a.tick();
  op.start("z1", T(3), "queue", b.send);
  let answer = null;
  const stopping = op.stop("z1", "user").then((v) => { answer = v; });
  await a.tick();
  assert.equal(answer, null);
  await a.pass();
  await stopping;
  assert.deepEqual([answer.done, answer.stopped, answer.sent], [true, "user", 0]);
  assert.equal(b.sent.length, 0);
});

test("Stop by a run's id leaves a run the zone was given since", async () => {
  const op = createOrderedPlay({ log: quiet });
  const a = gate(), b = gate();
  const first = op.start("z1", T(3), "queue", a.send);
  await a.pass();
  const second = op.start("z1", T(3), "queue", b.send);
  const answer = await op.stop("z1", "user", first.id);
  assert.deepEqual([answer.id, answer.done], [second.id, false], "the answer is the run that is there, still going");
  await a.pass(); await b.pass(); await b.pass(); await b.pass();
  assert.deepEqual([op.status("z1").done, op.status("z1").stopped, op.status("z1").queued], [true, null, 3]);
  assert.equal((await op.stop("z1", "user", second.id)).id, second.id);
});

test("takeOver: the run is ended, its track in flight lands first, and what follows on the zone waits its turn", async () => {
  const op = createOrderedPlay({ log: quiet });
  const a = gate(), b = gate();
  const order = [];
  let tapLands = null;
  op.start("z1", T(5), "play_now", (t, k) => { order.push("a" + t.index); return a.send(t, k); });
  await a.pass();                                    // a0 lands, a1 is with Roon
  const tap = op.takeOver("z1", "other", () => new Promise((resolve) => { order.push("tap"); tapLands = () => resolve("played"); }));
  op.start("z1", T(2), "play_now", (t, k) => { order.push("b" + t.index); return b.send(t, k); });   // pressed while the tap is out
  await a.tick();
  assert.deepEqual(order, ["a0", "a1"], "the tap waits for the run's track in flight");
  await a.pass();
  assert.deepEqual(order, ["a0", "a1", "tap"], "and the next run waits for the tap");
  tapLands();
  assert.equal(await tap, "played");
  await b.pass(); await b.pass();
  assert.deepEqual(order, ["a0", "a1", "tap", "b0", "b1"]);

  // What the tap asked for failing is the tap's to report; the zone is not left waiting on it.
  const failing = op.takeOver("z2", "other", () => Promise.reject(new Error("Playlist changed")));
  await assert.rejects(failing, /Playlist changed/);
  const g = gate();
  op.start("z2", T(1), "queue", g.send);
  await g.pass();
  assert.equal(op.status("z2").queued, 1);
  assert.equal(await op.takeOver("z3", "other", async () => 7), 7, "a zone with no run: just done");

  // With nothing started after it, the run it took over from is still ended, and says what by.
  const c = gate();
  op.start("z5", T(5), "play_now", c.send);
  await c.pass();
  const over = op.takeOver("z5", "other", async () => "played");
  await c.pass();
  assert.equal(await over, "played");
  assert.deepEqual([op.status("z5").done, op.status("z5").stopped, op.status("z5").sent, c.sent.length], [true, "other", 2, 2]);
});

test("a run never ends as a rejection: whatever is thrown is a refusal, and a log that throws is not the run's end", async () => {
  const op = createOrderedPlay({ log: () => { throw new Error("disk full"); } });
  const odd = [Object.create(null), undefined, "just text", null];
  op.start("z1", T(4), "queue", () => Promise.reject(odd.shift()));
  await new Promise((r) => { setTimeout(r, 10); });
  const s = await op.stop("z1", "user");            // resolves: the run it waits on did not reject
  assert.deepEqual([s.done, s.sent, s.failed, s.first_error], [true, 4, 4, "refused"]);
  // The zone's next run is not held by it.
  const g = gate();
  op.start("z1", T(1), "queue", g.send);
  await g.pass();
  assert.equal(op.status("z1").queued, 1);
  op.start("z4", T(1), "queue", () => { throw new Error("thrown, not rejected"); });
  assert.equal((await op.stop("z4")).first_error, "thrown, not rejected");
});

test("the log line names what was refused; a run's time is its own sending; an ended run is forgotten after an hour", async () => {
  let clock = 5000;
  const lines = [];
  const op = createOrderedPlay({ log: (l) => lines.push(l), now: () => clock });
  const a = gate(), b = gate();
  op.start("z1", T(3), "queue", a.send, { title: "A" });
  await a.tick();
  op.start("z1", T(2), "queue", b.send, { title: "B" });
  clock += 30000;                                    // B waits half a minute on A's track
  await a.pass();
  clock += 2000;
  await b.refuse("Playlist changed — reopen it"); await b.pass();
  assert.match(lines[0], /"A": 1 of 3 tracks sent in 30 s, stopped \(replaced\)$/);
  assert.equal(lines[1], '[playlist] ordered play "B": 1 of 2 tracks sent in 2 s, 1 refused (Playlist changed — reopen it)');
  assert.equal(op.status("z1").seconds, 2);
  clock += 59 * 60 * 1000;
  op.start("z9", T(1), "queue", async () => {});
  assert.ok(op.status("z1"), "kept, so a page can read how it ended");
  clock += 2 * 60 * 1000;
  op.start("z8", T(1), "queue", async () => {});
  assert.equal(op.status("z1"), null);
});
