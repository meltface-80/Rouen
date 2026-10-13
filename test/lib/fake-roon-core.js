"use strict";
// ---------------------------------------------------------------------------
// A fake Roon Core speaking the internal protocol (TCP, port chosen by the OS)
// as lib/roon-direct expects it: the ROON handshake, the ConnectResponse, then
// remoting frames. Built from the wire rules ported in lib/roon-direct, so it
// proves Rouen keeps to those rules and to its own lifetime promises — not
// that a real Core behaves this way. dev/design/roon-native.md §6: the fake is
// not evidence; stage 0 on the owner's Core is.
//
// It holds a library of albums, each with a source and some tracks, and:
//  - accepts only the broker id it was given (anything else: the socket is
//    closed after the hello, as a Core with no such broker would);
//  - answers GETSVC for the root service, then pushes types and its objects
//    (a profile, the Library with its totals, one Location);
//  - answers Library::VirtualTrackQuery by reading the criteria struct the
//    client declared and sent, and pushes a query object with its Count;
//  - pushes a page's TrackLite and AlbumLite objects on RetainPage;
//  - records every DEFMETHOD signature called, every page retained and
//    released, every query disposed — so a test can hold the client to
//    "every page released once, every query disposed once, nothing else".
// ---------------------------------------------------------------------------

const net = require("node:net");
const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { FrameParser, encodeRequest, encodeResponse } = require("../../lib/roon-direct/frame");

const ROOT = "bcd36e8478a3e111b2725b4a6188709b";
const T = { Profile: 1, Library: 2, Location: 3, Query: 4, TrackLite: 5, AlbumLite: 6 };
const TYPES = [
  [T.Profile, "Sooloos.Broker.Api.Profile", [["System.Sooid Sooloos.Broker.Api.Profile::ProfileId", 4], ["string Sooloos.Broker.Api.Profile::Name", 20]]],
  [T.Library, "Sooloos.Broker.Api.Library", [["int Sooloos.Broker.Api.Library::AlbumCount", 0], ["int Sooloos.Broker.Api.Library::TrackCount", 0]]],
  [T.Location, "Sooloos.Broker.Api.Location", [["string Sooloos.Broker.Api.Location::DisplayName", 20], ["Sooloos.Broker.Api.LocationCategory Sooloos.Broker.Api.Location::Category", 9]]],
  [T.Query, "Sooloos.Broker.Api.VirtualTrackLiteQuery", [["int Sooloos.Broker.Api.VirtualTrackLiteQuery::Count", 0]]],
  [T.TrackLite, "Sooloos.Broker.Api.TrackLite", [["string Sooloos.Broker.Api.TrackLite::Title", 20], ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.TrackLite::Album", 23]]],
  [T.AlbumLite, "Sooloos.Broker.Api.AlbumLite", [["string Sooloos.Broker.Api.AlbumLite::Title", 20], ["string Sooloos.Broker.Api.AlbumLite::PerformedBy", 20]]],
];

/**
 * @param {object} o
 * @param {Buffer} o.brokerId                       the only id it accepts
 * @param {Array<{ title: string, artist: string, source: "local"|"tidal"|"qobuz", tracks: number }>} o.albums
 * @param {{ refuseQuery?: boolean, silentPages?: boolean, lateLocationMs?: number, slowRetainMs?: number,
 *            prePushSource?: string, pingOnClose?: boolean }} [o.faults]
 *   lateLocationMs: the Location is pushed this long after the rest of the graph;
 *   slowRetainMs: RetainPage is answered (and its tracks pushed) this late;
 *   prePushSource: that source's tracks are already in the initial graph, and
 *     pushed AGAIN when their page is retained (same object ids);
 *   pingOnClose: when the client half-closes, a ping asking for a reply is sent.
 */
function startFakeCore(o) {
  const rec = { signatures: [], retained: [], released: [], disposed: [], queries: [], opened: [], hellos: 0, connections: 0 };
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => { /* the client hung up mid-write: nothing to do */ });
    rec.connections++;
    let stage = 0, buf = Buffer.alloc(0);
    const parser = new FrameParser();
    const methods = new Map(), clientTypes = new Map();
    let nextOid = 1000n;
    const queries = new Map();   // oid string -> { source, tracks: [...] }
    const push = (cmd, body) => sock.write(encodeRequest(cmd, body, null));
    const obj = (oid, typeId, fields) => {
      const w = new BinaryWriter().long(oid).flexInt(typeId);
      for (const [idx, write] of fields) { w.flexInt(idx); write(w); }
      w.flexInt(0);
      push(3, w.toBuffer());
    };
    const ok = (rid, payload) => sock.write(encodeResponse(rid, Buffer.concat([new BinaryWriter().string("Success").toBuffer(), payload || Buffer.alloc(0)])));
    const albumOid = (i) => 50000n + BigInt(i);
    // Every track, with an object id that stays the same however often it is pushed.
    const allTracks = () => {
      const out = [];
      o.albums.forEach((a, i) => { for (let t = 0; t < a.tracks; t++) out.push({ title: `${a.title} ${t + 1}`, album: i, oid: 70000n + BigInt(out.length) }); });
      return out;
    };
    const pushTrack = (t) => {
      const a = o.albums[t.album];
      obj(albumOid(t.album), T.AlbumLite, [[1, (w) => w.string(a.title)], [2, (w) => w.string(a.artist)]]);
      obj(t.oid, T.TrackLite, [[1, (w) => w.string(t.title)], [2, (w) => w.long(albumOid(t.album))]]);
    };
    if (o.faults && o.faults.pingOnClose) sock.on("end", () => { if (!sock.destroyed) sock.write(encodeRequest(1, Buffer.alloc(0), 77)); });

    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 38) return;
        rec.hellos++;
        const id = buf.subarray(6, 22);
        buf = buf.subarray(38);
        if (!id.equals(o.brokerId)) { sock.destroy(); return; }
        stage = 1;
        sock.write(Buffer.concat([Buffer.from("ROON"), Buffer.from([0x01, 0x80])]));
      }
      if (stage === 1) {
        if (buf.length < 6) return;
        buf = buf.subarray(6);
        stage = 2;
        sock.write(Buffer.concat([Buffer.from("ROON"), Buffer.from([0x01, 0x82]), Buffer.alloc(16, 7)]));
      }
      if (stage === 2) {
        const frames = parser.push(buf);
        buf = Buffer.alloc(0);
        if (!frames.length) return;
        stage = 3;
        // The ConnectResponse: a reply to the ConnectRequest's request id.
        sock.write(encodeResponse(frames[0].rid || 1, Buffer.from("ok")));
        for (const f of frames.slice(1)) handle(f);
        return;
      }
      if (stage === 3) { const frames = parser.push(buf); buf = Buffer.alloc(0); for (const f of frames) handle(f); }
    });

    function handle(f) {
      if (f.isResponse) return;
      const r = new BinaryReader(f.body);
      if (f.cmd === 6) { methods.set(r.flexInt(), r.string()); return; }
      if (f.cmd === 5) {
        const id = r.flexInt(), name = r.string(), n = r.flexInt(), members = [];
        for (let i = 0; i < n; i++) members.push([r.string(), r.integer()]);
        clientTypes.set(id, { name, members });
        return;
      }
      if (f.cmd === 2) {
        const guid = r.guid().toString("hex");
        if (guid !== ROOT) { sock.write(encodeResponse(f.rid, new BinaryWriter().string("NoSuchService").toBuffer())); return; }
        ok(f.rid, new BinaryWriter().long(1n).toBuffer());
        for (const [id, name, members] of TYPES) {
          const w = new BinaryWriter().flexInt(id).string(name).flexInt(members.length);
          for (const [m, p] of members) w.string(m).integer(p);
          push(7, w.toBuffer());
        }
        const total = o.albums.reduce((n, a) => n + a.tracks, 0);
        obj(2n, T.Profile, [[1, (w) => w.sooid(Buffer.from("cafebabe", "hex"))], [2, (w) => w.string("Owner")]]);
        obj(3n, T.Library, [[1, (w) => w.integer(o.albums.length)], [2, (w) => w.integer(total)]]);
        const location = () => obj(4n, T.Location, [[1, (w) => w.string("Music")], [2, (w) => w.integer(0)]]);
        if (o.faults && o.faults.lateLocationMs) setTimeout(() => { if (!sock.destroyed) location(); }, o.faults.lateLocationMs);
        else location();
        if (o.faults && o.faults.prePushSource) {
          allTracks().filter((t) => o.albums[t.album].source === o.faults.prePushSource).forEach(pushTrack);
        }
        return;
      }
      if (f.cmd !== 3) return;
      const oid = r.long(), sig = methods.get(r.flexInt()) || "?";
      rec.signatures.push(sig);
      if (sig.includes("Library::VirtualTrackQuery")) {
        r.sooid();
        const source = readSource(r, clientTypes);
        rec.queries.push(source);
        if (o.faults && o.faults.refuseQuery) { sock.write(encodeResponse(f.rid, new BinaryWriter().string("Refused").toBuffer())); return; }
        const tracks = allTracks().filter((t) => o.albums[t.album].source === source);
        const q = nextOid++;
        queries.set(q.toString(), { source, tracks });
        rec.opened.push(q.toString());
        ok(f.rid, new BinaryWriter().long(q).toBuffer());
        obj(q, T.Query, [[1, (w) => w.integer(tracks.length)]]);
        return;
      }
      if (sig.includes("::RetainPage")) {
        const page = r.integer();
        rec.retained.push(`${oid}:${page}`);
        const answer = () => {
          if (sock.destroyed) return;
          ok(f.rid);
          if (o.faults && o.faults.silentPages) return;
          const q = queries.get(oid.toString());
          for (const t of q ? q.tracks.slice(page * 100, page * 100 + 100) : []) pushTrack(t);
        };
        if (o.faults && o.faults.slowRetainMs) setTimeout(answer, o.faults.slowRetainMs);
        else answer();
        return;
      }
      if (sig.includes("::ReleasePage")) { rec.released.push(`${oid}:${r.integer()}`); return; }
      if (sig.includes("::Dispose")) { rec.disposed.push(oid.toString()); return; }
    }
  });
  return new Promise((resolve) => { server.listen(0, "127.0.0.1", () => resolve({
    port: /** @type {net.AddressInfo} */ (server.address()).port,
    rec,
    // Resolves once every client connection has closed: the client's last
    // fire-and-forget calls (ReleasePage, Dispose) have all been read by then.
    idle: async (ms = 3000) => {
      const end = Date.now() + ms;
      while (sockets.size && Date.now() < end) await new Promise((r) => { setTimeout(r, 20); });
      if (sockets.size) throw new Error("the client never closed its connection");
    },
    close: () => new Promise((res) => { for (const s of sockets) s.destroy(); server.close(() => { res(); }); }),
  })); });
}

// Which source criterion the client set: read its declared TrackQueryCriteria
// and the inline struct it sent.
function readSource(r, clientTypes) {
  if (r.long() !== 1n) return "none";
  const t = clientTypes.get(r.integer());
  const sub = new BinaryReader(r.bytes(r.integer()));
  let source = "none";
  for (;;) {
    const idx = sub.flexInt();
    if (idx === 0) break;
    const [name, prop] = t.members[idx - 1];
    if (prop === 2) { const v = sub.boolean(); const m = /RequireIs(Local|Tidal|Qobuz)$/.exec(name); if (v && m) source = m[1].toLowerCase(); }
    else if (prop === 20) sub.string();
    else if (prop === 0) sub.integer();
    else throw new Error("the fake reads only bool, string and int members: " + name);
  }
  // the parameters struct follows; read and ignored
  return source;
}

module.exports = { startFakeCore };
