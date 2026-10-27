// @ts-check
"use strict";
/*
 * wikipedia.js — an album's or a band's English Wikipedia article, found and read (dev/design/album-credits.md
 * §2.4, §7, v1.9.70-t2): the album's by a search its infobox must agree with, the band's by its Wikidata item's
 * link or a search, each read as wikitext for wikitext.js to read. Two articles that both agree are no answer
 * unless the album's track count tells them apart (a self-titled album, two bands of one name: the review). Errors
 * other than "no such article", an answer that can't be read among them, are thrown, for the caller to count as
 * failed and ask again the next day.
 */
const { personnel, albumInfo, bandInfo, membersNow, trackCount } = require("./wikitext");
const { albumPageTitleMatches, stripDisambiguator } = require("../wiki-match");

const API = "https://en.wikipedia.org/w/api.php";
const READ_MAX = 3;

/**
 * @param {{ json: (url: string, headers?: Record<string, string>) => Promise<any>, userAgent: string }} deps
 */
function createWikipedia(deps) {
  /** @param {string} q */
  const ask = (q) => deps.json(`${API}?${q}&format=json&formatversion=2`, { "User-Agent": deps.userAgent });

  /** The titles a search finds. @param {string} q @returns {Promise<string[]>} */
  async function search(q) {
    const d = await ask("action=query&list=search&srlimit=5&srsearch=" + encodeURIComponent(q));
    if (d && d.error) throw new Error("Wikipedia: " + String(d.error.info || d.error.code));
    if (!d || !d.query || !Array.isArray(d.query.search)) throw new Error("Wikipedia: a search's answer that can't be read");
    return d.query.search.map((/** @type {any} */ x) => String((x && x.title) || "")).filter(Boolean);
  }

  /** An article's wikitext, its redirects followed; null when there is no such article. @param {string} title */
  async function page(title) {
    const d = await ask("action=parse&prop=wikitext&redirects=1&page=" + encodeURIComponent(title));
    if (d && d.error) {
      if (d.error.code === "missingtitle" || d.error.code === "invalidtitle") return null;
      throw new Error("Wikipedia: " + String(d.error.info || d.error.code));
    }
    const p = d && d.parse;
    if (!p || typeof p.wikitext !== "string") throw new Error("Wikipedia: an article's answer that can't be read");
    return { title: String(p.title || title), wikitext: p.wikitext };
  }

  return {
    /**
     * An album's article and its Personnel's credits: of the results naming the album, the one whose infobox gives its
     * name and artist as Rouen compares them; two that do, the one whose track listing has the album's track count,
     * else none. None, null and why.
     * @param {string} title @param {string} artist @param {(title: string, artist: string) => string | null} albumKey
     * @param {number} [tracks]  the album's track count as its page has it (0: unknown)
     * @returns {Promise<{ article: string | null, credits: ReturnType<typeof personnel>, why: string }>}
     */
    async album(title, artist, albumKey, tracks = 0) {
      const want = albumKey(title, artist);
      if (!want) return { article: null, credits: [], why: "No title to look for." };
      const found = (await search(`${title} ${artist} album`)).filter((t) => albumPageTitleMatches(title, t)).slice(0, READ_MAX);
      /** @type {Array<{ title: string, wikitext: string }>} */
      const agree = [];
      for (const t of found) {
        const p = await page(t);
        const info = p && albumInfo(p.wikitext);
        if (p && info && albumKey(info.name || stripDisambiguator(p.title), info.artist) === want && !agree.some((x) => x.title === p.title)) agree.push(p);
      }
      const counted = agree.length > 1 && tracks > 0 ? agree.filter((p) => trackCount(p.wikitext) === tracks) : agree;
      if (counted.length !== 1) {
        const why = !found.length ? "No article found." : !agree.length ? `None of ${found.map((t) => `"${t}"`).join(", ")} is the album's (infobox).`
          : `${agree.map((p) => `"${p.title}"`).join(" and ")} all name it, and its track count doesn't tell them apart.`;
        return { article: null, credits: [], why };
      }
      const p = counted[0];
      const credits = personnel(p.wikitext);
      return { article: p.title, credits, why: credits.length ? "Its Personnel." : "The article has no Personnel to read." };
    },
    /**
     * A band's article and its members now (§7): from its Members section's current group, else its infobox's names;
     * null members when it names none. The article: `title` (its Wikidata item's link) when given and its infobox isn't
     * a person's, else the one search result whose name is the band's and whose infobox is a group's (two: none).
     * @param {string} name @param {string | null} title @param {(name: string) => string} nameKey
     * @returns {Promise<{ article: string | null, members: Array<{ name: string, roles: string[] }> | null, from: string | null }>}
     */
    async band(name, title, nameKey) {
      const want = nameKey(name);
      const tried = title ? [title] : (await search(`${name} band`)).filter((t) => nameKey(stripDisambiguator(t)) === want).slice(0, READ_MAX);
      /** @type {Array<{ title: string, wikitext: string, info: NonNullable<ReturnType<typeof bandInfo>> }>} */
      const bands = [];
      for (const t of tried) {
        const p = await page(t);
        const info = p && bandInfo(p.wikitext);
        if (!p || !info || (title ? info.person : !info.group)) continue;
        if (!title && nameKey(info.name || stripDisambiguator(p.title)) !== want) continue;
        if (!bands.some((b) => b.title === p.title)) bands.push({ title: p.title, wikitext: p.wikitext, info });
      }
      if (bands.length !== 1) return { article: null, members: null, from: null };
      const b = bands[0];
      const now = membersNow(b.wikitext);
      if (now && now.length) return { article: b.title, members: now, from: "section" };
      if (b.info.members.length) return { article: b.title, members: b.info.members.map((n) => ({ name: n, roles: [] })), from: "infobox" };
      return { article: b.title, members: null, from: null };
    },
  };
}

/**
 * A Wikidata item's English Wikipedia article's title, from Special:EntityData's answer (an item since merged comes
 * back under its new id: the one entity there). @param {any} data @param {string} q
 */
function enwikiTitle(data, q) {
  const all = (data && data.entities) || {};
  const e = all[q] || Object.values(all)[0];
  const s = e && e.sitelinks && e.sitelinks.enwiki;
  return s && typeof s.title === "string" && s.title ? s.title : null;
}

module.exports = { createWikipedia, enwikiTitle, API };
