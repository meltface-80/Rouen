// @ts-check
"use strict";
/*
 * credits.js — v1.9.70-t1 (dev/design/album-credits.md §2.1): the credits Roon itself shows on an album's page, read
 * over native mode's connection when Rouen's album page asks. Read only; nothing is written to Roon.
 *
 *   Library::GetMultiAlbumEditInfo for the one album (t3 proved it, t4 runs it): its AlbumEditInfo's Credits, the
 *     album-wide ones.
 *   Library::GetTrackEditInfo(AlbumBase): every track's TrackEditInfo, each with its MediaNumber, TrackNumber and
 *     Credits. New to the allowlist here; never run upstream nor captured, so its argument (the album's object id, as
 *     every by-reference argument) and its answer's form (edit-info.js readAnswer's: a LengthPrefixed collection of
 *     inline structs, else bare) are the design's reading, said as tried until the owner's server proves them.
 *
 * A Credit is { Role, Type (CreditType), Performer (a PerformerLite, by reference) }; its name is the PerformerLite's
 * Name where the server sent the object. One sent without a name is left out and counted. Each Edit*Info's Value(s),
 * what Roon shows, is taken; its other layers are not.
 *
 * An answer of { read: false, wait: true } is for now only (not connected, the library not yet read on the connection,
 * the connection being checked): the finder asks again soon rather than keeping "nothing" for a month (the review).
 * The album is found in what the connection was sent through a key → album index built once per library read.
 */
const { isRef } = require("./objects");
const { SIG } = require("./methods");
const { BinaryWriter } = require("./wire");
const { editInfoArgs, readAnswer, memberOf, fullNameOf } = require("./edit-info");
const { readList } = require("./focus");
const { noRoom } = require("./find");

const TRIES = Object.freeze([[], ["en"]]);

/** An Edit*Info's value: Value, else the bare value sent in its place. @param {any} v */
function valueOf(v) {
  if (v && typeof v === "object" && "$type" in v) return memberOf(v, "Value");
  return v;
}

/**
 * The credits of an EditListInfo<Credit>, each { role, type, name }; how many came with no name.
 * @param {any} graph @param {any} list  the EditListInfo struct
 * @returns {{ credits: Array<{ role: string | null, type: number | null, name: string | null }>, unnamed: number, whole: boolean }}
 */
function creditsOf(graph, list) {
  const out = { credits: /** @type {Array<{ role: string | null, type: number | null, name: string | null }>} */ ([]), unnamed: 0, whole: true };
  if (!list || typeof list !== "object") return out;
  const bytes = memberOf(list, "Values");
  if (!Buffer.isBuffer(bytes)) return out;
  const read = readList(graph, fullNameOf(list, "Values"), bytes);
  if (!read) return out;
  out.whole = read.whole;
  for (const c of read.items) {
    if (!c || typeof c !== "object" || isRef(c)) continue;
    const role = memberOf(c, "Role"), type = memberOf(c, "Type"), who = memberOf(c, "Performer");
    const name = nameOf(graph, who);
    if (!name) { out.unnamed++; continue; }
    out.credits.push({ role: typeof role === "string" ? role : null, type: typeof type === "number" ? type : null, name });
  }
  return out;
}

/** A PerformerLite's Name: the object the server sent by reference, or one inline. @param {any} graph @param {any} p */
function nameOf(graph, p) {
  let fields = null;
  if (isRef(p)) { const o = graph.get(BigInt(p.$ref)); fields = o ? o.fields : null; }
  else if (p && typeof p === "object") fields = p;
  const n = fields ? memberOf(fields, "Name") : null;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, off: () => string | null,
 *           keyOf: (title: string, artist: string) => string | null, log?: (line: string) => void }} deps
 */
function createRoonCredits(deps) {
  const log = deps.log || (() => {});
  /** One index a library read (the known map is the read's), so a page doesn't scan the library inside the turn. */
  const indexes = new WeakMap();
  /** @param {Map<string, import("./albums").RoonAlbum>} known */
  function indexOf(known) {
    let ix = indexes.get(known);
    if (!ix) {
      ix = new Map();
      for (const a of known.values()) { const k = deps.keyOf(a.title, a.artist); if (k && !ix.has(k)) ix.set(k, a); }
      indexes.set(known, ix);
    }
    return ix;
  }
  return {
    /**
     * An album's credits as your server holds them.
     * @param {string} title @param {string} artist
     * @returns {Promise<{ read: true, album: any[], tracks: Array<{ disc: number, number: number, credits: any[] }>, unnamed: number, how: any }
     *   | { read: false, why: string, wait?: boolean, how?: any }>}
     */
    async album(title, artist) {
      const why = deps.off();
      if (why) return { read: false, why };
      return deps.inTurn(async () => {
        const s = deps.link ? deps.link.session() : null;
        if (!s) return { read: false, wait: true, why: "Native mode isn't connected to your server right now." };
        const full = noRoom(s);
        if (full) return { read: false, wait: true, why: full };
        const known = deps.known(s);
        if (!known) return { read: false, wait: true, why: "Your library hasn't been read on this connection to your server yet." };
        const { g, graph, root } = s;
        if (g.uncertain()) return { read: false, wait: true, why: "The connection to your server is being checked." };
        const want = deps.keyOf(title, artist);
        const album = want ? indexOf(known).get(want) || null : null;
        if (!album) return { read: false, why: "Your server's library has no album of that title and artist on this connection." };
        const oid = BigInt(album.oid);
        const how = /** @type {Record<string, any>} */ ({ album: { title: album.title, artist: album.artist } });

        // The album-wide credits: the call t3 proved, as t4 sends it.
        /** @type {any[]} */
        let whole = [];
        let unnamed = 0;
        for (const languages of TRIES) {
          const r = await g.call(root.library.oid, SIG.albumEditInfo, editInfoArgs(g, [oid], [...languages]));
          how.albumEditInfo = r.success ? "Success" : String(r.status);
          if (!r.success) continue;
          const got = readAnswer(graph, r.payload);
          if ("undecoded" in got) { how.albumAnswer = got.why; break; }
          const it = got.items[0];
          const c = creditsOf(graph, it ? memberOf(it, "Credits") : null);
          whole = c.credits; unnamed += c.unnamed;
          if (!c.whole) how.albumCreditsCut = true;
          break;
        }

        // Every track's: new here, tried.
        const r = await g.call(root.library.oid, SIG.trackEditInfo, new BinaryWriter().long(oid).toBuffer());
        how.trackEditInfo = r.success ? "Success" : String(r.status);
        /** @type {Array<{ disc: number, number: number, credits: any[] }>} */
        const tracks = [];
        if (r.success) {
          const got = readAnswer(graph, r.payload);
          if ("undecoded" in got) { how.trackAnswer = { why: got.why, bytes: got.bytes }; log("album credits: a track answer that couldn't be read"); }
          else {
            how.trackForm = got.form;
            for (const it of got.items) {
              const disc = Number(valueOf(memberOf(it, "MediaNumber"))) || 1, number = Number(valueOf(memberOf(it, "TrackNumber"))) || 0;
              const c = creditsOf(graph, memberOf(it, "Credits"));
              unnamed += c.unnamed;
              if (!c.whole) how.trackCreditsCut = true;
              tracks.push({ disc, number, credits: c.credits });
            }
            tracks.sort((a, b) => a.disc - b.disc || a.number - b.number);
          }
        }
        if (!whole.length && !tracks.length && how.albumEditInfo !== "Success" && how.trackEditInfo !== "Success") {
          return { read: false, why: "Your server refused both reads.", how };
        }
        return { read: true, album: whole, tracks, unnamed, how };
      });
    },
  };
}

module.exports = { createRoonCredits, creditsOf, nameOf, valueOf };
