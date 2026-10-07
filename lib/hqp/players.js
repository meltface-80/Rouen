"use strict";
// ---------------------------------------------------------------------------
// Several HQPlayers, and several DACs behind one (v1.8.85).
//
// hqpweb by statelycurmudgeon keeps a list of HQPlayer "instances" (its
// apps/server/src/registry.ts, MIT — see ./LICENSE): one per HQPlayer on the
// network, each with its own setup answers and learned failures. Rouen keeps
// the same list, in its own settings, with the same rules for a name and an
// address — and one thing hqpweb leaves for later: an HQPlayer that drives
// MORE THAN ONE DAC, switched in HQPlayer itself (a saved profile per DAC, all
// behind one Roon zone). HQPlayer's control protocol can't say which DAC is
// in use or switch to another, so here the listener names them and picks the
// one in use; the guide's answers, the learned failures and the DAC's own
// presets then follow that choice.
//
// THE SCOPE is the key those three are kept under. The first DAC of every
// HQPlayer ("main") uses the HQPlayer's own id — which is "hqp" for the one
// HQPlayer every earlier version had — so everything a listener answered or
// learned before this version stays exactly where it was, and only a second
// DAC starts empty.
//
// Pure: the settings object in, a new list out. The service saves it.
// ---------------------------------------------------------------------------

const { DEFAULT_PORT } = require("./client");
const { HttpError } = require("./store");

const HOST_RE = /^[A-Za-z0-9.\-:[\]]{1,253}$/;
const MAX_PLAYERS = 16;
const MAX_DACS = 8;
const MAIN = "main";
const RESERVED = ["demo", MAIN];

const bad = (m) => new HttpError(400, m);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "hqplayer";
const portOk = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

function checkName(name, what) {
  const n = String(name === undefined || name === null ? "" : name).trim();
  if (!n || n.length > 64) throw bad((what || "the name") + " must be 1–64 characters");
  return n;
}
function checkHost(host) {
  const h = String(host || "").trim();
  if (!HOST_RE.test(h)) throw bad("the address must be a host name or an IP address");
  return h;
}

// A DAC list as stored, made safe: "main" always first and always there.
function cleanDacs(raw) {
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(raw) ? raw : []) {
    if (!d || typeof d.id !== "string" || seen.has(d.id) || !/^[a-z0-9-]{1,40}$/.test(d.id)) continue;
    seen.add(d.id);
    out.push({ id: d.id, name: typeof d.name === "string" ? d.name.trim().slice(0, 64) : "" });
    if (out.length >= MAX_DACS) break;
  }
  if (!seen.has(MAIN)) out.unshift({ id: MAIN, name: "" });
  else out.sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : 0));
  return out.slice(0, MAX_DACS);
}
function cleanDacChoice(dacs, dac) {
  return dacs.some((d) => d.id === dac) ? dac : MAIN;
}

/**
 * The HQPlayers in a settings object. `hqpPlayers` once this version has
 * saved; before that, the one address every earlier version kept (hqpHost /
 * hqpPort) becomes the first, under the id "hqp" its answers were kept under.
 * @returns {{ players: Array, active: string, demo: { dacs: Array, dac: string } }}
 */
function readPlayers(p) {
  p = p || {};
  let players = [];
  if (Array.isArray(p.hqpPlayers)) {
    const ids = new Set();
    for (const x of p.hqpPlayers) {
      if (!x || typeof x.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(x.id) || RESERVED.includes(x.id) || ids.has(x.id)) continue;
      if (typeof x.host !== "string" || !HOST_RE.test(x.host)) continue;
      ids.add(x.id);
      const dacs = cleanDacs(x.dacs);
      players.push({
        id: x.id,
        name: typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 64) : x.host,
        host: x.host,
        port: portOk(x.port) ? x.port : DEFAULT_PORT,
        dacs,
        dac: cleanDacChoice(dacs, x.dac),
      });
      if (players.length >= MAX_PLAYERS) break;
    }
  } else if (typeof p.hqpHost === "string" && HOST_RE.test(p.hqpHost.trim())) {
    const dacs = cleanDacs([]);
    players = [{ id: "hqp", name: p.hqpHost.trim(), host: p.hqpHost.trim(),
                 port: portOk(p.hqpPort) ? p.hqpPort : DEFAULT_PORT, dacs, dac: MAIN }];
  }
  let active = players.some((x) => x.id === p.hqpActive) ? p.hqpActive : (players[0] ? players[0].id : "");
  // An address set by an EARLIER version after this one had saved its list:
  // that version knows one address and writes only hqpHost/hqpPort, so a list
  // that disagrees with them was edited there. The address wins — for the
  // HQPlayer that was in use, or as the first one if the list is empty.
  if (Array.isArray(p.hqpPlayers) && typeof p.hqpHost === "string" && HOST_RE.test(p.hqpHost.trim())) {
    const host = p.hqpHost.trim();
    const port = portOk(p.hqpPort) ? p.hqpPort : DEFAULT_PORT;
    if (!players.some((x) => x.host === host && x.port === port)) {
      const a = players.find((x) => x.id === active);
      if (a) {
        // Named after its old address (never given a name): it takes the new one.
        if (a.name === a.host) a.name = host;
        a.host = host;
        a.port = port;
      }
      else if (players.length < MAX_PLAYERS) {
        const id = players.some((x) => x.id === "hqp") ? "hqp-2" : "hqp";
        const dacs = cleanDacs([]);
        players.push({ id, name: host, host, port, dacs, dac: MAIN });
        active = id;
      }
    }
  }
  const demoRaw = p.hqpDemoDacs && typeof p.hqpDemoDacs === "object" ? p.hqpDemoDacs : {};
  const demoDacs = cleanDacs(demoRaw.dacs);
  return { players, active, demo: { dacs: demoDacs, dac: cleanDacChoice(demoDacs, demoRaw.dac) } };
}

/**
 * The settings patch that stores `model`. The active HQPlayer's address is
 * also written to the keys earlier versions read, so going back a version
 * still finds the HQPlayer that was in use.
 */
function toSettings(model) {
  const a = model.players.find((x) => x.id === model.active) || null;
  return {
    hqpPlayers: model.players.map((x) => ({ id: x.id, name: x.name, host: x.host, port: x.port, dacs: x.dacs, dac: x.dac })),
    hqpActive: model.active,
    hqpHost: a ? a.host : "",
    hqpPort: a ? a.port : DEFAULT_PORT,
    hqpDemoDacs: { dacs: model.demo.dacs, dac: model.demo.dac },
  };
}

const clone = (m) => JSON.parse(JSON.stringify(m));

function findPlayer(model, id) {
  if (id === "demo") return model.demo;
  const x = model.players.find((p) => p.id === id);
  if (!x) throw new HttpError(404, "no such HQPlayer");
  return x;
}

/** Add an HQPlayer. A blank name is the caller's to fill (from GetInfo, or the address). */
function addPlayer(model, input) {
  const m = clone(model);
  if (m.players.length >= MAX_PLAYERS) throw bad("that's the most HQPlayers this can keep (" + MAX_PLAYERS + ")");
  const host = checkHost(input.host);
  const port = input.port === undefined ? DEFAULT_PORT : input.port;
  if (!portOk(port)) throw bad("the port must be a whole number from 1 to 65535");
  const name = checkName(input.name || host, "the HQPlayer's name");
  if (m.players.some((x) => x.host.toLowerCase() === host.toLowerCase() && x.port === port))
    throw new HttpError(409, host + ":" + port + " is already in the list");
  let id = slug(name);
  if (RESERVED.includes(id)) id = id + "-hqp";
  for (let n = 2; m.players.some((x) => x.id === id); n++) id = slug(name).slice(0, 36) + "-" + n;
  const dacs = cleanDacs([]);
  m.players.push({ id, name, host, port, dacs, dac: MAIN });
  if (!m.active) m.active = id;
  return { model: m, player: m.players[m.players.length - 1] };
}

/** Rename an HQPlayer or change its address. Its id — and so its answers and learned failures — stays. */
function updatePlayer(model, id, patch) {
  const m = clone(model);
  const x = m.players.find((p) => p.id === id);
  if (!x) throw new HttpError(404, "no such HQPlayer");
  if (patch.name !== undefined) x.name = checkName(patch.name, "the HQPlayer's name");
  if (patch.host !== undefined) x.host = checkHost(patch.host);
  if (patch.port !== undefined) {
    if (!portOk(patch.port)) throw bad("the port must be a whole number from 1 to 65535");
    x.port = patch.port;
  }
  if (m.players.some((p) => p !== x && p.host.toLowerCase() === x.host.toLowerCase() && p.port === x.port))
    throw new HttpError(409, x.host + ":" + x.port + " is already in the list");
  return m;
}

function removePlayer(model, id) {
  const m = clone(model);
  const before = m.players.length;
  m.players = m.players.filter((p) => p.id !== id);
  if (m.players.length === before) throw new HttpError(404, "no such HQPlayer");
  if (m.active === id) m.active = m.players[0] ? m.players[0].id : "";
  return m;
}

function selectPlayer(model, id) {
  const m = clone(model);
  findPlayer(m, id);
  if (id !== "demo") m.active = id;
  return m;
}

/**
 * Add a DAC to an HQPlayer (or the Demo HQPlayer). The first time, the DAC it
 * already had is named too (`currentName`), since a picker of "DAC" and
 * "Desk DAC" says nothing about which is which.
 */
function addDac(model, playerId, input) {
  const m = clone(model);
  const x = findPlayer(m, playerId);
  if (x.dacs.length >= MAX_DACS) throw bad("that's the most DACs one HQPlayer can have here (" + MAX_DACS + ")");
  const name = checkName(input.name, "the DAC's name");
  const main = x.dacs[0];
  if (!main.name) main.name = checkName(input.currentName || "First DAC", "the first DAC's name");
  if (x.dacs.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "there's already a DAC called “" + name + "”");
  let id = slug(name);
  if (RESERVED.includes(id)) id = id + "-dac";
  for (let n = 2; x.dacs.some((d) => d.id === id); n++) id = slug(name).slice(0, 36) + "-" + n;
  x.dacs.push({ id, name });
  return { model: m, dac: { id, name } };
}

function renameDac(model, playerId, dacId, name) {
  const m = clone(model);
  const x = findPlayer(m, playerId);
  const d = x.dacs.find((y) => y.id === dacId);
  if (!d) throw new HttpError(404, "no such DAC");
  const n = checkName(name, "the DAC's name");
  if (x.dacs.some((y) => y !== d && y.name.toLowerCase() === n.toLowerCase())) throw new HttpError(409, "there's already a DAC called “" + n + "”");
  d.name = n;
  return m;
}

/** The first DAC can't be removed (it holds what was there before any were named), only renamed. */
function removeDac(model, playerId, dacId) {
  const m = clone(model);
  const x = findPlayer(m, playerId);
  if (dacId === MAIN) throw bad("the first DAC can be renamed but not removed");
  const before = x.dacs.length;
  x.dacs = x.dacs.filter((d) => d.id !== dacId);
  if (x.dacs.length === before) throw new HttpError(404, "no such DAC");
  if (x.dac === dacId) x.dac = MAIN;
  // Down to one: it goes back to being just "the DAC", with no picker.
  if (x.dacs.length === 1) x.dacs[0].name = "";
  return m;
}

function selectDac(model, playerId, dacId) {
  const m = clone(model);
  const x = findPlayer(m, playerId);
  if (!x.dacs.some((d) => d.id === dacId)) throw new HttpError(404, "no such DAC");
  x.dac = dacId;
  return m;
}

/** The key the guide's answers, the learned failures and a DAC's own presets are kept under. */
function scopeOf(playerId, dacId) {
  return !dacId || dacId === MAIN ? playerId : playerId + "#" + dacId;
}

module.exports = {
  MAIN, MAX_PLAYERS, MAX_DACS, HOST_RE,
  readPlayers, toSettings, addPlayer, updatePlayer, removePlayer, selectPlayer,
  addDac, renameDac, removeDac, selectDac, scopeOf, findPlayer,
};
