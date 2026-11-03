"use strict";
// The genre/tag filter in a request (lib/filter-params.js, moved out of index.js unchanged in v1.9.72-t12).
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFilter } = require("../../lib/filter-params");

test("a filter: its type and value, a genre's parent; anything else none", () => {
  assert.deepEqual(parseFilter({ filter_type: "genre", filter_value: " Heavy Metal ", filter_parent: "Pop/Rock" }), { type: "genre", value: "Heavy Metal", parent: "Pop/Rock" });
  assert.deepEqual(parseFilter({ filter_type: "tag", filter_value: "Live", filter_parent: "ignored" }), { type: "tag", value: "Live" });
  assert.deepEqual(parseFilter({ filter_type: "label", filter_value: "ECM" }), { type: "label", value: "ECM" });
  assert.deepEqual(parseFilter({ filter_type: "decade", filter_value: "1970" }), { type: "decade", value: "1970" });
  assert.equal(parseFilter({ filter_type: "year", filter_value: "1970" }), null);
  assert.equal(parseFilter({ filter_type: "genre", filter_value: "  " }), null);
  assert.equal(parseFilter({}), null);
});
