// @ts-check
"use strict";
/*
 * lib/wave — the waveforms, moved out of index.js unchanged in v1.9.72-t61 (dev/quality.md, step 4):
 *
 *   store.js         the stored peaks (the history database's `waveforms` table), the analysis stamp that wipes
 *                    them, and the decodes in flight that every path shares
 *   local.js         a local file's decode, one at a time, and the next track warmed while this one plays
 *   qobuz.js         a Qobuz track: its album and track, the signed url of its audio, the decode of the download
 *   tidal.js         a TIDAL track, the same way
 *   routes.js        GET /api/waveform, and GET and POST /api/settings/waveform
 *   debug-routes.js  GET /api/debug/waveform, and GET and POST /api/debug/qobuz-probe
 *
 * index.js keeps every setting and store these read (the switch, the Qobuz credentials and sign-ins, the album
 * indexes, the history database), which /music file a track is (wfAlbumKey, wfAlbumFiles, wfResolveFile: the
 * tests extract them from index.js by name, and wfAlbumKey finds the credits' and the phone's downloads' folder
 * too), the queue peek and identityReport (the zone dump's too), and wires them here with what they use
 * (createWaveforms). A value index.js may
 * replace is handed in as a getter and read where the code read the variable; one these routes set (the switch,
 * the pasted Qobuz pair, the minted signing token) also comes with a setter. The minted signing token itself is
 * the Qobuz session's (lib/services/qobuz-session.js, since v1.9.72-t63), with its own getter and setters.
 *
 * Roon's extension API exposes no audio at all — the Core decodes and streams to
 * the endpoint, never to an extension — so nothing here can read what you are
 * listening to. There are two ways round that and the whole section is built on
 * the difference between them:
 *
 *   LOCAL FILES are on disk, so the file is opened directly. The resolution is
 *     LAZY on purpose: the /music walk records one directory per album
 *     (localAlbumDirs), and when a track starts the tags of the files in just
 *     that folder are read and the title matched. A dozen reads for the album
 *     you are listening to, against ~70,000 for a track-level index of the
 *     whole library, most of which would never be asked about.
 *
 *   QOBUZ AND TIDAL have no file, so a copy of the audio is fetched from the
 *     service with the user's own account, independently of Roon, purely to
 *     measure it — see wfQobuzTrack and wfTidalTrack. The album is identified
 *     by identity key against the favourites (or, for Qobuz, the catalogue),
 *     the track by title AND duration, and the bytes are piped through ffmpeg
 *     and discarded. Nothing is written to disk and Roon still does all the
 *     playback.
 *
 * Anything that cannot be identified confidently, or that a service delivers in
 * a protected container, falls back to the plain progress bar. That is always an
 * acceptable answer here; a waveform of the wrong recording never is.
 */
const { createWaveformStore } = require("./store");
const { createLocalWaveforms } = require("./local");
const { createQobuzWaveforms } = require("./qobuz");
const { createTidalWaveforms } = require("./tidal");
const { mountWaveform, mountWaveformSettings } = require("./routes");
const { mountWaveformDebug } = require("./debug-routes");

/**
 * What the waveforms use: index.js's own, by the same names (a getter for each value index.js may replace).
 * @typedef {object} WaveDeps
 * @property {boolean} DEBUG
 * @property {string} MUSIC_DIR
 * @property {Record<string, any>} persisted  index.js's _persisted: settings.json as read at startup
 * @property {any} WFD  lib/waveform-decode.js: the ffmpeg decode, its probe and its last error
 * @property {any} qobuz  lib/qobuz.js, the Qobuz client
 * @property {any} tidal  lib/tidal.js, the TIDAL client
 * @property {{ APP_ID: string, APP_SECRET: string }} QOA  lib/qobuz-oauth.js: the built-in sign-in's app
 * @property {() => any} labelsDb  the history database, null when it could not be opened
 * @property {() => boolean} waveformEnabled
 * @property {(on: boolean) => void} setWaveformEnabled
 * @property {() => Record<string, any>} zones  the official zones by id
 * @property {() => Set<string>} localAlbumKeys
 * @property {() => Map<string, string>} localAlbumDirs  album key -> its folder under /music
 * @property {() => Set<string>} qobuzAlbumKeys
 * @property {() => Set<string>} tidalAlbumKeys
 * @property {() => Map<string, any>} qobuzAlbumIds  album key -> the Qobuz favourite's album id
 * @property {() => Map<string, any>} tidalAlbumIds  album key -> the TIDAL favourite's album id
 * @property {() => number} qobuzFavouritesRead
 * @property {() => number} qobuzFavouritesTotal
 * @property {() => number} tidalFavouritesRead
 * @property {() => number} tidalFavouritesTotal
 * @property {() => string} qobuzAppSecret  the pasted secret (the older route)
 * @property {(secret: string) => void} setQobuzAppSecret
 * @property {() => string} qobuzSignAppId  the app_id that secret belongs to
 * @property {(appId: string) => void} setQobuzSignAppId
 * @property {() => string} qobuzSignToken  the token pasted with that pair
 * @property {(token: string) => void} setQobuzSignToken
 * @property {() => string} qobuzWaveToken  the Qobuz sign-in's token
 * @property {() => string} qobuzWaveUser
 * @property {() => string} qobuzWaveName
 * @property {() => string} qobuzToken  this app's own (legacy) login token
 * @property {() => string} qobuzUsername
 * @property {() => string} qobuzPasswordMd5
 * @property {() => { appId: string, token: string } | null} qobuzSignTok  the token minted under the signing app_id
 *   (the Qobuz session's, lib/services/qobuz-session.js)
 * @property {(tok: { appId: string, token: string } | null) => void} setQobuzSignTok
 * @property {(at: number) => void} setQobuzSignTokAt  when the last mint failed, for its backoff
 * @property {(title: string, artist: string) => string[]} albumKeys
 * @property {(title: string, artist: string) => string | null} albumKey
 * @property {(s: string) => string} canonArtist
 * @property {(title: string, version?: string) => string[]} favouriteTitleForms
 * @property {() => boolean} qobuzReady
 * @property {() => boolean} tidalReady
 * @property {(fn: (token: string) => Promise<any>) => Promise<any>} qobuzWithToken
 * @property {(fn: (token: string, countryCode: string) => Promise<any>) => Promise<any>} tidalWithToken
 * @property {() => Promise<string | null | undefined>} qobuzSigningToken
 * @property {(key: string, msg: string) => void} wfQobuzSayOnce  the streaming waveform's said-once log
 * @property {Set<string>} wfQobuzSaid  what wfQobuzSayOnce has said, forgotten when the credentials change
 * @property {(patch: Record<string, any>) => any} savePersistedSettings
 * @property {() => boolean} musicDirMounted
 * @property {(album: string, artist: string) => string | null} wfAlbumKey  the /music album key, if any
 * @property {(albumKey: string) => Promise<{ file: string, title: string }[]>} wfAlbumFiles
 * @property {(albumKey: string, trackTitle: string) => Promise<string | null>} wfResolveFile
 * @property {(zoneId: string, count: number) => Promise<any[]>} peekQueueRaw
 */

/** @typedef {ReturnType<typeof createWaveformStore>} WaveStore */
/** @typedef {(album: string, artist: string, track: string, seconds: number) => Promise<any>} ServiceTrack */
/**
 * What the routes use: the deps, the store, and the three paths.
 * @typedef {WaveDeps & { store: WaveStore } & ReturnType<typeof createQobuzWaveforms>
 *   & ReturnType<typeof createTidalWaveforms> & ReturnType<typeof createLocalWaveforms>} RouteDeps
 */

/**
 * The waveforms, wired once by index.js.
 * @param {WaveDeps} d
 */
function createWaveforms(d) {
  const store = createWaveformStore(d);
  const qobuzWf = createQobuzWaveforms({ ...d, store });
  const tidalWf = createTidalWaveforms({ ...d, store });
  const local = createLocalWaveforms({ ...d, store, wfQobuzTrack: qobuzWf.wfQobuzTrack,
    wfTidalTrack: tidalWf.wfTidalTrack });
  /** @type {RouteDeps} */
  const r = { ...d, store, ...qobuzWf, ...tidalWf, ...local };
  return {
    /** Wipe the stored waveforms if the analysis changed; index.js runs it once at startup. */
    wfCheckAnalysis: store.wfCheckAnalysis,
    /** Say in the log whether ffmpeg runs; index.js runs it once at startup. */
    announceFfmpeg: local.announceFfmpeg,
    /** Warm the next track's waveform; the zone push calls it. */
    wfPrefetchNext: local.wfPrefetchNext,
    /**
     * GET /api/waveform, GET /api/debug/waveform and GET and POST /api/debug/qobuz-probe, in that order.
     * @param {{ get: Function, post: Function }} app
     */
    mountRoutes(app) { mountWaveform(app, r); mountWaveformDebug(app, r); },
    /**
     * GET and POST /api/settings/waveform.
     * @param {{ get: Function, post: Function }} app
     */
    mountSettings(app) { mountWaveformSettings(app, r); },
  };
}

module.exports = { createWaveforms };
