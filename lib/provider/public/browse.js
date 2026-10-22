// @ts-check
"use strict";
/*
 * browse.js — the official extension API's browse, load and image calls, each with its deadline,
 * and the pool of browse session keys every walk borrows from (moved out of index.js in v1.9.39 with
 * behaviour unchanged, as N2c-1's streaming module needs them too; dev/quality.md, "Splitting the
 * monoliths"). index.js hands in the Core it is paired with, as it changes.
 */

/**
 * @param {{ core: () => any, debug: boolean }} deps
 */
function createBrowse(deps) {
  // ---------------------------------------------------------------------------
  // Promisified Roon calls
  // ---------------------------------------------------------------------------
  // Every Roon browse/load/image call is traced with its round-trip duration:
  // the request at DEBUG, the outcome with ms at DEBUG, failures ALWAYS (with
  // the offending opts — a failed Roon call should never be invisible).
  // The browse path was the only I/O in index.js (where it lived until v1.9.39) with no deadline at all —
  // /api/queue has one, every HTTP fetch goes through fetchWithTimeout, the
  // source probe races a deadline. A Core that accepts a call and never answers
  // left the caller's promise pending FOREVER: its pooled browse session was
  // never released, and on the radio path its "already working" guard was never
  // cleared. Generous on purpose — this is a stuck-call backstop, not a
  // performance budget, and a slow-but-working Core must not be broken by it.
  function roonCallTimeoutMs() { return 90000; }

  // Wrap a settle-once callback with a deadline. `who` names the call in the log.
  function withRoonDeadline(kind, who, reject) {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.error("[" + kind + "] no answer after " + roonCallTimeoutMs() + "ms: " + who);
      reject(new Error("Roon did not answer in time"));
    }, roonCallTimeoutMs());
    if (timer.unref) timer.unref();   // never hold the process open
    return {
      settle(fn) {
        if (done) return;             // the deadline already rejected this call
        done = true;
        clearTimeout(timer);
        fn();
      },
    };
  }

  // `quiet` keeps a call out of the debug trace — for the library watch, whose
  // looks are routine and frequent (v1.8.68). A failure is logged regardless.
  function browse(opts, quiet) {
    return new Promise((resolve, reject) => {
      if (!deps.core()) { reject(new Error("Not paired with a Roon Core yet")); return; }
      const t0 = Date.now();
      if (deps.debug && !quiet) console.log("[browse]", JSON.stringify(opts));
      const guard = withRoonDeadline("browse",
        (opts.multi_session_key || "-") + " " + (opts.hierarchy || "-"), reject);
      // The SDK call itself can throw synchronously when the Core is torn down
      // mid-flight (core = null races with in-flight callers). Without this the
      // promise rejects but the deadline timer stays armed, and 90s later the
      // log claims a hung Core that never existed.
      try {
      deps.core().services.RoonApiBrowse.browse(opts, (err, body) => guard.settle(() => {
        const ms = Date.now() - t0;
        // Concurrent operations interleave in the log, so the :res line carries
        // the session key + request shape — a slow call is attributable without
        // hunting for its matching request line.
        const who = (opts.multi_session_key || "-") + " " + (opts.hierarchy || "-") +
                    (opts.pop_all ? " pop_all" : (opts.item_key ? " item" : ""));
        if (err) {
          const msg = typeof err === "string" ? err : JSON.stringify(err);
          console.error("[browse] failed after " + ms + "ms:", who, msg, "opts:", JSON.stringify(opts));
          return reject(new Error(msg));
        }
        if (deps.debug && !quiet) console.log("[browse:res]", ms + "ms", who, body && body.action,
                               body && body.list && body.list.title,
                               "count:", body && body.list ? body.list.count : "-");
        resolve(body);
      }));
      } catch (e) { guard.settle(() => reject(e)); }
    });
  }
  function load(opts, quiet) {
    return new Promise((resolve, reject) => {
      if (!deps.core()) { reject(new Error("Not paired with a Roon Core yet")); return; }
      const t0 = Date.now();
      if (deps.debug && !quiet) console.log("[load]", JSON.stringify(opts));
      const guard = withRoonDeadline("load",
        (opts.multi_session_key || "-") + " " + (opts.hierarchy || "-"), reject);
      try {
      deps.core().services.RoonApiBrowse.load(opts, (err, body) => guard.settle(() => {
        const ms = Date.now() - t0;
        // Same attribution as [browse:res]: key + hierarchy + offset/count.
        const who = (opts.multi_session_key || "-") + " " + (opts.hierarchy || "-") +
                    " @" + (opts.offset != null ? opts.offset : 0) + "x" + (opts.count != null ? opts.count : "-");
        if (err) {
          const msg = typeof err === "string" ? err : JSON.stringify(err);
          console.error("[load] failed after " + ms + "ms:", who, msg, "opts:", JSON.stringify(opts));
          return reject(new Error(msg));
        }
        if (deps.debug && !quiet) console.log("[load:res]", ms + "ms", who, body && body.list && body.list.title,
                              "items:", (body && body.items || []).length,
                              "total:", body && body.list ? body.list.count : "-");
        resolve(body);
      }));
      } catch (e) { guard.settle(() => reject(e)); }
    });
  }
  function getImage(image_key, opts) {
    return new Promise((resolve, reject) => {
      if (!deps.core()) { reject(new Error("Not paired with a Roon Core yet")); return; }
      const t0 = Date.now();
      deps.core().services.RoonApiImage.get_image(image_key, opts, (err, content_type, body) => {
        const ms = Date.now() - t0;
        if (err) {
          const msg = typeof err === "string" ? err : JSON.stringify(err);
          console.error("[image] failed after " + ms + "ms:", msg, "key:", image_key);
          return reject(new Error(msg));
        }
        // Only cache MISSES reach Roon (see /api/image's LRU), so this stays
        // readable even though art is the highest-volume asset.
        if (deps.debug) console.log("[image]", ms + "ms", image_key, "->",
                               content_type, (body ? body.length : 0) + "b");
        resolve({ content_type, body });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Browse session keys — pooled, not minted per operation.
  //
  // Roon's browse service keeps server-side state for every multi_session_key
  // for as long as the extension stays connected. The old scheme created a
  // fresh random key for every single operation (including the 5-minute index
  // probe — ~288/day at idle) and never told the Core about them again, so a
  // long-lived Core accumulated thousands of orphaned browse sessions. Keys are
  // now checked out of a small free-list and returned when the operation
  // finishes: the number of sessions the Core ever holds equals the PEAK number
  // of simultaneous operations (single digits), not the number of operations
  // ever run. Reuse is safe because every operation begins by re-navigating its
  // hierarchy (pop_all / fresh navigation), which discards any leftover state
  // on that key — and item_keys are never held across operations (see
  // pickRandomAlbums / loadAlbumSession).
  // ---------------------------------------------------------------------------
  const browseSessionFree = [];
  let browseSessionSeq = 0;
  function acquireBrowseSession() {
    return browseSessionFree.pop() || ("rra_s" + (++browseSessionSeq));
  }
  function releaseBrowseSession(key) {
    // Only withBrowseSession's finally calls this — exactly once per acquire —
    // so a key can never enter the pool twice. Keep it that way: releasing a
    // key twice would let two concurrent operations share a session and corrupt
    // each other's browse state.
    if (key) browseSessionFree.push(key);
  }
  // All Roon browse work runs through here. Per-operation attribution in the
  // DEBUG logs comes from the [browse]/[load] lines (they print the full opts,
  // including the pooled key), so the key itself doesn't need to carry it.
  async function withBrowseSession(fn) {
    const sessionKey = acquireBrowseSession();
    try {
      return await fn(sessionKey);
    } finally {
      releaseBrowseSession(sessionKey);
    }
  }

  return { browse, load, getImage, withBrowseSession, roonCallTimeoutMs };
}

module.exports = { createBrowse };
