// @ts-check
"use strict";
/*
 * rules.js — who played, sang, wrote and made an album (dev/design/album-credits.md §2, §3), read from what each
 * source said. No asking here: the answers come in as they were given (a file's native tags as music-metadata reads
 * them, MusicBrainz's release JSON, Roon's Credit structs as roon.js reads them) and come out as credits; finder.js
 * asks, store.js keeps. Mandarin's CreditRules.cs (its bug list item 129), ported rule for rule; Roon's is new.
 *
 * A credit is a name and a role on a track (0: the whole album). The album page lists one row a name, its roles in
 * order and the tracks it is on: the players and singers first, then the writers, then those who made the record,
 * then its sleeve.
 */

/**
 * One name's part on a track. track: its place on the album (1 on), 0 for the whole album. mbid: MusicBrainz's id
 * for the name, where MusicBrainz gave it. rank: where a role no list below names comes (§3), from Roon's Type. A
 * track of -1: some the source names otherwise than by number (Wikipedia's "on a song", §2.4), never the whole album.
 * @typedef {{ track: number, name: string, mbid: string | null, role: string, source: "roon" | "musicbrainz" | "wikipedia" | "tags", rank?: number }} Credit
 */
/**
 * One row of the album's credits: its roles, and the tracks it is on (none listed: every one).
 * @typedef {{ key: string, name: string, mbid: string | null, roles: string[], tracks: number[], source: string }} AlbumCredit
 */

/** "drums (drum set)" → "Drums"; "lead vocals" → "Lead vocals". @param {string} s */
function cap(s) {
  const t = String(s || "").replace(/\s*\([^()]*\)/g, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

const str = (/** @type {any} */ v) => (v === null || v === undefined ? "" : String(v).trim());

// ------------------------------------------------------------------------------------------------ the files' own tags

/** The tags that name someone, by the role they give: Vorbis's names, ID3's frames, the end of an iTunes or TXXX name. */
const TAG_ROLES = Object.freeze(/** @type {Record<string, string>} */ ({
  PRODUCER: "Producer", ENGINEER: "Engineer", MIXER: "Mixing", DJMIXER: "DJ mix",
  ARRANGER: "Arranger", REMIXER: "Remixer", TPE4: "Remixer", LYRICIST: "Lyricist", TEXT: "Lyricist",
  WRITER: "Writer", COMPOSER: "Composer", TCOM: "Composer", "©WRT": "Composer",
  CONDUCTOR: "Conductor", TPE3: "Conductor", ENSEMBLE: "Ensemble", ORCHESTRA: "Orchestra",
}));

/** A tag's name as its role is looked up: "----:com.apple.iTunes:PRODUCER" and "TXXX:PRODUCER" → "PRODUCER". @param {string} key */
function tagName(key) {
  const k = String(key || "");
  const at = k.lastIndexOf(":");
  const bare = at >= 0 && (k.startsWith("TXXX") || k.startsWith("----")) ? k.slice(at + 1) : k;
  return bare.toUpperCase();
}

/** "Jerome Augustyniak (drums, percussion)" → the name and its roles; no brackets → a performer. @param {string} value */
function performer(value) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(value);
  if (!m) return { name: value.trim(), roles: ["Performer"] };
  const roles = m[2].split(/\s*(?:,|&|\band\b)\s*/).map(cap).filter(Boolean);
  return { name: m[1].trim(), roles: roles.length ? roles : ["Performer"] };
}

/** "A; B" and "A / B" are two names. @param {string} s */
const names = (s) => String(s).split(/\s*(?:;|\s\/\s)\s*/).map((n) => n.trim()).filter(Boolean);

/**
 * One track's credits from its native tags: music-metadata's `native`, each format's list of { id, value }. An ID3
 * credit list (TMCL, TIPL, IPLS) comes as an object, each role to its names.
 * @param {number} track @param {Record<string, Array<{ id: string, value: any }>> | null | undefined} native
 * @returns {Credit[]}
 */
function fromTags(track, native) {
  /** @type {Credit[]} */
  const list = [];
  const add = (/** @type {string} */ who, /** @type {string} */ role) => {
    for (const n of names(who)) list.push({ track, name: n, mbid: null, role, source: "tags" });
  };
  for (const tags of Object.values(native || {})) {
    for (const t of Array.isArray(tags) ? tags : []) {
      const name = tagName(t && t.id);
      const v = t ? t.value : null;
      if ((name === "TMCL" || name === "TIPL" || name === "IPLS") && v && typeof v === "object" && !Array.isArray(v)) {
        for (const part of Object.keys(v)) {
          for (const who of (Array.isArray(v[part]) ? v[part] : [v[part]]).map(str).filter(Boolean)) add(who, cap(part));
        }
        continue;
      }
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) continue;
      if (name === "PERFORMER") {
        const p = performer(s);
        for (const r of p.roles) add(p.name, r);
      } else if (TAG_ROLES[name]) add(s, TAG_ROLES[name]);
    }
  }
  return list;
}

// ------------------------------------------------------------------------------------------------ MusicBrainz's release

/** What a relation's type is called as a role (the instrument and vocal ones say theirs in their attributes). */
const TYPE_ROLES = Object.freeze(/** @type {Record<string, string>} */ ({
  performer: "Performer", "performing orchestra": "Orchestra", conductor: "Conductor", "chorus master": "Chorus master",
  concertmaster: "Concertmaster", engineer: "Engineer", audio: "Engineer", sound: "Sound engineer",
  recording: "Recording engineer", mix: "Mixing", mastering: "Mastering", balance: "Balance engineer",
  editor: "Editor", programming: "Programming", remixer: "Remixer", "mix-DJ": "DJ mix",
  arranger: "Arranger", "instrument arranger": "Arranger", "vocal arranger": "Vocal arranger", orchestrator: "Orchestrator",
  composer: "Composer", lyricist: "Lyricist", writer: "Writer", librettist: "Librettist", translator: "Translator",
  "design/illustration": "Design", design: "Design", illustration: "Illustration", "graphic design": "Graphic design",
  photography: "Photography", "art direction": "Art direction", "creative direction": "Creative direction", "liner notes": "Liner notes",
}));

/** How a part was played, not what: left off the role. */
const MANNER = new Set(["guest", "solo", "additional", "minor", "original", "founder", "emeritus"]);

/**
 * A relation's roles: the instruments or voices it names, or what its type is called.
 * @param {string} type @param {string[]} attributes @returns {string[]}
 */
function rolesOf(type, attributes) {
  const said = attributes.map(str).filter(Boolean);
  const kinds = [...new Set(said.filter((a) => !MANNER.has(a)).map(cap).filter(Boolean))];
  if (type === "instrument") return kinds.length ? kinds : ["Instruments"];
  if (type === "vocal") return kinds.length ? kinds : ["Vocals"];
  if (type === "producer") {
    return [said.includes("executive") ? "Executive producer" : said.includes("co") ? "Co-producer"
      : said.includes("assistant") ? "Assistant producer" : "Producer"];
  }
  return TYPE_ROLES[type] ? [TYPE_ROLES[type]] : [];
}

/** @param {Credit[]} list @param {number} track @param {any} r */
function addRelation(list, track, r) {
  if (!r || typeof r !== "object" || !r.artist || typeof r.artist !== "object") return;
  const name = str(r["target-credit"]) || str(r.artist.name);
  if (!name) return;
  for (const role of rolesOf(str(r.type), Array.isArray(r.attributes) ? r.attributes : [])) {
    list.push({ track, name, mbid: str(r.artist.id) || null, role, source: "musicbrainz" });
  }
}

const position = (/** @type {any} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * A release's credits (asked with its recordings' and works' relations): the release's own on 0, each track's by its
 * place through the album (disc by disc, in their positions).
 * @param {any} rel @returns {Credit[]}
 */
function fromRelease(rel) {
  /** @type {Credit[]} */
  const list = [];
  if (!rel || typeof rel !== "object") return list;
  for (const r of Array.isArray(rel.relations) ? rel.relations : []) addRelation(list, 0, r);
  let n = 0;
  const media = (Array.isArray(rel.media) ? rel.media : []).slice().sort((a, b) => position(a && a.position) - position(b && b.position));
  for (const m of media) {
    const tracks = (Array.isArray(m && m.tracks) ? m.tracks : []).slice().sort((a, b) => position(a && a.position) - position(b && b.position));
    for (const t of tracks) {
      n++;
      const rec = t && t.recording;
      if (!rec || typeof rec !== "object") continue;
      for (const r of Array.isArray(rec.relations) ? rec.relations : []) {
        addRelation(list, n, r);
        // The work recorded, and its writers.
        if (r && r.work && Array.isArray(r.work.relations)) for (const x of r.work.relations) addRelation(list, n, x);
      }
    }
  }
  return list;
}

/** The acts a release is credited to, with their MusicBrainz ids. @param {any} rel @returns {Array<{ name: string, mbid: string }>} */
function releaseActs(rel) {
  return (rel && Array.isArray(rel["artist-credit"]) ? rel["artist-credit"] : [])
    .map((/** @type {any} */ c) => ({ name: str(c && c.name) || str(c && c.artist && c.artist.name), mbid: str(c && c.artist && c.artist.id) }))
    .filter((/** @type {{ name: string, mbid: string }} */ x) => x.name && x.mbid);
}

/** The tracks a release has, every disc's. @param {any} rel */
const releaseTrackCount = (rel) => (rel && Array.isArray(rel.media) ? rel.media : [])
  .reduce((/** @type {number} */ n, /** @type {any} */ m) => n + (Number(m && m["track-count"]) || (Array.isArray(m && m.tracks) ? m.tracks.length : 0)), 0);

// ------------------------------------------------------------------------------------------------ Roon's

/** Roon's CreditType (the catalogue at 8b67208): its name as a role when Role is empty, and where it ranks (§3). */
const ROON_TYPES = Object.freeze(/** @type {Record<number, { role: string, rank: number }>} */ ({
  0: { role: "Performer", rank: 0 }, 1: { role: "Composer", rank: 1 }, 2: { role: "Conductor", rank: 0 },
  3: { role: "Performer", rank: 0 }, 4: { role: "Performer", rank: 0 }, 5: { role: "Ensemble", rank: 0 }, 6: { role: "Producer", rank: 2 },
}));

/**
 * One track's credits from Roon's (roon.js reads them): its Role as written, its Type, its performer's name.
 * @param {number} track @param {Array<{ role: string | null, type: number | null, name: string | null }>} credits
 * @returns {Credit[]}
 */
function fromRoon(track, credits) {
  /** @type {Credit[]} */
  const list = [];
  for (const c of credits || []) {
    const name = str(c && c.name);
    if (!name) continue;
    const t = typeof c.type === "number" ? ROON_TYPES[c.type] : undefined;
    const role = cap(str(c.role)) || (t ? t.role : "Performer");
    list.push(Object.assign({ track, name, mbid: null, role, source: /** @type {const} */ ("roon") }, t ? { rank: t.rank } : {}));
  }
  return list;
}

// ------------------------------------------------------------------------------------------------ the album's rows

const lower = (/** @type {string[]} */ a) => new Set(a.map((x) => x.toLowerCase()));
const WRITING = lower(["Composer", "Lyricist", "Writer", "Librettist", "Translator"]);
const MAKING = lower(["Producer", "Executive producer", "Co-producer", "Assistant producer", "Engineer", "Sound engineer", "Recording engineer",
  "Mixing", "Mastering", "Balance engineer", "Editor", "Programming", "Remixer", "DJ mix", "Arranger", "Vocal arranger", "Orchestrator",
  "Mix engineer", "Mixing engineer", "Mastering engineer"]);
const ART = lower(["Design", "Illustration", "Graphic design", "Photography", "Art direction", "Creative direction", "Liner notes"]);

// A role written freely (Wikipedia's, v1.9.70-t2) placed by its words, making before the sleeve ("Sound design" is
// making the record); "recorder" the instrument is not recording, the "Lyricon" not lyrics.
const WRITING_WORDS = /\b(compos|lyrics?\b|lyricist|songwrit|writ|librett)/;
const MAKING_WORDS = /\b(produc|engineer|mix|remix|master|recording\b|recorded\b|edit|programm|arrang|orchestrat|sound)/;
const ART_WORDS = /\b(art\b|artwork|design|layout|photo|illustrat|sleeve|liner|cover|packag)/;

/**
 * Where a role comes: players and singers 0, writers 1, those who made the record 2, its sleeve 3; a role none of
 * these names, its source's hint (Roon's Type); else by its words; else 0. @param {string} role @param {number} [hint]
 */
function rank(role, hint) {
  const r = String(role || "").toLowerCase();
  if (WRITING.has(r)) return 1;
  if (MAKING.has(r)) return 2;
  if (ART.has(r)) return 3;
  if (typeof hint === "number") return hint;
  return WRITING_WORDS.test(r) ? 1 : MAKING_WORDS.test(r) ? 2 : ART_WORDS.test(r) ? 3 : 0;
}

/** Which source's spelling of a name wins: your server's, then MusicBrainz's, then Wikipedia's, then the tags'. */
const SOURCE_ORDER = Object.freeze({ roon: 0, musicbrainz: 1, wikipedia: 2, tags: 3 });

/**
 * The credits as the album page lists them: one row a name, the tracks it is on (none: every one of trackCount).
 * @param {Credit[]} credits @param {number} trackCount @param {(name: string) => string} keyOf  how Rouen compares names
 * @returns {AlbumCredit[]}
 */
function merge(credits, trackCount, keyOf) {
  /** @type {Map<string, { name: string, mbid: string | null, roles: string[], ranks: Map<string, number>, tracks: Set<number>, whole: boolean, source: Credit["source"] }>} */
  const rows = new Map();
  for (const c of credits) {
    const key = keyOf(c.name);
    if (!key || !c.role) continue;
    let row = rows.get(key);
    if (!row) { row = { name: c.name, mbid: c.mbid, roles: [], ranks: new Map(), tracks: new Set(), whole: false, source: c.source }; rows.set(key, row); }
    const lc = c.role.toLowerCase();
    if (!row.roles.some((r) => r.toLowerCase() === lc)) { row.roles.push(c.role); row.ranks.set(c.role, rank(c.role, c.rank)); }
    if (c.track === 0) row.whole = true; else if (c.track > 0) row.tracks.add(c.track);
    if (!row.mbid && c.mbid) row.mbid = c.mbid;
    if (SOURCE_ORDER[c.source] < SOURCE_ORDER[row.source]) { row.name = c.name; row.source = c.source; }
  }
  const out = [...rows.entries()].map(([key, r]) => {
    const all = r.whole || (trackCount > 0 && r.tracks.size >= trackCount);
    const roles = r.roles.slice().sort((a, b) => (r.ranks.get(a) || 0) - (r.ranks.get(b) || 0));
    return { key, name: r.name, mbid: r.mbid, roles, tracks: all ? [] : [...r.tracks].sort((a, b) => a - b), source: r.source,
      first: roles.length ? Math.min(...roles.map((x) => r.ranks.get(x) || 0)) : 9 };
  });
  out.sort((a, b) => a.first - b.first
    || (b.tracks.length === 0 ? Infinity : b.tracks.length) - (a.tracks.length === 0 ? Infinity : a.tracks.length)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out.map(({ key, name, mbid, roles, tracks, source }) => ({ key, name, mbid, roles, tracks, source }));
}

module.exports = { cap, tagName, performer, fromTags, rolesOf, fromRelease, releaseActs, releaseTrackCount, fromRoon, rank, merge, ROON_TYPES };
