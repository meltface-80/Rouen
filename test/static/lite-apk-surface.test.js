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

// 2.0.6-t11 (the owner: "I said it was failing to copy and to fix it, not remove it"): Copy image back, tried with Play
// Protect on the owner's device. 2.0.6-t18 (the owner: "the share card copy function does copy to clipboard but also
// downloads it. I don't want download at the same time"): the card kept in the app's own cache, the clipboard holding
// one provider's address for it — that provider alone, not exported, read only, granted by the clipboard; no
// FileProvider and no new permission (2.0.6-t6's, which Play Protect blocked, had both); and nothing saved to the
// gallery by a Copy. The clipboard in CardCopy.kt alone.
test("one content provider, the copied card's: not exported, read only, granted by the clipboard; nothing of a FileProvider", () => {
  const providers = [...manifest.matchAll(/<provider\b[^>]*\/>/g)].map((m) => m[0]);
  assert.equal(providers.length, 1, "a provider besides the copied card's");
  assert.match(providers[0], /android:name="\.CardProvider"/);
  assert.match(providers[0], /android:exported="false"/, "the card's provider open to every app");
  assert.match(providers[0], /android:grantUriPermissions="true"/);
  assert.match(providers[0], /android:authorities="\$\{applicationId\}\.card"/);
  assert.doesNotMatch(providers[0], /android:(read|write)?[pP]ermission=/, "a permission named for the provider");
  const dir = path.join(LITE, "java", "app", "rouen", "lite");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".kt"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /androidx\.core\.content\.FileProvider|:\s*FileProvider\(|getUriForFile/, f + ": a FileProvider");
    if (f !== "CardCopy.kt") assert.doesNotMatch(src, /ClipboardManager|setPrimaryClip/, f + ": the clipboard is CardCopy.kt's alone");
  }
  const provider = fs.readFileSync(path.join(dir, "CardProvider.kt"), "utf8");
  assert.match(provider, /if \(!ours\(uri\) \|\| mode != "r"\) throw FileNotFoundException/, "the card opened for writing, or another file");
  assert.match(provider, /override fun insert\(uri: Uri, values: ContentValues\?\): Uri\? = null/);
  assert.match(provider, /override fun delete\([^)]*\) = 0/);
  assert.match(provider, /override fun update\([^)]*\) = 0/);
  const copy = fs.readFileSync(path.join(dir, "CardCopy.kt"), "utf8");
  assert.match(copy, /ClipData\.newUri\(context\.contentResolver, "Album card", CardProvider\.uri\(context\)\)/);
  assert.doesNotMatch(copy, /\.insert\(|IS_PENDING|openOutputStream/, "THE one: a Copy saved the card to the gallery — a download, not a copy");
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
