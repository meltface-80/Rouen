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
 * @param {unknown} body       the member's bytes, as the graph keeps a LengthPrefixed member
 * @param {Buffer} profileId   the profile's Sooid bytes (session.js's root.profileId)
 * @returns {boolean | undefined}
 */
function profileBool(body, profileId) {
  if (!Buffer.isBuffer(body) || !Buffer.isBuffer(profileId)) return undefined;
  try {
    const r = new BinaryReader(body);
    const count = r.integer();
    // Each entry is at least a length byte and a value byte.
    if (count < 0 || count > (body.length - r.pos) / 2) return undefined;
    /** @type {boolean | undefined} */
    let found;
    for (let i = 0; i < count; i++) {
      const len = r.integer();
      if (len < 0 || len > body.length - r.pos - 1) return undefined;
      const key = r.bytes(len);
      const v = r.byte();
      if (v !== 0 && v !== 1) return undefined;
      if (found === undefined && key.equals(profileId)) found = v === 1;
    }
    if (r.pos !== body.length) return undefined;
    return found === undefined ? false : found;
  } catch (e) {
    return undefined;   // cut short: the reader ran off the end, so it is not a ProfileData<bool>
  }
}

module.exports = { profileBool };
