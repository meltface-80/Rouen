"use strict";
/*
 * Rouen Lite's built-in Tailscale (L4, dev/design/rouen-lite.md §5.1, 2.0.6-t10): the APK carries the Rouen Android
 * app's engine, built the same way; the app names it, its machine and the interfaces' file to Rouen's server; the server
 * runs that engine. A device is the only proof it runs (CLAUDE.md); these pin the wiring a device run rests on.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("the workflow builds the engine as android.yml does, into Lite's native libraries, and the APK must carry it", () => {
  const lite = read(".github/workflows/lite.yml"), android = read(".github/workflows/android.yml");
  const build = "GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build -trimpath";
  assert.ok(android.includes(build) && lite.includes(build), "the Rouen Android app's build, the same");
  assert.match(lite, /-o \.\.\/android\/lite\/src\/main\/jniLibs\/arm64-v8a\/libmusicdnet\.so \./);
  assert.match(lite, /for f in [^;]*lib\/arm64-v8a\/libmusicdnet\.so[^;]*; do/, "the APK's check names it");
  assert.match(lite, /- "musicdnet\/\*\*"/, "a change to the engine builds Rouen Lite");
});

test("the app names the engine, its machine and the interfaces' file; the service writes the file", () => {
  const runner = read("android/lite/src/main/java/app/rouen/lite/NodeRunner.kt");
  assert.match(runner, /Os\.setenv\("MUSICDNET_BIN", File\(app\.applicationInfo\.nativeLibraryDir, "libmusicdnet\.so"\)\.absolutePath, true\)/);
  assert.match(runner, /Os\.setenv\("TS_HOSTNAME", "rouen-lite", true\)/);
  assert.match(runner, /Os\.setenv\("MUSICDNET_INTERFACES", Interfaces\.file\(app\)\.absolutePath, true\)/);
  const service = read("android/lite/src/main/java/app/rouen/lite/RouenService.kt");
  assert.equal((service.match(/Interfaces\.write\(applicationContext\)/g) || []).length, 2, "as it starts, and on each change of network");
  assert.match(read("android/lite/src/main/java/app/rouen/lite/Interfaces.kt"), /File\(context\.filesDir, "rouen\/data\/tailscale\/interfaces\.txt"\)/,
    "in Rouen's data folder, its Tailscale folder (lib/tailscale/mount.js)");
});

test("the server runs the engine the app names", () => {
  assert.match(read("lib/tailscale/mount.js"), /bin: env\.MUSICDNET_BIN \|\| \(platform === "win32"/);
  assert.match(read("lib/tailscale/mount.js"), /const dir = path\.join\(o\.root, "data", "tailscale"\);/);
});

// The review of 2.0.6-t10: the engine installed the app's interfaces for a phone only, and Lite runs it as a server, so
// on Android it saw no network (musicdnet/ifaces_mode_test.go pins the rule); Tailscale's sign-in link opened inside the
// WebView, where sign-ins are refused and Rouen was replaced; two writes of the interfaces could cross.
test("the engine takes the app's interfaces on Android as a server too", () => {
  assert.match(read("musicdnet/main.go"), /if useAppInterfaces\(\*server, runtime\.GOOS\) \{\n\t\tInstallInterfaceGetter\(\)/);
  assert.match(read("musicdnet/ifaces.go"), /func useAppInterfaces\(server bool, goos string\) bool \{ return !server \|\| goos == "android" \}/);
});

test("another site's link (Tailscale's sign-in) opens in the device's browser; one interfaces write at a time", () => {
  const main = read("android/lite/src/main/java/app/rouen/lite/MainActivity.kt");
  assert.match(main, /override fun shouldOverrideUrlLoading\(view: WebView, request: WebResourceRequest\): Boolean \{/);
  assert.match(main, /if \(u\.host == "127\.0\.0\.1" \|\| u\.host == "localhost"\) return false/);
  assert.match(main, /startActivity\(Intent\(Intent\.ACTION_VIEW, u\)/);
  assert.match(read("android/lite/src/main/java/app/rouen/lite/Interfaces.kt"), /@Synchronized\n    fun write\(context: Context\)/);
});
