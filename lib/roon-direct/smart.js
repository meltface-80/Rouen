// @ts-check
"use strict";
/*
 * smart.js — N2e-1 (dev/design/native-remote.md §12.3, v1.9.51): Roon's smart playlists in Rouen, with native
 * mode on, for the profile chosen in Settings → Native mode — listed, a page of their items read, and played.
 *
 *   The list: the playlists playlists.js reads (its wait, and its minute without one after a server didn't send them)
 *   that are smart (§12.1: Type 15, or carrying a Focus) and the chosen profile's, when one names its Profile.
 *   A page: Playlist::VirtualItemsQuery (playlist-items.js, proven on the owner's server, §12.2); at most five
 *   pages a playlist, and none once fewer than 50,000 objects of room are left — twice the reserve the rest of
 *   native mode keeps (find.js noRoom), so a page, which brings thousands, never takes the room they need.
 *   The play: Transport::PlayPlaylist on the native Zone that is Rouen's chosen zone (by its ZoneId as hex, else
 *   its Name, else its outputs' endpoints), believed once the official API's zone shows it playing what it
 *   wasn't just before the call (§12.3). The play proven on the owner's server, Play and Shuffle (§12.4); which of
 *   the zone matches found the zone there not yet recorded, so none is dropped.
 */
const { field, isRef } = require("./objects");
const { SIG, playPlaylistArgs } = require("./methods");
const { profileFor, profileObjectFor, profilesOf } = require("./session");
const { isSmart } = require("./playlists");
const { readItemsPage, PAGE } = require("./playlist-items");

const MAX_PAGES = 5;
const PAGE_ROOM = 50000;
const CONFIRM_MS = 10000;
const POLL_MS = 500;
/** A Sooid as hex, or null. @param {any} v */
const hex = (v) => (Buffer.isBuffer(v) ? v.toString("hex") : null);

/**
 * @typedef {{ zone_id: string, display_name?: string, state?: string, outputs?: Array<{ display_name?: string }>,
 *             queue_items_remaining?: number, now_playing?: { one_line?: { line1?: string } } | null }} OfficialZone
 *   as the official API gives a zone
 * @typedef {{ id: string, name: string, tracks: number | null }} Smart
 */

/**
 * The native Zone that is the official API's zone (§12.3): by its ZoneId as hex; else by its Name; else the one the
 * zone's outputs' endpoints all name. One, or why none.
 * @param {any} graph @param {OfficialZone} z
 * @returns {{ zone: any, by: string } | { notSent: string }}
 */
function zoneFor(graph, z) {
  const zones = graph.ofType("Zone").filter((/** @type {any} */ x) => x.loaded);
  const one = (/** @type {any[]} */ xs, /** @type {string} */ by) => (xs.length === 1 ? { zone: xs[0], by } : null);
  const byId = one(zones.filter((/** @type {any} */ x) => hex(field(x, "ZoneId")) === String(z.zone_id).toLowerCase()), "id");
  if (byId) return byId;
  const name = z.display_name || "";
  const byName = name ? one(zones.filter((/** @type {any} */ x) => field(x, "Name") === name), "name") : null;
  if (byName) return byName;
  const outputs = (z.outputs || []).map((o) => o.display_name).filter(Boolean);
  if (outputs.length) {
    const named = graph.ofType("Endpoint").filter((/** @type {any} */ e) => e.loaded && outputs.includes(field(e, "Name")));
    const oids = [...new Set(named.map((/** @type {any} */ e) => { const r = field(e, "Zone"); return r && r.$ref !== undefined ? String(r.$ref) : null; }).filter(Boolean))];
    if (named.length >= outputs.length && oids.length === 1) {
      const zone = graph.get(BigInt(/** @type {string} */ (oids[0])));
      if (zone && zone.loaded) return { zone, by: "endpoints" };
    }
  }
  return { notSent: `Rouen couldn't tell which of your server's zones is "${name || z.zone_id}".` };
}

/**
 * What the zone shows, to tell a play by: its state, what it plays, and how many tracks are left in its queue.
 * @param {OfficialZone} z
 */
const shows = (z) => ({ state: z.state, line: z.now_playing && z.now_playing.one_line ? z.now_playing.one_line.line1 : null,
  left: typeof z.queue_items_remaining === "number" ? z.queue_items_remaining : null });
/**
 * Believed played (§12.3): playing, and it wasn't; or its queue grew; or another track, but not the queue moving on
 * by one by itself (one track fewer left), which a track ending does whatever was sent.
 * @param {ReturnType<typeof shows>} was @param {ReturnType<typeof shows>} is
 */
const played = (was, is) => is.state === "playing" && (was.state !== "playing"
  || (is.left !== null && was.left !== null && is.left > was.left)
  || (is.line !== was.line && !(is.left !== null && was.left !== null && is.left === was.left - 1)));

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           profile: () => string | null, known: (session: any) => Map<string, import("./albums").RoonAlbum> | null,
 *           playlists: { read(s: any): Promise<{ list: Array<{ oid: bigint, id: string, name: string, tracks: number | null }> } | { notSent: string }> },
 *           zone: (zoneId: string) => OfficialZone | null,
 *           log?: (line: string) => void, now?: () => number, confirmMs?: number, pollMs?: number }} deps
 *   known: the library's albums as sent on a session (null until it has been read there); playlists: playlists.js's
 *   own read; zone: the official API's zone now
 */
function createSmart(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const timeoutMs = 8000;
  const confirmMs = deps.confirmMs === undefined ? CONFIRM_MS : deps.confirmMs;
  const pollMs = deps.pollMs === undefined ? POLL_MS : deps.pollMs;

  /** The session to read on, or why not. @returns {{ s: any } | { notSent: string }} */
  function sessionNow() {
    if (!deps.on()) return { notSent: "" };
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { notSent: "Native mode isn't connected to your server right now." };
    if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
    return { s };
  }
  /**
   * The chosen profile's id and object; null when there are several and none is chosen.
   * @param {any} s @returns {{ pid: Buffer, obj: any } | null}
   */
  const profileNow = (s) => {
    const profiles = profilesOf(s.root);
    if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return null;
    const pid = profileFor(s.root, deps.profile());
    return Buffer.isBuffer(pid) ? { pid, obj: profileObjectFor(s.root, deps.profile()) } : null;
  };
  /**
   * The smart playlists now, the profile's (one naming another profile left out); or why not.
   * @param {any} s
   * @returns {Promise<{ list: Array<{ oid: bigint, id: string, name: string, tracks: number | null }>, profile: { pid: Buffer, obj: any } } | { notSent: string }>}
   */
  async function smartOn(s) {
    const profile = profileNow(s);
    if (!profile) return { notSent: "Choose your profile in Settings → Native mode first." };
    const r = await deps.playlists.read(s);
    if ("notSent" in r) return r;
    const mine = (/** @type {any} */ p) => { const o = field(p, "Profile"); return !isRef(o) || !profile.obj || o.$ref === profile.obj.oid; };
    return { profile, list: r.list.filter((x) => { const p = s.graph.get(x.oid); return p && isSmart(p) && mine(p); })
      .map(({ oid, id, name, tracks }) => ({ oid, id, name, tracks })) };
  }

  return {
    /** Roon's smart playlists, or why not (notSent "" when native mode is off). @returns {Promise<{ playlists: Smart[] } | { notSent: string }>} */
    async list() {
      if (!deps.on()) return { notSent: "" };
      return deps.inTurn(async () => {
        const at = sessionNow();
        if ("notSent" in at) return at;
        const r = await smartOn(at.s);
        if ("notSent" in r) return r;
        return { playlists: r.list.map((x) => ({ id: x.id, name: x.name, tracks: x.tracks })) };
      });
    },

    /**
     * A page of one smart playlist's items, in its order.
     * @param {string} id @param {number} page
     * @returns {Promise<{ name: string, count: number | null, page: number, pages: number, items: any[], complete: boolean } | { notSent: string }>}
     */
    async page(id, page) {
      if (!deps.on()) return { notSent: "" };
      if (!Number.isInteger(page) || page < 0 || page >= MAX_PAGES) return { notSent: `Rouen shows the first ${MAX_PAGES * PAGE} tracks of a smart playlist.` };
      return deps.inTurn(async () => {
        const at = sessionNow();
        if ("notSent" in at) return at;
        if (at.s.graph.maxObjects - at.s.graph.objects.size < PAGE_ROOM) {
          return { notSent: "Rouen has read as much of your server's smart playlists as it keeps room for on this connection; more after the next one (overnight, or when native mode is turned off and on)." };
        }
        const r = await smartOn(at.s);
        if ("notSent" in r) return r;
        const x = r.list.find((y) => y.id === id);
        if (!x) return { notSent: "Your server doesn't list that smart playlist any more." };
        const got = await readItemsPage(at.s, { pid: r.profile.pid, known: deps.known(at.s), timeoutMs, page, want: PAGE }, x.oid);
        if ("error" in got) return { notSent: got.error };
        const pages = got.count === null ? 1 : Math.min(MAX_PAGES, Math.ceil(got.count / PAGE));
        return { name: x.name, count: got.count, page, pages, items: got.items, complete: got.complete };
      });
    },

    /**
     * The whole smart playlist played on the official API's zone, believed once that zone plays a track it wasn't.
     * @param {string} id @param {string} zoneId @param {boolean} shuffle
     * @returns {Promise<{ ok: true, by: string } | { notSent: string } | { notShown: string }>}
     */
    async play(id, zoneId, shuffle) {
      if (!deps.on()) return { notSent: "" };
      if (!deps.zone(zoneId)) return { notSent: "Choose a zone to play on first." };
      /** What the zone showed just before the call (not before the turn: it may have moved on while it waited). */
      let was = shows(/** @type {OfficialZone} */ (deps.zone(zoneId)));
      /** @type {{ by: string } | { notSent: string } | { unsure: string }} */
      const sent = await deps.inTurn(async () => {
        const at = sessionNow();
        if ("notSent" in at) return at;
        const r = await smartOn(at.s);
        if ("notSent" in r) return r;
        const x = r.list.find((y) => y.id === id);
        if (!x) return { notSent: "Your server doesn't list that smart playlist any more." };
        const official = deps.zone(zoneId);
        if (!official) return { notSent: "Choose a zone to play on first." };
        const transport = at.s.graph.ofType("Transport")[0];
        if (!transport) return { notSent: "Your server's graph came without its Transport, which a play is sent to." };
        const z = zoneFor(at.s.graph, official);
        if ("notSent" in z) return z;
        log(`playing "${x.name}"${shuffle ? " shuffled" : ""} on "${official.display_name || zoneId}" (matched by ${z.by})`);
        was = shows(official);
        /** @type {{ success: boolean, status?: string }} */
        let res;
        try { res = await at.s.g.call(transport.oid, SIG.playPlaylist, playPlaylistArgs(at.s.g, z.zone.oid, r.profile.pid, shuffle, x.oid)); }
        catch (e) { return { unsure: "Your server didn't answer (" + (e && /** @type {any} */ (e).message) + ")." }; }
        if (!res.success) return { notSent: `Your server refused to play it ("${res.status}").` };
        return { by: z.by };
      });
      if ("notSent" in sent) return sent;
      if ("unsure" in sent) return { notShown: sent.unsure };
      // Believed once the zone shows it playing what it wasn't just before the call (§12.3).
      const until = now() + confirmMs;
      for (;;) {
        const z = deps.zone(zoneId);
        if (z && played(was, shows(z))) return { ok: true, by: sent.by };
        if (now() >= until) break;
        await new Promise((r) => { setTimeout(r, pollMs); });
      }
      log("the zone didn't start playing within " + confirmMs / 1000 + " s of the play");
      return { notShown: "Your server took it, but the zone didn't start playing." };
    },
  };
}

module.exports = { createSmart, zoneFor, played, MAX_PAGES };
