// @ts-check
"use strict";
/*
 * brokerid.js — the Core's 16-byte server broker id, which the handshake
 * needs, from what Rouen already holds.
 *
 * dev/design/roon-native.md §2.5: the upstream reads the id off a packet
 * capture; the hypothesis to test first is that it is the core_id the public
 * API gives Rouen at pairing. The upstream's own notes (site/.../
 * contributing.md, commit 8b67208) add that discovery (SOOD) gives the Core's
 * unique_id as a textual UUID whose WIRE bytes are in .NET Guid order — the
 * first three groups byte-reversed, the last two as written — and that simply
 * dropping the hyphens gives the wrong order. node-roon-api connects to the
 * Core it finds by that same unique_id, and its core_id comes from the Core's
 * registration, so the two are expected to be one value; not proven.
 *
 * So the probe tries, in order: an id given by hand (?broker=, 32 hex), the
 * core_id in .NET Guid order, then the core_id as written. Whichever the
 * Core accepts is the answer the probe reports.
 */

const UUID = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

/** @param {string} hex */
const reversedBytes = (hex) => Buffer.from(hex, "hex").reverse();

/**
 * A textual UUID's bytes in .NET Guid.ToByteArray() order, or null.
 * @param {string} uuid
 */
function dotnetGuidBytes(uuid) {
  const m = UUID.exec(String(uuid || "").trim());
  if (!m) return null;
  return Buffer.concat([reversedBytes(m[1]), reversedBytes(m[2]), reversedBytes(m[3]), Buffer.from(m[4] + m[5], "hex")]);
}

/**
 * The same UUID with its hyphens dropped, as written, or null.
 * @param {string} uuid
 */
function plainGuidBytes(uuid) {
  const m = UUID.exec(String(uuid || "").trim());
  return m ? Buffer.from(m.slice(1).join(""), "hex") : null;
}

/**
 * The ids to try, each once, labelled with where it came from.
 * @param {{ coreId?: string, override?: string }} from
 * @returns {Array<{ label: string, id: Buffer }>}
 */
function brokerIdCandidates(from) {
  /** @type {Array<{ label: string, id: Buffer }>} */
  const out = [];
  /** @param {string} label @param {Buffer | null} id */
  const add = (label, id) => {
    if (id && id.length === 16 && !out.some((c) => c.id.equals(id))) out.push({ label, id });
  };
  const o = String(from.override || "").trim();
  if (/^[0-9a-f]{32}$/i.test(o)) add("given by hand", Buffer.from(o, "hex"));
  if (from.coreId) {
    add("core_id, .NET Guid order", dotnetGuidBytes(from.coreId));
    add("core_id, as written", plainGuidBytes(from.coreId));
  }
  return out;
}

module.exports = { dotnetGuidBytes, plainGuidBytes, brokerIdCandidates };
