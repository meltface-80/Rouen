// @ts-check
"use strict";
/*
 * deep-value.js — a pushed value said in full (dev/design/native-remote.md §15.11, §15.13): structs and lists to DEEP
 * levels, a list's first DEEP_ITEMS — a parametric EQ's bands, which come as a list's bytes inside its spec (focus.js
 * readList), each with its members — under the server's own names; a reference said by which object it is; a number
 * that JSON can't hold (−∞ dB) said as text. The recorder's (push-log.js, t11) and, since t13, the zones probe's for a
 * DSP part's own values (settings-probe.js), so a band's members show in a read as in a recording.
 */
const { isRef, shortType } = require("./objects");
const { readList } = require("./focus");

/** How deep, and how many of a list, a value is said in full. */
const DEEP = 6, DEEP_ITEMS = 32;

/** A member's name as said: a list's own `$items` and `$count` as they are. @param {string} k */
const memberName = (k) => (k.includes("::") ? k.slice(k.lastIndexOf("::") + 2) : k);

/**
 * @param {any} graph @param {string} fullName  the member's, which names a list's element type @param {any} v
 * @param {number} [depth]
 * @returns {any}
 */
function deep(graph, fullName, v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v !== "object") return v;
  if (depth >= DEEP) return "…";
  if (Buffer.isBuffer(v)) {
    const list = readList(graph, fullName, v);
    if (!list) return { bytes: v.length };
    const out = /** @type {Record<string, any>} */ ({ list: list.type, count: list.count, items: deep(graph, "", list.items, depth + 1) });
    if (!list.whole) out.whole = false;
    return out;
  }
  if (Array.isArray(v)) {
    const some = v.slice(0, DEEP_ITEMS).map((x) => deep(graph, "", x, depth + 1));
    return v.length > DEEP_ITEMS ? some.concat([`… ${v.length - DEEP_ITEMS} more`]) : some;
  }
  if (isRef(v)) return { ref: String(v.$ref) };
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(v)) out[memberName(k)] = k === "$type" ? shortType(String(v[k])) : deep(graph, k, v[k], depth + 1);
  return out;
}

module.exports = { deep, memberName };
