// @ts-check
"use strict";
/*
 * drive.js — the iBroadcast drive, the probe of 2.0.6-t2 (dev/design/ibroadcast.md §4): the albums chosen on the
 * plugin's page (up to 20, kept in the setting ibroadcastDrive), their folders (drive-tree.js), their reads under the
 * rule (drive-reads.js) fetched from iBroadcast's original files, served to rclone (drive-http.js) and mounted
 * (drive-mount.js) for the Core on the same machine to import. The drive is up while the account is signed in and albums
 * are chosen, and goes when the plugin is removed or the albums cleared.
 */
const { buildTree } = require("./drive-tree");
const { createDriveReads } = require("./drive-reads");
const { createDriveHttp } = require("./drive-http");
const { createDriveMount } = require("./drive-mount");
const { canon } = require("./playing");
const { IBroadcastError } = require("./api");

const KEY = "ibroadcastDrive";
const MAX_ALBUMS = 20;

/**
 * The address of a track's original file at iBroadcast, as Mandarin's IBroadcastStreams.cs builds it.
 * @param {{ server: string | null, file: string, trackId: string, access: string, userId: string | null, version: string, now: number }} a
 */
function originalUrl(a) {
  const server = (a.server || "https://streaming.ibroadcast.com").replace(/\/+$/, "");
  const slash = a.file.indexOf("/", 1);
  const path = "/orig" + (slash > 0 ? a.file.slice(slash) : a.file);
  return `${server}${path}?Expires=${Math.floor(a.now)}&Signature=${encodeURIComponent(a.access)}&file_id=${encodeURIComponent(a.trackId)}`
    + `&user_id=${encodeURIComponent(a.userId || "")}&platform=rouen&version=${encodeURIComponent(a.version)}`;
}

/**
 * @param {{ account: ReturnType<typeof import("./account").createIBroadcastAccount>,
 *           library: ReturnType<typeof import("./library").createIBroadcastLibrary>,
 *           load: () => Record<string, any>, save: (patch: Record<string, any>) => boolean, version: string,
 *           wants: (track: { title: string, artist: string }, album: { title: string, artist: string }) => Promise<boolean>,
 *           log?: (line: string) => void, now?: () => number, fetch?: typeof fetch,
 *           mount?: ReturnType<typeof createDriveMount>, holdMs?: number }} o
 */
function createIBroadcastDrive(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const doFetch = o.fetch || fetch;
  const mount = o.mount || createDriveMount({ log });

  /** @returns {string[]} */
  const chosen = () => { const d = (o.load() || {})[KEY]; return d && Array.isArray(d.albums) ? d.albums.map(String) : []; };
  const albums = () => {
    const k = o.library.kept();
    const byId = new Map((k ? k.albums : []).map((a) => [a.id, a]));
    return chosen().map((id) => byId.get(id)).filter((a) => !!a);
  };
  /** @type {{ ids: string, at: any, tree: import("./drive-tree").Tree } | null} */
  let made = null;
  const tree = () => {
    const ids = chosen().join(","), k = o.library.kept(), at = k ? k.at : null;
    if (!made || made.ids !== ids || made.at !== at) made = { ids, at, tree: buildTree(/** @type {any[]} */ (albums())) };
    return made.tree;
  };

  /** Bytes start..end of a file's original, from iBroadcast; a refused sign-in renewed once. @param {any} f @param {number} start @param {number} end */
  async function fetchRange(f, start, end) {
    const k = o.library.kept();
    for (let again = false; ; again = true) {
      const access = await o.account.api.access();
      const url = originalUrl({ server: k && k.streaming_server, file: f.track.file, trackId: f.track.id, access, userId: o.account.userId(),
        version: o.version, now: now() });
      const res = await doFetch(url, { headers: { Range: `bytes=${start}-${end}`, "User-Agent": "rouen/" + o.version }, signal: AbortSignal.timeout(30000) });
      if ((res.status === 401 || res.status === 403) && !again) { await o.account.api.refresh(access); continue; }
      if (res.status !== 206 && res.status !== 200) throw new IBroadcastError("iBroadcast answered " + res.status + " for " + f.path, 502);
      const body = Buffer.from(await res.arrayBuffer());
      // A server that ignored the range sent the whole file: the part asked for.
      return res.status === 200 ? body.subarray(start, end + 1) : body;
    }
  }

  const reads = createDriveReads({ fetchRange, wanted: (f) => o.wants(f.track, f.album), log, now: o.now, holdMs: o.holdMs });
  const server = createDriveHttp({ tree, reads, mtime: () => { const k = o.library.kept(); return k ? k.at : 0; }, log });
  /** The drive brought into line with the choice, one change at a time. @type {Promise<void>} */
  let syncing = Promise.resolve();

  /** Up when signed in with albums chosen; down otherwise. */
  function sync() {
    syncing = syncing.then(async () => {
      if (o.account.connected() && albums().length) await mount.start(await server.start());
      else { await mount.stop(); await server.stop(); }
    }).catch((e) => { log("drive: " + String(e && e.message)); });
    return syncing;
  }

  return {
    sync,
    reads,
    tree,
    /** The page's state: whether the drive can be made, why not, whether it is mounted, its albums, the totals. */
    state() {
      const why = mount.missing();
      return { available: !why, why, max: MAX_ALBUMS, mount: mount.state(),
        albums: albums().map((a) => ({ id: a.id, title: a.title, artist: a.artist, year: a.year, tracks: a.tracks.length })),
        totals: reads.report().totals };
    },
    /** The library's albums matching `q` (title or artist), up to 30. @param {string} q */
    search(q) {
      const want = canon(q);
      const k = o.library.kept();
      if (!want || !k) return [];
      return k.albums.filter((a) => canon(a.title).includes(want) || canon(a.artist).includes(want)).slice(0, 30)
        .map((a) => ({ id: a.id, title: a.title, artist: a.artist, year: a.year, tracks: a.tracks.length }));
    },
    /** The probe's albums, chosen; the drive made again. @param {any} ids */
    async choose(ids) {
      if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" && typeof x !== "number")) throw new IBroadcastError("ids: a list of album ids, please", 400);
      const list = [...new Set(ids.map(String))];
      if (list.length > MAX_ALBUMS) throw new IBroadcastError(`Up to ${MAX_ALBUMS} albums on the drive while it is a probe`, 400);
      if (!o.save({ [KEY]: { albums: list } })) throw new IBroadcastError("Rouen couldn't save the drive's albums", 500);
      log(`drive: ${list.length} album(s) chosen`);
      await sync();
    },
    report: () => reads.report(),
    /** The plugin removed, or signed out: unmounted, and the server stopped. */
    async close() { await mount.stop(); await server.stop(); },
  };
}

module.exports = { createIBroadcastDrive, originalUrl, MAX_ALBUMS, KEY };
