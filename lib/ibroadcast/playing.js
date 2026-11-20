// @ts-check
"use strict";
/*
 * playing.js — what Roon is playing and has queued, for the iBroadcast drive's read rule (2.0.6-t2,
 * dev/design/ibroadcast.md §4.2): each zone's now playing, and the next three queued in each zone playing, paused or
 * loading, as titles, artists and albums. Read at most once a second however many reads ask (a queue's read is a
 * round trip to the Core), and a file is matched by its title and its album or artist, as Roon writes them.
 */

/** A title or name compared as one: case, accents' forms, punctuation and spacing aside. @param {any} s */
const canon = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * @param {{ zones: () => Record<string, any> | null, peekQueue?: (zoneId: string, count: number) => Promise<any[]>,
 *           now?: () => number }} o
 */
function createPlaying(o) {
  const now = o.now || Date.now;
  /** @type {{ at: number, list: Promise<Array<{ title: string, artist: string, album: string }>> } | null} */
  let last = null;

  /** @param {any} three */
  const row = (three) => ({ title: canon(three && three.line1), artist: canon(three && three.line2), album: canon(three && three.line3) });

  async function read() {
    const out = [];
    for (const z of Object.values(o.zones() || {})) {
      if (!z) continue;
      const np = z.now_playing && z.now_playing.three_line;
      if (np) out.push(row(np));
      if (o.peekQueue && z.zone_id && ["playing", "paused", "loading"].includes(z.state)) {
        const items = await o.peekQueue(z.zone_id, 4).catch(() => []);   // a queue that can't be read wants nothing more
        for (const it of (items || []).slice(0, 4)) if (it && it.three_line) out.push(row(it.three_line));
      }
    }
    return out;
  }

  return {
    /** What is playing or queued now, read at most once a second. */
    list() {
      if (!last || now() - last.at >= 1000) last = { at: now(), list: read() };
      return last.list;
    },
    /**
     * Whether a track is playing or queued: its title, and its album or its artist, as one of them.
     * @param {{ title: string, artist: string }} track @param {{ title: string, artist: string }} album
     */
    async wants(track, album) {
      const t = canon(track.title), al = canon(album.title), ar = canon(track.artist), aa = canon(album.artist);
      return (await this.list()).some((p) => p.title === t && (p.album === al || p.artist === ar || p.artist === aa));
    },
  };
}

module.exports = { createPlaying, canon };
