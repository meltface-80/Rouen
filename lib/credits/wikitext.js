// @ts-check
"use strict";
/*
 * wikitext.js — what a Wikipedia article's wikitext says of who made a record and who is in a band
 * (dev/design/album-credits.md §2.4, §7, v1.9.70-t2). No asking here: the article's wikitext comes in as
 * `action=parse&prop=wikitext` gave it; wikipedia.js asks. Read: an infobox's fields, a section by its heading, its
 * bullet lines as "Name – part, part (tracks 1–3)", and how many tracks its track listing has.
 */

const str = (/** @type {any} */ v) => (v === null || v === undefined ? "" : String(v));

/** Templates read as their text: as their first argument, their second, or all of them a line each. */
const FIRST = new Set(["small", "smaller", "big", "nowrap", "nobr", "nobreak", "abbr", "sc", "smallcaps", "ill", "interlanguage link",
  "interlanguage link multi", "nowrap begin", "lang-en", "transl", "korean", "nihongo"]);
const SECOND = new Set(["lang", "langx"]);
const LIST = new Set(["flatlist", "plainlist", "hlist", "ubl", "unbulleted list", "flat list", "plain list", "bulleted list", "blist",
  "cslist", "unbulleted", "columns-list", "columns list", "col-list", "multicol", "div col"]);
const DASHES = Object.freeze(/** @type {Record<string, string>} */ ({ snd: " – ", "spaced ndash": " – ", "spaced en dash": " – ", dash: " – ",
  ndash: "–", "en dash": "–", mdash: "—", "em dash": "—", "spaced mdash": " — ", nbsp: " ", "&nbsp;": " " }));

/** One template, its braces gone and nothing nested left in it, as text. @param {string} inner */
function template(inner) {
  const args = inner.split("|");
  const name = str(args.shift()).trim().toLowerCase().replace(/_/g, " ");
  const pos = args.map((a) => a.replace(/^\s*1\s*=/, "")).filter((a) => !/^\s*[a-z_][a-z0-9_ -]*\s*=/i.test(a));
  if (name in DASHES) return DASHES[name];
  if (name === "sortname") return pos.slice(0, 2).map((a) => a.trim()).join(" ");
  if (FIRST.has(name)) return str(pos[0]);
  if (SECOND.has(name)) return str(pos[1]);
  if (LIST.has(name)) return "\n" + pos.join("\n") + "\n";
  return "";
}

/** Comments dropped: one may sit anywhere, on an infobox's first line or after a heading among them (the review). @param {any} s */
const uncomment = (s) => str(s).replace(/<!--[\s\S]*?-->/g, "");

// A link's shown text keeps its commas, ampersands and "and" through the splitting of names and parts
// ("[[Earth, Wind & Fire]]" and "[[Harry Connick, Jr.]]" are one name each, the review): held as private characters
// until then, and given back by restore().
const HELD = Object.freeze(/** @type {Record<string, string>} */ ({ ",": "", "&": "", " and ": "  " }));
const hold = (/** @type {string} */ s) => s.replace(/,|&| and /g, (c) => HELD[c]);
const restore = (/** @type {string} */ s) => s.replace(//g, ",").replace(//g, "&").replace(//g, "and");

/** The text as it shows, links' separators held. @param {string} s */
function flatten(s) {
  let t = uncomment(s).replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "");
  for (let i = 0; i < 50; i++) {
    const before = t;
    t = t.replace(/\[\[([^[\]]*)\]\]/g, (_, l) => (/^\s*:?\s*(file|image|category|media)\s*:/i.test(l) ? "" : hold(l.split("|").pop().replace(/#.*$/, ""))));
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => template(inner));
    if (t === before) break;
  }
  return t.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1").replace(/\[https?:\/\/[^\]]*\]/g, "").replace(/'{2,}/g, "")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&amp;/g, "&")
    .replace(/[ \t ]+/g, " ");
}

/**
 * Wikitext as the text it shows: links as their shown text (files' and categories' dropped), references, notes
 * and comments dropped, the templates above as their text and every other one dropped, bold and italics gone.
 * Line breaks kept. @param {string} s
 */
const clean = (s) => restore(flatten(s));

/** Where a template opening at `from` closes (after its last brace), counting the braces nested in it. @param {string} s @param {number} from */
function closeOf(s, from) {
  let depth = 0;
  for (let i = from; i < s.length - 1; i++) {
    if (s[i] === "{" && s[i + 1] === "{") { depth++; i++; } else if (s[i] === "}" && s[i + 1] === "}") { depth--; i++; if (depth === 0) return i + 1; }
  }
  return s.length;
}

/**
 * An infobox's fields as written (each value's wikitext, comments dropped), its names lower-cased; null without one.
 * @param {string} wikitext @param {string[]} kinds  its template's names ("album"; "musical artist", "band")
 * @returns {Record<string, string> | null}
 */
function infobox(wikitext, kinds) {
  const text = uncomment(wikitext);
  const m = new RegExp("\\{\\{\\s*infobox[ _]+(?:" + kinds.map((k) => k.replace(/ /g, "[ _]+")).join("|") + ")\\s*(?=\\||\\}|\\n)", "i").exec(text);
  if (!m) return null;
  const body = text.slice(m.index + 2, closeOf(text, m.index) - 2);
  /** @type {Record<string, string>} */
  const fields = {};
  let depth = 0, cur = "";
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth++; cur += two; i++; continue; }
    if ((two === "}}" || two === "]]") && depth > 0) { depth--; cur += two; i++; continue; }
    if (body[i] === "|" && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += body[i];
  }
  parts.push(cur);
  for (const p of parts.slice(1)) {
    const at = p.indexOf("=");
    if (at > 0) fields[p.slice(0, at).trim().toLowerCase().replace(/\s+/g, "_")] = p.slice(at + 1).trim();
  }
  return fields;
}

/**
 * The first section whose heading is one of `names` (as its text shows, case aside), to the next heading of its
 * level or above; null without one. @param {string} wikitext @param {RegExp} names @returns {string | null}
 */
function section(wikitext, names) {
  const lines = uncomment(wikitext).split("\n");
  const head = (/** @type {string} */ l) => /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(l);
  for (let i = 0; i < lines.length; i++) {
    const h = head(lines[i]);
    if (!h || !names.test(clean(h[2]).trim())) continue;
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      const n = head(lines[j]);
      if (n && n[1].length <= h[1].length) break;
      out.push(lines[j]);
    }
    return out.join("\n");
  }
  return null;
}

/**
 * A section's lines in their groups: each heading, `;heading`, bold line or short line of its own starts a group,
 * its bullet lines under it; a longer line of prose starts none (the review). Items keep their links' separators
 * held. @param {string} text @returns {Array<{ head: string, items: string[] }>}
 */
function groups(text) {
  /** @type {Array<{ head: string, items: string[] }>} */
  const out = [{ head: "", items: [] }];
  const marked = uncomment(text).replace(/^[ \t]*'''([^'\n]+?)'''[ \t]*:?[ \t]*$/gm, ";$1");
  for (const raw of flatten(marked).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[*#]+\s*(.*)$/.exec(line);
    if (bullet) { if (bullet[1].trim()) out[out.length - 1].items.push(bullet[1].trim()); continue; }
    if (/^[;=]/.test(line) || line.split(/\s+/).length <= 6) out.push({ head: restore(line.replace(/^[=;:\s]+|[=:\s]+$/g, "")), items: [] });
  }
  return out.filter((g) => g.items.length);
}

/** A run of years ("1981–present", "1984–1992"), dropped from names and parts, never a dash between them. */
const YEARS_RE = /\b\d{4}\s*[–—-]\s*(?:\d{2,4}|present)\b/gi;

/** "drums (tracks 1–3)" → "Drums"; brackets, years and a song named after it dropped, the first letter capitalised. @param {string} s */
function part(s) {
  const t = restore(s).replace(/\s*\([^()]*\)/g, "").replace(YEARS_RE, "").replace(/\s+(on|in|for|during|from)\b[^"“]*["“].*$/i, "")
    .replace(/["“”]/g, "").replace(/^\s*(on|for)\s+.*$/i, "").trim().replace(/[.:;,]+$/, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

const TRACKS_RE = /\btracks?:?\s+(\d+(?:\s*(?:,\s*(?:and|&)|,|–|—|-|&|\band\b|\bto\b)\s*\d+)*)/i;

/**
 * The tracks a bracket or a phrase names: their numbers; "some" when it names them otherwise (a song, "except", a
 * disc, a side); null when it names none (the whole album). @param {string} said @returns {number[] | "some" | null}
 */
function tracksOf(said) {
  if (!said) return null;
  if (/\ball tracks\b/i.test(said) && !/except|but\b/i.test(said)) return null;
  const m = TRACKS_RE.exec(said);
  if (m && !/except|\bbut\b|disc|\bcd\b|side|bonus/i.test(said)) {
    /** @type {number[]} */
    const out = [];
    for (const piece of m[1].split(/\s*(?:,\s*(?:and|&)|,|&|\band\b)\s*/i)) {
      const r = /^(\d+)\s*(?:–|—|-|\bto\b)\s*(\d+)$/i.exec(piece.trim());
      if (r) { for (let n = Number(r[1]); n <= Number(r[2]) && n - Number(r[1]) < 99; n++) out.push(n); } else if (/^\d+$/.test(piece.trim())) out.push(Number(piece));
    }
    return out.length ? out : "some";
  }
  // A song named ("on "Song"") is some tracks; a name in quotes otherwise ("credited as "Johnny"") is not.
  return /track|song|except|disc|side/i.test(said) || /^\s*(?:(?:on|in|from|for)\s+)?["“]/i.test(said) ? "some" : null;
}

/** A string split on its separators outside brackets. @param {string} s @param {RegExp} sep  matched at each place */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (depth === 0) {
      sep.lastIndex = i;
      const m = sep.exec(s);
      if (m && m.index === i) { out.push(cur); cur = ""; i += m[0].length - 1; continue; }
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const NOT_A_NAME = /\b(recorded|mixed|mastered|released|produced|engineered|written|credits?|adapted|liner|personnel|musicians|production|technical|additional|tracks?|disc|side|studios?|producers?|engineers?|engineering|mastering|mixing|photography|design|artwork)\b|https?:|["“”]/i;

/** "A and B" → the names it gives, each looked over; "Jr." and the like stay with the name before. @param {string} s */
function namesOf(s) {
  /** @type {string[]} */
  const pieces = [];
  for (const n of splitTop(s.replace(/\s*\([^()]*\)/g, "").replace(YEARS_RE, ""), /\s*,\s*|\s+and\s+|\s*&\s*/y)) {
    if (pieces.length && /^(jr|sr)\.?$|^[ivx]+$/i.test(n.trim())) pieces[pieces.length - 1] += ", " + n.trim(); else pieces.push(n);
  }
  return pieces.map((n) => restore(n).replace(/^[\s,]+|[\s,:]+$/g, "").replace(/(?<!\b(?:Jr|Sr|[A-Z]))\.$/, ""))
    .filter((n) => n.length > 1 && n.length <= 60 && n.split(/\s+/).length <= 6 && /\p{L}/u.test(n) && !NOT_A_NAME.test(n));
}

/** A line written part first ("Producer: Rick Rubin", "Mastering – Howie Weinberg"): its part, as said. */
const PART_FIRST = /^(?:(?:executive |co-|assistant |additional )?producers?|produced by|(?:recording |mixing |mastering |assistant )?engineers?|engineered by|engineering|recording|recorded by|mixing|mixed by|mix|mastering|mastered by|photography|photographs?|photographer|photos? by|design|designed by|art direction|artwork|cover art|cover|layout|illustrations?|arrangements?|arranged by|arranger|liner notes|programming|string arrangements?)$/i;

// A part of one word that says how ("lead and backing vocals"): the next part's last word is its own (the review).
const MANNER = /^(lead|backing|rhythm|acoustic|electric|additional|harmony|slide|bass|steel|classical|twelve-string|12-string|fretless|upright|tenor|baritone|alto|soprano|lap steel)$/i;

/**
 * A bullet line as a credit: "Name – part, part (tracks 1–3)" (an en or em dash, a spaced hyphen or a colon), or one
 * written part first ("Producer: Rick Rubin"); null for a line with none. @param {string} line
 * @returns {{ names: string[], parts: Array<{ role: string, tracks: number[] | "some" | null }> } | null}
 */
function creditLine(line) {
  // The dash looked for outside brackets and runs of years: "(1981–present)" and "2013–present" are not one.
  const masked = line.replace(/\([^()]*\)/g, (b) => "(" + "x".repeat(b.length - 2) + ")").replace(YEARS_RE, (y) => "x".repeat(y.length));
  const m = /\s*[–—]\s*|\s+-\s+|:\s+/.exec(masked);
  if (!m || !m.index) return null;
  let left = line.slice(0, m.index), right = line.slice(m.index + m[0].length);
  const first = restore(left).trim().replace(/:$/, "");
  if (PART_FIRST.test(first)) { const names = namesOf(right); return names.length ? { names, parts: [{ role: part(first.replace(/\s+by$/i, "")), tracks: null }] } : null; }
  const names = namesOf(left);
  if (!names.length) return null;
  right = right
    .replace(/\s+on\s+(all\s+tracks\s+(?:except|but)\s+(?:tracks?\s+)?\d+(?:\s*(?:,|&|\band\b|–|-)\s*\d+)*)/gi, " ($1)")
    .replace(/\s+on\s+((?:all\s+)?tracks?:?\s+\d+(?:\s*(?:,\s*(?:and|&)|,|–|—|-|&|\band\b|\bto\b)\s*\d+)*|all tracks)/gi, " ($1)")
    .replace(/\s+on\s+(["“][^"”]*["”](?:\s*(?:,|and)\s*["“][^"”]*["”])*)/gi, " ($1)");
  const chunks = splitTop(right, /\s*[,;]\s*|\s+and\s+|\s*&\s*|\s+\/\s+/y);
  for (let i = chunks.length - 2; i >= 0; i--) {
    const bare = chunks[i].replace(/\s*\([^()]*\)/g, "").trim();
    const next = chunks[i + 1].replace(/\s*\([^()]*\)/g, "").trim().split(/\s+/).pop() || "";
    if (MANNER.test(bare) && next && !MANNER.test(next)) chunks[i] = chunks[i].replace(bare, bare + " " + next);
  }
  /** @type {Array<{ role: string, tracks: number[] | "some" | null }>} */
  const parts = [];
  for (const chunk of chunks) {
    const role = part(chunk);
    if (!role || role.length > 50 || /^\d{4}/.test(role)) continue;
    const brackets = [...chunk.matchAll(/\(([^()]*)\)/g)].map((b) => b[1]).join("; ");
    const quoted = /["“]/.test(chunk.replace(/\([^()]*\)/g, ""));
    parts.push({ role, tracks: quoted ? "some" : tracksOf(brackets) });
  }
  return { names, parts };
}

/**
 * An album article's Personnel as credits: each name's parts on the tracks the line names (0: the whole album; -1:
 * some it names otherwise, §2.4). @param {string} wikitext
 * @returns {Array<{ track: number, name: string, mbid: null, role: string, source: "wikipedia" }>}
 */
function personnel(wikitext) {
  const text = section(wikitext, /^(personnel|credits|personnel and credits|credits and personnel|musicians|personnel and production)$/i);
  /** @type {Array<{ track: number, name: string, mbid: null, role: string, source: "wikipedia" }>} */
  const out = [];
  if (text === null) return out;
  for (const g of groups(text)) {
    for (const item of g.items) {
      const c = creditLine(item);
      if (!c) continue;
      for (const name of c.names) {
        for (const p of c.parts) {
          const tracks = p.tracks === null ? [0] : p.tracks === "some" ? [-1] : p.tracks;
          for (const track of tracks) out.push({ track, name, mbid: null, role: p.role, source: "wikipedia" });
        }
      }
    }
  }
  return out;
}

/**
 * How many tracks an album article lists: its `{{Track listing}}` templates' titles, else its Track listing
 * section's numbered lines; 0 when it lists none. @param {string} wikitext
 */
function trackCount(wikitext) {
  const n = (uncomment(wikitext).match(/^\s*\|\s*title\d+\s*=\s*\S/gim) || []).length;
  if (n) return n;
  const text = section(wikitext, /^(track ?listing|songs|track list)$/i);
  return text === null ? 0 : (text.match(/^#(?![#*:])/gm) || []).length;
}

/** The first line of a field's text. @param {string | undefined} v */
const firstLine = (v) => clean(str(v)).split("\n").map((x) => x.replace(/^[*\s]+/, "").trim()).find(Boolean) || "";

/** An album article's infobox: the album's name and artist as it shows them; null without one. @param {string} wikitext */
function albumInfo(wikitext) {
  const f = infobox(wikitext, ["album"]);
  return f ? { name: firstLine(f.name), artist: firstLine(f.artist) } : null;
}

/**
 * A band article's infobox ({{Infobox musical artist}}, or {{Infobox band}} that redirects to it): whether it says
 * it is a group's, or a person's, its name, and its members' names now (its `members` field, or the older
 * `current_members`); null without one. @param {string} wikitext
 */
function bandInfo(wikitext) {
  const f = infobox(wikitext, ["musical artist", "band"]);
  if (!f) return null;
  const members = flatten(str(f.members || f.current_members)).split(/\n|,|•|·/).map((x) => restore(x).replace(/^[*\s]+/, "").trim())
    .filter((n) => n.length > 1 && n.length <= 60 && /\p{L}/u.test(n));
  const bg = str(f.background);
  return { group: /group|band|ensemble/i.test(bg), person: /solo|instrumentalist|non[_ ]performing|person/i.test(bg), name: firstLine(f.name), members };
}

/**
 * A band article's members now from its Members section: the lines of its current group (a heading, `;heading` or
 * bold line saying "current" or "present", not its touring, session or guest players), with their parts, years
 * dropped; null when it has no such group. @param {string} wikitext @returns {Array<{ name: string, roles: string[] }> | null}
 */
function membersNow(wikitext) {
  const text = section(wikitext, /^((band )?members|line-?ups?|(band )?personnel)$/i);
  if (text === null) return null;
  const now = groups(text).filter((g) => /\b(current|present)\b/i.test(g.head) && !/touring|session|live|guest|additional|support|former|past/i.test(g.head));
  if (!now.length) return null;
  /** @type {Array<{ name: string, roles: string[] }>} */
  const out = [];
  for (const item of now.flatMap((g) => g.items)) {
    const c = creditLine(item) || { names: namesOf(item), parts: [] };
    for (const name of c.names) if (!out.some((o) => o.name === name)) out.push({ name, roles: c.parts.map((p) => p.role) });
  }
  return out;
}

module.exports = { clean, infobox, section, groups, creditLine, tracksOf, personnel, trackCount, albumInfo, bandInfo, membersNow };
