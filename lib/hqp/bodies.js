// @ts-check
"use strict";
// ---------------------------------------------------------------------------
// What the HQPlayer routes accept, checked: the settings patch, an HQPlayer
// added or edited, a DAC. Strict — unknown fields and wrong types are refused,
// nothing is coerced. Moved out of service.js unchanged in v1.9.19 (with the
// credit box's credit_hidden added to the settings patch), to make room there.
// ---------------------------------------------------------------------------
const { HttpError } = require("./instance");

const HOST_RE = /^[A-Za-z0-9.\-:[\]]{1,253}$/;
function bad(message) { return new HttpError(400, message); }

/** Validate a settings patch. Strict: unknown fields and wrong types are refused, nothing is coerced. */
function parseSettingsPatch(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "enabled" || k === "credit_hidden") {
      if (typeof v !== "boolean") throw bad(k + " must be true or false");
      out[k] = v;
    } else if (k === "host") {
      if (typeof v !== "string") throw bad("host must be a string");
      const h = v.trim();
      if (h && !HOST_RE.test(h)) throw bad("the address must be a host name or an IP address");
      out.host = h;
    } else if (k === "port") {
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw bad("the port must be a whole number from 1 to 65535");
      out.port = v;
    } else if (k === "active") {
      if (typeof v !== "string") throw bad("active must be a string");
      out.active = v;
    } else {
      throw bad('unknown field "' + k + '"');
    }
  }
  return out;
}

/** An HQPlayer, as added or edited in Settings: { name?, host?, port? }. Strict. */
function parsePlayerBody(body, needHost) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "name" || k === "host") {
      if (typeof v !== "string") throw bad(k + " must be a string");
      out[k] = v.trim();
    } else if (k === "port") {
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw bad("the port must be a whole number from 1 to 65535");
      out.port = v;
    } else {
      throw bad('unknown field "' + k + '"');
    }
  }
  if (needHost && !out.host) throw bad("enter HQPlayer's address");
  return out;
}

/** A DAC: { name, currentName? } to add one, { name } to rename, { dac } to choose one. Strict. */
function parseDacBody(body, keys) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!keys.includes(k)) throw bad('unknown field "' + k + '"');
    if (typeof v !== "string") throw bad(k + " must be a string");
    out[k] = v;
  }
  return out;
}

module.exports = { bad, parseSettingsPatch, parsePlayerBody, parseDacBody };
