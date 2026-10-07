"use strict";
// ---------------------------------------------------------------------------
// The volume guard: volume is the one safety-critical path. Ported from hqpweb
// (apps/server/src/volume.ts, 0.1.0-beta.2 + 65b3888), MIT, (c) 2026
// statelycurmudgeon — see ./LICENSE. Pure, so its rules can be checked
// exhaustively (test/unit/hqp-volume.test.js).
//
//   * A change may raise the volume by at most 6 dB in one step. Lowering is
//     never limited.
//   * A ROLLBACK never raises it. Nobody asked for one: a change that also
//     lowered the volume (a preset, say) and then stopped playback puts the
//     other settings back and leaves the volume where it is.
//   * Undo, which the listener presses, may return to the level they were at —
//     but only if nobody has moved the volume since this app's change.
// ---------------------------------------------------------------------------

/** Largest single volume RAISE accepted, in dB. Lowering is never limited. */
const MAX_RAISE_DB = 6;
/** Volume read-back tolerance, dB. */
const VOLUME_EPS = 0.01;

/**
 * @param {{requested: number, current: number, range: {min: number, max: number, enabled: boolean},
 *          kind: "change"|"undo"|"rollback", untouched: boolean}} r
 * @returns {{set: number|undefined, note?: string, problem?: string}}
 *   set: the volume to send, or undefined to leave it. problem: why the
 *   request is refused (the whole change fails unless it is lenient).
 */
function decideVolume(r) {
  if (!r.range.enabled) return { set: undefined, problem: "volume control is switched off in HQPlayer" };
  // The route already rejects these; this is the last line before HQPlayer.
  if (!Number.isFinite(r.requested)) return { set: undefined, problem: "volume must be a finite number of dB" };
  const set = Math.max(r.range.min, Math.min(r.range.max, r.requested));
  const clamped = set !== r.requested ? "clamped to " + set + " dB (range " + r.range.min + "…" + r.range.max + ")" : undefined;
  const withNote = (o) => (clamped ? Object.assign(o, { note: clamped }) : o);
  const raise = set - r.current;
  if (r.kind === "rollback" && raise > VOLUME_EPS)
    return { set: undefined, note: "kept at " + r.current + " dB: a rollback never raises the volume" };
  if (raise <= MAX_RAISE_DB + VOLUME_EPS) return withNote({ set });
  if (r.kind === "change")
    return withNote({
      set: undefined,
      problem: "refusing to raise the volume by " + raise.toFixed(1) + " dB in one step (max " + MAX_RAISE_DB + " dB)",
    });
  if (r.untouched) return withNote({ set });
  return {
    set: undefined,
    note: "not restored: the volume was changed elsewhere, and restoring it would raise it by " + raise.toFixed(1) + " dB",
  };
}

module.exports = { decideVolume, MAX_RAISE_DB, VOLUME_EPS };
