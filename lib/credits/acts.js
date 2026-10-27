// @ts-check
"use strict";
/*
 * acts.js — a picture for each name on an album's credits (dev/design/album-credits.md §5), looked up in the
 * background one name a turn: its MusicBrainz artist (the release's own id for it, else found by name), then
 * FanArt.tv's portrait (with the key), else Wikidata's (P18, through the MusicBrainz entry's Wikidata link), else
 * Deezer's. Kept (store.js); again after REDO_MS, or after RETRY_MS when MusicBrainz couldn't be reached. Mandarin's
 * CreditFinder.LookUp and Photo, without the artist page's facts (members, years, links), which this build has no
 * page for, but with a band's members now (§7): the artist page asks for them (band), and the members' pictures
 * follow. The names of the album or the page just opened go to the front of the queue.
 */
const { foundMbid, wikidataLink, wikidataId, wikidataPhoto, fanartPhoto, deezerPhoto, isMbid, currentMembers } = require("./lookups");
const { rolesOf } = require("./rules");

const REDO_MS = 90 * 24 * 60 * 60 * 1000, RETRY_MS = 24 * 60 * 60 * 1000, GAP_MS = 250, QUEUE_MAX = 400;
const FANART = "https://webservice.fanart.tv", WIKIDATA = "https://www.wikidata.org", DEEZER = "https://api.deezer.com";

/**
 * @param {{ store: ReturnType<typeof import("./store").createCreditStore>, mb: (path: string) => Promise<any>,
 *           json: (url: string, headers?: Record<string, string>) => Promise<any>, fanartKey: () => string,
 *           nameKey: (name: string) => string, userAgent: string, now?: () => number, log?: (line: string) => void,
 *           later?: (fn: () => void, ms: number) => void }} deps
 *   mb: a MusicBrainz path asked in its queue; json: any other source's address, read
 */
function createActs(deps) {
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});
  const later = deps.later || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); });
  /** @type {Array<{ key: string, name: string, mbid: string | null }>} */
  let queue = [];
  let running = false;

  /** Still to be looked up? @param {string} key */
  function due(key) {
    const k = deps.store.act(key);
    if (!k) return true;
    return now() - k.at > (k.ok ? REDO_MS : RETRY_MS);
  }

  /** @param {string} name @param {string | null} mbid @returns {Promise<{ url: string | null, source: string | null, mbid: string | null, members: any[] }>} */
  async function lookUp(name, mbid) {
    let id = isMbid(mbid) ? mbid : null;
    if (!id) id = foundMbid(await deps.mb("artist/?query=" + encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`) + "&limit=5"), name, deps.nameKey);
    /** @type {any} */
    let artist = null;
    if (id) artist = await deps.mb(`artist/${id}?inc=url-rels+artist-rels`);
    const members = currentMembers(artist, rolesOf, deps.nameKey);
    const key = deps.fanartKey();
    if (id && key) {
      try {
        const u = fanartPhoto(await deps.json(`${FANART}/v3/music/${encodeURIComponent(id)}?api_key=${encodeURIComponent(key)}`));
        if (u) return { url: u, source: "fanart.tv", mbid: id, members };
      } catch (e) { /* none there: the next source */ }
    }
    const q = wikidataId(wikidataLink(artist));
    if (q) {
      try {
        const u = wikidataPhoto(await deps.json(`${WIKIDATA}/wiki/Special:EntityData/${q}.json`, { "User-Agent": deps.userAgent }), q);
        if (u) return { url: u, source: "Wikimedia Commons", mbid: id, members };
      } catch (e) { /* none there: the next source */ }
    }
    try {
      const u = deezerPhoto(await deps.json(`${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=5`), name, deps.nameKey);
      if (u) return { url: u, source: "Deezer", mbid: id, members };
    } catch (e) { /* none there either: kept without a picture */ }
    return { url: null, source: null, mbid: id, members };
  }

  /** @type {Map<string, Promise<void>>} */
  const looking = new Map();
  /** One name looked up and kept, once at a time. @param {{ key: string, name: string, mbid: string | null }} next */
  function lookOne(next) {
    let p = looking.get(next.key);
    if (p) return p;
    p = (async () => {
      try {
        const got = await lookUp(next.name, next.mbid);
        deps.store.saveAct({ key: next.key, name: next.name, mbid: got.mbid, photo: got.url, source: got.source, at: now(), ok: true, members: got.members });
      } catch (e) {
        // MusicBrainz out of reach: kept as not looked up, so asked again the next day.
        deps.store.saveAct({ key: next.key, name: next.name, mbid: next.mbid, photo: null, source: null, at: now(), ok: false, members: null });
        log(`credits: ${next.name}: ${String(e && /** @type {any} */ (e).message)}`);
      }
    })().finally(() => looking.delete(next.key));
    looking.set(next.key, p);
    return p;
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (!due(next.key)) continue;
        await lookOne(next);
        await new Promise((res) => { later(() => res(undefined), GAP_MS); });
      }
    } finally { running = false; }
  }

  return {
    /**
     * The names of an album just opened, to the front of the queue.
     * @param {Array<{ name: string, mbid: string | null }>} names
     */
    want(names) {
      /** @type {Array<{ key: string, name: string, mbid: string | null }>} */
      const add = [];
      for (const n of names) {
        const key = deps.nameKey(n.name);
        if (!key || add.some((x) => x.key === key) || !due(key)) continue;
        add.push({ key, name: n.name, mbid: n.mbid });
      }
      if (!add.length) return;
      const keys = new Set(add.map((x) => x.key));
      queue = add.concat(queue.filter((x) => !keys.has(x.key))).slice(0, QUEUE_MAX);
      run().catch((e) => log("credits: " + String(e && e.message)));
    },
    /**
     * A band's members now (§7), looked up when not kept (for waitMs at most: "pending" past it, the lookup going on);
     * once known, their pictures are wanted. A person, or an act with none listed: no members.
     * @param {string} name @param {number} waitMs
     * @returns {Promise<{ status: "ok" | "pending", members: Array<{ name: string, mbid: string | null, roles: string[] }> }>}
     */
    async band(name, waitMs) {
      const key = deps.nameKey(name);
      if (!key) return { status: "ok", members: [] };
      const kept = deps.store.act(key);
      const ready = () => {
        const k = deps.store.act(key);
        const members = (k && Array.isArray(k.members)) ? k.members : [];
        if (members.length) this.want(members);
        return members;
      };
      // Kept, and not yet due again (a band read a while ago, or MusicBrainz out of reach today): as it is.
      if (kept && !due(key)) return { status: "ok", members: ready() };
      const late = Symbol("late");
      const got = await Promise.race([lookOne({ key, name, mbid: kept ? kept.mbid : null }), new Promise((res) => { setTimeout(() => res(late), waitMs); })]);
      if (got === late) return { status: "pending", members: kept && Array.isArray(kept.members) ? kept.members : [] };
      return { status: "ok", members: ready() };
    },
    /** A name's picture, as kept. @param {string} name @returns {string | null} */
    photo(name) { const k = deps.store.act(deps.nameKey(name)); return k ? k.photo : null; },
    /** How many wait. */
    waiting: () => queue.length,
  };
}

module.exports = { createActs, REDO_MS, RETRY_MS };
