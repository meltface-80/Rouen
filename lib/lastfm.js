"use strict";
// ---------------------------------------------------------------------------
// Last.fm, read-only (v1.9.3): similar artists, and albums by them.
//
// Asked for in a forum thread as "recommended albums of the current playing
// artist, or opening the site from Rouen". This is that and nothing else: no
// scrobbling (Roon does it), no account sign-in, no writes. A personal API key
// is the whole credential (last.fm/api/account/create), and with none set the
// feature is simply absent.
//
// Last.fm has no "similar albums" call. artist.getSimilar is the one it is
// known for, so similar ALBUMS are built from it: each of the closest similar
// artists' most-played album, one per artist, so a single prolific act cannot
// fill the row. That costs a call per artist, which is why it is a second
// question the album view asks after the first, and why both are remembered.
//
// Their terms ask for no more than five requests a second per IP. Calls go out
// one at a time, spaced, through one queue — the album view of a cold cache
// asks for about ten — and every answer is kept for a week: a similar-artist
// graph moves on the scale of months.
//
// Pure apart from the `fetch` it is handed, so the suite drives it with a fake.
// ---------------------------------------------------------------------------

const API = "https://ws.audioscrobbler.com/2.0/";

// Last.fm stopped serving artist pictures in 2019; every artist image is now
// the same grey star, by this hash. A placeholder is worse than none — the
// page draws its own monogram for an artist without a picture.
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

// The largest picture an entry offers, or "" — never the placeholder.
function pickImage(images) {
  if (!Array.isArray(images)) return "";
  const order = ["mega", "extralarge", "large", "medium", "small", ""];
  let best = "", rank = Infinity;
  for (const im of images) {
    const url = im && typeof im["#text"] === "string" ? im["#text"].trim() : "";
    if (!url || url.indexOf(PLACEHOLDER) !== -1 || !/^https:\/\//i.test(url)) continue;
    const r = order.indexOf(String(im.size || ""));
    const k = r === -1 ? order.length : r;
    if (k < rank) { rank = k; best = url; }
  }
  return best;
}

// A Last.fm page link, or "" — only ever their own https site.
function siteUrl(u) {
  const s = String(u || "").trim();
  return /^https:\/\/(www\.)?last\.fm\//i.test(s) ? s : "";
}

// Last.fm answers a single result as an object rather than a one-element
// array; both mean the same list.
function asList(x) { return Array.isArray(x) ? x : (x && typeof x === "object" ? [x] : []); }

/**
 * @param {object} o
 * @param {Function} o.fetch       fetch(url, init) → Response-like
 * @param {Function} o.getKey      () → the API key, "" when none
 * @param {string}   [o.userAgent]
 * @param {Function} [o.now]       ms clock
 * @param {Function} [o.sleep]     ms → Promise (spacing between calls)
 * @param {number}   [o.spacingMs] gap between two calls (default 250 — four a second)
 * @param {number}   [o.ttlMs]     how long an answer is kept (default a week)
 * @param {number}   [o.maxEntries] answers kept at once (default 800)
 * @param {number}   [o.timeoutMs] one call's limit (default 8000)
 */
function createLastfm(o) {
  const fetchFn = o.fetch;
  const getKey = o.getKey;
  const now = o.now || Date.now;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const spacingMs = o.spacingMs === undefined ? 250 : o.spacingMs;
  const ttlMs = o.ttlMs === undefined ? 7 * 24 * 60 * 60 * 1000 : o.ttlMs;
  const failTtlMs = 10 * 60 * 1000;   // a failure is asked again ten minutes on
  const maxEntries = o.maxEntries || 800;
  const timeoutMs = o.timeoutMs || 8000;
  const ua = o.userAgent || "Rouen";

  const cache = new Map();     // "kind\0artist" → { at, ttl, value, pending }
  // Bumped by clear(): an answer to a call made before it (with the old key)
  // must not be stored after it.
  let generation = 0;
  let queue = Promise.resolve();
  let lastCallAt = 0;
  let calls = 0;               // for the suite: how many reached the network

  function keyFor(kind, artist) {
    return kind + "\u0000" + String(artist || "").trim().toLowerCase();
  }

  // One call to the API, through the queue. Throws an Error with `code`:
  // "nokey", a Last.fm error number (6 = not found, 10/26 = bad key, 29 = rate
  // limited), or "http"/"network".
  function call(method, params) {
    const run = async () => {
      const key = String(getKey() || "").trim();
      if (!key) { const e = new Error("no Last.fm key"); e.code = "nokey"; throw e; }
      const wait = lastCallAt + spacingMs - now();
      if (wait > 0) await sleep(wait);
      lastCallAt = now();
      calls++;
      const qs = new URLSearchParams(Object.assign({ method, api_key: key, format: "json" }, params));
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      let r, j;
      try {
        r = await fetchFn(API + "?" + qs.toString(), {
          headers: { "User-Agent": ua, "Accept": "application/json" },
          signal: ctl ? ctl.signal : undefined,
        });
        j = await r.json().catch(() => null);
      } catch (err) {
        const e = new Error("Last.fm unreachable: " + (err && err.message || err)); e.code = "network"; throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (j && j.error) {
        const e = new Error(String(j.message || ("Last.fm error " + j.error)));
        e.code = Number(j.error);
        throw e;
      }
      if (!r.ok || !j) { const e = new Error("Last.fm answered HTTP " + r.status); e.code = "http"; throw e; }
      return j;
    };
    const p = queue.then(run, run);
    // The queue continues whatever this call did.
    queue = p.then(() => undefined, () => undefined);
    return p;
  }

  // Remembered answers. A failure is remembered too, for less time, so a bad
  // key or a missing artist is not asked about on every album opened.
  function remembered(kind, artist, compute) {
    const k = keyFor(kind, artist);
    const hit = cache.get(k);
    if (hit) {
      if (hit.pending) return hit.pending;
      if (now() - hit.at < hit.ttl) {
        // Used again: the last to be dropped when the cache is full.
        cache.delete(k); cache.set(k, hit);
        if (hit.error) return Promise.reject(hit.error);
        return Promise.resolve(hit.value);
      }
    }
    const gen = generation;
    const pending = compute().then(
      (value) => { if (gen === generation) store(k, { at: now(), ttl: ttlMs, value }); return value; },
      (error) => {
        if (gen !== generation) throw error;
        // Not answers about the artist, so never remembered: a missing key
        // (saving one works on the very next album opened), and Last.fm's own
        // "too many requests" (29), which is about this moment, not this artist.
        if (error && (error.code === "nokey" || error.code === 29)) cache.delete(k);
        else store(k, { at: now(), ttl: failTtlMs, error });
        throw error;
      });
    cache.set(k, { at: 0, ttl: 0, pending });
    return pending;
  }
  function store(k, entry) {
    cache.delete(k);
    cache.set(k, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  /** The artists Last.fm calls closest to `artist`, closest first (24). */
  function similarArtists(artist) {
    const name = String(artist || "").trim();
    if (!name) return Promise.resolve({ artist: "", url: "", artists: [] });
    return remembered("similar", name, async () => {
      const j = await call("artist.getSimilar", { artist: name, autocorrect: "1", limit: "24" });
      const sim = j && j.similarartists;
      const attr = (sim && sim["@attr"]) || {};
      const seen = new Set();
      const artists = [];
      for (const a of asList(sim && sim.artist)) {
        const n = String((a && a.name) || "").trim();
        if (!n || seen.has(n.toLowerCase())) continue;
        seen.add(n.toLowerCase());
        artists.push({ name: n, url: siteUrl(a.url), match: Number(a.match) || 0, image: pickImage(a.image) });
      }
      // Last.fm's own name for the artist (autocorrect), and their page.
      const canonical = String(attr.artist || name);
      return {
        artist: canonical,
        url: "https://www.last.fm/music/" + encodeURIComponent(canonical).replace(/%20/g, "+"),
        artists,
      };
    });
  }

  /** `artist`'s most-played album on Last.fm, or null. */
  function topAlbum(artist) {
    const name = String(artist || "").trim();
    if (!name) return Promise.resolve(null);
    return remembered("top", name, async () => {
      const j = await call("artist.getTopAlbums", { artist: name, autocorrect: "1", limit: "5" });
      for (const al of asList(j && j.topalbums && j.topalbums.album)) {
        const title = String((al && al.name) || "").trim();
        // Last.fm's catalogue carries untitled rows as "(null)".
        if (!title || title === "(null)") continue;
        const by = String((al.artist && al.artist.name) || name).trim();
        return { title, artist: by, url: siteUrl(al.url), image: pickImage(al.image) };
      }
      return null;
    });
  }

  /**
   * Similar albums: the top album of each of the `count` closest similar
   * artists. Artists whose top album cannot be read are skipped, not fatal.
   * `wanted()` is asked between artists: false (the page has gone) stops it,
   * so nothing more is queued for an answer nobody will read.
   */
  async function similarAlbums(artist, count, wanted) {
    const sim = await similarArtists(artist);
    const out = [];
    for (const a of sim.artists.slice(0, count || 9)) {
      if (wanted && !wanted()) break;
      let al = null;
      try { al = await topAlbum(a.name); }
      catch (e) {
        // One artist's albums unreadable (not on Last.fm, a transient error)
        // costs that one entry; a key that stopped working is everyone's.
        if (e && (e.code === "nokey" || e.code === 10 || e.code === 26)) throw e;
      }
      if (al) out.push(al);
    }
    return { artist: sim.artist, albums: out };
  }

  return {
    similarArtists, topAlbum, similarAlbums,
    calls: () => calls,
    // Forget everything — a new key may see a different catalogue.
    clear: () => { generation++; cache.clear(); },
  };
}

module.exports = { createLastfm, pickImage, siteUrl, PLACEHOLDER };
