// @ts-check
"use strict";
/*
 * profile-write.js — a Roon profile made, and renamed, for a Rouen profile (dev/design/profiles.md §13.2, P3b). The owner,
 * 2026-11-26: "A Rouen profile becomes a Roon profile." The two calls were proven on the owner's server by the P3-probe
 * (2026-11-26 19:45): Account::CreateProfile, its Profile then on the Account's own list; Profile::Edit, its new Name read
 * back. Each is believed only when the server shows it. Rouen never deletes a profile (§13.1, 7).
 */
const { field, waitFor } = require("./objects");
const { SIG, inlineStruct } = require("./methods");
const { BinaryWriter, readFlexLong } = require("./wire");
const { PROFILE_CREATE, PROFILE_EDIT } = require("./schemas");
const { liveProfiles } = require("./session");

const CREATE_NAME = "string Sooloos.Broker.Api.ProfileCreate::Name";
const EDIT_NAME = "string Sooloos.Broker.Api.ProfileEdit::Name";
/** @param {string} v */
const str = (v) => new BinaryWriter().string(v).toBuffer();

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           log?: (line: string) => void, timeoutMs?: number }} deps
 */
function createProfileWriter(deps) {
  const log = deps.log || (() => {});
  const timeoutMs = deps.timeoutMs ?? 15000;
  /** The session to write on, or why there is none. @returns {{ notSent: string } | { s: any }} */
  const sessionNow = () => {
    if (!deps.on()) return { notSent: "Native mode isn't in use, so Roon can't be asked." };
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { notSent: "Native mode isn't connected to your server right now." };
    if (s.g.uncertain && s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
    return { s };
  };

  return {
    /**
     * A Roon profile of this name, made and waited for. @param {string} name
     * @returns {Promise<{ id: string, name: string } | { notSent: string } | { error: string }>}
     */
    create: (name) => deps.inTurn(async () => {
      const at = sessionNow();
      if ("notSent" in at) return { notSent: at.notSent };
      const { g, graph, root } = at.s;
      const account = graph.ofType("Account")[0];
      if (!account) return { notSent: "Your server sent no Account to make a profile on." };
      const res = await g.call(account.oid, SIG.createProfile, inlineStruct(g, PROFILE_CREATE, [[CREATE_NAME, str(name)]]));
      if (!res.success) return { error: `Roon refused the new profile ("${res.status}").` };
      const ref = readFlexLong(res.payload, 0);
      const oid = ref && ref[0] >= 2n ? ref[0] : null;
      const p = oid === null ? null : await waitFor(timeoutMs, () => {
        const x = graph.get(oid);
        return x && x.loaded && Buffer.isBuffer(field(x, "ProfileId")) ? x : undefined;
      });
      if (!p) return { error: `Roon took "${name}" but didn't send the profile back: look in Roon → Settings → Profiles.` };
      root.profiles = liveProfiles(at.s);   // on the list every write reads, at once
      const id = field(p, "ProfileId").toString("hex");
      log(`[profiles] made in Roon: "${name}"`);
      return { id, name: String(field(p, "Name") || name) };
    }),

    /**
     * A Roon profile renamed, believed when its Name reads back. @param {string} id  its ProfileId (hex) @param {string} name
     * @returns {Promise<{ ok: true } | { notSent: string } | { error: string }>}
     */
    rename: (id, name) => deps.inTurn(async () => {
      const at = sessionNow();
      if ("notSent" in at) return { notSent: at.notSent };
      const { g, graph } = at.s;
      const p = liveProfiles(at.s).find((x) => Buffer.isBuffer(field(x, "ProfileId")) && field(x, "ProfileId").toString("hex") === id);
      if (!p) return { notSent: "That Roon profile isn't on your server now." };
      if (field(p, "Name") === name) return { ok: true };
      const res = await g.call(p.oid, SIG.editProfile, inlineStruct(g, PROFILE_EDIT, [[EDIT_NAME, str(name)]]));
      if (!res.success) return { error: `Roon refused the new name ("${res.status}").` };
      const shown = await waitFor(timeoutMs, () => (field(graph.get(p.oid), "Name") === name ? true : undefined));
      if (!shown) return { error: "Roon took the new name but didn't show it: look in Roon → Settings → Profiles." };
      log(`[profiles] renamed in Roon: "${name}"`);
      return { ok: true };
    }),
  };
}

module.exports = { createProfileWriter };
