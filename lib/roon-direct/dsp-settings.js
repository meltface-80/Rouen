// @ts-check
"use strict";
/*
 * dsp-settings.js — N3-5a (dev/design/native-remote.md §15.12, v1.9.66-t12): a DSP item's settings changed on its part
 * — Headroom's gain and clipping indicator; Crossfeed's preset, cut frequency and feed level; Sample rate conversion's
 * mode, filter, DSD to PCM filter, and a custom rule's output rate — as Roon's own apps do.
 *
 * Each change is sent once, in the connection's turn, only for an item of an output of the zone (zone-dsp.js locate),
 * on that item's own part (or a rule of its own), with a value the part as held allows (dsp-parts.js); believed only
 * when the part shows it within WAIT_MS. Never sent twice; there is no official API to fall back to.
 *
 * A change answers one of:
 *   { seen: true, item }   sent, and the server showed it (the item, with its settings, as it now holds it)
 *   { notSent: why }       nothing reached the server
 *   { seen: false, why }   sent (or maybe sent), not shown in time: said, not sent again
 */
const { SIG } = require("./methods");
const { settingsOf, SETTINGS, RULE } = require("./dsp-parts");
const { withSettings } = require("./zone-dsp");
const { failed, turnRunner } = require("./zone-controls");

const WAIT_MS = 3000, POLL_MS = 100, TURN_MS = 500;
const ID = /^\d{1,20}$/;

/**
 * @param {{ zoneDsp: { locate(zoneId: string, itemId: string): Promise<{ here: true } | { notSent: string }> },
 *           link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           log?: (line: string) => void, now?: () => number, waitMs?: number, pollMs?: number, turnMs?: number }} deps
 */
function createDspSettings(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const waitMs = deps.waitMs ?? WAIT_MS, pollMs = deps.pollMs ?? POLL_MS, turnMs = deps.turnMs ?? TURN_MS;
  const inTurn = turnRunner(deps);

  return {
    /**
     * One setting of one item.
     * @param {string} zoneId @param {string} itemId  as read @param {string} setting  a SETTINGS key, or "src.rule"
     * @param {any} value @param {string} [ruleId]  for "src.rule": the rule, as read
     */
    async set(zoneId, itemId, setting, value, ruleId) {
      if (!deps.on()) return { notSent: "Native mode is off." };
      if (typeof itemId !== "string" || !ID.test(itemId)) return { notSent: "Which DSP item?" };
      const isRule = setting === "src.rule";
      const def = isRule ? null : Object.prototype.hasOwnProperty.call(SETTINGS, setting) ? SETTINGS[setting] : null;
      if (!isRule && !def) return { notSent: "Which setting?" };
      if (isRule && (typeof ruleId !== "string" || !ID.test(ruleId))) return { notSent: "Which sample rate?" };
      const where = await deps.zoneDsp.locate(zoneId, itemId);
      if ("notSent" in where) return where;
      /** @type {any} */
      const sent = await inTurn(async (s) => {
        const item = s.graph.get(BigInt(itemId));
        const st = item && item.loaded ? settingsOf(s.graph, item) : null;
        if (!st || st.kind !== (isRule ? "src" : /** @type {any} */ (def).kind)) return { notSent: "That item has no such setting." };
        let target, why, sig, args;
        if (isRule) {
          const rule = st.rules.find((/** @type {any} */ r) => r.id === ruleId);
          // a rule is changed only in custom mode, where the part lists them (§15.12)
          if (!rule) return { notSent: "That sample rate can be changed in custom mode only." };
          why = RULE.ok(rule, value); target = BigInt(rule.id); sig = RULE.sig; args = () => RULE.args(value);
        } else {
          const d = /** @type {any} */ (def);
          why = d.ok(st, value); target = BigInt(st.part); sig = d.sig; args = () => d.args(value);
        }
        if (why) return { notSent: why };
        try {
          const res = await s.g.call(target, /** @type {any} */ (SIG)[sig], args());
          if (!res.success) return { notSent: `Your server refused it (${res.status}).` };
        } catch (e) {
          // An answered call that never came back may still have been taken: watched for, never assumed not sent.
          return failed(e);
        }
        return { sent: true };
      }, turnMs);
      if (sent.notSent) return { notSent: sent.notSent };
      for (const until = now() + waitMs; ;) {
        const s = deps.link ? deps.link.session() : null;
        const item = s && s.graph ? s.graph.get(BigInt(itemId)) : null;
        const st = item && item.loaded ? settingsOf(s.graph, item) : null;
        const rule = st && isRule ? st.rules.find((/** @type {any} */ r) => r.id === ruleId) : null;
        const shown = st && (isRule ? rule && RULE.shows(rule, value) : /** @type {any} */ (def).shows(st, value));
        if (shown) return { seen: true, item: withSettings(s.graph, item) };
        if (now() >= until) break;
        await new Promise((r) => { setTimeout(r, pollMs); });
      }
      const why = (sent.maybe ? sent.maybe + " " : "") + `Your server took it, but the item didn't show it within ${Math.round(waitMs / 1000)} s.`;
      log(`zone dsp setting ${setting}: sent, not seen: ${why}`);
      return { seen: false, why };
    },
  };
}

module.exports = { createDspSettings };
