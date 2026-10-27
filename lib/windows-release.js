// @ts-check
"use strict";
/*
 * windows-release.js — what a release carries for Windows (v1.9.67-t7), named
 * in one place: the build (tools/windows/build.js) writes these files, the
 * workflow (.github/workflows/windows.yml) attaches them to the release, and
 * the updater (lib/updater.js) looks for the payload among a release's assets.
 *
 *   Rouen-vX.Y.Z-windows-x64.exe      the executable: node.exe with the app
 *                                     inside it (lib/windows-bootstrap.js)
 *   Rouen-vX.Y.Z-windows-x64.tar.gz   the payload: the app and its
 *                                     node_modules built for Windows — what
 *                                     the executable unpacks, and what a
 *                                     Windows install's one-tap update
 *                                     downloads instead of the source tarball
 */

/** The end of the payload's name; the executable's ends in .exe instead. */
const PAYLOAD_SUFFIX = "-windows-x64.tar.gz";
const EXE_SUFFIX = "-windows-x64.exe";

/**
 * The two files for a version.
 * @param {string} version  package.json's, without a leading v
 */
function windowsAssetNames(version) {
  const v = String(version).replace(/^v/i, "");
  return { exe: "Rouen-v" + v + EXE_SUFFIX, payload: "Rouen-v" + v + PAYLOAD_SUFFIX };
}

/**
 * Whether a release asset is the Windows payload — by its ending, as the
 * updater finds the source tarball by its extension.
 * @param {string | null | undefined} name
 */
function isWindowsPayload(name) {
  return typeof name === "string" && name.toLowerCase().endsWith(PAYLOAD_SUFFIX);
}

module.exports = { PAYLOAD_SUFFIX, EXE_SUFFIX, windowsAssetNames, isWindowsPayload };
