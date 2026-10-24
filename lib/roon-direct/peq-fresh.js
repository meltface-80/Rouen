// @ts-check
"use strict";
/*
 * peq-fresh.js — N3-5c (dev/design/native-remote.md §15.15, v1.9.66-t15): a Parametric EQ's spec as the server holds
 * it now, read on a short connection of its own.
 *
 * The server sends a connection a parametric EQ's spec when it first asks for its DSP (GetDspConfig), and never again:
 * not when MUSE changes it, nor when Rouen does, and a later ask answers by reference only (§15.13, §15.14). So the
 * link's copy is as old as the link. The owner's choice (§15.15): before each change, and after it to see it taken,
 * the spec is read on a connection opened for it — its own client id, as stage 0's probe opened one (session.js) —
 * asked for that output's DSP (a read, on the allowlist), and closed. Nothing is changed on it.
 *
 * One read at a time. The same read asked again while one waits to start is given that one's answer (the review: a
 * panel opened and closed again doesn't queue read after read); once it has started, a new ask waits for a new read —
 * a read after a change must begin after it. Each read is bounded by TOTAL_MS from start to answer (the review): past
 * it, its connection is closed and the read said too slow.
 */
const { connectFirst, readRoot } = require("./session");
const { guarded, SIG } = require("./methods");
const { brokerIdCandidates } = require("./brokerid");
const { field, isRef, waitFor } = require("./objects");
const { plainOf } = require("./peq-spec");

const TIMEOUT_MS = 10000, SETTLE_MS = 6000, TOTAL_MS = 20000, PORT = 9332;
const NONE = Buffer.alloc(0);

/**
 * @param {{ core: () => ({ host: string | null, coreId: string | null } | null), connect?: typeof connectFirst,
 *           port?: number, timeoutMs?: number, settleMs?: number, totalMs?: number, log?: (line: string) => void }} deps
 */
function createFreshPeq(deps) {
  const connect = deps.connect || connectFirst;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS, settleMs = deps.settleMs ?? SETTLE_MS, totalMs = deps.totalMs ?? TOTAL_MS;
  const log = deps.log || (() => {});
  /** The read running, so the next waits for it. @type {Promise<any>} */
  let queue = Promise.resolve();
  /** Reads asked for and not yet started, by what they read: one more ask shares it. @type {Map<string, Promise<any>>} */
  const waiting = new Map();

  /**
   * One read: the spec of a Parametric EQ part, as plain data (peq-spec.js), read whole or refused.
   * @param {string} configOid  the output's AudioDeviceCommonConfig @param {string} partOid  its ParametricEqualizerItem
   * @param {{ session: any }} held  the connection, once open, so a read past its bound can close it
   * @returns {Promise<{ spec: Record<string, any> } | { why: string }>}
   */
  async function once(configOid, partOid, held) {
    const core = deps.core();
    if (!core || !core.host || !core.coreId) return { why: "Rouen isn't paired with your server." };
    const first = await connect({ host: core.host, port: deps.port || PORT, timeoutMs, candidates: brokerIdCandidates({ coreId: core.coreId }) });
    const s = first.session;
    if (!s) return { why: "Your server didn't take a second connection to read the EQ." };
    held.session = s;
    try {
      const g = guarded(s.remoting);
      await readRoot(g, s.graph, settleMs);
      // the output's settings, as this connection is sent them: waited for, never called on unseen
      const cfg = await waitFor(settleMs, () => { const o = s.graph.get(BigInt(configOid)); return o && o.loaded ? o : undefined; });
      if (!cfg) return { why: "Your server didn't send this output's settings to the second connection." };
      const res = await g.call(BigInt(configOid), SIG.dspConfig, NONE);
      if (!res.success) return { why: `Your server refused to say (${res.status}).` };
      const part = await waitFor(settleMs, () => {
        const o = s.graph.get(BigInt(partOid));
        return o && o.loaded && Object.keys(o.fields).some((k) => k.endsWith("::Spec")) ? o : undefined;
      });
      if (!part) return { why: "Your server didn't send this Parametric EQ to the second connection." };
      const key = /** @type {string} */ (Object.keys(part.fields).find((k) => k.endsWith("::Spec")));
      const spec = part.fields[key];
      if (!spec || typeof spec !== "object" || isRef(spec)) return { why: "Your server sent this Parametric EQ without its bands." };
      // read whole, or refused: a band read short is never shown, nor sent back short (peq-spec.js plainOf, exact)
      return { spec: plainOf(s.graph, key, spec, true) };
    } finally {
      s.close();
    }
  }

  return {
    /**
     * The spec now, one read at a time.
     * @param {string} configOid @param {string} partOid
     * @returns {Promise<{ spec: Record<string, any> } | { why: string }>}
     */
    read(configOid, partOid) {
      const key = `${configOid}/${partOid}`;
      const queued = waiting.get(key);
      if (queued) return queued;
      const run = queue.then(async () => {
        waiting.delete(key);   // started: a new ask from now waits for a new read
        const held = { session: null };
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        const slow = new Promise((r) => {
          timer = setTimeout(() => {
            // past its bound: its connection closed, so nothing of it is left open
            if (held.session) held.session.close();
            r({ why: `Your server took more than ${Math.round(totalMs / 1000)} s to send the EQ.` });
          }, totalMs);
        });
        try {
          return await Promise.race([once(configOid, partOid, held), slow]);
        } catch (e) {
          const why = String(e && /** @type {any} */ (e).message);
          log(`peq fresh read: ${why}`);
          return { why: `Rouen couldn't read the EQ from your server (${why}).` };
        } finally {
          clearTimeout(timer);
        }
      });
      waiting.set(key, run);
      // the next read waits for this one, whatever it answers
      queue = run.then(() => undefined);
      return run;
    },
  };
}

/** The part a DspConfigItem names, by its member: a Parametric EQ's. @param {any} item */
const peqPartOf = (item) => { const v = item && item.loaded ? field(item, "ParametricEqualizer") : null; return isRef(v) ? String(v.$ref) : null; };

module.exports = { createFreshPeq, peqPartOf };
