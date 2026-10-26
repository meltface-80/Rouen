// @ts-check
"use strict";
/*
 * home-rows.js — the Home screen's rows: which appear, and in what order. Moved out of index.js unchanged in
 * v1.9.67 (dev/quality.md: a session that touches index.js moves code out of it).
 *
 *   GET  /api/settings/home-rows   { rows: [{ id, on, unavailable }] }
 *   POST /api/settings/home-rows   body: { rows: [{ id, on }] }   — answered with what was stored
 *
 * The vocabulary lives HERE and the client renders both the Home screen and the settings list from it, so the
 * two can never drift. Same reasoning as the theme table: a list built from the thing it describes cannot
 * disagree with it.
 *
 * Stored as an array of { id, on } rather than a set of booleans plus a separate order, because order and
 * membership are one fact and splitting them is how they end up contradicting each other.
 */

/** @returns {string[]} every row the Home screen can show, in default order */
function homeRowIds() {
  return ["unplayed", "history", "later", "picks", "random", "library", "lotw", "genres"];
}

/** The order and enablement a fresh install gets. History is on — it is the row people expect to exist — and
 * sits second, right after the discovery row. @returns {Array<{ id: string, on: boolean }>} */
function homeRowsDefault() {
  return homeRowIds().map((id) => ({ id, on: true }));
}

/**
 * The rows as sent or stored, cleaned: unknown ids dropped (a row removed by an update), a duplicate kept once,
 * `on` read as a boolean. @param {any} rows @returns {Array<{ id: string, on: boolean }>}
 */
function cleanHomeRows(rows) {
  const valid = new Set(homeRowIds());
  /** @type {Array<{ id: string, on: boolean }>} */
  const out = [];
  const seen = new Set();
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const id = r && typeof r.id === "string" ? r.id : null;
      if (!id || !valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, on: r.on !== false });
    }
  }
  return out;
}

/**
 * The stored layout, repaired against the current vocabulary: cleaned, then the missing ids appended in default
 * order and switched on (a row ADDED by an update must appear, not silently stay hidden because an old layout
 * predates it).
 * @param {any} stored  the persisted `homeRows`
 * @returns {Array<{ id: string, on: boolean }>}
 */
function repairHomeRows(stored) {
  const out = cleanHomeRows(stored);
  const seen = new Set(out.map((r) => r.id));
  for (const { id, on } of homeRowsDefault()) {
    if (!seen.has(id)) out.push({ id, on });
  }
  return out;
}

/**
 * A row whose FEATURE is switched off is not a layout choice, and the two must not be confused. The user's
 * stored `on` stays exactly as they left it — so switching Smart Picks or Labels back on restores the Home
 * screen they had — while the row is off everywhere until then. Reported by the server rather than worked out
 * in the client, because the client would otherwise need to know which rows belong to which feature.
 * @param {string} id @param {boolean} picksOn @param {boolean} labelsOn @returns {string | null} why, or null
 */
function homeRowUnavailable(id, picksOn, labelsOn) {
  if (id === "picks" && !picksOn) return "Smart Picks is off in Settings";
  if (id === "lotw" && !labelsOn) return "Labels is off in Settings";
  return null;
}

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ load: () => any, save: (patch: Record<string, any>) => boolean, picksOn: () => boolean, labelsOn: () => boolean }} d
 *   load/save: the persisted settings; picksOn/labelsOn: whether Smart Picks and Labels are switched on
 */
function mountHomeRows(app, d) {
  const homeRowsLayout = () => repairHomeRows(d.load().homeRows);
  app.get("/api/settings/home-rows", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json({ rows: homeRowsLayout().map((r) => Object.assign({}, r, { unavailable: homeRowUnavailable(r.id, d.picksOn(), d.labelsOn()) })) });
  });
  app.post("/api/settings/home-rows", (/** @type {any} */ req, /** @type {any} */ res) => {
    const rows = (req.body || {}).rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows array required" });
    const clean = cleanHomeRows(rows);
    if (!clean.length) return res.status(400).json({ error: "no recognisable rows" });
    d.save({ homeRows: clean });
    // Answered from the same repair path the GET uses, so the client is told what was actually stored rather
    // than what it sent.
    res.json({ ok: true, rows: homeRowsLayout() });
  });
}

module.exports = { homeRowIds, homeRowsDefault, cleanHomeRows, repairHomeRows, homeRowUnavailable, mountHomeRows };
