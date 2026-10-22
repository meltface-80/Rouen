// @ts-check
"use strict";
/*
 * wire.js — the primitives of Roon's internal protocol (Sooloos.Broker.Remoting,
 * TCP 9332): variable-length integers and the binary reader and writer.
 *
 * Ported to plain JavaScript from arthursoares/roon-api-reverse-engineering
 * (MIT, © 2026 Arthur Soares; see LICENSE beside this file), commit 8b67208:
 *   roon-internal-api/src/proto/flex.ts, reader.ts, writer.ts
 * Only what dev/design/roon-native.md's allowlist needs is kept. Behaviour is
 * the upstream's byte for byte; test/unit/roon-direct-wire.test.js pins it
 * against the upstream's own vectors.
 *
 * Flex integers are big-endian base-128: 7 bits a byte, most significant group
 * first, 0x80 on every byte but the last. FlexInt is 32-bit (lengths, method
 * ids, enums; -1 is the uint32 0xFFFFFFFF), FlexLong 64-bit (object ids, as
 * BigInt so they stay exact past 2^53).
 */

/**
 * @param {number[]} out
 * @param {number} value
 */
function writeFlexInt(out, value) {
  const u = value >>> 0;
  if (u <= 0x7f) out.push(u);
  else if (u <= 0x3fff) out.push(0x80 | (u >>> 7), u & 0x7f);
  else if (u <= 0x1fffff) out.push(0x80 | (u >>> 14), 0x80 | ((u >>> 7) & 0x7f), u & 0x7f);
  else if (u <= 0xfffffff) out.push(0x80 | (u >>> 21), 0x80 | ((u >>> 14) & 0x7f), 0x80 | ((u >>> 7) & 0x7f), u & 0x7f);
  else out.push(0x80 | (u >>> 28), 0x80 | ((u >>> 21) & 0x7f), 0x80 | ((u >>> 14) & 0x7f), 0x80 | ((u >>> 7) & 0x7f), u & 0x7f);
}

/**
 * @param {number[]} out
 * @param {bigint | number} value
 */
function writeFlexLong(out, value) {
  let u = BigInt(value) & 0xffffffffffffffffn;   // wrap to 64-bit like (ulong)i
  if (u === 0n) { out.push(0); return; }
  /** @type {number[]} */
  const groups = [];
  while (u > 0n) { groups.push(Number(u & 0x7fn)); u >>= 7n; }
  groups.reverse();
  for (let i = 0; i < groups.length; i++) out.push(i === groups.length - 1 ? groups[i] : 0x80 | groups[i]);
}

/**
 * Reads a flex long at pos: [value, newPos], or null when the bytes run out
 * first (a frame not yet whole).
 * @param {Uint8Array} buf
 * @param {number} pos
 * @returns {[bigint, number] | null}
 */
function readFlexLong(buf, pos) {
  let num = 0n;
  for (;;) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    num = (num << 7n) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) return [num, pos];
  }
}

/** The read half of RemotingUtils. A read past the end throws, never invents. */
class BinaryReader {
  /** @param {Uint8Array} buf */
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  get remaining() { return this.buf.length - this.pos; }
  /** @returns {number} */
  byte() {
    if (this.pos >= this.buf.length) throw new RangeError("read past the end");
    return this.buf[this.pos++];
  }
  flexInt() {
    let num = 0;
    for (;;) {
      const b = this.byte();
      num = (num << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return num >>> 0;
  }
  /** ReadInteger: a flex int read as signed, so -1 (the null length) comes back as -1. */
  integer() { return this.flexInt() | 0; }
  long() {
    let num = 0n;
    for (;;) {
      const b = this.byte();
      num = (num << 7n) | BigInt(b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return num;
  }
  boolean() { return this.byte() !== 0; }
  /** @param {number} n */
  bytes(n) {
    if (n < 0 || this.pos + n > this.buf.length) throw new RangeError("read past the end");
    const b = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return b;
  }
  guid() { return this.bytes(16); }
  double() { return this.bytes(8).readDoubleLE(0); }
  float() { return this.bytes(4).readFloatLE(0); }
  /** ReadSooid: integer(len) + len bytes. */
  sooid() { return this.bytes(this.integer()); }
  /** ReadString: integer(len); -1 is null. */
  string() {
    const len = this.integer();
    return len < 0 ? null : this.bytes(len).toString("utf8");
  }
  byteArray() {
    const len = this.integer();
    return len < 0 ? null : this.bytes(len);
  }
  optionalInteger() { return this.boolean() ? this.integer() : null; }
  optionalLong() { return this.boolean() ? this.long() : null; }
  optionalBoolean() { const b = this.byte(); return b === 0 ? false : b === 1 ? true : null; }
  optionalGuid() { return this.boolean() ? this.guid() : null; }
  optionalSooid() { const len = this.integer(); return len < 0 ? null : this.bytes(len); }
  optionalDouble() { return this.boolean() ? this.double() : null; }
  optionalFloat() { return this.boolean() ? this.float() : null; }
}

/** The write half of RemotingUtils, byte for byte. */
class BinaryWriter {
  constructor() {
    /** @type {number[]} */
    this.out = [];
  }
  get length() { return this.out.length; }
  toBuffer() { return Buffer.from(this.out); }
  /** @param {Uint8Array | number[]} b */
  bytes(b) { for (const x of b) this.out.push(x); return this; }
  /** WriteInteger == WriteFlexInt (signed: -1 is uint32 0xFFFFFFFF). @param {number} v */
  integer(v) { writeFlexInt(this.out, v); return this; }
  /** @param {number} v */
  flexInt(v) { writeFlexInt(this.out, v); return this; }
  /** @param {bigint | number} v */
  long(v) { writeFlexLong(this.out, v); return this; }
  /** @param {boolean} v */
  boolean(v) { this.out.push(v ? 1 : 0); return this; }
  /** WriteDouble: 8 bytes, little-endian (v1.9.65: a volume). @param {number} v */
  double(v) { const b = Buffer.alloc(8); b.writeDoubleLE(v, 0); return this.bytes(b); }
  /** WriteString: integer(utf8 length) + utf8; null is integer(-1). @param {string | null} v */
  string(v) {
    if (v === null || v === undefined) return this.integer(-1);
    const utf8 = Buffer.from(v, "utf8");
    this.integer(utf8.length);
    return this.bytes(utf8);
  }
  /** WriteSooid: integer(length) + bytes. @param {Uint8Array} b */
  sooid(b) { this.integer(b.length); return this.bytes(b); }
  /** WriteGuid: 16 raw bytes in .NET Guid.ToByteArray() order. @param {Uint8Array} g */
  guid(g) {
    if (g.length !== 16) throw new Error("guid must be 16 bytes");
    return this.bytes(g);
  }
}

module.exports = { writeFlexInt, writeFlexLong, readFlexLong, BinaryReader, BinaryWriter };
