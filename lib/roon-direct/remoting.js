// @ts-check
"use strict";
/*
 * remoting.js — calls over a live connection (Sooloos.Broker.Remoting's
 * RemotingClientV2): request ids, method declarations, service lookup, and
 * the acknowledgements the Core expects.
 *
 * Ported from arthursoares/roon-api-reverse-engineering (MIT, see LICENSE),
 * commit 8b67208: roon-internal-api/src/proto/remoting.ts. Two additions,
 * both dev/design/roon-native.md §3 ("a connection-level budget"):
 *  - at most `maxInFlight` calls waiting on the Core at once; one more is
 *    refused here rather than queued, so a stalled Core cannot pile work up
 *    inside itself or here;
 *  - every call has a timeout, and a closed connection fails every call still
 *    waiting at once.
 */
const { Cmd, FrameParser, encodeRequest, encodeResponse } = require("./frame");
const { BinaryWriter, readFlexLong } = require("./wire");

/**
 * @typedef {object} CallResult
 * @property {string} status   "Success" or "" when it worked; otherwise the Core's reason
 * @property {boolean} success
 * @property {Buffer} payload  what follows the status: the return value
 */

/**
 * @typedef {object} Transport
 * @property {(data: Buffer) => boolean | void} send   false: not sent (the connection is closing)
 * @property {(handler: (chunk: Buffer) => void) => void} onData
 */

/** @param {Buffer} body @returns {CallResult} */
function parseCallResult(body) {
  let pos = 0, num = 0;
  for (;;) {
    if (pos >= body.length) return { status: "malformed reply", success: false, payload: Buffer.alloc(0) };
    const b = body[pos++];
    num = (num << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  const len = num >>> 0;
  let status = "";
  if (len !== 0xffffffff) {
    status = body.subarray(pos, pos + len).toString("utf8");
    pos += len;
  }
  return { status, success: status === "Success" || status === "", payload: Buffer.from(body.subarray(pos)) };
}

class RemotingClient {
  /**
   * @param {Transport} transport
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]    one call's limit
   * @param {number} [opts.maxInFlight]  calls waiting on the Core at once
   */
  constructor(transport, opts = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs || 10000;
    this.maxInFlight = opts.maxInFlight || 2;
    this.parser = new FrameParser();
    this.rid = 0;
    /** @type {Map<string, number>} */
    this.methodIds = new Map();
    this.nextMethodId = 1;
    /** @type {Map<string, { id: number, schema: string }>} */
    this.types = new Map();
    this.nextTypeId = 1;
    /** @type {Map<number, { chunks: Buffer[], resolve: (b: Buffer) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** Keepalives waiting for their answer, by request id. @type {Map<number, { resolve: (answered: boolean) => void, timer: NodeJS.Timeout }>} */
    this.pings = new Map();
    /** startKeepalive's: sent, answered, missed in a row since the last answer. */
    this.keepalive = { sent: 0, answered: 0, missed: 0 };
    /** @type {NodeJS.Timeout | null} */
    this.keepaliveTimer = null;
    this.closedReason = "";
    /**
     * Set when a call timed out. The Core may still have done it — retained a
     * page, made a query — and its late answer is dropped here, so this side
     * no longer knows what the Core holds for it. Callers stop and close the
     * connection rather than guess (dev/design/roon-native.md §3).
     */
    this.uncertain = "";
    /** Every frame the Core pushes (types and objects) goes here. @type {(frame: import("./frame").Frame) => void} */
    this.onPush = () => {};
    transport.onData((chunk) => {
      let frames;
      try { frames = this.parser.push(chunk); }
      catch (e) { this.failPending(e.message); return; }
      for (const f of frames) this.handle(f);
    });
  }

  /** @param {string} signature */
  methodId(signature) {
    let id = this.methodIds.get(signature);
    if (id === undefined) {
      id = this.nextMethodId++;
      this.methodIds.set(signature, id);
      // DEFMETHOD on first use: (local id, the full signature string)
      this.transport.send(encodeRequest(Cmd.DEFMETHOD, new BinaryWriter().flexInt(id).string(signature).toBuffer(), null));
    }
    return id;
  }

  /**
   * DEFTYPE: one ordered schema per type for the session. The Core keeps
   * member mappings by OUR type id, so a type is declared once; declaring it
   * again with other members is refused rather than silently remapped.
   * @param {string} typeName
   * @param {ReadonlyArray<{ name: string, propType: number }>} members
   */
  defineType(typeName, members) {
    const schema = JSON.stringify(members.map((m) => [m.name, m.propType]));
    const known = this.types.get(typeName);
    if (known) {
      if (known.schema !== schema) throw new Error(`${typeName} was declared with other members`);
      return known.id;
    }
    const id = this.nextTypeId++;
    const w = new BinaryWriter().flexInt(id).string(typeName).flexInt(members.length);
    for (const m of members) w.string(m.name).integer(m.propType);
    this.transport.send(encodeRequest(Cmd.DEFTYPE, w.toBuffer(), null));
    this.types.set(typeName, { id, schema });
    return id;
  }

  /**
   * @param {number} cmd
   * @param {Buffer} body
   * @returns {Promise<Buffer>} the final response's body (chunks joined)
   */
  request(cmd, body) {
    if (this.closedReason) return Promise.reject(new Error(`connection closed: ${this.closedReason}`));
    if (this.pending.size >= this.maxInFlight) return Promise.reject(new Error(`already ${this.pending.size} calls waiting on the Core`));
    this.rid = (this.rid + 1) & 0x7fffffff;
    const rid = this.rid;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        const why = `the Core did not answer call ${rid} within ${this.timeoutMs} ms`;
        if (!this.uncertain) this.uncertain = why;
        reject(new Error(why));
      }, this.timeoutMs);
      this.pending.set(rid, { chunks: [], resolve, reject, timer });
      try { this.transport.send(encodeRequest(cmd, body, rid)); }
      catch (e) {
        clearTimeout(timer);
        this.pending.delete(rid);
        reject(e);
      }
    });
  }

  /**
   * CALL a method on an object and wait for its result.
   * @param {bigint} objectId
   * @param {string} signature
   * @param {Buffer} args
   * @returns {Promise<CallResult>}
   */
  async call(objectId, signature, args) {
    const body = new BinaryWriter().long(objectId).flexInt(this.methodId(signature)).bytes(args).toBuffer();
    return parseCallResult(await this.request(Cmd.CALL, body));
  }

  /**
   * CALL with no reply wanted: Dispose() and ReleasePage(), which the Core
   * never answers (upstream's history export, live-probed). True when it was
   * handed to the socket; false when the connection had already gone, so a
   * caller never reports a release that was not sent.
   * @param {bigint} objectId
   * @param {string} signature
   * @param {Buffer} args
   */
  callNoReply(objectId, signature, args) {
    if (this.closedReason) return false;
    const body = new BinaryWriter().long(objectId).flexInt(this.methodId(signature)).bytes(args).toBuffer();
    return this.transport.send(encodeRequest(Cmd.CALL, body, null)) !== false;
  }

  /**
   * GETSVC: a service's object id from its guid. Asking for the root service
   * is also what makes the Core push its object graph.
   * @param {Uint8Array} guid16
   */
  async getService(guid16) {
    const res = parseCallResult(await this.request(Cmd.GETSVC, new BinaryWriter().guid(guid16).toBuffer()));
    if (!res.success) throw new Error(`the Core refused the service: ${res.status}`);
    const r = readFlexLong(res.payload, 0);
    if (!r) throw new Error("the Core's service reply carried no object id");
    return r[0];
  }

  /**
   * A keepalive (v1.9.24): a PING asking for an answer. The server reaps a
   * connection it has heard nothing from for about 30 s — "no keepalive from
   * … in 34289ms; reaping dead peer" in the owner's server log, 34 s after
   * each of v1.9.21–v1.9.23's library reads went quiet (the read's own calls
   * had kept it alive; answering the server's pings did not). Kept apart from
   * calls: it holds nothing on the server, so one left unanswered makes
   * nothing uncertain, and it never waits behind a page read. Resolves true
   * when answered, false when not within `timeoutMs`, closed, or unsendable.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  ping(timeoutMs) {
    if (this.closedReason) return Promise.resolve(false);
    this.rid = (this.rid + 1) & 0x7fffffff;
    const rid = this.rid;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pings.delete(rid); resolve(false); }, timeoutMs || this.timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pings.set(rid, { resolve, timer });
      let sent = false;
      try { sent = this.transport.send(encodeRequest(Cmd.PING, Buffer.alloc(0), rid)) !== false; }
      catch (e) { sent = false; }   // a transport that throws: no keepalive left, which the count says
      if (!sent) {
        clearTimeout(timer);
        this.pings.delete(rid);
        resolve(false);
      }
    });
  }

  /**
   * A keepalive every `everyMs`, the first at once — from the moment the
   * connection is up, before anything is read (the server's clock starts
   * then) — until it closes. `keepalive` counts them.
   * @param {number} everyMs
   */
  startKeepalive(everyMs) {
    if (this.keepaliveTimer || this.closedReason) return;
    const k = this.keepalive;
    const tick = () => {
      if (this.closedReason) return;
      k.sent++;
      this.ping(everyMs).then((answered) => {
        if (answered) { k.answered++; k.missed = 0; } else if (!this.closedReason) k.missed++;
      });
    };
    tick();
    this.keepaliveTimer = setInterval(tick, everyMs);
    if (typeof this.keepaliveTimer.unref === "function") this.keepaliveTimer.unref();
  }

  /** Fail every call still waiting, at once. Idempotent. @param {string} reason */
  failPending(reason) {
    if (!this.closedReason) this.closedReason = reason;
    for (const [rid, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`call ${rid} failed: ${reason}`));
    }
    this.pending.clear();
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
    for (const p of this.pings.values()) { clearTimeout(p.timer); p.resolve(false); }
    this.pings.clear();
  }

  /** @param {import("./frame").Frame} f */
  handle(f) {
    if (f.isResponse) {
      const ping = f.rid !== null ? this.pings.get(f.rid) : undefined;
      if (ping) {
        clearTimeout(ping.timer);
        this.pings.delete(/** @type {number} */ (f.rid));
        ping.resolve(true);
        return;
      }
      const p = f.rid !== null ? this.pending.get(f.rid) : undefined;
      if (!p) return;   // late, after its timeout: dropped
      p.chunks.push(f.body);
      if (f.isFinal) {
        clearTimeout(p.timer);
        this.pending.delete(/** @type {number} */ (f.rid));
        p.resolve(p.chunks.length === 1 ? p.chunks[0] : Buffer.concat(p.chunks));
      }
      return;
    }
    if (f.cmd !== Cmd.PING) this.onPush(f);
    // A ping, or a push that asks for a reply: the empty acknowledgement —
    // not once this side has closed (the transport would not send it anyway).
    if (f.rid !== null && !this.closedReason) this.transport.send(encodeResponse(f.rid, Buffer.alloc(0)));
  }
}

module.exports = { RemotingClient, parseCallResult };
