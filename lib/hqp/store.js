"use strict";
// ---------------------------------------------------------------------------
// The two files the HQPlayer control writes: combinations that failed
// (learned from rollbacks) and presets. Ported from hqpweb
// (apps/server/src/{jsonstore,learned,presets}.ts), MIT, (c) 2026
// statelycurmudgeon — see ./LICENSE.
//
// A missing file is normal. An unreadable one is MOVED ASIDE, never silently
// overwritten by the next save, so a bad write cannot cost anybody their
// presets without leaving them a copy.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function loadList(file, key, log) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = data && data[key];
    if (!Array.isArray(list)) throw new Error('no "' + key + '" array');
    return list;
  } catch (e) {
    const aside = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
    try { fs.renameSync(file, aside); }
    catch (e2) { /* the warning below still names the file; a failed move leaves it in place, which is no worse */ }
    (log || console.error)("[hqp] could not read " + file + " (" + e.message + "); moved it to " + aside + " and started empty");
    return [];
  }
}

// Atomic: a crash mid-write leaves the old file, never half a new one.
function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + "\n");
  fs.renameSync(tmp, file);
}

// ---- learned failures ------------------------------------------------------
// Kept per HQPlayer and per ENGINE VERSION, because both change what works.

const sameCombo = (a, b) =>
  a.mode === b.mode && a.rateHz === b.rateHz && a.filterNx === b.filterNx && a.filter1x === b.filter1x && a.shaper === b.shaper;

class LearnedStore {
  /** file null = memory only (tests). */
  constructor(file) {
    this.file = file || null;
    // Saved before counts existed: once each, first seen when last seen.
    this.failures = (this.file ? loadList(this.file, "failures") : [])
      .map((x) => Object.assign({}, x, { count: x.count || 1, first: x.first || x.at }));
  }
  /**
   * A failure, counted against the same HQPlayer, engine and combination when
   * there is one: a history ("failed here 3×, last 6 Oct"), with the latest
   * reason and time (hqpweb main, 339929c).
   */
  record(f) {
    const same = (x) => x.instance === f.instance && x.engine === f.engine && sameCombo(x, f);
    const prev = this.failures.find(same);
    this.failures = this.failures.filter((x) => !same(x));
    this.failures.push(Object.assign({}, f, { count: (prev ? prev.count || 1 : 0) + 1, first: prev ? prev.first || prev.at : f.at }));
    this.save();
  }
  forInstance(instance, engine, mode) {
    return this.failures.filter((f) => f.instance === instance && f.engine === engine && f.mode === mode);
  }
  all(instance) {
    return this.failures.filter((f) => f.instance === instance);
  }
  forget(instance) {
    this.failures = this.failures.filter((f) => f.instance !== instance);
    this.save();
  }
  save() {
    if (this.file) saveJson(this.file, { failures: this.failures });
  }
}

// ---- presets -----------------------------------------------------------------
// Named bundles of settings, stored by NAME (never by list index) so they work
// across HQPlayers and modes, and resolved against the HQPlayer at apply time.

class PresetStore {
  /**
   * file null = memory only (tests). `validate` checks each stored entry's
   * settings with the same rules as a change; an invalid entry is dropped and
   * logged, and the rest load.
   */
  constructor(file, validate) {
    this.file = file || null;
    this.presets = [];
    if (!this.file) return;
    for (const p of loadList(this.file, "presets")) {
      try {
        if (!p || typeof p.id !== "string" || typeof p.name !== "string") throw new Error("missing id or name");
        this.presets.push(validate ? Object.assign({}, p, { settings: validate(p.settings) }) : p);
      } catch (e) {
        console.error("[hqp] ignoring invalid preset " + JSON.stringify(p && p.name !== undefined ? p.name : p) +
                      " in " + this.file + ": " + e.message);
      }
    }
  }
  list() {
    return this.presets;
  }
  get(id) {
    const p = this.presets.find((x) => x.id === id);
    if (!p) throw new HttpError(404, "unknown preset");
    return p;
  }
  // scope (Rouen, v1.8.85): the HQPlayer and DAC a preset is kept for, or
  // none for one shared by all.
  create(name, settings, scope) {
    const now = new Date().toISOString();
    const p = { id: crypto.randomUUID().slice(0, 8), name: this.checkName(name, undefined, scope || null), settings, createdAt: now, updatedAt: now };
    if (scope) p.scope = scope;
    this.presets.push(p);
    this.save();
    return p;
  }
  update(id, patch) {
    const p = this.get(id);
    const scope = patch.scope !== undefined ? patch.scope || null : p.scope || null;
    if (patch.name !== undefined || patch.scope !== undefined) p.name = this.checkName(patch.name !== undefined ? patch.name : p.name, id, scope);
    if (patch.settings !== undefined) p.settings = patch.settings;
    if (patch.scope !== undefined) {
      if (patch.scope) p.scope = patch.scope;
      else delete p.scope;
    }
    p.updatedAt = new Date().toISOString();
    this.save();
    return p;
  }
  remove(id) {
    this.get(id);
    this.presets = this.presets.filter((x) => x.id !== id);
    this.save();
  }
  /** The presets kept for one DAC become shared ones (it is being removed). */
  unscope(scope) {
    let n = 0;
    for (const p of this.presets) if (p.scope === scope) { delete p.scope; n++; }
    if (n) this.save();
  }
  // Unique among the presets that are ever shown together: a shared one
  // against all, one kept for a DAC against the shared ones and that DAC's
  // own — so two DACs can each have a "Reference" of their own.
  checkName(name, exceptId, scope) {
    const n = String(name || "").trim();
    if (!n || n.length > 64) throw new HttpError(400, "name must be 1–64 characters");
    const together = (x) => !scope || !x.scope || x.scope === scope;
    if (this.presets.some((x) => x.id !== exceptId && together(x) && x.name.toLowerCase() === n.toLowerCase()))
      throw new HttpError(409, 'a preset named "' + n + '" already exists');
    return n;
  }
  save() {
    if (this.file) saveJson(this.file, { presets: this.presets });
  }
}

module.exports = { HttpError, loadList, saveJson, LearnedStore, PresetStore };
