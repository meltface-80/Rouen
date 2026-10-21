// @ts-check
"use strict";
/*
 * adder.js — N2b-2 (dev/design/native-remote.md §9.2, v1.9.41): a TIDAL or Qobuz album added to your
 * library by your server itself, as Roon's own apps add one, for the profile chosen in Settings →
 * Native mode.
 *
 *   Roon's own search (find.js) for "title artist" → of its albums with that title and artist, one
 *   in the library means there is nothing to add; else the first on the service asked with an
 *   AlbumId, or — no copy on that service at all — the other service's (find.js pickCopy, the owner,
 *   2026-10-21) → Library::AddToLibrary(Profile, [AlbumLink]) → nothing comes back (the call has no
 *   callback).
 *
 * Tried, not trusted (§3.3): the add is believed only once the album is in the library Rouen plays
 * from (`inLibrary`, the official API's, which the library watch follows). Not there after
 * `confirmMs`: "not taken", said and logged, and nothing more is done — a service favourite after a
 * call that may yet take would add the album twice over. What native mode cannot send comes back as
 * `notSent`, with why, for the caller to add it today's way (§9's answer 2).
 */
const { SIG, addToLibraryArgs } = require("./methods");
const { profileObjectFor, profilesOf } = require("./session");
const { SOURCE_CODE, sourceName } = require("./find");

const CONFIRM_MS = 3 * 60 * 1000;

/** @typedef {{ title: string, artist: string, service: "tidal" | "qobuz" }} Wanted */
/**
 * @typedef {{ state: "in-library" } | { state: "waiting", via: "roon", from: "tidal" | "qobuz" } | { notSent: string } | { off: true }} Added
 *   from: the service whose copy was added — the one asked for, else the other (the owner, 2026-10-21)
 * @typedef {{ state: "in-library", offset: number } | { state: "waiting", since: number, from: string } | { state: "not-taken" } | { state: "none" }} State
 */

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           finder: ReturnType<typeof import("./find").createFinder>,
 *           keyOf: (title: string, artist: string) => string | null, profile: () => string | null,
 *           inLibrary: (title: string, artist: string) => number | null,
 *           log?: (line: string) => void, now?: () => number, confirmMs?: number }} deps
 *   on: native mode switched on (whatever its state: checking after an update, not yet read — said as why);
 *   inLibrary: the album's place in the library Rouen plays from, or null while it is not there
 */
function createAdder(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const confirmMs = deps.confirmMs || CONFIRM_MS;
  /** Adds sent, by the album's key: when, the AlbumId named, whose copy, and what became of it. @type {Map<string, { at: number, albumId: string, from: string, settled: boolean }>} */
  const sent = new Map();
  /** @param {string} title @param {string} artist */
  const keyFor = (title, artist) => deps.keyOf(title, artist) || `${title}\u0000${artist}`;

  /**
   * Why nothing could be added, naming where the search did find the album (v1.9.44: the owner's report
   * said only "not on TIDAL", which couldn't tell a Qobuz copy from one whose source wasn't given).
   * @param {import("./find").Hit[]} same  the search's albums of this title and artist, none in the library
   * @param {"tidal" | "qobuz"} service
   */
  function whyNot(same, service) {
    if (!same.length) return "Your server's search didn't find this album on TIDAL or Qobuz.";
    const asked = sourceName(SOURCE_CODE[service]);
    if (same.some((h) => h.contentSource === SOURCE_CODE[service])) return `Your server's search found this album on ${asked}, without the id an add names it by.`;
    const streaming = same.filter((h) => h.contentSource === SOURCE_CODE.tidal || h.contentSource === SOURCE_CODE.qobuz);
    if (streaming.length) return `Your server's search found this album on ${sourceName(streaming[0].contentSource)}, without the id an add names it by.`;
    // Each source as the server gave it: a source it didn't name said so, not as a place.
    const where = [...new Set(same.map((h) => (h.contentSource === null ? "a source your server didn't name" : sourceName(h.contentSource))))];
    return `Your server's search found this album only from ${where.join(" and ")}, not on TIDAL or Qobuz.`;
  }

  return {
    /**
     * Searched for, then added, in its turn with reads, hearts and searches.
     * @param {Wanted} w @returns {Promise<Added>}
     */
    async add(w) {
      // Off: today's way, with nothing to explain (the owner, 2026-10-21).
      if (!deps.on()) return { off: true };
      /** @type {{ sentId?: string, from?: "tidal" | "qobuz", state?: "in-library", notSent?: string }} */
      const out = await deps.inTurn(async () => {
        const s = deps.link ? deps.link.session() : null;
        if (!s) return { notSent: "Native mode isn't connected to your server right now." };
        if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
        // A write, for one profile: with several, the one chosen in Settings, as hearts wait for one (§8.4).
        const profiles = profilesOf(s.root);
        if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return { notSent: "Choose your profile in Settings → Native mode first." };
        /** @type {Awaited<ReturnType<typeof deps.finder.searchIn>>} */
        let r;
        // Unanswered, or the connection gone: not sent, and why (find.js's check says the same of its searches).
        try { r = await deps.finder.searchIn(s, w); }
        catch (e) { return { notSent: "Your server's search didn't answer: " + (e && /** @type {any} */ (e).message) }; }
        if ("error" in r) return { notSent: r.error };
        if (r.finding.verdict === "in-library") return { state: /** @type {const} */ ("in-library") };
        if (r.finding.verdict === "incomplete" || r.finding.verdict === "error") return { notSent: r.finding.why || "Your server's search didn't answer." };
        // The copy to add: the service asked for, else the other's when it has none (find.js pickCopy, one rule with the check).
        if (!r.pick) return { notSent: whyNot(r.same, w.service) };
        const { hit, from } = r.pick;
        const broker = s.graph.ofType("Broker")[0];
        if (!broker) return { notSent: "Your server's graph came without its Broker, which an add names." };
        const profile = profileObjectFor(s.root, deps.profile());
        if (!profile) return { notSent: "Your server sent no profile with an id." };
        // false: the connection had closed, and nothing left Rouen.
        if (s.g.callNoReply(s.root.library.oid, SIG.addToLibrary, addToLibraryArgs(s.g, profile.oid, broker.oid, [BigInt(/** @type {string} */ (hit.albumId))])) === false) {
          return { notSent: "The connection to your server closed before the add could be sent." };
        }
        return { sentId: /** @type {string} */ (hit.albumId), from };
      });
      if (out.state === "in-library") return { state: "in-library" };
      if (out.sentId) {
        const from = out.from || w.service;
        sent.set(keyFor(w.title, w.artist), { at: now(), albumId: out.sentId, from, settled: false });
        log(`added "${w.title}" (${from}${from !== w.service ? `, asked from ${w.service}` : ""}, album ${out.sentId}); waiting for it in the library`);
        return { state: "waiting", via: "roon", from };
      }
      const why = out.notSent || "Native mode couldn't add it.";
      log(`not added "${w.title}" (${w.service}): ${why}`);
      return { notSent: why };
    },

    /**
     * Where an album stands: in the library (and where), waiting for an add sent, not taken, or none sent.
     * @param {string} title @param {string} artist @returns {State}
     */
    state(title, artist) {
      const offset = deps.inLibrary(title, artist);
      const was = sent.get(keyFor(title, artist));
      if (offset !== null && offset !== undefined) {
        if (was && !was.settled) { was.settled = true; log(`"${title}" is in the library: the add took`); }
        return { state: "in-library", offset };
      }
      if (!was) return { state: "none" };
      if (now() - was.at < confirmMs) return { state: "waiting", since: was.at, from: was.from };
      if (!was.settled) { was.settled = true; log(`"${title}" not in the library ${Math.round(confirmMs / 1000)} s after its add (album ${was.albumId})`); }
      return { state: "not-taken" };
    },

    /**
     * An add of this album no longer followed: it was made another way since (a service favourite, library-add.js),
     * and an old "not taken" must not be said over it (the review). @param {string} title @param {string} artist
     */
    forget(title, artist) { sent.delete(keyFor(title, artist)); },
  };
}

module.exports = { createAdder, CONFIRM_MS };
