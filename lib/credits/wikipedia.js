// @ts-check
"use strict";
/*
 * wikipedia.js — an album's or a band's English Wikipedia article, found and read (dev/design/album-credits.md
 * §2.4, §7, v1.9.70-t2): the album's by a search its infobox must agree with, the band's by its Wikidata item's
 * link or a search, each read as wikitext for wikitext.js to read. Errors other than "no such article" are thrown,
 * for the caller to count as failed and ask again the next day.
 */
const { personnel, albumInfo, bandInfo, membersNow } = require("./wikitext");
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
    return (Array.isArray(d && d.query && d.query.search) ? d.query.search : []).map((/** @type {any} */ x) => String((x && x.title) || "")).filter(Boolean);
  }

  /** An article's wikitext, its redirects followed; null when there is no such article. @param {string} title */
  async function page(title) {
    const d = await ask("action=parse&prop=wikitext&redirects=1&page=" + encodeURIComponent(title));
    if (d && d.error) {
      if (d.error.code === "missingtitle" || d.error.code === "invalidtitle") return null;
      throw new Error("Wikipedia: " + String(d.error.info || d.error.code));
    }
    const p = d && d.parse;
    return p && typeof p.wikitext === "string" ? { title: String(p.title || title), wikitext: p.wikitext } : null;
  }

  return {
    /**
     * An album's article and its Personnel's credits: the first result naming the album whose infobox gives its name
     * and artist as Rouen compares them; none, null and why.
     * @param {string} title @param {string} artist @param {(title: string, artist: string) => string | null} albumKey
     * @returns {Promise<{ article: string | null, credits: ReturnType<typeof personnel>, why: string }>}
     */
    async album(title, artist, albumKey) {
      const want = albumKey(title, artist);
      if (!want) return { article: null, credits: [], why: "No title to look for." };
      const found = (await search(`${title} ${artist} album`)).filter((t) => albumPageTitleMatches(title, t)).slice(0, READ_MAX);
      for (const t of found) {
        const p = await page(t);
        const info = p && albumInfo(p.wikitext);
        if (!p || !info || albumKey(info.name || stripDisambiguator(p.title), info.artist) !== want) continue;
        const credits = personnel(p.wikitext);
        return { article: p.title, credits, why: credits.length ? "Its Personnel." : "The article has no Personnel to read." };
      }
      return { article: null, credits: [], why: found.length ? `None of ${found.map((t) => `"${t}"`).join(", ")} is the album's (infobox).` : "No article found." };
    },
    /**
     * A band's article and its members now (§7): from its Members section's current group, else its infobox's names;
     * null members when it names none. The article: `title` (its Wikidata item's link) when given, else a search's
     * result whose name is the band's and whose infobox is a group's.
     * @param {string} name @param {string | null} title @param {(name: string) => string} nameKey
     * @returns {Promise<{ article: string | null, members: Array<{ name: string, roles: string[] }> | null, from: string | null }>}
     */
    async band(name, title, nameKey) {
      const want = nameKey(name);
      const tried = title ? [title] : (await search(`${name} band`)).filter((t) => nameKey(stripDisambiguator(t)) === want).slice(0, READ_MAX);
      for (const t of tried) {
        const p = await page(t);
        const info = p && bandInfo(p.wikitext);
        if (!p || !info || !info.group) continue;
        if (!title && nameKey(info.name || stripDisambiguator(p.title)) !== want) continue;
        const now = membersNow(p.wikitext);
        if (now && now.length) return { article: p.title, members: now, from: "section" };
        if (info.members.length) return { article: p.title, members: info.members.map((n) => ({ name: n, roles: [] })), from: "infobox" };
        return { article: p.title, members: null, from: null };
      }
      return { article: null, members: null, from: null };
    },
  };
}

/** A Wikidata item's English Wikipedia article's title, from Special:EntityData's answer. @param {any} data @param {string} q */
function enwikiTitle(data, q) {
  const s = data && data.entities && data.entities[q] && data.entities[q].sitelinks && data.entities[q].sitelinks.enwiki;
  return s && typeof s.title === "string" && s.title ? s.title : null;
}

module.exports = { createWikipedia, enwikiTitle, API };
