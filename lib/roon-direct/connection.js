// @ts-check
"use strict";
/*
 * connection.js — the transport under the remoting layer: TCP to the Core's
 * port 9332, the ROON handshake, and the DistributedBroker ConnectRequest.
 *
 * Ported from arthursoares/roon-api-reverse-engineering (MIT, see LICENSE),
 * commit 8b67208: roon-internal-api/src/proto/connection.ts.
 *
 *   1. TCP connect to host:9332
 *   2. -> ROON 01 04 + the Core's 16-byte server broker id + our random one
 *   3. <- ROON 01 80 ; -> ROON 01 02 ; <- ROON 01 82 + a 16-byte session id
 *   4. -> ConnectRequest (a SENDMSG frame: the official client's, captured)
 *   5. <- ConnectResponse; every byte after it is a remoting frame
 *
 * One departure from the upstream, and only in a value: the captured
 * ConnectRequest names its client after the machine it was captured on
 * ("HQ-00452"). Rouen names itself "RouenApp" — the same length, so not one
 * length byte in the template moves (test/unit/roon-direct-wire.test.js checks
 * the template is otherwise the upstream's, byte for byte). The protocol
 * version (28) and hash are the upstream's as captured: a Core that wants
 * others refuses the handshake, which the probe reports as such.
 *
 * One session per instance; a closed or failed connection is not reused.
 */
const net = require("node:net");
const crypto = require("node:crypto");

const MAGIC = Buffer.from("ROON");
const ACK_LEN = 6;        // ROON 01 80
const SESSION_LEN = 22;   // ROON 01 82 + 16-byte session id

// The official client's ConnectRequest; XXXX… is the client broker id.
const CONNECT_REQUEST_TEMPLATE =
  "470181670000000100012c536f6f6c6f6f732e4d73672e446973747269627574656442726f6b65722e436f6e6e65637452657175657374" +
  "24840e436c69656e7442726f6b65724964XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" +
  "228110436c69656e7442726f6b65724e616d6500000008526f75656e417070" +
  "1b810f50726f746f636f6c56657273696f6e000000023238" +
  "3e810c50726f746f636f6c48617368000000286161656464323265326536653435323233316537346464333039666662396432376139373531656420" +
  "810c436c69656e744272616e63680000000a70726f64756374696f6e05030503";

class RoonConnection {
  /**
   * @param {object} opts
   * @param {string} opts.host
   * @param {number} [opts.port]
   * @param {Buffer} opts.serverBrokerId   16 bytes
   * @param {number} [opts.handshakeMs]    give up on the handshake after this long
   */
  constructor(opts) {
    if (!Buffer.isBuffer(opts.serverBrokerId) || opts.serverBrokerId.length !== 16) throw new Error("serverBrokerId must be 16 bytes");
    this.opts = opts;
    /** @type {net.Socket | null} */
    this.socket = null;
    this.established = false;
    this.used = false;
    this.clientBrokerId = crypto.randomBytes(16);
    /** @type {(chunk: Buffer) => void} */
    this.dataHandler = () => {};
    /** Fired once when the socket closes, however it closed. */
    this.onclosed = () => {};
    this.closedFired = false;
  }

  /** @param {(chunk: Buffer) => void} handler */
  onData(handler) { this.dataHandler = handler; }

  /**
   * True when the bytes were handed to the socket. After close() nothing is
   * sent, and nothing throws: a reply the Core asks for while the connection
   * is closing (a ping, an acknowledged push) is simply not given — throwing
   * here, inside the socket's data event, would take Rouen down with it.
   * @param {Buffer} data
   */
  send(data) {
    if (!this.socket) return false;
    this.socket.write(data);
    return true;
  }

  fireClosed() {
    if (this.closedFired) return;
    this.closedFired = true;
    this.onclosed();
  }

  /** @returns {Promise<void>} resolves once remoting is live */
  connect() {
    const { host, port = 9332, serverBrokerId, handshakeMs = 10000 } = this.opts;
    return new Promise((resolve, reject) => {
      if (this.used) { reject(new Error("a RoonConnection is used once; make a new one")); return; }
      this.used = true;
      const socket = new net.Socket();
      this.socket = socket;
      let step = 0, settled = false;
      let pending = Buffer.alloc(0);
      /** @param {Error} e */
      const fail = (e) => {
        if (!settled) { settled = true; reject(e); }
        socket.destroy();
      };
      socket.setTimeout(handshakeMs);
      socket.on("timeout", () => fail(new Error("the Core did not finish the handshake in time")));
      socket.on("error", (e) => fail(e));
      socket.on("close", () => {
        if (!this.established) fail(new Error("the Core closed the connection during the handshake"));
        if (this.socket === socket) this.socket = null;
        this.fireClosed();
      });
      socket.on("connect", () => {
        step = 1;
        socket.write(Buffer.concat([MAGIC, Buffer.from([0x01, 0x04]), serverBrokerId, this.clientBrokerId]));
      });
      socket.on("data", (data) => {
        if (this.socket !== socket) return;   // closing: what the Core still sends is not read
        if (this.established) { this.dataHandler(data); return; }
        pending = pending.length ? Buffer.concat([pending, data]) : data;
        // TCP keeps no record boundaries: consume whole handshake records only.
        for (;;) {
          if (step === 1 || step === 2) {
            if (pending.length < ACK_LEN) return;
            if (pending.subarray(0, 4).toString() !== "ROON") { fail(new Error(`the Core sent something other than ROON at handshake step ${step}`)); return; }
            const code = pending[5];
            if (step === 1 && code === 0x80) {
              pending = pending.subarray(ACK_LEN);
              step = 2;
              socket.write(Buffer.concat([MAGIC, Buffer.from([0x01, 0x02])]));
              continue;
            }
            if (step === 2 && code === 0x82) {
              if (pending.length < SESSION_LEN) return;
              pending = pending.subarray(SESSION_LEN);
              step = 3;
              socket.write(Buffer.from(CONNECT_REQUEST_TEMPLATE.replace(/X{32}/, this.clientBrokerId.toString("hex")), "hex"));
              continue;
            }
            fail(new Error(`the Core refused the handshake (reply 0x${code.toString(16)} at step ${step})`));
            return;
          }
          if (step === 3) {
            if (!pending.length) return;
            // The ConnectResponse: remoting is live, and what is buffered is its.
            socket.setTimeout(0);
            this.established = true;
            settled = true;
            const rest = pending;
            pending = Buffer.alloc(0);
            resolve();
            this.dataHandler(rest);
            return;
          }
          return;   // nothing arrives before our hello
        }
      });
      socket.connect(port, host);
    });
  }

  /**
   * Closed GRACEFULLY: what was written goes out first, then FIN. Dispose()
   * and ReleasePage() are sent without waiting for an answer, often just
   * before close — destroying the socket would drop them unsent and leave the
   * query open inside the Core. A peer that never closes its side is cut off
   * after graceMs.
   */
  close(graceMs = 2000) {
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.end();
      const t = setTimeout(() => s.destroy(), graceMs);
      if (t.unref) t.unref();
      s.once("close", () => clearTimeout(t));
    }
    this.fireClosed();
  }
}

module.exports = { RoonConnection, CONNECT_REQUEST_TEMPLATE };
