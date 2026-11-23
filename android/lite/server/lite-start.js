"use strict";
/*
 * lite-start.js — Rouen's server started inside Rouen Lite (dev/design/rouen-lite.md §3): Node is started by the APK
 * (NodeRunner.kt) with this file, from the folder Rouen was unpacked to. Rouen is run from its own folder, as Docker and
 * Windows run it, then index.js as it is. ROUEN_LITE=1 is in the environment already.
 */
process.chdir(__dirname);
require("./index.js");
