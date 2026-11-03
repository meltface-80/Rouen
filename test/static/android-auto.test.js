"use strict";
// v1.9.72-t81: Android Auto (dev/design/android-app.md §4.24; the owner, 2026-11-03: "add Android auto support to the
// app Mandarin has this"). The app's Kotlin is compiled by CI only, so its wiring is read here; the tree's logic is
// JVM-tested (CarTreeTest.kt):
//   - the manifest makes the app a media app in the car (the browser actions, the car meta-data, automotive_app_desc);
//   - the player service is a library service whose session is CarLibrary's;
//   - a tap in the car reaches the player (COMMAND_SET_MEDIA_ITEM) and the player keeps what CarLibrary started;
//   - Rouen's albums are played by Roon to the phone's own zone; downloads from the phone's copy;
//   - Roon's opening of a session answers a waiting tap.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "../../android/app/src/main");
const read = (f) => fs.readFileSync(path.join(APP, f), "utf8");
const KT = (f) => read("java/app/rouen/android/" + f);

test("THE one: the app is a media app for Android Auto", () => {
  const m = read("AndroidManifest.xml");
  assert.match(m, /android\.media\.browse\.MediaBrowserService/, "Android Auto finds media apps by this action");
  assert.match(m, /androidx\.media3\.session\.MediaLibraryService/);
  assert.match(m, /com\.google\.android\.gms\.car\.application[\s\S]{0,80}@xml\/automotive_app_desc/);
  assert.match(read("res/xml/automotive_app_desc.xml"), /<uses name="media"\s*\/>/);
});

test("the player service is a library service, its session CarLibrary's", () => {
  const s = KT("PlayerService.kt");
  assert.match(s, /class PlayerService : MediaLibraryService\(\)/);
  assert.match(s, /MediaLibrarySession\.Builder\(this, r, car\)/);
  assert.match(s, /car\.opened\(p\.currentMediaItem\)/, "Roon opening a session doesn't answer a tap waiting for it");
  assert.match(s, /car\.inUse\(now, IDLE_MS\)/, "the player can stop while the car's screen is in use");
});

test("a tap in the car reaches the player, which keeps what CarLibrary started", () => {
  const r = KT("RoonPlayer.kt");
  const removed = r.slice(r.indexOf(".removeAll("), r.indexOf(".addAll("));
  assert.doesNotMatch(removed, /COMMAND_SET_MEDIA_ITEM\b/, "the car's tap is refused by the player");
  assert.match(r, /override fun setMediaItems\(mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long\)/);
  assert.match(r, /private fun keep\(items: List<MediaItem>\): Boolean = !local \|\|/);
});

test("Rouen's albums go to Roon for the phone's own zone; downloads play from the phone's copy", () => {
  const c = KT("CarLibrary.kt");
  assert.match(c, /"\/api\/play"/);
  assert.match(c, /"\/api\/playlist\/play"/);
  assert.match(c, /Prefs\.roonZone\(context\)/, "the zone played to isn't the phone's own");
  assert.match(c, /local\.play\(a, 0\)/, "a download isn't played from the phone's copy");
  for (const route of ["/api/home/history", "/api/smart-picks", "/api/random-albums", "/api/library/albums", "/api/playlists"]) {
    assert.ok(c.includes('"' + route), route + " isn't asked");
  }
});

test("a tap isn't sent late, waits behind no listing, and a connected car keeps the player up (review, t81)", () => {
  const c = KT("CarLibrary.kt");
  assert.match(c, /if \(f\.isDone\) return@execute/, "a tap given up on still asks Roon");
  assert.match(c, /taps\.execute \{/, "a tap queues behind the car's listings");
  assert.match(c, /connectedControllers\?\.any \{ it\.packageName in CARS \}/, "the player stops under a connected car");
  assert.doesNotMatch(c, /override fun onAddMediaItems/, "items with no address reach ExoPlayer");
});
