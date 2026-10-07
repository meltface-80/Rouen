"use strict";
/*
 * backup.js — Backup & restore (v1.8.84, after Mandarin v0.6.14).
 *
 * A backup is one JSON file, rouen-backup-<stamp>.json, holding whichever of
 * these parts were chosen:
 *
 *   settings   every preference saved in settings.json that is not a key, a
 *              playlist or the server's own bookkeeping, plus the HQPlayer
 *              presets and setups (their own files on the data volume)
 *   playlists  your playlists (playlists.json) and the Dynamic Playlists
 *   later      the Listen later list
 *   keys       the Discogs and FanArt.tv keys and the Qobuz/TIDAL sign-ins —
 *              tokens, never a password
 *
 * Never in a backup: caches (playlist art), the waveform analysis stamps, the
 * legacy Qobuz password hash, play history, the library snapshot, the Roon
 * pairing. A backup is for what a person MADE or CHOSE; everything else is
 * rebuilt by the next scan.
 *
 * Settings are classified by DENYING rather than allowing: a preference added
 * later goes into the settings part without anyone remembering to list it
 * here. The risk that runs the other way — a new secret riding in the
 * settings part — is closed by `looksSecret`, which sends any unclassified
 * key named like a token, secret, password or key to the keys part instead.
 *
 * Restoring REPLACES each chosen part: a setting absent from the backup goes
 * back to its default rather than keeping today's value, because "restore"
 * means "as it was then". That is why every restore keeps a "before restore"
 * backup of all four parts first.
 *
 * This module does the pure work and the storage. Reading and writing the
 * live data (settings cache, playlists file, database) is index.js's, which
 * hands it in.
 */
const fs = require("fs");
const path = require("path");

const FORMAT = 1;
const APP = "Rouen";
const PARTS = ["settings", "playlists", "later", "keys"];

// The keys part: what signs this server in somewhere. Tokens, never a password.
const KEY_KEYS = [
  "discogsToken", "fanartKey",
  "qobuzToken", "qobuzUsername", "qobuzDisplayName",
  "qobuzWaveToken", "qobuzWaveUser", "qobuzWaveName",
  "qobuzAppSecret", "qobuzSignAppId", "qobuzSignToken",
  "tidalRefreshToken", "tidalUserId", "tidalCountryCode", "tidalDisplayName",
];
// Kept in settings.json but part of the playlists part.
const PLAYLIST_KEYS = ["smartPlaylists"];
// Never backed up, never restored over: caches and stamps the server keeps for
// itself, and the password hash of a login the app no longer offers.
//
// radioZones is here rather than in settings: it names THIS Core's zone ids,
// and index.js keeps a second copy in Roon's own config that it falls back to
// whenever the set is empty — so "restored to none" would read back today's
// zones on the next start, and a backup taken against another Core would
// name zones that do not exist.
const NEVER_KEYS = ["playlistArt", "waveformAnalysis", "waveformRate", "qobuzPasswordMd5", "radioZones"];
// Not backed up, but cleared when the keys are restored: the hash belongs to
// the Qobuz username it was saved with, and keeping today's beside a restored
// username would log in as one account with another's password.
const CLEAR_WITH_KEYS = ["qobuzPasswordMd5"];
// The HQPlayer files that are a person's own work (the learned failures are
// the app's record of HQPlayer, not a choice, and are left alone).
const SETTINGS_FILES = ["hqp-presets.json", "hqp-setup.json"];

const looksSecret = k => /token|secret|password|passwd|md5|apikey|key$/i.test(k);

function classify(k) {
  if (NEVER_KEYS.includes(k)) return "never";
  if (KEY_KEYS.includes(k)) return "keys";
  if (PLAYLIST_KEYS.includes(k)) return "playlists";
  if (looksSecret(k)) return "keys";
  return "settings";
}

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

/* Which parts a request asked for: a known name, once each, in canonical order. */
function partsFrom(v) {
  const want = Array.isArray(v) ? v.map(String) : PARTS;
  return PARTS.filter(p => want.includes(p));
}

const pick = (obj, part) => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (classify(k) === part && v !== undefined) out[k] = v;
  return out;
};

/*
 * A backup of `parts` from the live data:
 *   live = { settings, userPlaylists, later, files: { name: parsed|undefined }, version }
 */
function build(live, parts, kind, now) {
  const t = now || new Date();
  const b = {
    app: APP, format: FORMAT, version: String(live.version || ""),
    created: t.toISOString(), kind: kind || "manual", parts: partsFrom(parts),
  };
  const s = live.settings || {};
  if (b.parts.includes("settings")) {
    b.settings = pick(s, "settings");
    const files = {};
    for (const f of SETTINGS_FILES) if (live.files && live.files[f] !== undefined) files[f] = live.files[f];
    b.settingsFiles = files;
  }
  if (b.parts.includes("playlists")) {
    b.playlists = {
      user: Array.isArray(live.userPlaylists) ? live.userPlaylists : [],
      smart: Array.isArray(s.smartPlaylists) ? s.smartPlaylists : [],
    };
  }
  if (b.parts.includes("later")) b.later = Array.isArray(live.later) ? live.later : [];
  if (b.parts.includes("keys")) b.keys = pick(s, "keys");
  return b;
}

/*
 * A backup read back from text (a stored file or an upload). Throws an Error
 * with a message fit to show when it is not one; otherwise returns it with
 * `parts` reduced to the parts it actually carries.
 */
function parse(text) {
  let b;
  try { b = JSON.parse(String(text || "")); } catch (e) { throw new Error("That file is not a Rouen backup."); }
  if (!isObj(b) || (b.app !== APP && b.app !== "MusicD Remote")) throw new Error("That file is not a Rouen backup.");
  if (!Number.isInteger(b.format) || b.format < 1) throw new Error("That file is not a Rouen backup.");
  if (b.format > FORMAT) throw new Error("That backup was made by a newer Rouen. Update first, then restore it.");
  const has = {
    settings: isObj(b.settings),
    playlists: isObj(b.playlists),
    later: Array.isArray(b.later),
    keys: isObj(b.keys),
  };
  b.parts = PARTS.filter(p => has[p]);
  if (!b.parts.length) throw new Error("That backup holds nothing to restore.");
  return b;
}

/*
 * What restoring `parts` of `b` over `current` (the live settings object)
 * produces. Pure: returns
 *   { settings, userPlaylists?, later?, files? }
 * where `settings` is the whole new settings object, and the others are
 * present only when their part is being restored (files: name → value, or
 * null for "remove").
 */
function plan(b, parts, current) {
  const doing = partsFrom(parts).filter(p => b.parts.includes(p));
  const next = Object.assign({}, current || {});
  const out = { parts: doing };
  const replace = (part, from) => {
    for (const k of Object.keys(next)) if (classify(k) === part) delete next[k];
    for (const [k, v] of Object.entries(from || {})) if (classify(k) === part && v !== undefined) next[k] = v;
  };
  if (doing.includes("settings")) {
    replace("settings", b.settings);
    out.files = {};
    const files = isObj(b.settingsFiles) ? b.settingsFiles : {};
    for (const f of SETTINGS_FILES) out.files[f] = isObj(files[f]) ? files[f] : null;
  }
  if (doing.includes("keys")) {
    replace("keys", b.keys);
    for (const k of CLEAR_WITH_KEYS) delete next[k];
  }
  if (doing.includes("playlists")) {
    const smart = Array.isArray(b.playlists.smart) ? b.playlists.smart : [];
    if (smart.length) next.smartPlaylists = smart; else delete next.smartPlaylists;
    out.userPlaylists = Array.isArray(b.playlists.user) ? b.playlists.user : [];
  }
  if (doing.includes("later")) out.later = b.later;
  out.settings = next;
  return out;
}

/* ---------------------------------------------------------------- storage */

const KEEP = { manual: 10, before: 5 };
const ID_RE = /^rouen-(backup|before-restore)-\d{8}-\d{6}(-\d+)?$/;

const pad = n => String(n).padStart(2, "0");
function stamp(t) {
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-` +
         `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this._meta = new Map();   // file name → { mtimeMs, meta }: a list reads each file once
  }

  static validId(id) { return typeof id === "string" && ID_RE.test(id); }

  file(id) { return path.join(this.dir, id + ".json"); }

  // Newest first. A file that cannot be read is listed as such rather than
  // hidden, so it can still be deleted.
  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (e) { return []; }   // no backups yet
    const out = [];
    for (const n of names) {
      const id = n.replace(/\.json$/, "");
      if (n === id || !Store.validId(id)) continue;
      let st;
      try { st = fs.statSync(path.join(this.dir, n)); } catch (e) { continue; }   // deleted under us
      const hit = this._meta.get(n);
      let meta = hit && hit.mtimeMs === st.mtimeMs ? hit.meta : null;
      if (!meta) {
        try {
          const b = parse(fs.readFileSync(path.join(this.dir, n), "utf8"));
          meta = { created: b.created, kind: ["before-restore", "uploaded"].includes(b.kind) ? b.kind : "manual",
                   version: b.version || "", parts: b.parts };
        } catch (e) {
          meta = { created: new Date(st.mtimeMs).toISOString(), kind: id.startsWith("rouen-before") ? "before-restore" : "manual",
                   version: "", parts: [], error: e.message };
        }
        this._meta.set(n, { mtimeMs: st.mtimeMs, meta });
      }
      out.push(Object.assign({ id, size: st.size }, meta));
    }
    // By when it was STORED (the stamp in its name), not when it was made: a
    // backup brought in from a file may be old, and ordering by its own date
    // would put it straight past the ten kept and prune it on arrival.
    const at = id => { const m = /(\d{8}-\d{6})(?:-(\d+))?$/.exec(id); return m ? m[1] + "-" + pad(m[2] || 1) : ""; };
    out.sort((a, b) => { const x = at(a.id), y = at(b.id); return x < y ? 1 : x > y ? -1 : 0; });
    return out;
  }

  // Writes `b` and returns its id. Atomic: a crash mid-write leaves no
  // half-file that the list would then report as broken.
  // `keep`: an id prune must not remove — the backup a restore is reading,
  // which is the OLDEST before-restore copy exactly when restoring the oldest.
  save(b, now, keep) {
    fs.mkdirSync(this.dir, { recursive: true });
    const base = `rouen-${b.kind === "before-restore" ? "before-restore" : "backup"}-${stamp(now || new Date())}`;
    let id = base;
    for (let i = 2; fs.existsSync(this.file(id)); i++) id = `${base}-${i}`;
    const tmp = this.file(id) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(b));
    fs.renameSync(tmp, this.file(id));
    this.prune(keep);
    return id;
  }

  read(id) {
    if (!Store.validId(id)) throw new Error("No such backup.");
    let text;
    try { text = fs.readFileSync(this.file(id), "utf8"); } catch (e) { throw new Error("No such backup."); }
    return { text, backup: parse(text) };
  }

  remove(id) {
    if (!Store.validId(id)) return false;
    try { fs.unlinkSync(this.file(id)); } catch (e) { return false; }
    this._meta.delete(id + ".json");
    return true;
  }

  // The last ten of your own (made here or brought in from a file), and the
  // last five kept before a restore — counted apart, so a run of restores
  // never pushes out a backup you made.
  prune(keep) {
    const all = this.list().filter(b => b.id !== keep);
    const mine = all.filter(b => b.kind !== "before-restore");
    const before = all.filter(b => b.kind === "before-restore");
    for (const b of mine.slice(KEEP.manual)) this.remove(b.id);
    for (const b of before.slice(KEEP.before)) this.remove(b.id);
  }
}

module.exports = { FORMAT, PARTS, KEY_KEYS, NEVER_KEYS, CLEAR_WITH_KEYS, PLAYLIST_KEYS, SETTINGS_FILES, KEEP,
                   classify, partsFrom, build, parse, plan, stamp, Store };
