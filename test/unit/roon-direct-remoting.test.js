"use strict";
// ---------------------------------------------------------------------------
// v1.9.11: the remoting layer's budget (dev/design/roon-native.md §3: "max
// in-flight calls, timeouts, so a stall cannot pile up work inside the Core")
// and the object graph's reading of pushed types and objects, over a
// stand-in transport.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { RemotingClient } = require("../../lib/roon-direct/remoting");
const { ObjectGraph, P, field, isRef } = require("../../lib/roon-direct/objects");
const { FrameParser, encodeRequest, encodeResponse } = require("../../lib/roon-direct/frame");
const { BinaryWriter } = require("../../lib/roon-direct/wire");

function transport() {
  const sent = [];
  let onData = () => {};
  return { sent, send: (b) => sent.push(b), onData: (h) => { onData = h; }, deliver: (b) => onData(b) };
}
const frames = (bufs) => new FrameParser().push(Buffer.concat(bufs));
const success = (rid, payload = Buffer.alloc(0)) => encodeResponse(rid, Buffer.concat([new BinaryWriter().string("Success").toBuffer(), payload]));

test("remoting: a method is declared once, before its first call", async () => {
  const t = transport();
  const rc = new RemotingClient(t, { timeoutMs: 200 });
  const a = rc.call(5n, "X::A()", Buffer.alloc(0));
  t.deliver(success(1));
  await a;
  const b = rc.call(5n, "X::A()", Buffer.alloc(0));
  t.deliver(success(2));
  await b;
  const cmds = frames(t.sent).map((f) => f.cmd);
  assert.deepEqual(cmds, [6, 3, 3], "DEFMETHOD once, then two CALLs");
});

test("remoting: the budget — at most two calls waiting, each with a timeout", async () => {
  const t = transport();
  const rc = new RemotingClient(t, { timeoutMs: 100, maxInFlight: 2 });
  const one = rc.call(1n, "X::A()", Buffer.alloc(0)).catch((e) => e);
  const two = rc.call(1n, "X::A()", Buffer.alloc(0)).catch((e) => e);
  await assert.rejects(rc.call(1n, "X::A()", Buffer.alloc(0)), /already 2 calls waiting/);
  assert.equal(frames(t.sent).filter((f) => f.cmd === 3).length, 2, "THE one: the third never left");
  assert.match((await one).message, /did not answer call 1 within 100 ms/);
  assert.match((await two).message, /did not answer call 2 within 100 ms/);
  const late = rc.call(1n, "X::A()", Buffer.alloc(0));
  t.deliver(success(3));
  assert.equal((await late).success, true, "the budget comes back once they time out");
});

test("remoting: a closed connection fails every waiting call at once, and refuses new ones", async () => {
  const t = transport();
  const rc = new RemotingClient(t, { timeoutMs: 5000 });
  const waiting = rc.call(1n, "X::A()", Buffer.alloc(0));
  rc.failPending("the connection closed");
  await assert.rejects(waiting, /the connection closed/);
  await assert.rejects(rc.call(1n, "X::A()", Buffer.alloc(0)), /connection closed/);
  const before = t.sent.length;
  rc.callNoReply(1n, "X::Dispose()", Buffer.alloc(0));
  assert.equal(t.sent.length, before, "nothing is written to a closed connection");
});

test("remoting: pings and pushes that ask for it are acknowledged; pushes reach the graph", () => {
  const t = transport();
  const rc = new RemotingClient(t);
  const pushed = [];
  rc.onPush = (f) => pushed.push(f.cmd);
  t.deliver(Buffer.concat([encodeRequest(1, Buffer.alloc(0), 9), encodeRequest(3, Buffer.from([0]), 10), encodeRequest(7, Buffer.from([0]), null)]));
  const acks = frames(t.sent).filter((f) => f.isResponse).map((f) => f.rid);
  assert.deepEqual(acks, [9, 10]);
  assert.deepEqual(pushed, [3, 7], "the ping is not a push");
});

test("remoting: a type is declared once; again with other members is refused", () => {
  const rc = new RemotingClient(transport());
  const id = rc.defineType("T", [{ name: "a", propType: 0 }]);
  assert.equal(rc.defineType("T", [{ name: "a", propType: 0 }]), id);
  assert.throws(() => rc.defineType("T", [{ name: "b", propType: 0 }]), /declared with other members/);
});

function deftype(id, name, members) {
  const w = new BinaryWriter().flexInt(id).string(name).flexInt(members.length);
  for (const [m, p] of members) w.string(m).integer(p);
  return { isResponse: false, cmd: 7, rid: null, isFinal: false, body: w.toBuffer() };
}
function pushobj(cmd, oid, typeId, fields) {
  const w = new BinaryWriter().long(oid).flexInt(typeId);
  for (const [i, f] of fields) { w.flexInt(i); f(w); }
  w.flexInt(0);
  return { isResponse: false, cmd, rid: null, isFinal: false, body: w.toBuffer() };
}

test("objects: pushed objects read by their declared types; a stub never erases; refs and inline values", () => {
  const g = new ObjectGraph();
  g.ingest(deftype(1, "Sooloos.Broker.Api.TrackLite", [["string X::Title", P.String], ["Sooloos.Broker.Api.AlbumLite X::Album", P.Object], ["int? X::Disc", P.NullableInt]]));
  g.ingest(deftype(2, "Sooloos.Broker.Api.Link", [["long X::Id", P.Long]]));
  g.ingest(pushobj(3, 77n, 1, [[1, (w) => w.string("Teardrop")], [2, (w) => w.long(500n)], [3, (w) => w.boolean(true).integer(1)]]));
  g.ingest(pushobj(4, 77n, 1, []));
  const t = g.get(77n);
  assert.equal(field(t, "Title"), "Teardrop");
  assert.ok(isRef(field(t, "Album")) && field(t, "Album").$ref === 500n);
  assert.equal(field(t, "Disc"), 1);
  assert.equal(g.ofType("TrackLite").length, 1);
  // an inline by-value object inside an Object member
  const inline = new BinaryWriter().flexInt(1).long(42n).flexInt(0).toBuffer();
  g.ingest(pushobj(5, 77n, 1, [[2, (w) => w.long(1).integer(2).integer(inline.length).bytes(inline)]]));
  assert.deepEqual(field(g.get(77n), "Album"), { $type: "Sooloos.Broker.Api.Link", "long X::Id": 42n });
});

test("objects: a body cut short keeps what was read; the graph stops at its cap and says so", () => {
  const g = new ObjectGraph(2);
  g.ingest(deftype(1, "T", [["string X::A", P.String], ["string X::B", P.String]]));
  const full = pushobj(3, 1n, 1, [[1, (w) => w.string("kept")], [2, (w) => w.string("lost")]]);
  g.ingest(Object.assign({}, full, { body: full.body.subarray(0, full.body.length - 4) }));
  assert.equal(field(g.get(1n), "A"), "kept");
  assert.equal(field(g.get(1n), "B"), undefined, "THE one: nothing invented from a truncated value");
  g.ingest(pushobj(3, 2n, 1, []));
  g.ingest(pushobj(3, 3n, 1, []));
  assert.equal(g.objects.size, 2);
  assert.equal(g.overflowed, true);
});

test("connection: close() sends what is still queued before it hangs up (a Core slow to read)", async (t) => {
  const net = require("node:net");
  const { RoonConnection } = require("../../lib/roon-direct/connection");
  const MARK = Buffer.from("LAST-DISPOSE");
  let received = Buffer.alloc(0), resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const server = net.createServer((sock) => {
    let stage = 0, buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      if (stage === 3) { received = Buffer.concat([received, d]); return; }
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 38) { buf = buf.subarray(38); stage = 1; sock.write(Buffer.concat([Buffer.from("ROON"), Buffer.from([1, 0x80])])); }
      if (stage === 1 && buf.length >= 6) { buf = buf.subarray(6); stage = 2; sock.write(Buffer.concat([Buffer.from("ROON"), Buffer.from([1, 0x82]), Buffer.alloc(16)])); }
      if (stage === 2 && new FrameParser().push(buf).length) {
        stage = 3;
        sock.write(encodeResponse(1, Buffer.from("ok")));
        // A Core busy elsewhere: it stops reading for a while.
        sock.pause();
        setTimeout(() => sock.resume(), 300);
      }
    });
    sock.on("end", () => resolveDone());
    sock.on("close", () => resolveDone());
    sock.on("error", () => { /* the client cut us off: the assertion below says whether that lost data */ });
  });
  await new Promise((r) => { server.listen(0, "127.0.0.1", r); });
  t.after(() => new Promise((r) => { server.close(() => { r(); }); }));
  const conn = new RoonConnection({ host: "127.0.0.1", port: server.address().port, serverBrokerId: Buffer.alloc(16) });
  await conn.connect();
  // More than the kernel will buffer while the peer is not reading, so the
  // tail waits in Node's own queue — where a destroyed socket drops it.
  for (let i = 0; i < 64; i++) conn.send(Buffer.alloc(256 * 1024, 0x61));
  conn.send(MARK);
  conn.close();
  await done;
  assert.equal(received.length, 64 * 256 * 1024 + MARK.length, "THE one: everything written before close() arrived");
  assert.ok(received.subarray(-MARK.length).equals(MARK));
});

test("frames: after an oversize frame, nothing more is buffered (the cap really bounds memory)", () => {
  const p = new FrameParser(100);
  assert.throws(() => p.push(encodeRequest(3, Buffer.alloc(101), 1)), /over the 100-byte limit/);
  for (let i = 0; i < 50; i++) assert.deepEqual(p.push(Buffer.alloc(10000, 1)), []);
  assert.equal(p.buf.length, 0, "THE one: what arrives after it is dropped, not kept");
});

test("remoting: after close, releases report not sent and acknowledgements are not attempted", () => {
  const sent = [];
  let onData = () => {}, attempts = 0;
  let open = true;
  const tr = { send: (b) => { attempts++; if (!open) return false; sent.push(b); return true; }, onData: (h) => { onData = h; } };
  const rc = new RemotingClient(tr);
  assert.equal(rc.callNoReply(1n, "X::Dispose()", Buffer.alloc(0)), true);
  open = false;
  assert.equal(rc.callNoReply(1n, "X::Dispose()", Buffer.alloc(0)), false, "THE one: a release on a closed transport is not reported as sent");
  rc.failPending("closed");
  const before = attempts;
  onData(encodeRequest(1, Buffer.alloc(0), 4));
  assert.equal(attempts, before, "a ping after this side closed is not even attempted");
});

test("connection: after close() nothing more is read, and sending is refused quietly, not thrown", async (t) => {
  const net = require("node:net");
  const { RoonConnection } = require("../../lib/roon-direct/connection");
  let serverSock;
  const server = net.createServer((sock) => {
    serverSock = sock;
    let stage = 0, buf = Buffer.alloc(0);
    sock.on("error", () => { /* the client went: expected */ });
    sock.on("data", (d) => {
      if (stage === 3) return;
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 38) { buf = buf.subarray(38); stage = 1; sock.write(Buffer.concat([Buffer.from("ROON"), Buffer.from([1, 0x80])])); }
      if (stage === 1 && buf.length >= 6) { buf = buf.subarray(6); stage = 2; sock.write(Buffer.concat([Buffer.from("ROON"), Buffer.from([1, 0x82]), Buffer.alloc(16)])); }
      if (stage === 2 && new FrameParser().push(buf).length) { stage = 3; sock.write(encodeResponse(1, Buffer.from("ok"))); }
    });
  });
  await new Promise((r) => { server.listen(0, "127.0.0.1", r); });
  t.after(() => new Promise((r) => { server.close(() => { r(); }); }));
  const conn = new RoonConnection({ host: "127.0.0.1", port: server.address().port, serverBrokerId: Buffer.alloc(16) });
  const got = [];
  conn.onData((c) => got.push(c.length));
  await conn.connect();
  await new Promise((r) => { setTimeout(r, 50); });
  const before = got.length;
  conn.close();
  assert.equal(conn.send(Buffer.from("x")), false, "THE one: a send after close is refused, not thrown");
  serverSock.write(encodeRequest(1, Buffer.alloc(0), 5));   // a ping, while the client is closing
  await new Promise((r) => { setTimeout(r, 100); });
  assert.equal(got.length, before, "THE one: nothing the Core sends after close() is handed on");
});

// v1.9.24: the keepalive the server reaps a connection without.
test("remoting: a keepalive is a PING asking for an answer; answered or not, it makes nothing uncertain", async () => {
  const t = transport();
  const rc = new RemotingClient(t, { timeoutMs: 80, maxInFlight: 2 });
  const busy = [rc.call(1n, "X::A()", Buffer.alloc(0)).catch(() => {}), rc.call(1n, "X::A()", Buffer.alloc(0)).catch(() => {})];
  const p = rc.ping(500);
  const ping = frames(t.sent).find((f) => f.cmd === 1);
  assert.ok(ping && ping.rid !== null, "THE one: no keepalive left while two calls were waiting");
  t.deliver(encodeResponse(ping.rid, Buffer.alloc(0)));
  assert.equal(await p, true);
  await Promise.all(busy);
  const silent = new RemotingClient(transport(), { timeoutMs: 1000 });
  // A keepalive's timer does not hold the process open (it is unref'd): this test does, meanwhile.
  const hold = setTimeout(() => {}, 1000);
  assert.equal(await silent.ping(50), false);
  clearTimeout(hold);
  assert.equal(silent.uncertain, "", "an unanswered keepalive marked the session as holding something unknown");
  const closed = new RemotingClient(transport());
  const waiting = closed.ping(5000);
  closed.failPending("the connection closed");
  assert.equal(await waiting, false, "a keepalive waits on a closed connection");
});

test("remoting: keepalives every interval from the start, counted, and stopped when the connection closes", async () => {
  const t = transport();
  const rc = new RemotingClient(t, { timeoutMs: 1000 });
  const hold = setTimeout(() => {}, 2000);
  rc.startKeepalive(40);
  assert.equal(frames(t.sent).filter((f) => f.cmd === 1).length, 1, "THE one: the first keepalive waited a whole interval");
  const first = frames(t.sent).find((f) => f.cmd === 1);
  t.deliver(encodeResponse(first.rid, Buffer.alloc(0)));
  await new Promise((r) => { setTimeout(r, 130); });
  const k = rc.keepalive;
  assert.ok(k.sent >= 3, JSON.stringify(k));
  assert.equal(k.answered, 1);
  assert.ok(k.missed >= 1, "missed in a row since the last answer: " + JSON.stringify(k));
  rc.failPending("the connection closed");
  const sent = frames(t.sent).filter((f) => f.cmd === 1).length;
  await new Promise((r) => { setTimeout(r, 120); });
  assert.equal(frames(t.sent).filter((f) => f.cmd === 1).length, sent, "keepalives went on after the connection closed");
  clearTimeout(hold);
});
