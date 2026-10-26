"use strict";
// ---------------------------------------------------------------------------
// The fake server's Focus members beyond the genres and the order (v1.9.60,
// native-remote.md §12.15): read strictly from the client's parameters —
// each declared as the owner's server declares it (a list or a date
// LengthPrefixed, 24; a day count an optional integer, 10; LabelsMode an
// enum, 9) — and written back in the playlist's Focus, sparse, as the
// owner's server sends a value object (§12.13). Not evidence that the real
// server takes these forms: the owner's Roon showing the playlist is.
// ---------------------------------------------------------------------------

const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");

const AQC = "Sooloos.Broker.Api.AlbumQueryCriteria";
/** [short name, full type, property type, how its value reads] — in the fake Focus's member order after its first eight. */
const EXTRA = [
  ["RequireFileFormats", "System.Collections.Generic.IList<Sooloos.Broker.Api.FileFormat>", 24, "ints"],
  ["ExcludeFileFormats", "System.Collections.Generic.IList<Sooloos.Broker.Api.FileFormat>", 24, "ints"],
  ["RequireSampleRates", "System.Collections.Generic.IList<int>", 24, "ints"],
  ["ExcludeSampleRates", "System.Collections.Generic.IList<int>", 24, "ints"],
  ["RequireBitsPerSample", "System.Collections.Generic.IList<int>", 24, "ints"],
  ["ExcludeBitsPerSample", "System.Collections.Generic.IList<int>", 24, "ints"],
  ["LabelsMode", "Sooloos.Broker.Api.CriteriaMode", 9, "enum"],
  ["ExcludeLabels", "System.Collections.Generic.IList<string>", 24, "strings"],
  ["RequirePlayedInLastNDays", "int?", 10, "opt"],
  ["ExcludePlayedInLastNDays", "int?", 10, "opt"],
  ["RequireImportedInLastNDays", "int?", 10, "opt"],
  ["ExcludeImportedInLastNDays", "int?", 10, "opt"],
  ["MinDate", "Sooloos.NullDate", 24, "date"],
  ["MaxDate", "Sooloos.NullDate", 24, "date"],
  // v1.9.67 (§12.19): the album types excluded; RequireTypes is the fake Focus's sixth member already (v1.9.50).
  ["ExcludeTypes", "System.Collections.Generic.IList<Sooloos.Broker.Api.AlbumType>", 24, "ints"],
];
/** The fake Focus type's declarations for them. */
const EXTRA_DECLARED = EXTRA.map(([short, type, prop]) => [`${type} ${AQC}::${short}`, prop]);
/** RequireLabels is the fake Focus's fifth member already (v1.9.52), declared LengthPrefixed. */
const FIRST_INDEX = 9;

/**
 * One member the client sent, read strictly into `into` (short name → value); false when it isn't one of these.
 * @param {string} m @param {number} mp @param {any} b @param {Record<string, any>} into
 */
function readExtraMember(m, mp, b, into) {
  const def = m === "RequireLabels" ? ["RequireLabels", "", 24, "strings"] : m === "RequireTypes" ? ["RequireTypes", "", 24, "ints"] : EXTRA.find(([s]) => s === m);
  if (!def) return false;
  if (mp !== def[2]) throw new Error(`${m} declared ${mp}, not ${def[2]} as the server declares it`);
  if (def[3] === "enum") into[m] = b.integer();
  else if (def[3] === "opt") {
    if (!b.boolean()) throw new Error(m + " sent as null: only a set value is sent");
    into[m] = b.integer();
  } else {
    const inner = new BinaryReader(b.bytes(b.integer()));
    if (def[3] === "date") into[m] = inner.integer();
    else {
      const items = [];
      for (let n = inner.flexInt(); n > 0; n--) items.push(def[3] === "strings" ? inner.string() : inner.integer());
      into[m] = items;
    }
    if (inner.pos !== inner.buf.length) throw new Error("bytes after " + m);
  }
  return true;
}

/** LengthPrefixed. @param {Buffer} inner */
const lp = (inner) => new BinaryWriter().integer(inner.length).bytes(inner).toBuffer();

/**
 * The members kept, written back in the Focus as the server writes them: sparse (a default left out), RequireLabels
 * at its own index (5). @param {Record<string, any>} kept
 */
function writeExtra(kept) {
  const out = [];
  const one = (/** @type {number} */ idx, /** @type {string} */ how, /** @type {any} */ v) => {
    const w = new BinaryWriter().flexInt(idx);
    if (how === "enum") w.integer(v);
    else if (how === "opt") w.boolean(true).integer(v);
    else if (how === "date") w.bytes(lp(new BinaryWriter().integer(v).toBuffer()));
    else {
      const inner = new BinaryWriter().flexInt(v.length);
      for (const x of v) { if (how === "strings") inner.string(x); else inner.integer(x); }
      w.bytes(lp(inner.toBuffer()));
    }
    out.push(w.toBuffer());
  };
  if (Array.isArray(kept.RequireLabels) && kept.RequireLabels.length) one(5, "strings", kept.RequireLabels);
  if (Array.isArray(kept.RequireTypes) && kept.RequireTypes.length) one(6, "ints", kept.RequireTypes);
  EXTRA.forEach(([short, , , how], i) => {
    const v = kept[short];
    if (v === undefined || v === null || v === 0 || (Array.isArray(v) && !v.length)) return;
    one(FIRST_INDEX + i, how, v);
  });
  return Buffer.concat(out);
}

module.exports = { EXTRA_DECLARED, readExtraMember, writeExtra };
