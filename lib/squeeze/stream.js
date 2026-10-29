// @ts-check
"use strict";
/*
 * stream.js — one track's audio as Roon sends it to a Squeezebox player (dev/design/android-app.md §4.1 A,
 * v1.9.72-t1). The strm command carries the HTTP request to send, verbatim. A player opens a plain TCP connection to
 * the address it names, writes the request, and reads the response: headers, then the audio. Here the audio goes to a
 * file, read as fast as Roon sends it, which is what the probe measures. Nothing is decoded or played.
 */
const net = require("net");
const fs = require("fs");

/** Headers longer than this are not a Squeezebox stream's. */
const MAX_HEAD = 16 * 1024;

/**
 * @typedef {object} StreamEvents
 * @property {(headers: string) => void} onHeaders  the response's headers, as received
 * @property {(bytes: number, first: Buffer) => void} onData  the audio's bytes so far, and its first 64
 * @property {(end: { bytes: number, error: string | null, reason: number }) => void} onEnd  once, when the response is
 *   over and the file closed; reason is DSCO's (0 closed as it should, 1 closed by the player, 2 broken off, 3 never
 *   reached)
 */

/**
 * @param {{ connect?: typeof net.connect, createWriteStream?: typeof fs.createWriteStream }} deps
 * @param {{ host: string, port: number, request: string, file: string, cap: number } & StreamEvents} o
 * @returns {{ close: () => void, readonly connected: boolean }}
 */
function openStream(deps, o) {
  const connect = deps.connect || net.connect;
  const createWriteStream = deps.createWriteStream || fs.createWriteStream;
  let head = Buffer.alloc(0), inBody = false, bytes = 0, done = false, kept = 0, writing = true, connected = false, mine = false;
  let first = Buffer.alloc(0);
  /** @type {string | null} */
  let error = null;
  const out = createWriteStream(o.file);
  const sock = connect({ host: o.host, port: o.port });
  // A full disk: stop writing, and keep reading (a socket paused for a "drain" that never comes would stall Roon).
  out.on("error", (e) => { error = error || "file: " + e.message; writing = false; sock.resume(); });
  sock.setNoDelay(true);

  /** @param {Buffer} b */
  function body(b) {
    if (!b.length) return;
    bytes += b.length;
    if (first.length < 64) first = Buffer.concat([first, b.subarray(0, 64 - first.length)]);
    if (writing && kept < o.cap) {
      const part = b.subarray(0, o.cap - kept);
      kept += part.length;
      if (!out.write(part)) { sock.pause(); out.once("drain", () => sock.resume()); }
    }
    o.onData(bytes, first);
  }
  function finish() {
    if (done) return;
    done = true;
    const reason = !connected ? 3 : mine ? 1 : error ? 2 : 0;
    if (out.errored || out.destroyed) { o.onEnd({ bytes, error, reason }); return; }
    out.end(() => o.onEnd({ bytes, error, reason }));
  }

  sock.on("connect", () => { connected = true; sock.write(o.request, "latin1"); });
  sock.on("data", (/** @type {Buffer} */ chunk) => {
    if (inBody) return body(chunk);
    head = Buffer.concat([head, chunk]);
    const at = head.indexOf("\r\n\r\n");
    if (at < 0) {
      if (head.length > MAX_HEAD) { error = "no end to the response's headers in " + MAX_HEAD + " bytes"; sock.destroy(); }
      return;
    }
    inBody = true;
    o.onHeaders(head.toString("latin1", 0, at + 4));
    body(head.subarray(at + 4));
  });
  sock.on("error", (e) => { error = error || e.message; });
  sock.on("close", finish);
  return {
    close() { if (!done) { mine = true; error = error || "closed by the player"; sock.destroy(); } },
    get connected() { return connected; },
  };
}

module.exports = { openStream };
