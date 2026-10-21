"use strict";
// ---------------------------------------------------------------------------
// A fake of Roon's official browse API (v1.9.36, for streaming-browse-probe.js
// and what follows it): a tree of items, each with a title, subtitle and hint,
// walked by browse({pop_all}) / browse({item_key}) and read by load(). As the
// real one does, an item key belongs to the load that gave it, and opening an
// item whose hint is "action" carries it out — recorded in `done`, which a
// read-only walk must leave empty.
//
// Not evidence of what a real Core's tree holds: the probe exists to find out.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ title: string, subtitle?: string, hint?: string, image_key?: string, items?: Node[] }} Node
 */

/**
 * @param {Node} root
 * @param {{ failOpen?: (title: string) => boolean, search?: (input: string) => Node }} [opts]  failOpen: opening that item fails, as a
 *   Core gone quiet does; search: the tree Roon's search answers an input with (v1.9.39)
 */
function fakeBrowse(root, opts = {}) {
  /** @type {Map<string, { stack: Node[], keys: Map<string, Node> }>} */
  const sessions = new Map();
  const done = [];
  const calls = { browse: 0, load: 0 };
  let seq = 0;
  const state = (/** @type {string} */ k) => {
    if (!sessions.has(k)) sessions.set(k, { stack: [root], keys: new Map() });
    return /** @type {{ stack: Node[], keys: Map<string, Node> }} */ (sessions.get(k));
  };
  return {
    done,
    calls,
    async withBrowseSession(/** @type {(k: string) => Promise<any>} */ fn) { return fn("s" + (++seq)); },
    async browse(/** @type {any} */ o) {
      calls.browse++;
      if (o.hierarchy !== "browse" && !(o.hierarchy === "search" && opts.search)) throw new Error("only the browse hierarchy is faked");
      const s = state(o.multi_session_key);
      if (o.pop_all) { s.stack = [o.hierarchy === "search" ? /** @type {any} */ (opts).search(o.input) : root]; s.keys = new Map(); s.zone = o.zone_or_output_id || null; return { action: "list" }; }
      if (o.pop_levels) { s.stack = s.stack.slice(0, Math.max(1, s.stack.length - o.pop_levels)); s.keys = new Map(); return { action: "list" }; }
      const node = s.keys.get(o.item_key);
      if (!node) throw new Error("InvalidItemKey");   // a key from another load, or none
      if (opts.failOpen && opts.failOpen(node.title)) throw new Error("Roon did not answer in time");
      if (node.hint === "action") { done.push(node.title + (o.zone_or_output_id ? " @" + o.zone_or_output_id : "")); return { action: "message", message: "done" }; }
      if (node.hint === "input") throw new Error("an input opened without its input");
      s.stack.push(node);
      s.keys = new Map();
      return { action: "list" };
    },
    async load(/** @type {any} */ o) {
      calls.load++;
      const s = state(o.multi_session_key);
      const here = s.stack[s.stack.length - 1];
      const all = here.items || [];
      const from = o.offset || 0, n = o.count || 100;
      const tag = "L" + (++seq) + ":";
      s.keys = new Map();
      const items = all.slice(from, from + n).map((it, i) => {
        const key = tag + (from + i);
        s.keys.set(key, it);
        return { title: it.title, subtitle: it.subtitle || null, hint: it.hint || null, item_key: key, image_key: it.image_key || null };
      });
      return { list: { title: here.title, count: all.length }, items };
    },
  };
}

/**
 * A small streaming tree: TIDAL with a new-albums list of three, an artist page, a mix to play and a
 * search; Qobuz with one album.
 */
function streamingTree() {
  const album = (/** @type {string} */ title, /** @type {string} */ artist) => ({ title, subtitle: artist, hint: "list", items: [
    { title: "Play Album", hint: "action_list", items: [
      { title: "Play Now", hint: "action" }, { title: "Add Next", hint: "action" }, { title: "Queue", hint: "action" },
      { title: "Start Radio", hint: "action" }, { title: "Add to Library", hint: "action" }] },
    { title: "1. Opening", hint: "action_list", items: [{ title: "Play Now", hint: "action" }] },
  ] });
  return { title: "Explore", items: [
    { title: "Library", hint: "list", items: [{ title: "Albums", hint: "list", items: [] }] },
    { title: "TIDAL", hint: "list", items: [
      { title: "Search TIDAL", hint: "input" },
      { title: "Play My Mix", hint: "action" },
      { title: "What's New", hint: "list", items: [
        { title: "New Albums", hint: "list", items: [album("Selected Ambient Works 85-92", "Aphex Twin"), album("Kid A", "Radiohead"), album("Third", "Portishead")] },
        // A level of tracks with no page around them, as TIDAL's What's New → Tracks → New is (v1.9.39).
        { title: "New Tracks", hint: "list", items: [
          { title: "expectations", subtitle: "Olivia Rodrigo", hint: "action_list", items: [{ title: "Play Now", hint: "action" }, { title: "Queue", hint: "action" }] },
          { title: "KOYSAR", subtitle: "Kings of Leon", hint: "action_list", items: [{ title: "Play Now", hint: "action" }, { title: "Queue", hint: "action" }] }] },
        // A level of tracks whose first is named "Play …": a track still, by its credit (the review, v1.9.39).
        { title: "Rock Tracks", hint: "list", items: [
          { title: "Play the Game", subtitle: "Queen", hint: "action_list", items: [{ title: "Play Now", hint: "action" }, { title: "Queue", hint: "action" }] },
          { title: "Under Pressure", subtitle: "Queen", hint: "action_list", items: [{ title: "Play Now", hint: "action" }] }] },
      ] },
      { title: "Artists", hint: "list", items: [
        { title: "Aphex Twin", hint: "list", items: [
          { title: "Play Artist", hint: "action_list", items: [{ title: "Shuffle", hint: "action" }, { title: "Start Radio", hint: "action" }] },
          { title: "Albums", hint: "list", items: [album("Syro", "Aphex Twin")] },
        ] },
      ] },
      { title: "My Albums", hint: "list", items: [] },
    ] },
    { title: "Qobuz", hint: "list", items: [
      { title: "New Releases", hint: "list", items: [album("Homogenic", "Björk")] },
    ] },
    { title: "Settings", hint: "list", items: [] },
  ] };
}

module.exports = { fakeBrowse, streamingTree };
