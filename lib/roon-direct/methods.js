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
const { TRACK_QUERY_CRITERIA, VIRTUAL_QUERY_PARAMETERS } = require("./schemas");

// The root service (stable across Cores, per the upstream).
const ROOT_SERVICE = Buffer.from("bcd36e8478a3e111b2725b4a6188709b", "hex");

const SIG = Object.freeze({
  trackQuery: "Sooloos.Broker.Api.Library::VirtualTrackQuery(System.Sooid, Sooloos.Broker.Api.TrackQueryCriteria, Sooloos.Broker.Api.VirtualQueryParameters, Base.ResultCallback<Sooloos.Broker.Api.VirtualTrackLiteQuery>)",
  retainPage: "Sooloos.Broker.Api.VirtualTrackLiteQuery::RetainPage(int, Base.ResultCallback)",
  releasePage: "Sooloos.Broker.Api.VirtualTrackLiteQuery::ReleasePage(int, Base.ResultCallback)",
  dispose: "Sooloos.Broker.Api.VirtualTrackLiteQuery::Dispose()",
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
 * @param {import("./remoting").RemotingClient} remoting
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
    callNoReply(oid, sig, args) { check(sig); remoting.callNoReply(oid, sig, args); },
    /** @param {string} name @param {ReadonlyArray<{ name: string, propType: number }>} members */
    defineType(name, members) { return remoting.defineType(name, members); },
  };
}

/**
 * Library::VirtualTrackQuery for one source; resolves to the query's object id.
 * @param {ReturnType<typeof guarded>} g
 * @param {bigint} libraryOid
 * @param {Buffer} profileId
 * @param {keyof typeof SOURCES} source
 * @param {number} pageSize
 */
async function openTrackQuery(g, libraryOid, profileId, source, pageSize) {
  const remoting = /** @type {any} */ (g);
  const criteria = inlineStruct(remoting, TRACK_QUERY_CRITERIA, [
    ["string Sooloos.Broker.Api.TrackQueryCriteria::UiLanguage", new BinaryWriter().string("en").toBuffer()],
    [SOURCES[source], new BinaryWriter().boolean(true).toBuffer()],
  ]);
  const params = inlineStruct(remoting, VIRTUAL_QUERY_PARAMETERS, [
    ["int Sooloos.Broker.Api.VirtualQueryParameters::PageSize", new BinaryWriter().integer(pageSize).toBuffer()],
  ]);
  const args = Buffer.concat([new BinaryWriter().sooid(profileId).toBuffer(), criteria, params]);
  const res = await g.call(libraryOid, SIG.trackQuery, args);
  if (!res.success) throw new Error(`the Core refused the ${source} track query: ${res.status}`);
  const r = readFlexLong(res.payload, 0);
  if (!r || r[0] < 2n) throw new Error(`the ${source} track query came back with no query object`);
  return r[0];
}

/** @param {number} n */
const pageArg = (n) => new BinaryWriter().integer(n).toBuffer();

module.exports = { ROOT_SERVICE, SIG, ALLOWED, SOURCES, inlineStruct, guarded, openTrackQuery, pageArg };
