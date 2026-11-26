// @ts-check
"use strict";
/*
 * stage1.js — Roon direct's switch and its reads (dev/design/roon-native.md
 * §10, §8): whether stage 1's sources are in force, when the album list is
 * read, and what happens after an update or a failure.
 *
 *  - Always on (roon-native.md §11, 2.0.6-t21) but for an install that answered No or ROUEN_NATIVE=off (then
 *    nothing connects). When the path fails (§11.2) it is suspended: the official API serves everything until the
 *    next try, at 04:00, at start, or after an update.
 *  - On records Rouen's version, the Core's version and the Core's id, and
 *    reads at once (albums.js).
 *  - Reads over the native remote's one connection (link.js, v1.9.21): it
 *    runs while native mode is in use or tried, and every session it
 *    opens is read at once (linkUp) — at the start, after a drop, and after
 *    the nightly reconnect.
 *  - Reads again after each library change (indexChanged), at most every
 *    `minGapMs`; one read at a time, a change during one asks for another.
 *  - After an update (owner, 2026-10-14; §8.5): if Rouen's version, the
 *    Core's or the Core itself differs from what was recorded, Roon's sources
 *    are set aside and a read runs as the check. Whole: it stays on, the new
 *    versions are recorded and the check is noted. Failed: suspended.
 *  - A failed read (v1.9.21, dev/design/native-remote.md §3.3) falls back to
 *    Rouen's own answers and the official API's list, says why (`fellBack`),
 *    and deletes the saved sources; it stays on, and the next session or
 *    library change reads again; three in a row on three sessions suspend it.
 *  - Its result is saved (`cache`), so a restart uses it as soon as Rouen has
 *    paired and found nothing updated — never before (the Core's version is
 *    known only then), and never while a check after an update is pending.
 *  - A read is tied to what it was started for (`gen`): turning it off or on,
 *    or an update found at pairing, discards a read already running.
 *
 * Everything outside is passed in (deps), so the whole of it is testable
 * without a Core, a clock or a disk.
 */
// The saved sources' file (file-cache.js, moved out in v1.9.32), still offered from here.
const { fileCache } = require("./file-cache");
const { readAlbumsOn } = require("./albums");
const { adopt } = require("./album-facts");
const { profilesOf, profileFor } = require("./session");
const { profileBool, profileBools } = require("./profile-data");
const { createServices } = require("./services");
const { buildIndex, sourceOf, matchReport, serialise, deserialise } = require("./source");
const { stored, sameList, statusOf } = require("./always-on");
const { msUntilHour } = require("./link");
const { createTurns } = require("./turns");

/**
 * @typedef {{ host: string | null, coreId: string | null, coreVersion: string | null }} CoreInfo
 * @typedef {object} Deps
 * @property {{ load(): any, save(v: any): void }} settings  the stored state (settings.json's roonDirect)
 * @property {{ read(): any, write(v: any): void, remove(): void }} cache  the saved sources
 * @property {() => CoreInfo | null} core              the paired Core, as the public API gives it
 * @property {string} rouenVersion
 * @property {() => Array<{ keys: string[], title?: string, artist?: string, imageKey?: string | null }> | null} records  Rouen's albums, once indexed
 * @property {import("./source").KeyOf} keyOf
 * @property {() => void} [onChange]                    the sources in force changed
 * @property {() => void} [onFacts]                     a favourite, format or genre moved in place (shelf-focus.md §2)
 * @property {{ start(): void, stop(why?: string): void, refresh(): void, cycle(why: string): void, session(): any, status(): any }} [link]
 *                                                    the one connection (link.js); none: read is called with null
 * @property {(session: any, o: { profile: string | null, known: Map<string, import("./albums").RoonAlbum> | null }) => Promise<import("./albums").ReadOk | import("./albums").ReadFailed>} [read]
 * @property {() => any} [view]                         what the screens were given of the last read (index.js)
 * @property {() => number} [now]
 * @property {number} [minGapMs]
 * @property {(line: string) => void} [log]
 * @property {() => boolean | null} [chosen]  native mode chosen at the one-time choice (login.md §5, v1.9.32); false: never on
 * @property {() => string | null} [emergency]  why native mode must not start (ROUEN_NATIVE=off, always-on.js), or null
 * @property {(title: string, artist: string) => number | null} [inLibrary]  an album's place in the library Rouen plays from (adder.js, v1.9.41)
 * @property {() => void} [onLaterChange]  a read of Roon's own Listen Later found it changed (later.js, v1.9.45)
 * @property {(zoneId: string) => any} [zone]  the official API's zone now, by its id (smart.js's play, v1.9.51)
 * @property {() => any[]} [zones]  the official API's zones now, for the zones probe (v1.9.64, §14.1)
 * @property {(title: string, artist: string) => import("./edit-info").RouenRelease | null} [release]  what Rouen holds of
 *   an album's label, catalogue number and kind, for the edit-info probe (v1.9.67-t3, catalogue.md §4)
 * @property {(records: import("./edit-facts").RoonRelease[], whole: boolean) => any} [roonRelease]  what index.js keeps of a
 *   walk of Roon's edit info (v1.9.67-t4): the cache's "roon" layer, and the labels Rouen had none for
 * @property {() => string | null} [requestProfile]  the Roon profile (hex) linked to the asking device's Rouen profile
 *   (profiles.md §5, 2.0.7-t4), or null: a call made for a request acts for it when the server has it, else for the
 *   profile chosen in Settings → Native mode, which reads and background work always act for
 */
// One read a minute at most: each is one query on the connection already open, not a connection of its own as before v1.9.21 (30 minutes then).
const MIN_GAP_MS = 60 * 1000;

/** @param {Deps} deps */
function createStage1(deps) {
  const now = deps.now || Date.now;
  const read = deps.read || ((/** @type {any} */ s, /** @type {any} */ o) => readAlbumsOn(s, o));
  const link = deps.link || null;
  const minGap = deps.minGapMs === undefined ? MIN_GAP_MS : deps.minGapMs;
  const log = deps.log || (() => {});
  const changed = deps.onChange || (() => {});
  let factsRev = 0; const facts = () => { factsRev++; if (deps.onFacts) deps.onFacts(); };   // the Shelf's (shelf-focus.md §2)
  let st = stored(deps.settings.load());
  /** @type {import("./source").SourceIndex | null} */
  let index = null;
  /** Why a check after an update is due, or null. @type {string | null} */
  let pending = null;
  /** @type {Promise<void> | null} */
  let reading = null;
  let again = false, againForce = false, lastReadAt = 0, gen = 0;
  /** The saved sources, held until pairing shows nothing has been updated. @type {import("./source").SourceIndex | null} */
  let saved = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {ReturnType<typeof matchReport> | null} */
  let report = null;
  /** The Core's albums from the last whole read, for the screens' library (library.js). @type {import("./albums").RoonAlbum[] | null} */
  let albums = null;
  /** Why the last read failed and Rouen fell back to the official API, until one succeeds. @type {{ why: string, at: number } | null} */
  let fellBack = null;
  /** The session `albums` was read on (v1.9.28). @type {any} */
  let albumsOn = null;
  /**
   * What the server has sent `sentOn` of each album, by object id, as it said it (v1.9.28): a later read
   * there is given rows only, and takes the rest from here. Copies, so Rouen's own hearts (marks.js
   * writes them into `albums`) never pass for the server's word; kept through a failed read (what it
   * read is added) and a fallback, since the server sends none of it again on that connection.
   * @type {Map<string, import("./albums").RoonAlbum>}
   */
  let sent = new Map();
  /** @type {any} */
  let sentOn = null;
  /** Favourites pushed on `pushedOn` since its read began, by object id, every profile's: laid over that read's result (the second review). */
  let pushedFav = new Map();
  /** @type {any} */
  let pushedOn = null;
  /** Kept only for the session still open: one closed under its read is never read again. @param {any} session @param {import("./albums").RoonAlbum[]} list */
  const keepSent = (session, list) => {
    if (!session || (link && link.session() !== session)) return;
    if (sentOn !== session) { sent = new Map(); sentOn = session; }
    for (const a of list) sent.set(a.oid, Object.assign({}, a));
  };
  // One thing at a time on the session's graph (v1.9.27; turns.js, moved out in 2.0.7-t4).
  const inTurn = createTurns();
  // Hearts go only on the list in force: on, checked after any update, and read whole.
  /** The server's profiles, as the last session showed them. @type {Array<{ id: string, name: string }>} */
  let profiles = [];
  const profilesNow = () => {
    const s = link ? link.session() : null;
    if (s && s.root && s.root.profiles) profiles = profilesOf(s.root);
    return profiles;
  };
  /**
   * The Roon profile a call acts for (profiles.md §5, 2.0.7-t4): the asking device's linked one, when the server has it;
   * else the one chosen in Settings → Native mode (a profile not linked, Guest, and every read and job of the server's own).
   */
  const actingFor = () => {
    const r = deps.requestProfile ? deps.requestProfile() : null;
    return r && profilesNow().length > 1 && profilesNow().some((p) => p.id === r) ? r : st.profile;   // one profile: as before
  };
  /** Why hearts are not offered, or null. */
  const heartsOff = () => {
    if (profilesNow().length > 1 && !profilesNow().some((p) => p.id === actingFor())) return "Choose whose favourites hearts are, in Settings → Native mode.";
    // Said here too, so the page says why there is no heart (v1.9.28: there was none, and nothing said).
    if (fellBack) return "Hearts wait for a read of your server's library to succeed; the last one failed (above).";
    if (!albums) return "Hearts wait for your server's library to be read.";
    return null;
  };
  // N2b-1 (native-remote.md §9.1): library albums a read names by reference are known from what the session was
  // sent, once its library has been read whole on it (a failed read records what it saw).
  const knownOn = (/** @type {any} */ s) => (albumsOn === s && sentOn === s ? sent : null);
  const readsOff = () => (!st.on ? "Native mode is off." : pending ? "Native mode is checking your server after an update." : st.suspended ? "Native mode isn't in use: " + st.suspended.why : !albums ? "Your library hasn't been read yet."
    : !link || albumsOn !== link.session() ? "Your library hasn't been read on this connection to your server yet; check again in a minute." : null);
  // What native mode does over the connection (services.js, moved out in v1.9.51).
  const { marks, finder, later, smartProbe, editInfoProbe, editFacts, credits, trackTimes, listenLater, playlists, adder, smart, smartMaker, smartUpdater, smartMove, zoneProbe, readsProbe, playsOnProbe, addedProbe, suggestProbe, appearsOn, playlistArtists, transport, zoneSettings, zoneControls, zoneDsp, dspSettings, peqTry, peq, signalPath, versions, versionsProbe, playlistEditProbe, playlistEdit } = createServices({ link, inTurn, log, deps, heartsOff,
    known: knownOn, off: readsOff, on: () => st.on && !(st.suspended && !pending), profile: actingFor, chosen: () => st.profile, inForce: () => (st.on && !pending && !fellBack ? albums : null),
    readOn: () => albumsOn, onFacts: facts });
  /** The session whose pushes are watched for favourites changed elsewhere, and how many came (v1.9.28). @type {any} */
  let watchedOn = null;
  let liveFavourites = 0;
  /**
   * A favourite changed (in your server's own apps, or by a heart of Rouen's): the server pushes the
   * album again to a client it believes holds it. Taken at once, rather than at the next read.
   * @param {any} s  the session
   */
  function watchFavourites(s) {
    if (!s || !s.graph || !s.graph.watchers || watchedOn === s) return;
    watchedOn = s;
    liveFavourites = 0;   // counted for this connection
    s.graph.watchers.add((/** @type {any} */ o, /** @type {Record<string, any>} */ pushed) => {
      if (!/\.AlbumLite$/.test(o.typeName)) return;
      const keys = Object.keys(pushed);
      const key = keys.find((k) => k.endsWith("::IsFavorite"));
      // The whole album again — its AlbumId, which never changes, so no update of a field carries it — is a
      // sparse struct: an IsFavorite left out is no one's favourite, and the graph, which merges, must not
      // keep the one it held (the review). One field sent alone (a rename) says nothing of the favourite.
      const whole = keys.some((k) => k.endsWith("::AlbumId"));
      if (!key && whole) for (const k of Object.keys(o.fields)) if (k.endsWith("::IsFavorite")) delete o.fields[k];
      if (!key && !whole) return;
      const fav = key ? profileBool(pushed[key], /** @type {Buffer} */ (profileFor(s.root, st.profile))) : false;
      if (fav === undefined) return;
      // Every Roon profile's, as the read keeps them (profiles.md §5): left out, no one's.
      const by = key ? profileBools(pushed[key]) : {};
      const oid = o.oid.toString();
      if (pushedOn !== s) { pushedFav = new Map(); pushedOn = s; }
      pushedFav.set(oid, { fav, by });
      const was = sentOn === s ? sent.get(oid) : undefined;
      if (!was) return;
      // A heart of Rouen's that the server shows is its own, not a change made elsewhere.
      const own = !!was.albumId && marks.observed(was.albumId, fav, by);
      const rec = albumsOn === s && albums ? albums.find((a) => a.oid === was.oid) : null;
      const moved = fav !== (rec ? rec.favorite : was.favorite) || (by !== undefined && JSON.stringify(by) !== JSON.stringify(rec ? rec.favBy : was.favBy));   // as Rouen showed it, to any profile (§5)
      was.favorite = fav;
      if (rec) rec.favorite = fav;
      if (by !== undefined) { was.favBy = by; if (rec) rec.favBy = by; }
      if (moved && !own) liveFavourites++;
      if (moved) facts();
    });
  }
  const save = () => { deps.settings.save(Object.assign({}, st)); };
  const refreshReport = () => {
    const recs = index ? deps.records() : null;
    report = recs && index ? matchReport(recs, index) : null;
  };
  /** The nightly try while suspended; reads failed in a row, and the last one's session (§11.2: three, on three). */
  let nightly = /** @type {ReturnType<typeof setTimeout> | null} */ (null), failedReads = 0, failedOn = /** @type {any} */ (null);
  // Always on (§11), but never for an install that answered No (login.md §5), nor with the emergency off.
  const enabled = () => !(deps.chosen && deps.chosen() === false) && !(deps.emergency && deps.emergency());
  if (!enabled()) { turnOff(null); log("off: " + (deps.emergency && deps.emergency() || "native mode wasn't chosen for this Rouen")); }
  if (st.on) {
    // At start a suspended native mode is tried again (§11.2), as the check after an update is.
    if (st.suspended) pending = `Rouen restarted; native mode had stopped: ${st.suspended.why}`;
    // Never read (a new install, or one switched off before 2.0.6-t21): nothing from before to check, only a read.
    else if (st.rouenVersion && st.rouenVersion !== deps.rouenVersion) pending = `Rouen updated from ${st.rouenVersion} to ${deps.rouenVersion}`;
    else {
      const c = deps.cache.read();
      saved = c && c.coreId === st.coreId ? deserialise(c.index) : null;
    }
    if (link) link.start();   // it waits for pairing
  }
  /**
   * Off (`reason` null: the install answered No), or suspended (§11.2: the path failed, `reason` why): nothing native
   * runs, the official API serves everything, and a suspended one is tried again at 04:00, at start, or after an update.
   * @param {string | null} reason
   */
  function turnOff(reason) {
    gen++;
    const was = st.on && !!index && !pending;
    st = Object.assign(stored(null), { on: !!reason, suspended: reason ? { why: reason, at: now() } : null,
      rouenVersion: st.rouenVersion, coreVersion: st.coreVersion, coreId: st.coreId, lastRead: st.lastRead, profile: st.profile });
    index = null; saved = null; pending = null; report = null; albums = null; fellBack = null; failedReads = 0;
    if (nightly) { clearTimeout(nightly); nightly = null; }
    if (reason) {
      nightly = setTimeout(() => { nightly = null; retry("the nightly try at 04:00"); }, msUntilHour(4, new Date(now())));
      if (typeof nightly.unref === "function") nightly.unref();
    }
    sent = new Map(); sentOn = null;
    marks.reset();
    editFacts.stop();
    if (link) link.stop(reason ? "native mode suspended: " + reason : "native mode off");
    if (timer) { clearTimeout(timer); timer = null; }
    try { deps.cache.remove(); } catch (e) { log("could not delete the saved sources: " + (e && /** @type {any} */ (e).message)); }
    save();
    if (reason) log("suspended, on the official API until the next try: " + reason);
    if (was) changed();
  }

  /** A suspended native mode tried again: the link opened and the library read, as a check (§11.2). @param {string} why */
  function retry(why) {
    if (!st.on || !st.suspended || pending) return;
    if (nightly) { clearTimeout(nightly); nightly = null; }
    gen++;
    pending = `Trying native mode again (${why}); it had stopped: ${st.suspended.why}`;
    log(pending);
    if (link) link.start();
    request(true);
  }

  /** A read failed: the official API's list and Rouen's own answers until one succeeds. @param {string} why */
  function fallBack(why) {
    const was = st.on && !!index && !pending;
    index = null; saved = null; report = null; albums = null;
    fellBack = { why, at: now() };
    try { deps.cache.remove(); } catch (e) { log("could not delete the saved sources: " + (e && /** @type {any} */ (e).message)); }
    log("fell back to the official API: " + why);
    if (was) changed();
  }

  function run() {
    const core = deps.core();
    // Not paired yet: pairing calls paired(), which asks again.
    if (!core || !core.coreId) return;
    if (!core.host) { if (!st.suspended || pending) turnOff("Rouen does not know your server's address to connect to (set it in Rouen's container settings)."); return; }
    const session = link ? link.session() : null;
    // Not connected yet (or between sessions): the next session asks (linkUp).
    if (link && !session) { link.refresh(); return; }
    if (timer) { clearTimeout(timer); timer = null; }   // this read is the one it was waiting to start
    const mine = gen;
    const coreId = core.coreId;
    reading = inTurn(async () => {
      /** @type {import("./albums").ReadOk | import("./albums").ReadFailed} */
      let res;
      // For the profile chosen in Settings → Native mode, whose hearts it reads (v1.9.27); with what
      // this session has been sent, which the server does not send twice (v1.9.28).
      const known = session && sentOn === session ? sent : null;
      pushedFav = new Map(); pushedOn = session;
      try { res = await read(session, { profile: st.profile, known }); }
      catch (e) { res = { ok: false, why: String(e && /** @type {any} */ (e).message || e), ms: 0, lifetime: null }; }
      const got = res.ok ? res.albums : ("seen" in res && res.seen) || [];
      // A favourite pushed while it ran may have come after its album was read: the push is the later word.
      if (pushedOn === session) for (const a of got) { const p = pushedFav.get(a.oid); if (p) { a.favorite = p.fav; if (p.by) a.favBy = p.by; } }
      // Whatever became of it, what it read is not sent again on this session (the review of v1.9.28).
      if (res.ok) { sent = new Map(); sentOn = null; }
      keepSent(session, got);
      if (mine !== gen || !st.on) return;   // turned off or on, or an update found, while it ran
      lastReadAt = now();
      // Its connection was closed under it on purpose (the nightly reconnect,
      // another Core paired): no fault of the read's, and the next session
      // reads again (linkUp) — a fallback now would flip every screen twice.
      if (!res.ok && link && session && link.session() !== session) return;
      if (!res.ok) {
        const why = /** @type {import("./albums").ReadFailed} */ (res).why;
        if (!session || session !== failedOn) { failedReads++; failedOn = session; }
        if (pending) turnOff(`${pending}, and the check that followed failed: ${why}`);
        else if (failedReads >= 3) turnOff(`three reads of your library failed in a row; the last: ${why}`);
        else fallBack(why);
        return;
      }
      failedReads = 0; failedOn = null;
      // The same list as the screens have (each new session reads it afresh):
      // nothing for them to redo, so they are not told (v1.8.68's rule).
      const same = !pending && !fellBack && !!index && sameList(albums, res.albums);
      const list = same ? /** @type {import("./albums").RoonAlbum[]} */ (albums) : res.albums;
      const moved = same && adopt(list, res.albums);   // the objects the records hold kept (shelf-focus.md §2)
      index = buildIndex(list, deps.keyOf);
      albums = list;
      albumsOn = session;
      marks.afterRead(list);
      editFacts.start(session);   // t4: Roon's catalogue numbers, kinds and labels, in the background
      fellBack = null;
      if (pending) {
        st.suspended = null;   // a try that succeeded: in use again (§11.2)
        st.checked = { after: pending, at: now() };
        log("checked after an update: " + pending);
        pending = null;
      }
      st.rouenVersion = deps.rouenVersion;
      st.coreVersion = core.coreVersion;
      st.coreId = coreId;
      st.lastRead = { at: now(), ms: res.ms, albums: res.count, pages: res.pages };
      try { deps.cache.write({ coreId, index: serialise(index) }); }
      catch (e) { log("could not save the sources read: " + (e && /** @type {any} */ (e).message)); }
      save();
      refreshReport();
      if (!same) changed();
      else if (moved) facts();
    }).finally(() => {
      reading = null;
      if (again) { const force = againForce; again = againForce = false; request(force); }
    });
  }

  /** @param {boolean} force  read now, whatever the gap */
  function request(force) {
    if (!st.on || (st.suspended && !pending)) return;
    if (reading) { again = true; againForce = againForce || force; return; }
    const wait = lastReadAt + minGap - now();
    if (!force && lastReadAt && wait > 0) {
      if (!timer) {
        timer = setTimeout(() => { timer = null; request(true); }, wait);
        if (typeof timer.unref === "function") timer.unref();
      }
      return;
    }
    run();
  }

  return {
    /** Hearts (marks.js, native-remote.md §8, v1.9.27): over the link, on the list last read. */
    marks, factsRev: () => factsRev, actingFor, roonProfiles: () => (st.on && !pending && !!index ? { profiles: profilesNow(), chosen: st.profile } : null),
    /** An album's heart for the profile a call acts for (§5, 2.0.7-t4): the read's own, or that profile's from it. @param {any} a */
    heartOf: (a) => (actingFor() === st.profile ? a.favorite : a.favBy ? a.favBy[/** @type {string} */ (actingFor())] === true : null), finder, later, adder, playlists, listenLater, smartProbe, editInfoProbe, editFacts, credits, trackTimes, smart, smartMaker, smartUpdater, smartMove, zoneProbe, readsProbe, playsOnProbe, addedProbe, suggestProbe, appearsOn, playlistArtists, transport, zoneSettings, zoneControls, zoneDsp, dspSettings, peqTry, peq, signalPath, versions, versionsProbe, playlistEditProbe, playlistEdit,
    /**
     * The source Roon gives an album, by its keys (albumKeys: exact first), or
     * null — not matched, or Roon direct not in force (see active()).
     * @param {string[] | string | null | undefined} keys
     */
    sourceOf(keys) {
      if (!st.on || pending || !index) return null;
      // Every one of Rouen's albums is answered once per report (matchReport's
      // `resolved`): this runs for each album of every list and Focus count.
      const k = Array.isArray(keys) ? keys[0] : keys;
      if (report && k && report.resolved.has(k)) return report.resolved.get(k) || null;
      return sourceOf(index, keys);
    },
    /** Whether Roon's sources are in force. */
    active() { return st.on && !pending && !!index; },
    /** The connection the library was last read on whole, or null (v1.9.63: the playlists' copy waits for it, §13). */
    readOn() { return albumsOn; },
    /** The Core's albums from the last whole read, while in force (null after a restart until one is read). */
    albums() { return this.active() ? albums : null; },
    /** The link opened a session: everything is read on it afresh. */
    linkUp() { if (st.on) { watchFavourites(link ? link.session() : null); request(true); } },
    /**
     * The link closed, or could not open: a drop, retried by the link (§11.2), whatever was pending. Since 2.0.6-t21
     * only the path closed or broken (linkBroken) suspends native mode.
     * @param {string} _why @param {boolean} _planned  closed on purpose
     */
    linkDown(_why, _planned) {
      sent = new Map(); sentOn = null;   // its session's, never sent again
    },
    /** The path closed or broken (link.js, §11.2: refused, or three openings that reached the server failed). @param {string} why */
    linkBroken(why) {
      if (!st.on || (st.suspended && !pending)) return;
      turnOff(pending ? `${pending}, and the check that followed failed: ${why}` : why);
    },
    /** Rouen paired with a Core (or again). */
    paired() {
      if (!st.on) return;
      const core = deps.core();
      if (!core) return;
      /** @type {string[]} */
      const why = [];
      if (st.coreId && core.coreId !== st.coreId) why.push("Rouen is paired with a different server");
      // Never read yet (turned on at the choice, before pairing): nothing to check against.
      else if (st.coreId && st.coreVersion !== core.coreVersion) why.push(`Your server updated from ${st.coreVersion || "an unknown version"} to ${core.coreVersion || "an unknown version"}`);
      // Suspended (§11.2): tried again only when the server, or its version, changed; else it waits for 04:00.
      if (st.suspended && !pending) { if (why.length) retry(why.join("; ")); return; }
      if (pending) why.unshift(pending);
      if (link) link.refresh();
      if (why.length) {
        const was = !!index && !pending;
        gen++;   // a read already running was started before this was known
        pending = why.join("; ");
        index = null; saved = null; albums = null;
        marks.reset();   // hearts set before are not checked against another server, or another version
        if (was) changed();
        // The check is read on a connection opened now, to the Core as it is
        // now — never on one held from before (another Core, or an old version).
        if (link) link.cycle(pending);
        request(true);
      } else {
        if (!index && saved) { index = saved; saved = null; refreshReport(); changed(); }
        request(!index);
      }
    },
    /** Rouen's album index changed: the report follows now, a read when the gap allows. */
    indexChanged() {
      if (!st.on) return;
      refreshReport();
      request(false);
    },
    /** On, now: at the one-time choice's Yes (optIn), and in the tests. There is no switch (§11). */
    turnOn() {
      if (deps.emergency && deps.emergency()) return { error: /** @type {string} */ (deps.emergency()) };
      if (deps.chosen && deps.chosen() === false) return { error: "Native mode wasn't chosen for this Rouen. That changes only by removing Rouen and its data, and installing it again." };
      const core = deps.core();
      if (!core || !core.coreId) return { error: "Rouen is not paired with your server." };
      if (!core.host) return { error: "Rouen does not know your server's address to connect to (set it in Rouen's container settings)." };
      gen++;
      st = Object.assign(stored(null), { on: true, rouenVersion: deps.rouenVersion, coreVersion: core.coreVersion, coreId: core.coreId,
        profile: st.profile });
      index = null; saved = null; pending = null; report = null; lastReadAt = 0; albums = null; fellBack = null; failedReads = 0;
      if (nightly) { clearTimeout(nightly); nightly = null; }
      save();
      if (link) link.start();
      request(true);
      return this.status();
    },
    /** Off for good: the one-time choice's No (optOut). There is no switch (§11). */
    turnOff() { turnOff(null); return this.status(); },
    /** Chosen at the one-time choice (login.md §5): on now, or — not paired yet — at the first pairing. */
    optIn() {
      // Always on since 2.0.6-t21 (§11): on already, as it is, its after-an-update check included; never past the
      // emergency off or a No (the review). Nothing else is left for the choice to do.
      if (st.on || !enabled()) return;
      st = Object.assign(stored(null), { on: true, rouenVersion: deps.rouenVersion, profile: st.profile });
      save();
      if (link) link.start();   // it waits for pairing
    },
    /**
     * The profile hearts and the read are for: one of the server's, by its id. The list is
     * read again for it, since its favourites are that profile's.
     * @param {string} id
     */
    setProfile(id) {
      if (!profilesNow().some((p) => p.id === id)) return { error: "Your server has no such profile." };
      // Read again on a fresh connection: the server sends each album once a connection, and
      // the favourites kept from this one's are the last profile's (v1.9.28).
      if (st.profile !== id) { st.profile = id; save(); marks.reset(); if (st.on && link) link.cycle("whose favourites changed"); else if (st.on) request(true); }
      return this.status();
    },
    status() {
      if (!report && index) refreshReport();
      return statusOf({ st, active: this.active(), reading: !!reading, offered: !(deps.chosen && deps.chosen() === false),
        pending, emergency: deps.emergency ? deps.emergency() : null, fellBack, link, view: deps.view, report, albumsOn,
        hearts: () => Object.assign(marks.status(), { off: heartsOff(), profiles: profilesNow(), profile: st.profile,
          live: liveFavourites, favourites: albums ? albums.filter((a) => a.favorite === true).length : null }) });
    },
    /** Rouen's albums Roon's list did not give a source for, each with why (up to 200). */
    unmatched() {
      if (!report && index) refreshReport();
      return st.on && !pending && report ? report.unmatched : [];
    },
    /** For tests: resolves once no read is running. */
    async settled() { while (reading) await reading; },
  };
}

module.exports = { createStage1, fileCache, MIN_GAP_MS };
