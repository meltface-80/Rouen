// @ts-check
"use strict";
/*
 * versions.js — an album's other versions, for the album view's Versions (dev/design/album-versions.md, v2.0.3-t16):
 * the library's copies grouped as one album, its other releases in the library, and the streaming services'
 * releases, as your server holds them; a version's tracks; and a version played whole on the chosen zone.
 *
 *   Library::GetAlbum(AlbumBase) for the album (proven: the reads probe, native-remote.md §16.7) → an Album whose
 *     AlternateAlbumVersions is a struct of three list objects (LibraryGroupVersions, LibraryOtherVersions,
 *     StreamingVersions), each of AlternateAlbumVersion structs: Album (an AlbumLite by reference), Version, TrackCount,
 *     Formats, ContentLocations. The AlbumLite: Title, ContentSource, IsHidden, IsDuplicate, LibraryAlbumId or
 *     RoonReleaseId, the id a version is known by here (its object's id is only this connection's).
 *   Library::GetAlbumTrackLites(AlbumBase) for a version's tracks (track-times.js, proven).
 *   Transport::PlayAlbum(Zone, Sooid, PlayParameters, AlbumBase, false, true) to play one (new, album-versions.md §4),
 *     believed once the official zone plays what it wasn't, as a smart playlist's play is (smart.js).
 *
 * The server sends an object once a connection, so what a read finds is kept per connection in plain values: an album
 * is asked once, a copy's facts are kept by its object's id for any later answer that names it only, and a library
 * album the library read let go is said from what that read kept of it (`known`). Nothing is let go from the graph
 * (the review: what arrives while the call is out is not all the answer's — a zone made by grouping, say — and a hidden
 * copy's AlbumLite let go would stall the next library read naming it once it is made the default one); an album is asked
 * once a connection, and noRoom keeps the reads within the graph's room. While the server says the album is still
 * loading its versions (they come late), they are read again from the Album the graph holds, up to LOADING_MS. The
 * call is sent in the connection's turn and its answer waited for outside it, so a slow push holds nothing else up.
 */
const { BinaryReader, BinaryWriter } = require("./wire");
const { SIG, playAlbumArgs } = require("./methods");
const { P, field, isRef, memberOf, fullNameOf, waitFor } = require("./objects");
const { readList } = require("./focus");
const { noRoom } = require("./find");
const { albumIndex } = require("./albums");
const { zoneFor, played, shows } = require("./smart");
const { profileFor } = require("./session");

const ANSWER_MS = 15000, LOADING_MS = 2 * 60 * 1000, KEEP_ALBUMS = 300, KEEP_COPIES = 5000;
const CONFIRM_MS = 10000, POLL_MS = 500;
/** The three lists, in Roon's order, and what each is called here. */
const GROUPS = Object.freeze([["LibraryGroupVersions", "library"], ["LibraryOtherVersions", "other"], ["StreamingVersions", "streaming"]]);
/** MediaSource (the catalogue's), where a version is. */
const WHERE = Object.freeze(/** @type {Record<number, string>} */ ({ 1: "Library", 128: "TIDAL", 256: "Qobuz" }));

/**
 * @typedef {{ title: string | null, source: number | null, hidden: boolean, duplicate: boolean, libraryId: string | null,
 *             releaseId: string | null, format: string | null }} Copy  what an AlbumLite says of a version
 * @typedef {{ id: string, group: string, name: string, version: string | null, format: string | null, tracks: number | null,
 *             where: string, hidden: boolean, current: boolean, oid: string }} Version
 */

/** A string, trimmed, or null. @param {any} v */
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A number as sent (an int, a long), or null. @param {any} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : null);
/** A format as Roon writes it, "bit" said "-bit": "FLAC 192kHz 24-bit". @param {string | null} f */
const formatSaid = (f) => (f ? f.replace(/(\d)\s*bit\b/g, "$1-bit") : null);

/**
 * A list member's items, however it is held: a list object by reference, an array, or its bytes (focus.js readList).
 * @param {any} graph @param {any} holder  the struct or the fields holding it @param {string} name
 * @returns {any[]}
 */
function itemsOf(graph, holder, name) {
  const v = memberOf(holder, name);
  if (isRef(v)) { const o = graph.get(BigInt(v.$ref)); return o && o.loaded && Array.isArray(o.fields.$items) ? o.fields.$items : []; }
  if (Array.isArray(v)) return v;
  if (Buffer.isBuffer(v)) { const l = readList(graph, fullNameOf(holder, name), v); return l ? l.items : []; }
  return [];
}

/** A struct's or an object's members (by reference, held), or null. @param {any} graph @param {any} v */
function membersOf(graph, v) {
  if (isRef(v)) { const o = graph.get(BigInt(v.$ref)); return o && o.loaded ? o.fields : null; }
  return v && typeof v === "object" && !Buffer.isBuffer(v) ? v : null;
}

/** What an AlbumLite says of a version; null when the graph doesn't hold it. @param {any} graph @param {any} ref */
function copyOf(graph, ref) {
  const o = isRef(ref) ? graph.get(BigInt(ref.$ref)) : null;
  if (!o || !o.loaded) return null;
  const fmt = field(o, "AlbumFormat"), fm = membersOf(graph, fmt);
  const id = (/** @type {any} */ v) => (typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? String(v) : null);
  return { title: str(field(o, "Title")), source: num(field(o, "ContentSource")), hidden: field(o, "IsHidden") === true,
    duplicate: field(o, "IsDuplicate") === true, libraryId: id(field(o, "LibraryAlbumId")), releaseId: id(field(o, "RoonReleaseId")),
    format: fm ? str(memberOf(fm, "FormatString")) : null };
}

/**
 * An Album's versions in plain terms, in Roon's order (pure; album-versions.md §3.2).
 * @param {any} graph @param {any} album  the Album object @param {string} ownOid  the AlbumLite the album was asked by
 * @param {Map<string, Copy>} copies  what is known of each copy by its object's id (read here, kept for the next answer)
 * @param {Map<string, any> | null} [known]  the library read's albums, by object id: a library copy it let go, said from it
 * @returns {{ versions: Version[], complete: boolean } | null}  null when the Album holds no AlternateAlbumVersions
 */
function versionsOf(graph, album, ownOid, copies, known) {
  const all = membersOf(graph, field(album, "AlternateAlbumVersions"));
  if (!all) return null;
  const albumTitle = str(field(album, "Title"));
  /** @type {Version[]} */
  const out = [];
  for (const [list, group] of GROUPS) {
    for (const it of itemsOf(graph, all, list)) {
      if (!it || typeof it !== "object") continue;
      const ref = memberOf(it, "Album");
      const oid = isRef(ref) ? String(ref.$ref) : null;
      if (!oid) continue;
      const read = copyOf(graph, ref);
      if (read) { copies.set(oid, read); while (copies.size > KEEP_COPIES) copies.delete(/** @type {string} */ (copies.keys().next().value)); }
      const lib = known ? known.get(oid) : null;
      const c = read || copies.get(oid) || (lib ? { title: str(lib.title), source: num(lib.contentSource), hidden: false, duplicate: false,
        libraryId: null, releaseId: null, format: lib.format && lib.format.text ? str(lib.format.text) : null } : null);
      const version = str(memberOf(it, "Version"));
      const formats = itemsOf(graph, it, "Formats").map(str).filter(Boolean);
      const places = itemsOf(graph, it, "ContentLocations").map((l) => str(memberOf(l, "RelativePath"))).filter(Boolean);
      const folder = places.length ? /** @type {string} */ (places[0]).split(/[\\/]/).filter(Boolean).pop() || null : null;
      const title = c ? c.title : null;
      const name = version || (title && title !== albumTitle ? title : null) || folder || `Version ${out.length + 1}`;
      const where = c && c.source !== null && WHERE[c.source] ? WHERE[c.source] : group === "streaming" ? "Streaming" : "Library";
      const id = c && c.libraryId ? "l" + c.libraryId : c && c.releaseId ? "s" + c.releaseId : "o" + oid;
      out.push({ id, group, name, version, format: formatSaid(/** @type {string | null} */ (formats[0] || (c && c.format) || null)),
        tracks: num(memberOf(it, "TrackCount")), where, hidden: !!c && c.hidden, current: oid === ownOid, oid });
    }
  }
  const complete = field(album, "IsLoading") !== true && field(album, "AlternateVersionsReady") !== false;
  return { versions: out, complete };
}

/** A version as the page is given it: without its object's id, which is only this connection's. @param {Version} v */
function shown(v) {
  /** @type {Record<string, any>} */
  const out = Object.assign({}, v);
  delete out.oid;
  return out;
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, off: () => string | null,
 *           on: () => boolean, keyOf: (title: string, artist: string) => string | null, profile: () => string | null,
 *           zone: (id: string) => any, trackTimes: { byOid(oid: string): Promise<any> }, log?: (line: string) => void,
 *           now?: () => number, answerMs?: number, confirmMs?: number, pollMs?: number }} deps
 */
function createVersions(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  /** Per connection: each album's read, and what is known of each copy. @type {WeakMap<object, { albums: Map<string, any>, copies: Map<string, Copy> }>} */
  const kept = new WeakMap();
  const keptFor = (/** @type {any} */ s) => { let k = kept.get(s); if (!k) { k = { albums: new Map(), copies: new Map() }; kept.set(s, k); } return k; };

  /** The session, ready for a read, or why not. @returns {{ s: any, known: Map<string, any> } | { read: false, why: string, wait?: boolean }} */
  function ready() {
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { read: false, wait: true, why: "Native mode isn't connected to your server right now." };
    const full = noRoom(s);
    if (full) return { read: false, wait: true, why: full };
    const known = deps.known(s);
    if (!known) return { read: false, wait: true, why: "Your library hasn't been read on this connection to your server yet." };
    if (s.g.uncertain()) return { read: false, wait: true, why: "The connection to your server is being checked." };
    return { s, known };
  }

  /**
   * Inside the connection's turn: the album's versions kept (done), read again from the Album still held while loading
   * (done), or GetAlbum sent and its Album to wait for (wait), outside the turn.
   * @param {string} title @param {string} artist
   * @returns {Promise<{ done: { read: true, versions: Version[], complete: boolean } | { read: false, why: string, wait?: boolean } }
   *   | { wait: { s: any, known: Map<string, any>, ref: bigint, ownOid: string } }>}
   */
  async function askIn(title, artist) {
    const r = ready();
    if (!("s" in r)) return { done: r };
    const { s, known } = r;
    const want = deps.keyOf(title, artist);
    const album = want ? albumIndex(known, deps.keyOf).get(want) || null : null;
    if (!album) return { done: { read: false, why: "Your server's library has no album of that title and artist on this connection." } };
    const k = keptFor(s), ownOid = String(album.oid);
    const had = k.albums.get(ownOid);
    if (had && had.complete) return { done: { read: true, versions: had.versions, complete: true } };
    if (had && had.held) {
      const o = s.graph.get(BigInt(had.held));
      const got = o && o.loaded ? versionsOf(s.graph, o, ownOid, k.copies, known) : null;
      if (got) {
        const done = got.complete || now() - had.at > LOADING_MS;
        k.albums.set(ownOid, done ? { versions: got.versions, complete: true } : Object.assign(had, { versions: got.versions }));
        return { done: { read: true, versions: got.versions, complete: done } };
      }
    }
    const res = await s.g.call(s.root.library.oid, SIG.getAlbum, new BinaryWriter().long(BigInt(album.oid)).toBuffer());
    if (!res.success) return { done: { read: false, why: "Your server refused the read: " + String(res.status) } };
    const v = s.graph.readValue(new BinaryReader(res.payload), P.Object);
    if (!isRef(v)) return { done: { read: false, why: "Your server's answer named no album." } };
    return { wait: { s, known, ref: BigInt(v.$ref), ownOid } };
  }

  /**
   * The Album asked for, waited for (outside the turn), its versions read and kept.
   * @param {{ s: any, known: Map<string, any>, ref: bigint, ownOid: string }} w
   * @returns {Promise<{ read: true, versions: Version[], complete: boolean } | { read: false, why: string, wait?: boolean }>}
   */
  async function finish(w) {
    const { s, ref, ownOid } = w;
    const answered = await waitFor(deps.answerMs ?? ANSWER_MS, () => { const o = s.graph.get(ref); return o && o.loaded ? o : undefined; });
    if (!answered) return { read: false, wait: true, why: "Your server's album hadn't arrived." };
    const k = keptFor(s);
    const got = versionsOf(s.graph, answered, ownOid, k.copies, w.known) || { versions: [], complete: true };
    k.albums.set(ownOid, got.complete ? { versions: got.versions, complete: true }
      : { versions: got.versions, complete: false, held: String(answered.oid), at: now() });
    while (k.albums.size > KEEP_ALBUMS) k.albums.delete(/** @type {string} */ (k.albums.keys().next().value));
    return { read: true, versions: got.versions, complete: got.complete };
  }

  /** The album's versions, all inside the caller's turn (a version's tracks or play, the probe). @param {string} title @param {string} artist */
  async function readIn(title, artist) {
    const a = await askIn(title, artist);
    return "done" in a ? a.done : finish(a.wait);
  }

  /**
   * A version of the album by its id, inside the turn.
   * @param {string} title @param {string} artist @param {string} id
   * @returns {Promise<{ found: Version } | { read: false, why: string, wait?: boolean }>}
   */
  async function versionIn(title, artist, id) {
    const got = await readIn(title, artist);
    if (!("versions" in got)) return got;
    const v = got.versions.find((x) => x.id === id);
    return v ? { found: v } : { read: false, why: "Your server doesn't list that version of this album any more." };
  }

  return {
    /**
     * The album's versions: none when the album has only itself. complete false: the server is still loading them.
     * @param {string} title @param {string} artist
     */
    async read(title, artist) {
      const why = deps.off();
      if (why) return deps.on() ? { read: false, wait: true, why } : { read: false, why };
      const asked = await deps.inTurn(() => askIn(title, artist));
      const got = "done" in asked ? asked.done : await finish(asked.wait);
      if (!("versions" in got)) return got;
      const others = got.versions.filter((v) => !v.current);
      return { read: true, complete: got.complete, versions: others.length ? got.versions.map(shown) : [] };
    },

    /** A version's tracks. @param {string} title @param {string} artist @param {string} id */
    async tracks(title, artist, id) {
      const why = deps.off();
      if (why) return deps.on() ? { read: false, wait: true, why } : { read: false, why };
      const got = await deps.inTurn(() => versionIn(title, artist, id));
      if (!("found" in got)) return got;
      return deps.trackTimes.byOid(got.found.oid);
    },

    /**
     * A version played whole on the official API's zone, believed once that zone plays what it wasn't.
     * @param {string} title @param {string} artist @param {string} id @param {string} zoneId @param {boolean} shuffle
     * @returns {Promise<{ ok: true } | { notSent: string } | { notShown: string }>}
     */
    async play(title, artist, id, zoneId, shuffle) {
      if (!deps.on()) return { notSent: "Native mode is off." };
      if (!deps.zone(zoneId)) return { notSent: "Choose a zone to play on first." };
      let was = shows(deps.zone(zoneId));
      /** @type {{ ok: true } | { notSent: string } | { unsure: string }} */
      const sent = await deps.inTurn(async () => {
        const got = await versionIn(title, artist, id);
        if (!("found" in got)) return { notSent: got.why };
        const r = ready();
        if (!("s" in r)) return { notSent: r.why };
        const { s } = r;
        const official = deps.zone(zoneId);
        if (!official) return { notSent: "Choose a zone to play on first." };
        const transport = s.graph.ofType("Transport")[0];
        if (!transport) return { notSent: "Your server's graph came without its Transport, which a play is sent to." };
        const z = zoneFor(s.graph, official);
        if ("notSent" in z) return z;
        const pid = profileFor({ profiles: s.root.profiles || [], profileId: s.root.profileId }, deps.profile());
        if (!pid) return { notSent: "Your server named no profile to play as." };
        log(`playing a version of "${title}" (${got.found.name})${shuffle ? " shuffled" : ""} on "${official.display_name || zoneId}"`);
        was = shows(official);
        /** @type {{ success: boolean, status?: string }} */
        let res;
        try { res = await s.g.call(transport.oid, SIG.playAlbum, playAlbumArgs(s.g, z.zone.oid, pid, shuffle, BigInt(got.found.oid))); }
        catch (e) { return { unsure: "Your server didn't answer (" + (e && /** @type {any} */ (e).message) + ")." }; }
        if (!res.success) return { notSent: `Your server refused to play it ("${res.status}").` };
        return { ok: true };
      });
      if ("notSent" in sent) return sent;
      if ("unsure" in sent) return { notShown: sent.unsure };
      const until = now() + (deps.confirmMs ?? CONFIRM_MS);
      for (;;) {
        const z = deps.zone(zoneId);
        if (z && played(was, shows(z))) return { ok: true };
        if (now() >= until) break;
        await new Promise((r) => { setTimeout(r, deps.pollMs ?? POLL_MS); });
      }
      log("the zone didn't start playing within " + (deps.confirmMs ?? CONFIRM_MS) / 1000 + " s of the version's play");
      return { notShown: "Your server took it, but the zone didn't start playing." };
    },

    /** For the probe (album-versions.md §5): the versions with their objects' ids, inside the caller's turn. */
    readIn,
  };
}

module.exports = { createVersions, versionsOf, formatSaid, GROUPS };
