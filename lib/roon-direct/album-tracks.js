// @ts-check
"use strict";
/*
 * album-tracks.js — an album's tracks on your server's connection, while they can be named: moved out
 * of marks.js unchanged in v1.9.42, to be shared by track hearts and playlists
 * (dev/design/native-remote.md §8.3, §11.2).
 *
 *   Library::VirtualTrackQuery with the album's title and artist as text filters → its Count → one
 *   page retained → each track pushed, or named by a row (sent before on this connection, and not sent
 *   again, v1.9.28) → the album's own, by their Album's object id on this session (a text filter also
 *   matches an album whose name holds this one's) → `use` runs while the page is held → the page
 *   released and the query disposed, once each, whatever happens.
 *
 * What the query brought stays in the graph: the server sends each track once a connection, so a
 * track let go could never be read again on it (v1.9.28). An album's tracks are few; the graph is capped.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, pageArg, openAlbumTrackQuery } = require("./methods");
const { readCount } = require("./locations");

const MAX_TRACKS = 500;
const TRACK = /\.TrackLite$/;
// A page's rows, when the server names a track it sent this connection already (it sends each once).
const TRACK_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?TrackLite>$/;

/**
 * @template T
 * @param {any} s  the session
 * @param {Buffer} pid  the profile's id
 * @param {{ title: string, artist: string, oid: string }} album  oid: the album's object on this session (the library read's)
 * @param {{ timeoutMs: number, what: string, watch?: (o: any) => void }} o
 *   what: what was not done, said when the tracks did not all arrive ("no track heart was sent");
 *   watch: told of every object pushed while the page is held
 * @param {(mine: string[], titleOf: (id: string) => string) => Promise<T>} use  the album's own tracks, by object id, in the query's order
 * @returns {Promise<T | { error: string, status: number }>}
 */
async function withAlbumTracks(s, pid, album, o, use) {
  const { g, graph, root } = s;
  const qid = await openAlbumTrackQuery(g, root.library.oid, pid, album.title, album.artist, MAX_TRACKS);
  let held = false;
  try {
    const c = await readCount(graph, qid, o.timeoutMs);
    if ("error" in c) return { error: "Your server's track query " + c.error + ".", status: 502 };
    if (c.count > MAX_TRACKS) return { error: `Your server matched ${c.count} tracks for this album's name; too many to look through.`, status: 409 };
    /** The query's tracks, in the order they came. @type {string[]} */
    const order = [];
    const seen = new Set();
    const before = graph.onObject;
    graph.onObject = (/** @type {any} */ x) => {
      const id = x.oid.toString();
      if (TRACK.test(x.typeName)) {
        if (!seen.has(id)) { seen.add(id); order.push(id); }
      } else if (TRACK_ROW.test(x.typeName)) {
        // A track named by a row: sent before on this connection, and not sent again (v1.9.28).
        const d = field(x, "Data");
        if (isRef(d) && !seen.has(d.$ref.toString())) { seen.add(d.$ref.toString()); order.push(d.$ref.toString()); }
      }
      if (o.watch) o.watch(x);
      before(x);
    };
    try {
      if (c.count) {
        const r = await g.call(qid, SIG.retainPage, pageArg(0));
        if (!r.success) return { error: `Your server refused the album's tracks ("${r.status}").`, status: 502 };
        held = true;
        // A track has arrived with its Title and its Album (a reference: the album itself was sent, and
        // let go, by the library read — the server does not send it again on this connection).
        const arrived = (/** @type {string} */ id) => field(graph.get(BigInt(id)), "Title") !== undefined && isRef(field(graph.get(BigInt(id)), "Album"));
        const whole = await waitFor(o.timeoutMs, () => (order.length >= c.count && order.every(arrived) ? true : undefined));
        if (!whole) return { error: `Your server sent ${order.filter(arrived).length} of the ${c.count} tracks it matched, with their albums, in time; ${o.what}.`, status: 504 };
      }
      // The album's own: a text filter also matches an album whose name holds this one's.
      const mine = order.filter((id) => {
        const al = field(graph.get(BigInt(id)), "Album");
        return isRef(al) && al.$ref.toString() === album.oid;
      });
      const titleOf = (/** @type {string} */ id) => String(field(graph.get(BigInt(id)), "Title") || "");
      return await use(mine, titleOf);
    } finally {
      graph.onObject = before;
    }
  } finally {
    // Released once and disposed once, whatever happened above.
    if (held) g.callNoReply(qid, SIG.releasePage, pageArg(0));
    g.callNoReply(qid, SIG.dispose, Buffer.alloc(0));
  }
}

module.exports = { withAlbumTracks, MAX_TRACKS, TRACK };
