// @ts-check
"use strict";
/*
 * playlists.js — N2d (dev/design/native-remote.md §11, v1.9.42): Roon's own playlists, made and
 * changed by your server itself, for the profile chosen in Settings → Native mode.
 *
 *   The Library's `Playlists` member → the Playlists object → its `AllPlaylists`, each Playlist with
 *   its Name, PlaylistId, IsReadOnly and track count. Then, on the Playlists object:
 *   CreatePlaylist(Profile, name, "", false) → the new Playlist; InsertTracks(Playlist, [tracks],
 *   End, null) — each track by its session object, found by the album's track query (album-tracks.js),
 *   while that page is held; InsertAlbums(Playlist, [AlbumLink], End, null); Rename(Playlist, name,
 *   false); Delete(Playlist).
 *
 * None of the calls has been run (upstream never did; Roon's app was never captured making them), and
 * neither the Playlists object nor its list has been seen on the owner's server. Tried, not trusted
 * (§11.3): what this module answers is what the server said; the routes (lib/playlists-native.js)
 * believe a change once the official API's playlist list shows it. What can't be sent comes back as
 * `notSent`, with why, for today's way to take over.
 *
 * A playlist is named to the page by its PlaylistId, as hex — never by an object id, which belongs to
 * one connection. Everything takes its turn with reads, hearts and searches.
 */
const { field, plain, isRef, waitFor } = require("./objects");
const { SIG, playlistArgs } = require("./methods");
const { readFlexLong } = require("./wire");
const { profileObjectFor, profilesOf } = require("./session");
const { withAlbumTracks } = require("./album-tracks");
const { noRoom } = require("./find");

/**
 * @typedef {import("./albums").RoonAlbum} RoonAlbum
 * @typedef {{ id: string, name: string, tracks: number | null, readOnly: boolean }} Listed
 * @typedef {{ title: string, album_title: string, album_subtitle: string }} WantedTrack
 * @typedef {{ notSent: string }} NotSent
 * @typedef {{ error: string }} Failed  sent, and refused or not answered as asked
 */

/** A member of a pushed object, by its short name. @param {any} o @param {string} name */
const member = (o, name) => field(o, name);
/** A Sooid as hex, or null. @param {any} v */
const hex = (v) => (Buffer.isBuffer(v) ? v.toString("hex") : null);
/** A count, as a number. @param {any} v */
const num = (v) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null);

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           profile: () => string | null, albums: () => RoonAlbum[] | null, readOn: () => any,
 *           keyOf: (title: string, artist: string) => string | null,
 *           log?: (line: string) => void, settleMs?: number, timeoutMs?: number }} deps
 *   on: native mode switched on; albums / readOn: the library read and the session it was read on (an
 *   album's object belongs to that session, which the track query matches tracks by)
 */
function createPlaylists(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 4000;
  const timeoutMs = deps.timeoutMs || 15000;
  /** The last read that found no playlists: not waited for again on that session for a minute (the review). */
  let unreadable = { s: /** @type {any} */ (null), at: 0 };
  const NOT_SENT_THEM = "Your server didn't send its playlists to Rouen.";
  /** Why the library can't yet name the albums a track or an album is on, on this session; or null. @param {any} s */
  const notReadOn = (s) => (!deps.albums() || deps.readOn() !== s
    ? "Your library hasn't been read on this connection to your server yet; try again in a minute." : null);

  /** The session to act on, or why there is none. @returns {{ s: any } | NotSent} */
  function sessionNow() {
    if (!deps.on()) return { notSent: "" };   // native mode off: today's way, nothing to explain
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { notSent: "Native mode isn't connected to your server right now." };
    if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
    const full = noRoom(s);
    if (full) return { notSent: full };
    return { s };
  }

  /**
   * The Playlists object and every playlist it lists, once all have arrived; why not, after settleMs.
   * @param {any} s @returns {Promise<{ svc: any, list: Array<Listed & { oid: bigint }> } | NotSent>}
   */
  async function read(s) {
    if (unreadable.s === s && Date.now() - unreadable.at < 60000) return { notSent: NOT_SENT_THEM };
    const got = await waitFor(settleMs, () => {
      const all = allPlaylists(s);
      if (!all) return undefined;
      /** @type {Array<Listed & { oid: bigint }>} */
      const out = [];
      for (const p of all.playlists) {
        const id = hex(member(p, "PlaylistId"));
        if (!id) continue;   // no id to name it by: not offered
        out.push({ oid: p.oid, id, name: member(p, "Name"), tracks: num(member(p, "TrackCount")) ?? num(member(p, "ItemCount")),
          readOnly: member(p, "IsReadOnly") === true });
      }
      return { svc: all.svc, list: out };
    });
    if (!got) { unreadable = { s, at: Date.now() }; return { notSent: NOT_SENT_THEM }; }
    return got;
  }

  /** The profile to act for: the one chosen, when there are several. @param {any} s */
  function profileOf(s) {
    const profiles = profilesOf(s.root);
    if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return null;
    return profileObjectFor(s.root, deps.profile());
  }

  /** The library album named so, on the session it was read on: exact, else by its key; one, or none. */
  function albumOf(/** @type {any} */ s, /** @type {string} */ title, /** @type {string} */ artist) {
    const list = deps.albums();
    if (!list || deps.readOn() !== s) return null;
    let hits = list.filter((a) => a.title === title && a.artist === artist);
    if (!hits.length) {
      const k = deps.keyOf(title, artist);
      if (k) hits = list.filter((a) => deps.keyOf(a.title, a.artist) === k);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /**
   * One editable playlist, by its id, with the session and the Playlists object; or why not.
   * @param {string} id @returns {Promise<{ s: any, svc: any, pl: Listed & { oid: bigint } } | NotSent>}
   */
  async function editable(id) {
    const at = sessionNow();
    if ("notSent" in at) return at;
    const r = await read(at.s);
    if ("notSent" in r) return r;
    const pl = r.list.find((p) => p.id === id);
    if (!pl) return { notSent: "Your server doesn't list that playlist any more." };
    if (pl.readOnly) return { notSent: "That playlist can't be changed (it isn't yours to edit in Roon)." };
    // A change is believed by the playlist's name in the official list (§11.3): two of one name can't be told apart there.
    if (r.list.filter((p) => p.name === pl.name).length > 1) return { notSent: `Your server has two playlists named "${pl.name}"; Rouen can't tell them apart.` };
    return { s: at.s, svc: r.svc, pl };
  }

  return {
    /** The Playlists object and its playlists, on a session, by a caller in its turn: smart.js's list (v1.9.51, the review). */
    read,

    /** Roon's playlists, as the Add to playlist sheet offers them. @returns {Promise<{ playlists: Listed[] } | NotSent>} */
    list: () => deps.inTurn(async () => {
      const at = sessionNow();
      if ("notSent" in at) return at;
      const r = await read(at.s);
      if ("notSent" in r) return r;
      return { playlists: r.list.map(({ id, name, tracks, readOnly }) => ({ id, name, tracks, readOnly })) };
    }),

    /** A new playlist. @param {string} name @returns {Promise<{ id: string, name: string } | NotSent | Failed>} */
    create: (name) => deps.inTurn(async () => {
      const at = sessionNow();
      if ("notSent" in at) return at;
      const r = await read(at.s);
      if ("notSent" in r) return r;
      const profile = profileOf(at.s);
      if (!profile) return { notSent: "Choose your profile in Settings → Native mode first." };
      if (r.list.some((p) => p.name === name)) return { notSent: `Your server already has a playlist named "${name}".` };
      const { g, graph } = at.s;
      const res = await g.call(r.svc.oid, SIG.createPlaylist, playlistArgs.create(profile.oid, name));
      if (!res.success) return { error: `Your server refused the new playlist ("${res.status}").` };
      const ref = readFlexLong(res.payload, 0);
      if (!ref || ref[0] < 2n) return { error: "Your server's answer named no playlist." };
      const made = await waitFor(settleMs, () => {
        const p = graph.get(ref[0]);
        return p && p.loaded && hex(member(p, "PlaylistId")) ? p : undefined;
      });
      if (!made) return { error: "Your server made a playlist but didn't send it to Rouen." };
      log(`playlist made: "${name}"`);
      return { id: /** @type {string} */ (hex(member(made, "PlaylistId"))), name: String(member(made, "Name") || name) };
    }),

    /**
     * Tracks added at the end, in the order picked: each run of tracks from one album found by that album's
     * track query and inserted while its page is held. Those not found on their album are named (`missing`);
     * an album whose tracks the server didn't give or take is named by its tracks (`failed`), with why, and
     * the rest go on — the caller keeps those in Rouen.
     * @param {string} id @param {WantedTrack[]} tracks
     * @returns {Promise<{ sent: number, missing: string[], failed: string[], why: string | null } | NotSent | Failed>}
     */
    addTracks: (id, tracks) => deps.inTurn(async () => {
      const at = await editable(id);
      if ("notSent" in at) return at;
      const { s, svc, pl } = at;
      const nr = notReadOn(s);
      if (nr) return { notSent: nr };
      const profile = profileOf(s);
      if (!profile) return { notSent: "Choose your profile in Settings → Native mode first." };
      const pid = /** @type {Buffer} */ (member(profile, "ProfileId"));
      /** Runs of tracks from one album, in the order picked (the playlist keeps that order, the review). */
      const runs = /** @type {Array<{ title: string, artist: string, titles: string[] }>} */ ([]);
      for (const t of tracks) {
        const last = runs[runs.length - 1];
        if (last && last.title === t.album_title && last.artist === t.album_subtitle) last.titles.push(t.title);
        else runs.push({ title: t.album_title, artist: t.album_subtitle, titles: [t.title] });
      }
      /** @type {string[]} */
      const missing = [], failed = [];
      /** @type {string | null} */
      let why = null;
      let sent = 0;
      for (const run of runs) {
        const a = albumOf(s, run.title, run.artist);
        if (!a) { missing.push(...run.titles); continue; }
        const out = await withAlbumTracks(s, pid, { title: a.title, artist: a.artist, oid: a.oid }, { timeoutMs, what: "none of its tracks were added" },
          async (mine, titleOf) => {
            /** @type {bigint[]} */
            const oids = [];
            /** @type {string[]} */
            const lost = [];
            for (const want of run.titles) {
              // Exact, and the album's only track of that title: two can't be told apart (a reprise, a second take).
              const same = mine.filter((m) => titleOf(m) === want);
              if (same.length === 1) oids.push(BigInt(same[0])); else lost.push(want);
            }
            if (!oids.length) return { count: 0, lost };
            const res = await s.g.call(svc.oid, SIG.insertTracks, playlistArgs.tracks(pl.oid, oids));
            if (!res.success) return { error: `Your server refused the tracks ("${res.status}").`, status: 502 };
            return { count: oids.length, lost };
          });
        if ("error" in out) { failed.push(...run.titles); why = why || out.error; continue; }
        sent += out.count;
        missing.push(...out.lost);
      }
      log(`playlist "${pl.name}": ${sent} track(s) sent, ${missing.length} not found, ${failed.length} not taken`);
      if (!sent && failed.length) return { error: /** @type {string} */ (why) };
      if (!sent) return { notSent: "None of these tracks were found on their albums in your library." };
      return { sent, missing, failed, why };
    }),

    /**
     * Whole albums added at the end, each by its AlbumId; those not found in the library named.
     * @param {string} id @param {Array<{ title: string, subtitle: string }>} albums
     * @returns {Promise<{ sent: number, missing: string[], failed: string[], why: string | null } | NotSent | Failed>}
     */
    addAlbums: (id, albums) => deps.inTurn(async () => {
      const at = await editable(id);
      if ("notSent" in at) return at;
      const { s, svc, pl } = at;
      const nr = notReadOn(s);
      if (nr) return { notSent: nr };
      const broker = s.graph.ofType("Broker")[0];
      if (!broker) return { notSent: "Your server's graph came without its Broker, which an album is named by." };
      /** @type {bigint[]} */
      const ids = [];
      /** @type {string[]} */
      const missing = [];
      for (const al of albums) {
        const a = albumOf(s, al.title, al.subtitle);
        if (a && a.albumId) ids.push(BigInt(a.albumId)); else missing.push(al.title);
      }
      if (!ids.length) return { notSent: "None of these albums were found in your library." };
      const res = await s.g.call(svc.oid, SIG.insertAlbums, playlistArgs.albums(s.g, pl.oid, broker.oid, ids));
      if (!res.success) return { error: `Your server refused the albums ("${res.status}").` };
      log(`playlist "${pl.name}": ${ids.length} album(s) sent, ${missing.length} not found`);
      return { sent: ids.length, missing, failed: [], why: null };
    }),

    /** @param {string} id @param {string} name @returns {Promise<{ ok: true } | NotSent | Failed>} */
    rename: (id, name) => deps.inTurn(async () => {
      const at = await editable(id);
      if ("notSent" in at) return at;
      const res = await at.s.g.call(at.svc.oid, SIG.renamePlaylist, playlistArgs.rename(at.pl.oid, name));
      return res.success ? { ok: /** @type {const} */ (true) } : { error: `Your server refused the new name ("${res.status}").` };
    }),

    /** @param {string} id @returns {Promise<{ ok: true, name: string } | NotSent | Failed>} */
    remove: (id) => deps.inTurn(async () => {
      const at = await editable(id);
      if ("notSent" in at) return at;
      const res = await at.s.g.call(at.svc.oid, SIG.deletePlaylist, playlistArgs.remove(at.pl.oid));
      return res.success ? { ok: /** @type {const} */ (true), name: at.pl.name } : { error: `Your server refused to delete it ("${res.status}").` };
    }),
  };
}

/**
 * The Playlists object and every Playlist object its AllPlaylists lists, once all have arrived (each with its Name), or
 * undefined while any is still to come; shared with the smart-playlist probe (smart-probe.js, v1.9.50, the review).
 * @param {any} s @returns {{ svc: any, playlists: any[] } | undefined}
 */
function allPlaylists(s) {
  const { graph, root } = s;
  const ref = member(root.library, "Playlists");
  const svc = isRef(ref) ? graph.get(ref.$ref) : graph.ofType("Playlists")[0];
  if (!svc || !svc.loaded) return undefined;
  const all = member(svc, "AllPlaylists");
  if (!isRef(all)) return undefined;
  const list = graph.get(all.$ref);
  if (!list || !list.loaded || !list.fields.$items || (list.fields.$count >= 0 && list.fields.$items.length < list.fields.$count)) return undefined;
  const playlists = [];
  for (const x of list.fields.$items) {
    const p = isRef(x) ? graph.get(x.$ref) : null;
    if (!p || !p.loaded || typeof member(p, "Name") !== "string") return undefined;   // still to come
    playlists.push(p);
  }
  return { svc, playlists };
}

/**
 * The session, the chosen profile's object, and the Playlists object with its playlists now; or why not. Shared by the
 * smart-playlist make and update (moved here from smart-make.js in v1.9.55, the review).
 * @param {{ link: { session(): any } | null, on: () => boolean, profile: () => string | null }} deps
 * @returns {{ s: any, profile: any, all: { svc: any, playlists: any[] } } | { notSent: string }}
 */
function playlistsNow(deps) {
  if (!deps.on()) return { notSent: "Native mode is off." };
  const s = deps.link ? deps.link.session() : null;
  if (!s) return { notSent: "Native mode isn't connected to your server right now." };
  if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
  const profiles = profilesOf(s.root);
  if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return { notSent: "Choose your profile in Settings → Native mode first." };
  const profile = profileObjectFor(s.root, deps.profile());
  if (!profile) return { notSent: "Your server sent no profile." };
  const all = allPlaylists(s);
  if (!all) return { notSent: "Your server hasn't sent its playlists, whole." };
  return { s, profile, all };
}

const SMART = 15;   // PlaylistType Smart, as the catalogue has it and the owner's server sent it (§12.2)
/** Smart, as §12.1 has it: Type Smart, or carrying a Focus (moved here from smart-probe.js in v1.9.51). @param {any} p */
const isSmart = (p) => plain(member(p, "Type")) === SMART || member(p, "AlbumCriteria") !== undefined || member(p, "TrackCriteria") !== undefined;

module.exports = { createPlaylists, allPlaylists, isSmart, playlistsNow };
