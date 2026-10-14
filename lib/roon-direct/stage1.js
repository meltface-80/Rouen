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
 *  - Reads again after each library change (indexChanged), at most every
 *    `minGapMs`; one read at a time, a change during one asks for another.
 *  - After an update (owner, 2026-10-14; §8.5): if Rouen's version, the
 *    Core's or the Core itself differs from what was recorded, Roon's sources
 *    are set aside and a read runs as the check. Whole: it stays on, the new
 *    versions are recorded and the check is noted. Anything else: off.
 *  - Any failed read turns it off, with its reason and time, the saved
 *    sources deleted (§8.6). It does not retry.
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
const { readAlbums } = require("./albums");
const { buildIndex, sourceOf, matchReport, serialise, deserialise } = require("./source");

/**
 * @typedef {{ host: string | null, coreId: string | null, coreVersion: string | null }} CoreInfo
 * @typedef {object} Deps
 * @property {{ load(): any, save(v: any): void }} settings  the stored state (settings.json's roonDirect)
 * @property {{ read(): any, write(v: any): void, remove(): void }} cache  the saved sources
 * @property {() => CoreInfo | null} core              the paired Core, as the public API gives it
 * @property {string} rouenVersion
 * @property {() => Array<{ key: string | null, imageKey?: string | null }> | null} records  Rouen's albums, once indexed
 * @property {import("./source").KeyOf} keyOf
 * @property {() => void} [onChange]                    the sources in force changed
 * @property {typeof readAlbums} [read]
 * @property {() => number} [now]
 * @property {number} [minGapMs]
 * @property {(line: string) => void} [log]
 */

const MIN_GAP_MS = 30 * 60 * 1000;

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
  };
}

/** @param {Deps} deps */
function createStage1(deps) {
  const now = deps.now || Date.now;
  const read = deps.read || readAlbums;
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
  }

  /** @param {string | null} reason  null: the user turned it off */
  function turnOff(reason) {
    gen++;
    const was = st.on && !!index && !pending;
    st = Object.assign(stored(null), { offReason: reason, offAt: reason ? now() : null, lastRead: st.lastRead });
    index = null; saved = null; pending = null; report = null;
    if (timer) { clearTimeout(timer); timer = null; }
    try { deps.cache.remove(); } catch (e) { log("could not delete the saved sources: " + (e && /** @type {any} */ (e).message)); }
    save();
    if (reason) log("off: " + reason);
    if (was) changed();
  }

  function run() {
    const core = deps.core();
    // Not paired yet: pairing calls paired(), which asks again.
    if (!core || !core.coreId) return;
    if (!core.host) { turnOff("Rouen does not know the Roon Core's address to connect to (ROON_CORE_IP can give it)."); return; }
    if (timer) { clearTimeout(timer); timer = null; }   // this read is the one it was waiting to start
    const mine = gen;
    const host = core.host, coreId = core.coreId;
    reading = (async () => {
      /** @type {Awaited<ReturnType<typeof readAlbums>>} */
      let res;
      try { res = await read({ host, coreId }); }
      catch (e) { res = { ok: false, why: String(e && /** @type {any} */ (e).message || e), ms: 0, lifetime: null }; }
      if (mine !== gen || !st.on) return;   // turned off or on, or an update found, while it ran
      lastReadAt = now();
      if (!res.ok) {
        const why = /** @type {import("./albums").ReadFailed} */ (res).why;
        turnOff(pending ? `${pending}, and the check that followed failed: ${why}` : why);
        return;
      }
      index = buildIndex(res.albums, deps.keyOf);
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
      changed();
    })().finally(() => {
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
    /** The source Roon gives this album's key, or null: Rouen's own inference decides. @param {string | null | undefined} key */
    sourceOf(key) { return st.on && !pending ? sourceOf(index, key) : null; },
    /** Whether Roon's sources are in force. */
    active() { return st.on && !pending && !!index; },

    /** Rouen paired with a Core (or again). */
    paired() {
      if (!st.on) return;
      const core = deps.core();
      if (!core) return;
      /** @type {string[]} */
      const why = [];
      if (pending) why.push(pending);
      if (st.coreId && core.coreId !== st.coreId) why.push("Rouen is paired with a different Roon Core");
      else if (st.coreVersion !== core.coreVersion) why.push(`Roon Core updated from ${st.coreVersion || "an unknown version"} to ${core.coreVersion || "an unknown version"}`);
      if (why.length) {
        const was = !!index && !pending;
        gen++;   // a read already running was started before this was known
        pending = why.join("; ");
        index = null; saved = null;
        if (was) changed();
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
      if (!core || !core.coreId) return { error: "Rouen is not paired with a Roon Core." };
      if (!core.host) return { error: "Rouen does not know the Roon Core's address to connect to (ROON_CORE_IP can give it)." };
      gen++;
      st = Object.assign(stored(null), { on: true, rouenVersion: deps.rouenVersion, coreVersion: core.coreVersion, coreId: core.coreId });
      index = null; saved = null; pending = null; report = null; lastReadAt = 0;
      save();
      request(true);
      return this.status();
    },
    turnOff() { turnOff(null); return this.status(); },
    status() {
      if (!report && index) refreshReport();
      return {
        on: st.on, active: this.active(), reading: !!reading,
        checking: st.on ? pending : null,
        offReason: st.offReason, offAt: st.offAt,
        lastRead: st.lastRead, checked: st.checked, report: st.on && !pending ? report : null,
      };
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
