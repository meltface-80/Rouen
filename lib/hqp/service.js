"use strict";
// ---------------------------------------------------------------------------
// HQPlayer control, as Rouen serves it: the settings, the Demo HQPlayer, a
// status poller that runs only while somebody is looking, and the /api/hqp/*
// routes. The HQPlayer-facing parts (client, change engine, rules, presets,
// the fake) are ported from hqpweb by statelycurmudgeon (MIT — see
// ./LICENSE); this file is the glue, written for this app.
//
// UPSTREAM: hqpweb main at 525f8d7 (0.1.0-beta.2 and after, 2026-10-06),
// with its modulator and dither guide, Your setup and Find your DAC. First
// ported in v1.8.74 from 5549518 (2026-10-03); brought up to date in v1.8.78.
// Its list of HQPlayers and its network discovery came across in v1.8.85
// (players.js, discover.js), with DACs behind one HQPlayer added on top.
// Not ported, on purpose: hqpweb's own Roon link (Rouen IS the Roon side),
// its background discovery scan (Rouen looks only when Settings asks),
// seeking and the transport (Roon's), its Advanced panel's
// mode and rate pickers (the guide's pairs and Switch to PCM are the ways in
// here), and the tooling around its own repository (ESLint, Playwright, the
// release check).
//
// WHAT RUNS WHEN. Nothing runs by itself while the feature is off — the
// only exceptions are what Settings does when tapped (Test, Add and Find
// HQPlayers ask the network once and close). Otherwise: no connection, no
// timer, no fake. While it is on, HQPlayer is asked for its status every
// 1.5 s only while the HQPlayer screen is open somewhere — each GET
// /api/hqp/now renews a lease, and the poller stops LEASE_MS after the last
// one. (hqpweb holds a server-sent-event stream open for the same purpose.
// This app polls, like every other live thing in it, which keeps the screen
// testable with a stubbed fetch and survives an iOS app being put away.)
//
// WRITES ARE JSON-ONLY. HQPlayer has no login, and neither has this app, so
// a page on some other site must not be able to change the volume through a
// user's browser. A cross-site page can send a "simple" request with no
// preflight — but only with a form or text content type. Requiring
// application/json on every write means any cross-site attempt needs a CORS
// preflight, which this server never grants. (hqpweb guards the same door
// with an Origin check; that refuses writes through any reverse proxy that
// rewrites Host, and the content-type rule does not.)
// ---------------------------------------------------------------------------

const path = require("node:path");
const dns = require("node:dns").promises;
const { HqpClient, DEFAULT_PORT } = require("./client");
const { Instance, HttpError, parseChange } = require("./instance");
const { LearnedStore, PresetStore } = require("./store");
const { pickerHints, hintsKey, slotInUse, guards, apodization } = require("./hints");
const { isApodizing } = require("./compat");
const { SETUP_QUESTION_LIST, parseSetupPatch, SetupStore } = require("./setup");
const { guideView, restartSteps, recentChange, cited } = require("./guide");
const { dacTable } = require("./dacs");
const PL = require("./players");
const { discover } = require("./discover");
// The table never changes while the extension runs: built once.
let DAC_TABLE = null;
const { FakeHqp, loadProfile } = require("./fake");

const POLL_MS = 1500;
const LEASE_MS = 15000;
const FIRST_EVENT_WAIT_MS = 2500;
const PROBE_TIMEOUT_MS = 3000;
const HOST_RE = /^[A-Za-z0-9.\-:[\]]{1,253}$/;
const DEMO_PROFILE = "desktop5-mac-sdm";
const DEMO_NAME = "Demo HQPlayer";

function bad(message) { return new HttpError(400, message); }

// Where the Demo HQPlayer starts: DSD512 with the ASDM7EC modulator, a setting
// plenty of real systems run at, rather than the captured Mac's DSD1024. At
// DSD512 the AHM modulators cannot play — they need DSD1024, and hqpweb
// measured AHM7EC8B stopping at DSD512 on a real HQPlayer — so the demo has
// something true to show: the picker marks them before they are tapped, and
// picking one anyway shows the stop and the automatic undo. Set directly,
// before anything has connected, so no stall is involved in getting there.
function demoStartingPoint(f) {
  const shaper = f.lists.shapers.find((x) => x.name === "ASDM7EC");
  const rate = f.lists.rates.indexOf(22579200);
  if (shaper) f.rem.shaper = shaper.index;
  if (rate > 0) f.rateIndex = rate;
}

/** Validate a settings patch. Strict: unknown fields and wrong types are refused, nothing is coerced. */
function parseSettingsPatch(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "enabled" || k === "demo") {
      if (typeof v !== "boolean") throw bad(k + " must be true or false");
      out[k] = v;
    } else if (k === "host") {
      if (typeof v !== "string") throw bad("host must be a string");
      const h = v.trim();
      if (h && !HOST_RE.test(h)) throw bad("the address must be a host name or an IP address");
      out.host = h;
    } else if (k === "port") {
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw bad("the port must be a whole number from 1 to 65535");
      out.port = v;
    } else if (k === "active") {
      if (typeof v !== "string") throw bad("active must be a string");
      out.active = v;
    } else {
      throw bad('unknown field "' + k + '"');
    }
  }
  return out;
}

/** An HQPlayer, as added or edited in Settings: { name?, host?, port? }. Strict. */
function parsePlayerBody(body, needHost) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "name" || k === "host") {
      if (typeof v !== "string") throw bad(k + " must be a string");
      out[k] = v.trim();
    } else if (k === "port") {
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw bad("the port must be a whole number from 1 to 65535");
      out.port = v;
    } else {
      throw bad('unknown field "' + k + '"');
    }
  }
  if (needHost && !out.host) throw bad("enter HQPlayer's address");
  return out;
}

/** A DAC: { name, currentName? } to add one, { name } to rename, { dac } to choose one. Strict. */
function parseDacBody(body, keys) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!keys.includes(k)) throw bad('unknown field "' + k + '"');
    if (typeof v !== "string") throw bad(k + " must be a string");
    out[k] = v;
  }
  return out;
}

/** A preset body: { name?, settings? } or { name?, fromCurrent: true, includeVolume? }. */
function parsePresetBody(body, patch) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "name") {
      if (typeof v !== "string") throw bad("name must be a string");
      out.name = v;
    } else if (k === "settings") {
      out.settings = parseChange(v);
    } else if (k === "fromCurrent" || k === "includeVolume" || k === "dacOnly") {
      if (typeof v !== "boolean") throw bad(k + " must be true or false");
      out[k] = v;
    } else {
      throw bad('unknown field "' + k + '"');
    }
  }
  if (!patch && out.name === undefined) throw bad("name is required");
  return out;
}

/** Roon zones that play through HQPlayer: an output carries a source control named for it (measured by hqpweb). */
function hqpZones(zones) {
  const out = [];
  for (const z of Object.values(zones || {})) {
    const feeds = (z.outputs || []).some((o) => (o.source_controls || []).some((s) => /hqplayer/i.test(String(s.display_name || ""))));
    if (!feeds) continue;
    const np = z.now_playing || null;
    const lines = np && np.three_line ? np.three_line : null;
    out.push({
      zone_id: z.zone_id,
      display_name: z.display_name || "",
      state: z.state || "",
      track: lines ? lines.line1 || "" : "",
      artist: lines ? lines.line2 || "" : "",
      album: lines ? lines.line3 || "" : "",
      image_key: np && np.image_key ? np.image_key : null,
    });
  }
  return out;
}

/**
 * @param {{
 *   dataDir: string|null,          where hqp-presets.json and hqp-learned.json live; null = memory only
 *   getSettings: () => object,     the persisted settings object (reads hqp* keys)
 *   saveSettings: (patch) => boolean,
 *   zones?: () => object,          Roon zones by id, for the now-playing line
 *   timing?: object, speedWindowMs?: number, pollMs?: number, leaseMs?: number,
 *   demoTimeScale?: number         tests run the demo instantly
 * }} opts
 */
function createHqpService(opts) {
  const dataDir = opts.dataDir || null;
  const learned = new LearnedStore(dataDir ? path.join(dataDir, "hqp-learned.json") : null);
  const presets = new PresetStore(dataDir ? path.join(dataDir, "hqp-presets.json") : null, parseChange);
  // "Your setup": the answers the modulator and dither guide reads, per HQPlayer
  // (the same key as the learned failures: the Demo HQPlayer's are its own).
  const setups = new SetupStore(dataDir ? path.join(dataDir, "hqp-setup.json") : null);
  let lastProduct = "";       // HQPlayer's product name, kept for the restart steps once it stops answering
  const pollMs = opts.pollMs || POLL_MS;
  const leaseMs = opts.leaseMs || LEASE_MS;

  // The settings: the switch, the demo, and the HQPlayers with their DACs
  // (players.js). `player` is the one in use; null when none is set up.
  const readSettings = () => {
    const p = opts.getSettings() || {};
    const model = PL.readPlayers(p);
    const player = model.players.find((x) => x.id === model.active) || null;
    return {
      enabled: p.hqpEnabled === true,
      demo: p.hqpDemo === true,
      model,
      player,
      host: player ? player.host : "",
      port: player ? player.port : DEFAULT_PORT,
    };
  };
  let settings = readSettings();
  // The HQPlayer (or the Demo HQPlayer) being controlled, with its DACs.
  const target = (s) => (s.demo ? Object.assign({ id: "demo", name: DEMO_NAME }, s.model.demo) : s.player);
  // Learned failures, the guide's answers and a DAC's own presets are kept
  // under this: the HQPlayer, and the DAC in use behind it (players.js). For
  // the one HQPlayer and DAC every earlier version had it is "hqp" — and the
  // Demo HQPlayer's is "demo" — so nothing saved before moves. They can be
  // read and forgotten with control switched off.
  // With no HQPlayer at all there is nothing to keep answers or failures
  // for: null, and the routes that read or write them say so.
  const learnedId = () => {
    const t = target(settings);
    return t ? PL.scopeOf(t.id, t.dac) : null;
  };
  // The scope of ONE HQPlayer — the one an Instance talks to — whichever is in
  // use now: a change still being watched on the HQPlayer just switched away
  // from records its failure against that one, not the new one.
  const scopeFor = (id) => {
    const m = settings.model;
    const p = id === "demo" ? m.demo : m.players.find((x) => x.id === id);
    return PL.scopeOf(id, p ? p.dac : PL.MAIN);
  };

  let inst = null;            // the Instance for the current settings
  let instKey = "";
  let info = null;            // GetInfo for `inst`, read once per instance
  let fake = null;            // the Demo HQPlayer, while the demo is on
  let fakeStarting = null;
  let fakeToken = null;       // which start is still wanted; a stop clears it
  let watch = null;           // { inst, off, latest, waiters, timer }
  let generation = 0;         // bumped by every reconfiguration
  let epoch = 0;              // bumped whenever HQPlayer answers again after going quiet

  function stopWatch() {
    if (!watch) return;
    clearTimeout(watch.timer);
    watch.off();
    for (const w of watch.waiters) w();
    watch = null;
  }

  // Drop the current Instance. `drain`: let a change it is in the middle of
  // finish first — its watch and its rollback — and close after (see
  // Instance.retire()); every route but the extension shutting down drains.
  function closeInstance(drain) {
    stopWatch();
    if (inst) {
      if (drain) inst.retire();
      else inst.close();
    }
    inst = null;
    instKey = "";
    info = null;
  }

  async function stopFake() {
    fakeToken = null;
    fakeStarting = null;
    const f = fake;
    fake = null;
    if (f) await f.close();
  }

  // One fake, however many requests ask for it at once. A start that finishes
  // after the demo was switched off closes what it started rather than leaving
  // a server listening that nothing will ever stop.
  function startFake() {
    if (fake) return Promise.resolve(fake);
    if (!fakeStarting) {
      const token = {};
      fakeToken = token;
      const starting = (async () => {
        const f = new FakeHqp(loadProfile(DEMO_PROFILE), {
          timeScale: opts.demoTimeScale !== undefined ? opts.demoTimeScale : 1,
          record: false,
        });
        demoStartingPoint(f);
        await f.listen(0, "127.0.0.1");
        if (fakeToken !== token) {
          await f.close();
          throw new HttpError(409, "the Demo HQPlayer was switched off");
        }
        fake = f;
        return f;
      })();
      fakeStarting = starting;
      starting.catch(() => { if (fakeStarting === starting) fakeStarting = null; });
    }
    return fakeStarting;
  }

  // Which HQPlayer an Instance talks to. Two settings that name the same one
  // share an Instance, and anything it is in the middle of.
  const demoCfg = (f) => ({ id: "demo", name: DEMO_NAME, host: "127.0.0.1", port: f.port });
  const realCfg = (s) => ({ id: s.player.id, name: s.player.name, host: s.player.host, port: s.player.port });
  const keyOf = (cfg) => cfg.id + "@" + cfg.host + ":" + cfg.port;

  /** The Instance the current settings describe, created on first use; null when off or not set up. */
  async function current() {
    for (;;) {
      const gen = generation;
      const s = settings;
      if (!s.enabled) return null;
      let cfg;
      if (s.demo) {
        let f;
        try {
          f = await startFake();
        } catch (e) {
          if (gen !== generation) continue;   // the settings moved under it: decide again
          throw e;
        }
        if (gen !== generation) continue;
        cfg = demoCfg(f);
      } else {
        if (!s.player) return null;
        cfg = realCfg(s);
      }
      const key = keyOf(cfg);
      if (inst && instKey === key) return inst;
      closeInstance(true);
      inst = new Instance(cfg, Object.assign({ learned, scope: () => scopeFor(cfg.id) },
        opts.timing ? { timing: opts.timing } : {},
        opts.speedWindowMs ? { speedWindowMs: opts.speedWindowMs } : {},
        opts.queueEveryMs ? { queueEveryMs: opts.queueEveryMs } : {}));
      instKey = key;
      return inst;
    }
  }

  async function required() {
    if (!settings.enabled) throw new HttpError(409, "HQPlayer control is switched off");
    const i = await current();
    if (!i) throw new HttpError(409, "No HQPlayer is set up. Add one in Settings → HQPlayer.");
    return i;
  }

  // HQPlayer's name and version (GetInfo), read once per HQPlayer — and again
  // whenever it comes back after going quiet, since it may be another version.
  function readInfo(i) {
    const mine = { inst: i, value: null };
    info = mine;
    i.client.info().then((v) => { mine.value = v; }, () => {
      // Not answering: the poller reports that, and this is asked again as
      // soon as it answers.
      if (info === mine) info = null;
    });
  }

  // The key the page holds HQPlayer's lists under. Besides what hintsKey
  // covers (the mode, the track, the settings in effect), it names WHICH
  // HQPlayer, and how often it has come back after going quiet: switching to
  // another HQPlayer, or one restarting — perhaps a new version, or another
  // output device with other rates — changes the lists without moving
  // anything hintsKey can see. Both routes build it here, so they agree.
  const listsKey = (snap) => instKey + "#" + epoch + "|" + hintsKey(snap);

  // Keep the poller running for another lease; start it if it is not.
  function lease(i) {
    if (!watch || watch.inst !== i) {
      stopWatch();
      // latest: the last event — { snapshot, health } or { error } — stamped
      // with the Instance's writeGen when it was read.
      const w = { inst: i, latest: null, waiters: [], timer: null, off: null };
      w.off = i.subscribe((e) => {
        if (e.snapshot && w.latest && w.latest.error) {
          // Back after going quiet: read its lists and its name afresh.
          epoch++;
          i.forgetCapabilities();
          readInfo(i);
        } else if (e.snapshot && (!info || info.inst !== i)) {
          readInfo(i);
        }
        w.latest = e;
        const ws = w.waiters;
        w.waiters = [];
        for (const f of ws) f();
      }, pollMs);
      watch = w;
      if (!info || info.inst !== i) readInfo(i);
    }
    clearTimeout(watch.timer);
    watch.timer = setTimeout(stopWatch, leaseMs);
    if (watch.timer.unref) watch.timer.unref();
    return watch;
  }

  // The next event, or ms, whichever comes first. `any`: one already held
  // will do.
  function nextEvent(w, ms, any) {
    if (any && w.latest) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      w.waiters.push(() => { clearTimeout(t); resolve(); });
    });
  }

  // The switch and the demo, and — from a page built before v1.8.85 — the one
  // address: it edits the HQPlayer in use (or adds one, or clears it).
  async function reconfigure(patch) {
    let model = settings.model;
    if (patch.host !== undefined || patch.port !== undefined) {
      const host = patch.host !== undefined ? patch.host : settings.host;
      const port = patch.port !== undefined ? patch.port : settings.port;
      const a = settings.player;
      if (!host) model = a ? PL.removePlayer(model, a.id) : model;
      else if (a) model = PL.updatePlayer(model, a.id, { host, port });
      else model = PL.addPlayer(model, { host, port }).model;
    }
    if (patch.active !== undefined) model = PL.selectPlayer(model, patch.active);
    await commit(Object.assign({
      hqpEnabled: patch.enabled !== undefined ? patch.enabled : settings.enabled,
      hqpDemo: patch.demo !== undefined ? patch.demo : settings.demo,
    }, PL.toSettings(model)));
  }

  // Save, then catch everything up with what was saved.
  async function commit(save) {
    const scopeBefore = learnedId();
    if (!opts.saveSettings(save)) throw new HttpError(500, "Couldn't save the HQPlayer settings");
    generation++;
    settings = readSettings();
    // Another DAC behind the same HQPlayer: same connection, but the lists
    // carry the failures learned on THIS DAC, so they are read afresh, and
    // the page's lists key moves so it reads them again too.
    if (learnedId() !== scopeBefore) {
      epoch++;
      if (inst) inst.forgetCapabilities();
    }
    // Still the same HQPlayer: keep its Instance, and whatever it is in the
    // middle of. Closing it on every save cut off a change being watched —
    // Save pressed with nothing altered, or on another device — so a setting
    // that had stopped playback was never rolled back. Anything else drains
    // and goes; current() makes the next one on first use.
    const s = settings;
    const wanted = !s.enabled ? null
      : s.demo ? (fake ? keyOf(demoCfg(fake)) : null)
      : s.player ? keyOf(realCfg(s)) : null;
    if (inst && instKey !== wanted) closeInstance(true);
    if (!s.enabled || !s.demo) await stopFake();
  }

  const dacsView = (t) => (t ? { dacs: t.dacs.map((d) => ({ id: d.id, name: d.name })), dac: t.dac } : { dacs: [], dac: PL.MAIN });

  function settingsView() {
    const s = settings;
    const t = target(s);
    return Object.assign({
      enabled: s.enabled,
      // The HQPlayer in use, for a page that knows only one.
      host: s.host,
      port: s.port,
      demo: s.demo,
      players: s.model.players.map((x) => ({ id: x.id, name: x.name, host: x.host, port: x.port,
                                             dacs: x.dacs.map((d) => ({ id: d.id, name: d.name })), dac: x.dac })),
      active: s.model.active,
      // The one being controlled (the Demo HQPlayer while that is on), and its DACs.
      current: t ? t.id : "",
      learned_count: learnedId() ? learned.all(learnedId()).length : 0,
    }, dacsView(t));
  }

  async function nowView() {
    const s = settings;
    const t = target(s);
    const base = Object.assign({
      enabled: s.enabled, demo: s.demo, configured: s.demo || !!s.player,
      // For the pickers at the top of the screen: which HQPlayer, which DAC.
      players: s.model.players.map((x) => ({ id: x.id, name: x.name })),
      active: s.model.active,
    }, dacsView(t));
    if (!s.enabled) return base;
    const i = await current();
    if (!i) return base;
    const w = lease(i);
    await nextEvent(w, FIRST_EVENT_WAIT_MS, true);
    // A change, an undo or a preset has finished since that status was read,
    // so it describes HQPlayer BEFORE it: the screen, which has just shown
    // what the change did, would flip back to the old settings for a poll.
    // The Instance reads again the moment a write finishes; wait for that.
    if (watch === w && w.latest && w.latest.writeGen !== i.writeGen) await nextEvent(w, FIRST_EVENT_WAIT_MS, false);
    if (watch !== w) return Object.assign(base, { reachable: null, error: null, snapshot: null });
    const e = w.latest;
    const snap = e && e.snapshot ? e.snapshot : null;
    const inf = info && info.inst === i ? info.value : null;
    return Object.assign(base, {
      // The name given in Settings; one never given (the address it was
      // added under) gives way to the name HQPlayer reports for itself.
      name: s.demo ? DEMO_NAME
        : s.player.name !== s.player.host ? s.player.name : (inf && inf.name) || s.host,
      product: inf ? inf.product : "",
      // How to restart it, for when it stops answering (by the product last seen).
      restart: restartSteps(inf && inf.product ? (lastProduct = inf.product) : lastProduct),
      engine: inf ? inf.engine : "",
      address: s.demo ? "" : s.host + (s.port !== DEFAULT_PORT ? ":" + s.port : ""),
      reachable: e ? !!snap : null,
      error: e && e.error ? e.error : null,
      snapshot: snap,
      health: e && e.health ? e.health : null,
      inUse: slotInUse(snap),
      // HQPlayer's apodization counter against the filter running now:
      // "suggest" an apodizing filter, or say the one in use "handled" it.
      apodization: snap ? apodization(snap.status.apod, isApodizing(snap.status.activeFilter || "")) : null,
      hintsKey: listsKey(snap),
      undoAvailable: i.undoChange !== null,
      // The last change that could overload HQPlayer, while recent enough to
      // be the likely cause of one (ISO time; the page shows it locally).
      recentChangeAt: recentChange(i.lastRiskyAt, Date.now()) ? new Date(i.lastRiskyAt).toISOString() : null,
      // A Roon zone playing through HQPlayer, for the line saying what is on.
      // Not in the demo: the fake is fed by nothing, and naming a real zone's
      // track over it would claim a connection that is not there.
      roon: s.demo || !opts.zones ? [] : hqpZones(opts.zones()),
    });
  }

  async function captureFrom(i, includeVolume) {
    const cur = Object.assign({}, await i.currentSettings());
    if (!includeVolume) delete cur.volume;
    // "" means no matrix profile is active: nothing to restore, so it is left out.
    if (!cur.matrixProfile) delete cur.matrixProfile;
    return cur;
  }

  // Routes ----------------------------------------------------------------------
  // A plain table, matched by dispatch(), with Express only as the adapter in
  // mount(). The test suite runs with no dependencies installed, so it calls
  // dispatch() itself — the same handlers the server runs, not a copy.
  const ROUTES = [];
  const on = (method, pattern, fn) => ROUTES.push({ method, pattern, fn });

  on("GET", /^\/settings$/, () => settingsView());
  on("POST", /^\/settings$/, async (req) => {
    await reconfigure(parseSettingsPatch(req.body));
    return settingsView();
  });

  // Does anything answer as HQPlayer at this address? For the Settings page,
  // before (or after) it is saved. A fresh connection, closed straight after.
  on("POST", /^\/test$/, async (req) => {
    const p = parseSettingsPatch(req.body);
    const host = p.host !== undefined ? p.host : settings.host;
    const port = p.port !== undefined ? p.port : settings.port;
    if (!host) throw bad("enter HQPlayer's address first");
    const probe = new HqpClient(host, { port, timeoutMs: PROBE_TIMEOUT_MS });
    try {
      const v = await probe.info();
      return { ok: true, name: v.name, product: v.product, engine: v.engine, version: v.version };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      probe.close();
    }
  });

  // ---- the HQPlayers (v1.8.85, after hqpweb's Instances) -----------------

  // Who answers on the network? Only when Settings asks; nothing is kept.
  on("POST", /^\/discover$/, async () => {
    const found = await (opts.discover || discover)({ timeoutMs: opts.discoverMs || 2000 });
    const list = settings.model.players;
    // An HQPlayer added by its host name answers from its IP address, so a
    // name is looked up before saying it is not in the list (as hqpweb does).
    const ips = new Map();
    await Promise.all(list.map(async (x) => {
      try { ips.set(x.id, (await (opts.lookup || dns.lookup)(x.host, { family: 4 })).address); }
      catch (e) { /* a name that doesn't resolve now: compared as written */ }
    }));
    return {
      found: found.map((d) => {
        const have = list.find((x) => x.host === d.address || ips.get(x.id) === d.address);
        return { address: d.address, name: d.name, version: d.version, added: have ? have.id : null };
      }),
    };
  });

  // Add one. A blank name is the name HQPlayer reports for itself (GetInfo,
  // as hqpweb does), or its address if it doesn't answer within 3 s.
  on("POST", /^\/players$/, async (req) => {
    const b = parsePlayerBody(req.body, true);
    let name = b.name || "";
    if (!name && PL.HOST_RE.test(b.host)) {
      const probe = new HqpClient(b.host, { port: b.port || DEFAULT_PORT, timeoutMs: PROBE_TIMEOUT_MS });
      try { name = String((await probe.info()).name || "").trim().slice(0, 64); }
      catch (e) { /* not answering yet: it is added under its address, and can be renamed */ }
      finally { probe.close(); }
    }
    const r = PL.addPlayer(settings.model, { name: name || b.host, host: b.host, port: b.port });
    await commit(PL.toSettings(r.model));
    return Object.assign(settingsView(), { added: r.player.id });
  });
  on("PATCH", /^\/players\/([^/]+)$/, async (req, id) => {
    await commit(PL.toSettings(PL.updatePlayer(settings.model, id, parsePlayerBody(req.body, false))));
    return settingsView();
  });
  // Its answers and learned failures stay on file under its id: added again
  // under the same name, it finds them again (as hqpweb keeps them).
  on("DELETE", /^\/players\/([^/]+)$/, async (req, id) => {
    await commit(PL.toSettings(PL.removePlayer(settings.model, id)));
    return settingsView();
  });
  on("POST", /^\/players\/([^/]+)\/select$/, async (req, id) => {
    await commit(PL.toSettings(PL.selectPlayer(settings.model, id)));
    return settingsView();
  });

  // ---- DACs behind one HQPlayer (v1.8.85) ---------------------------------
  // The id "demo" names the Demo HQPlayer, so the picker can be tried there.
  on("POST", /^\/players\/([^/]+)\/dacs$/, async (req, id) => {
    const b = parseDacBody(req.body, ["name", "currentName"]);
    const r = PL.addDac(settings.model, id, b);
    await commit(PL.toSettings(r.model));
    return Object.assign(settingsView(), { added: r.dac.id });
  });
  on("PATCH", /^\/players\/([^/]+)\/dacs\/([^/]+)$/, async (req, id, dac) => {
    const b = parseDacBody(req.body, ["name"]);
    await commit(PL.toSettings(PL.renameDac(settings.model, id, dac, b.name)));
    return settingsView();
  });
  // A DAC removed takes its answers and learned failures with it; presets
  // kept for it alone become shared, so nobody loses one they made.
  on("DELETE", /^\/players\/([^/]+)\/dacs\/([^/]+)$/, async (req, id, dac) => {
    const scope = PL.scopeOf(id, dac);
    await commit(PL.toSettings(PL.removeDac(settings.model, id, dac)));
    learned.forget(scope);
    setups.forget(scope);
    presets.unscope(scope);
    return settingsView();
  });
  on("POST", /^\/players\/([^/]+)\/dac$/, async (req, id) => {
    const b = parseDacBody(req.body, ["dac"]);
    await commit(PL.toSettings(PL.selectDac(settings.model, id, b.dac || "")));
    return settingsView();
  });

  on("GET", /^\/now$/, () => nowView());

  on("GET", /^\/capabilities$/, async () => {
    const i = await required();
    const caps = await i.capabilities(false);
    // The same queued-track read the poller makes, so the hints and the key
    // agree with what /now reports.
    const snap = await snapFor(i);
    return Object.assign({}, caps,
      { hints: pickerHints(caps, snap), guards: guards(caps, snap), hintsKey: listsKey(snap) });
  });

  // The snapshot hints are worked out against: a fresh status and state, and
  // the queued-track rate the poller holds (see /capabilities).
  async function snapFor(i) {
    const [status, state] = await Promise.all([i.client.status(), i.client.state()]);
    const snap = { status, state };
    const held = watch && watch.inst === i && watch.latest && watch.latest.snapshot;
    if (held && held.queuedRate !== undefined && !status.source) snap.queuedRate = held.queuedRate;
    return snap;
  }

  const scopeOrRefuse = () => {
    const id = learnedId();
    if (!id) throw new HttpError(409, "Add an HQPlayer first: the answers are kept for each one.");
    return id;
  };
  on("GET", /^\/setup$/, () => ({ setup: learnedId() ? setups.get(learnedId()) : {}, questions: cited(SETUP_QUESTION_LIST) }));
  on("POST", /^\/setup$/, (req) => {
    const patch = parseSetupPatch(req.body);
    return { setup: setups.update(scopeOrRefuse(), patch) };
  });
  on("GET", /^\/dacs$/, () => DAC_TABLE || (DAC_TABLE = dacTable()));
  // The modulator / dither sheet: its List and its Guide, for this HQPlayer now.
  on("GET", /^\/guide$/, async () => {
    const i = await required();
    const caps = await i.capabilities(false);
    const snap = await snapFor(i);
    const hints = pickerHints(caps, snap).shaper;
    const e = watch && watch.inst === i ? watch.latest : null;
    const processSpeed = e && e.health ? e.health.processSpeed : null;
    return Object.assign(guideView(caps, snap, learnedId() ? setups.get(learnedId()) : {}, hints, processSpeed), { hintsKey: listsKey(snap) });
  });

  on("POST", /^\/change$/, async (req) => (await required()).applyChange(parseChange(req.body)));
  on("POST", /^\/undo$/, async () => (await required()).undo());
  // After a rollback leaves HQPlayer's own playlist stopped: Stop, then Play.
  on("POST", /^\/restart$/, async () => (await required()).restartPlayback());
  on("POST", /^\/volume-jump\/dismiss$/, async () => (await required()).dismissVolumeJump());

  // Presets: the shared ones, and the ones kept for the DAC in use.
  const presetsHere = () => presets.list().filter((p) => !p.scope || p.scope === learnedId());
  // One preset, if it is one shown here: one kept for another DAC is not
  // there to change or apply (a sheet left open across a DAC switch).
  const presetHere = (id) => {
    const p = presets.get(id);
    if (p.scope && p.scope !== learnedId()) throw new HttpError(404, "that preset is kept for another DAC");
    return p;
  };
  const multiDac = () => { const t = target(settings); return !!t && t.dacs.length > 1; };
  on("GET", /^\/presets$/, async () => {
    const i = await required();
    const list = presetsHere();
    const previews = await i.previewPresets(list.map((p) => p.settings));
    return list.map((p, n) => Object.assign({}, p, { preview: previews[n] }));
  });
  on("POST", /^\/presets$/, async (req) => {
    const body = parsePresetBody(req.body, false);
    let s = body.settings;
    if (body.fromCurrent) s = await captureFrom(await required(), body.includeVolume === true);
    if (!s || Object.keys(s).length === 0) throw bad("a preset needs settings, or fromCurrent");
    // With more than one DAC, a new preset is for the DAC in use unless the
    // request says it is for all of them: a DSD512 preset made for a DSD DAC
    // means nothing to a PCM-only one.
    const only = body.dacOnly !== undefined ? body.dacOnly : multiDac();
    return presets.create(body.name, s, only ? learnedId() : null);
  });
  on("PATCH", /^\/presets\/([^/]+)$/, async (req, id) => {
    const body = parsePresetBody(req.body, true);
    let s = body.settings;
    if (body.fromCurrent) {
      // "Update from current" keeps the preset's own choice about volume
      // unless the request says otherwise.
      const had = presetHere(id).settings.volume !== undefined;
      s = await captureFrom(await required(), body.includeVolume !== undefined ? body.includeVolume : had);
    }
    presetHere(id);
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (s) patch.settings = s;
    if (body.dacOnly !== undefined) patch.scope = body.dacOnly ? learnedId() : null;
    return presets.update(id, patch);
  });
  on("DELETE", /^\/presets\/([^/]+)$/, (req, id) => {
    presetHere(id);
    presets.remove(id);
    return { ok: true };
  });
  on("POST", /^\/presets\/([^/]+)\/apply$/, async (req, id) => {
    const p = presetHere(id);
    return (await required()).applyPreset(p.settings);
  });

  on("GET", /^\/learned$/, () => (learnedId() ? learned.all(learnedId()) : []));
  on("DELETE", /^\/learned$/, () => {
    const id = learnedId();
    if (!id) return { forgotten: 0 };
    const n = learned.all(id).length;
    learned.forget(id);
    return { forgotten: n };
  });

  /**
   * One request, by path below /api/hqp: { method, path, headers, body } →
   * { status, body }. Never rejects.
   */
  async function dispatch(req) {
    const method = String(req.method || "GET").toUpperCase();
    const headers = req.headers || {};
    // Writes must be JSON (see the header): this is what keeps other sites out.
    if (method !== "GET" && method !== "HEAD" &&
        !/^application\/json\b/i.test(String(headers["content-type"] || ""))) {
      return { status: 415, body: { error: "expected application/json" } };
    }
    const p = String(req.path || "/");
    let found = null;
    let pathMatched = false;
    for (const r of ROUTES) {
      const m = r.pattern.exec(p);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method) { found = { r, m }; break; }
    }
    if (!found) return pathMatched ? { status: 405, body: { error: "method not allowed" } } : { status: 404, body: { error: "not found" } };
    const ids = [];
    for (const part of found.m.slice(1)) {
      if (part === undefined) continue;
      try { ids.push(decodeURIComponent(part)); }
      catch (e) { return { status: 400, body: { error: "bad id" } }; }
    }
    try {
      const out = await found.r.fn({ body: req.body === undefined ? {} : req.body }, ...ids);
      return { status: 200, body: out === undefined ? { ok: true } : out };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      // Anything else is a failure talking to HQPlayer.
      return { status: 502, body: { error: "HQPlayer didn't answer: " + (err && err.message ? err.message : String(err)) } };
    }
  }

  // Express: everything under /api/hqp goes through dispatch(). express.json()
  // (mounted for the whole app) has already parsed the body.
  function mount(app) {
    app.use("/api/hqp", (req, res) => {
      dispatch({ method: req.method, path: req.path, headers: req.headers, body: req.body })
        .then((r) => { if (!res.headersSent) res.status(r.status).json(r.body); });
    });
  }

  async function close() {
    generation++;
    closeInstance(false);
    await stopFake();
  }

  return {
    mount,
    dispatch,
    close,
    // For tests and diagnostics.
    get polling() { return !!watch; },
    get demoPort() { return fake ? fake.port : null; },
    get demoFake() { return fake; },
  };
}

module.exports = { createHqpService, parseSettingsPatch, hqpZones };
