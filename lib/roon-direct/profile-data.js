// @ts-check
"use strict";
/*
 * profile-data.js — a ProfileData<bool> read (dev/design/native-remote.md §8.2).
 *
 * An album's or a track's IsFavorite is not a bool but one per Roon profile:
 * a LengthPrefixed member whose body is
 *
 *   flexInt(count)  then count × ( flexInt(length) + the profile's Sooid bytes + one byte 0 or 1 )
 *
 * (the encoding the upstream web client reads; to be shown on the owner's
 * Core). No entry for the profile means not a favourite. Anything that does
 * not parse exactly — a count larger than the body could hold, a value byte
 * other than 0 or 1, bytes left over — is `undefined`, never a guess: a heart
 * shown is the Core's answer or nothing.
 */
const { BinaryReader } = require("./wire");

/**
 * Every profile's value at once (profiles.md §5, 2.0.7-t4): profile id (hex) → true or false, from the one read;
 * anything that does not parse exactly is `undefined`. A profile with no entry is not in the map, and is not a
 * favourite (as above).
 * @param {unknown} body @returns {Record<string, boolean> | undefined}
 */
function profileBools(body) {
  if (!Buffer.isBuffer(body)) return undefined;
  try {
    const r = new BinaryReader(body);
    const count = r.integer();
    if (count < 0 || count > (body.length - r.pos) / 2) return undefined;
    /** @type {Record<string, boolean>} */
    const out = {};
    for (let i = 0; i < count; i++) {
      const len = r.integer();
      if (len < 0 || len > body.length - r.pos - 1) return undefined;
      const key = r.bytes(len).toString("hex");
      const v = r.byte();
      if (v !== 0 && v !== 1) return undefined;
      if (!(key in out)) out[key] = v === 1;
    }
    if (r.pos !== body.length) return undefined;
    return out;
  } catch (e) {
    return undefined;   // cut short: the reader ran off the end, so it is not a ProfileData<bool>
  }
}

/**
 * One profile's value: the same read, so the same refusals.
 * @param {unknown} body       the member's bytes, as the graph keeps a LengthPrefixed member
 * @param {Buffer} profileId   the profile's Sooid bytes (session.js's root.profileId)
 * @returns {boolean | undefined}
 */
function profileBool(body, profileId) {
  const all = Buffer.isBuffer(profileId) ? profileBools(body) : undefined;
  return all ? all[profileId.toString("hex")] === true : undefined;
}

module.exports = { profileBool, profileBools };
