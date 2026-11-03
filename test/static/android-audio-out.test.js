"use strict";
// v2.0.1-t1: the app's log says where the phone's sound goes (dev/design/android-app.md §4.13). The owner's stutter of
// 2026-11-03 (Bluetooth earbuds on AAC) had no underrun in the app's log: the gaps were after the app, and the log did not
// say where the sound went. The Kotlin is compiled and its JVM tests run in CI only (AudioOutTest.kt); this pins the
// wiring here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "android", "app", "src", "main", "java", "app", "rouen", "android");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

test("THE one: the audio track's line and each underrun's say where the sound goes", () => {
  const log = read("PlayerLog.kt");
  assert.match(log, /class PlayerLog\(private val context: Context\)/);
  assert.match(log, /override fun onAudioTrackInitialized[\s\S]*?\+ out\(\)\)/, "the audio track's line");
  assert.match(log, /override fun onAudioUnderrun[\s\S]*?\$\{out\(\)\}", anomaly = true\)/, "the underrun's line");
  assert.match(log, /private fun out\(\) = if \(AppLog\.on\) AudioOut\.now\(context\)/, "Android is asked only while the log is on");
  assert.match(read("PlayerService.kt"), /player\.addAnalyticsListener\(PlayerLog\(this\)\)/);
});

test("the kind only: no device's name reaches the log", () => {
  const out = read("AudioOut.kt");
  assert.doesNotMatch(out, /productName|\.address|getAddress/, "a device's name and address are the owner's");
  assert.match(out, /getAudioDevicesForAttributes/, "Android 13 and later: where music is routed");
  assert.match(out, /GET_DEVICES_OUTPUTS/, "before: what is connected, said as that");
});
