// @ts-check
"use strict";
/*
 * methods.js — the allowlist (dev/design/roon-native.md §4): every method of
 * Roon's internal protocol Rouen may call, written out by hand, nothing
 * generated. Adding one is a change to the design first.
 *
 * Stage 0, read only:
 *   GETSVC on the root service       the Core pushes its object graph
 *   Library::VirtualTrackQuery       a track query, with a source criterion
 *   VirtualTrackLiteQuery::RetainPage / ReleasePage   one page of it, then let go
 *   VirtualTrackLiteQuery::Dispose   the query let go
 *   Library::VirtualAlbumQuery       an album query, with or without
 *                                    RequireLocations (the Locations probe)
 *   VirtualAlbumLiteQuery::RetainPage / ReleasePage   one page of it (v1.9.16)
 *   VirtualAlbumLiteQuery::Dispose   that query let go
 *
 * N2b-1, read only (v1.9.32, native-remote.md §9.1):
 *   Library::UnifiedSearch           the server's own search, for albums to add
 *   UnifiedSearchResults::Dispose    its result let go
 *
 * N2c-0, read only (v1.9.36, native-remote.md §10.1):
 *   Library::GetListenLater          Roon's own Listen Later, for a profile
 *
 * N2b-2, a write (v1.9.41, native-remote.md §9.2):
 *   Library::AddToLibrary            a catalogue album added to the library; no answer
 *
 * N2d, writes (v1.9.42, native-remote.md §11): Roon's own playlists
 *   Playlists::CreatePlaylist        a new playlist, for a profile
 *   Playlists::InsertTracks / InsertAlbums   tracks (session objects) or albums (AlbumLink) at its end
 *   Playlists::Rename / Delete
 *
 * Signatures are the wire strings the Core resolves methods by. The library
 * query's follows the official client's captured VirtualAlbumQuery string
 * (upstream fixture captured_signatures.json) with the track types; paging
 * and Dispose are declared on the DERIVED query type, the only one the Core
 * resolves them under (the upstream's history export, live-probed). The Core
 * never answers ReleasePage or Dispose: both are sent without waiting, and
 * each exactly once — releasing a page twice corrupts the Core's count.
 */
const { BinaryWriter, readFlexLong } = require("./wire");
const { TRACK_QUERY_CRITERIA, ALBUM_QUERY_CRITERIA, VIRTUAL_QUERY_PARAMETERS, ALBUM_LINK, SEARCH_PARAMETERS, PLAYLIST_ITEM_QUERY_CRITERIA,
  PLAY_PARAMETERS, ALBUM_QUERY_ORDERING, PLAYLIST_PARAMETERS } = require("./schemas");

// The root service (stable across Cores, per the upstream).
const ROOT_SERVICE = Buffer.from("bcd36e8478a3e111b2725b4a6188709b", "hex");

const SIG = Object.freeze({
  trackQuery: "Sooloos.Broker.Api.Library::VirtualTrackQuery(System.Sooid, Sooloos.Broker.Api.TrackQueryCriteria, Sooloos.Broker.Api.VirtualQueryParameters, Base.ResultCallback<Sooloos.Broker.Api.VirtualTrackLiteQuery>)",
  retainPage: "Sooloos.Broker.Api.VirtualTrackLiteQuery::RetainPage(int, Base.ResultCallback)",
  releasePage: "Sooloos.Broker.Api.VirtualTrackLiteQuery::ReleasePage(int, Base.ResultCallback)",
  dispose: "Sooloos.Broker.Api.VirtualTrackLiteQuery::Dispose()",
  // The official client's captured string (upstream captured_signatures.json).
  albumQuery: "Sooloos.Broker.Api.Library::VirtualAlbumQuery(System.Sooid, Sooloos.Broker.Api.AlbumQueryCriteria, Sooloos.Broker.Api.VirtualQueryParameters, Base.ResultCallback<Sooloos.Broker.Api.VirtualAlbumLiteQuery>)",
  albumDispose: "Sooloos.Broker.Api.VirtualAlbumLiteQuery::Dispose()",
  // v1.9.16: an album query's pages. RetainPage is the official client's
  // captured string; ReleasePage its pair on the same derived type.
  albumRetainPage: "Sooloos.Broker.Api.VirtualAlbumLiteQuery::RetainPage(int, Base.ResultCallback)",
  albumReleasePage: "Sooloos.Broker.Api.VirtualAlbumLiteQuery::ReleasePage(int, Base.ResultCallback)",
  // v1.9.27, hearts (native-remote.md §8.2) — the catalogue's strings. The album form with
  // inline AlbumLink values is the one upstream matched byte for byte to Roon's own app; the
  // track form, by a track's session object, was captured from it.
  favoriteAlbums: "Sooloos.Broker.Api.Library::FavoriteOrBan(System.Sooid, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>, Sooloos.Broker.Api.FavoriteBanState, Base.ResultCallback)",
  favoriteTrack: "Sooloos.Broker.Api.Library::FavoriteOrBan(System.Sooid, Sooloos.Broker.Api.TrackBase, Sooloos.Broker.Api.FavoriteBanState, Base.ResultCallback)",
  // v1.9.32, N2b-1 (native-remote.md §9.1) — the catalogue's strings; upstream's client runs the search.
  unifiedSearch: "Sooloos.Broker.Api.Library::UnifiedSearch(Sooloos.Broker.Api.SearchParameters, Base.ResultCallback<Sooloos.Broker.Api.UnifiedSearchResults>)",
  searchDispose: "Sooloos.Broker.Api.UnifiedSearchResults::Dispose()",
  // v1.9.36, N2c-0 (native-remote.md §10.1) — the catalogue's string; never run upstream nor captured.
  getListenLater: "Sooloos.Broker.Api.Library::GetListenLater(Sooloos.Broker.Api.Profile, System.Collections.Generic.IList<string>, Base.ResultCallback<Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.ListenLaterItem>>)",
  // v1.9.45, N2c-2 (native-remote.md §10.4) — the catalogue's string (the album-collection overload); never run upstream nor captured.
  setListenLater: "Sooloos.Broker.Api.Library::SetListenLaterState(System.Sooid, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>, Sooloos.Broker.Api.ListenLaterState, Base.ResultCallback)",
  // v1.9.41, N2b-2 (native-remote.md §9.2) — the catalogue's string (upstream catalog.authoritative.json, Library
  // method 111: a Profile reference, an AlbumBase reflist, no callback); never run upstream nor captured.
  addToLibrary: "Sooloos.Broker.Api.Library::AddToLibrary(Sooloos.Broker.Api.Profile, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>)",
  // v1.9.42, N2d (native-remote.md §11.2) — the catalogue's strings (upstream catalog.authoritative.json, the
  // Playlists service); never run upstream nor captured.
  createPlaylist: "Sooloos.Broker.Api.Playlists::CreatePlaylist(Sooloos.Broker.Api.Profile, string, string, bool, Base.ResultCallback<Sooloos.Broker.Api.Playlist>)",
  insertTracks: "Sooloos.Broker.Api.Playlists::InsertTracks(Sooloos.Broker.Api.Playlist, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.TrackBase>, Sooloos.Broker.Api.InsertionPoint, Sooloos.Broker.Api.PlaylistItem, Base.ResultCallback<Sooloos.Broker.Api.PlaylistInsertionResult>)",
  insertAlbums: "Sooloos.Broker.Api.Playlists::InsertAlbums(Sooloos.Broker.Api.Playlist, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>, Sooloos.Broker.Api.InsertionPoint, Sooloos.Broker.Api.PlaylistItem, Base.ResultCallback<Sooloos.Broker.Api.PlaylistInsertionResult>)",
  renamePlaylist: "Sooloos.Broker.Api.Playlists::Rename(Sooloos.Broker.Api.Playlist, string, bool, Base.ResultCallback)",
  deletePlaylist: "Sooloos.Broker.Api.Playlists::Delete(Sooloos.Broker.Api.Playlist, Base.ResultCallback)",
  // v1.9.50, N2e-0 (native-remote.md §12.1) — the catalogue's strings, all reads; VirtualItemsQuery and RetainPage were
  // captured from Roon's own app (upstream's captured_signatures.json).
  playlistItems: "Sooloos.Broker.Api.Playlist::VirtualItemsQuery(System.Sooid, Sooloos.Broker.Api.PlaylistItemQueryCriteria, Sooloos.Broker.Api.VirtualQueryParameters, Base.ResultCallback<Sooloos.Broker.Api.VirtualPlaylistItemQuery>)",
  playlistItemsRetainPage: "Sooloos.Broker.Api.VirtualPlaylistItemQuery::RetainPage(int, Base.ResultCallback)",
  playlistItemsReleasePage: "Sooloos.Broker.Api.VirtualPlaylistItemQuery::ReleasePage(int, Base.ResultCallback)",
  playlistItemsDispose: "Sooloos.Broker.Api.VirtualPlaylistItemQuery::Dispose()",
  // v1.9.51, N2e-1 (native-remote.md §12.3) — the catalogue's string, proven on the owner's server (§12.4, v1.9.51): a write (it plays).
  playPlaylist: "Sooloos.Broker.Api.Transport::PlayPlaylist(Sooloos.Broker.Api.Zone, System.Sooid, Sooloos.Broker.Api.PlayParameters, Sooloos.Broker.Api.Playlist, Sooloos.Broker.Api.PlaylistItem, Base.ResultCallback<Sooloos.Broker.Api.PlayFeedback>)",
  // v1.9.53, N2e-2b (native-remote.md §12.7) — the catalogue's string, proven on the owner's server (§12.8): a write
  // (it adds a smart playlist to the library), sent by hand for the one test.
  createSmartPlaylist: "Sooloos.Broker.Api.Playlists::CreatePlaylistFromParameters(Sooloos.Broker.Api.PlaylistParameters, Base.ResultCallback<Sooloos.Broker.Api.Playlist>)",
  // v1.9.55, N2e-3a (§12.9) — the catalogue's string, never run nor captured: a write (it changes a smart playlist's
  // Focus), sent by hand for the one test.
  updateSmartPlaylist: "Sooloos.Broker.Api.Playlists::UpdatePlaylist(Sooloos.Broker.Api.Playlist, Sooloos.Broker.Api.PlaylistParameters, Base.ResultCallback)",
});
/** @type {Set<string>} */
const ALLOWED = new Set(Object.values(SIG));

/** The three sources and the criterion each sets. */
const SOURCES = Object.freeze({
  local: "bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsLocal",
  tidal: "bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsTidal",
  qobuz: "bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsQobuz",
});

/**
 * A by-value struct: flexLong(1) + flexInt(our type id) + flexInt(length) +
 * (flexInt(1-based member index) + value)* + flexInt(0).
 * @param {{ defineType(name: string, members: ReadonlyArray<{ name: string, propType: number }>): number }} remoting
 *   the remoting client, or the guard around it
 * @param {{ name: string, members: ReadonlyArray<[string, number]> }} schema
 * @param {Array<[string, Buffer]>} values  [full member name, encoded value]
 */
function inlineStruct(remoting, schema, values) {
  const typeId = remoting.defineType(schema.name, schema.members.map(([name, propType]) => ({ name, propType })));
  const body = new BinaryWriter();
  for (const [name, value] of values) {
    const i = schema.members.findIndex(([n]) => n === name);
    if (i < 0) throw new Error(`${schema.name} has no member ${name}`);
    body.flexInt(i + 1).bytes(value);
  }
  body.flexInt(0);
  const b = body.toBuffer();
  return new BinaryWriter().long(1).flexInt(typeId).flexInt(b.length).bytes(b).toBuffer();
}

/**
 * Wraps a remoting client so only the allowlist can be sent: anything else
 * throws before a byte leaves. Every call made is recorded in `log`.
 * @param {import("./remoting").RemotingClient} remoting
 */
function guarded(remoting) {
  /** @type {string[]} */
  const log = [];
  /** @param {string} sig */
  const check = (sig) => {
    if (!ALLOWED.has(sig)) throw new Error(`not on the allowlist: ${sig}`);
    log.push(sig);
  };
  return {
    log,
    /** @param {Uint8Array} guid */
    getService(guid) {
      if (Buffer.compare(Buffer.from(guid), ROOT_SERVICE) !== 0) throw new Error("only the root service is on the allowlist");
      log.push("GETSVC root");
      return remoting.getService(guid);
    },
    /** @param {bigint} oid @param {string} sig @param {Buffer} args */
    call(oid, sig, args) { check(sig); return remoting.call(oid, sig, args); },
    /** @param {bigint} oid @param {string} sig @param {Buffer} args */
    callNoReply(oid, sig, args) { check(sig); return remoting.callNoReply(oid, sig, args); },
    /** Why this side no longer knows what the Core holds for it, or "". */
    uncertain: () => remoting.uncertain || "",
    /** @param {string} name @param {ReadonlyArray<{ name: string, propType: number }>} members */
    defineType(name, members) { return remoting.defineType(name, members); },
  };
}

/**
 * A library query (track or album): the criteria struct, the page size, the
 * call; resolves to the query's object id.
 * @param {ReturnType<typeof guarded>} g
 * @param {bigint} libraryOid
 * @param {Buffer} profileId
 * @param {string} sig
 * @param {Buffer} criteria   an inlineStruct
 * @param {number} pageSize
 * @param {string} what       names the query in an error
 */
async function openQuery(g, libraryOid, profileId, sig, criteria, pageSize, what) {
  const params = inlineStruct(g, VIRTUAL_QUERY_PARAMETERS, [
    ["int Sooloos.Broker.Api.VirtualQueryParameters::PageSize", new BinaryWriter().integer(pageSize).toBuffer()],
  ]);
  const args = Buffer.concat([new BinaryWriter().sooid(profileId).toBuffer(), criteria, params]);
  const res = await g.call(libraryOid, sig, args);
  if (!res.success) throw new Error(`the Core refused the ${what}: ${res.status}`);
  const r = readFlexLong(res.payload, 0);
  if (!r || r[0] < 2n) throw new Error(`the ${what} came back with no query object`);
  return r[0];
}

/**
 * Playlist::VirtualItemsQuery (v1.9.50, N2e-0): a playlist's items, its criteria UiLanguage alone, as a library query
 * is opened — on the playlist's object; resolves to the query's object id.
 * @param {ReturnType<typeof guarded>} g @param {bigint} playlistOid @param {Buffer} profileId @param {number} pageSize
 */
function openPlaylistItems(g, playlistOid, profileId, pageSize) {
  const criteria = inlineStruct(g, PLAYLIST_ITEM_QUERY_CRITERIA, [
    ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::UiLanguage", new BinaryWriter().string("en").toBuffer()],
  ]);
  return openQuery(g, playlistOid, profileId, SIG.playlistItems, criteria, pageSize, "playlist's items query");
}

/**
 * Library::VirtualTrackQuery for one source; resolves to the query's object id.
 * @param {ReturnType<typeof guarded>} g
 * @param {bigint} libraryOid
 * @param {Buffer} profileId
 * @param {keyof typeof SOURCES} source
 * @param {number} pageSize
 */
function openTrackQuery(g, libraryOid, profileId, source, pageSize) {
  const criteria = inlineStruct(g, TRACK_QUERY_CRITERIA, [
    ["string Sooloos.Broker.Api.TrackQueryCriteria::UiLanguage", new BinaryWriter().string("en").toBuffer()],
    [SOURCES[source], new BinaryWriter().boolean(true).toBuffer()],
  ]);
  return openQuery(g, libraryOid, profileId, SIG.trackQuery, criteria, pageSize, `${source} track query`);
}

/**
 * An IList of by-reference objects as a LengthPrefixed struct member:
 * flexInt(length) + [flexInt(count) + flexLong(object id) each]. The framing
 * is the one run live upstream (Library::Edit); each element as a bare
 * object id is how the official client's captured collection ARGUMENTS
 * carry by-reference objects. That a struct member's list reads its
 * elements the same way is this design's reading, first tried by the
 * Locations probe.
 * @param {bigint[]} oids
 */
function refList(oids) {
  const inner = new BinaryWriter().flexInt(oids.length);
  for (const oid of oids) inner.long(oid);
  const b = inner.toBuffer();
  return new BinaryWriter().integer(b.length).bytes(b).toBuffer();
}

/**
 * Library::VirtualAlbumQuery; resolves to the query's object id. With
 * `locations` it requires an album to be in one of them; with null, the
 * unfiltered control the Locations probe compares against.
 * @param {ReturnType<typeof guarded>} g
 * @param {bigint} libraryOid
 * @param {Buffer} profileId
 * @param {bigint[] | null} locations
 * @param {number} pageSize
 */
function openAlbumQuery(g, libraryOid, profileId, locations, pageSize) {
  /** @type {Array<[string, Buffer]>} */
  const values = [["string Sooloos.Broker.Api.AlbumQueryCriteria::UiLanguage", new BinaryWriter().string("en").toBuffer()]];
  if (locations) values.push(["System.Collections.Generic.IList<Sooloos.Broker.Api.Location> Sooloos.Broker.Api.AlbumQueryCriteria::RequireLocations", refList(locations)]);
  const criteria = inlineStruct(g, ALBUM_QUERY_CRITERIA, values);
  return openQuery(g, libraryOid, profileId, SIG.albumQuery, criteria, pageSize, locations ? "album query by Location" : "unfiltered album query");
}

/** @param {number} n */
const pageArg = (n) => new BinaryWriter().integer(n).toBuffer();

/**
 * Library::VirtualTrackQuery for one album's tracks (v1.9.27): its title and
 * artist as the text filters. A text filter matches more than the one album —
 * its title within a longer one's — so the caller keeps only the tracks whose
 * Album is the one asked for.
 * @param {ReturnType<typeof guarded>} g @param {bigint} libraryOid @param {Buffer} profileId
 * @param {string} title @param {string} artist @param {number} pageSize
 */
function openAlbumTrackQuery(g, libraryOid, profileId, title, artist, pageSize) {
  /** @type {Array<[string, Buffer]>} */
  const values = [
    ["string Sooloos.Broker.Api.TrackQueryCriteria::UiLanguage", new BinaryWriter().string("en").toBuffer()],
    ["string Sooloos.Broker.Api.TrackQueryCriteria::AlbumTitleTextFilter", new BinaryWriter().string(title).toBuffer()],
  ];
  if (artist) values.push(["string Sooloos.Broker.Api.TrackQueryCriteria::AlbumPerformedByTextFilter", new BinaryWriter().string(artist).toBuffer()]);
  return openQuery(g, libraryOid, profileId, SIG.trackQuery, inlineStruct(g, TRACK_QUERY_CRITERIA, values), pageSize, "album's track query");
}

/**
 * The arguments of FavoriteOrBan's album form: the profile, then a
 * LengthPrefixed collection — flexInt(length), flexInt(count), each element
 * an inline AlbumLink { AlbumId, Broker } — then the state (Favorite 1, None 0).
 * @param {ReturnType<typeof guarded>} g @param {Buffer} profileId @param {bigint} brokerOid
 * @param {bigint[]} albumIds @param {boolean} on
 */
function favoriteAlbumsArgs(g, profileId, brokerOid, albumIds, on) {
  const body = albumLinks(g, brokerOid, albumIds);
  return new BinaryWriter().sooid(profileId).flexInt(body.length).bytes(body).flexInt(on ? 1 : 0).toBuffer();
}

/**
 * A collection of albums as hearts name them: flexInt(count), then an inline AlbumLink { AlbumId, Broker } each.
 * @param {ReturnType<typeof guarded>} g @param {bigint} brokerOid @param {bigint[]} albumIds
 */
function albumLinks(g, brokerOid, albumIds) {
  const inner = new BinaryWriter().flexInt(albumIds.length);
  for (const id of albumIds) {
    inner.bytes(inlineStruct(g, ALBUM_LINK, [
      ["long Sooloos.Broker.Api.AlbumLink::AlbumId", new BinaryWriter().long(id).toBuffer()],
      ["Sooloos.Broker.Api.Broker Sooloos.Broker.Api.AlbumLink::Broker", new BinaryWriter().long(brokerOid).toBuffer()],
    ]));
  }
  return inner.toBuffer();
}

/**
 * AddToLibrary's arguments (v1.9.41, native-remote.md §9.2 — this design's reading, never run upstream): the
 * Profile by its object, as GetListenLater's (proven) is sent; then the albums as hearts' album form names them, a
 * LengthPrefixed collection of inline AlbumLink values — the AlbumBase upstream's reflist audit gives this
 * method, and the form it matched to Roon's own app for FavoriteOrBan's IEnumerable<AlbumBase>.
 * @param {ReturnType<typeof guarded>} g @param {bigint} profileOid @param {bigint} brokerOid @param {bigint[]} albumIds
 */
function addToLibraryArgs(g, profileOid, brokerOid, albumIds) {
  const body = albumLinks(g, brokerOid, albumIds);
  return new BinaryWriter().long(profileOid).flexInt(body.length).bytes(body).toBuffer();
}

/** FavoriteOrBan's track form: the profile, the track's object, the state. @param {Buffer} profileId @param {bigint} trackOid @param {boolean} on */
const favoriteTrackArgs = (profileId, trackOid, on) => new BinaryWriter().sooid(profileId).long(trackOid).flexInt(on ? 1 : 0).toBuffer();

/**
 * UnifiedSearch's one argument (v1.9.32): its parameters, for the profile chosen, as upstream's client sends them.
 * @param {Parameters<typeof inlineStruct>[0]} g @param {Buffer} profileId @param {string} terms
 */
const searchArgs = (g, profileId, terms) => inlineStruct(g, SEARCH_PARAMETERS, [
  ["System.Sooid Sooloos.Broker.Api.SearchParameters::ProfileId", new BinaryWriter().sooid(profileId).toBuffer()],
  ["string Sooloos.Broker.Api.SearchParameters::Terms", new BinaryWriter().string(terms).toBuffer()],
  ["int Sooloos.Broker.Api.SearchParameters::MaxCount", new BinaryWriter().integer(20).toBuffer()],
  ["int Sooloos.Broker.Api.SearchParameters::MaxTopResultCount", new BinaryWriter().integer(10).toBuffer()],
]);

/**
 * GetListenLater's arguments (v1.9.36, native-remote.md §10.1 — this design's reading, never run
 * upstream): the Profile by its object, as FavoriteOrBan's track form sends a track; then the
 * languages, a collection framed as hearts' album list is — flexInt(length), flexInt(count), each
 * a string.
 * @param {bigint} profileOid @param {string[]} languages
 */
function listenLaterArgs(profileOid, languages) {
  const inner = new BinaryWriter().flexInt(languages.length);
  for (const l of languages) inner.string(l);
  const body = inner.toBuffer();
  return new BinaryWriter().long(profileOid).flexInt(body.length).bytes(body).toBuffer();
}

// ListenLaterState (the catalogue's enum): None 0, Pending 1, Played 2.
const LATER_STATE = Object.freeze({ none: 0, pending: 1, played: 2 });

/**
 * SetListenLaterState's album form (v1.9.45, native-remote.md §10.4 — this design's reading, never run
 * upstream): FavoriteOrBan's album form, proven (§8) — the profile's id, the albums as inline AlbumLink
 * values, the state an enum.
 * @param {ReturnType<typeof guarded>} g @param {Buffer} profileId @param {bigint} brokerOid @param {bigint[]} albumIds
 * @param {number} state  a LATER_STATE
 */
function listenLaterStateArgs(g, profileId, brokerOid, albumIds, state) {
  const body = albumLinks(g, brokerOid, albumIds);
  return new BinaryWriter().sooid(profileId).flexInt(body.length).bytes(body).flexInt(state).toBuffer();
}

/**
 * Transport::PlayPlaylist's arguments (v1.9.51, native-remote.md §12.3 — this design's reading, after upstream's
 * generated client and its PlayAlbum heard playing): the Zone by its object, the profile's id, PlayParameters with
 * Shuffle alone, the Playlist by its object, no item to start from (a null reference).
 * @param {ReturnType<typeof guarded>} g @param {bigint} zoneOid @param {Buffer} profileId @param {boolean} shuffle @param {bigint} playlistOid
 */
function playPlaylistArgs(g, zoneOid, profileId, shuffle, playlistOid) {
  const params = inlineStruct(g, PLAY_PARAMETERS, [["bool Sooloos.Broker.Api.PlayParameters::Shuffle", new BinaryWriter().boolean(shuffle).toBuffer()]]);
  return Buffer.concat([new BinaryWriter().long(zoneOid).sooid(profileId).toBuffer(), params, new BinaryWriter().long(playlistOid).long(0n).toBuffer()]);
}

// InsertionPoint (the catalogue's enum): Beginning 0, End 1, After 2, Before 3.
const AT_THE_END = 1;

/**
 * The playlist calls' arguments (v1.9.42, native-remote.md §11.2 — this design's reading, never run upstream).
 * Objects by reference (a Profile, a Playlist, a track's session object) as GetListenLater and the track heart
 * send theirs; a collection framed as hearts' album list is, flexInt(length) + flexInt(count) + its elements —
 * here each a bare object id, as the official client's captured collection arguments carry by-reference
 * objects; the insertion point an enum, as FavoriteBanState is sent; "after no item" a null reference (0).
 */
const playlistArgs = {
  /** @param {bigint} profileOid @param {string} name */
  create: (profileOid, name) => new BinaryWriter().long(profileOid).string(name).string("").boolean(false).toBuffer(),
  /** @param {bigint} playlistOid @param {bigint[]} trackOids */
  tracks(playlistOid, trackOids) {
    const inner = new BinaryWriter().flexInt(trackOids.length);
    for (const oid of trackOids) inner.long(oid);
    const body = inner.toBuffer();
    return new BinaryWriter().long(playlistOid).flexInt(body.length).bytes(body).flexInt(AT_THE_END).long(0n).toBuffer();
  },
  /** @param {ReturnType<typeof guarded>} g @param {bigint} playlistOid @param {bigint} brokerOid @param {bigint[]} albumIds */
  albums(g, playlistOid, brokerOid, albumIds) {
    const body = albumLinks(g, brokerOid, albumIds);
    return new BinaryWriter().long(playlistOid).flexInt(body.length).bytes(body).flexInt(AT_THE_END).long(0n).toBuffer();
  },
  /** @param {bigint} playlistOid @param {string} name */
  rename: (playlistOid, name) => new BinaryWriter().long(playlistOid).string(name).boolean(false).toBuffer(),
  /** @param {bigint} playlistOid */
  remove: (playlistOid) => new BinaryWriter().long(playlistOid).toBuffer(),
};

/** A Focus's member, by its short name. @param {string} short */
const AQC = (short) => /** @type {[string, number]} */ (ALBUM_QUERY_CRITERIA.members.find(([n]) => n.endsWith("::" + short)))[0];
/** An enum or an int, as a struct member carries it. @param {number} n */
const int = (n) => new BinaryWriter().integer(n).toBuffer();

/**
 * Playlists::CreatePlaylistFromParameters's argument (v1.9.53, §12.7): a PlaylistParameters of the Profile by reference,
 * the Name, and an album Focus of its order, UiLanguage "en", and its genres, each a GenreLite by reference
 * (GenresMode Or, as Rouen's are any-of). Only what is given is sent: every other member is the server's default.
 * @param {ReturnType<typeof guarded>} g @param {bigint} profileOid @param {string} name
 * @param {{ ordering: number, direction: number, seed: number | null, require: bigint[], exclude: bigint[], genresMode?: number }} f
 *   genresMode: how the genres combine, when carried over as a playlist holds it (an update, §12.9); else Or
 * @param {Buffer} [playlistId]  the playlist's own PlaylistId, when the parameters change one (UpdatePlaylist, §12.9)
 */
function smartPlaylistArgs(g, profileOid, name, f, playlistId) {
  /** @type {Array<[string, Buffer]>} */
  const order = [["Sooloos.Broker.Api.AlbumOrdering Sooloos.Broker.Api.AlbumQueryOrdering::Ordering", int(f.ordering)],
    ["Sooloos.Broker.Api.OrderingDirection Sooloos.Broker.Api.AlbumQueryOrdering::Direction", int(f.direction)]];
  if (f.seed !== null) order.push(["int Sooloos.Broker.Api.AlbumQueryOrdering::RandomSeed", int(f.seed)]);
  /** @type {Array<[string, Buffer]>} */
  const focus = [[AQC("Ordering"), inlineStruct(g, ALBUM_QUERY_ORDERING, order)], [AQC("UiLanguage"), new BinaryWriter().string("en").toBuffer()]];
  if (f.require.length) focus.push([AQC("GenresMode"), int(f.genresMode === undefined ? 1 : f.genresMode)], [AQC("RequireGenreObjects"), refList(f.require)]);
  if (f.exclude.length) focus.push([AQC("ExcludeGenreObjects"), refList(f.exclude)]);
  /** @type {Array<[string, Buffer]>} */
  const params = playlistId ? [["System.Sooid? Sooloos.Broker.Api.PlaylistParameters::PlaylistId",
    new BinaryWriter().integer(playlistId.length).bytes(playlistId).toBuffer()]] : [];
  return inlineStruct(g, PLAYLIST_PARAMETERS, [...params,
    ["Sooloos.Broker.Api.Profile Sooloos.Broker.Api.PlaylistParameters::Profile", new BinaryWriter().long(profileOid).toBuffer()],
    ["string Sooloos.Broker.Api.PlaylistParameters::Name", new BinaryWriter().string(name).toBuffer()],
    ["Sooloos.Broker.Api.AlbumQueryCriteria Sooloos.Broker.Api.PlaylistParameters::AlbumCriteria", inlineStruct(g, ALBUM_QUERY_CRITERIA, focus)],
  ]);
}

module.exports = { ROOT_SERVICE, smartPlaylistArgs, SIG, ALLOWED, SOURCES, inlineStruct, guarded, openTrackQuery, openAlbumQuery, refList, pageArg,
  openAlbumTrackQuery, favoriteAlbumsArgs, favoriteTrackArgs, searchArgs, listenLaterArgs, addToLibraryArgs, playlistArgs,
  listenLaterStateArgs, LATER_STATE, openPlaylistItems, playPlaylistArgs };
