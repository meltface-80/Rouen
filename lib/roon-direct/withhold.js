// @ts-check
"use strict";
/*
 * withhold.js — what a debug answer never shows (v1.9.70-t9). The native probes walk the server's objects by reference,
 * and a walk can reach the server's Roon account (its UserId, Token, names, Email) and its remote-access status (the
 * home's external address, the machine's hardware address): the reads probe of v1.9.70-t4 printed all of them, and the
 * owner pasted it into a conversation. Every answer under /api/debug goes through here (index.js mounts the middleware
 * before any route), so a probe added later is covered too. Withheld, wherever they sit in an answer:
 *   - every member of an object whose type is an account or the remote-access status (`object`: "Account",
 *     "RemoteAccessStatus" — as settings-probe.js's whole() and smart-probe.js's describe() name an object), whatever
 *     the member is called;
 *   - a member named UserId, Email, FirstName, LastName, ExternalIPAddress or PhysicalAddress, or whose name says
 *     token, password, secret or credential;
 *   - a change the push recorder lists as { name, v } (push-log.js) under such a name.
 * A value is withheld when it says something: a string or number. true/false, null and "" stay, as whether a token is
 * set or empty is worth seeing. The server's LAN address (LocalIPAddress) and the devices' (IPAddress) stay: finding a
 * device needs them, and they say nothing outside the home. Not covered: an answer the graph couldn't read, given as
 * its first bytes in hex (settings-probe.js `answer`) — bytes can't be told apart by name.
 *
 *   withhold(value)         a copy of value, everything above replaced by WITHHELD
 *   withholdDebug           Express middleware: res.json sends withhold(value)
 */

const WITHHELD = "(withheld by Rouen)";
/** Members withheld by their whole name, as the server names them (any case). */
const NAMES = new Set(["userid", "email", "firstname", "lastname", "externalipaddress", "physicaladdress"]);
/** And any whose name says it is a credential. */
const SECRET = /token|password|secret|credential/i;
/** The types whose every member is withheld. */
const TYPES = /^(Account|RemoteAccessStatus)$/;
/** A change's value, beside its name, in the push recorder's lists. */
const VALUE_KEYS = ["v", "value", "was", "now"];

/** @param {string} k */
const isWithheld = (k) => NAMES.has(k.toLowerCase()) || SECRET.test(k);
/** A value that says something: withheld where its name or its object's type says so. @param {any} x */
const says = (x) => (typeof x === "string" && x !== "") || typeof x === "number" || typeof x === "bigint";

/**
 * @param {any} v @param {boolean} [all]  inside an account or the remote-access status: everything that says something
 * @param {Set<object>} [within]  the values it sits inside: one met again among them (a cycle, should one come) is cut
 *   rather than walked for ever; one met twice elsewhere (shared) is copied twice, as JSON would
 * @returns {any}
 */
function withhold(v, all = false, within = new Set()) {
  if (v && typeof v === "object" && typeof v.toJSON === "function" && !(v instanceof Date)) v = v.toJSON();
  if (!v || typeof v !== "object" || Buffer.isBuffer(v) || v instanceof Date) return all && says(v) ? WITHHELD : v;
  if (within.has(v)) return "(a cycle)";
  within.add(v);
  /** @type {any} */
  let out;
  if (Array.isArray(v)) out = v.map((x) => withhold(x, all, within));
  else {
    const typed = all || (typeof v.object === "string" && TYPES.test(v.object));
    const named = typeof v.name === "string" && isWithheld(v.name);
    out = {};
    for (const [k, x] of Object.entries(v)) {
      // An object's own type and id stay, to say what was withheld.
      if (typed && !all && (k === "object" || k === "oid")) out[k] = x;
      else if (says(x) && (isWithheld(k) || (named && VALUE_KEYS.includes(k)))) out[k] = WITHHELD;
      else out[k] = withhold(x, typed, within);
    }
  }
  within.delete(v);
  return out;
}

/**
 * Express middleware for /api/debug: each answer's JSON withheld.
 * @param {any} _req @param {any} res @param {() => void} next
 */
function withholdDebug(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (/** @type {any} */ v) => json(withhold(v));
  next();
}

module.exports = { withhold, withholdDebug, WITHHELD };
