"use strict";
// ---------------------------------------------------------------------------
// The fake server's Transport, its zones and their endpoints (N2e-1, v1.9.51,
// native-remote.md §12.3), pushed with the root as the real server pushes
// them (upstream's notes: found by type), and Transport::PlayPlaylist read
// strictly — the Zone by its object, the profile's id, a PlayParameters
// declared by name, the Playlist by its object, a null item — answered, and
// told to the test (onPlay), which plays the zone in its own official-API
// stand-in. Not evidence that the real server takes this form: the owner's
// zone playing is.
//
// o.zones: [{ id: hex, name?: string, endpoints: string[] }] (default one,
// "Living Room"). Faults: refusePlay (refused), playIgnored (answered, the
// test not told).
// ---------------------------------------------------------------------------

const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { readInline, oidOf } = require("./fake-roon-playlists");

const X = { Transport: 70, Zone: 71, Endpoint: 72 };
const TRANSPORT_TYPES = [
  [X.Transport, "Sooloos.Broker.Api.Transport", [["string Sooloos.Broker.Api.Transport::Name", 20]]],
  [X.Zone, "Sooloos.Broker.Api.Zone", [["System.Sooid Sooloos.Broker.Api.Zone::ZoneId", 4], ["string Sooloos.Broker.Api.Zone::Name", 20]]],
  [X.Endpoint, "Sooloos.Broker.Api.Endpoint", [["string Sooloos.Broker.Api.Endpoint::Name", 20], ["Sooloos.Broker.Api.Zone Sooloos.Broker.Api.Endpoint::Zone", 23]]],
];
const TRANSPORT_OID = 30n;
const DEFAULT_ZONES = [{ id: "1601aabbcc", name: "Living Room", endpoints: ["Living Room"] }];
const SIG = "Sooloos.Broker.Api.Transport::PlayPlaylist(Sooloos.Broker.Api.Zone, System.Sooid, Sooloos.Broker.Api.PlayParameters, Sooloos.Broker.Api.Playlist, Sooloos.Broker.Api.PlaylistItem, Base.ResultCallback<Sooloos.Broker.Api.PlayFeedback>)";
const zoneOid = (/** @type {number} */ k) => 31000n + BigInt(k);

/** The Transport, each zone and its endpoints. @param {any[] | undefined} zones @param {(cmd: number, body: Buffer) => void} push */
function pushTransport(zones, push) {
  const obj = (/** @type {bigint} */ oid, /** @type {number} */ t, /** @type {Buffer} */ rest) => push(3, Buffer.concat([new BinaryWriter().long(oid).flexInt(t).toBuffer(), rest]));
  obj(TRANSPORT_OID, X.Transport, new BinaryWriter().flexInt(1).string("Transport").flexInt(0).toBuffer());
  (zones || DEFAULT_ZONES).forEach((z, k) => {
    const id = Buffer.from(z.id, "hex");
    const w = new BinaryWriter().flexInt(1).flexInt(id.length).bytes(id);
    if (z.name) w.flexInt(2).string(z.name);
    obj(zoneOid(k), X.Zone, w.flexInt(0).toBuffer());
    z.endpoints.forEach((e, n) => obj(32000n + BigInt(k * 10 + n), X.Endpoint, new BinaryWriter().flexInt(1).string(e).flexInt(2).long(zoneOid(k)).flexInt(0).toBuffer()));
  });
}

/**
 * @param {{ sig: string, r: any, rid: number, oid: bigint, clientTypes: Map<number, any>, zones: any[] | undefined, store: any[],
 *           ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void, rec: any, faults: any,
 *           onPlay?: (p: { zone: string, playlist: string, shuffle: boolean }) => void }} c
 * @returns {boolean} whether it was a play
 */
function handlePlay(c) {
  if (!c.sig.includes("Transport::Play")) return false;
  if (c.sig !== SIG) throw new Error("a Transport play the fake does not take: " + c.sig);
  if (c.oid !== TRANSPORT_OID) throw new Error("a play sent to an object that is not the Transport: " + c.oid);
  const zones = c.zones || DEFAULT_ZONES;
  const zoneRef = c.r.long();
  const z = zones.find((_x, k) => zoneOid(k) === zoneRef);
  if (!z) throw new Error("PlayPlaylist on an object that is not a zone: " + zoneRef);
  const profile = c.r.sooid();
  if (profile.toString("hex") !== "cafebabe" && profile.toString("hex") !== "deadbeef") throw new Error("PlayPlaylist for a profile the fake doesn't have");
  const params = readInline(c.r, c.clientTypes, "Sooloos.Broker.Api.PlayParameters");
  const plRef = c.r.long();
  const pl = c.store.find((p) => oidOf(p) === plRef);
  if (!pl) throw new Error("PlayPlaylist named an object that is not a playlist");
  if (c.r.long() !== 0n) throw new Error("PlayPlaylist from an item: the probe's build plays from the start");
  if (c.r.pos !== c.r.buf.length) throw new Error("bytes after PlayPlaylist's arguments");
  const play = { zone: z.id, playlist: pl.name, shuffle: params.Shuffle === true };
  c.rec.plays.push(play);
  if (c.faults.refusePlay) { c.refuse(c.rid, "Refused"); return true; }
  c.ok(c.rid);
  if (!c.faults.playIgnored && c.onPlay) c.onPlay(play);
  return true;
}

module.exports = { pushTransport, handlePlay, TRANSPORT_TYPES };
