// @ts-check
"use strict";
/*
 * marks.js — hearts, written to your server itself (dev/design/native-remote.md
 * §8, N2a, v1.9.27): Roon's own favourite, for the profile Rouen acts for.
 *
 *  - AN ALBUM is named by its stable AlbumId, which the library read keeps on
 *    each album (albums.js), with its IsFavorite: Library::FavoriteOrBan's
 *    album form, a collection of inline AlbumLink { AlbumId, Broker }. The
 *    album objects were dropped once read, so no update of them is waited
 *    for: the heart is believed on the call's "Success", and the next
 *    library read must show it (afterRead); one that shows otherwise drops
 *    album hearts back, saying why.
 *  - TRACKS are named by their session objects, which the album view does not
 *    have (its tracks still come from the official API, N5): a track query
 *    with the album's title and artist as text filters, one page retained,
 *    the album's own tracks kept (their Album's AlbumId is the album's), and
 *    — only when they are exactly the album view's titles — each picked track
 *    hearted while the page is held, and believed once its updated IsFavorite
 *    arrives. The page is released and the query disposed whatever happens.
 *  - Tried, not trusted (§3.3): a refusal, or a heart the Core does not bear
 *    out, drops that kind of heart back for the rest of the connection (the
 *    next session tries again), and Settings → Native mode says why. Being
 *    offline, or an album that cannot be named, is an answer for that one
 *    tap, not a fallback.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, pageArg, openAlbumTrackQuery, favoriteAlbumsArgs, favoriteTrackArgs } = require("./methods");
const { readCount } = require("./locations");
const { profileBool } = require("./profile-data");
const { profileFor } = require("./session");

const MAX_TRACKS = 500;
const TRACK = /\.TrackLite$/;

/**
 * @typedef {import("./albums").RoonAlbum} RoonAlbum
 * @typedef {{ ok: true } & Record<string, any>} Done
 * @typedef {{ error: string, status: number }} Refused
 * @param {{ link: { session(): any } | null, albums: () => RoonAlbum[] | null,
 *           keyOf?: (title: string, artist: string) => string | null,
 *           inTurn?: <T>(fn: () => Promise<T>) => Promise<T>, profile?: () => string | null,
 *           enabled?: () => string | null,
 *           log?: (line: string) => void, timeoutMs?: number, confirmMs?: number }} deps
 *   inTurn: the session's turns, shared with the library reads (stage1.js): a heart waits for a
 *   read running, and a read for a heart, so neither watches the graph while the other does;
 *   profile: the id (hex) chosen in Settings → Native mode, or null for the first (session.js profileFor);
 *   enabled: why hearts are not offered (switched off, a profile to choose), or null when they are
 */
function createMarks(deps) {
  const log = deps.log || (() => {});
  const timeoutMs = deps.timeoutMs || 15000;
  const confirmMs = deps.confirmMs || 5000;
  const inTurn = deps.inTurn || ((/** @type {() => Promise<any>} */ fn) => fn());
  const notOn = deps.enabled || (() => null);
  /** The profile hearts are for, on this session. @param {any} s @returns {Buffer} */
  const profileOf = (s) => /** @type {Buffer} */ (profileFor(s.root, deps.profile ? deps.profile() : null));
  /** Each kind's fallback, for this connection: null while hearts of that kind are tried. */
  const fell = { album: /** @type {string | null} */ (null), track: /** @type {string | null} */ (null) };
  let fellOn = /** @type {any} */ (null);
  const tally = { albumSet: 0, albumConfirmed: 0, trackSet: 0 };
  /** Album hearts set and not yet seen by a read: AlbumId → the state asked for. @type {Map<string, boolean>} */
  const pending = new Map();

  /** The session hearts go over, or why there is none. */
  function session() {
    const s = deps.link ? deps.link.session() : null;
    // A new session: whatever fell back on the last one is tried again.
    if (s && s !== fellOn) { fell.album = fell.track = null; fellOn = s; }
    return s;
  }
  /** @param {"album" | "track"} kind @param {string} why */
  function fallBack(kind, why) {
    // Held for the session it happened on — which, for a heart a read did not bear
    // out, is the session that read, not the one the heart was sent on.
    fellOn = deps.link ? deps.link.session() : null;
    fell[kind] = why;
    log(kind + " hearts fell back: " + why);
  }

  /**
   * The Core's album for the album view's title and artist: the same strings,
   * else the same once normalised as the library pairs them; one, or none.
   * @param {string} title @param {string} artist @returns {RoonAlbum | Refused}
   */
  function find(title, artist) {
    const list = deps.albums();
    if (!list) return { error: "Your server's album list hasn't been read yet.", status: 503 };
    let hits = list.filter((a) => a.title === title && a.artist === artist);
    if (!hits.length && deps.keyOf) {
      const k = deps.keyOf(title, artist);
      if (k) hits = list.filter((a) => deps.keyOf && deps.keyOf(a.title, a.artist) === k);
    }
    if (hits.length > 1) return { error: "Your server has two albums by that name and artist; Rouen can't tell which to heart.", status: 409 };
    if (!hits.length) return { error: "Your server's album list doesn't have this album.", status: 404 };
    if (!hits[0].albumId) return { error: "Your server didn't give this album the id a heart needs.", status: 409 };
    return hits[0];
  }

  /** @param {string} title @param {string} artist */
  function albumState(title, artist) {
    const s = session();
    if (notOn()) return { available: false, why: /** @type {string} */ (notOn()) };
    if (!s) return { available: false, why: "Native mode isn't connected to your server right now." };
    if (fell.album) return { available: false, why: fell.album };
    const a = find(title, artist);
    if ("error" in a) return { available: false, why: a.error };
    if (a.favorite === null) return { available: false, why: "Your server didn't say whether this album is a favourite." };
    return { available: true, favorite: a.favorite, tracks: !fell.track, tracksWhy: fell.track };
  }

  /** @param {string} title @param {string} artist @param {boolean} on @returns {Promise<Done | Refused>} */
  async function setAlbum(title, artist, on) {
    if (notOn()) return { error: /** @type {string} */ (notOn()), status: 409 };
    const s = session();
    if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
    if (s.g.uncertain()) return { error: "The connection to your server is being checked; try again in a moment.", status: 503 };
    if (fell.album) return { error: fell.album, status: 409 };
    const a = find(title, artist);
    if ("error" in a) return a;
    const broker = s.graph.ofType("Broker")[0];
    if (!broker) { fallBack("album", "Your server's graph came without its Broker, which a heart names."); return { error: /** @type {string} */ (fell.album), status: 409 }; }
    const res = await s.g.call(s.root.library.oid, SIG.favoriteAlbums, favoriteAlbumsArgs(s.g, profileOf(s), broker.oid, [BigInt(/** @type {string} */ (a.albumId))], on));
    if (!res.success) {
      fallBack("album", `Your server refused an album heart ("${res.status}").`);
      return { error: /** @type {string} */ (fell.album), status: 409 };
    }
    a.favorite = on;
    pending.set(/** @type {string} */ (a.albumId), on);
    tally.albumSet++;
    return { ok: true, favorite: on };
  }

  /**
   * Hearts the album's tracks picked (their positions in the album view's list).
   * @param {string} title @param {string} artist @param {string[]} titles  the album view's tracks, in order
   * @param {number[]} picks @param {boolean} on @returns {Promise<Done | Refused>}
   */
  async function setTracks(title, artist, titles, picks, on) {
    if (notOn()) return { error: /** @type {string} */ (notOn()), status: 409 };
    const s = session();
    if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
    if (s.g.uncertain()) return { error: "The connection to your server is being checked; try again in a moment.", status: 503 };
    if (fell.track) return { error: fell.track, status: 409 };
    const a = find(title, artist);
    if ("error" in a) return a;
    const wanted = [...new Set(picks)].filter((i) => Number.isInteger(i) && i >= 0 && i < titles.length);
    if (!wanted.length) return { error: "No tracks were picked.", status: 400 };
    for (const i of wanted) {
      if (titles.filter((t) => t === titles[i]).length > 1) return { error: `Two tracks on this album are called "${titles[i]}"; Rouen can't tell which is which on your server.`, status: 409 };
    }
    const { g, graph, root } = s;
    const pid = profileOf(s);
    const qid = await openAlbumTrackQuery(g, root.library.oid, pid, a.title, a.artist, MAX_TRACKS);
    let held = false;
    try {
      const c = await readCount(graph, qid, timeoutMs);
      if ("error" in c) return { error: "Your server's track query " + c.error + ".", status: 502 };
      if (c.count > MAX_TRACKS) return { error: `Your server matched ${c.count} tracks for this album's name; too many to look through.`, status: 409 };
      /** The query's tracks, in the order they came. @type {string[]} */
      const order = [];
      const seen = new Set();
      /** How often each was pushed: an update after a heart is the Core saying something of it. @type {Map<string, number>} */
      const pushes = new Map();
      const before = graph.onObject;
      graph.onObject = (/** @type {any} */ o) => {
        const id = o.oid.toString();
        if (TRACK.test(o.typeName)) {
          pushes.set(id, (pushes.get(id) || 0) + 1);
          if (!seen.has(id)) { seen.add(id); order.push(id); }
        }
        before(o);
      };
      try {
        if (c.count) {
          const r = await g.call(qid, SIG.retainPage, pageArg(0));
          if (!r.success) return { error: `Your server refused the album's tracks ("${r.status}").`, status: 502 };
          held = true;
          const albumOf = (/** @type {string} */ id) => {
            const ref = field(graph.get(BigInt(id)), "Album");
            return isRef(ref) ? graph.get(ref.$ref) : undefined;
          };
          // A track has arrived with its Title and an Album whose AlbumId has come too (a stub is not enough).
          const arrived = (/** @type {string} */ id) => field(graph.get(BigInt(id)), "Title") !== undefined && field(albumOf(id), "AlbumId") !== undefined;
          const whole = await waitFor(timeoutMs, () => (order.length >= c.count && order.every(arrived) ? true : undefined));
          if (!whole) return { error: `Your server sent ${order.filter(arrived).length} of the ${c.count} tracks it matched, with their albums, in time; no track heart was sent.`, status: 504 };
        }
        // The album's own: a text filter also matches an album whose name holds this one's.
        const mine = order.filter((id) => {
          const al = graph.get(BigInt(id)) && field(graph.get(BigInt(id)), "Album");
          const album = isRef(al) ? graph.get(al.$ref) : undefined;
          const aid = album ? field(album, "AlbumId") : undefined;
          return aid !== undefined && String(aid) === a.albumId;
        });
        const titleOf = (/** @type {string} */ id) => String(field(graph.get(BigInt(id)), "Title") || "");
        const theirs = mine.map(titleOf).sort(), ours = titles.slice().sort();
        // Not the album view's tracks: this album's hearts are refused, not every album's.
        if (theirs.length !== ours.length || theirs.some((t, i) => t !== ours[i])) {
          return { error: `Your server lists ${theirs.length} track(s) for this album, not the ${ours.length} shown here, so no track heart was sent.`, status: 409 };
        }
        let done = 0;
        for (const i of wanted) {
          const id = /** @type {string} */ (mine.find((m) => titleOf(m) === titles[i]));
          const oid = BigInt(id);
          const pushedBefore = pushes.get(id) || 0;
          // The graph merges an update into what it holds, so an IsFavorite the update leaves out
          // (a sparse struct leaves its default out) would keep the old value: it is cleared first,
          // and the update the Core pushes decides it — left out, not a favourite (the review).
          const held_ = graph.get(oid);
          if (held_) for (const k of Object.keys(held_.fields)) if (k.endsWith("::IsFavorite")) delete held_.fields[k];
          const res = await g.call(root.library.oid, SIG.favoriteTrack, favoriteTrackArgs(pid, oid, on));
          if (!res.success) { fallBack("track", `Your server refused a track heart ("${res.status}").`); break; }
          const seenNow = await waitFor(confirmMs, () => {
            if ((pushes.get(id) || 0) <= pushedBefore) return undefined;   // nothing said of it yet
            const raw = field(graph.get(oid), "IsFavorite");
            const v = raw === undefined ? false : profileBool(raw, pid);
            return v === on ? true : undefined;
          });
          if (!seenNow) { fallBack("track", "Your server said yes to a track heart, but its track never showed it."); break; }
          done++;
        }
        tally.trackSet += done;
        if (done < wanted.length) return { error: `${fell.track} ${done} of ${wanted.length} were set.`, status: 409 };
        return { ok: true, count: done, favorite: on };
      } finally {
        graph.onObject = before;
        // What this query brought is let go from the long-lived graph (it is capped): the tracks and their albums.
        for (const id of order) {
          const al = field(graph.get(BigInt(id)), "Album");
          graph.forget(BigInt(id));
          if (isRef(al)) graph.forget(al.$ref);
        }
      }
    } finally {
      // Released once and disposed once, whatever happened above.
      if (held) g.callNoReply(qid, SIG.releasePage, pageArg(0));
      g.callNoReply(qid, SIG.dispose, Buffer.alloc(0));
    }
  }

  return {
    albumState,
    /** @param {string} title @param {string} artist @param {boolean} on */
    setAlbum: (title, artist, on) => inTurn(() => setAlbum(title, artist, on)),
    /** @param {string} title @param {string} artist @param {string[]} titles @param {number[]} picks @param {boolean} on */
    setTracks: (title, artist, titles, picks, on) => inTurn(() => setTracks(title, artist, titles, picks, on)),
    /**
     * A new read of the library: each album heart set since must show in it.
     * @param {RoonAlbum[]} list
     */
    afterRead(list) {
      for (const [id, want] of pending) {
        const a = list.find((x) => x.albumId === id);
        if (!a || a.favorite === null) continue;      // not in this read, or it said nothing: asked again next read
        pending.delete(id);
        if (a.favorite === want) tally.albumConfirmed++;
        else fallBack("album", "Your server said yes to an album heart, but its next read of the library didn't show it.");
      }
    },
    /** Native mode off, or another server paired: nothing set before is checked against what comes next. */
    reset() { pending.clear(); fell.album = fell.track = null; fellOn = null; },
    /** For Settings → Native mode. */
    status() {
      session();   // a fallback from an earlier connection is not shown as this one's
      return { album: fell.album ? { on: false, why: fell.album } : { on: true },
        track: fell.track ? { on: false, why: fell.track } : { on: true },
        albumSet: tally.albumSet, albumConfirmed: tally.albumConfirmed, awaiting: pending.size, trackSet: tally.trackSet };
    },
  };
}

module.exports = { createMarks };
