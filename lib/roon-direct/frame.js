// @ts-check
"use strict";
/*
 * frame.js — the remoting frame codec (Sooloos.Broker.Remoting's
 * SendRequest / SendResponse / _ParseHeader).
 *
 * Ported from arthursoares/roon-api-reverse-engineering (MIT, see LICENSE),
 * commit 8b67208: roon-internal-api/src/proto/frame.ts.
 *
 *   frame = [header byte] [flexint request id?] [flexint body length] [body]
 *   header 0x80 set: a response; 0x40 then means "the final chunk", and a
 *     request id always follows.
 *   header 0x80 clear: a request; command = header & 0x3F, and 0x40 means it
 *     expects a response (a request id follows).
 *
 * Commands: PING 1, GETSVC 2, CALL 3, GCOBJS 4, DEFTYPE 5, DEFMETHOD 6,
 * SENDMSG 7. The Core's pushes reuse the numbers: DEFTYPE 7, PUSHOBJ 3,
 * PUSHSTUB 4, UPDATEOBJ 5 (objects.js reads those).
 */
const { writeFlexInt } = require("./wire");

const Cmd = Object.freeze({ PING: 1, GETSVC: 2, CALL: 3, GCOBJS: 4, DEFTYPE: 5, DEFMETHOD: 6, SENDMSG: 7 });

/**
 * @typedef {object} Frame
 * @property {boolean} isResponse
 * @property {number} cmd         a request's command (0 on a response)
 * @property {number|null} rid    the request id: on every response, and on requests that expect one
 * @property {boolean} isFinal    a response's last chunk
 * @property {Buffer} body
 */

/**
 * @param {number} cmd
 * @param {Uint8Array} body
 * @param {number|null} rid  null: no response wanted
 */
function encodeRequest(cmd, body, rid) {
  /** @type {number[]} */
  const head = [];
  if (rid !== null) { head.push((cmd & 0x3f) | 0x40); writeFlexInt(head, rid); }
  else head.push(cmd & 0x3f);
  writeFlexInt(head, body.length);
  return Buffer.concat([Buffer.from(head), Buffer.from(body)]);
}

/**
 * A reply from this side: the empty acknowledgement the Core expects for its
 * pings and for pushes that ask for one.
 * @param {number} rid
 * @param {Uint8Array} body
 */
function encodeResponse(rid, body, isFinal = true) {
  /** @type {number[]} */
  const head = [0x80 | (isFinal ? 0x40 : 0)];
  writeFlexInt(head, rid);
  writeFlexInt(head, body.length);
  return Buffer.concat([Buffer.from(head), Buffer.from(body)]);
}

/**
 * Socket chunks in, whole frames out: a frame may span reads, and one read may
 * hold several. A frame larger than maxFrame is refused (an error is thrown):
 * nothing here is entitled to buffer without bound in Rouen's memory.
 */
class FrameParser {
  /** @param {number} [maxFrame] */
  constructor(maxFrame = 32 * 1024 * 1024) {
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
    this.maxFrame = maxFrame;
  }
  /**
   * @param {Buffer} chunk
   * @returns {Frame[]}
   */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    /** @type {Frame[]} */
    const frames = [];
    for (;;) {
      const f = this.parseOne();
      if (!f) break;
      frames.push(f);
    }
    return frames;
  }
  /** @returns {Frame | null} */
  parseOne() {
    const u = this.buf;
    if (u.length < 2) return null;
    /** @param {number} pos @returns {[number, number] | null} */
    const flex = (pos) => {
      let num = 0;
      for (;;) {
        if (pos >= u.length) return null;
        const b = u[pos++];
        num = (num << 7) | (b & 0x7f);
        if ((b & 0x80) === 0) return [num >>> 0, pos];
      }
    };
    let pos = 1;
    const h = u[0];
    const isResponse = (h & 0x80) !== 0;
    let cmd = 0, isFinal = false;
    /** @type {number|null} */
    let rid = null;
    if (!isResponse) {
      cmd = h & 0x3f;
      if ((h & 0x40) !== 0) {
        const r = flex(pos);
        if (!r) return null;
        [rid, pos] = r;
      }
    } else {
      isFinal = (h & 0x40) !== 0;
      const r = flex(pos);
      if (!r) return null;
      [rid, pos] = r;
    }
    const len = flex(pos);
    if (!len) return null;
    const [bodyLen, start] = len;
    if (bodyLen > this.maxFrame) throw new Error(`frame of ${bodyLen} bytes is over the ${this.maxFrame}-byte limit`);
    if (u.length < start + bodyLen) return null;
    const frame = { isResponse, cmd, rid, isFinal, body: Buffer.from(u.subarray(start, start + bodyLen)) };
    this.buf = u.subarray(start + bodyLen);
    return frame;
  }
}

module.exports = { Cmd, encodeRequest, encodeResponse, FrameParser };
