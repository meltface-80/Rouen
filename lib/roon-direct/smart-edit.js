// @ts-check
"use strict";
/*
 * smart-edit.js — N2e-3b-4 (dev/design/native-remote.md §12.18, v1.9.66-t16): any of Roon's smart playlists edited
 * from Rouen, in Rouen's Dynamic Playlist editor — one made in Roon, or one Rouen moved there (the owner: "a playlist
 * created in Roon must be editable in Rouen. The same applies to Roon's Smart Playlists").
 *
 *   editable(roonId): its name and its Focus as the editor's view (focus-unmap.js), read from what the server has sent;
 *                     or why the editor can't show it whole. Asks the server nothing.
 *   save(roonId, name, view): the view mapped as a move maps it (focus-map.js), or refused, said why ("Roon's smart
 *                     playlists can't hold …", §12.13's answer 1); then Playlists::UpdatePlaylist, once, in §12.13's
 *                     proven form (the Playlist by reference; the parameters' Profile, Name and album Focus, and no
 *                     PlaylistId); believed once the playlist reads back, by its own object, with the name sent (a
 *                     rename is believed so, the owner's choice), smart, its profile kept, and every filter sent
 *                     (smart-make.js focusDiffers, the make's judge).
 *
 * A save starts from the Focus the editor was given, named by a stamp of its name and view in the target's id, so each
 * device's editor is its own: one changed in Roon since (its Focus or its name) is not overwritten (said, "open it
 * again"). An order and direction left as they were keep Roon's own (a Default direction stays Default). One sent and
 * not shown is not sent again until Rouen restarts, as the make's and the update's (§12.7.2). One save at a time, in
 * its turn with reads, hearts and searches.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, smartPlaylistArgs } = require("./methods");
const { BinaryWriter } = require("./wire");
const { isSmart, playlistsNow } = require("./playlists");
const { focusFields, genreList } = require("./focus");
const { readOrder } = require("./focus-write");
const { mapFocus } = require("./focus-map");
const { viewOf } = require("./focus-unmap");
const { createHash } = require("crypto");
const { genresSent, focusDiffers } = require("./smart-make");
const { ALBUM_QUERY_ORDERING } = require("./schemas");

const ID = /^[0-9a-f]{2,64}$/, STAMP = /^[0-9a-f]{12}$/;
const NAME_MAX = 200;

/**
 * @typedef {{ saved: true, name: string } | { saved: false, why: string, kind: "invalid" | "refused" | "stale" | "notSent" | "server" }
 *   | { saved: "unknown", why: string }} Saved
 */

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           profile: () => string | null, log?: (line: string) => void, settleMs?: number }} deps
 */
function createSmartEditor(deps) {
  const log = deps.log || (() => {});
  const settleMs = deps.settleMs || 15000;
  let busy = false;
  /** The playlists a save was sent for and not shown: none is sent again until Rouen restarts. */
  const unsure = new Set();
  /** What an editor was given, as a stamp: its name and its view. @param {string} name @param {Record<string, any>} view */
  const stampOf = (name, view) => createHash("sha1").update(JSON.stringify([name, view])).digest("hex").slice(0, 12);

  /** A profile's object id, as a playlist names it. @param {any} x */
  const profileOf = (x) => { const o = field(x, "Profile"); return isRef(o) ? o.$ref : null; };

  /**
   * The smart playlist of that PlaylistId, as the server lists it now, and its view; or why not.
   * @param {any} at  playlistsNow's @param {string} roonId
   * @returns {{ p: any, view: Record<string, any> } | { why: string, kind: "refused" | "stale" }}
   */
  function find(at, roonId) {
    const p = at.all.playlists.find((x) => { const id = field(x, "PlaylistId"); return Buffer.isBuffer(id) && id.toString("hex") === roonId; });
    if (!p) return { why: "Your server doesn't list this playlist now: it may have been deleted in Roon.", kind: "stale" };
    if (!isSmart(p)) return { why: "This playlist isn't one of your server's smart playlists.", kind: "refused" };
    // The parameters name a Profile: the playlist's own, or it isn't sent (smart-update.js, the review).
    const owner = profileOf(p);
    if (owner !== null && owner !== at.profile.oid) return { why: "This smart playlist belongs to another profile than the one chosen in Settings → Native mode.", kind: "refused" };
    const v = viewOf(at.s.graph, p);
    if ("why" in v) return { why: `Rouen's editor can't show this smart playlist whole: ${v.why.join("; ")}.`, kind: "refused" };
    return { p, view: v.view };
  }

  /**
   * Each genre's GenreLite: the one the playlist holds now, else the one the server has sent of that name; or why not.
   * @param {any} graph @param {any} p @param {string[]} names
   * @returns {{ oids: bigint[] } | { why: string }}
   */
  function genresFor(graph, p, names) {
    const f = focusFields(graph, p);
    const held = new Map();
    for (const g of (f && genreList(graph, f, "RequireGenreObjects")) || []) held.set(g.name, g.oid);
    for (const g of (f && genreList(graph, f, "ExcludeGenreObjects")) || []) held.set(g.name, g.oid);
    const sent = genresSent(graph);
    /** @type {bigint[]} */
    const oids = [];
    for (const name of names) {
      if (held.has(name)) { oids.push(held.get(name)); continue; }
      const found = sent.get(name) || [];
      if (found.length !== 1) return { why: found.length ? `Your server sent ${found.length} genres named "${name}"; Rouen can't tell them apart.` : `Your server hasn't sent Rouen the genre "${name}".` };
      oids.push(found[0]);
    }
    return { oids };
  }

  /**
   * Its order's other members, and its UiLanguage, as read (§12.2: Roon's own carry OrderVariousArtistsByAlbumTitle and a RandomSeed), each
   * encoded as declared, to be sent again as they were; or why one can't be.
   * @param {Record<string, any>} f  the Focus's members
   * @returns {{ kept: Array<[string, Buffer]>, seed: number, uiLanguage: string | undefined } | { why: string }}
   */
  function orderOf(f) {
    const k = Object.keys(f).find((x) => x.endsWith("::Ordering"));
    const v = k ? f[k] : null;
    /** @type {Array<[string, Buffer]>} */
    const kept = [];
    let seed = 0;   // left out at its default (§12.13)
    for (const [m, x] of Object.entries(v && typeof v === "object" ? v : {})) {
      const name = m.slice(m.lastIndexOf("::") + 2);
      if (m === "$type" || name === "Ordering" || name === "Direction") continue;
      if (name === "RandomSeed" && typeof x === "number") { seed = x; continue; }
      const decl = ALBUM_QUERY_ORDERING.members.find(([full]) => full.endsWith("::" + name));
      const w = new BinaryWriter();
      if (decl && decl[1] === 2 && typeof x === "boolean") w.boolean(x);
      else if (decl && (decl[1] === 9 || decl[1] === 0) && typeof x === "number") w.integer(x);
      else if (decl && decl[1] === 20 && typeof x === "string") w.string(x);
      else return { why: `Rouen can't carry over its order's ${name}, so it isn't saved.` };
      kept.push([decl[0], w.toBuffer()]);
    }
    // Its UiLanguage as it holds it, too (the review: never made "en").
    const ui = Object.keys(f).find((x) => x.endsWith("::UiLanguage"));
    return { kept, seed, uiLanguage: ui && typeof f[ui] === "string" ? f[ui] : undefined };
  }

  return {
    /**
     * The editor's target: its name and its Focus as the view, or why not.
     * @param {string} roonId  its PlaylistId, as Roon's list gives it (hex)
     * @returns {Promise<{ target: { id: string, name: string, view: Record<string, any>, roon: true } } | { why: string, kind: string } | { notSent: string }>}
     */
    editable: (roonId) => deps.inTurn(async () => {
      if (typeof roonId !== "string" || !ID.test(roonId)) return { why: "Which smart playlist?", kind: "invalid" };
      const at = playlistsNow(deps);
      if ("notSent" in at) return { notSent: at.notSent };
      const r = find(at, roonId);
      if ("why" in r) return r;
      const name = String(field(r.p, "Name"));
      return { target: { id: `roon:${roonId}.${stampOf(name, r.view)}`, name, view: r.view, roon: true } };
    }),

    /**
     * Saved in Roon, once, and believed once it reads back as sent.
     * @param {string} target  the target's id less "roon:": its PlaylistId, then the stamp of what its editor was given
     * @param {string} name @param {Record<string, any>} view  the editor's
     * @returns {Promise<Saved>}
     */
    async save(target, name, view) {
      const [roonId, stamp] = String(target || "").split(".");
      if (!ID.test(roonId)) return { saved: false, why: "Which smart playlist?", kind: "invalid" };
      const trimmed = String(name || "").trim();
      if (!trimmed || trimmed.length > NAME_MAX) return { saved: false, why: "Give it a name.", kind: "invalid" };
      if (!view || typeof view !== "object") return { saved: false, why: "Nothing to save.", kind: "invalid" };
      if (busy) return { saved: false, why: "A save is already running: try again in a moment.", kind: "notSent" };
      if (unsure.has(roonId)) return { saved: false, why: "A save of this playlist was sent and not shown. Look in Roon: restart Rouen to try again.", kind: "stale" };
      // Mapped as a move maps it, every filter Roon can hold; one it can't is never sent approximately (§12.13).
      const m = mapFocus({ name: trimmed, view, limit: undefined }, null, null);
      if ("why" in m) return { saved: false, why: `Roon's smart playlists can't hold ${m.why.join("; ")}. It stays as it is in Roon.`, kind: "refused" };
      busy = true;
      try {
        const sent = await deps.inTurn(async () => {
          const at = playlistsNow(deps);
          if ("notSent" in at) return { saved: false, why: at.notSent, kind: "notSent" };
          const r = find(at, roonId);
          if ("why" in r) return { saved: false, why: r.why, kind: r.kind };
          // Changed in Roon since this editor was given it, its Focus or its name: not overwritten.
          if (!STAMP.test(stamp || "") || stamp !== stampOf(String(field(r.p, "Name")), r.view)) {
            return { saved: false, why: "This smart playlist changed in Roon since you opened it: open it again.", kind: "stale" };
          }
          if (at.all.playlists.some((x) => x !== r.p && field(x, "Name") === trimmed)) {
            return { saved: false, why: `Your server already has a playlist named "${trimmed}".`, kind: "refused" };
          }
          const focus = m.focus;
          const f = /** @type {Record<string, any>} */ (focusFields(at.s.graph, r.p));
          const kept = orderOf(f);
          if ("why" in kept) return { saved: false, why: kept.why, kind: "refused" };
          // Its order left as it was keeps Roon's own direction and shuffle: a Default (0) stays Default, never made Ascending.
          if (String(view.sort) === r.view.sort && String(view.dir) === r.view.dir) {
            const o = readOrder(f);
            if (o) focus.direction = o.direction;
            if (focus.seed !== null) focus.seed = kept.seed;
          }
          const inc = genresFor(at.s.graph, r.p, focus.include), exc = genresFor(at.s.graph, r.p, focus.exclude);
          if ("why" in inc) return { saved: false, why: inc.why, kind: "refused" };
          if ("why" in exc) return { saved: false, why: exc.why, kind: "refused" };
          // §12.13's form, proven: the Playlist by reference, then the parameters with no PlaylistId.
          const args = Buffer.concat([new BinaryWriter().long(r.p.oid).toBuffer(), smartPlaylistArgs(at.s.g, at.profile.oid, trimmed,
            { ordering: focus.ordering, direction: focus.direction, seed: focus.seed, require: inc.oids, exclude: exc.oids, extra: focus.extra, kept: kept.kept,
              uiLanguage: kept.uiLanguage })]);
          const was = String(field(r.p, "Name"));
          // Read before the send: the server's push after it changes this same object in place (the review's break test).
          const profile = profileOf(r.p);
          log(`saving the smart playlist "${was}"${was === trimmed ? "" : ` as "${trimmed}"`} (${focus.include.length} genre(s) required, ${focus.exclude.length} excluded, order ${focus.sort})`);
          /** @type {{ success: boolean, status?: string }} */
          let res;
          try { res = await at.s.g.call(at.all.svc.oid, SIG.updateSmartPlaylist, args); }
          catch (e) {
            unsure.add(roonId);
            const msg = /** @type {any} */ (e).message;
            log(`the save of "${was}" failed, with no answer read: ${msg}`);
            return { saved: "unknown", why: `Your server didn't answer (${msg}). Look in Roon before trying again.` };
          }
          if (!res.success) return { saved: false, why: `Your server refused it ("${res.status}").`, kind: "server" };
          return { s: at.s, p: r.p, focus, profile, chosen: at.profile.oid };
        });
        if (!("s" in sent)) return /** @type {Saved} */ (sent);
        // Believed by its own object, never another of its name: the name sent, smart, its profile kept, and every filter.
        const shown = await waitFor(settleMs, () => {
          const x = sent.s.graph.get(sent.p.oid);
          // Its profile kept: or, for one that named none, the one the parameters named (the review).
          if (!x || !x.loaded) return undefined;
          const owner = profileOf(x);
          if (field(x, "Name") !== trimmed || !isSmart(x) || (owner !== sent.profile && !(sent.profile === null && owner === sent.chosen))) return undefined;
          return focusDiffers(sent.s.graph, x, sent.focus).other === null ? x : undefined;
        });
        if (!shown) {
          unsure.add(roonId);
          log(`the save of "${trimmed}" was taken and not shown within ${settleMs / 1000} s`);
          return { saved: "unknown", why: "Your server took it, but the playlist didn't read back as sent. Look in Roon before trying again." };
        }
        log(`the smart playlist "${trimmed}" saved`);
        return { saved: true, name: trimmed };
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createSmartEditor };
