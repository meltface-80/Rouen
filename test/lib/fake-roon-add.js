"use strict";
// ---------------------------------------------------------------------------
// The fake server's add to the library (N2b-2, v1.9.41, native-remote.md
// §9.2): Library::AddToLibrary(Profile, IEnumerable<AlbumBase>) as
// lib/roon-direct/adder.js sends it, read strictly — the Profile by its
// object, then hearts' AlbumLink collection — and never answered, as the
// catalogue says the real one is not (no callback). A catalogue album named
// by its AlbumId joins the library as the same object, as find.test.js adds
// one by hand. Not evidence that the real server takes this form: the owner's
// server is, once it shows the album.
//
// faults.addIgnored: the add read, recorded, and nothing done.
// ---------------------------------------------------------------------------

const { readAlbumLinks } = require("./fake-roon-hearts");

const SIG = "Sooloos.Broker.Api.Library::AddToLibrary(Sooloos.Broker.Api.Profile, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.AlbumBase>)";

/**
 * @param {{ sig: string, r: import("../../lib/roon-direct/wire").BinaryReader, clientTypes: Map<number, { name: string, members: Array<[string, number]> }>,
 *           albums: any[], catalog: any[], rec: any, faults: any }} c
 * @returns {boolean} whether it was AddToLibrary
 */
function handleAdd(c) {
  if (!c.sig.includes("AddToLibrary")) return false;
  if (c.sig !== SIG) throw new Error("an AddToLibrary form the fake does not take: " + c.sig);
  const profile = c.r.long();
  if (profile !== 2n && profile !== 12n) throw new Error("AddToLibrary for an object that is not a profile: " + profile);
  const ids = readAlbumLinks(c.r, c.clientTypes);
  if (c.r.pos !== c.r.buf.length) throw new Error("bytes after AddToLibrary's arguments");
  c.rec.adds.push({ profile: String(profile), albums: ids.map(String) });
  if (c.faults.addIgnored) return true;
  for (const id of ids) {
    const j = Number(id - 8000000000000n);
    const a = (c.catalog || [])[j];
    if (!a || a.noAlbumId || c.albums.some((x) => x.oid === 60000n + BigInt(j))) continue;
    c.albums.push({ title: a.title, artist: a.artist, source: a.source, tracks: 0, oid: 60000n + BigInt(j) });
  }
  return true;
}

module.exports = { handleAdd };
