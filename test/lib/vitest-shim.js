"use strict";
// ---------------------------------------------------------------------------
// The few vitest calls hqpweb's tests use (describe, it, expect with toBe,
// toEqual, toMatchObject, toBeNull, toContain), on node:test and
// node:assert, so its advice tests run here nearly as written — a port of
// the tests, not a paraphrase of them.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");

const describe = (name, fn) => test.describe(name, fn);
const it = (name, fn) => test.it(name, fn);

// JSON round trip: hqpweb's objects carry `undefined` keys that toEqual ignores.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function matches(actual, expected) {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => matches(actual[i], e));
  return Object.keys(expected).every((k) => matches(actual[k], expected[k]));
}

function expect(actual) {
  return {
    toBe: (e) => assert.equal(actual, e),
    toEqual: (e) => assert.deepEqual(plain(actual), plain(e)),
    toMatchObject: (e) => assert.ok(matches(plain(actual), plain(e)), JSON.stringify(actual) + " does not match " + JSON.stringify(e)),
    toBeNull: () => assert.equal(actual, null),
    toContain: (e) => assert.ok(actual.includes(e), JSON.stringify(actual) + " does not contain " + JSON.stringify(e)),
    toBeTruthy: () => assert.ok(actual),
    toMatch: (re) => assert.match(actual, re),
  };
}

module.exports = { describe, it, expect };
