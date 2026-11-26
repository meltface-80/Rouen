// @ts-check
"use strict";
/*
 * listening.js — what counts as a play, put together for index.js (dev/design/listening.md, 2.0.6-t20): the store and
 * its readers (store.js), the album a play belongs to (album-match.js), album runs (runs.js) and the zone pushes
 * recorded as plays (scrobble.js). index.js hands in what it owns (the library, its keys, the album opener, the zone
 * maps) and calls `update` on every zone push and `libraryChanged` whenever the library is published.
 *
 * Two reads of Roon happen here, both through the album view's own opener (the public browse API):
 *   - a run's album whose track list Rouen has not kept, once, when a track of it is first played in a run (runs.js);
 *   - once after the upgrade (the owner, 2026-11-26: "Read lists in background"): every album the history holds a run
 *     of two played tracks or more of, one album every `pauseMs`, most recent first, so the plays from before can be
 *     read for whole albums (§6). Three reads failing in a row (the Core gone) stop it until the library is next
 *     published; the history is read for album plays once the lists are there, and never again.
 */

const { createListeningStore } = require("./store");
const { createAlbumMatcher } = require("./album-match");
const { createRuns } = require("./runs");
const { createScrobbler } = require("./scrobble");

/** Between two reads of the background history pass: one album every few seconds, light on the Core. */
const PAUSE_MS = 4000;

/**
 * @typedef {{ title?: string, subtitle?: string, offset?: number, image_key?: string | null }} Album
 */

/**
 * @param {{
 *   db: () => any,
 *   albums: () => Album[], version: () => number,
 *   albumKey: (title: string, credit: string) => string | null,
 *   canonText: (s: string) => string, canonArtist: (s: string) => string, splitCredit: (s: string) => string[],
 *   plainCredit: (s: string) => string, trackKeys: (title: string) => string[],
 *   openAlbum: (al: Album) => Promise<{ tracks: Array<{ title: string }>, partial?: boolean }>,
 *   state: Map<string, any>, history: Map<string, any>,
 *   historyEntry: (prev: any, now: number) => any, pushHistory: (list: any, entry: any) => any,
 *   zoneName: (zid: string) => string,
 *   changed: () => void, albumPlayed: (title: string) => void,
 *   whose?: (zid: string) => string, playing?: (zid: string) => void,
 *   log: (msg: string) => void, debug: (msg: string) => void,
 *   pauseMs?: number, sleep?: (ms: number) => Promise<void>,
 * }} deps
 *   albumKey: index.js's, of a title and a credit; plainCredit: lib/roon-direct/find.js's (a catalogue credit's
 *   links read as names); openAlbum: the album view's opener; changed: the plays changed (index.js playsVersion);
 *   albumPlayed: an album was played (Listen later's "played through"); whose, playing: lib/profiles/attribution.js
 *   (profiles.md §4), whose listening a play on the zone is ('' no one), and the zone reported playing.
 */
function createListening(deps) {
  const store = createListeningStore({ db: deps.db });
  const pauseMs = deps.pauseMs === undefined ? PAUSE_MS : deps.pauseMs;
  const sleep = deps.sleep || ((/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); }));

  /**
   * An album's identity for its plays: index.js's albumKey of its title and credit; "raw|…" for a title albumKey
   * cannot key (punctuation only), so it still counts as itself alone. @param {Album} al
   */
  function listenKey(al) {
    const title = (al && al.title) || "", credit = (al && al.subtitle) || "";
    return deps.albumKey(title, credit) || (title ? "raw|" + title.trim().toLowerCase() + "|" + credit.trim().toLowerCase() : null);
  }

  const matcher = createAlbumMatcher({ albums: deps.albums, version: deps.version, keyOf: listenKey,
    canonText: deps.canonText, canonArtist: deps.canonArtist, splitCredit: deps.splitCredit });

  /** An album's track list read from Roon and kept under `key`. Throws when it can't be, for the caller to say. @param {Album} al @param {string} key */
  async function readTracks(al, key) {
    const r = await deps.openAlbum(al);
    if (!r || r.partial || !r.tracks || !r.tracks.length) throw new Error("Roon gave only part of the album");
    store.keepTrackList(key, r.tracks.map((t) => t.title || ""));
  }

  const runs = createRuns({
    tracksOf: (key) => store.trackList(key),
    trackKeys: deps.trackKeys,
    readTracks: (al, key) => readTracks(al, key).catch((e) => {
      deps.debug("[plays] could not read the tracks of " + JSON.stringify(al.title || "") + ": " + e.message);
      throw e;
    }),
    onAlbumPlay: (p) => {
      try {
        store.addAlbumPlay({ ts: p.ts, zone: deps.zoneName(p.zone), key: p.key, title: p.al.title || "",
          image_key: p.al.image_key || null, tracks: p.tracks, profile: deps.whose ? deps.whose(p.zone) : null });
      } catch (e) {
        deps.log("[plays] could not record an album played: " + /** @type {Error} */ (e).message);
      }
      deps.changed();
      deps.albumPlayed(p.al.title || "");
    },
    log: (m) => deps.log("[plays] " + m),
  });

  const scrobbler = createScrobbler({
    state: deps.state, history: deps.history, historyEntry: deps.historyEntry, pushHistory: deps.pushHistory,
    store: () => (deps.db() ? store : null),
    match: (play) => matcher.match(play),
    libraryReady: () => deps.albums().length > 0,
    runs, changed: deps.changed, log: deps.debug, whose: deps.whose, playing: deps.playing,
  });

  /**
   * An album's track list as the album view read it (index.js rememberAlbumTracks): kept by position too. Never throws:
   * the album view's open must not fail for it, and a list not kept is read again when a run needs it.
   * @param {string} title @param {string} credit @param {string[]} titles
   */
  function keepTrackList(title, credit, titles) {
    try {
      const key = listenKey({ title, subtitle: deps.plainCredit(credit || "") });
      if (key && deps.db()) store.keepTrackList(key, titles);
    } catch (e) {
      deps.debug("[plays] could not keep the track list of " + JSON.stringify(title) + ": " + /** @type {Error} */ (e).message);
    }
  }

  let historyRunning = false;
  /** The background pass of the history (above): the lists it needs, then the history read once. */
  async function readHistory() {
    if (historyRunning || store.historyRead()) return;
    historyRunning = true;
    try {
      /** @type {Map<string, Album>} */
      const byKey = new Map();
      for (const a of deps.albums()) { const k = listenKey(a); if (k && !byKey.has(k)) byKey.set(k, a); }
      const wanting = store.historyWanting().filter((k) => byKey.has(k));
      if (wanting.length) deps.log("[plays] reading the track lists of " + wanting.length + " albums in your history, one every " + Math.round(pauseMs / 1000) + " s");
      let failed = 0;
      for (const key of wanting) {
        try { await readTracks(/** @type {Album} */ (byKey.get(key)), key); failed = 0; }
        catch (e) {
          deps.debug("[plays] history: no track list for " + key + ": " + /** @type {Error} */ (e).message);
          if (++failed >= 3) {
            deps.log("[plays] three albums in a row could not be read; the history waits for the library's next change");
            return;
          }
        }
        await sleep(pauseMs);
      }
      const found = store.readHistoryOnce({ tracksOf: (k) => store.trackList(k), trackKeys: deps.trackKeys,
        titleOf: (k) => { const al = byKey.get(k); return al ? { title: al.title || "", image_key: al.image_key || null } : null; } });
      if (found !== null) {
        deps.log("[plays] the plays from before 2.0.6-t20 read: " + found + " albums played");
        if (found) deps.changed();
      }
    } finally {
      historyRunning = false;
    }
  }

  /** The library was published: plays recorded before it could name their album are named, and the history read. */
  function libraryChanged() {
    if (!deps.db() || !deps.albums().length) return;
    setImmediate(() => {
      try {
        if (store.fillKeys((play) => matcher.match(play))) deps.changed();
      } catch (e) {
        deps.log("[plays] could not name the plays' albums: " + /** @type {Error} */ (e).message);
        return;
      }
      readHistory().catch((e) => deps.log("[plays] could not read the history: " + e.message));
    });
  }

  return Object.assign({}, store, {
    listenKey, keepTrackList, libraryChanged,
    update: scrobbler.update, zoneGone: scrobbler.zoneGone, reset: scrobbler.reset,
    _readHistory: readHistory,
  });
}

module.exports = { createListening, PAUSE_MS };
