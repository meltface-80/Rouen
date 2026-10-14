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
//    (a profile, the Library with its totals, a Location per source and one
//    that holds no albums);
//  - answers Library::VirtualTrackQuery by reading the criteria struct the
//    client declared and sent, and pushes a query object with its Count;
//  - pushes a page's TrackLite and AlbumLite objects on RetainPage;
//  - answers Library::VirtualAlbumQuery by reading RequireLocations (a
//    LengthPrefixed list of Location ids, as lib/roon-direct sends it) and
//    pushes a query object whose Count is the albums in those Locations —
//    with no Count member at all when it is 0, as a sparse struct may be;
//  - records every DEFMETHOD signature called, every page retained and
//    released, every query disposed — so a test can hold the client to
//    "every page released once, every query disposed once, nothing else".
// ---------------------------------------------------------------------------

const net = require("node:net");
const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { FrameParser, encodeRequest, encodeResponse } = require("../../lib/roon-direct/frame");

const ROOT = "bcd36e8478a3e111b2725b4a6188709b";
const T = { Profile: 1, Library: 2, Location: 3, Query: 4, TrackLite: 5, AlbumLite: 6, AlbumQuery: 7, Row: 8, Image: 9 };
// MediaSource (the catalogue's enum): an album's ContentSource.
const MEDIA = { local: 1, tidal: 128, qobuz: 256 };
// The Locations: one per source, and one holding no albums. Categories as the
// owner's Core reported them (v1.9.12): 100 storage, 400 streaming, 500 other.
const LOCATIONS = [
  { oid: 4n, name: "Music", category: 100, type: 104, source: "local" },
  { oid: 5n, name: "TIDAL", category: 400, type: 406, source: "tidal" },
  { oid: 6n, name: "QOBUZ", category: 400, type: 407, source: "qobuz" },
  { oid: 7n, name: "Internet Media", category: 500, type: 501, source: null },
];
const TYPES = [
  [T.Profile, "Sooloos.Broker.Api.Profile", [["System.Sooid Sooloos.Broker.Api.Profile::ProfileId", 4], ["string Sooloos.Broker.Api.Profile::Name", 20]]],
  [T.Library, "Sooloos.Broker.Api.Library", [["int Sooloos.Broker.Api.Library::AlbumCount", 0], ["int Sooloos.Broker.Api.Library::TrackCount", 0]]],
  [T.Location, "Sooloos.Broker.Api.Location", [["string Sooloos.Broker.Api.Location::DisplayName", 20], ["Sooloos.Broker.Api.LocationCategory Sooloos.Broker.Api.Location::Category", 9], ["Sooloos.Broker.Api.LocationType Sooloos.Broker.Api.Location::Type", 9]]],
  [T.Query, "Sooloos.Broker.Api.VirtualTrackLiteQuery", [["int Sooloos.Broker.Api.VirtualTrackLiteQuery::Count", 0]]],
  [T.TrackLite, "Sooloos.Broker.Api.TrackLite", [["string Sooloos.Broker.Api.TrackLite::Title", 20], ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.TrackLite::Album", 23]]],
  [T.AlbumLite, "Sooloos.Broker.Api.AlbumLite", [["string Sooloos.Broker.Api.AlbumLite::Title", 20], ["string Sooloos.Broker.Api.AlbumLite::PerformedBy", 20],
    ["Sooloos.Broker.Api.MediaSource Sooloos.Broker.Api.AlbumLite::ContentSource", 9], ["Sooloos.Broker.Api.MediaSource Sooloos.Broker.Api.AlbumLite::Source", 9],
    ["Sooloos.Broker.Api.Image Sooloos.Broker.Api.AlbumLite::Image", 23]]],
  [T.Image, "Sooloos.Broker.Api.Image", [["string Sooloos.Broker.Api.Image::Url", 20]]],
  [T.AlbumQuery, "Sooloos.Broker.Api.VirtualAlbumLiteQuery", [["int Sooloos.Broker.Api.VirtualAlbumLiteQuery::Count", 0]]],
  [T.Row, "Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.AlbumLite>", [["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.AlbumLite>::Data", 23]]],
];

/**
 * @param {object} o
 * @param {Buffer} o.brokerId                       the only id it accepts
 * @param {Array<{ title: string, artist: string, source: "local"|"tidal"|"qobuz", tracks: number }>} o.albums
 * @param {{ refuseQuery?: boolean, silentPages?: boolean, lateLocationMs?: number, slowRetainMs?: number,
 *            prePushSource?: string, pingOnClose?: boolean, ignoreLocations?: boolean,
 *            refuseAlbumQuery?: string, noAlbumQueryObject?: boolean | string, noLocations?: boolean,
 *            slowAlbumQueryMs?: number, lateCountMs?: number, rowsOnly?: boolean, noContentSource?: boolean,
 *            wrongContentSource?: string, shortAlbumPages?: boolean | string, tidalLibrary?: "all" | "split",
 *            emptyLocation?: string, lateAlbumFieldsMs?: number, noRows?: boolean, refuseAlbumPages?: boolean,
 *            silentTrackPages?: boolean, extraRow?: boolean, sparseCount?: boolean }} [o.faults]
 *   lateLocationMs: the "Music" Location is pushed this long after the rest of the graph;
 *   ignoreLocations: an album query counts every album, whatever RequireLocations says;
 *   refuseAlbumQuery: "all" refuses every album query, "filtered" only those with RequireLocations;
 *   noAlbumQueryObject: an album query is answered but its query object never pushed
 *     ("filtered": only those with RequireLocations);
 *   noLocations: no Location is pushed;
 *   slowAlbumQueryMs: an album query with RequireLocations is answered this late;
 *   lateCountMs: an album query with RequireLocations is pushed with no Count, and pushed
 *     again with its Count this much later;
 *   rowsOnly: an album page pushes its rows (VirtualQueryElement, Data = the album) and not
 *     the albums again; noContentSource: albums carry no ContentSource;
 *   wrongContentSource: that source's albums say TIDAL (128) whatever they are;
 *   shortAlbumPages: an album page leaves out its last album (true: every Location's; a
 *     name: that Location's only);
 *   tidalLibrary: a "TIDAL Library" Location (406) as on the owner's Core: "all" holds every
 *     TIDAL album and "TIDAL" none; "split" shares them, TIDAL the even ones;
 *   emptyLocation: that Location holds none of its source's albums;
 *   lateAlbumFieldsMs: an album page pushes its rows, and the albums' fields this much later;
 *   noRows: an album page pushes the albums and no rows; refuseAlbumPages: refused;
 *   silentTrackPages: a track page is answered but pushes nothing (album pages work);
 *   sparseCount: an album query's object is pushed with no Count member, whatever its count;
 *   extraRow: an album query's last page carries one more album than its Count, as a
 *     library that changed while it was read might;
 *   slowRetainMs: RetainPage is answered (and its tracks pushed) this late;
 *   prePushSource: that source's tracks are already in the initial graph, and
 *     pushed AGAIN when their page is retained (same object ids);
 *   pingOnClose: when the client half-closes, a ping asking for a reply is sent.
 */
function startFakeCore(o) {
  const rec = { signatures: [], retained: [], released: [], disposed: [], queries: [], albumQueries: [], opened: [], hellos: 0, connections: 0 };
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
    // This connection's Locations, and which albums each holds.
    const f0 = o.faults || {};
    const locs = LOCATIONS.concat(f0.tidalLibrary ? [{ oid: 8n, name: "TIDAL Library", category: 400, type: 406, source: "tidal" }] : []);
    const holds = (l) => {
      if (!l.source || f0.emptyLocation === l.name) return [];
      const mine = o.albums.map((a, i) => i).filter((i) => o.albums[i].source === l.source);
      if (l.source !== "tidal" || !f0.tidalLibrary) return mine;
      if (f0.tidalLibrary === "all") return l.name === "TIDAL" ? [] : mine;
      return mine.filter((i, k) => (l.name === "TIDAL" ? k % 2 === 0 : k % 2 === 1));
    };
    const pushAlbum = (i) => {
      const a = o.albums[i], f = o.faults || {};
      const cs = f.wrongContentSource === a.source ? 128 : MEDIA[a.source];
      // The cover, an inline Image whose Url carries its key: "img<i>".
      const cover = new BinaryWriter().flexInt(1).string(`broker:///image/img${i}.jpg`).flexInt(0).toBuffer();
      // An empty title is left out, as a sparse struct leaves out any default.
      obj(albumOid(i), T.AlbumLite, [...(a.title ? [[1, (w) => w.string(a.title)]] : []), [2, (w) => w.string(a.artist)],
        ...(f.noContentSource ? [] : [[3, (w) => w.flexInt(cs)]]), [4, (w) => w.flexInt(1)],
        [5, (w) => w.long(1).flexInt(T.Image).flexInt(cover.length).bytes(cover)]]);
    };
    let nextRow = 90000n;
    const pushTrack = (t) => {
      pushAlbum(t.album);
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
        const location = (l) => obj(l.oid, T.Location, [[1, (w) => w.string(l.name)], [2, (w) => w.flexInt(l.category)], [3, (w) => w.flexInt(l.type)]]);
        for (const l of (o.faults && o.faults.noLocations) ? [] : locs) {
          if (l.name === "Music" && o.faults && o.faults.lateLocationMs) setTimeout(() => { if (!sock.destroyed) location(l); }, o.faults.lateLocationMs);
          else location(l);
        }
        if (o.faults && o.faults.prePushSource) {
          allTracks().filter((t) => o.albums[t.album].source === o.faults.prePushSource).forEach(pushTrack);
        }
        return;
      }
      if (f.cmd !== 3) return;
      const oid = r.long(), sig = methods.get(r.flexInt()) || "?";
      rec.signatures.push(sig);
      if (sig.includes("Library::VirtualAlbumQuery")) {
        r.sooid();
        const { locations } = readCriteria(r, clientTypes);
        const names = locations ? locations.map((l) => (locs.find((x) => x.oid === l) || { name: `?${l}` }).name) : null;
        rec.albumQueries.push(names || "all");
        const refuse = o.faults && o.faults.refuseAlbumQuery;
        if (refuse === "all" || (refuse === "filtered" && locations)) { sock.write(encodeResponse(f.rid, new BinaryWriter().string("Refused").toBuffer())); return; }
        const members = !locations || (o.faults && o.faults.ignoreLocations) ? o.albums.map((a, i) => i)
          : [...new Set(locs.filter((l) => locations.includes(l.oid)).flatMap(holds))].sort((a, b) => a - b);
        const count = members.length;
        const answer = () => {
          if (sock.destroyed) return;
          const q = nextOid++;
          rec.opened.push(q.toString());
          queries.set(q.toString(), { albums: members, names: names || [] });
          ok(f.rid, new BinaryWriter().long(q).toBuffer());
          const silent = o.faults && o.faults.noAlbumQueryObject;
          if (silent === true || (silent === "filtered" && locations)) return;
          if (locations && o.faults && o.faults.lateCountMs) {
            obj(q, T.AlbumQuery, []);
            setTimeout(() => { if (!sock.destroyed) obj(q, T.AlbumQuery, [[1, (w) => w.integer(count)]]); }, o.faults.lateCountMs);
            return;
          }
          obj(q, T.AlbumQuery, count && !f0.sparseCount ? [[1, (w) => w.integer(count)]] : []);
        };
        if (locations && o.faults && o.faults.slowAlbumQueryMs) setTimeout(answer, o.faults.slowAlbumQueryMs);
        else answer();
        return;
      }
      if (sig.includes("Library::VirtualTrackQuery")) {
        r.sooid();
        const { source } = readCriteria(r, clientTypes);
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
        // Recorded as held only when granted: a refused page is not the client's to release.
        const q = queries.get(oid.toString());
        if (q && q.albums && f0.refuseAlbumPages) { sock.write(encodeResponse(f.rid, new BinaryWriter().string("Refused").toBuffer())); return; }
        rec.retained.push(`${oid}:${page}`);
        const answer = () => {
          if (sock.destroyed) return;
          ok(f.rid);
          if (f0.silentPages || (f0.silentTrackPages && !(q && q.albums))) return;
          if (q && q.albums) {
            const rows = q.albums.slice(page * 100, page * 100 + 100);
            const short = f0.shortAlbumPages === true || (typeof f0.shortAlbumPages === "string" && q.names.includes(f0.shortAlbumPages));
            const page_ = short ? rows.slice(0, -1) : rows;
            const albums = () => { if (!sock.destroyed && !f0.rowsOnly) page_.forEach(pushAlbum); };
            if (!f0.lateAlbumFieldsMs) albums();
            if (!f0.noRows) for (const i of page_) obj(nextRow++, T.Row, [[1, (w) => w.long(albumOid(i))]]);
            if (f0.lateAlbumFieldsMs) setTimeout(albums, f0.lateAlbumFieldsMs);
            if (f0.extraRow && (page + 1) * 100 >= q.albums.length) {
              obj(albumOid(99999), T.AlbumLite, [[1, (w) => w.string("Added meanwhile")], [2, (w) => w.string("Someone")]]);
              obj(nextRow++, T.Row, [[1, (w) => w.long(albumOid(99999))]]);
            }
            return;
          }
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

// What the client asked for: read its declared criteria type and the inline
// struct it sent — the source criterion a track query set, and the Location
// ids an album query's RequireLocations listed (null when not sent).
function readCriteria(r, clientTypes) {
  /** @type {{ source: string, locations: bigint[] | null }} */
  const out = { source: "none", locations: null };
  if (r.long() !== 1n) return out;
  const t = clientTypes.get(r.integer());
  const sub = new BinaryReader(r.bytes(r.integer()));
  for (;;) {
    const idx = sub.flexInt();
    if (idx === 0) break;
    const [name, prop] = t.members[idx - 1];
    if (prop === 2) { const v = sub.boolean(); const m = /RequireIs(Local|Tidal|Qobuz)$/.exec(name); if (v && m) out.source = m[1].toLowerCase(); }
    else if (prop === 20) sub.string();
    else if (prop === 0) sub.integer();
    else if (prop === 24 && name.endsWith("::RequireLocations")) {
      const list = new BinaryReader(sub.bytes(sub.integer()));
      out.locations = [];
      for (let n = list.flexInt(); n > 0; n--) out.locations.push(list.long());
      if (list.pos !== list.buf.length) throw new Error("RequireLocations carried bytes after its elements");
    }
    else throw new Error("the fake reads only bool, string, int and a LengthPrefixed RequireLocations: " + name + " as " + prop);
  }
  // the parameters struct follows; read and ignored
  return out;
}

module.exports = { startFakeCore };
