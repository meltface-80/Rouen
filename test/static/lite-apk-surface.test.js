"use strict";
/*
 * Rouen Lite's APK, as Android and Google Play Protect see it (dev/design/rouen-lite.md §3, 2.0.6-t9). 2.0.6-t6 gave it
 * the clipboard (a content:// address to the share card's picture), a FileProvider and the storage permission, and
 * Play Protect then blocked Rouen Lite as harmful on the owner's device (2026-11-23; 2.0.6-t4 installed). Its APK went
 * back to 2.0.6-t4's. Anything that widens what it asks of Android is a change of its own, tried on a device with Play
 * Protect first: this test fails on it, so it is never carried in unnoticed.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LITE = path.join(__dirname, "..", "..", "android", "lite", "src", "main");
const manifest = fs.readFileSync(path.join(LITE, "AndroidManifest.xml"), "utf8");

test("Rouen Lite asks Android for exactly the permissions 2.0.6-t4 did", () => {
  const asked = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(asked, [
    "android.permission.ACCESS_NETWORK_STATE", "android.permission.ACCESS_WIFI_STATE", "android.permission.CHANGE_WIFI_MULTICAST_STATE",
    "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_SPECIAL_USE", "android.permission.INTERNET",
    "android.permission.POST_NOTIFICATIONS", "android.permission.WAKE_LOCK",
  ]);
});

test("no content provider, and nothing of the clipboard or another app's files in its code", () => {
  assert.doesNotMatch(manifest, /<provider\b/, "a FileProvider was part of what Play Protect blocked");
  const dir = path.join(LITE, "java", "app", "rouen", "lite");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".kt"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /ClipboardManager|setPrimaryClip|FileProvider/, f);
  }
});
