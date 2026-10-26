// @ts-check
"use strict";
/*
 * labels-discogs-pass.js — the label scan's Discogs pass (pass 4), moved out of index.js runLabelsIndexScan in
 * v1.9.67-t2 and given a second queue: the albums whose tags gave no catalogue number (dev/design/catalogue.md §4).
 *
 * One request per album, serial and rate-limited by the client (lib/discogs.js). The albums still without a
 * label after the cascade come first, as before, and the same answer now gives their catalogue number and kind
 * too; then the albums that have a label but no number, for the number alone. Five minutes a scan, so a large
 * library's numbers arrive over a few scan windows; a miss is remembered (`tried`) so no album is asked for twice,
 * an error is not, so it is asked again next scan. Ten errors in a row end the pass (the circuit breaker) — Discogs'
 * errors, not Rouen's own in keeping an answer.
 */

/**
 * @typedef {{ al: any, key: string, wantLabel: boolean }} QueueItem  key: the label cache's key for the album
 * @typedef {{ label: string | null, catno: string | null, type: string | null } | null} Release
 * @param {QueueItem[]} queue
 * @param {{ release: (title: string, artist: string) => Promise<Release>,
 *           onLabel: (key: string, label: string, al: any) => Promise<void> | void,
 *           onRelease: (al: any, rel: { catno: string | null, type: string | null }) => void,
 *           tried: (key: string) => void, progress: (done: number, total: number) => void, log: (line: string) => void,
 *           warn?: (line: string) => void, now?: () => number, limitMs?: number, maxConsecutiveErrors?: number }} d
 *   warn: for the lines that end the pass (the server's console as well as the labels log); log otherwise
 * @returns {Promise<{ done: number, labels: number, releases: number, errors: number, aborted: "" | "errors" | "time" }>}
 */
async function runDiscogsPass(queue, d) {
  const now = d.now || Date.now;
  const limitMs = d.limitMs === undefined ? 5 * 60 * 1000 : d.limitMs;
  const maxConsec = d.maxConsecutiveErrors || 10;
  const out = { done: 0, labels: 0, releases: 0, errors: 0, aborted: /** @type {"" | "errors" | "time"} */ ("") };
  if (!queue.length) return out;
  const forNumber = queue.filter((q) => !q.wantLabel).length;
  d.log("[labels] pass 4 (Discogs): " + queue.length + " albums" + (forNumber ? " (" + forNumber + " for a catalogue number only)" : ""));
  const deadline = now() + limitMs;
  let consec = 0;
  const warn = d.warn || d.log;
  for (let i = 0; i < queue.length; i++) {
    const { al, key, wantLabel } = queue[i];
    let rel, failed = false;
    try {
      rel = await d.release(al.title, al.subtitle);
    } catch (e) {
      failed = true;
      out.errors++;
      consec++;
      if (consec >= maxConsec) {
        out.aborted = "errors";
        warn("[labels] pass 4 (Discogs): " + consec + " consecutive errors — aborting, will retry next scan window");
      }
    }
    if (!failed) {
      // Answered. What is done with the answer is Rouen's own doing, and a failure there (the database) is not
      // Discogs' error: said, and the album still counts as asked about.
      consec = 0;
      try {
        if (rel && rel.label && wantLabel) { await d.onLabel(key, rel.label, al); out.labels++; }
        if (rel && (rel.catno || rel.type)) { d.onRelease(al, { catno: rel.catno, type: rel.type }); out.releases++; }
      } catch (e) {
        d.log("[labels] pass 4 (Discogs): keeping the answer for \"" + al.title + "\" failed: " + e.message);
      }
      d.tried(key);   // answered, with something or nothing: not asked again
    }
    out.done = i + 1;
    d.progress(out.done, queue.length);
    if (out.aborted) break;
    if (now() > deadline) {
      out.aborted = "time";
      warn("[labels] pass 4 (Discogs): 5-minute time limit reached — aborting, remainder at next scheduled scan");
      break;
    }
    if (out.done % 100 === 0) d.log("[labels] pass 4 (Discogs): " + out.done + "/" + queue.length + " done so far");
  }
  d.log("[labels] pass 4 (Discogs): complete" + (out.aborted ? " (aborted)" : "") +
    (out.releases ? ", " + out.releases + " catalogue numbers or kinds kept" : "") +
    (out.errors ? ", " + out.errors + " errors total" : ""));
  return out;
}

module.exports = { runDiscogsPass };
