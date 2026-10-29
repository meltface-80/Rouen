// @ts-check
"use strict";
/*
 * filter-params.js — the optional genre/tag filter in a request's query or body (moved out of index.js unchanged in
 * v1.9.72-t11, dev/quality.md's order). `filter_parent` (genre only) selects a sub-genre nested under a parent genre,
 * e.g. parent "Pop/Rock", value "Heavy Metal".
 */

/**
 * @param {Record<string, any>} src  req.query or req.body
 * @returns {{ type: string, value: string, parent?: string } | null}
 */
function parseFilter(src) {
  const type   = (src.filter_type   || "").trim();
  const value  = (src.filter_value  || "").trim();
  const parent = (src.filter_parent || "").trim();
  if (!type || !value) return null;
  if (type !== "genre" && type !== "tag" && type !== "label" && type !== "decade") return null;
  /** @type {{ type: string, value: string, parent?: string }} */
  const f = { type, value };
  if (type === "genre" && parent) f.parent = parent;
  return f;
}

module.exports = { parseFilter };
