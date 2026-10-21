// @ts-check
"use strict";
/*
 * later.js — N2c-2 (dev/design/native-remote.md §10.4, v1.9.45): Roon's own Listen Later in place of
 * Rouen's, with native mode on, for the profile chosen in Settings → Native mode.
 *
 *   The list: GetListenLater (listen-later.js, proven on the owner's server), its albums on it — State
 *   Pending — kept here, read again when asked for and over 20 s old.
 *   A change: the album named by its AlbumId (the library read on this connection first, else Roon's own
 *   search, find.js, as an add names it) → Library::SetListenLaterState(Sooid, [AlbumLink], Pending | None)
 *   → believed once the list, read again every second for up to 10 s, shows it.
 *
 * Tried, not trusted (§3.3): SetListenLaterState has never been run upstream nor captured. What can't be
 * sent comes back as `notSent`, with why, for the caller to keep it today's way (Rouen's own list, the
 * owner's answer); what was sent and not shown comes back as `notShown`, and nothing else is done — it
 * may yet take.
 */
const { SIG, listenLaterStateArgs, LATER_STATE } = require("./methods");
const { profileFor, profilesOf } = require("./session");
const { noRoom } = require("./find");

const FRESH_MS = 20000;
const CONFIRM_MS = 10000;
const POLL_MS = 1000;
const MAX_ITEMS = 1000;
const SERVICE_OF = Object.freeze({ TIDAL: "tidal", Qobuz: "qobuz" });

/**
 * One album on Roon's list.
 * @typedef {{ title: string, artist: string, service: "tidal" | "qobuz" | "", inLibrary: boolean, albumId: string,
 *             imageKey: string | null, at: string | null }} Entry
 * @typedef {{ title: string, artist: string, service?: string, alt?: { title: string, artist: string } | null }} Wanted
 *   service: the page's, when it has one (a Smart Pick's); alt: the library's own strings for it, when Rouen has it
 * @typedef {{ entries: Entry[], at: number } | { notRead: string }} Listed
 */

/**
 * The albums on the list as the reader walked it: those still to listen to (Pending), newest first.
 * @param {any[]} items @returns {Entry[]}
 */
function entriesOf(items) {
  const out = [];
  for (const it of items) {
    const a = it && it.album;
    if (!a || !a.albumId || it.state !== LATER_STATE.pending) continue;
    out.push({ title: a.title, artist: a.artist, service: /** @type {any} */ (SERVICE_OF)[a.source] || "", inLibrary: !!a.inLibrary,
      albumId: String(a.albumId), imageKey: a.imageKey || null, at: typeof it.at === "string" ? it.at : null });
  }
  // Newest first, by when each was put aside (the server's local time sorts as its UTC does, within one list).
  const t = (/** @type {Entry} */ e) => (e.at ? Date.parse(e.at.replace(" (the server's local time)", "Z")) || 0 : 0);
  return out.map((e, i) => ({ e, i })).sort((x, y) => t(y.e) - t(x.e) || x.i - y.i).map((x) => x.e);
}

/**
 * @param {{ reader: { read(o?: { max?: number }): Promise<any> }, link: { session(): any } | null,
 *           inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean, profile: () => string | null,
 *           albums: () => import("./albums").RoonAlbum[] | null, finder: ReturnType<typeof import("./find").createFinder>,
 *           keyOf: (title: string, artist: string) => string | null, onChange?: () => void,
 *           log?: (line: string) => void, now?: () => number, confirmMs?: number, pollMs?: number, freshMs?: number }} deps
 *   on: native mode switched on; albums: the library as read on this connection, or null;
 *   onChange: a read found the list changed (in Roon's own apps, or by a change from here)
 */
function createLater(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const confirmMs = deps.confirmMs === undefined ? CONFIRM_MS : deps.confirmMs;
  const pollMs = deps.pollMs === undefined ? POLL_MS : deps.pollMs;
  const freshMs = deps.freshMs === undefined ? FRESH_MS : deps.freshMs;
  /** The last list read, on which connection, and its albums' keys. @type {{ session: any, at: number, entries: Entry[], keys: Set<string> } | null} */
  let cache = null;
  /** @type {Promise<Listed> | null} */
  let reading = null;
  const session = () => (deps.link ? deps.link.session() : null);
  /** @param {string} title @param {string} artist */
  const keyFor = (title, artist) => deps.keyOf(title, artist) || `${title}\u0000${artist}`;
  /** Whether an entry is the album wanted, by its own strings or the library's. @param {Entry} e @param {Wanted} w */
  const isIt = (e, w) => {
    const k = keyFor(e.title, e.artist);
    return k === keyFor(w.title, w.artist) || (!!w.alt && k === keyFor(w.alt.title, w.alt.artist));
  };
  const idsOf = (/** @type {Entry[]} */ list) => list.map((e) => e.albumId).join(",");

  /** The list read now (one read at a time: a second asker shares the first's). @returns {Promise<Listed>} */
  function read() {
    if (reading) return reading;
    reading = (async () => {
      const s = session();
      /** @type {any} */
      let r;
      // Unanswered (a timeout, the connection gone): not read, said; never a rejection a caller must catch (the review).
      try { r = await deps.reader.read({ max: MAX_ITEMS }); }
      catch (e) { return { notRead: "Your server didn't answer: " + (e && /** @type {any} */ (e).message) }; }
      if (r.error) return { notRead: String(r.error) };
      if (!r.read) return { notRead: r.why || "Your server didn't send its Listen Later." };
      if (!r.complete) return { notRead: "Your server's Listen Later had not all arrived." };
      if (r.list.notList) return { notRead: "Your server's Listen Later came back as something other than a list." };
      const entries = entriesOf(r.list.items);
      // The first read too: a change made before it (a Smart Pick sent at start) must reach every open screen.
      const changed = !cache || idsOf(cache.entries) !== idsOf(entries);
      cache = { session: s, at: now(), entries, keys: new Set(entries.map((e) => keyFor(e.title, e.artist))) };
      if (changed && deps.onChange) deps.onChange();
      return { entries, at: cache.at };
    })().finally(() => { reading = null; });
    return reading;
  }

  /**
   * Roon's list, read again when the last read is older than `maxAge` or was on another connection.
   * @param {number} [maxAge] @returns {Promise<Listed>}
   */
  async function list(maxAge) {
    if (!deps.on()) return { notRead: "Native mode is off." };
    const age = maxAge === undefined ? freshMs : maxAge;
    if (cache && cache.session === session() && now() - cache.at < age) return { entries: cache.entries, at: cache.at };
    const r = await read();
    // A read that failed for now (a read already running, the connection being checked): this connection's last list,
    // rather than Rouen's own in its place and back again (the review).
    if ("notRead" in r && cache && cache.session === session()) return { entries: cache.entries, at: cache.at };
    return r;
  }

  /**
   * The library album of these strings on this connection's read, by title and artist as hearts find it (§8).
   * @param {Wanted} w @returns {{ id: string } | { error: string } | null}  null: not in the library read
   */
  function inLibrary(w) {
    const all = deps.albums();
    if (!all) return null;
    for (const t of [w, w.alt].filter(Boolean)) {
      const x = /** @type {{ title: string, artist: string }} */ (t);
      let hits = all.filter((a) => a.title === x.title && a.artist === x.artist);
      if (!hits.length) { const k = deps.keyOf(x.title, x.artist); if (k) hits = all.filter((a) => deps.keyOf(a.title, a.artist) === k); }
      if (hits.length > 1) return { error: "Your server has two albums by that name and artist; Rouen can't tell which is meant." };
      if (hits.length) return hits[0].albumId ? { id: hits[0].albumId } : { error: "Your server didn't give this album the id Listen Later names it by." };
    }
    return null;
  }

  /**
   * The album named, then the call sent, in its turn with reads, hearts and searches.
   * @param {Wanted} w @param {boolean} on @param {string | null} known  the AlbumId, when Roon's list gave it
   * @returns {Promise<{ sentId: string } | { notSent: string } | { unsure: string }>}
   */
  function send(w, on, known) {
    return deps.inTurn(async () => {
      const s = session();
      if (!s) return { notSent: "Native mode isn't connected to your server right now." };
      if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
      const full = noRoom(s);
      if (full) return { notSent: full };
      // A write, for one profile: with several, the one chosen in Settings, as hearts wait for one (§8.4).
      const profiles = profilesOf(s.root);
      if (profiles.length > 1 && !profiles.some((p) => p.id === deps.profile())) return { notSent: "Choose your profile in Settings → Native mode first." };
      let id = known;
      if (!id) {
        const lib = inLibrary(w);
        if (lib && "error" in lib) return { notSent: lib.error };
        if (lib && "id" in lib) id = lib.id;
      }
      if (!id) {
        const service = w.service === "qobuz" ? "qobuz" : "tidal";   // either: pickCopy takes the other's copy when this one has none
        /** @type {Awaited<ReturnType<typeof deps.finder.searchIn>>} */
        let r;
        try { r = await deps.finder.searchIn(s, { title: w.title, artist: w.artist, service }); }
        catch (e) { return { notSent: "Your server's search didn't answer: " + (e && /** @type {any} */ (e).message) }; }
        if ("error" in r) return { notSent: r.error };
        if (r.finding.verdict === "incomplete" || r.finding.verdict === "error") return { notSent: r.finding.why || "Your server's search didn't answer." };
        const mine = r.same.find((h) => h.inLibrary && h.albumId);
        const hit = mine || (r.pick ? r.pick.hit : null);
        if (!hit) return { notSent: r.same.length ? "Your server's search found this album, but not with the id Listen Later names it by." : "Your server's search didn't find this album on TIDAL or Qobuz." };
        id = /** @type {string} */ (hit.albumId);
      }
      const broker = s.graph.ofType("Broker")[0];
      if (!broker) return { notSent: "Your server's graph came without its Broker, which Listen Later names." };
      const args = listenLaterStateArgs(s.g, /** @type {Buffer} */ (profileFor(s.root, deps.profile())), broker.oid, [BigInt(id)], on ? LATER_STATE.pending : LATER_STATE.none);
      /** @type {{ success: boolean, status?: string }} */
      let res;
      // Unanswered (a timeout, the connection gone): it may have reached your server, so nothing is kept elsewhere.
      try { res = await s.g.call(s.root.library.oid, SIG.setListenLater, args); }
      catch (e) { return { unsure: "Your server didn't answer (" + (e && /** @type {any} */ (e).message) + "); look at its Listen Later." }; }
      if (!res.success) return { notSent: `Your server refused it ("${res.status}").` };
      return { sentId: id };
    });
  }

  /**
   * Whether Roon's list shows each album as asked, read again until it does or `confirmMs` has passed.
   * @param {string[]} ids @param {boolean} on @returns {Promise<Set<string>>} the ids shown so
   */
  async function confirm(ids, on) {
    const until = now() + confirmMs;
    for (;;) {
      const l = await read();
      const shown = new Set(ids.filter((id) => "entries" in l && l.entries.some((e) => e.albumId === id) === on));
      if (shown.size === ids.length || now() >= until) return shown;
      await new Promise((r) => { setTimeout(r, pollMs); });
    }
  }

  /** Rouen's own list, copied once (Settings → Native mode), as the page follows it. */
  let copy = { running: false, total: 0, /** @type {any[]} */ done: [], error: /** @type {string | null} */ (null) };

  /** @param {Wanted[]} rows */
  async function copyAll(rows) {
    copy = { running: true, total: rows.length, done: [], error: null };
    try {
      const l = await read();
      if ("notRead" in l) { copy.error = l.notRead; return; }
      /** @type {Map<string, any>} */
      const sent = new Map();
      for (const w of rows) {
        const d = { title: w.title, artist: w.artist, result: "", why: /** @type {string | null} */ (null) };
        copy.done.push(d);
        if (l.entries.some((e) => isIt(e, w))) { d.result = "already"; continue; }
        const out = await send(w, true, null);
        if ("sentId" in out) { d.result = "sent"; sent.set(out.sentId, d); }
        else { d.result = "failed"; d.why = "notSent" in out ? out.notSent : out.unsure; }
      }
      const shown = sent.size ? await confirm([...sent.keys()], true) : new Set();
      for (const [id, d] of sent) {
        d.result = shown.has(id) ? "copied" : "not-shown";
        if (!shown.has(id)) d.why = "Your server took it, but its Listen Later didn't show it.";
      }
    } finally {
      copy.running = false;
      log(`copied Rouen's Listen Later: ${copy.done.filter((d) => d.result === "copied").length} of ${copy.total}`);
    }
  }

  return {
    list,
    /**
     * Whether Roon's list, as last read, holds the album; null when there is none to say (native mode off,
     * nothing read yet): the caller uses Rouen's own list. @param {Wanted} w
     */
    has(w) {
      if (!deps.on() || !cache || cache.session !== session()) return null;
      // Stale: read again for the next asker (the album view, Smart Picks), as GET's own asking does.
      if (now() - cache.at >= freshMs) list().catch(() => { /* list() answers notRead rather than rejecting; nothing to say here */ });
      const c = cache;
      return c.keys.has(keyFor(w.title, w.artist)) || (!!w.alt && c.keys.has(keyFor(w.alt.title, w.alt.artist)));
    },
    /** Read again when the last read is older than `maxAge` (the route's timer). @param {number} maxAge */
    refresh(maxAge) { return list(maxAge); },
    /**
     * Put on Roon's list, or taken off it.
     * @param {Wanted} w @param {boolean} on
     * @returns {Promise<{ off: true } | { ok: true, on: boolean } | { notSent: string } | { notShown: string }>}
     */
    async set(w, on) {
      if (!deps.on()) return { off: true };
      let known = null;
      if (!on) {
        const l = await list();
        if ("notRead" in l) return { notSent: l.notRead };
        const e = l.entries.find((x) => isIt(x, w));
        if (!e) return { ok: true, on: false };   // not on Roon's list: nothing to take off
        known = e.albumId;
      }
      const out = await send(w, on, known);
      if ("notSent" in out) { log(`not sent "${w.title}" (${on ? "on" : "off"}): ${out.notSent}`); return out; }
      if ("unsure" in out) { log(`"${w.title}" (${on ? "on" : "off"}): ${out.unsure}`); return { notShown: out.unsure }; }
      log(`"${w.title}" ${on ? "put on" : "taken off"} Listen Later (album ${out.sentId}); waiting for the list to show it`);
      if ((await confirm([out.sentId], on)).size) return { ok: true, on };   // confirm() reads by read(), which never rejects
      log(`"${w.title}": the list didn't show it ${on ? "on" : "off"} within ${confirmMs / 1000} s`);
      return { notShown: `Your server took it, but its Listen Later didn't show it ${on ? "on the list" : "taken off"}.` };
    },
    /** Begun, to follow with copyProgress(); one at a time. @param {Wanted[]} rows */
    startCopy(rows) {
      if (!deps.on()) return { error: "Native mode is off.", status: 409 };
      if (copy.running) return { error: "A copy is already running.", status: 409 };
      copyAll(rows).catch((e) => { copy.error = "The copy stopped: " + (e && e.message); });
      return { running: true, total: rows.length };
    },
    copyProgress: () => ({ running: copy.running, total: copy.total, done: copy.done.map((d) => Object.assign({}, d)), error: copy.error }),
  };
}

module.exports = { createLater, entriesOf };
