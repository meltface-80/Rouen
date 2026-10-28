// @ts-check
"use strict";
/*
 * withhold.js — what a debug answer never shows (v1.9.70-t9). The native probes walk the server's objects by reference,
 * and a walk can reach the server's Roon account (its UserId, Token, names, Email) and its remote-access status (the
 * home's external address, the machine's hardware address): the reads probe of v1.9.70-t4 printed all of them, and the
 * owner pasted it into a conversation. Every answer under /api/debug goes through here (index.js mounts the middleware
 * before any route), so a probe added later is covered too. Withheld, wherever they sit in an answer:
 *   - every member of an object whose type is an account or the remote-access status (on the owner's server the object
 *     "Mobile", RemoteAccessStatus only a number inside it: v1.9.70-t13), whatever the member is called:
 *     the type as the probes name it — `object` (settings-probe.js whole(): "Account"; its push recorder:
 *     'Account "901"'), `struct` (smart-probe.js describe()) or `$type` (deep-value.js, with its namespace);
 *   - a member named UserId, Email, FirstName, LastName, Username (a streaming service's sign-in, v1.9.70-t13),
 *     ExternalIPAddress, PhysicalAddress or ReasonForNotReady (the remote-access status's own words, which carry the
 *     home's external address, v1.9.70-t13) (any case), or a member
 *     of the server's (its names start with a capital: Token, AccessToken, Password) whose name says token,
 *     password, secret or credential — Rouen's own debug fields (lowercase: the Qobuz probe's `token`, which names
 *     which token it tried) are its own and stay;
 *   - a change the push recorder lists as { name, v } (push-log.js) under such a name.
 * A value is withheld when it says something: a string, a number, a date or bytes. true/false, null and "" stay, as
 * whether a token is set or empty is worth seeing. The devices' LAN addresses (IPAddress) stay: finding a device needs
 * them (the server's own, inside the remote-access status, goes with the rest of it). A debug route answers with
 * res.json, which this patches. Not covered: an answer the graph couldn't read, given as its first bytes in hex
 * (settings-probe.js `answer`) — bytes can't be told apart by name.
 *
 *   withhold(value)         a copy of value, everything above replaced by WITHHELD
 *   withholdDebug           Express middleware: res.json sends withhold(value)
 */

const WITHHELD = "(withheld by Rouen)";
/** Members withheld by their whole name, as the server names them (any case). */
const NAMES = new Set(["userid", "email", "firstname", "lastname", "username", "externalipaddress", "physicaladdress",
  "reasonfornotready"]);
/** And any of the server's (a capital first) whose name says it is a credential. */
const SECRET = /token|password|secret|credential/i;
/** The types whose every member is withheld. */
const TYPES = /^(Account|RemoteAccessStatus|Mobile)$/;
/** A change's value, beside its name, in the push recorder's lists. */
const VALUE_KEYS = ["v", "value", "was", "now"];

/** @param {string} k */
const isWithheld = (k) => NAMES.has(k.toLowerCase()) || (/^[A-Z]/.test(k) && SECRET.test(k));
/** A value that says something: withheld where its name or its object's type says so. @param {any} x */
const says = (x) => (typeof x === "string" && x !== "") || typeof x === "number" || typeof x === "bigint"
  || x instanceof Date || Buffer.isBuffer(x);
/**
 * Whether an object is of a withheld type, however a probe names it: 'Account "901"', "Sooloos.Broker.Api.Account".
 * @param {any} v
 */
const typed = (v) => [v.object, v.struct, v.$type].some((t) => typeof t === "string" && TYPES.test(t.split(/[\s"]/)[0].split(".").pop() || ""));

/**
 * @param {any} v @param {boolean} [all]  inside an account or the remote-access status: everything that says something
 * @param {Set<object>} [within]  the values it sits inside: one met again among them (a cycle, should one come) is cut
 *   rather than walked for ever; one met twice elsewhere (shared) is copied twice, as JSON would
 * @returns {any}
 */
function withhold(v, all = false, within = new Set()) {
  if (!v || typeof v !== "object" || Buffer.isBuffer(v) || v instanceof Date) return all && says(v) ? WITHHELD : v;
  if (typeof v.toJSON === "function") return withhold(v.toJSON(), all, within);
  if (within.has(v)) return "(a cycle)";
  within.add(v);
  /** @type {any} */
  let out;
  if (Array.isArray(v)) out = v.map((x) => withhold(x, all, within));
  else {
    const whole = all || typed(v);
    // a member's name, as the recorder gives it: one word ("Email"), not an album's or a setting's name
    const named = typeof v.name === "string" && /^\w+$/.test(v.name) && isWithheld(v.name);
    out = {};
    for (const [k, x] of Object.entries(v)) {
      // An object's own type and id stay, to say what was withheld.
      if (whole && !all && ["object", "struct", "$type", "oid"].includes(k)) out[k] = x;
      else if (says(x) && (isWithheld(k) || (named && VALUE_KEYS.includes(k)))) out[k] = WITHHELD;
      else out[k] = withhold(x, whole, within);
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
