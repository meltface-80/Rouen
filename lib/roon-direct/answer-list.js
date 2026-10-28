// @ts-check
"use strict";
/*
 * answer-list.js — an answer that is a list (IList<T>), as the server sends one (v1.9.70-t14, out of reads-probe.js so
 * track-times.js reads the same way): LengthPrefixed (its length, then its count and items), else bare (its count and
 * items), each item a value or an object by reference. A null answer (one zero byte) reads as an empty bare list: the
 * two are the same byte, and the caller says so where it matters.
 *
 *   listOf(graph, payload)   → { form: "LengthPrefixed list" | "bare list", items } | null when it is neither
 */
const { BinaryReader } = require("./wire");
const { P } = require("./objects");

/** @param {any} graph @param {Buffer} payload @returns {{ form: string, items: any[] } | null} */
function listOf(graph, payload) {
  /** @param {BinaryReader} r */
  const items = (r) => {
    const n = r.flexInt();
    if (n < 0 || n > r.remaining) throw new Error(`a count of ${n} with ${r.remaining} byte(s) left`);
    const out = [];
    for (let i = 0; i < n; i++) out.push(graph.readValue(r, P.Object));
    if (r.remaining) throw new Error(`${r.remaining} byte(s) after the ${n} item(s)`);
    return out;
  };
  try {
    const r = new BinaryReader(payload);
    const inner = new BinaryReader(r.bytes(r.integer()));
    if (r.remaining) throw new Error("bytes after the list");
    return { form: "LengthPrefixed list", items: items(inner) };
  } catch (e) {
    // Not that form: the bare one is tried; failing both, not a list (null says so, and the caller reads it otherwise).
    try { return { form: "bare list", items: items(new BinaryReader(payload)) }; } catch (e2) { return null; }
  }
}

module.exports = { listOf };
