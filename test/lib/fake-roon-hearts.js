"use strict";
// ---------------------------------------------------------------------------
// The fake Core's hearts (native-remote.md §8, v1.9.27): Library::FavoriteOrBan
// as lib/roon-direct/marks.js sends it, read back strictly, so a test fails on
// bytes the client got wrong. Kept apart from fake-roon-core.js, which calls
// it from its handler. Like the rest of the fake, built from the wire rules
// Rouen ports — not evidence that a real Core behaves this way (§2's "live"
// column is).
//
//  - the album form: Sooid, then a LengthPrefixed collection (flexInt(length),
//    flexInt(count), elements) of inline AlbumLink values, each the client's
//    declared type (AlbumId long, Broker object, Source enum) holding AlbumId
//    and a Broker reference to the root graph's Broker; then the state.
//  - the track form: Sooid, a TrackLite's object id, the state; the track's
//    updated object is pushed (it is held by the query that named it).
//  - an album's update is NOT pushed: the client let it go after reading it.
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");

const OWNER = Buffer.from("cafebabe", "hex");
const OTHER = Buffer.from("deadbeef", "hex");
const BROKER_OID = 9n;

/** A ProfileData<bool> body: another profile's opposite value, then the owner's. @param {boolean} fav */
function profileData(fav) {
  const w = new BinaryWriter().flexInt(2);
  w.flexInt(OTHER.length).bytes(OTHER).bytes(Buffer.from([fav ? 0 : 1]));
  w.flexInt(OWNER.length).bytes(OWNER).bytes(Buffer.from([fav ? 1 : 0]));
  return w.toBuffer();
}

/**
 * @param {{ sig: string, r: BinaryReader, rid: number, clientTypes: Map<number, { name: string, members: Array<[string, number]> }>,
 *           albums: any[], albumIdOf: (i: number) => bigint, trackFav: Map<string, boolean>, tracksByOid: (oid: bigint) => any,
 *           pushTrack: (t: any) => void, ok: (rid: number, payload?: Buffer) => void, refuse: (rid: number, why: string) => void,
 *           rec: any, faults: any }} c
 * @returns {boolean} whether it was a heart
 */
function handleHeart(c) {
  if (!c.sig.includes("Library::FavoriteOrBan")) return false;
  const r = c.r;
  const profile = r.sooid();
  if (!profile.equals(OWNER) && !profile.equals(OTHER)) throw new Error("FavoriteOrBan for a profile the fake does not have: " + profile.toString("hex"));
  if (c.sig.includes("IEnumerable<Sooloos.Broker.Api.AlbumBase>")) {
    const list = new BinaryReader(r.bytes(r.flexInt()));
    const ids = [];
    for (let n = list.flexInt(); n > 0; n--) {
      if (list.long() !== 1n) throw new Error("an AlbumLink not sent as an inline value");
      const t = c.clientTypes.get(list.flexInt());
      if (!t || t.name !== "Sooloos.Broker.Api.AlbumLink" || t.members.length !== 3) throw new Error("not the AlbumLink type as declared: " + JSON.stringify(t));
      const body = new BinaryReader(list.bytes(list.flexInt()));
      let albumId = null, broker = null;
      for (let idx = body.flexInt(); idx !== 0; idx = body.flexInt()) {
        const [name, prop] = t.members[idx - 1];
        if (name.endsWith("::AlbumId") && prop === 1) albumId = body.long();
        else if (name.endsWith("::Broker") && prop === 23) broker = body.long();
        else throw new Error("an AlbumLink member the fake does not expect: " + name);
      }
      if (body.pos !== body.buf.length) throw new Error("bytes after an AlbumLink's terminator");
      if (broker !== BROKER_OID) throw new Error("an AlbumLink whose Broker is not the graph's: " + broker);
      ids.push(albumId);
    }
    if (list.pos !== list.buf.length) throw new Error("bytes after the AlbumLink collection");
    const state = r.flexInt();
    if (r.pos !== r.buf.length) throw new Error("bytes after the album heart's state");
    c.rec.hearts.push(Object.assign({ albums: ids.map(String), state }, profile.equals(OTHER) ? { profile: "deadbeef" } : {}));
    if (c.faults.refuseHearts) { c.refuse(c.rid, "Refused"); return true; }
    for (const id of ids) {
      const i = c.albums.findIndex((_a, k) => c.albumIdOf(k) === id);
      if (i >= 0 && !c.faults.heartsIgnored) c.albums[i].favorite = state === 1;
    }
    c.ok(c.rid);
    return true;
  }
  if (c.sig.includes("Sooloos.Broker.Api.TrackBase,")) {
    const oid = r.long();
    const state = r.flexInt();
    if (r.pos !== r.buf.length) throw new Error("bytes after the track heart's state");
    c.rec.hearts.push({ track: String(oid), state });
    if (c.faults.refuseHearts || !c.tracksByOid(oid)) { c.refuse(c.rid, c.faults.refuseHearts ? "Refused" : "NoSuchObject"); return true; }
    c.ok(c.rid);
    const t = c.tracksByOid(oid);
    if (t && !c.faults.heartsIgnored && !c.faults.noTrackHeartUpdate) { c.trackFav.set(String(oid), state === 1); c.pushTrack(t); }
    return true;
  }
  throw new Error("a FavoriteOrBan form the fake does not take: " + c.sig);
}

module.exports = { handleHeart, profileData, OWNER, OTHER, BROKER_OID };
