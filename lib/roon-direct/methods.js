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
 * N3-2, writes (v1.9.65, native-remote.md §14.3): transport on the Zone and the Endpoint (transport.js)
 *   Zone::Play / Pause / PlayPause / Stop / Next / Previous / SetShuffle / SetLoop / SetAutoSwim   no answer
 *   Zone::Seek(int)  ·  Endpoint::SetVolumeDouble / IncrementVolumeDouble(double)   answered
 *   Endpoint::SetMute(bool)   no answer
 *
 * N3-3a, read only (v1.9.66, native-remote.md §15.1): AudioDeviceCommonConfig::GetConfigInfo / GetDspConfig
 *
 * N3-3c, writes (v1.9.66-t7, native-remote.md §15.7): a zone's settings (zone-controls.js)
 *   Zone::SetCrossFade(int) / SetVolumeLeveling(VolumeLeveling) / SetVolumeLevelingTargetLevel(double)   no answer
 *   Zone::SetSleepTimer(bool?, int?)   answered
 *   (t7's DspConfig::SetEnabled(bool), a master MUSE never shows, is no longer allowed: §15.8)
 *
 * N3-4, writes (v1.9.66-t9, native-remote.md §15.9): a DSP item of a zone's output (zone-dsp.js)
 *   DspConfigItem::SetEnabled(bool)   answered
 *
 * N3-5a, writes (v1.9.66-t12, native-remote.md §15.12): a DSP item's settings, on its part (dsp-settings.js), answered
 *   HeadroomAdjustmentItem::SetGainDb(double) / SetClippingIndicator(bool)
 *   BS2BItem::SetPreset(string) / SetCutFrequency(int) / SetFeedLevelDb(double)
 *   SampleRateConversionItem::SetSampleRateConversionMode / SetSRCFilterType / SetDsdToPcmFilter(string)
 *   SampleRateConversionRule::SetOutputSampleRate(int?)
 * N3-5b/c, a write (v1.9.66-t14 by hand, t15 in the window, §15.14–15): ParametricEqualizerItem::SetSpec(spec, bool) (peq.js), answered
 * Album credits, a read (v1.9.70-t1, album-credits.md §2.1): Library::GetTrackEditInfo(AlbumBase), an album's tracks' (credits.js)
 * N7-0, reads, run by hand (v1.9.70-t3, native-remote.md §16.4): the reads full native mode rests on (reads-probe.js)
 *   Queue::GetItems · Library::GetAlbum(AlbumBase) / GetAlbumTrackLites(AlbumBase) / GetPerformer(PerformerBase)
 *   Library::GetToplevelGenres(GetGenreParameters) / GetAllTagLites(Profile)
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
const { TRACK_QUERY_CRITERIA, ALBUM_QUERY_CRITERIA, VIRTUAL_QUERY_PARAMETERS, PLAYLIST_ITEM_QUERY_CRITERIA } = require("./schemas");
// The structs and the calls' arguments, moved out in v1.9.70-t3 (this file sat at its length cap), unchanged.
const { inlineStruct, refList } = require("./struct");
const { favoriteAlbumsArgs, favoriteTrackArgs, searchArgs, listenLaterArgs, addToLibraryArgs, playlistArgs, listenLaterStateArgs, LATER_STATE,
  playPlaylistArgs, smartPlaylistArgs } = require("./args");

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
  // v1.9.65, N3-2 (§14.3) — the catalogue's strings, as upstream's generated client sends them; writes (transport.js).
  zonePlay: "Sooloos.Broker.Api.Zone::Play()", zonePause: "Sooloos.Broker.Api.Zone::Pause()",
  zonePlayPause: "Sooloos.Broker.Api.Zone::PlayPause()", zoneStop: "Sooloos.Broker.Api.Zone::Stop()",
  zoneNext: "Sooloos.Broker.Api.Zone::Next()", zonePrevious: "Sooloos.Broker.Api.Zone::Previous()",
  zoneSeek: "Sooloos.Broker.Api.Zone::Seek(int, Base.ResultCallback)",
  zoneShuffle: "Sooloos.Broker.Api.Zone::SetShuffle(bool)", zoneLoop: "Sooloos.Broker.Api.Zone::SetLoop(Sooloos.Broker.Api.LoopMode)",
  zoneRadio: "Sooloos.Broker.Api.Zone::SetAutoSwim(bool)",
  endpointVolume: "Sooloos.Broker.Api.Endpoint::SetVolumeDouble(double, Base.ResultCallback)",
  endpointVolumeBy: "Sooloos.Broker.Api.Endpoint::IncrementVolumeDouble(double, Base.ResultCallback)",
  endpointMute: "Sooloos.Broker.Api.Endpoint::SetMute(bool)",
  // v1.9.67-t3 (dev/design/catalogue.md §4) — the catalogue's string, a read, by hand in the edit-info probe (edit-info.js); never run upstream nor captured.
  albumEditInfo: "Sooloos.Broker.Api.Library::GetMultiAlbumEditInfo(Sooloos.Broker.Api.AlbumEditInfoParameters, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumEditInfo>>)",
  trackEditInfo: "Sooloos.Broker.Api.Library::GetTrackEditInfo(Sooloos.Broker.Api.AlbumBase, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.TrackEditInfo>>)",
  // N7-0 (v1.9.70-t3, native-remote.md §16.4), read only, run by hand: what full native mode rests on.
  queueItems: "Sooloos.Broker.Api.Queue::GetItems(Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.TransportItem>>)",
  getAlbum: "Sooloos.Broker.Api.Library::GetAlbum(Sooloos.Broker.Api.AlbumBase, Base.ResultCallback<Sooloos.Broker.Api.Album>)",
  albumTrackLites: "Sooloos.Broker.Api.Library::GetAlbumTrackLites(Sooloos.Broker.Api.AlbumBase, Base.ResultCallback<System.Collections.Generic.IList<Sooloos.Broker.Api.TrackLite>>)",
  getPerformer: "Sooloos.Broker.Api.Library::GetPerformer(Sooloos.Broker.Api.PerformerBase, Base.ResultCallback<Sooloos.Broker.Api.Performer>)",
  toplevelGenres: "Sooloos.Broker.Api.Library::GetToplevelGenres(Sooloos.Broker.Api.GetGenreParameters, Base.ResultCallback<Sooloos.Broker.Api.ToplevelGenres>)",
  allTagLites: "Sooloos.Broker.Api.Library::GetAllTagLites(Sooloos.Broker.Api.Profile, Base.ResultCallback<Sooloos.Broker.Api.DataList<Sooloos.Broker.Api.TagLite>>)",
  // v1.9.66, N3-3a (§15.1) — the catalogue's strings, reads, by hand in the settings probe (zone-probe.js).
  configInfo: "Sooloos.Broker.Api.AudioDeviceCommonConfig::GetConfigInfo(Base.ResultCallback<Sooloos.Broker.Api.AudioDeviceCommonConfigInfo>)",
  dspConfig: "Sooloos.Broker.Api.AudioDeviceCommonConfig::GetDspConfig(Base.ResultCallback<Sooloos.Broker.Api.DspConfig>)",
  // v1.9.66-t7, N3-3c (§15.7) — the catalogue's strings (catalog.authoritative.json, 8b67208), never run by Rouen before
  // this build; writes (zone-controls.js), each believed only when the server shows it.
  zoneCrossfade: "Sooloos.Broker.Api.Zone::SetCrossFade(int)",
  zoneLeveling: "Sooloos.Broker.Api.Zone::SetVolumeLeveling(Sooloos.Broker.Api.VolumeLeveling)",
  zoneLevelTarget: "Sooloos.Broker.Api.Zone::SetVolumeLevelingTargetLevel(double)",
  zoneSleep: "Sooloos.Broker.Api.Zone::SetSleepTimer(bool?, int?, Base.ResultCallback)",
  // v1.9.66-t9, N3-4 (§15.9) — the catalogue's string (8b67208): a DSP item on or off (zone-dsp.js), believed only
  // when the server shows it.
  dspItemEnabled: "Sooloos.Broker.Api.DspConfigItem::SetEnabled(bool, Base.ResultCallback)",
  // v1.9.66-t12, N3-5a (§15.12) — the catalogue's strings (8b67208): a DSP item's settings, on its part (dsp-settings.js),
  // each believed only when the server shows it.
  dspHeadroomGain: "Sooloos.Broker.Api.HeadroomAdjustmentItem::SetGainDb(double, Base.ResultCallback)",
  dspHeadroomClipping: "Sooloos.Broker.Api.HeadroomAdjustmentItem::SetClippingIndicator(bool, Base.ResultCallback)",
  dspCrossfeedPreset: "Sooloos.Broker.Api.BS2BItem::SetPreset(string, Base.ResultCallback)",
  dspCrossfeedCut: "Sooloos.Broker.Api.BS2BItem::SetCutFrequency(int, Base.ResultCallback)",
  dspCrossfeedFeed: "Sooloos.Broker.Api.BS2BItem::SetFeedLevelDb(double, Base.ResultCallback)",
  dspSrcMode: "Sooloos.Broker.Api.SampleRateConversionItem::SetSampleRateConversionMode(string, Base.ResultCallback)",
  dspSrcFilter: "Sooloos.Broker.Api.SampleRateConversionItem::SetSRCFilterType(string, Base.ResultCallback)",
  dspSrcDsdToPcm: "Sooloos.Broker.Api.SampleRateConversionItem::SetDsdToPcmFilter(string, Base.ResultCallback)",
  dspSrcRule: "Sooloos.Broker.Api.SampleRateConversionRule::SetOutputSampleRate(int?, Base.ResultCallback)",
  // v1.9.66-t14, N3-5b/c (§15.14–15) — the catalogue's string (8b67208): a Parametric EQ's bands, sent whole (peq.js; peq-try.js by hand).
  dspPeqSpec: "Sooloos.Broker.Api.ParametricEqualizerItem::SetSpec(Sooloos.Broker.Api.ParametricEqualizerSpec, bool, Base.ResultCallback)",
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

module.exports = { ROOT_SERVICE, smartPlaylistArgs, SIG, ALLOWED, SOURCES, inlineStruct, guarded, openTrackQuery, openAlbumQuery, refList, pageArg,
  openAlbumTrackQuery, favoriteAlbumsArgs, favoriteTrackArgs, searchArgs, listenLaterArgs, addToLibraryArgs, playlistArgs,
  listenLaterStateArgs, LATER_STATE, openPlaylistItems, playPlaylistArgs };
