"use strict";
// ---------------------------------------------------------------------------
// The fake server's playlists (N2d, v1.9.42, native-remote.md §11): the
// Library's Playlists member, the Playlists object and its AllPlaylists list,
// pushed with the root; and the five calls lib/roon-direct/playlists.js makes,
// read strictly — CreatePlaylist, InsertTracks, InsertAlbums, Rename, Delete —
// each answered, and the playlist and the list pushed again as they change.
// Not evidence that the real server sends these objects or takes these forms:
// the owner's Roon app showing the playlist is.
//
// o.playlists: [{ name, readOnly?, tracks: number }] — the server's own, kept
// across connections (a test reads it back).
// faults.noPlaylists: the Library carries no Playlists member;
// faults.refusePlaylists: every call refused; faults.playlistsIgnored: each
// call answered "Success" and nothing done; faults.smartIgnored: CreatePlaylistFromParameters answered
// "Success" and nothing made; faults.smartNoGenres: made, its Focus kept without the genres sent (v1.9.53).
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { readAlbumLinks } = require("./fake-roon-hearts");

const SERVICE_OID = 20n, LIST_OID = 21n, GENRE_OID = 28000n;   // clear of the items' (23000s) and rows' (24000s)
const P = { Service: 60, Playlist: 61, List: 62, Criteria: 63, ItemQuery: 64, Item: 65, ItemRow: 66, Genre: 67 };   // clear of the core's, the search's (40s) and Listen Later's (50s)
const PLAYLIST_TYPES = [
  [P.Service, "Sooloos.Broker.Api.Playlists", [
    ["Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.Playlist> Sooloos.Broker.Api.Playlists::AllPlaylists", 23]]],
  [P.Playlist, "Sooloos.Broker.Api.Playlist", [
    ["string Sooloos.Broker.Api.Playlist::Name", 20], ["System.Sooid Sooloos.Broker.Api.Playlist::PlaylistId", 4],
    ["bool Sooloos.Broker.Api.Playlist::IsReadOnly", 2], ["int Sooloos.Broker.Api.Playlist::TrackCount", 0],
    // v1.9.50 (N2e-0): its kind (PlaylistType, Smart 15), and a smart one's Focus, an inline AlbumQueryCriteria.
    ["Sooloos.Broker.Api.PlaylistType Sooloos.Broker.Api.Playlist::Type", 9],
    ["Sooloos.Broker.Api.AlbumQueryCriteria Sooloos.Broker.Api.Playlist::AlbumCriteria", 23],
    ["int Sooloos.Broker.Api.Playlist::AlbumCount", 0]]],
  [P.Criteria, "Sooloos.Broker.Api.AlbumQueryCriteria", [["string Sooloos.Broker.Api.AlbumQueryCriteria::UiLanguage", 20],
    ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsFavorite", 2],
    // v1.9.52 (N2e-2a): its lists, LengthPrefixed as the owner's server sent them (§12.2) — a count, then the items.
    ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireGenreObjects", 24],
    ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeGenreObjects", 24],
    ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::RequireLabels", 24],
    ["System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumType> Sooloos.Broker.Api.AlbumQueryCriteria::RequireTypes", 24]]],
  [P.Genre, "Sooloos.Broker.Api.GenreLite", [["string Sooloos.Broker.Api.GenreLite::Name", 20]]],
  [P.ItemQuery, "Sooloos.Broker.Api.VirtualPlaylistItemQuery", [["int Sooloos.Broker.Api.VirtualPlaylistItemQuery::Count", 0]]],
  [P.Item, "Sooloos.Broker.Api.PlaylistItem", [["Sooloos.Broker.Api.TrackBase Sooloos.Broker.Api.PlaylistItem::Track", 23],
    ["int Sooloos.Broker.Api.PlaylistItem::Index", 0]]],
  [P.ItemRow, "Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.PlaylistItem>",
    [["Sooloos.Broker.Api.PlaylistItem Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.PlaylistItem>::Data", 23]]],
  [P.List, "Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.Playlist>", []],
];
const LIBRARY_MEMBER = ["Sooloos.Broker.Api.Playlists Sooloos.Broker.Api.Library::Playlists", 23];
const SIGS = {
  create: "Sooloos.Broker.Api.Playlists::CreatePlaylist(Sooloos.Broker.Api.Profile, string, string, bool, Base.ResultCallback<Sooloos.Broker.Api.Playlist>)",
  tracks: "Sooloos.Broker.Api.Playlists::InsertTracks(Sooloos.Broker.Api.Playlist, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.TrackBase>, Sooloos.Broker.Api.InsertionPoint, Sooloos.Broker.Api.PlaylistItem, Base.ResultCallback<Sooloos.Broker.Api.PlaylistInsertionResult>)",
  albums: "Sooloos.Broker.Api.Playlists::InsertAlbums(Sooloos.Broker.Api.Playlist, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>, Sooloos.Broker.Api.InsertionPoint, Sooloos.Broker.Api.PlaylistItem, Base.ResultCallback<Sooloos.Broker.Api.PlaylistInsertionResult>)",
  rename: "Sooloos.Broker.Api.Playlists::Rename(Sooloos.Broker.Api.Playlist, string, bool, Base.ResultCallback)",
  remove: "Sooloos.Broker.Api.Playlists::Delete(Sooloos.Broker.Api.Playlist, Base.ResultCallback)",
  smart: "Sooloos.Broker.Api.Playlists::CreatePlaylistFromParameters(Sooloos.Broker.Api.PlaylistParameters, Base.ResultCallback<Sooloos.Broker.Api.Playlist>)",
};
// The genres the fake has sent, by object id (v1.9.53): what a smart playlist's Focus may name.
const GENRES = new Map([[28000n, "R&B"], [28001n, "Folk"]]);

/** A playlist's object id, and its PlaylistId (a Sooid of 16 bytes), from its place in creation order. */
const oidOf = (/** @type {any} */ p) => 22000n + BigInt(p.n);
const idOf = (/** @type {any} */ p) => Buffer.from(("p" + String(p.n).padStart(3, "0")).padEnd(16, "-"));

/**
 * The playlists' objects, pushed (with the list and the service) to a connection.
 * @param {any[]} store @param {(cmd: number, body: Buffer) => void} push
 */
function pushPlaylists(store, push) {
  const obj = (/** @type {bigint} */ oid, /** @type {number} */ type, /** @type {Buffer} */ rest) =>
    push(3, Buffer.concat([new BinaryWriter().long(oid).flexInt(type).toBuffer(), rest]));
  // The genres a smart playlist's Focus names, by reference (v1.9.52; Folk, v1.9.53).
  for (const [oid, name] of GENRES) obj(oid, P.Genre, new BinaryWriter().flexInt(1).string(name).flexInt(0).toBuffer());
  for (const p of store) pushOne(p, obj);
  obj(LIST_OID, P.List, Buffer.concat([new BinaryWriter().integer(store.length).toBuffer(), ...store.map((p) => new BinaryWriter().long(oidOf(p)).toBuffer())]));
  obj(SERVICE_OID, P.Service, new BinaryWriter().flexInt(1).long(LIST_OID).flexInt(0).toBuffer());
}
/** @param {any} p @param {(oid: bigint, type: number, rest: Buffer) => void} obj */
function pushOne(p, obj) {
  const id = idOf(p);
  const w = new BinaryWriter().flexInt(1).string(p.name).flexInt(2).flexInt(id.length).bytes(id)
    .flexInt(3).boolean(!!p.readOnly).flexInt(4).integer(p.tracks).flexInt(5).integer(p.smart && !p.focusOnly ? 15 : 5);
  // focusOnly: a Focus on a playlist whose Type isn't the catalogue's Smart (the ordinal is unproven).
  if (p.smart) {
    // Its Focus, inline: a value object as the server writes one (marker 1, its type, its length, its sparse fields).
    const lp = (/** @type {Buffer} */ list) => new BinaryWriter().integer(list.length).bytes(list).toBuffer();
    const refs = (/** @type {bigint[]} */ oids) => { const w2 = new BinaryWriter().flexInt(oids.length); for (const o of oids) w2.long(o); return w2.toBuffer(); };
    // One made by CreatePlaylistFromParameters (v1.9.53): the Focus it was sent, as the server would keep it.
    const body = p.focus ? Buffer.concat([new BinaryWriter().flexInt(1).string("en").toBuffer(),
      new BinaryWriter().flexInt(3).bytes(lp(refs(p.focus.require))).toBuffer(),
      new BinaryWriter().flexInt(4).bytes(lp(refs(p.focus.exclude))).flexInt(0).toBuffer()]) : Buffer.concat([new BinaryWriter().flexInt(1).string("en").flexInt(2).boolean(true).toBuffer(),
      new BinaryWriter().flexInt(3).bytes(lp(new BinaryWriter().flexInt(1).long(GENRE_OID).toBuffer())).toBuffer(),
      new BinaryWriter().flexInt(4).bytes(lp(new BinaryWriter().flexInt(0).toBuffer())).toBuffer(),
      new BinaryWriter().flexInt(5).bytes(lp(new BinaryWriter().flexInt(2).string("Motown").string("Stax").toBuffer())).toBuffer(),
      new BinaryWriter().flexInt(6).bytes(lp(new BinaryWriter().flexInt(1).integer(1).toBuffer())).flexInt(0).toBuffer()]);
    // focusByRef: the Focus as an object of its own, by reference (the review: not seen on the owner's server).
    if (p.focusByRef) { obj(oidOf(p) + 7000n, P.Criteria, body); w.flexInt(6).long(oidOf(p) + 7000n); }   // 29000s
    else w.flexInt(6).long(1n).integer(P.Criteria).integer(body.length).bytes(body);
    if (p.albums !== undefined) w.flexInt(7).integer(p.albums);
  }
  obj(oidOf(p), P.Playlist, w.flexInt(0).toBuffer());
}

/**
 * @param {{ sig: string, r: any, rid: number, oid: bigint, clientTypes: Map<number, any>, store: any[], albums: any[],
 *           albumIdOf: (i: number) => bigint, tracksByOid: (oid: bigint) => any, push: (cmd: number, body: Buffer) => void,
 *           ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void, rec: any, faults: any }} c
 * @returns {boolean} whether it was a playlist call
 */
function handlePlaylists(c) {
  if (!c.sig.startsWith("Sooloos.Broker.Api.Playlists::")) return false;
  const kind = Object.keys(SIGS).find((k) => /** @type {any} */ (SIGS)[k] === c.sig);
  if (!kind) throw new Error("a Playlists call the fake does not take: " + c.sig);
  if (c.oid !== SERVICE_OID) throw new Error("a Playlists call on an object that is not the Playlists object: " + c.oid);
  const r = c.r;
  const byOid = (/** @type {bigint} */ oid) => {
    const p = c.store.find((x) => oidOf(x) === oid);
    if (!p) throw new Error("a playlist the fake doesn't have: " + oid);
    return p;
  };
  const end = () => { if (r.pos !== r.buf.length) throw new Error(`bytes after ${kind}'s arguments`); };
  const insertedAt = () => {
    if (r.flexInt() !== 1) throw new Error("an insertion point other than End");
    if (r.long() !== 0n) throw new Error("inserted after an item, not at the end");
  };
  /** @type {any} */
  const call = { kind };
  let p = null;
  if (kind === "smart") {
    Object.assign(call, readParameters(r, c.clientTypes));
    end();
  } else if (kind === "create") {
    const profile = r.long();
    if (profile !== 2n && profile !== 12n) throw new Error("CreatePlaylist for an object that is not a profile: " + profile);
    call.profile = String(profile); call.name = r.string(); call.description = r.string(); call.overwrite = r.boolean();
    end();
  } else {
    p = byOid(r.long());
    call.playlist = p.name;
    if (kind === "tracks") {
      const body = new BinaryReader(r.bytes(r.flexInt()));
      call.tracks = [];
      for (let n = body.flexInt(); n > 0; n--) {
        const t = c.tracksByOid(body.long());
        if (!t) throw new Error("InsertTracks named an object that is not a track");
        call.tracks.push(t.title);
      }
      if (body.pos !== body.buf.length) throw new Error("bytes after the tracks");
      insertedAt(); end();
    } else if (kind === "albums") {
      call.albums = readAlbumLinks(r, c.clientTypes).map(String);
      insertedAt(); end();
    } else if (kind === "rename") {
      call.name = r.string(); call.overwrite = r.boolean(); end();
    } else end();
  }
  c.rec.playlistCalls.push(call);
  if (c.faults.refusePlaylists) { c.refuse(c.rid, "Refused"); return true; }
  const obj = (/** @type {bigint} */ oid, /** @type {number} */ type, /** @type {Buffer} */ rest) =>
    c.push(3, Buffer.concat([new BinaryWriter().long(oid).flexInt(type).toBuffer(), rest]));
  if (c.faults.playlistsIgnored) {
    c.ok(c.rid, kind === "create" ? new BinaryWriter().long(oidOf(c.store[0] || { n: 0 })).toBuffer() : undefined);
    return true;
  }
  if (c.faults.smartIgnored && kind === "smart") { c.ok(c.rid); return true; }
  if (kind === "smart") {
    // A genre's albums: two each, of twelve tracks (the fake's own count, which the answer reports back).
    const made = { n: c.store.reduce((m, x) => Math.max(m, x.n + 1), 0), name: call.name, smart: true, readOnly: true,
      focus: c.faults.smartNoGenres ? { require: [], exclude: [] } : { require: call.require, exclude: call.exclude },
      albums: 2 * call.require.length, tracks: 24 * call.require.length };
    c.store.push(made);
    pushPlaylists(c.store, c.push);
    c.ok(c.rid, new BinaryWriter().long(oidOf(made)).toBuffer());
    return true;
  }
  if (kind === "create") {
    const made = { n: c.store.reduce((m, x) => Math.max(m, x.n + 1), 0), name: call.name, tracks: 0 };
    c.store.push(made);
    pushPlaylists(c.store, c.push);
    c.ok(c.rid, new BinaryWriter().long(oidOf(made)).toBuffer());
    return true;
  }
  if (kind === "tracks") p.tracks += call.tracks.length;
  if (kind === "albums") {
    for (const id of call.albums) {
      const i = c.albums.findIndex((_a, k) => String(c.albumIdOf(k)) === id);
      if (i >= 0) p.tracks += c.albums[i].tracks;
    }
  }
  if (kind === "rename") p.name = call.name;
  if (kind === "remove") c.store.splice(c.store.indexOf(p), 1);
  if (kind === "remove") pushPlaylists(c.store, c.push); else pushOne(p, obj);
  c.ok(c.rid);
  return true;
}

/**
 * A PlaylistParameters the client sent (v1.9.53, §12.7.2), read strictly: the Profile by reference, the Name, and an
 * album Focus of an Ordering, UiLanguage, GenresMode and its genre lists — each list declared LengthPrefixed (24), as
 * the owner's server declares them, and naming only genres the fake sent. Anything else sent throws.
 * @param {any} r @param {Map<number, any>} clientTypes
 */
function readParameters(r, clientTypes) {
  /** @type {any} */
  const out = { require: [], exclude: [] };
  struct(r, clientTypes, "Sooloos.Broker.Api.PlaylistParameters", (name, prop, body) => {
    if (name === "Profile") {
      const profile = body.long();
      if (profile !== 2n && profile !== 12n) throw new Error("PlaylistParameters for an object that is not a profile: " + profile);
      out.profile = String(profile);
    } else if (name === "Name") out.name = body.string();
    else if (name === "AlbumCriteria") {
      struct(body, clientTypes, "Sooloos.Broker.Api.AlbumQueryCriteria", (m, mp, b) => {
        if (m === "Ordering") {
          out.ordering = {};
          struct(b, clientTypes, "Sooloos.Broker.Api.AlbumQueryOrdering", (o, op, ob) => {
            if (!["Ordering", "Direction", "RandomSeed"].includes(o) || (o === "RandomSeed" ? op !== 0 : op !== 9)) throw new Error("AlbumQueryOrdering: a member the fake does not take: " + o);
            out.ordering[o] = ob.integer();
          });
        } else if (m === "UiLanguage") out.uiLanguage = b.string();
        else if (m === "GenresMode") { if (mp !== 9) throw new Error("GenresMode not declared an enum"); out.genresMode = b.integer(); }
        else if (m === "RequireGenreObjects" || m === "ExcludeGenreObjects") {
          if (mp !== 24) throw new Error(m + " declared " + mp + ", not LengthPrefixed (24) as the server declares it");
          const list = new BinaryReader(b.bytes(b.integer()));
          const oids = [];
          for (let n = list.flexInt(); n > 0; n--) {
            const oid = list.long();
            if (!GENRES.has(oid)) throw new Error(m + " names an object that is not a genre the fake sent: " + oid);
            oids.push(oid);
          }
          if (list.pos !== list.buf.length) throw new Error("bytes after " + m);
          out[m === "RequireGenreObjects" ? "require" : "exclude"] = oids;
          out[m === "RequireGenreObjects" ? "requireNames" : "excludeNames"] = oids.map((o) => GENRES.get(o));
        } else throw new Error("AlbumQueryCriteria: a member the fake does not take: " + m);
      });
    } else throw new Error("PlaylistParameters: a member the fake does not take: " + name);
  });
  return out;
}

/**
 * An inline struct, read strictly: its declared type by name, then each member handed to `each` with its own reader.
 * @param {any} r @param {Map<number, any>} clientTypes @param {string} want
 * @param {(short: string, prop: number, body: any) => void} each
 */
function struct(r, clientTypes, want, each) {
  if (r.long() !== 1n) throw new Error(want + " not sent as an inline value");
  const t = clientTypes.get(r.flexInt());
  if (!t || t.name !== want) throw new Error("not the " + want + " type as declared: " + JSON.stringify(t && t.name));
  const body = new BinaryReader(r.bytes(r.flexInt()));
  for (let idx = body.flexInt(); idx !== 0; idx = body.flexInt()) {
    const [name, prop] = t.members[idx - 1];
    each(name.slice(name.lastIndexOf("::") + 2), prop, body);
  }
  if (body.pos !== body.buf.length) throw new Error("bytes after " + want + "'s terminator");
}

const ITEMS_SIG = "Sooloos.Broker.Api.Playlist::VirtualItemsQuery(System.Sooid, Sooloos.Broker.Api.PlaylistItemQueryCriteria, Sooloos.Broker.Api.VirtualQueryParameters, Base.ResultCallback<Sooloos.Broker.Api.VirtualPlaylistItemQuery>)";

/**
 * An inline value object the client sent, read strictly: its declared type by name, each member's value by its type.
 * @param {any} r @param {Map<number, any>} clientTypes @param {string} want
 */
function readInline(r, clientTypes, want) {
  /** @type {Record<string, any>} */
  const vals = {};
  struct(r, clientTypes, want, (name, prop, body) => {
    if (prop === 20) vals[name] = body.string();
    else if (prop === 2) vals[name] = body.boolean();
    else if (prop === 0) vals[name] = body.integer();
    else throw new Error(want + ": a member the fake does not take: " + name);
  });
  return vals;
}

/**
 * Playlist::VirtualItemsQuery (v1.9.50, N2e-0), read strictly — the profile's id, the item criteria, the query's
 * parameters — answered with a VirtualPlaylistItemQuery whose Count is the playlist's items; its pages pushed by the
 * core's RetainPage (`register`). A playlist's items: the first `p.items` of the library's tracks.
 * @param {{ sig: string, r: any, rid: number, oid: bigint, clientTypes: Map<number, any>, store: any[], tracks: () => any[],
 *           nextOid: () => bigint, register: (q: bigint, tracks: any[]) => void, push: (cmd: number, body: Buffer) => void,
 *           ok: (rid: number, payload?: Buffer) => void, rec: any, faults?: any, refuse: (rid: number, why: string) => void }} c
 * @returns {boolean} whether it was the items query
 */
function handlePlaylistItems(c) {
  if (!c.sig.includes("Playlist::VirtualItemsQuery")) return false;
  if (c.sig !== ITEMS_SIG) throw new Error("a VirtualItemsQuery form the fake does not take: " + c.sig);
  const p = c.store.find((x) => oidOf(x) === c.oid);
  if (!p) throw new Error("VirtualItemsQuery on an object that is not a playlist: " + c.oid);
  const profile = c.r.sooid();
  const criteria = readInline(c.r, c.clientTypes, "Sooloos.Broker.Api.PlaylistItemQueryCriteria");
  const params = readInline(c.r, c.clientTypes, "Sooloos.Broker.Api.VirtualQueryParameters");
  if (c.r.pos !== c.r.buf.length) throw new Error("bytes after VirtualItemsQuery's arguments");
  c.rec.itemQueries.push({ playlist: p.name, profile: profile.toString("hex"), criteria, pageSize: params.PageSize });
  if (c.faults && c.faults.refuseItems) { c.refuse(c.rid, "Refused"); return true; }
  const tracks = c.tracks().slice(0, p.items || 0);
  const q = c.nextOid();
  c.register(q, tracks);
  c.ok(c.rid, new BinaryWriter().long(q).toBuffer());
  c.push(3, new BinaryWriter().long(q).flexInt(P.ItemQuery).flexInt(1).integer(tracks.length).flexInt(0).toBuffer());
  return true;
}

/**
 * A page of a playlist's items, as RetainPage pushes them: each track, then its PlaylistItem, then the row naming it.
 * @param {any[]} tracks @param {number} page @param {(t: any) => void} pushTrack @param {(cmd: number, body: Buffer) => void} push
 */
function pushItemsPage(tracks, page, pushTrack, push) {
  tracks.slice(page * 100, page * 100 + 100).forEach((t, k) => {
    pushTrack(t);
    const item = 23000n + BigInt(page * 100 + k);
    push(3, new BinaryWriter().long(item).flexInt(P.Item).flexInt(1).long(t.oid).flexInt(2).integer(page * 100 + k).flexInt(0).toBuffer());
    push(3, new BinaryWriter().long(24000n + BigInt(page * 100 + k)).flexInt(P.ItemRow).flexInt(1).long(item).flexInt(0).toBuffer());
  });
}

module.exports = { handlePlaylists, handlePlaylistItems, pushItemsPage, pushPlaylists, readInline, oidOf, PLAYLIST_TYPES, LIBRARY_MEMBER, SERVICE_OID };
