// @ts-check
/*
 * track-times.js — each track's length, for both album views: the remote's (album-view.js) and the Shelf's
 * (shelf-back.js). v1.9.71-t1, dev/design/native-remote.md §16.6 and §17.7.
 *
 * The lengths are your server's own, read through native mode (/api/album/track-times); the rows they go beside are
 * the official API's (Roon's public extension API gives no length). The two are joined here, the same way for both
 * views:
 *   1. by title, in order: a repeated title takes its lengths in turn;
 *   2. a row still without one, when the official list and the server's have as many tracks, takes the length at its
 *      own place in the album (both lists are the album in its order) — unless another row took that one by title.
 * So a title written differently in the two lists (a remaster note, a typographic quote the folding misses) still
 * gets its length, and a list that doesn't agree on the count never borrows another track's.
 *
 * An album's lengths are asked once and kept; "pending" (native mode connecting, the library being read) is asked
 * again a few seconds later, three times at most, while a view still shows the album; "none" (native mode off, the album
 * not on your server) is not asked again for two minutes.
 */
(function trackTimes() {
  "use strict";
  const W = /** @type {any} */ (window);
  const KEEP = 200, NONE_MS = 2 * 60 * 1000, TRIES = 3, AGAIN_MS = 4000;

  /** A title as both lists give it: case, spacing, accents however encoded, curly quotes and dashes aside. @param {string} s */
  const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"').replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
  /** @param {number} s */
  const clock = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  /** @param {string} title @param {string} artist */
  const keyOf = (title, artist) => (title ? JSON.stringify([title, artist || ""]) : "");

  /** An album's lengths, once given. @type {Map<string, Array<{ title: string, seconds: number }>>} */
  const known = new Map();
  /** An album with none to give: not asked again until then. @type {Map<string, number>} */
  const none = new Map();
  /** How often an album was asked while "pending". @type {Map<string, number>} */
  const tries = new Map();
  /** Who waits for an album being asked, and whether each still wants it. @type {Map<string, Array<{ done: (tracks: any[]) => void, still: () => boolean }>>} */
  const waiting = new Map();

  /** @param {string} key @param {string} title @param {string} artist */
  async function ask(key, title, artist) {
    /** @type {any} */
    let j = null;
    try {
      const r = await fetch("/api/album/track-times?" + new URLSearchParams({ title, artist }));
      j = r.ok ? await r.json() : null;
    } catch (e) {
      /* the lengths are an extra: a failed ask leaves the rows as they were, and the next opening asks again */
    }
    if (j && j.status === "ok") {
      const tracks = Array.isArray(j.tracks) ? j.tracks : [];
      known.set(key, tracks);
      while (known.size > KEEP) known.delete(/** @type {string} */ (known.keys().next().value));
      tries.delete(key);
      const done = waiting.get(key) || [];
      waiting.delete(key);
      for (const w of done) w.done(tracks);
      return;
    }
    if (j && j.status === "pending") {
      const n = (tries.get(key) || 0) + 1;
      tries.set(key, n);
      if (n < TRIES) { setTimeout(() => { again(key, title, artist); }, AGAIN_MS); return; }
      tries.delete(key);
    }
    if (j) none.set(key, Date.now() + NONE_MS);
    waiting.delete(key);
  }

  /**
   * Asked again only while a view still shows the album: one that has moved on asks afresh when it comes back.
   * @param {string} key @param {string} title @param {string} artist
   */
  function again(key, title, artist) {
    const still = (waiting.get(key) || []).filter((w) => w.still());
    if (still.length) { waiting.set(key, still); ask(key, title, artist); return; }
    waiting.delete(key);
    tries.delete(key);
  }

  /**
   * An album's lengths, given to `done` once known (at once when kept; never, when there are none). The caller checks
   * the album is still the one on screen; `still` says so, for asking again while the server is getting ready.
   * @param {string} title @param {string} artist @param {(tracks: Array<{ title: string, seconds: number }>) => void} done
   * @param {() => boolean} still
   */
  function want(title, artist, done, still) {
    const key = keyOf(title, artist);
    if (!key) return;
    const had = known.get(key);
    if (had) { done(had); return; }
    if ((none.get(key) || 0) > Date.now()) return;
    const w = waiting.get(key), one = { done, still };
    if (w) { w.push(one); return; }
    waiting.set(key, [one]);
    ask(key, title, artist);
  }

  /**
   * Each row's length in seconds (0: none), the rows in the album's order.
   * @param {string[]} rows  the rows' titles @param {Array<{ title: string, seconds: number }>} tracks  the server's, in its order
   * @returns {number[]}
   */
  function match(rows, tracks) {
    const out = rows.map(() => 0);
    /** Rows given a track by title (whatever its length), and the tracks so given. */
    const matched = new Set(), taken = new Set();
    /** @type {Map<string, number[]>} */
    const by = new Map();
    tracks.forEach((t, j) => {
      const k = norm(t.title), q = by.get(k);
      if (q) q.push(j); else by.set(k, [j]);
    });
    rows.forEach((title, i) => {
      const q = by.get(norm(title));
      const j = q && q.length ? /** @type {number} */ (q.shift()) : -1;
      if (j >= 0) { out[i] = tracks[j].seconds || 0; matched.add(i); taken.add(j); }
    });
    if (rows.length === tracks.length) {
      rows.forEach((_, i) => { if (!matched.has(i) && !taken.has(i)) out[i] = tracks[i].seconds || 0; });
    }
    return out;
  }

  W.RouenTrackTimes = { want, match, clock, norm };
})();
