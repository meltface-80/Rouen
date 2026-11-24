"use strict";
/*
 * Rouen Lite's APK, as Android and Google Play Protect see it (dev/design/rouen-lite.md §3, 2.0.6-t9). 2.0.6-t6 gave it
 * the clipboard (a content:// address to the share card's picture), a FileProvider and the storage permission, and
 * Play Protect then blocked Rouen Lite as harmful on the owner's device (2026-11-23; 2.0.6-t4 installed). Its APK went
 * back to 2.0.6-t4's. Anything that widens what it asks of Android is a change of its own, tried on a device with Play
 * Protect first: this test fails on it, so it is never carried in unnoticed. 2.0.6-t11 widened it by Copy image's
 * clipboard alone, at the owner's word, tried on their device before it merged.
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

// 2.0.6-t11 (the owner: "I said it was failing to copy and to fix it, not remove it"): Copy image back, the narrowest
// way, tried with Play Protect on the owner's device before it merges. The clipboard in CardCopy.kt alone, holding a
// MediaStore picture's address; still no provider, no FileProvider, no new permission.
test("no content provider; the clipboard in CardCopy.kt alone; nothing of a FileProvider", () => {
  assert.doesNotMatch(manifest, /<provider\b/, "a FileProvider was part of what Play Protect blocked");
  const dir = path.join(LITE, "java", "app", "rouen", "lite");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".kt"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /FileProvider/, f);
    if (f !== "CardCopy.kt") assert.doesNotMatch(src, /ClipboardManager|setPrimaryClip/, f + ": the clipboard is CardCopy.kt's alone");
  }
  const copy = fs.readFileSync(path.join(dir, "CardCopy.kt"), "utf8");
  assert.match(copy, /MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI/, "a MediaStore picture, no file of the app's own handed out");
  assert.match(copy, /ClipData\.newUri\(r, "Album card", uri\)/);
});

// 2.0.6-t12 (the owner: "open in Qobuz fails"): a link anywhere but Rouen's own page goes to Android, not the WebView.
// An intent:// link comes from a web page, so it is held to what a browser may open: BROWSABLE, and no component or
// selector of its own (the standard guard against a page starting any app's inner parts).
test("a link off Rouen's page goes to Android; an intent:// link only where a browser may go", () => {
  const main = fs.readFileSync(path.join(LITE, "java", "app", "rouen", "lite", "MainActivity.kt"), "utf8");
  assert.match(main, /if \(isWeb && \(u\.host == "127\.0\.0\.1" \|\| u\.host == "localhost"\)\) return false/);
  assert.match(main, /Intent\.parseUri\(u\.toString\(\), Intent\.URI_INTENT_SCHEME\)\.apply \{\n\s+addCategory\(Intent\.CATEGORY_BROWSABLE\)\n\s+component = null\n\s+selector = null/);
  assert.match(main, /Intent\(Intent\.ACTION_VIEW, u\)\.addCategory\(Intent\.CATEGORY_BROWSABLE\)/);
  assert.match(main, /if \(f\.scheme != "http" && f\.scheme != "https"\) return/, "a fallback is a web address, or nothing");
  assert.doesNotMatch(manifest, /QUERY_ALL_PACKAGES|<queries\b/, "no list of the device's apps asked for");
});
