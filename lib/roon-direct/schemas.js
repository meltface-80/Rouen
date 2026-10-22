// @ts-check
"use strict";
/*
 * schemas.js — the by-value structs the allowlist sends, member for member as
 * the Core declares them (Roon.Broker.Api.dll, read by the upstream's
 * MetadataLoadContext pass): arthursoares/roon-api-reverse-engineering (MIT,
 * see LICENSE), commit 8b67208, roon-internal-api/src/generated/
 * struct-schemas.ts. Data only.
 *
 * Each struct is declared to the Core with its FULL member list, as the
 * upstream does on the paths it ran live: fields are then sent by their index
 * in this list, and a member list that differed from the Core's would put a
 * value under the wrong member. Do not trim or reorder. One property type is
 * changed from the upstream's: ALBUM_QUERY_CRITERIA's RequireLocations (below).
 */

/** @type {ReadonlyArray<[string, number]>} [full member name, property type] */
const TRACK_QUERY_CRITERIA = [
  ["string Sooloos.Broker.Api.TrackQueryCriteria::UiLanguage", 20],
  ["Sooloos.Broker.Api.TrackQueryOrdering Sooloos.Broker.Api.TrackQueryCriteria::Ordering", 23],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::TextFilter", 20],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::TextFilterIgnoresMainPerformer", 2],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::TrackTitleTextFilter", 20],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::AlbumTitleTextFilter", 20],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::AlbumPerformedByTextFilter", 20],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::TrackMainPerformerTextFilter", 20],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::TrackComposerTextFilter", 20],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::PathTextFilter", 20],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequiresMissingItems", 2],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::MainPerformersMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::RequireMainPerformers", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeMainPerformers", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::PerformersMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::RequirePerformers", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludePerformers", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::ProductionMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::RequireProduction", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeProduction", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::ComposersMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::RequireComposers", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeComposers", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::ConductorsMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::RequireConductors", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeConductors", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.TagLite> Sooloos.Broker.Api.TrackQueryCriteria::RequireTags", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.TagLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeTags", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.Location> Sooloos.Broker.Api.TrackQueryCriteria::RequireLocations", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.Location> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeLocations", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::LabelsMode", 9],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::RequireLabels", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeLabels", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.TrackQueryCriteria::GenresMode", 9],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::RequireGenres", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeGenres", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.TrackQueryCriteria::RequireGenreObjects", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeGenreObjects", 23],
  ["Sooloos.NullDate Sooloos.Broker.Api.TrackQueryCriteria::MinDate", 23],
  ["Sooloos.NullDate Sooloos.Broker.Api.TrackQueryCriteria::MaxDate", 23],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::InvertDateRange", 2],
  ["Sooloos.NullDate Sooloos.Broker.Api.TrackQueryCriteria::MinImportDate", 23],
  ["Sooloos.NullDate Sooloos.Broker.Api.TrackQueryCriteria::MaxImportDate", 23],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::InvertImportDateRange", 2],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::RequirePlayedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::ExcludePlayedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::RequireImportedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::ExcludeImportedInLastNDays", 10],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.TrackQueryCriteria::RequireRatings", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeRatings", 23],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsFavorite", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsFavorite", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsBanned", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsBanned", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsBannedAlbum", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsBannedAlbum", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsPick", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsPick", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireHasLyrics", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeHasLyrics", 2],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::RequireInTheMostPlayedN", 10],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::ExcludeInTheMostPlayedN", 10],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::IncludeHidden", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireHidden", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsLive", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsLive", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsTidal", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsTidal", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsQobuz", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsQobuz", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsLossy", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsLossy", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsLossless", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsLossless", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsMQA", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsMQA", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsLocal", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsLocal", 2],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::MinPlayCount", 10],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::MaxPlayCount", 10],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsExportSupported", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsExportSupported", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsDownloadSupported", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsDownloadSupported", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsAvailable", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsAvailable", 2],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.TrackQueryCriteria::RequireSampleRates", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeSampleRates", 23],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::MinLossyBitRate", 10],
  ["int? Sooloos.Broker.Api.TrackQueryCriteria::MaxLossyBitRate", 10],
  ["double? Sooloos.Broker.Api.TrackQueryCriteria::MinLoudnessRange", 15],
  ["double? Sooloos.Broker.Api.TrackQueryCriteria::MaxLoudnessRange", 15],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.TrackQueryCriteria::RequireBitsPerSample", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeBitsPerSample", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::RequireChannelLayout", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeChannelLayout", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.FileFormat> Sooloos.Broker.Api.TrackQueryCriteria::RequireFileFormats", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.FileFormat> Sooloos.Broker.Api.TrackQueryCriteria::ExcludeFileFormats", 23],
  ["string Sooloos.Broker.Api.TrackQueryCriteria::RequireInDirectory", 20],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsIdentified", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsIdentified", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::RequireIsCorrupt", 2],
  ["bool Sooloos.Broker.Api.TrackQueryCriteria::ExcludeIsCorrupt", 2],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.TrackQueryCriteria::LanguagePreferences", 23],
];

/**
 * AlbumQueryCriteria, as the upstream generated it, with ONE change: the
 * generator gives every IList member property type 23 (Object), a default its
 * own notes say was never checked against a capture. The one IList encoding
 * run live on this protocol is LengthPrefixed (24): flexInt(length) +
 * flexInt(count) + the elements, each in its element type's own encoding
 * (upstream client.ts, Library::Edit, IList<AlbumEdit> and IList<string>).
 * It ran on the owner's Core (v1.9.13), and is kept. deep-roon-mcp ships the
 * same bytes declared 23; whether the Core filters on that is not shown, so
 * "23 would be misread", written here first, was as unproven as the reverse. RequireLocations, the
 * only list the probe sends, is declared 24 to match the bytes it is sent
 * as (dev/design/roon-native.md §9.1). v1.9.53: the owner's server declares a Focus's lists 24
 * itself (native-remote.md §12.6), and RequireGenreObjects and ExcludeGenreObjects, which the
 * smart-playlist test sends (§12.7), are declared 24 as well.
 * @type {ReadonlyArray<[string, number]>}
 */
const ALBUM_QUERY_CRITERIA = [
  ["Sooloos.Broker.Api.AlbumQueryOrdering Sooloos.Broker.Api.AlbumQueryCriteria::Ordering", 23],
  ["string Sooloos.Broker.Api.AlbumQueryCriteria::UiLanguage", 20],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::LanguagePreferences", 23],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequiresMissingItems", 2],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumType> Sooloos.Broker.Api.AlbumQueryCriteria::RequireTypes", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumType> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeTypes", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.ImageSize> Sooloos.Broker.Api.AlbumQueryCriteria::RequireMainImageSizes", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.ImageSize> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeMainImageSizes", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.Location> Sooloos.Broker.Api.AlbumQueryCriteria::RequireLocations", 24],   // LengthPrefixed: see above
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.Location> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeLocations", 23],
  ["string Sooloos.Broker.Api.AlbumQueryCriteria::TextFilter", 20],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.TagLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireTags", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.TagLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeTags", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::LabelsMode", 9],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::RequireLabels", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeLabels", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::GenresMode", 9],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::RequireGenres", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeGenres", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireGenreObjects", 24],   // as the server declares it (§12.6)
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeGenreObjects", 24],   // as the server declares it (§12.6)
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::MainPerformersMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireMainPerformers", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeMainPerformers", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::PerformersMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequirePerformers", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludePerformers", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::ProductionMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireProduction", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeProduction", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::ComposersMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireComposers", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeComposers", 23],
  ["Sooloos.Broker.Api.CriteriaMode Sooloos.Broker.Api.AlbumQueryCriteria::ConductorsMode", 9],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireConductors", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.PerformerLite> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeConductors", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::RequireSampleRates", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeSampleRates", 23],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MinLossyBitRate", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MaxLossyBitRate", 10],
  ["double? Sooloos.Broker.Api.AlbumQueryCriteria::MinLoudnessRange", 15],
  ["double? Sooloos.Broker.Api.AlbumQueryCriteria::MaxLoudnessRange", 15],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::RequireBitsPerSample", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeBitsPerSample", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::RequireChannelLayout", 23],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeChannelLayout", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.FileFormat> Sooloos.Broker.Api.AlbumQueryCriteria::RequireFileFormats", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.FileFormat> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeFileFormats", 23],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireMultipleFileFormats", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeMultipleFileFormats", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsFavorite", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsFavorite", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsBanned", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsBanned", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsBannedTrack", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsBannedTrack", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsAvailableTrack", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsAvailableTrack", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsPick", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsPick", 2],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::RequireRatings", 23],
  ["System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeRatings", 23],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsExportSupported", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsExportSupported", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsDownloadSupported", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsDownloadSupported", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsMQA", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsMQA", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasMainImage", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasMainImage", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsIdentified", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsIdentified", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasCorruptTracks", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasCorruptTracks", 2],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MinImageCount", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MaxImageCount", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MinTrackCount", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MaxTrackCount", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MinMediaCount", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::MaxMediaCount", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::RequirePlayedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::ExcludePlayedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::RequireImportedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeImportedInLastNDays", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::RequireInTheMostPlayedN", 10],
  ["int? Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeInTheMostPlayedN", 10],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsLive", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsLive", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsCompilation", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsCompilation", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireIsBootleg", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeIsBootleg", 2],
  ["Sooloos.NullDate Sooloos.Broker.Api.AlbumQueryCriteria::MinDate", 23],
  ["Sooloos.NullDate Sooloos.Broker.Api.AlbumQueryCriteria::MaxDate", 23],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::InvertDateRange", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasDate", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasDate", 2],
  ["Sooloos.NullDate Sooloos.Broker.Api.AlbumQueryCriteria::MinImportDate", 23],
  ["Sooloos.NullDate Sooloos.Broker.Api.AlbumQueryCriteria::MaxImportDate", 23],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::InvertImportDateRange", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::IncludeHidden", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHidden", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireDuplicates", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasGenres", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasGenres", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireContiguousTracks", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeContiguousTracks", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasBackCover", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasBackCover", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasAdditionalImages", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasAdditionalImages", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasLinerNotes", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasLinerNotes", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::RequireHasPdf", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeHasPdf", 2],
  ["System.Collections.Generic.IList<long> Sooloos.Broker.Api.AlbumQueryCriteria::RequireDownloadedAlbumIds", 23],
  ["System.Collections.Generic.IList<long> Sooloos.Broker.Api.AlbumQueryCriteria::ExcludeDownloadedAlbumIds", 23],
  ["System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumLite> Sooloos.Broker.Api.AlbumQueryCriteria::SimilarToAlbums", 23],
];

/**
 * A playlist's items, as Playlist::VirtualItemsQuery takes them (v1.9.50, N2e-0, native-remote.md §12.1):
 * every member as upstream's generated schema has them; the probe sends UiLanguage alone.
 * @type {ReadonlyArray<[string, number]>}
 */
const PLAYLIST_ITEM_QUERY_CRITERIA = [
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::UiLanguage", 20],
  ["Sooloos.Broker.Api.PlaylistItemQueryOrdering Sooloos.Broker.Api.PlaylistItemQueryCriteria::Ordering", 23],
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::TrackTitleTextFilter", 20],
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::AlbumTitleTextFilter", 20],
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::AlbumPerformedByTextFilter", 20],
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::TrackMainPerformerTextFilter", 20],
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::TrackComposerTextFilter", 20],
  ["string Sooloos.Broker.Api.PlaylistItemQueryCriteria::PathTextFilter", 20],
  ["bool Sooloos.Broker.Api.PlaylistItemQueryCriteria::RequireDuplicates", 2],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.PlaylistItemQueryCriteria::LanguagePreferences", 23],
];

/**
 * How a play is asked for (v1.9.51, N2e-1, native-remote.md §12.3): every member as upstream's generated schema has
 * them (a play with no PlayParameters declared timed out, upstream's notes); Rouen sends Shuffle alone.
 * @type {ReadonlyArray<[string, number]>}
 */
const PLAY_PARAMETERS = [
  ["Sooloos.Broker.Api.PlayPriority Sooloos.Broker.Api.PlayParameters::Priority", 9],
  ["bool Sooloos.Broker.Api.PlayParameters::Shuffle", 2],
  ["bool Sooloos.Broker.Api.PlayParameters::IsFromHere", 2],
  ["System.Collections.Generic.IList<string> Sooloos.Broker.Api.PlayParameters::LanguagePreferences", 23],
  ["string Sooloos.Broker.Api.PlayParameters::ClickSource", 20],
];

/** @type {ReadonlyArray<[string, number]>} */
const VIRTUAL_QUERY_PARAMETERS = [
  ["int Sooloos.Broker.Api.VirtualQueryParameters::PageSize", 0],
  ["object Sooloos.Broker.Api.VirtualQueryParameters::CopySelectionState", 23],
];

/**
 * An album named by its stable id, as a heart names it (v1.9.27, native-remote.md §8.2): all
 * three members declared, as the type is the Core's (the upstream generated schema), though
 * only AlbumId and Broker are sent.
 * @type {ReadonlyArray<[string, number]>}
 */
const ALBUM_LINK = [
  ["long Sooloos.Broker.Api.AlbumLink::AlbumId", 1],
  ["Sooloos.Broker.Api.Broker Sooloos.Broker.Api.AlbumLink::Broker", 23],
  ["Sooloos.Broker.Api.MediaSource Sooloos.Broker.Api.AlbumLink::Source", 9],
];

/**
 * The search's parameters (v1.9.32, N2b-1, native-remote.md §9.1): every member as upstream's
 * generated schema has them; Rouen sends ProfileId, Terms, MaxCount and MaxTopResultCount.
 * @type {ReadonlyArray<[string, number]>}
 */
const SEARCH_PARAMETERS = [
  ["System.Sooid Sooloos.Broker.Api.SearchParameters::ProfileId", 4],
  ["string Sooloos.Broker.Api.SearchParameters::Terms", 20],
  ["int Sooloos.Broker.Api.SearchParameters::MaxCount", 0],
  ["bool Sooloos.Broker.Api.SearchParameters::IncludeHidden", 2],
  ["string Sooloos.Broker.Api.SearchParameters::CancelKey", 20],
  ["bool Sooloos.Broker.Api.SearchParameters::IsInstantSearch", 2],
  ["int Sooloos.Broker.Api.SearchParameters::MaxTopResultCount", 0],
  ["int Sooloos.Broker.Api.SearchParameters::RequestTimeoutInMs", 0],
];

/**
 * An album Focus's order (v1.9.53, N2e-2b, native-remote.md §12.7): every member as upstream's generated schema has
 * them; Rouen sends Ordering and Direction, and RandomSeed for Random.
 * @type {ReadonlyArray<[string, number]>}
 */
const ALBUM_QUERY_ORDERING = [
  ["Sooloos.Broker.Api.AlbumOrdering Sooloos.Broker.Api.AlbumQueryOrdering::Ordering", 9],
  ["Sooloos.Broker.Api.OrderingDirection Sooloos.Broker.Api.AlbumQueryOrdering::Direction", 9],
  ["bool Sooloos.Broker.Api.AlbumQueryOrdering::OrderByLastFirstName", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryOrdering::OrderComposersByLastFirstName", 2],
  ["bool Sooloos.Broker.Api.AlbumQueryOrdering::OrderVariousArtistsByAlbumTitle", 2],
  ["Sooloos.Broker.Api.AlbumDatePreference Sooloos.Broker.Api.AlbumQueryOrdering::AlbumDatePreference", 9],
  ["int Sooloos.Broker.Api.AlbumQueryOrdering::RandomSeed", 0],
  ["string Sooloos.Broker.Api.AlbumQueryOrdering::VariousArtistsSortKey", 20],
];

/**
 * A smart playlist as Playlists::CreatePlaylistFromParameters takes it (v1.9.53, §12.7): every member as upstream's
 * generated schema has them; Rouen sends Profile, Name and AlbumCriteria.
 * @type {ReadonlyArray<[string, number]>}
 */
const PLAYLIST_PARAMETERS = [
  ["System.Sooid? Sooloos.Broker.Api.PlaylistParameters::PlaylistId", 14],
  ["Sooloos.Broker.Api.Profile Sooloos.Broker.Api.PlaylistParameters::Profile", 23],
  ["string Sooloos.Broker.Api.PlaylistParameters::Name", 20],
  ["string Sooloos.Broker.Api.PlaylistParameters::Description", 20],
  ["System.Sooid? Sooloos.Broker.Api.PlaylistParameters::PlaylistFolderId", 14],
  ["Sooloos.Broker.Api.AlbumQueryCriteria Sooloos.Broker.Api.PlaylistParameters::AlbumCriteria", 23],
  ["Sooloos.Broker.Api.TrackQueryCriteria Sooloos.Broker.Api.PlaylistParameters::TrackCriteria", 23],
];

module.exports = {
  ALBUM_QUERY_ORDERING: { name: "Sooloos.Broker.Api.AlbumQueryOrdering", members: ALBUM_QUERY_ORDERING },
  PLAYLIST_PARAMETERS: { name: "Sooloos.Broker.Api.PlaylistParameters", members: PLAYLIST_PARAMETERS },
  ALBUM_LINK: { name: "Sooloos.Broker.Api.AlbumLink", members: ALBUM_LINK },
  SEARCH_PARAMETERS: { name: "Sooloos.Broker.Api.SearchParameters", members: SEARCH_PARAMETERS },
  TRACK_QUERY_CRITERIA: { name: "Sooloos.Broker.Api.TrackQueryCriteria", members: TRACK_QUERY_CRITERIA },
  ALBUM_QUERY_CRITERIA: { name: "Sooloos.Broker.Api.AlbumQueryCriteria", members: ALBUM_QUERY_CRITERIA },
  VIRTUAL_QUERY_PARAMETERS: { name: "Sooloos.Broker.Api.VirtualQueryParameters", members: VIRTUAL_QUERY_PARAMETERS },
  PLAYLIST_ITEM_QUERY_CRITERIA: { name: "Sooloos.Broker.Api.PlaylistItemQueryCriteria", members: PLAYLIST_ITEM_QUERY_CRITERIA },
  PLAY_PARAMETERS: { name: "Sooloos.Broker.Api.PlayParameters", members: PLAY_PARAMETERS },
};
