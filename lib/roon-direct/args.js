// @ts-check
"use strict";
/*
 * args.js — the arguments of the calls hearts, the search, Listen Later, the playlists and the smart playlists send
 * (moved out of methods.js in v1.9.70-t3, unchanged); the allowlist and the guard stay there.
 */
const { BinaryWriter } = require("./wire");
const { extraMembers } = require("./focus-write");
const { ALBUM_QUERY_CRITERIA, SEARCH_PARAMETERS, PLAY_PARAMETERS, ALBUM_QUERY_ORDERING, PLAYLIST_PARAMETERS } = require("./schemas");
const { inlineStruct, refList, albumLinks } = require("./struct");

/**
 * The arguments of FavoriteOrBan's album form: the profile, then a
 * LengthPrefixed collection — flexInt(length), flexInt(count), each element
 * an inline AlbumLink { AlbumId, Broker } — then the state (Favorite 1, None 0).
 * @param {ReturnType<typeof import("./methods").guarded>} g @param {Buffer} profileId @param {bigint} brokerOid
 * @param {bigint[]} albumIds @param {boolean} on
 */
function favoriteAlbumsArgs(g, profileId, brokerOid, albumIds, on) {
  const body = albumLinks(g, brokerOid, albumIds);
  return new BinaryWriter().sooid(profileId).flexInt(body.length).bytes(body).flexInt(on ? 1 : 0).toBuffer();
}

/**
 * AddToLibrary's arguments (v1.9.41, native-remote.md §9.2 — this design's reading, never run upstream): the
 * Profile by its object, as GetListenLater's (proven) is sent; then the albums as hearts' album form names them, a
 * LengthPrefixed collection of inline AlbumLink values — the AlbumBase upstream's reflist audit gives this
 * method, and the form it matched to Roon's own app for FavoriteOrBan's IEnumerable<AlbumBase>.
 * @param {ReturnType<typeof import("./methods").guarded>} g @param {bigint} profileOid @param {bigint} brokerOid @param {bigint[]} albumIds
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
 * @param {ReturnType<typeof import("./methods").guarded>} g @param {Buffer} profileId @param {bigint} brokerOid @param {bigint[]} albumIds
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
 * @param {ReturnType<typeof import("./methods").guarded>} g @param {bigint} zoneOid @param {Buffer} profileId @param {boolean} shuffle @param {bigint} playlistOid
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
  /** @param {ReturnType<typeof import("./methods").guarded>} g @param {bigint} playlistOid @param {bigint} brokerOid @param {bigint[]} albumIds */
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
 * @param {ReturnType<typeof import("./methods").guarded>} g @param {bigint} profileOid @param {string} name
 * @param {{ ordering: number, direction: number, seed: number | null, require: bigint[], exclude: bigint[], genresMode?: number,
 *           extra?: import("./focus-map").Extra, kept?: Array<[string, Buffer]>, uiLanguage?: string }} f  extra: the filters
 *   beyond the genres (§12.15), when made; kept, uiLanguage: an edit's other order members and language, carried over (§12.18)
 *   genresMode: how the genres combine, when carried over as a playlist holds it (an update, §12.9); else Or
 * @param {Buffer} [playlistId]  the playlist's own PlaylistId, when the parameters change one (UpdatePlaylist, §12.9)
 * @param {{ profile?: boolean, description?: string | null, folder?: Buffer | null }} [form]  an update's form, varied to find
 *   what the server refuses (§12.10): the Profile left out; the playlist's Description and PlaylistFolderId carried over
 */
function smartPlaylistArgs(g, profileOid, name, f, playlistId, form = {}) {
  /** @type {Array<[string, Buffer]>} */
  const order = [["Sooloos.Broker.Api.AlbumOrdering Sooloos.Broker.Api.AlbumQueryOrdering::Ordering", int(f.ordering)],
    ["Sooloos.Broker.Api.OrderingDirection Sooloos.Broker.Api.AlbumQueryOrdering::Direction", int(f.direction)]];
  if (f.seed !== null) order.push(["int Sooloos.Broker.Api.AlbumQueryOrdering::RandomSeed", int(f.seed)]);
  // An edit's order carries the rest of Roon's own as read (§12.18), each in its declared place.
  if (f.kept) order.push(...f.kept);
  order.sort((a, b) => ALBUM_QUERY_ORDERING.members.findIndex(([m]) => m === a[0]) - ALBUM_QUERY_ORDERING.members.findIndex(([m]) => m === b[0]));
  /** @type {Array<[string, Buffer]>} */
  const focus = [[AQC("Ordering"), inlineStruct(g, ALBUM_QUERY_ORDERING, order)], [AQC("UiLanguage"), new BinaryWriter().string(f.uiLanguage || "en").toBuffer()]];
  if (f.require.length) focus.push([AQC("GenresMode"), int(f.genresMode === undefined ? 1 : f.genresMode)], [AQC("RequireGenreObjects"), refList(f.require)]);
  if (f.exclude.length) focus.push([AQC("ExcludeGenreObjects"), refList(f.exclude)]);
  // Every other filter Roon can hold (§12.15), only those set.
  if (f.extra) for (const [short, bytes] of extraMembers(f.extra)) focus.push([AQC(short), bytes]);
  /** @type {Array<[string, Buffer]>} */
  const params = playlistId ? [["System.Sooid? Sooloos.Broker.Api.PlaylistParameters::PlaylistId",
    new BinaryWriter().integer(playlistId.length).bytes(playlistId).toBuffer()]] : [];
  if (!form.profile) params.push(["Sooloos.Broker.Api.Profile Sooloos.Broker.Api.PlaylistParameters::Profile", new BinaryWriter().long(profileOid).toBuffer()]);
  params.push(["string Sooloos.Broker.Api.PlaylistParameters::Name", new BinaryWriter().string(name).toBuffer()]);
  if (form.description !== undefined) params.push(["string Sooloos.Broker.Api.PlaylistParameters::Description", new BinaryWriter().string(form.description).toBuffer()]);
  if (form.folder !== undefined) params.push(["System.Sooid? Sooloos.Broker.Api.PlaylistParameters::PlaylistFolderId",
    form.folder ? new BinaryWriter().integer(form.folder.length).bytes(form.folder).toBuffer() : new BinaryWriter().integer(-1).toBuffer()]);
  return inlineStruct(g, PLAYLIST_PARAMETERS, [...params,
    ["Sooloos.Broker.Api.AlbumQueryCriteria Sooloos.Broker.Api.PlaylistParameters::AlbumCriteria", inlineStruct(g, ALBUM_QUERY_CRITERIA, focus)],
  ]);
}

module.exports = { favoriteAlbumsArgs, favoriteTrackArgs, searchArgs, listenLaterArgs, addToLibraryArgs, playlistArgs, listenLaterStateArgs,
  LATER_STATE, playPlaylistArgs, smartPlaylistArgs };
