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
 *   VirtualAlbumLiteQuery::Dispose   that query let go; its pages are never
 *                                    retained, only its Count is read
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
const { TRACK_QUERY_CRITERIA, ALBUM_QUERY_CRITERIA, VIRTUAL_QUERY_PARAMETERS } = require("./schemas");

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

module.exports = { ROOT_SERVICE, SIG, ALLOWED, SOURCES, inlineStruct, guarded, openTrackQuery, openAlbumQuery, refList, pageArg };
