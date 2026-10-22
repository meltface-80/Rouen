// @ts-check
"use strict";
/*
 * smart-move.js — N2e-3b-3 (dev/design/native-remote.md §12.16, v1.9.61): Rouen's Dynamic Playlists moved onto Roon's
 * smart playlists, by themselves, as Listen Later's move (§10.4). The owner: "Roon's becomes the one copy"; "I want
 * this to work both ways".
 *
 *   Once a connection, and again whenever Rouen's own list changes (a playlist saved), each Dynamic Playlist in turn:
 *   mapped (focus-map.js, every filter Roon can hold, §12.15); one Roon can't hold stays Rouen's, its reason kept;
 *   one Roon already lists by that name with the same Focus is already moved (Folk, made by the test, §12.8); one of
 *   that name with another Focus stays, said; any other is made (smart-make.js, believed once every filter reads back).
 *   Moved or already there: `moved` is told (the route removes Rouen's copy, keeping it as a backup, and remembers
 *   Roon's PlaylistId, so the tile shows Roon's where Rouen's stood).
 *
 * One move at a time; each make in its turn (the maker's). Nothing here reads Rouen's settings or library.
 */
const { mapFocus } = require("./focus-map");

/**
 * @typedef {import("./focus-map").Dynamic & { id: string }} Dynamic
 * @typedef {{ sp: Dynamic, matched: number | null, unavailable: string | null }} Item
 * @typedef {{ id: string, name: string, result: "moved" | "already" | "kept" | "failed", why: string | null, roonId: string | null }} Done
 */

/**
 * @param {{ maker: () => ReturnType<typeof import("./smart-make").createSmartMaker> | null, on: () => boolean,
 *           connection: () => object | null, log?: (line: string) => void }} deps
 *   connection: the connection now (native mode's session), whose identity says when a new one has come
 */
function createSmartMove(deps) {
  const log = deps.log || (() => {});
  /** @type {WeakSet<object>} */
  const movedOn = new WeakSet();
  let changed = false;
  const st = { running: false, total: 0, /** @type {Done[]} */ done: [], /** @type {string | null} */ error: null };

  /**
   * @param {Item[]} items @param {(sp: Dynamic, roonId: string, how: "moved" | "already") => void} moved @param {any} maker
   * @param {(sp: Dynamic) => boolean} still  whether Rouen's own list still holds it as it was when the move began
   */
  async function moveAll(items, moved, maker, still) {
    st.running = true; st.total = items.length; st.done = []; st.error = null;
    try {
      for (const { sp, matched, unavailable } of items) {
        /** @param {Done["result"]} result @param {string | null} why @param {string | null} [roonId] */
        const said = (result, why, roonId = null) => { st.done.push({ id: sp.id, name: sp.name, result, why, roonId }); };
        // Deleted or edited since the move began (a make takes seconds): not sent as it was; the save that changed it moves
        // it again (the review).
        if (!still(sp)) { said("kept", "It changed while the move ran; Rouen moves it as it is now, next."); changed = true; continue; }
        const m = mapFocus(sp, matched, unavailable);
        if ("why" in m) { said("kept", m.why.join("; ")); continue; }
        const there = await maker.existing(sp.name, m.focus);
        // Not asked (the connection went, or is being checked): tried again at the next chance, as nothing was sent.
        if (there && "notSent" in there) { said("failed", there.notSent); changed = true; continue; }
        if (there && "other" in there) { said("kept", there.other); continue; }
        if (there && "id" in there) {
          moved(sp, there.id, "already");
          said("already", null, there.id);
          log(`"${sp.name}": Roon already holds it, with the same Focus; Rouen's own copy moved off`);
          continue;
        }
        const out = await maker.make(sp.name, m.focus);
        if (out.made === true && typeof out.id === "string") {
          moved(sp, out.id, "moved");
          said("moved", m.notes.length ? m.notes.join(" ") : null, out.id);
          log(`"${sp.name}": made in Roon; Rouen's own copy moved off`);
        } else if (out.made === true) {
          said("failed", "Your server made it, but Rouen couldn't read its id, so Rouen's own copy stays too. Look in Roon.");
        } else {
          said("failed", (out.why || ["Your server didn't make it."]).join(" "));
          // Not sent (the connection checked, a make already running, a genre not yet sent): tried again at the next chance.
          // One refused, or sent and not shown, waits for a change or a restart: the maker's own rule (§12.7.2).
          if (out.made === false && !(out.why || []).some((/** @type {string} */ w) => /refused it/.test(w))) changed = true;
        }
      }
    } finally {
      st.running = false;
    }
  }

  return {
    /** Rouen's own list changed (a playlist saved): the next chance moves again, on this connection too. */
    changed() { changed = true; },
    /**
     * The move, begun when there is something new to move: a connection it hasn't moved on, or Rouen's list changed.
     * @param {() => Item[]} items  Rouen's Dynamic Playlists as they are now, with their matches
     * @param {(sp: Dynamic, roonId: string, how: "moved" | "already") => void} moved
     * @param {(sp: Dynamic) => boolean} [still]  whether Rouen's list still holds it as it was (default: always)
     * @returns {{ running: true, total: number } | { idle: string }}
     */
    maybe(items, moved, still = () => true) {
      if (!deps.on()) return { idle: "Native mode is off." };
      if (st.running) return { idle: "A move is already running." };
      const c = deps.connection();
      const maker = deps.maker();
      if (!c || !maker) return { idle: "Native mode isn't connected to your server right now." };
      if (movedOn.has(c) && !changed) return { idle: "Nothing new to move." };
      movedOn.add(c);
      changed = false;
      const list = items();
      if (!list.length) return { idle: "Rouen has no Dynamic Playlists of its own." };
      moveAll(list, moved, maker, still).catch((e) => { st.error = "The move stopped: " + (e && e.message); log(st.error); });
      return { running: true, total: list.length };
    },
    /** How the last move stands. */
    progress: () => ({ running: st.running, total: st.total, done: st.done.map((d) => Object.assign({}, d)), error: st.error }),
  };
}

module.exports = { createSmartMove };
