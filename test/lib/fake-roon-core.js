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
const { handleHeart, profileData, BROKER_OID } = require("./fake-roon-hearts");
const { handleSearch, SEARCH_TYPES } = require("./fake-roon-search");
const { handleLater, LATER_TYPES } = require("./fake-roon-later");

const ROOT = "bcd36e8478a3e111b2725b4a6188709b";
const T = { Profile: 1, Library: 2, Location: 3, Query: 4, TrackLite: 5, AlbumLite: 6, AlbumQuery: 7, Row: 8, Image: 9, Broker: 10, TrackRow: 11 };
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
  [T.TrackLite, "Sooloos.Broker.Api.TrackLite", [["string Sooloos.Broker.Api.TrackLite::Title", 20], ["Sooloos.Broker.Api.AlbumLite Sooloos.Broker.Api.TrackLite::Album", 23],
    ["Sooloos.Broker.Api.ProfileData<bool> Sooloos.Broker.Api.TrackLite::IsFavorite", 24]]],
  [T.AlbumLite, "Sooloos.Broker.Api.AlbumLite", [["string Sooloos.Broker.Api.AlbumLite::Title", 20], ["string Sooloos.Broker.Api.AlbumLite::PerformedBy", 20],
    ["Sooloos.Broker.Api.MediaSource Sooloos.Broker.Api.AlbumLite::ContentSource", 9], ["Sooloos.Broker.Api.MediaSource Sooloos.Broker.Api.AlbumLite::Source", 9],
    ["Sooloos.Broker.Api.Image Sooloos.Broker.Api.AlbumLite::Image", 23], ["long Sooloos.Broker.Api.AlbumLite::AlbumId", 1],
    ["Sooloos.Broker.Api.ProfileData<bool> Sooloos.Broker.Api.AlbumLite::IsFavorite", 24]]],
  [T.Image, "Sooloos.Broker.Api.Image", [["string Sooloos.Broker.Api.Image::Url", 20]]],
  [T.Broker, "Sooloos.Broker.Api.Broker", [["string Sooloos.Broker.Api.Broker::Name", 20]]],
  [T.TrackRow, "Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.TrackLite>", [["Sooloos.Broker.Api.TrackLite Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.TrackLite>::Data", 23]]],
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
 *            silentTrackPages?: boolean, extraRow?: boolean, sparseCount?: boolean, sentOnce?: boolean,
 *            wholeUpdates?: boolean, albumHeartPushed?: boolean | "first" }} [o.faults]
 * @param {Array<{ title: string, artist: string, source: "tidal"|"qobuz", noAlbumId?: boolean }>} [o.catalog]
 *   the streaming catalogue the search finds (N2b-1, fake-roon-search.js): albums not in the library;
 *   faults refuseSearch, lateSearch (objects after the answer), incompleteSearch (the album list never comes)
 * @param {Array<{ catalog: number } | { library: number }>} [o.listenLater]  Roon's own Listen Later (N2c-0,
 *   fake-roon-later.js): catalogue and library albums, by index; its faults are named there
 * @param {number} [o.reapMs]  as the owner's server does (v1.9.24): a connection the client has
 *   sent nothing to for this long is closed — "no keepalive … reaping dead peer". Any request
 *   counts (the owner's log: each session was reaped 34 s after its read's last call), not the
 *   client's answers to the server's own pings.
 *   lateLocationMs: the "Music" Location is pushed this long after the rest of the graph;
 *   ignoreLocations: an album query counts every album, whatever RequireLocations says;
 *   refuseAlbumQuery: "all" refuses every album query, "filtered" only those with RequireLocations;
 *   noAlbumQueryObject: an album query is answered but its query object never pushed
 *     ("filtered": only those with RequireLocations);
 *   noLocations: no Location is pushed;
 *   slowAlbumQueryMs: an album query with RequireLocations is answered this late;
 *   lateCountMs: an album query with RequireLocations is pushed with no Count, and pushed
 *     again with its Count this much later;
 *   sentOnce: each album's details are sent once a connection, as the owner's server does;
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
 *   wholeUpdates: a favourite changed is pushed as the whole album again (a sparse struct, so an
 *     IsFavorite of no one's is left out), not as its IsFavorite alone;
 *   albumHeartPushed: an album heart is followed by the album's update to each connection holding it
 *     ("first": the update is pushed before the heart is answered).
 */
function startFakeCore(o) {
  const rec = { signatures: [], retained: [], released: [], disposed: [], queries: [], albumQueries: [], opened: [], hellos: 0, connections: 0,
    pings: 0, reaped: 0, hearts: [], trackQueries: [], searches: [], searchDisposed: [], laterAsks: [] };
  /** Tracks hearted, by object id (v1.9.27): shared by every connection, as the Core's library is. */
  const trackFav = new Map();
  /** Each connection's way to push an album's changed favourite to it (v1.9.28). @type {Set<(i: number) => void>} */
  const favouriteUpdaters = new Set();
  /** @type {Set<(i: number) => void>} */
  const retitlers = new Set();
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
    // An album's object id; `oid` given: a catalogue album since added to the library, the same object (find.test.js).
    const albumOid = (i) => (o.albums[i] && o.albums[i].oid !== undefined ? BigInt(o.albums[i].oid) : 50000n + BigInt(i));
    // An album's stable id, unlike its object id the same on every connection.
    const albumIdOf = (i) => 7000000000000n + BigInt(i);
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
    /** Albums this connection has been sent (v1.9.28), by object id: the library's and the catalogue's alike. @type {Set<string>} */
    const sent = new Set();
    // force: an update of an album the client was sent, whatever sentOnce says.
    const pushAlbum = (i, force) => {
      const a = o.albums[i], f = o.faults || {};
      // sentOnce: as the owner's server does (the v1.9.17 probe: "pages came as rows alone",
      // their albums sent before) — an album is sent once a connection, never again on it.
      if (f.sentOnce && sent.has(String(albumOid(i))) && !force) return;
      sent.add(String(albumOid(i)));
      const cs = f.wrongContentSource === a.source ? 128 : MEDIA[a.source];
      // The cover, an inline Image whose Url carries its key: "img<i>".
      const cover = new BinaryWriter().flexInt(1).string(`broker:///image/img${i}.jpg`).flexInt(0).toBuffer();
      // An empty title is left out, as a sparse struct leaves out any default.
      obj(albumOid(i), T.AlbumLite, [...(a.title ? [[1, (w) => w.string(a.title)]] : []), [2, (w) => w.string(a.artist)],
        ...(f.noContentSource ? [] : [[3, (w) => w.flexInt(cs)]]), [4, (w) => w.flexInt(1)],
        [5, (w) => w.long(1).flexInt(T.Image).flexInt(cover.length).bytes(cover)],
        [6, (w) => w.long(albumIdOf(i))],
        // sparseFavorites: an IsFavorite nobody has set is left out, as a sparse struct leaves out a default.
        ...(f.noFavorites || ((f.sparseFavorites || f.wholeUpdates) && !a.favorite) ? [] : [[7, (w) => { const pd = profileData(!!a.favorite); w.integer(pd.length).bytes(pd); }]])]);
    };
    // A favourite changed (in another app, or by a heart): pushed to a connection that was sent the album.
    const updater = (i) => {
      if (sock.destroyed || !sent.has(String(albumOid(i)))) return;
      // Its IsFavorite alone, or (wholeUpdates) the album again whole, a sparse struct: an IsFavorite of no one's left out.
      if (f0.wholeUpdates) { pushAlbum(i, true); return; }
      const pd = profileData(!!o.albums[i].favorite);
      obj(albumOid(i), T.AlbumLite, [[7, (w) => w.integer(pd.length).bytes(pd)]]);
    };
    favouriteUpdaters.add(updater);
    // An album's Title sent alone (the same title), as a change of one field might be.
    const retitle = (i) => { if (!sock.destroyed && sent.has(String(albumOid(i)))) obj(albumOid(i), T.AlbumLite, [[1, (w) => w.string(o.albums[i].title)]]); };
    retitlers.add(retitle);
    sock.on("close", () => retitlers.delete(retitle));
    sock.on("close", () => favouriteUpdaters.delete(updater));
    let nextRow = 90000n;
    let nextResult = 95000n;
    // The streaming catalogue (N2b-1): albums not in the library, each sent once a connection.
    const pushCatalog = (j) => {
      const a = o.catalog[j], oid = 60000n + BigInt(j);
      if (sent.has(String(oid))) return oid;
      sent.add(String(oid));
      obj(oid, T.AlbumLite, [[1, (w) => w.string(a.title)], [2, (w) => w.string(a.artist)], [3, (w) => w.flexInt(MEDIA[a.source])],
        ...(a.noAlbumId ? [] : [[6, (w) => w.long(8000000000000n + BigInt(j))]])]);
      return oid;
    };
    const sentTracks = new Set();
    // force: an update of a track the client holds (a heart), sent whatever sentOnce says.
    const pushTrack = (t, force) => {
      if (f0.sentOnce && sentTracks.has(String(t.oid)) && !force) return;
      sentTracks.add(String(t.oid));
      pushAlbum(t.album);
      const fav = !!trackFav.get(String(t.oid));
      obj(t.oid, T.TrackLite, [[1, (w) => w.string(t.title)], [2, (w) => w.long(albumOid(t.album))],
        ...(f0.sparseFavorites && !fav ? [] : [[3, (w) => { const pd = profileData(fav); w.integer(pd.length).bytes(pd); }]])]);
    };
    if (o.faults && o.faults.pingOnClose) sock.on("end", () => { if (!sock.destroyed) sock.write(encodeRequest(1, Buffer.alloc(0), 77)); });
    let lastKeepalive = Date.now();
    if (o.reapMs) {
      const reaper = setInterval(() => {
        if (sock.destroyed) { clearInterval(reaper); return; }
        if (stage === 3 && Date.now() - lastKeepalive > o.reapMs) { rec.reaped++; clearInterval(reaper); sock.destroy(); }
      }, Math.max(10, Math.floor(o.reapMs / 5)));
    }

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
        lastKeepalive = Date.now();
        // The ConnectResponse: a reply to the ConnectRequest's request id.
        sock.write(encodeResponse(frames[0].rid || 1, Buffer.from("ok")));
        for (const f of frames.slice(1)) handle(f);
        return;
      }
      if (stage === 3) { const frames = parser.push(buf); buf = Buffer.alloc(0); for (const f of frames) handle(f); }
    });

    function handle(f) {
      if (f.isResponse) return;
      lastKeepalive = Date.now();   // any request from the client: alive
      // A keepalive from the client: answered.
      if (f.cmd === 1) { rec.pings++; if (f.rid !== null) sock.write(encodeResponse(f.rid, Buffer.alloc(0))); return; }
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
        for (const [id, name, members] of TYPES.concat(SEARCH_TYPES, LATER_TYPES)) {
          const w = new BinaryWriter().flexInt(id).string(name).flexInt(members.length);
          for (const [m, p] of members) w.string(m).integer(p);
          push(7, w.toBuffer());
        }
        const total = o.albums.reduce((n, a) => n + a.tracks, 0);
        obj(2n, T.Profile, [[1, (w) => w.sooid(Buffer.from("cafebabe", "hex"))], [2, (w) => w.string("Owner")]]);
        // twoProfiles (v1.9.27): a second, whose hearts are the opposite of the owner's (fake-roon-hearts.js).
        if (o.faults && o.faults.twoProfiles) obj(12n, T.Profile, [[1, (w) => w.sooid(Buffer.from("deadbeef", "hex"))], [2, (w) => w.string("Guest")]]);
        obj(3n, T.Library, [[1, (w) => w.integer(o.albums.length)], [2, (w) => w.integer(total)]]);
        if (!(o.faults && o.faults.noBroker)) obj(BROKER_OID, T.Broker, [[1, (w) => w.string("Broker")]]);
        const location = (l) => obj(l.oid, T.Location, [[1, (w) => w.string(l.name)], [2, (w) => w.flexInt(l.category)], [3, (w) => w.flexInt(l.type)]]);
        for (const l of (o.faults && o.faults.noLocations) ? [] : locs) {
          if (l.name === "Music" && o.faults && o.faults.lateLocationMs) setTimeout(() => { if (!sock.destroyed) location(l); }, o.faults.lateLocationMs);
          else location(l);
        }
        if (o.faults && o.faults.prePushSource) {
          allTracks().filter((t) => o.albums[t.album].source === o.faults.prePushSource).forEach((t) => pushTrack(t));
        }
        return;
      }
      if (f.cmd !== 3) return;
      const oid = r.long(), sig = methods.get(r.flexInt()) || "?";
      rec.signatures.push(sig);
      if (handleHeart({ sig, r, rid: f.rid, clientTypes, albums: o.albums, albumIdOf, trackFav, rec, faults: f0,
        tracksByOid: (oid) => allTracks().find((t) => t.oid === oid), pushTrack, ok,
        albumChanged: (i) => { for (const u of favouriteUpdaters) u(i); },
        refuse: (rid, why) => sock.write(encodeResponse(rid, new BinaryWriter().string(why).toBuffer())) })) return;
      if (handleLater({ sig, r, rid: f.rid, later: o.listenLater, albumOid, pushAlbum: (i) => pushAlbum(i), pushCatalog, push, ok, rec, faults: f0, sent,
        nextOid: () => nextResult++, later_: (fn) => setTimeout(() => { if (!sock.destroyed) fn(); }, 300),
        refuse: (rid, why) => sock.write(encodeResponse(rid, new BinaryWriter().string(why).toBuffer())) })) return;
      if (handleSearch({ sig, r, rid: f.rid, oid, clientTypes, albums: o.albums, catalog: o.catalog, albumOid, pushAlbum: (i) => pushAlbum(i),
        pushCatalog, push, ok, rec, faults: f0, sent, nextOid: () => nextResult++, later: (fn) => setTimeout(() => { if (!sock.destroyed) fn(); }, 300),
        refuse: (rid, why) => sock.write(encodeResponse(rid, new BinaryWriter().string(why).toBuffer())) })) return;
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
        const { source, albumTitle, albumArtist } = readCriteria(r, clientTypes);
        // A text filter, as Roon's is: a match anywhere in the title and the artist, any case.
        const has = (v, part) => String(v).toLowerCase().includes(String(part).toLowerCase());
        if (albumTitle !== null) rec.trackQueries.push({ albumTitle, albumArtist });
        else rec.queries.push(source);
        if (o.faults && o.faults.refuseQuery) { sock.write(encodeResponse(f.rid, new BinaryWriter().string("Refused").toBuffer())); return; }
        const tracks = albumTitle !== null
          ? allTracks().filter((t) => has(o.albums[t.album].title, albumTitle) && has(o.albums[t.album].artist, albumArtist || ""))
          : allTracks().filter((t) => o.albums[t.album].source === source);
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
            const albums = () => { if (!sock.destroyed && !f0.rowsOnly) page_.forEach((i) => pushAlbum(i)); };
            if (!f0.lateAlbumFieldsMs) albums();
            if (!f0.noRows) for (const i of page_) obj(nextRow++, T.Row, [[1, (w) => w.long(albumOid(i))]]);
            if (f0.lateAlbumFieldsMs) setTimeout(albums, f0.lateAlbumFieldsMs);
            if (f0.extraRow && (page + 1) * 100 >= q.albums.length) {
              obj(albumOid(99999), T.AlbumLite, [[1, (w) => w.string("Added meanwhile")], [2, (w) => w.string("Someone")]]);
              obj(nextRow++, T.Row, [[1, (w) => w.long(albumOid(99999))]]);
            }
            return;
          }
          for (const t of q ? q.tracks.slice(page * 100, page * 100 + 100) : []) {
            pushTrack(t);
            // sentOnce: the page names each track by a row too, as an album page does its albums.
            if (f0.sentOnce) obj(nextRow++, T.TrackRow, [[1, (w) => w.long(t.oid)]]);
          }
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
    // A favourite changed in the server's own apps (v1.9.28): pushed to every connection holding the album.
    favoriteElsewhere: (i, on) => { o.albums[i].favorite = on; for (const u of favouriteUpdaters) u(i); },
    // An album's Title pushed alone to every connection holding it (v1.9.28: an update of one field).
    renamed: (i) => { for (const u of retitlers) u(i); },
    // Every client connection dropped, as a Core restarting would; the server keeps listening.
    drop: () => { for (const s of sockets) s.destroy(); },
  })); });
}

// What the client asked for: read its declared criteria type and the inline
// struct it sent — the source criterion a track query set, and the Location
// ids an album query's RequireLocations listed (null when not sent).
function readCriteria(r, clientTypes) {
  /** @type {{ source: string, locations: bigint[] | null, albumTitle: string | null, albumArtist: string | null }} */
  const out = { source: "none", locations: null, albumTitle: null, albumArtist: null };
  if (r.long() !== 1n) return out;
  const t = clientTypes.get(r.integer());
  const sub = new BinaryReader(r.bytes(r.integer()));
  for (;;) {
    const idx = sub.flexInt();
    if (idx === 0) break;
    const [name, prop] = t.members[idx - 1];
    if (prop === 2) { const v = sub.boolean(); const m = /RequireIs(Local|Tidal|Qobuz)$/.exec(name); if (v && m) out.source = m[1].toLowerCase(); }
    else if (prop === 20) {
      const v = sub.string();
      if (name.endsWith("::AlbumTitleTextFilter")) out.albumTitle = v;
      else if (name.endsWith("::AlbumPerformedByTextFilter")) out.albumArtist = v;
    }
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
