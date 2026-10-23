// @ts-check
"use strict";
/*
 * push-log.js — N3-3a″ (dev/design/native-remote.md §15.3, v1.9.66-t4): the recorder, run by hand.
 *
 * The 30-second watch (§15.1) was too short to aim at: the owner's changes in Roon's own app came just outside it,
 * twice. So: started by hand (?record=start), it records every update the server sends about the probe's kinds — zones,
 * endpoints, devices, DSP — for some minutes while the owner uses Roon as they like, and is read by hand (?record=1).
 * Each update as the watch says it (settings-probe.js entry()), with its time. An update carrying no member (a stub) is
 * counted, not kept; past MAX_KEPT, updates are counted. It calls nothing, keeps nothing on disk, and records nothing
 * unless asked.
 *
 * N3-3a‴ (§15.4, v1.9.66-t5), changes only: a zone is pushed whole about once a second, which filled MAX_KEPT in two
 * minutes. So an update is kept only when something in it differs from what is known of its object (changed): a
 * member's value, compared whole as pushed (not as described, which shortens), or a member come; or, in a whole update,
 * a member gone (dropped: back at its default). The rest are counted (same). An object's first update is kept (first),
 * compared with what Rouen held of it when the recording began (held), or new. A tick — a zone's SeekPosition and WaveformData, and any member found changing on every
 * update of its object, at most TICK_GAP_MS apart, TICK_AFTER times over TICK_SPAN_MS (ticking, said) — is compared by
 * whether it is there, not by its value.
 */
const { createHash } = require("node:crypto");
const { entry, isWhole, KINDS, typeShort, nameOf, short } = require("./settings-probe");
const { describe } = require("./smart-probe");

const MAX_KEPT = 300, MAX_MINUTES = 15, MAX_FAULTS = 5, CHECK_MS = 5000, MAX_OBJECTS = 1000, MAX_TICKING = 50;
const TICK_AFTER = 30, TICK_SPAN_MS = 25000, TICK_GAP_MS = 3000;
/** A zone's members that change every second while it plays. */
const ZONE_TICK = new Set(["SeekPosition", "WaveformData"]);
/** What a tick is known as: there. */
const THERE = "there";

/** A member's name as said: a list's own `$items` and `$count` as they are. @param {string} k */
const memberName = (k) => (k.includes("::") ? short(k) : k);
/** @param {string | Buffer} t */
const digest = (t) => createHash("sha1").update(t).digest("base64");
/**
 * A pushed value as text, whole — buffers by their bytes, big numbers, references, structs and lists in full — kept
 * short (a long one by its digest) so what is known per object stays small.
 * @param {any} v
 */
function valueText(v) {
  if (Buffer.isBuffer(v)) return "bytes " + digest(v);
  const t = String(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x)));
  return t.length > 256 ? digest(t) : t;
}
/** @param {any} o @param {string} name @param {any} seen  what is known of it, if anything */
const isTick = (o, name, seen) => (typeShort(o.typeName) === "Zone" && ZONE_TICK.has(name)) || !!(seen && seen.ticks.has(name));

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
    r.graph = null; r.session = null; r.objects = null;
  }
  /** The recording's connection is no longer the one open: it stops, said (the review: noticed within checkMs). */
  const lost = (/** @type {any} */ r) => { if (!r.stopped && deps.session() !== r.session) end(r, `The connection to your server changed, so the recording stopped there (noticed within ${Math.round(checkMs / 1000)} s).`); };

  /** @param {any} r @param {number} at */
  const afterS = (r, at) => Math.round((at - r.t0) / 100) / 10;
  /** @param {any} r @param {any} o @param {any} e */
  const fault = (r, o, e) => {
    r.faultCount++;
    if (r.faults.length < MAX_FAULTS) r.faults.push({ object: String(o && o.typeName), oid: String(o && o.oid), why: String(e && e.message) });
  };
  /** A new record of an object, or null past MAX_OBJECTS. @param {any} r @param {string} oid @param {boolean} held */
  function note(r, oid, held) {
    if (r.objects.size >= MAX_OBJECTS) return null;
    const seen = { vals: new Map(), streak: new Map(), ticks: new Set(), held, heard: false };
    r.objects.set(oid, seen);
    return seen;
  }
  /**
   * What Rouen holds of the probe's kinds when a recording begins, so an object's first update says what changed from
   * it. Held, not known: the graph merges (since t6 it drops for a whole Zone or Endpoint only), so it may hold one gone. The
   * queue is left out and half the bound is left for objects that come later, so neither crowds the other out.
   * @param {any} r
   */
  function holdNow(r) {
    for (const o of r.graph.objects.values()) {
      if (r.objects.size >= MAX_OBJECTS / 2) break;
      if (!o.loaded || !o.typeName || !KINDS.test(typeShort(o.typeName)) || /Queue/.test(o.typeName)) continue;
      // An object that can't be read is left out of what is held, counted and said as a fault: never into start().
      try {
        const vals = new Map(Object.keys(o.fields).map((k) => [memberName(k), isTick(o, memberName(k), null) ? THERE : valueText(o.fields[k])]));
        const seen = note(r, String(o.oid), true);
        if (seen) seen.vals = vals;
      } catch (e) { fault(r, o, e); }
    }
  }

  /**
   * Compares an update with what is known of its object: what changed, and (a whole update) what dropped. Nothing is
   * noted until commit(), called once the update has been dealt with (the review: a fault after the compare would
   * otherwise leave a change noted and never kept).
   * @param {any} r @param {any} o @param {Record<string, any>} pushed @param {boolean} whole @param {number} at
   */
  function compare(r, o, pushed, whole, at) {
    const oid = String(o.oid), known = r.objects.get(oid);
    if (!known && r.objects.size >= MAX_OBJECTS) return { untracked: true, first: null, changed: [], dropped: null, commit() {} };
    const vals = known ? known.vals : new Map();
    const keys = Object.keys(pushed), names = new Set(keys.map(memberName));
    const sets = keys.map((k) => {
      const name = memberName(k), tick = isTick(o, name, known);
      return { name, tick, had: vals.has(name), v: tick ? THERE : valueText(pushed[k]) };
    }).filter((x) => vals.get(x.name) !== x.v);
    const changed = new Set(sets.map((x) => x.name));
    // Against all that is known, not only the last whole update (the review: a member a partial update set counts).
    const dropped = whole && known ? [...vals.keys()].filter((n) => !names.has(n)) : null;
    const first = !known ? "new" : known.heard ? null : "held";
    function commit() {
      const seen = known || note(r, oid, false);
      if (!seen) return;
      seen.heard = true;
      // A member unchanged, or left out of this update, did not change on every update: its run ends.
      for (const n of [...seen.streak.keys()]) if (!changed.has(n)) seen.streak.delete(n);
      for (const x of sets) {
        seen.vals.set(x.name, x.v);
        if (x.tick || !x.had) continue;
        // A member changing on every update, without a pause, for long, is a tick of its own: from then on compared by
        // whether it is there, said in ticking (the review: a slider dragged, then left, is not one).
        let st = seen.streak.get(x.name);
        if (!st || at - st.lastAt > TICK_GAP_MS) st = { n: 0, since: at };
        st.n++; st.lastAt = at;
        seen.streak.set(x.name, st);
        if (st.n >= TICK_AFTER && at - st.since >= TICK_SPAN_MS) {
          seen.ticks.add(x.name); seen.vals.set(x.name, THERE); seen.streak.delete(x.name);
          if (r.ticking.length < MAX_TICKING) r.ticking.push({ object: nameOf(o), member: x.name, afterS: afterS(r, at) });
          else r.tickingMore++;
        }
      }
      for (const n of dropped || []) { seen.vals.delete(n); seen.streak.delete(n); }
    }
    return { untracked: false, first, changed: [...changed], dropped: first === "new" ? null : dropped, commit };
  }

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
        same: 0, stubs: 0, untracked: 0, objects: new Map(), ticking: [], tickingMore: 0, faults: [], faultCount: 0, stopped: null, endedAt: null });
      r.w = (/** @type {any} */ o, /** @type {Record<string, any>} */ pushed, /** @type {number | undefined} */ cmd) => {
        // A watcher runs inside the graph's own reading of the connection: nothing here may throw into it. A fault is
        // counted, its first few said with what failed (faults), so it is not silent.
        try {
          if (r.stopped || !KINDS.test(typeShort(o.typeName))) return;
          if (!Object.keys(pushed).length) { r.stubs++; return; }
          const at = now();
          const c = compare(r, o, pushed, isWhole(o, pushed) === true, at);
          if (c.untracked) r.untracked++;
          else if (!c.first && !c.changed.length && !(c.dropped && c.dropped.length)) { r.same++; c.commit(); return; }
          if (r.kept.length >= MAX_KEPT) { r.more++; c.commit(); return; }
          const e = /** @type {any} */ (entry(r.graph, o, pushed, cmd));
          // A list's items, which entry() leaves aside (the review: else a changed list shows no member).
          if ("$items" in pushed) e.items = describe(r.graph, pushed.$items);
          // An object's first update is kept, said as compared with what was held (which may hold what had gone) or new.
          if (c.first) e.first = c.first;
          if (c.untracked) e.untracked = true;
          else if (c.first !== "new") e.changed = c.changed;
          if (c.dropped) e.dropped = c.dropped;
          r.kept.push(Object.assign({ at: new Date(at).toISOString(), afterS: afterS(r, at) }, e));
          c.commit();
        } catch (e) {
          fault(r, o, e);
        }
      };
      holdNow(r);
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
        updates: rec.kept.length, more: rec.more, same: rec.same, stubs: rec.stubs, untracked: rec.untracked, ticking: rec.ticking,
        tickingMore: rec.tickingMore, faults: rec.faultCount,
        faultsSeen: rec.faults, pushes: rec.kept };
    },

    /** Stops a recording running now. @param {string} why */
    stop(why) { end(rec, why); },
  };
}

module.exports = { createRecorder, MAX_KEPT, MAX_MINUTES, MAX_OBJECTS, MAX_TICKING, TICK_AFTER, TICK_SPAN_MS, TICK_GAP_MS };
