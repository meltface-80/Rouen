// @ts-check
"use strict";
/*
 * peq.js — N3-5c (dev/design/native-remote.md §15.15, v1.9.66-t15): a zone's Parametric EQ in the DSP window — each
 * band's gain, frequency and Q, and each band on or off (the owner's choice) — read and changed as the server holds it.
 *
 * The server never tells a connection that a spec changed, MUSE's change or Rouen's own (§15.13, §15.14). So, the
 * owner's choice: the spec is read afresh on a short connection of its own (peq-fresh.js) to be shown; before a change,
 * so the change is made on the spec as it is now and a band changed in MUSE meanwhile is not put back; and after it,
 * to be believed. A change is the spec whole with one band's one setting changed (peq-spec.js), within the owner's
 * bounds, written with the members the server declared and read back before it is sent:
 * ParametricEqualizerItem::SetSpec(spec, true), once, in the link's turn, only for an item of an output of the zone
 * (zone-dsp.js locate). Never sent twice. Changes to one EQ are made one at a time, read to read (the review: two close
 * together would otherwise each send the spec as it was before the other, and the second undo the first).
 *
 * A request that can't be met (not an EQ, a setting the band hasn't, a value out of bounds) is said `invalid` too: the
 * route answers it 400, not as the server unreachable (the review).
 *
 * A change answers one of:
 *   { seen: true, item }   sent, and the spec read afterwards shows it (the item, its bands as then read)
 *   { notSent: why }       nothing reached the server
 *   { seen: false, why }   sent (or maybe sent), not shown by the spec read afterwards: said, not sent again
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { declared, bandsOf, check, changed, shows, get, encode, BAND_SETTINGS } = require("./peq-spec");
const { peqPartOf } = require("./peq-fresh");
const { failed, turnRunner } = require("./zone-controls");

const TURN_MS = 500;
const ID = /^\d{1,20}$/;

/**
 * The item as the window shows it: its EQ's own gain (shown, not changed) and its bands.
 * @param {string} itemId @param {Record<string, any>} spec
 */
const viewOf = (itemId, spec) => ({ id: itemId, gain: typeof get(spec, "GainDb") === "number" ? get(spec, "GainDb") : 0, bands: bandsOf(spec) || [] });

/**
 * @param {{ zoneDsp: { locate(zoneId: string, itemId: string): Promise<{ here: true, common?: string } | { notSent: string }> },
 *           fresh: { read(configOid: string, partOid: string): Promise<{ spec: Record<string, any> } | { why: string }> },
 *           link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           log?: (line: string) => void, turnMs?: number }} deps
 */
function createPeq(deps) {
  const log = deps.log || (() => {});
  const turnMs = deps.turnMs ?? TURN_MS;
  const inTurn = turnRunner(deps);
  /** Each EQ's last change, so the next waits for it: by its part. @type {Map<string, Promise<any>>} */
  const busy = new Map();

  /**
   * One change to an EQ at a time, after the one before it, whatever that answered.
   * @template T @param {string} part @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  function inOrder(part, fn) {
    const run = (busy.get(part) || Promise.resolve()).then(fn);
    const tail = run.then(() => undefined, () => undefined);
    busy.set(part, tail);
    tail.then(() => { if (busy.get(part) === tail) busy.delete(part); });
    return run;
  }

  /**
   * Where an item's EQ is read: the output's CommonConfig, and the item's Parametric EQ part, as the link holds it.
   * @param {string} zoneId @param {string} itemId
   * @returns {Promise<{ common: string, part: string } | { notSent: string, invalid?: true }>}
   */
  async function whereIs(zoneId, itemId) {
    if (!deps.on()) return { notSent: "Native mode is off." };
    if (typeof itemId !== "string" || !ID.test(itemId)) return { notSent: "Which DSP item?", invalid: true };
    const where = await deps.zoneDsp.locate(zoneId, itemId);
    if ("notSent" in where) return where;
    if (!where.common) return { notSent: "Rouen couldn't tell which output this EQ is on." };
    /** @type {any} */
    const part = await inTurn(async (s) => peqPartOf(s.graph.get(BigInt(itemId))) || { notSent: "That DSP item isn't a Parametric EQ.", invalid: true }, turnMs);
    if (typeof part === "string") return { common: where.common, part };
    return part.invalid ? { notSent: part.notSent, invalid: true } : { notSent: part.notSent };
  }

  /**
   * One change, after the EQ's one before it (inOrder).
   * @param {string} itemId @param {{ common: string, part: string }} w @param {number} band @param {string} setting @param {any} value
   */
  async function change(itemId, w, band, setting, value) {
    // the spec as the server holds it now (the owner's choice, §15.15): never one older than a change made in MUSE
    const before = await deps.fresh.read(w.common, w.part);
    if ("why" in before) return { notSent: before.why };
    const invalid = check(before.spec, band, setting, value);
    if (invalid) return { notSent: invalid, invalid: true };
    /** @type {any} */
    const sent = await inTurn(async (s) => {
      let bytes;
      try {
        if (!declared(s.graph, String(before.spec.$type))) return { notSent: "Your server hasn't declared a Parametric EQ's spec on this connection." };
        // read back before anything is sent: bytes that don't hold the spec meant are never sent (peq-spec.js encode)
        bytes = encode(s.g, s.graph, changed(s.graph, before.spec, band, setting, value));
      } catch (e) {
        return { notSent: String(e && /** @type {any} */ (e).message) };
      }
      try {
        const res = await s.g.call(BigInt(w.part), SIG.dspPeqSpec, Buffer.concat([bytes, new BinaryWriter().boolean(true).toBuffer()]));
        if (!res.success) return { notSent: `Your server refused it (${res.status}).` };
      } catch (e) {
        // An answered call that never came back may still have been taken: read afterwards, never sent again.
        return failed(e);
      }
      return { sent: true };
    }, turnMs);
    if (sent.notSent) return { notSent: sent.notSent };
    const after = await deps.fresh.read(w.common, w.part);
    if (!("why" in after) && shows(after.spec, band, setting, value)) return { seen: true, item: viewOf(itemId, after.spec) };
    const why = (sent.maybe ? sent.maybe + " " : "") + ("why" in after ? `Sent, but ${after.why[0].toLowerCase()}${after.why.slice(1)}`
      : "Your server took it, but the EQ read afterwards doesn't show it.");
    log(`zone peq band ${band} ${setting}: sent, not seen: ${why}`);
    return Object.assign({ seen: false, why }, "why" in after ? {} : { item: viewOf(itemId, after.spec) });
  }

  return {
    /**
     * A zone's Parametric EQ item, read afresh.
     * @param {string} zoneId @param {string} itemId
     */
    async read(zoneId, itemId) {
      const w = await whereIs(zoneId, itemId);
      if ("notSent" in w) return Object.assign({ why: w.notSent }, w.invalid ? { invalid: true } : {});
      const r = await deps.fresh.read(w.common, w.part);
      return "why" in r ? { why: r.why } : { item: viewOf(itemId, r.spec) };
    },

    /**
     * One band's one setting: gain, frequency, q or on.
     * @param {string} zoneId @param {string} itemId @param {number} band  from 1 @param {string} setting @param {any} value
     */
    async set(zoneId, itemId, band, setting, value) {
      if (!Object.prototype.hasOwnProperty.call(BAND_SETTINGS, setting)) return { notSent: "Which setting?", invalid: true };
      const w = await whereIs(zoneId, itemId);
      if ("notSent" in w) return w;
      return inOrder(w.part, () => change(itemId, w, band, setting, value));
    },
  };
}

module.exports = { createPeq, viewOf };
