// @ts-check
"use strict";
/*
 * services.js — what native mode does over its one connection, each made with what it needs from stage1.js: moved
 * out of stage1.js in v1.9.51 (it sat at its length cap), unchanged but for N2e-1's smart playlists (smart.js).
 *
 *   hearts (marks.js, §8) · Roon's own search (find.js, §9.1) · the Listen Later, smart-playlist and album edit-info
 *   probes, read by hand (listen-later.js §10.1, smart-probe.js §12.1, edit-info.js catalogue.md §4) · Roon's Listen Later in place of Rouen's (later.js, §10.4) ·
 *   Roon's own playlists (playlists.js, §11) · the add to the library (adder.js, §9.2) · Roon's smart playlists in
 *   Rouen (smart.js, §12.3) · the one test of a Dynamic Playlist made as one (smart-make.js, §12.7) · their Edit
 *   (smart-edit.js, §12.18) · the zones probe,
 *   read by hand, no call (zone-probe.js, §14.1) · transport through the server itself (transport.js, §14.3).
 */
const { createMarks } = require("./marks");
const { createFinder } = require("./find");
const { createListenLaterReader } = require("./listen-later");
const { createLater } = require("./later");
const { createSmartProbe } = require("./smart-probe");
const { createEditInfoProbe } = require("./edit-info");
const { createEditFacts } = require("./edit-facts");
const { createRoonCredits } = require("./credits");
const { createAdder } = require("./adder");
const { createPlaylists } = require("./playlists");
const { createSmart } = require("./smart");
const { createSmartMaker } = require("./smart-make");
const { createSmartUpdater } = require("./smart-update");
const { createSmartMove } = require("./smart-move");
const { createSmartEditor } = require("./smart-edit");
const { createZoneProbe } = require("./zone-probe");
const { createZoneSettings } = require("./zone-settings");
const { createZoneControls } = require("./zone-controls");
const { createZoneDsp } = require("./zone-dsp");
const { createDspSettings } = require("./dsp-settings");
const { createPeqTry } = require("./peq-try");
const { createFreshPeq } = require("./peq-fresh");
const { createPeq } = require("./peq");
const { createTransport } = require("./transport");

/**
 * @param {{ link: any, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, log: (line: string) => void, deps: any,
 *           on: () => boolean, profile: () => string | null, heartsOff: () => string | null,
 *           inForce: () => any[] | null, readOn: () => any, known: (s: any) => Map<string, any> | null, off: () => string | null }} c
 *   deps: stage1's own (keyOf, now, inLibrary, onLaterChange, zone, zones); inForce: the library list in force, or null;
 *   readOn: the session it was read on; known: what a session was sent of each library album; off: why no read may run
 */
function createServices(c) {
  const { link, inTurn, log, deps, profile, known, off } = c;
  const marks = createMarks({ link, albums: c.inForce, keyOf: deps.keyOf, log, inTurn, profile, enabled: c.heartsOff, readOn: c.readOn });
  // N2b-1 (§9.1): the server's own search, read only; library albums it names by reference are known from what the
  // session was sent, once its library has been read whole on it.
  const finder = createFinder({ link, inTurn, keyOf: deps.keyOf, log, profile, known, off });
  // Read by hand on the same terms: N2c-0's Listen Later (§10.1), N2e-0's smart playlists (§12.1).
  const later = createListenLaterReader({ link, inTurn, log, profile, known, off });
  const smartProbe = createSmartProbe({ link, inTurn, log, profile, known, off });
  // t3 (catalogue.md §4): what Roon holds of a few albums' catalogue numbers, labels and kinds, read by hand.
  const editInfoProbe = createEditInfoProbe({ link, inTurn, log, known, off, release: deps.release });
  // t4 (catalogue.md §4): every album's catalogue number, kinds and labels as Roon holds them, after each library read.
  const editFacts = createEditFacts({ link, inTurn, log, on: c.on, known, keep: deps.roonRelease || null, now: deps.now });
  // v1.9.70-t1 (album-credits.md §2.1): an album's credits as your server shows them, read when its page asks.
  const credits = createRoonCredits({ link, inTurn, log, known, off, keyOf: deps.keyOf });
  // N2c-2 (§10.4): Roon's Listen Later in place of Rouen's.
  const listenLater = createLater({ reader: later, link, inTurn, on: c.on, profile, albums: c.inForce, finder, keyOf: deps.keyOf, log, now: deps.now,
    onChange: deps.onLaterChange });
  // N2d (§11): Roon's own playlists, made and changed by your server itself.
  const playlists = createPlaylists({ link, inTurn, on: c.on, profile, albums: c.inForce, readOn: c.readOn, keyOf: deps.keyOf, log });
  // N2b-2 (§9.2): a catalogue album added by your server itself, found by the same search.
  const adder = createAdder({ link, inTurn, finder, keyOf: deps.keyOf, log, now: deps.now, on: c.on, profile, inLibrary: deps.inLibrary || (() => null) });
  // N2e-1 (§12.3): Roon's smart playlists in Rouen — listed, read, played on the official API's zone.
  const smart = createSmart({ link, inTurn, on: c.on, profile, known, playlists, log, now: deps.now, zone: deps.zone || (() => null) });
  // N2e-2b (§12.7): the one test, a Dynamic Playlist made by hand as a Roon smart playlist.
  const smartMaker = createSmartMaker({ link, inTurn, on: c.on, profile, log });
  // N2e-3a (§12.9): Roon's update tried once by hand, before Rouen's Edit is built on it.
  const smartUpdater = createSmartUpdater({ link, inTurn, on: c.on, profile, log });
  // N2e-3b-3 (§12.16): Rouen's Dynamic Playlists moved onto Roon's smart playlists by themselves.
  // N2e-3b-4 (§12.18): any of Roon's smart playlists edited from Rouen, through the update; the routes reach it by the move.
  const smartEditor = createSmartEditor({ link, inTurn, on: c.on, profile, log });
  const smartMove = createSmartMove({ maker: () => smartMaker, editor: () => smartEditor, on: c.on, connection: () => (link ? link.session() : null), log });
  // N3-0 (§14.1): the zones, outputs and audio devices the connection holds, beside the official zones; no call.
  // It reads nothing of the library, so it waits for no library read: native mode on is enough (the review).
  const zoneProbe = createZoneProbe({ link, inTurn, log, off: () => (c.on() ? null : "Native mode is off."), zones: deps.zones || (() => []) });
  // N3-2 (§14.3): play, pause, skip, seek, volume, shuffle, repeat and Radio sent to the server itself; believed by the official zone.
  const transport = createTransport({ link, inTurn, log, on: c.on, zone: deps.zone || (() => null), now: deps.now });
  // N3-3b (§15.6): a zone's crossfade, volume levelling and sleep timer, read from the Zone the connection holds.
  const zoneSettings = createZoneSettings({ link, on: c.on });
  // N3-3c (§15.7): those settings changed, each believed only when the server shows it.
  const zoneControls = createZoneControls({ link, inTurn, log, on: c.on, now: deps.now });
  // N3-4 (§15.9): each DSP item of the zone's outputs read, and turned on or off, believed only when the server shows it.
  const zoneDsp = createZoneDsp({ link, inTurn, log, on: c.on, now: deps.now });
  // N3-5a (§15.12): an item's settings, on its part, each believed only when the server shows it.
  const dspSettings = createDspSettings({ zoneDsp, link, inTurn, log, on: c.on, now: deps.now });
  // N3-5b (§15.14): one Parametric EQ band's gain, tried by hand, before anything is built on SetSpec.
  const peqTry = createPeqTry({ zoneDsp, link, inTurn, log, on: c.on, zones: deps.zones || (() => []) });
  // N3-5c (§15.15): a Parametric EQ's bands, read afresh on a short connection of its own, and changed on the link.
  const peq = createPeq({ zoneDsp, fresh: createFreshPeq({ core: deps.core || (() => null), log }), link, inTurn, log, on: c.on });
  return { marks, finder, later, smartProbe, editInfoProbe, editFacts, credits, listenLater, playlists, adder, smart, smartMaker, smartUpdater, smartMove, zoneProbe, transport, zoneSettings, zoneControls,
    zoneDsp, dspSettings, peqTry, peq };
}

module.exports = { createServices };
