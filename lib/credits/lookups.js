// @ts-check
"use strict";
/*
 * lookups.js — what the outside sources say, read (dev/design/album-credits.md §2.3, §5): which MusicBrainz release
 * is an album's when its files name none, and where a credited name's picture is. No asking here either: the
 * answers come in as MusicBrainz, Wikidata, FanArt.tv and Deezer gave them; finder.js and acts.js ask. Mandarin's
 * CreditRules.cs (FoundMbid, WikidataId, WikidataPhoto, FanartPhoto, DeezerPhoto), ported; the release search is
 * Rouen's own (Mandarin takes its identification scan's match).
 */

const str = (/** @type {any} */ v) => (v === null || v === undefined ? "" : String(v).trim());
const isMbid = (/** @type {any} */ s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** A search term as MusicBrainz's Lucene query takes it in quotes. @param {string} s */
const quote = (s) => String(s || "").replace(/[\\"]/g, " ").trim();

/** The release search for an album: its title and its artist. @param {string} title @param {string} artist */
function releaseQuery(title, artist) {
  const q = `release:"${quote(title)}"` + (artist ? ` AND artist:"${quote(artist)}"` : "");
  return "release/?query=" + encodeURIComponent(q) + "&limit=25";
}

/** A release's artist credit as one line ("A & B"). @param {any} rel */
const creditLine = (rel) => (Array.isArray(rel && rel["artist-credit"]) ? rel["artist-credit"] : [])
  .map((/** @type {any} */ c) => str(c && c.name) + str(c && c.joinphrase)).join("").trim();

/**
 * The album's release from a search, taken only when its title, its artist and its track count are the album's
 * (§2.3): none that agrees on all three, null.
 * @param {any} search  MusicBrainz's answer to releaseQuery
 * @param {{ title: string, artist: string, tracks: number }} album  tracks: as Roon gives them
 * @param {(title: string, artist: string) => string | null} keyOf  Rouen's album key (lib/albumkeys.js's rules)
 * @returns {string | null}  the release's MusicBrainz id
 */
function pickRelease(search, album, keyOf) {
  const want = keyOf(album.title, album.artist);
  if (!want || !(album.tracks > 0)) return null;
  for (const r of Array.isArray(search && search.releases) ? search.releases : []) {
    if (!isMbid(r && r.id)) continue;
    if (Number(r["track-count"]) !== album.tracks) continue;
    if (keyOf(str(r.title), creditLine(r)) === want) return r.id;
  }
  return null;
}

/**
 * The act on a name search: the first whose name is the one asked (a leading "The" aside).
 * @param {any} search @param {string} name @param {(name: string) => string} keyOf  how Rouen compares artist names
 * @returns {string | null}
 */
function foundMbid(search, name, keyOf) {
  const want = keyOf(name);
  if (!want) return null;
  const act = (Array.isArray(search && search.artists) ? search.artists : []).find((/** @type {any} */ a) => keyOf(str(a && a.name)) === want);
  return act && isMbid(act.id) ? act.id : null;
}

/** An artist asked with its URL relations: its Wikidata link, an ended one passed over. @param {any} artist */
function wikidataLink(artist) {
  for (const r of Array.isArray(artist && artist.relations) ? artist.relations : []) {
    if (str(r && r.type) === "wikidata" && !r.ended && r.url && str(r.url.resource)) return str(r.url.resource);
  }
  return null;
}

/** "https://www.wikidata.org/wiki/Q11649" → "Q11649". @param {string | null} url */
function wikidataId(url) {
  const m = url ? /(Q[0-9]+)\/?$/.exec(url) : null;
  return m ? m[1] : null;
}

const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/";

/** Wikidata's picture of the act (P18), as Wikimedia Commons serves it 640 wide; null without one. @param {any} data @param {string} q */
function wikidataPhoto(data, q) {
  // An item since merged comes back under its new id: the one entity there.
  const all = (data && data.entities) || {};
  const e = all[q] || Object.values(all)[0];
  const claims = e && e.claims;
  for (const c of Array.isArray(claims && claims.P18) ? claims.P18 : []) {
    const file = str(c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value);
    if (file) return COMMONS + encodeURIComponent(file.replace(/ /g, "_")) + "?width=640";
  }
  return null;
}

/** FanArt.tv's first portrait of the act (its artist thumbs). @param {any} data */
function fanartPhoto(data) {
  const t = (Array.isArray(data && data.artistthumb) ? data.artistthumb : []).find((/** @type {any} */ x) => str(x && x.url));
  return t ? str(t.url) : null;
}

/**
 * Deezer's picture of the act on a name search: the first of that name with a picture of its own (Deezer's blank
 * has no id in its address). @param {any} search @param {string} name @param {(name: string) => string} keyOf
 */
function deezerPhoto(search, name, keyOf) {
  const want = keyOf(name);
  for (const x of Array.isArray(search && search.data) ? search.data : []) {
    if (!want || keyOf(str(x && x.name)) !== want) continue;
    const u = str(x.picture_xl) || str(x.picture_big);
    if (u && !u.includes("/artist//")) return u;
  }
  return null;
}

/**
 * A band's members now (dev/design/album-credits.md §7): its "member of band" relations from the members' side, a
 * member current when a stint of theirs has no end date and isn't marked ended, their parts that stint's (how it was
 * played left off, as the credits' are). In MusicBrainz's order, each once.
 * @param {any} artist  MusicBrainz's artist, asked with its artist relations
 * @param {(type: string, attributes: string[]) => string[]} rolesOf  rules.js's
 * @param {(name: string) => string} keyOf  how Rouen compares names
 * @returns {Array<{ name: string, mbid: string | null, roles: string[] }>}
 */
function currentMembers(artist, rolesOf, keyOf) {
  /** @type {Map<string, { name: string, mbid: string | null, roles: string[] }>} */
  const out = new Map();
  for (const r of Array.isArray(artist && artist.relations) ? artist.relations : []) {
    if (str(r && r.type) !== "member of band" || str(r.direction) !== "backward" || !r.artist) continue;
    if (r.ended || str(r.end)) continue;
    const name = str(r["target-credit"]) || str(r.artist.name);
    const k = isMbid(r.artist.id) ? r.artist.id : keyOf(name);
    if (!name || !k) continue;
    const roles = rolesOf("instrument", Array.isArray(r.attributes) ? r.attributes : []).filter((x) => x !== "Instruments");
    const had = out.get(k);
    if (had) { for (const x of roles) if (!had.roles.includes(x)) had.roles.push(x); continue; }
    out.set(k, { name, mbid: isMbid(r.artist.id) ? r.artist.id : null, roles });
  }
  return [...out.values()];
}

module.exports = { currentMembers, isMbid, releaseQuery, pickRelease, creditLine, foundMbid, wikidataLink, wikidataId, wikidataPhoto, fanartPhoto, deezerPhoto, COMMONS };
