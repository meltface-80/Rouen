// @ts-check
"use strict";
/*
 * profile-probe.js — a Roon profile made and renamed, tried once by hand before anything is built on it (P3-probe,
 * dev/design/profiles.md §13.6). The owner, 2026-11-26: "I want Roon profiles to show up in Rouen. I want Rouen created
 * profiles to show in Roon. Two way".
 *
 * In the connection's turn, on the session native mode holds then:
 *   1. read-only: the server's profiles, and how many of the playlists this connection holds belong to each
 *      (Playlist::Profile; §13.5 asks whether the graph carries every profile's playlists or only one's);
 *   2. Account::CreateProfile(ProfileCreate { Name: "Rouen probe <time>" }) on the root graph's Account (catalogue only),
 *      and the Profile its answer names, waited for;
 *   3. Profile::Edit(ProfileEdit { Name: "… renamed" }) on that Profile (catalogue only), and its Name read back.
 * Rouen never deletes a profile (§13.1, 7): the one made is left for the owner to delete in Roon, and the answer says so
 * from the moment it exists. A run within ten minutes of the last is refused, so a link followed again or a URL a
 * browser preloads makes no second profile (the review). Nothing of the Account is reported (withhold.js): only that it
 * was found, and whether its own list of profiles names the one made.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, inlineStruct } = require("./methods");
const { BinaryWriter, readFlexLong } = require("./wire");
const { PROFILE_CREATE, PROFILE_EDIT } = require("./schemas");

const NAME = "Rouen probe";
const CREATE_NAME = "string Sooloos.Broker.Api.ProfileCreate::Name";
const EDIT_NAME = "string Sooloos.Broker.Api.ProfileEdit::Name";
const AGAIN_MS = 10 * 60 * 1000;

/** @param {string} v */
const str = (v) => new BinaryWriter().string(v).toBuffer();
/** @param {unknown} e */
const said = (e) => String((e && /** @type {any} */ (e).message) || e);

/**
 * The server's profiles on this connection's graph: each with an id, by its object id.
 * @param {any} graph @returns {Array<{ oid: bigint, id: string, name: string }>}
 */
function profilesIn(graph) {
  return graph.ofType("Profile").filter((/** @type {any} */ p) => Buffer.isBuffer(field(p, "ProfileId")))
    .map((/** @type {any} */ p) => ({ oid: p.oid, id: field(p, "ProfileId").toString("hex"), name: String(field(p, "Name") || "(unnamed)") }));
}

/**
 * How many of the playlists this connection holds name each profile as theirs (Playlist::Profile), by the profile's id,
 * so two profiles of one name stay two (the review): `byProfile`, each with its name; `noProfile`, those whose member is
 * missing; `elsewhere`, those naming an object that is not a profile with an id on this graph.
 * @param {any} graph
 * @returns {{ byProfile: Array<{ id: string, name: string, playlists: number }>, noProfile: number, elsewhere: number }}
 */
function playlistsByProfile(graph) {
  const byProfile = profilesIn(graph).map((p) => ({ oid: p.oid, id: p.id, name: p.name, playlists: 0 }));
  let noProfile = 0, elsewhere = 0;
  for (const p of graph.ofType("Playlist")) {
    if (!Buffer.isBuffer(field(p, "PlaylistId"))) continue;
    const ref = field(p, "Profile");
    const who = isRef(ref) ? byProfile.find((x) => x.oid === ref.$ref) : null;
    if (who) who.playlists++;
    else if (isRef(ref)) elsewhere++;
    else noProfile++;
  }
  return { byProfile: byProfile.map(({ id, name, playlists }) => ({ id, name, playlists })), noProfile, elsewhere };
}

/**
 * Whether the Account's own list of profiles (Account::Profiles), as this connection holds it, names an object: true,
 * false, or null when the Account carries no such list here.
 * @param {any} graph @param {any} account @param {bigint} oid @returns {boolean | null}
 */
function accountLists(graph, account, oid) {
  const ref = field(graph.get(account.oid) || account, "Profiles");
  const list = isRef(ref) ? graph.get(ref.$ref) : null;
  const items = list && Array.isArray(list.fields.$items) ? list.fields.$items : Array.isArray(ref) ? ref : null;
  return items ? items.some((/** @type {any} */ x) => isRef(x) && x.$ref === oid) : null;
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           playlists?: { list(): Promise<any> } | null, log?: (line: string) => void, timeoutMs?: number,
 *           now?: () => Date }} deps
 *   playlists: listed first, so the graph holds the server's playlists before they are counted
 */
function createProfileProbe(deps) {
  const log = deps.log || (() => {});
  const timeoutMs = deps.timeoutMs ?? 15000;
  const now = deps.now || (() => new Date());
  let busy = false;
  /** When a run last sent CreateProfile, ms. */
  let sentAt = -Infinity;

  /** @param {any} s @param {string} name @param {any} out @param {string | null} unread  why the playlists weren't read */
  async function tryIt(s, name, out, unread) {
    const { g, graph } = s;
    out.profiles = profilesIn(graph).map((p) => p.name);
    out.playlistsByProfile = unread ? { unread } : playlistsByProfile(graph);
    const account = graph.ofType("Account")[0];
    if (!account) { out.create = "not tried: your server sent this connection no Account object"; return; }
    out.steps.push({ step: "Account", found: true });

    sentAt = now().getTime();
    out.left = `Look for "${name}" in Roon → Settings → Profiles, and delete it there if it was made.`;
    const made = await g.call(account.oid, SIG.createProfile, inlineStruct(g, PROFILE_CREATE, [[CREATE_NAME, str(name)]]));
    out.steps.push({ step: "CreateProfile (catalogue only)", name, answer: { success: made.success, status: String(made.status) } });
    if (!made.success) { out.create = `refused ("${made.status}")`; out.left = "Nothing was made."; return; }
    const ref = readFlexLong(made.payload, 0);
    const oid = ref && ref[0] >= 2n ? ref[0] : null;
    const p = oid === null ? null : await waitFor(timeoutMs, () => {
      const x = graph.get(oid);
      return x && x.loaded && Buffer.isBuffer(field(x, "ProfileId")) ? x : undefined;
    });
    if (!p) { out.create = oid === null ? "answered Success, but named no profile" : "answered Success, but the profile it named never arrived"; return; }
    const gotName = String(field(p, "Name"));
    out.create = gotName === name ? "made, named as asked" : `made, but named "${gotName}"`;
    // Said now, before the rename, so a rename that throws still leaves the owner told what to delete (the review).
    out.left = `Delete "${gotName}" in Roon → Settings → Profiles: Rouen never deletes a profile.`;
    // Waited for only when the Account carries a list here; null says it carries none.
    const onTheAccountsList = accountLists(graph, account, p.oid) === null ? null
      : (await waitFor(timeoutMs, () => (accountLists(graph, account, p.oid) ? true : undefined))) || false;
    out.steps.push({ step: "the profile made", id: field(p, "ProfileId").toString("hex"), name: gotName, onTheAccountsList });

    const renamed = `${name} renamed`;
    const ed = await g.call(p.oid, SIG.editProfile, inlineStruct(g, PROFILE_EDIT, [[EDIT_NAME, str(renamed)]]));
    const shown = ed.success ? await waitFor(timeoutMs, () => (field(graph.get(p.oid), "Name") === renamed ? true : undefined)) : null;
    out.steps.push({ step: "Edit (catalogue only)", name: renamed, answer: { success: ed.success, status: String(ed.status) },
      nameReadBack: String(field(graph.get(p.oid), "Name")) });
    out.rename = !ed.success ? `refused ("${ed.status}")` : shown ? "renamed, and shown on this connection"
      : "answered Success, but the new name didn't show on this connection: check it in Roon";
    if (shown) out.left = `Delete "${renamed}" in Roon → Settings → Profiles: Rouen never deletes a profile.`;
  }

  return {
    /** @returns {Promise<any>} each step, or { error, status } when nothing could be tried */
    async run() {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A probe is already running.", status: 409 };
      if (now().getTime() - sentAt < AGAIN_MS) {
        return { error: "The profile probe ran less than ten minutes ago, and each run makes a profile in Roon: run it again later.", status: 409 };
      }
      busy = true;
      const name = `${NAME} ${now().toISOString().slice(11, 19)}`;
      const out = { design: "dev/design/profiles.md §13.6", name, steps: /** @type {any[]} */ ([]), profiles: /** @type {string[]} */ ([]),
        playlistsByProfile: /** @type {any} */ ({}), create: "not tried", rename: "not tried", left: "Nothing was made." };
      try {
        // The playlists read first (outside the turn: list() takes it), so they are on the graph to be counted; a read
        // that couldn't be made says why, and the count is not given (the review).
        /** @type {string | null} */
        let unread = null;
        if (deps.playlists) {
          try {
            const l = await deps.playlists.list();
            if (!l || !Array.isArray(l.playlists)) unread = String((l && (l.notSent || l.error)) || "Your server's playlists weren't read.");
          } catch (e) { unread = said(e); }
          if (unread) out.steps.push({ step: "playlists listed", error: unread });
        }
        const ran = await deps.inTurn(async () => {
          // The session taken inside the turn, so a reconnect while the probe waited for it is never written to (the review).
          const s = deps.link ? deps.link.session() : null;
          if (!s) return false;
          try {
            await tryIt(s, name, out, unread);
          } catch (e) {
            // A call never answered, or refused by throwing: said with the steps so far; `left` already says where to look.
            out.steps.push({ step: "trial", error: said(e) });
          }
          return true;
        });
        if (!ran) return { error: "Native mode isn't connected to your server right now.", status: 503 };
        log(`profile probe: create ${out.create}; rename ${out.rename}`);
        return out;
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createProfileProbe, profilesIn, playlistsByProfile };
