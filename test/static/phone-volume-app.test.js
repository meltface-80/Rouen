"use strict";
// v1.9.72-t74: the phone's volume (the owner, 2026-11-02: playback "very quiet despite being at 100%"; "unlink zone
// volume from the device buttons and recommend setting Roon's device settings to 100% fixed and use the phone's volume
// control"). Class of error: the phone's volume keys were all taken for the selected Roon zone (t45), so on the phone's
// own zone Android's media volume could never be raised while Rouen's page was up, and the phone's loudness was
// whatever it had been left at. Now the app plays Roon's stream at full gain, and on the phone's own zone the keys
// are the phone's media volume. The app's Kotlin is compiled by CI only, so it is read here; the page's half is
// test/dom/phone-volume-keys.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "../../android/app/src/main/java/app/rouen/android");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");

/** The body of the function whose head is [head] in [src]: from its brace to the matching one. */
function body(src, head) {
  const at = src.indexOf(head);
  assert.ok(at > -1, head + " not found");
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(head + ": no end");
}

test("THE one: Roon's volume for the phone's zone is never applied to the player", () => {
  const apply = body(read("PlayerService.kt"), "private fun apply(cmd: JSONObject)");
  assert.doesNotMatch(apply, /\.volume\s*=/, "apply() sets the player's volume from Roon's");
  assert.doesNotMatch(apply, /roonVolume|optDouble\("gain"/, "apply() still reads Roon's gain");
  assert.match(apply, /"volume" -> return/, "Roon's volume command is let go");
  assert.doesNotMatch(read("LocalPlay.kt"), /roonGain|roonVolume/, "Roon's volume is still kept to be given back");
});

test("on the phone's own zone the volume keys are the phone's media volume; the page says which zone", () => {
  const keys = body(read("MainActivity.kt"), "override fun dispatchKeyEvent(event: KeyEvent)");
  assert.match(keys, /window\.__rouenVolumeKeyAt/, "the page is not asked where a press goes");
  assert.match(keys, /phoneVolume\(delta\)/, "an answer of phone does not move the phone's volume");
  // evaluateJavascript answers in JSON: the string phone arrives with its quotes.
  assert.match(keys, /answer == "\\"phone\\""/, "the page's answer is compared without its JSON quotes: it never matches");
  assert.match(keys, /keysToPhone = false[^\n]*\n\s*web\.evaluateJavascript/, "a held key may move the phone's volume on the last press's answer");
  const step = body(read("MainActivity.kt"), "private fun phoneVolume(delta: Int)");
  assert.match(step, /adjustStreamVolume\(\s*android\.media\.AudioManager\.STREAM_MUSIC/);
});
