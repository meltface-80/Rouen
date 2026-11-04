"use strict";
// v2.0.1-t3: the wiring of "off until wanted" and "no diagnostic upload" (dev/design/android-app.md §4.7). The Go is
// tested in musicdnet/nologs_test.go, which CI does not run; this pins where it is called.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("../lib/extract");

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

test("THE one: the engine stops Tailscale's log upload before anything starts, for the server and the phone alike", () => {
  const main = read("musicdnet/main.go");
  const at = main.indexOf("noUpload(*dir)");
  assert.ok(at > 0, "main.go does not call noUpload");
  assert.ok(at < main.indexOf("e := &engine{"), "noUpload comes after the engine is made");
  const nologs = read("musicdnet/nologs.go");
  assert.match(nologs, /^\tlogtail\.Disable\(\)$/m, "logtail is not disabled");
  assert.match(nologs, /"tailscaled\.log1\.txt", "tailscaled\.log2\.txt"/, "an earlier run's upload buffers are left to be sent");
});

test("Rouen's server: off until wanted, and Sign in switches it on", () => {
  assert.match(read("lib/tailscale/mount.js"), /enabled: \(\) => enabledFrom\(o\.settings\.load\(\)\.tailscaleEnabled,/,
    "the switch is not read through opt-in.js");
  assert.doesNotMatch(read("lib/tailscale/mount.js"), /tailscaleEnabled !== false/, "on unless switched off, again");
  assert.match(read("lib/tailscale/node.js"), /async login\(\) \{\n\s+if \(available\(\) && !deps\.enabled\(\)\) deps\.setEnabled\(true\);/);
  assert.doesNotMatch(read("public/away.js"), /login\.disabled = [^;]*!s\.enabled/, "Sign in is greyed out while it is off");
});
