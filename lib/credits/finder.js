// @ts-check
"use strict";
/*
 * finder.js — an album's credits found and kept (dev/design/album-credits.md §2, §4): your server's (native mode,
 * lib/roon-direct/credits.js), the files' own tags (files.js), MusicBrainz's release and the album's Wikipedia
 * article's Personnel (wikipedia.js, v1.9.70-t2), merged (rules.js) and kept
 * (store.js) the first time its page asks. Kept rows are given at once; read again after RECHECK_MS, or after
 * RETRY_MS when a source failed (not "gave nothing": failed). Mandarin's CreditFinder.LookAtAlbum and AlbumNow, with
 * Roon's credits beside them and a release found by name where the files name none.
 */
const rules = require("./rules");
const { releaseOf } = require("./files");
const { releaseQuery, pickRelease, isMbid } = require("./lookups");

const RECHECK_MS = 30 * 24 * 60 * 60 * 1000, RETRY_MS = 24 * 60 * 60 * 1000, SOON_MS = 10 * 60 * 1000;
const RELEASE_INC = "artists+recordings+artist-credits+artist-rels+recording-level-rels+work-rels+work-level-rels";

/**
 * @typedef {{ title: string, artist: string, tracks: number }} AlbumAsked  tracks: the album's count as its page has it (0: unknown)
 * @typedef {{ state: string, at: number, why?: string }} SourceState
 */

/**
 * @param {{ store: ReturnType<typeof import("./store").createCreditStore>,
 *           roon: () => { album(title: string, artist: string): Promise<any> } | null,
 *           files: { read(title: string, artist: string): Promise<{ files: import("./files").TaggedFile[], why: string | null, dir?: string | null, unread?: number }> },
 *           mb: (path: string) => Promise<any>,
 *           wikipedia?: { album(title: string, artist: string, albumKey: (t: string, a: string) => string | null): Promise<{ article: string | null, credits: rules.Credit[], why: string }> } | null,
 *           albumKey: (title: string, artist: string) => string | null,
 *           nameKey: (name: string) => string, onNames?: (names: Array<{ name: string, mbid: string | null }>) => void,
 *           now?: () => number, log?: (line: string) => void }} deps
 *   roon: native mode's reader while native mode is on, else null; mb: a MusicBrainz path ("release/…") asked in its queue,
 *   throwing an Error whose message holds "404" for a release that is gone; onNames: the names to find pictures for
 */
function createCreditFinder(deps) {
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});
  /** @type {Map<string, Promise<any>>} */
  const reading = new Map();
  /** The last read's account of each album, for the debug read. @type {Map<string, any>} */
  const lastRead = new Map();

  /**
   * Is a kept album still to be given as it is? Read again after a month; a source that failed, the next day; your
   * server, when it couldn't be asked then (native mode off, not yet connected or read) and can be now, after SOON_MS.
   * @param {import("./store").KeptAlbum} k
   */
  function fresh(k) {
    const t = now();
    if (t - k.at > RECHECK_MS) return false;
    // Kept before Wikipedia was a source (v1.9.70-t1): read again, so it is asked.
    if (deps.wikipedia && !(k.sources && k.sources.wikipedia)) return false;
    const r = k.sources && k.sources.roon;
    if (r && (r.state === "off" || r.state === "wait") && deps.roon() && t - r.at > SOON_MS) return false;
    return !Object.values(k.sources || {}).some((s) => s.state === "failed" && t - s.at > RETRY_MS);
  }

  /** @param {AlbumAsked} a @returns {Promise<{ credits: rules.Credit[], state: SourceState, how?: any }>} */
  async function fromRoon(a) {
    const r = deps.roon();
    if (!r) return { credits: [], state: { state: "off", at: now(), why: "Native mode is off." } };
    try {
      const got = await r.album(a.title, a.artist);
      if (!got.read) return { credits: [], state: { state: got.wait ? "wait" : got.how ? "failed" : "none", at: now(), why: got.why }, how: got.how };
      /** @type {rules.Credit[]} */
      const credits = rules.fromRoon(0, got.album);
      got.tracks.forEach((/** @type {{ credits: any[] }} */ t, /** @type {number} */ i) => { credits.push(...rules.fromRoon(i + 1, t.credits)); });
      // The tracks' read refused (new, never run before): what the album gave stands, and the tracks are asked again tomorrow.
      const tracksRefused = got.how && got.how.trackEditInfo && got.how.trackEditInfo !== "Success";
      const why = [tracksRefused ? `Your server refused the tracks' credits (${got.how.trackEditInfo}).` : "",
        got.unnamed ? `${got.unnamed} credit(s) came with no name and are left out.` : ""].filter(Boolean).join(" ");
      const state = tracksRefused ? "failed" : credits.length ? "gave" : "none";
      return { credits, state: Object.assign({ state, at: now() }, why ? { why } : {}), how: got.how };
    } catch (e) {
      return { credits: [], state: { state: "failed", at: now(), why: String(e && /** @type {any} */ (e).message) } };
    }
  }

  /** @param {AlbumAsked} a */
  async function fromFiles(a) {
    const read = await deps.files.read(a.title, a.artist);
    /** @type {rules.Credit[]} */
    const credits = [];
    read.files.forEach((f, i) => { credits.push(...rules.fromTags(f.number || i + 1, f.native)); });
    const said = [read.dir ? "Read from " + read.dir + "." : "", read.unread ? `${read.unread} file(s) there couldn't be read.` : ""].filter(Boolean).join(" ");
    const state = read.files.length ? Object.assign({ state: credits.length ? "gave" : "none", at: now() }, said ? { why: said } : {})
      : { state: "none", at: now(), why: [read.why || "No files.", said].filter(Boolean).join(" ") };
    return { credits, state, release: releaseOf(read.files) };
  }

  /** @param {AlbumAsked} a @param {string | null} tagged  the files' release id @returns {Promise<{ credits: rules.Credit[], state: SourceState, release: string | null, acts: Array<{ name: string, mbid: string }> }>} */
  async function fromMusicBrainz(a, tagged) {
    let release = isMbid(tagged) ? tagged : null;
    const by = release ? "the files' release id" : "a search by name";
    try {
      if (!release) {
        if (!(a.tracks > 0)) return { credits: [], state: { state: "none", at: now(), why: "No release id in the files, and no track count to search by." }, release: null, acts: [] };
        release = pickRelease(await deps.mb(releaseQuery(a.title, a.artist)), a, deps.albumKey);
        if (!release) return { credits: [], state: { state: "none", at: now(), why: "No release whose title, artist and track count are the album's." }, release: null, acts: [] };
      }
      const rel = await deps.mb(`release/${release}?inc=${RELEASE_INC}`);
      const credits = rules.fromRelease(rel);
      return { credits, state: { state: credits.length ? "gave" : "none", at: now(), why: "Release " + release + ", by " + by + "." }, release, acts: rules.releaseActs(rel) };
    } catch (e) {
      const msg = String(e && /** @type {any} */ (e).message);
      // A release since merged or removed gives nothing; anything else is asked again the next day.
      return { credits: [], state: { state: /404/.test(msg) ? "none" : "failed", at: now(), why: msg }, release, acts: [] };
    }
  }

  /** @param {AlbumAsked} a @returns {Promise<{ credits: rules.Credit[], state: SourceState, article: string | null }>} */
  async function fromWikipedia(a) {
    if (!deps.wikipedia) return { credits: [], state: { state: "off", at: now(), why: "Not asked." }, article: null };
    try {
      const got = await deps.wikipedia.album(a.title, a.artist, deps.albumKey);
      const state = got.credits.length ? "gave" : "none";
      return { credits: got.credits, state: { state, at: now(), why: (got.article ? `"${got.article}": ` : "") + got.why }, article: got.article };
    } catch (e) {
      return { credits: [], state: { state: "failed", at: now(), why: String(e && /** @type {any} */ (e).message) }, article: null };
    }
  }

  /** @param {AlbumAsked} a @param {string} key */
  async function read(a, key) {
    // Roon's in its turn on the connection; the files and then MusicBrainz (which needs the files' release id), and
    // Wikipedia, meanwhile.
    const filesP = fromFiles(a);
    const [roon, files, mb, wiki] = await Promise.all([fromRoon(a), filesP, filesP.then((f) => fromMusicBrainz(a, f.release)), fromWikipedia(a)]);
    const all = [...roon.credits, ...mb.credits, ...wiki.credits, ...files.credits];
    const count = a.tracks > 0 ? a.tracks : Math.max(0, ...all.map((c) => c.track));
    const rows = rules.merge(all, count, deps.nameKey);
    const kept = { rows, sources: { roon: roon.state, musicbrainz: mb.state, wikipedia: wiki.state, tags: files.state }, at: now() };
    deps.store.saveAlbum(key, kept);
    lastRead.set(key, { asked: a, sources: kept.sources, roon: roon.how || null, release: mb.release, wikipedia: wiki.article, rows: rows.length });
    if (deps.onNames) {
      const ids = new Map(mb.acts.map((x) => [deps.nameKey(x.name), x.mbid]));
      deps.onNames(rows.map((r) => ({ name: r.name, mbid: r.mbid || ids.get(r.key) || null })));
    }
    log(`credits: ${a.title} — ${rows.length} name(s); your server ${roon.state.state}, MusicBrainz ${mb.state.state}, Wikipedia ${wiki.state.state}, tags ${files.state.state}`);
    return kept;
  }

  return {
    /**
     * An album's credits: as kept when fresh, else read (for waitMs at most: "pending" past it, the read going on).
     * @param {AlbumAsked} a @param {number} waitMs
     * @returns {Promise<{ status: "ok" | "pending", kept: import("./store").KeptAlbum | null }>}
     */
    async album(a, waitMs) {
      const key = deps.albumKey(a.title, a.artist);
      if (!key) return { status: "ok", kept: null };
      const kept = deps.store.album(key);
      if (kept && fresh(kept)) return { status: "ok", kept };
      let p = reading.get(key);
      if (!p) {
        p = read(a, key).finally(() => reading.delete(key));
        reading.set(key, p);
      }
      /** @type {any} */
      const late = Symbol("late");
      const got = await Promise.race([p.catch((e) => { log("credits: " + String(e && e.message)); return null; }), new Promise((res) => { setTimeout(() => res(late), waitMs); })]);
      if (got === late) return { status: "pending", kept: kept || null };
      return { status: "ok", kept: got || kept || null };
    },
    /** The last read's account of an album, for the debug read. @param {string} title @param {string} artist */
    lastRead(title, artist) { const k = deps.albumKey(title, artist); return k ? lastRead.get(k) || null : null; },
  };
}

module.exports = { createCreditFinder, RECHECK_MS, RETRY_MS, SOON_MS, RELEASE_INC };
