// @ts-check
"use strict";
/*
 * always-on.js — native mode always on, suspended rather than off when your server's private path fails
 * (dev/design/roon-native.md §11; the owner, 2026-11-26: "I also want native mode to be permanently on no toggle
 * switch to turn it off. But I do want fall back to full official API if native mode starts to have errors due to
 * roon closing the reverse code path").
 *
 *   stored(v)          what settings.json keeps of native mode (roonDirect), read safely (moved out of stage1.js)
 *   sameList(a, b)     whether two reads gave the same list (moved out of stage1.js)
 *   emergencyOff(o)    why native mode must not start at all, or null: ROUEN_NATIVE=off on the container, or Rouen
 *                      Lite's settings.json "native": "off" (§11, the owner's answer 2: "Container setting only")
 *   statusOf(x)        what GET /api/roon-direct says of it (moved out of stage1.js)
 *   openingFault(why)  whether an opening that failed says the path is closed or broken (§11.2): "refused" (the
 *                      server answered and refused), "failed" (it answered and the session never came up), or null
 *                      (it could not be reached: a drop, retried as before)
 */

/** @param {any} v */
function stored(v) {
  const s = v && typeof v === "object" ? v : {};
  const susp = s.suspended && typeof s.suspended === "object" && typeof s.suspended.why === "string" ? s.suspended : null;
  return {
    // Always on (§11): a saved `false` from the switch it had until 2.0.6-t21 is not read. Whether it runs is the
    // one-time choice's and the emergency off's (stage1.js `enabled`).
    on: true,
    rouenVersion: typeof s.rouenVersion === "string" ? s.rouenVersion : null,
    coreVersion: typeof s.coreVersion === "string" ? s.coreVersion : null,
    coreId: typeof s.coreId === "string" ? s.coreId : null,
    /** @type {{ why: string, at: number | null } | null} why native mode is not in use, and since when (§11.2) */
    suspended: susp ? { why: susp.why, at: typeof susp.at === "number" ? susp.at : null } : null,
    lastRead: s.lastRead && typeof s.lastRead === "object" ? s.lastRead : null,
    checked: s.checked && typeof s.checked === "object" ? s.checked : null,
    // The profile hearts and the read are for (§8.4). Hearts themselves are always on with native mode since v1.9.63
    // (the owner, native-remote.md §13): a "hearts" key saved before is no longer read.
    profile: typeof s.profile === "string" && /^[0-9a-f]{2,64}$/.test(s.profile) ? s.profile : null,
  };
}

/**
 * Whether two reads gave the same list: then the screens have nothing new.
 * @param {import("./albums").RoonAlbum[] | null} a @param {import("./albums").RoonAlbum[]} b
 */
function sameList(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.title !== y.title || x.artist !== y.artist || x.contentSource !== y.contentSource || x.imageKey !== y.imageKey) return false;
  }
  return true;
}

/**
 * Why native mode must not start, or null. Read at start only.
 * @param {{ env: Record<string, string | undefined>, settings: any }} o
 */
function emergencyOff(o) {
  if (String(o.env.ROUEN_NATIVE || "").trim().toLowerCase() === "off") return "The container was started with ROUEN_NATIVE=off.";
  if (o.settings && String(o.settings.native || "").trim().toLowerCase() === "off") return "Rouen's settings file says \"native\": \"off\".";
  return null;
}

/**
 * What a failed opening says of the path (§11.2). The messages are connection.js's, session.js's and link.js's own.
 * @param {string} why
 * @returns {"refused" | "failed" | null}
 */
function openingFault(why) {
  const w = String(why || "");
  if (/refused the handshake|refused the connection|refused the service/.test(w)) return "refused";
  // It answered, and what came back could not be used: the session never came up.
  if (/no session came up|other than ROON|closed the connection during the handshake|arrived without its Library|could not be read|was declared with other members|carried no object id/.test(w)) return "failed";
  // Could not be reached at all (refused at TCP, timed out, no route): a drop, retried as the link always has.
  return null;
}

/**
 * What GET /api/roon-direct says of native mode: in use, checking, suspended and why, or off (moved out of stage1.js
 * in 2.0.6-t21, which is its own). @param {any} x  stage1.js's state, as its status() hands it in
 */
function statusOf(x) {
  const on = x.st.on, link = x.link;
  return {
    on, active: x.active, reading: x.reading, offered: x.offered, always: true,
    checking: on ? x.pending : null,
    suspended: on ? x.st.suspended : null, emergency: x.emergency,
    lastRead: x.st.lastRead, checked: x.st.checked,
    fellBack: on ? x.fellBack : null,
    // The connection (link.js), and what the screens were given (index.js's library view).
    link: on && link ? link.status() : null,
    library: on && x.view ? x.view() : null,
    // The first few not matched, for the page; all of them (to 200) from unmatched().
    report: on && !x.pending && x.report ? Object.assign({}, x.report, { unmatched: x.report.unmatched.slice(0, 10) }) : null,
    // The library read whole on this connection (the status board, §13: active stays true across a reconnect).
    readHere: !!link && !!x.albumsOn && x.albumsOn === link.session(),
    // Hearts, and what the read found (the status board's Hearts row, v1.9.63).
    hearts: on ? x.hearts() : null,
  };
}

module.exports = { stored, sameList, emergencyOff, openingFault, statusOf };
