// @ts-check
"use strict";
/*
 * turns.js — one thing at a time on the session's graph (v1.9.27, the review; moved out of stage1.js unchanged in
 * 2.0.7-t4): a read and a heart each watch what the Core pushes, and two at once blinded each other. Reads and hearts
 * take their turn here.
 */

/** @returns {<T>(fn: () => Promise<T>) => Promise<T>} */
function createTurns() {
  /** @type {Promise<unknown>} */
  let turn = Promise.resolve();
  let inUse = 0;
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (fn) => {
    /** Started now when nothing else is: a read begins in the call that asked for it, as always. */
    const now_ = () => { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } };
    const p = inUse === 0 ? now_() : turn.then(fn, fn);
    inUse++;
    turn = p.then(() => {}, () => {}).then(() => { inUse--; });   // the next waits for this one, whatever became of it
    return p;
  };
  return inTurn;
}

module.exports = { createTurns };
