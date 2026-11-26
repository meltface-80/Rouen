// @ts-check
"use strict";
/*
 * objects-view.js — what fills Rouen's copy of the server's objects on the open connection, read-only (2.0.8-t4). The
 * owner's server, 2026-11-26: "the Core's objects reached the cap Rouen keeps" (five reconnects in an afternoon, 97,206
 * held), and the P3-probe's playlist read refused with "under 25,000 objects of room left". Rouen keeps at most
 * `maxObjects` (objects.js, 200,000) and most reads and writes stop with RESERVE (find.js, 25,000) left; nothing says what
 * takes the room. This says it: the objects held by type, most first, and the connection's reconnects. Nothing is sent.
 *
 *   GET /api/debug/roon-objects
 */

/** How many types are named; the rest are summed. */
const TOP = 40;

/**
 * @param {{ session(): any, status(): any } | null} link
 * @returns {{ connected: false } | { connected: true, held: number, max: number, roomLeft: number, byType: Array<{ type: string, count: number }>,
 *   otherTypes: number, otherCount: number, unloaded: number, reconnects: number, lastDown: any }}
 */
function objectsView(link) {
  const s = link ? link.session() : null;
  if (!s || !s.graph) return { connected: false };
  /** @type {Map<string, number>} */
  const counts = new Map();
  let unloaded = 0;
  for (const o of s.graph.objects.values()) {
    const t = String(o.typeName || "(no type)").replace(/^Sooloos\.Broker\.Api\./, "");
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!o.loaded) unloaded++;
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
  const st = link ? link.status() : {};
  const rest = sorted.slice(TOP);
  return { connected: true, held: s.graph.objects.size, max: s.graph.maxObjects, roomLeft: s.graph.maxObjects - s.graph.objects.size,
    byType: sorted.slice(0, TOP), otherTypes: rest.length, otherCount: rest.reduce((n, x) => n + x.count, 0), unloaded,
    reconnects: st.reconnects || 0, lastDown: st.lastDown || null };
}

/**
 * @param {any} app @param {() => ReturnType<typeof objectsView> | null} view  null: native mode isn't available here
 */
function mountObjectsView(app, view) {
  app.get("/api/debug/roon-objects", (/** @type {any} */ _req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const v = view();
    if (!v) return res.status(503).json({ error: "Native mode isn't available here." });
    res.json(Object.assign({ design: "lib/roon-direct/objects-view.js (2.0.8-t4)" }, v));
  });
}

module.exports = { objectsView, mountObjectsView, TOP };
