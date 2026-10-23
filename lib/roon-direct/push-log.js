// @ts-check
"use strict";
/*
 * push-log.js — N3-3a″ (dev/design/native-remote.md §15.3, v1.9.66-t4): the recorder, run by hand.
 *
 * The 30-second watch (§15.1) was too short to aim at: the owner's changes in Roon's own app came just outside it,
 * twice. So: started by hand (?record=start), it records every update the server sends about the probe's kinds — zones,
 * endpoints, devices, DSP — for some minutes while the owner uses Roon as they like, and is read by hand (?record=1).
 * Each update as the watch says it (settings-probe.js entry()), with its time. A zone's SeekPosition alone (one a second
 * while playing) and an update carrying no member (a stub) are counted, not kept; past MAX_KEPT, updates are counted.
 * It calls nothing, keeps nothing on disk, and records nothing unless asked.
 */
const { entry, KINDS, typeShort } = require("./settings-probe");

const MAX_KEPT = 300, MAX_MINUTES = 15, MAX_FAULTS = 5, CHECK_MS = 5000;

/**
 * @param {{ session: () => any, now?: () => number, checkMs?: number }} deps
 *   session: the connection open now (the link's), or null; checkMs: how often a recording looks for a new connection
 */
function createRecorder(deps) {
  const now = deps.now || Date.now;
  const checkMs = deps.checkMs || CHECK_MS;
  /** @type {any} */
  let rec = null;

  /** @param {any} r @param {string} why */
  function end(r, why) {
    if (!r || r.stopped) return;
    r.graph.watchers.delete(r.w);
    clearTimeout(r.timer);
    clearInterval(r.check);
    r.stopped = why;
    r.endedAt = new Date(now()).toISOString();
    // Its connection's graph is let go: a finished recording keeps only what it kept (the review).
    r.graph = null; r.session = null;
  }
  /** The recording's connection is no longer the one open: it stops, said (the review: noticed within checkMs). */
  const lost = (/** @type {any} */ r) => { if (!r.stopped && deps.session() !== r.session) end(r, `The connection to your server changed, so the recording stopped there (noticed within ${Math.round(checkMs / 1000)} s).`); };

  return {
    /**
     * Starts afresh on the connection open now, for `minutes` (1 to MAX_MINUTES).
     * @param {number} minutes
     */
    start(minutes) {
      if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES)) return { error: `minutes takes whole minutes, 1 to ${MAX_MINUTES}` };
      const s = deps.session();
      if (!s || !s.graph || !s.graph.watchers) return { error: "Rouen has no connection to your server open now, so there is nothing to record. Check native mode, then try again." };
      end(rec, "A new recording was started.");
      const t0 = now();
      const r = /** @type {any} */ ({ session: s, graph: s.graph, t0, startedAt: new Date(t0).toISOString(), minutes, kept: [], more: 0,
        seekOnly: 0, stubs: 0, faults: [], faultCount: 0, stopped: null, endedAt: null });
      r.w = (/** @type {any} */ o, /** @type {Record<string, any>} */ pushed, /** @type {number | undefined} */ cmd) => {
        // A watcher runs inside the graph's own reading of the connection: nothing here may throw into it. A fault is
        // counted, its first few said with what failed (faults), so it is not silent.
        try {
          const type = typeShort(o.typeName);
          if (r.stopped || !KINDS.test(type)) return;
          const keys = Object.keys(pushed);
          if (!keys.length) { r.stubs++; return; }
          if (type === "Zone" && keys.every((k) => k.endsWith("::SeekPosition"))) { r.seekOnly++; return; }
          if (r.kept.length >= MAX_KEPT) { r.more++; return; }
          r.kept.push(Object.assign({ at: new Date(now()).toISOString(), afterS: Math.round((now() - r.t0) / 100) / 10 }, entry(r.graph, o, pushed, cmd)));
        } catch (e) {
          r.faultCount++;
          if (r.faults.length < MAX_FAULTS) r.faults.push({ object: String(o && o.typeName), oid: String(o && o.oid), why: String(e && /** @type {any} */ (e).message) });
        }
      };
      s.graph.watchers.add(r.w);
      r.timer = setTimeout(() => { lost(r); end(r, "Its time was up."); }, minutes * 60000);
      r.check = setInterval(() => lost(r), checkMs);
      for (const t of [r.timer, r.check]) if (t && t.unref) t.unref();
      rec = r;
      return { recording: true, startedAt: r.startedAt, minutes,
        next: `Recording for ${minutes} minute(s). Change things in Roon's own app now, then open ?record=1 to read what came.` };
    },

    /** What has come so far, and whether it is still recording. */
    read() {
      if (!rec) return { recording: false, none: "Nothing has been recorded. Start with ?record=start." };
      lost(rec);
      return { recording: !rec.stopped, startedAt: rec.startedAt, minutes: rec.minutes, endedAt: rec.endedAt, stopped: rec.stopped,
        updates: rec.kept.length, more: rec.more, seekOnly: rec.seekOnly, stubs: rec.stubs, faults: rec.faultCount,
        faultsSeen: rec.faults, pushes: rec.kept };
    },

    /** Stops a recording running now. @param {string} why */
    stop(why) { end(rec, why); },
  };
}

module.exports = { createRecorder, MAX_KEPT, MAX_MINUTES };
