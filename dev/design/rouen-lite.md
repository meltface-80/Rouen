# Rouen Lite — design

## 1. Goal (the owner's words, 2026-11-23)

> "From the latest release on main I want you to make me an Android version of Rouen. This will be the extension with no
> docker or Linux machine at all needed. This will be called Rouen Lite. Add as much of Rouen as physically possible.
> Not needed is the wall display feature. To confirm, this will be a Android APK that is the extension."

Rouen Lite is an APK that **is** the Roon extension: Rouen's own server, running on an Android phone or tablet on the
same network as the Core, with Rouen's page in the app. No Docker, no Linux machine.

## 2. The owner's answers (2026-11-23)

1. **Its own extension in Roon.** A new `extension_id` (`com.musicd.roon.rouen-lite`), shown as "Rouen Lite vX.Y.Z",
   enabled once in Roon → Extensions. It can run beside a Docker Rouen without the two fighting over one authorisation.
   Rouen's own `extension_id` is unchanged (CLAUDE.md).
2. **Node 24, from the community fork, pinned.** The official `nodejs-mobile` stopped at Node 18 (out of support since
   April 2025). `fogtape/nodejs-mobile` builds Node 24 LTS for Android from the official Node sources plus mobile patches,
   by CI, MIT-licensed like Node. Rouen Lite uses its **full** Android build (the "lite" build has no SQLite), version
   `v24.21.0-0`, `nodejs-mobile-android-24.21.0-0.zip`, checked against SHA-256
   `e3cd29a1be03405f11dd5c857af8cd3ad13f84f1409ea648f5328f0bada5bd76` by the workflow that builds the APK. Its ABIs:
   `arm64-v8a`, `armeabi-v7a`, `x86_64`, 16 KB pages. The release is marked a pre-release by its maintainer; a newer
   pin is a change of its own, with the APK run again on a device.
3. **Released beside Rouen.** The same version as Rouen; `Rouen-Lite-X.Y.Z.apk` (named as Rouen for Android's
   `Rouen-Android-X.Y.Z.apk` is) attached to each Rouen release, and
   test builds on a rolling `test-lite` pre-release, as the Rouen Android app's are on `test-android`. One codebase.
4. **Other devices may use it**, behind Rouen's account and login, as they use a Docker Rouen: Rouen Lite serves Rouen on
   the network on port 3399.

The base: the owner asked for "the latest release on main"; Rouen Lite is built from the same code as Rouen, on `dev`
as every piece of work is (CLAUDE.md), so it carries every release from v2.0.5 on and keeps in step with Rouen after.

## 3. How it is made

- **The runtime.** `libnode.so` (from the fork; 64-bit ARM alone for now, the devices Rouen Lite is for) and a small JNI
  library of Rouen Lite's own (`android/lite/src/main/cpp`, built with the NDK through Gradle's CMake) that starts Node
  with `node::Start(argc, argv)` on a thread of its own, once per process: Node cannot be started twice in one process.
  It finds `node::Start` in the loaded `libnode.so` by its C++ name at run time, so it needs neither Node's headers nor a
  link against it; the workflow checks `libnode.so` exports it, and ships `libc++_shared.so` beside it when it needs one
  (it does: the pinned zip has none, so the NDK's is shipped, and the build fails unless that copy defines every symbol
  of libc++'s `std::__ndk1` that `libnode.so` asks for, libnode being built with another NDK).
  Node's stdout and stderr go to Android's log under the tag `RouenLite`.
- **Rouen's server, unchanged.** `index.js`, `lib/`, `public/`, `package.json` and the production `node_modules` (no
  install scripts run, `better-sqlite3` left out) go into the APK as `assets/rouen.zip`, with
  `android/lite/server/lite-start.js`, which runs Rouen from its own folder. It is unpacked to the app's
  `files/rouen/app` whenever the installed APK is newer than the copy (its install time, so a test build of the same
  version counts), the tree replaced whole. Rouen's data, `files/rouen/data`, is the app's own and kept: `app/data` is a
  link to it, removed before the old tree is, so a delete never follows it.
- **Runs as a foreground service** with its ongoing notification ("Rouen Lite is running", and the address other
  devices use, kept current as the device's network changes, its Wi-Fi address first): Android stops background work
  otherwise. It holds a Wi-Fi multicast lock (Roon finds its Core by multicast), a Wi-Fi lock, and a CPU lock (a
  partial wake lock: a server answers Roon and other devices with the screen off, at the cost in battery and heat §7
  names) while it runs, and asks to be left out of battery optimisation (L2).
- **When Node ends** (Rouen restarting itself after a restore, which ends the process, or Rouen failing), the app's
  process ends with it: Node can't start twice in one process, so Android starts the service again in a new one
  (START_STICKY), and the next open of the app starts it if Android hasn't.
- **Downloads** (a backup, a playlist, a log): the page hands their bytes to the app (`window.RouenLite.fileSave`, as
  Rouen for Android's `RouenPhone.fileSave`), which saves them to Downloads/Rouen.
- **The share card** (2.0.6-t11): Copy image and Download. A WebView refuses the image clipboard and a download link
  goes nowhere in it, so the app does both. Download is `fileSave`, to Downloads/Rouen, as the page's other downloads.
  Copy image (`CardCopy.kt`) saves the card to Pictures/Rouen through MediaStore (no permission on Android 10 and
  later; before, it says to use Download), replacing the card copied before, and puts that picture's `content://`
  address on the clipboard. History: 2.0.6-t6 gave Rouen Lite Copy image as Rouen for Android has it (a `FileProvider`
  over the app's cache, the storage permission on Android 8 and 9), and Google Play Protect then blocked Rouen Lite as
  a harmful app on the owner's device (2026-11-23; 2.0.6-t4 installed, 2.0.6-t6 was warned of, 2.0.6-t8 blocked).
  2.0.6-t9 put the APK back to 2.0.6-t4's and left Copy image out; the owner: "I said it was failing to copy and to fix
  it, not remove it" (2026-11-24). This way has no provider and no permission; it was tried with Play Protect on the
  owner's device, as its pull request's own APK, before it merged. `test/static/lite-apk-surface.test.js` pins what
  Rouen Lite asks of Android, the clipboard in `CardCopy.kt` alone.
- **Rouen's own update** (the source tarball over the server) is refused under Lite, and the "Switch to Docker" banner
  isn't shown: Rouen Lite updates as an app (L5). It starts when the app is opened, and, if the owner turns it on, when the
  device starts.
- **The app's screen** is Rouen's page in a WebView, on `http://127.0.0.1:3399`, shown once the server answers
  ("Starting Rouen Lite…" until then, for up to three minutes; why, if Node ended). Other devices use
  `http://<device's address>:3399`, which the service's notification says. Back leaves the page running.
- **What tells the server it is Lite:** `ROUEN_LITE=1` in its environment: the extension's id and name (§2.1), the
  data folder, and the features Lite leaves out (§4).

### 3.1 What needs changing for Android

| Rouen uses | On Android | Rouen Lite |
|---|---|---|
| `better-sqlite3` (native, built for Linux/Windows) | No build for Android | Node's own `node:sqlite` (Node 22.5+), behind an adapter with `better-sqlite3`'s calls Rouen uses (`prepare` with `run`/`get`/`all`/`iterate`, `exec`, `transaction`, `pragma`, `raw`): one database, `index.js`'s `labelsDb` |
| ffmpeg (`ffmpeg-static`) | A Linux binary | An ffmpeg built for Android, run from the app's native library folder (the only folder Android lets an app run a program from) — stage L3 |
| musicdnet (Go, Tailscale) | Built for Linux/Windows | Built for `android/arm64` and run the same way — stage L4 |
| The one-tap update (tarball, Docker) | Neither exists | The APK's own update, as the Rouen Android app updates itself — stage L5 |

## 4. What Rouen Lite leaves out

- **The wall display** (the owner: not needed; 2026-11-23, "Wall display wasn't removed as requested", 2.0.6-t8): off
  whatever was saved, and never turned on (`lib/routes/display-settings.js` says `lite: true` and refuses it), so its
  menu entry, the Shelf's button and the idle switch to it never show, and Settings has no Wall Display
  (`public/settings-panes.js`).
- **HQPWeb** (the owner, 2026-11-23: "Remove hqpweb as without a server this feature doesn't work", 2.0.6-t8): HQPlayer
  runs on a computer of its own. Not registered (`lib/plugins-mount.js`), so the Plugins page has nothing, and goes.
- **Away from home and its Tailscale** (the owner, 2026-11-24, 2.0.6-t10: "Shelve away from home for Rouen lite.
  Remove it and tailscale from Rouen lite only. Keep everything else"). Away from home is worth having for the phone's
  own Roon zone, its stream turned into Opus by Rouen (Roon sends nothing below 16-bit 44.1 kHz); Rouen Lite has no
  transcoder (L3), so the owner shelved it. Settings has no Away from home (`public/settings-panes.js`), a page opened
  all the same says it isn't in Rouen Lite (`public/away.js`), and its routes refuse a change and start nothing
  (`lib/tailscale/routes.js`). 2.0.6-t10's first form, Tailscale built in (L4, pull request #531), was built and not
  merged.
- **Docker's and Windows' own parts:** `docker pull`, the container's update, the Windows launcher.
- **Your music folder (`/music`)**: Lite has no music folder of its own, so what reads one (the label scan of files,
  local waveforms, album credits from file tags, downloads of the server's files) says it isn't there, as a Docker Rouen
  without the mount does.
- Anything found on a device not to work is said in the app, not hidden.

Everything else is Rouen's own code, unchanged: the library, search, Home, Shelf, the album and artist pages, playlists
and their editing, native mode, Listen Later, TIDAL and Qobuz through Roon, credits from MusicBrainz and
Wikipedia, signal path, the zones and their settings, backups, the account and login.

## 5. Stages

Each a build of its own (`X.Y.Z-tN`), its APK on `test-lite`, run by the owner on a device before the next.

- **L1 — the runtime.** The APK: Node 24 started by the JNI library, Rouen's server unchanged under `ROUEN_LITE=1`,
  `node:sqlite` behind the adapter, the foreground service, the multicast lock, the page in a WebView. Proved on a device:
  Roon finds "Rouen Lite", it is enabled, the library loads, playing works; another device opens it and logs in.
- **L2 — what Lite leaves out, said** (§4), the start with the device, battery optimisation, the app's own log.
- **L3 — ffmpeg for Android**: waveforms of TIDAL and Qobuz, and the phone's streams.
- **L4 — Tailscale** away from home: shelved by the owner (2026-11-24, §4).
- **L5 — updates**: the APK checks and installs Rouen Lite's newer releases, as the Rouen Android app does; the release
  workflow attaches `Rouen-Lite-vX.Y.Z.apk`.

## 6. What only a device can say

The runtime's start, Android's treatment of a long-running service (Doze, a maker's own battery rules), multicast on a
given Wi-Fi, and a phone's heat and battery under a library read: none of these is testable here (CLAUDE.md). The
SQLite adapter and every `ROUEN_LITE` difference are tested in the suite like any other module, on Node's own
`node:sqlite`.

## 7. Risks, said plainly

- **The runtime is a community fork.** It is pinned and checked by SHA-256, its patches and build are public, and it is
  built from official Node sources; a fork can still stop. The official `nodejs-mobile` (Node 18) is the fallback,
  at the cost of Rouen code written for Node 20+.
- **A phone is not a server.** Rouen Lite is the extension only while the device is on, on the Core's network, with the
  app running. A phone leaving home takes the extension with it. An old phone or tablet left on charge at home is the
  device it suits.
- **Child processes on Android** (ffmpeg, musicdnet) are limited by the platform: L3 and L4 prove they run before they
  are built on.
