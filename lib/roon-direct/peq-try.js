// @ts-check
"use strict";
/*
 * peq-try.js — N3-5b (dev/design/native-remote.md §15.14, v1.9.66-t14): one change to a zone's Parametric EQ, tried by
 * hand before anything is built on it, as smart-update.js's was (§12.9).
 *
 * A parametric EQ is changed whole: ParametricEqualizerItem::SetSpec(ParametricEqualizerSpec, bool) carries every band.
 * So the spec sent is the one Rouen holds, with one band's gain changed; and Rouen's copy is as the server sent it when
 * Rouen asked, not as MUSE has changed it since (§15.13). The preview shows the bands held and the spec it would send,
 * to be compared with MUSE; it sends nothing — not even a type's declaration (the review). With send=1, sent once.
 *
 * The spec is written with the members the owner's server itself declared for it (the graph's types, in its order),
 * each band an inline value as it came. Two checks before anything is sent: the bands held, written again under the
 * server's own type ids, are the very bytes it sent (else Rouen didn't read them whole, and won't send them back
 * short: the review); and the spec written reads back, by the same reader, as the spec meant. What came back — the
 * call's answer, and each update of the item for WAIT_MS after — is said, for the design (§15.13).
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { field, isRef, shortType } = require("./objects");
const { deep } = require("./deep-value");
const { keyOf, local, plainOf, said, shortly, check, changed, encode } = require("./peq-spec");
const { failed, turnRunner } = require("./zone-controls");

const WAIT_MS = 5000, TURN_MS = 500;


/**
 * @param {{ zoneDsp: { read(zoneId: string): Promise<any> }, link: { session(): any } | null,
 *           inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean, zones: () => any[], log?: (line: string) => void,
 *           waitMs?: number, turnMs?: number }} deps
 */
function createPeqTry(deps) {
  const log = deps.log || (() => {});
  const waitMs = deps.waitMs ?? WAIT_MS, turnMs = deps.turnMs ?? TURN_MS;
  const inTurn = turnRunner(deps);
  let busy = false;

  /**
   * The zone's one Parametric EQ item, as a read on this connection finds it.
   * @param {string} zone  its name or id
   */
  async function find(zone) {
    const z = (deps.zones() || []).find((x) => x.zone_id === zone || x.display_name === zone);
    if (!z) return { error: `No zone called ${zone} now.` };
    const d = await deps.zoneDsp.read(z.zone_id);
    if (!d.native) return { error: d.why || "Native mode is off." };
    if (!d.found) return { error: d.why || "Your server doesn't list that zone now." };
    const peqs = (d.outputs || []).flatMap((/** @type {any} */ o) => (o.items || []).filter((/** @type {any} */ it) => it.name === "Parametric EQ")
      .map((/** @type {any} */ it) => ({ output: o.output, item: it.id })));
    // an output not read says why, rather than its EQ said absent (the review)
    const unread = (d.outputs || []).find((/** @type {any} */ o) => o.why);
    if (!peqs.length && unread) return { error: `${unread.output}: ${unread.why}` };
    if (peqs.length !== 1) return { error: peqs.length ? "That zone has more than one Parametric EQ; Rouen tries one at a time." : "That zone has no Parametric EQ now." };
    return { zone: z.display_name, zoneId: z.zone_id, ...peqs[0] };
  }

  return {
    /**
     * One band's gain changed: previewed, or (send) sent once and what came back said.
     * @param {{ zone: string, band: number, gain: number, save: boolean, send: boolean }} a
     */
    async run(a) {
      if (!deps.on()) return { error: "Native mode is off." };
      if (!Number.isInteger(a.band) || a.band < 1) return { error: "band takes a band's number, from 1." };
      if (!Number.isFinite(a.gain)) return { error: "gain takes dB." };
      if (busy) return { error: "A try is already running." };
      busy = true;
      try {
        const where = await find(a.zone);
        if ("error" in where) return where;
        /** @type {any} */
        let seen = null;
        const out = /** @type {any} */ (await inTurn(async (s) => {
          const item = s.graph.get(BigInt(where.item));
          const ref = item && item.loaded ? field(item, "ParametricEqualizer") : null;
          const part = isRef(ref) ? s.graph.get(ref.$ref) : null;
          if (!part || !part.loaded) return { notSent: "Your server hasn't sent this Parametric EQ yet." };
          const specKey = Object.keys(part.fields).find((k) => k.endsWith("::Spec"));
          if (!specKey) return { notSent: "Your server sent this Parametric EQ without its bands." };
          /** @type {any} */
          let next, bytes, before;
          try {
            const held = plainOf(s.graph, specKey, part.fields[specKey], true);
            // the window's own checks and change (peq-spec.js, the t15 review): one validator, one encoder
            const why = check(held, a.band, "gain", a.gain);
            if (why) return { notSent: why };
            before = /** @type {any} */ (held[/** @type {string} */ (keyOf(held, "Bands"))])[a.band - 1];
            next = changed(s.graph, held, a.band, "gain", a.gain);
            // written here only for the preview, nothing declared on the connection (the review); on the connection to send.
            // Read back before anything is sent: bytes that don't hold the spec meant are never sent.
            bytes = encode(a.send ? s.g : local(), s.graph, next);
          } catch (e) {
            return { notSent: String(e && /** @type {any} */ (e).message) };
          }
          const preview = { zone: where.zone, output: where.output, item: where.item, part: String(part.oid), save: a.save,
            change: { before: said(before, a.band), gainDb: a.gain }, held: deep(s.graph, specKey, part.fields[specKey]), sends: shortly(next),
            bytes: bytes.length, readBack: "The spec Rouen would send reads back as meant." };
          if (!a.send) return Object.assign({ sent: false, next: "Compare the bands held with MUSE: Rouen's copy is from when it asked your server (§15.13). If they match, add &send=1 to send it once." }, preview);
          seen = { s, part: String(part.oid), item: where.item, pushes: [], t0: Date.now() };
          seen.w = (/** @type {any} */ o, /** @type {Record<string, any>} */ pushed, /** @type {number | undefined} */ cmd) => {
            const oid = String(o.oid);
            if (seen.pushes.length < 20 && (oid === seen.part || oid === seen.item)) {
              seen.pushes.push({ afterMs: Date.now() - seen.t0, object: `${shortType(o.typeName)} ${oid}`, kind: cmd,
                values: Object.fromEntries(Object.keys(pushed).map((k) => [k.split("::").pop(), deep(s.graph, k, pushed[k])])) });
            }
          };
          s.graph.watchers.add(seen.w);
          try {
            const res = await s.g.call(part.oid, SIG.dspPeqSpec, Buffer.concat([bytes, new BinaryWriter().boolean(a.save).toBuffer()]));
            log(`peq try: SetSpec band ${a.band} → ${a.gain} dB, save ${a.save}: ${res.success ? "taken" : `refused (${res.status})`}`);
            return Object.assign({ sent: true, answer: res.success ? "taken" : `refused (${res.status})` }, preview);
          } catch (e) {
            // An answered call that never came back may still have been taken: said, never sent again. One the connection
            // never took (closed, or full) is said not sent.
            const f = failed(e);
            return Object.assign({ sent: !("notSent" in f) }, f, preview);
          }
        }, turnMs));
        // only what reached the server is waited on and said to be checked (the review): not one never sent, nor refused
        if (seen) {
          const reached = out.sent && (out.answer === "taken" || !!out.maybe);
          if (reached) await new Promise((r) => { setTimeout(r, waitMs); });
          seen.s.graph.watchers.delete(seen.w);
          if (!reached) return out;
          const part = seen.s.graph.get(BigInt(seen.part));
          const key = part ? Object.keys(part.fields).find((k) => k.endsWith("::Spec")) : null;
          out.cameBack = seen.pushes.length ? seen.pushes : `Nothing came back about this Parametric EQ within ${Math.round(waitMs / 1000)} s.`;
          out.heldNow = key ? deep(seen.s.graph, key, part.fields[key]) : null;
          out.next = "Check MUSE: the band's gain as sent, and every other band as it was.";
        }
        return out;
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createPeqTry };
