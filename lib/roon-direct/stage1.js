// @ts-check
"use strict";
/*
 * stage1.js — Roon direct's switch and its reads (dev/design/roon-native.md
 * §10, §8): whether stage 1's sources are in force, when the album list is
 * read, and what happens after an update or a failure.
 *
 *  - Off until the user turns it on (Settings → Roon). Off: sourceOf answers
 *    null for every album, nothing connects, Rouen is exactly as without it.
 *  - On records Rouen's version, the Core's version and the Core's id, and
 *    reads at once (albums.js).
 *  - Reads over the native remote's one connection (link.js, v1.9.21): it
 *    is started with the switch and stopped with it, and every session it
 *    opens is read at once (linkUp) — at the start, after a drop, and after
 *    the nightly reconnect.
 *  - Reads again after each library change (indexChanged), at most every
 *    `minGapMs`; one read at a time, a change during one asks for another.
 *  - After an update (owner, 2026-10-14; §8.5): if Rouen's version, the
 *    Core's or the Core itself differs from what was recorded, Roon's sources
 *    are set aside and a read runs as the check. Whole: it stays on, the new
 *    versions are recorded and the check is noted. Anything else: off.
 *  - A failed read (v1.9.21, dev/design/native-remote.md §3.3) falls back to
 *    Rouen's own answers and the official API's list, says why (`fellBack`),
 *    and deletes the saved sources; it stays on, and the next session or
 *    library change reads again. Only the check after an update turns it off.
 *  - Its result is saved (`cache`), so a restart uses it as soon as Rouen has
 *    paired and found nothing updated — never before (the Core's version is
 *    known only then), and never while a check after an update is pending.
 *  - A read is tied to what it was started for (`gen`): turning it off or on,
 *    or an update found at pairing, discards a read already running.
 *
 * Everything outside is passed in (deps), so the whole of it is testable
 * without a Core, a clock or a disk.
 */
const fs = require("node:fs");
const { readAlbumsOn } = require("./albums");
const { profilesOf } = require("./session");
const { createMarks } = require("./marks");
const { buildIndex, sourceOf, matchReport, serialise, deserialise } = require("./source");

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
 * @property {{ start(): void, stop(why?: string): void, refresh(): void, cycle(why: string): void, session(): any, status(): any }} [link]
 *                                                    the one connection (link.js); none: read is called with null
 * @property {(session: any, o: { profile: string | null }) => Promise<import("./albums").ReadOk | import("./albums").ReadFailed>} [read]
 * @property {() => any} [view]                         what the screens were given of the last read (index.js)
 * @property {() => number} [now]
 * @property {number} [minGapMs]
 * @property {(line: string) => void} [log]
 */

// One read a minute at most: each is one query on the connection already
// open, not a connection of its own as before v1.9.21 (30 minutes then).
const MIN_GAP_MS = 60 * 1000;

/** @param {any} v */
function stored(v) {
  const s = v && typeof v === "object" ? v : {};
  return {
    on: s.on === true,
    rouenVersion: typeof s.rouenVersion === "string" ? s.rouenVersion : null,
    coreVersion: typeof s.coreVersion === "string" ? s.coreVersion : null,
    coreId: typeof s.coreId === "string" ? s.coreId : null,
    offReason: typeof s.offReason === "string" ? s.offReason : null,
    offAt: typeof s.offAt === "number" ? s.offAt : null,
    lastRead: s.lastRead && typeof s.lastRead === "object" ? s.lastRead : null,
    checked: s.checked && typeof s.checked === "object" ? s.checked : null,
    // v1.9.27: hearts written to the server — off until turned on (reads before writes,
    // roon-native.md §3) — and the profile they and the read are for (§8.4); kept across off and on.
    hearts: s.hearts === true,
    profile: typeof s.profile === "string" && /^[0-9a-f]{2,64}$/.test(s.profile) ? s.profile : null,
  };
}

/**
 * Whether two reads gave the same list: then the screens have nothing new.
 * @param {import("./albums").RoonAlbum[] | null} a @param {import("./albums").RoonAlbum[]} b
 */
function sameList(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.title !== y.title || x.artist !== y.artist || x.contentSource !== y.contentSource || x.imageKey !== y.imageKey) return false;
  }
  return true;
}

/** @param {Deps} deps */
function createStage1(deps) {
  const now = deps.now || Date.now;
  const read = deps.read || ((/** @type {any} */ s, /** @type {any} */ o) => readAlbumsOn(s, o));
  const link = deps.link || null;
  const minGap = deps.minGapMs === undefined ? MIN_GAP_MS : deps.minGapMs;
  const log = deps.log || (() => {});
  const changed = deps.onChange || (() => {});
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
  /**
   * One thing at a time on the session's graph (v1.9.27, the review): a read
   * and a heart each watch what the Core pushes, and two at once blinded each
   * other. Reads and hearts take their turn here.
   * @type {Promise<unknown>}
   */
  let turn = Promise.resolve();
  let inUse = 0;
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (fn) => {
    /** Started now when nothing else is: a read begins in the call that asked for it, as always. */
    const now_ = () => { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } };
    const p = inUse === 0 ? now_() : turn.then(fn, fn);
    inUse++;
    turn = p.then(() => {}, () => {}).then(() => { inUse--; });   // the next waits for this one, whatever became of it
    return p;
  };
  // Hearts go only on the list in force: on, checked after any update, and read whole.
  /** The server's profiles, as the last session showed them. @type {Array<{ id: string, name: string }>} */
  let profiles = [];
  const profilesNow = () => {
    const s = link ? link.session() : null;
    if (s && s.root && s.root.profiles) profiles = profilesOf(s.root);
    return profiles;
  };
  /** Why hearts are not offered, or null. */
  const heartsOff = () => {
    if (!st.hearts) return "Hearts are off. Turn them on in Settings → Native mode once the favourites it counts there match your server's.";
    if (profilesNow().length > 1 && !profilesNow().some((p) => p.id === st.profile)) return "Choose whose favourites hearts are, in Settings → Native mode.";
    return null;
  };
  const marks = createMarks({ link, albums: () => (st.on && !pending && !fellBack ? albums : null), keyOf: deps.keyOf, log, inTurn,
    profile: () => st.profile, enabled: heartsOff });

  const save = () => { deps.settings.save(Object.assign({}, st)); };
  const refreshReport = () => {
    const recs = index ? deps.records() : null;
    report = recs && index ? matchReport(recs, index) : null;
  };

  if (st.on) {
    if (st.rouenVersion !== deps.rouenVersion) pending = `Rouen updated from ${st.rouenVersion || "an earlier version"} to ${deps.rouenVersion}`;
    else {
      const c = deps.cache.read();
      saved = c && c.coreId === st.coreId ? deserialise(c.index) : null;
    }
    if (link) link.start();   // it waits for pairing
  }

  /** @param {string | null} reason  null: the user turned it off */
  function turnOff(reason) {
    gen++;
    const was = st.on && !!index && !pending;
    st = Object.assign(stored(null), { offReason: reason, offAt: reason ? now() : null, lastRead: st.lastRead, hearts: st.hearts, profile: st.profile });
    index = null; saved = null; pending = null; report = null; albums = null; fellBack = null;
    marks.reset();
    if (link) link.stop(reason ? "native mode turned off: " + reason : "native mode switched off");
    if (timer) { clearTimeout(timer); timer = null; }
    try { deps.cache.remove(); } catch (e) { log("could not delete the saved sources: " + (e && /** @type {any} */ (e).message)); }
    save();
    if (reason) log("off: " + reason);
    if (was) changed();
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
    if (!core.host) { turnOff("Rouen does not know your server's address to connect to (set it in Rouen's container settings)."); return; }
    const session = link ? link.session() : null;
    // Not connected yet (or between sessions): the next session asks (linkUp).
    if (link && !session) { link.refresh(); return; }
    if (timer) { clearTimeout(timer); timer = null; }   // this read is the one it was waiting to start
    const mine = gen;
    const coreId = core.coreId;
    reading = inTurn(async () => {
      /** @type {import("./albums").ReadOk | import("./albums").ReadFailed} */
      let res;
      // For the profile chosen in Settings → Native mode, whose hearts it reads (v1.9.27).
      try { res = await read(session, { profile: st.profile }); }
      catch (e) { res = { ok: false, why: String(e && /** @type {any} */ (e).message || e), ms: 0, lifetime: null }; }
      if (mine !== gen || !st.on) return;   // turned off or on, or an update found, while it ran
      lastReadAt = now();
      // Its connection was closed under it on purpose (the nightly reconnect,
      // another Core paired): no fault of the read's, and the next session
      // reads again (linkUp) — a fallback now would flip every screen twice.
      if (!res.ok && link && session && link.session() !== session) return;
      if (!res.ok) {
        const why = /** @type {import("./albums").ReadFailed} */ (res).why;
        if (pending) turnOff(`${pending}, and the check that followed failed: ${why}`);
        else fallBack(why);
        return;
      }
      // The same list as the screens have (each new session reads it afresh):
      // nothing for them to redo, so they are not told (v1.8.68's rule).
      const same = !pending && !fellBack && !!index && sameList(albums, res.albums);
      index = buildIndex(res.albums, deps.keyOf);
      albums = res.albums;
      marks.afterRead(res.albums);
      fellBack = null;
      if (pending) {
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
    }).finally(() => {
      reading = null;
      if (again) { const force = againForce; again = againForce = false; request(force); }
    });
  }

  /** @param {boolean} force  read now, whatever the gap */
  function request(force) {
    if (!st.on) return;
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
    marks,
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
    /** The Core's albums from the last whole read, while in force (null after a restart until one is read). */
    albums() { return this.active() ? albums : null; },
    /** The link opened a session: everything is read on it afresh. */
    linkUp() { if (st.on) request(true); },
    /**
     * The link closed, or could not open. A check after an update that cannot
     * even connect has failed (§8.5): off, as a failed read would be.
     * @param {string} why @param {boolean} planned  closed on purpose
     */
    linkDown(why, planned) {
      if (st.on && pending && !planned) turnOff(`${pending}, and the check that followed failed: ${why}`);
    },

    /** Rouen paired with a Core (or again). */
    paired() {
      if (!st.on) return;
      const core = deps.core();
      if (!core) return;
      if (link) link.refresh();
      /** @type {string[]} */
      const why = [];
      if (pending) why.push(pending);
      if (st.coreId && core.coreId !== st.coreId) why.push("Rouen is paired with a different server");
      else if (st.coreVersion !== core.coreVersion) why.push(`Your server updated from ${st.coreVersion || "an unknown version"} to ${core.coreVersion || "an unknown version"}`);
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
    turnOn() {
      const core = deps.core();
      if (!core || !core.coreId) return { error: "Rouen is not paired with your server." };
      if (!core.host) return { error: "Rouen does not know your server's address to connect to (set it in Rouen's container settings)." };
      gen++;
      st = Object.assign(stored(null), { on: true, rouenVersion: deps.rouenVersion, coreVersion: core.coreVersion, coreId: core.coreId,
        hearts: st.hearts, profile: st.profile });
      index = null; saved = null; pending = null; report = null; lastReadAt = 0; albums = null; fellBack = null;
      save();
      if (link) link.start();
      request(true);
      return this.status();
    },
    turnOff() { turnOff(null); return this.status(); },
    /** Hearts on or off (v1.9.27). @param {boolean} on */
    setHearts(on) { st.hearts = on === true; save(); log("hearts " + (st.hearts ? "on" : "off")); return this.status(); },
    /**
     * The profile hearts and the read are for: one of the server's, by its id. The list is
     * read again for it, since its favourites are that profile's.
     * @param {string} id
     */
    setProfile(id) {
      if (!profilesNow().some((p) => p.id === id)) return { error: "Your server has no such profile." };
      if (st.profile !== id) { st.profile = id; save(); marks.reset(); if (st.on) request(true); }
      return this.status();
    },
    status() {
      if (!report && index) refreshReport();
      return {
        on: st.on, active: this.active(), reading: !!reading,
        checking: st.on ? pending : null,
        offReason: st.offReason, offAt: st.offAt,
        lastRead: st.lastRead, checked: st.checked,
        fellBack: st.on ? fellBack : null,
        // The connection (link.js), and what the screens were given (index.js's library view).
        link: st.on && link ? link.status() : null,
        library: st.on && deps.view ? deps.view() : null,
        // The first few not matched, for the page; all of them (to 200) from unmatched().
        report: st.on && !pending && report ? Object.assign({}, report, { unmatched: report.unmatched.slice(0, 10) }) : null,
        hearts: st.on ? Object.assign(marks.status(), {
          enabled: st.hearts, off: heartsOff(), profiles: profilesNow(), profile: st.profile,
          // What the read found, for the owner to check against the server before turning hearts on.
          favourites: albums ? albums.filter((a) => a.favorite === true).length : null,
        }) : null,
      };
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

/**
 * The saved sources, as a JSON file: written whole (to a temporary file, then
 * renamed, so a crash cannot leave half of one), read back, deleted.
 * @param {string} file
 */
function fileCache(file) {
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (e) { return null; }   // none saved yet, or unreadable: nothing is used, and the next read replaces it
    },
    /** @param {any} v */
    write(v) { fs.writeFileSync(file + ".tmp", JSON.stringify(v)); fs.renameSync(file + ".tmp", file); },
    remove() { fs.rmSync(file, { force: true }); },
  };
}

module.exports = { createStage1, fileCache, MIN_GAP_MS };
