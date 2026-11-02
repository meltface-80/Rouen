"use strict";
// v1.9.72-t72: the phone plays its Roon zone away from home too (dev/design/android-app.md §4.23: one zone, the same
// home and away, over Rouen's Tailscale). The app's relay was restored (t68/t69) with a guard from the split head of
// 2026-10-31 (§4.20) still in it: away, PlayerService.apply() stopped every session Roon opened and ignored Roon's other
// commands — the owner on 5G, 2026-11-02: "I get no playback now". The app's Kotlin is compiled by CI only, so its
// command handler is read here: nothing in it may turn Roon away for being away from home.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../android/app/src/main/java/app/rouen/android/PlayerService.kt"), "utf8");

/** The body of `private fun apply(cmd: JSONObject)`: from its brace to the matching one. */
function applyBody() {
  const at = SRC.indexOf("private fun apply(cmd: JSONObject)");
  assert.ok(at > -1, "PlayerService.apply not found");
  const open = SRC.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) return SRC.slice(open, i + 1);
  }
  throw new Error("apply's body has no end");
}

test("THE one: Roon's commands to the phone's zone are taken away from home as at home", () => {
  const body = applyBody();
  assert.doesNotMatch(body, /Away\.active|Way\.Kind/, "apply() still decides by home or away: Roon's sessions are refused away");
  // What still decides is the phone's own play of its downloads (LocalQueue.roonMay, JVM-tested).
  assert.match(body, /LocalQueue\.roonMay\(/);
});
