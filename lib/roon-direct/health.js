// @ts-check
"use strict";
/*
 * health.js — the Native mode status board (dev/design/native-remote.md §13, v1.9.63): one row per thing native mode
 * does, each with a light — green (its last read or write worked), red (failing now, why), grey (not used yet on this
 * connection). The owner chose three lights: an unused feature is neither proven working nor failing.
 *
 * Pure: it is handed what each feature already keeps (and the reads the route makes), and writes nothing.
 */

/**
 * @typedef {"green" | "red" | "grey"} Light
 * @typedef {{ id: string, name: string, light: Light, line: string }} Row
 * @typedef {{ read: { entries: any[] } | { notRead: string } | null, move: { running: boolean, total: number, done: any[], error: string | null } | null,
 *             rouen: number }} LaterIn
 * @typedef {{ read: { playlists: any[] } | { notSent: string } | null, move: { running: boolean, total: number, done: any[], error: string | null } | null,
 *             rouen: number }} SmartIn
 * @typedef {{ read: { available: true, playlists: any[] } | { available: false, why: string } | null,
 *             copy: { running: boolean, total: number, done: any[], error: string | null } | null, rouen: number }} PlaylistsIn
 * @typedef {{ status: any, later: LaterIn, smart: SmartIn, playlists: PlaylistsIn,
 *             add: { ok: boolean, why: string | null, at: number, title: string } | null,
 *             controls?: { ok: boolean, why: string | null, at: number, what: string } | null }} Inputs
 */

const MISSED = 3;   // keepalives unanswered in a row: the connection is in doubt (as the pane has said since v1.9.21)

/** @param {string} id @param {string} name @param {Light} light @param {string} line @returns {Row} */
const row = (id, name, light, line) => ({ id, name, light, line });
/** "1 album", "12,968 albums". @param {number} n @param {string} one */
const count = (n, one) => `${n.toLocaleString("en-GB")} ${one}${n === 1 ? "" : "s"}`;
/** Each one left, by name, with why; the first three, then how many more. @param {any[]} left */
function said(left) {
  const shown = left.slice(0, 3).map((d) => `"${d.name || d.title}": ${d.why || "not taken"}`);
  return shown.join("; ") + (left.length > 3 ? `; and ${left.length - 3} more` : "");
}

/** @param {any} status @returns {Row} */
function connection(status) {
  const name = "Connection to your server";
  const link = status.link;
  if (!status.on || !link || !link.running) return row("connection", name, "grey", "Native mode isn't running.");
  if (link.up) {
    const missed = link.keepalive ? link.keepalive.missed : 0;
    if (missed >= MISSED) return row("connection", name, "red", `Connected, but your server hasn't answered ${missed} keepalives in a row.`);
    return row("connection", name, "green", "Connected.");
  }
  // A planned reconnect (the nightly one, another server paired) is not a fault.
  if (link.lastDown && !link.lastDown.planned) return row("connection", name, "red", `Not connected: ${link.lastDown.why}. Rouen keeps trying.`);
  return row("connection", name, "grey", link.lastDown ? `Reconnecting (${link.lastDown.why})…` : "Connecting…");
}

/** @param {any} status @returns {Row} */
function library(status) {
  const name = "Library";
  if (status.offReason) return row("library", name, "red", `Native mode turned itself off: ${status.offReason}`);
  if (!status.on) return row("library", name, "grey", "Native mode isn't running.");
  if (status.fellBack) return row("library", name, "red", `The last read of your server's library failed: ${status.fellBack.why}`);
  // Active stays true across a reconnect: read on this connection is what counts (as the playlists' copy waits for).
  if (status.reading || status.checking || (status.active && status.readHere === false)) return row("library", name, "grey", "Being read…");
  if (status.active) {
    const n = status.library && typeof status.library.albums === "number" ? status.library.albums : null;
    return row("library", name, "green", n === null ? "Your server's own album list, read." : `Your server's own list: ${count(n, "album")}.`);
  }
  return row("library", name, "grey", "Not read yet.");
}

/** @param {any} status @returns {Row} */
function hearts(status) {
  const name = "Hearts";
  const h = status.hearts;
  if (!status.on || !h) return row("hearts", name, "grey", "Native mode isn't running.");
  const fell = [h.album, h.track].filter((k) => k && k.on === false).map((k) => k.why);
  if (fell.length) return row("hearts", name, "red", fell.join(" "));
  if (h.off) {
    // Waiting for the library to be read is not a failure; a profile to choose (several, none chosen) is something to do.
    const profiles = Array.isArray(h.profiles) ? h.profiles : [];
    const choose = profiles.length > 1 && !profiles.some((/** @type {any} */ p) => p.id === h.profile);
    return row("hearts", name, choose ? "red" : "grey", h.off);
  }
  return row("hearts", name, "green", typeof h.favourites === "number"
    ? `On: your server's list has ${count(h.favourites, "favourite album")}.` : "On.");
}

/** A move's leftovers: the ones it couldn't take, once it has run. @param {any} move @param {string[]} bad */
const leftOf = (move, bad) => (move && !move.running ? move.done.filter((d) => bad.includes(d.result)) : []);

/** @param {LaterIn} l @returns {Row} */
function later(l) {
  const name = "Listen Later";
  if (!l.read) return row("later", name, "grey", "Not read yet.");
  if ("notRead" in l.read) return row("later", name, "red", `Your server's Listen Later can't be read: ${l.read.notRead}`);
  if (l.move && l.move.running) return row("later", name, "grey", `Moving Rouen's own onto your server's… ${l.move.done.length} of ${l.move.total}`);
  if (l.move && l.move.error) return row("later", name, "red", l.move.error);
  const left = leftOf(l.move, ["failed", "not-shown"]);
  if (left.length || l.rouen) {
    return row("later", name, "red", `${count(l.rouen || left.length, "album")} on Rouen's own list ${(l.rouen || left.length) === 1 ? "isn't" : "aren't"} on your server's yet`
      + (left.length ? `: ${said(left)}` : "; Rouen tries again each time it connects."));
  }
  return row("later", name, "green", `Your server's list: ${count(l.read.entries.length, "album")}.`);
}

/** @param {SmartIn} m @returns {Row} */
function smart(m) {
  const name = "Dynamic Playlists";
  if (!m.read) return row("smart", name, "grey", "Not read yet.");
  if ("notSent" in m.read) return m.read.notSent ? row("smart", name, "red", `Your server's smart playlists can't be read: ${m.read.notSent}`)
    : row("smart", name, "grey", "Native mode isn't running.");
  if (m.move && m.move.running) return row("smart", name, "grey", `Moving Rouen's onto your server… ${m.move.done.length} of ${m.move.total}`);
  if (m.move && m.move.error) return row("smart", name, "red", m.move.error);
  const left = leftOf(m.move, ["kept", "failed"]);
  if (left.length) return row("smart", name, "red", `${count(left.length, "Dynamic Playlist")} ${left.length === 1 ? "stays" : "stay"} Rouen's own: ${said(left)}`);
  if (m.rouen) return row("smart", name, "red", `${count(m.rouen, "Dynamic Playlist")} not on your server yet; Rouen tries again each time it connects.`);
  return row("smart", name, "green", `All of them your server's smart playlists: ${count(m.read.playlists.length, "smart playlist")}.`);
}

/** @param {PlaylistsIn} p @returns {Row} */
function playlists(p) {
  const name = "Playlists";
  if (!p.read) return row("playlists", name, "grey", "Not read yet.");
  if ("why" in p.read) return p.read.why ? row("playlists", name, "red", `Your server's playlists can't be read: ${p.read.why}`)
    : row("playlists", name, "grey", "Native mode isn't running.");
  if (p.copy && p.copy.running) return row("playlists", name, "grey", `Copying Rouen's own onto your server… ${p.copy.done.length} of ${p.copy.total}`);
  if (p.copy && p.copy.error) return row("playlists", name, "red", p.copy.error);
  // Copied but kept (tracks not found, or changed in Rouen meanwhile), skipped (Roon has the name), or failed: each stays
  // Rouen's own, said (§13).
  const left = p.copy && !p.copy.running ? p.copy.done.filter((d) => d.result === "failed" || d.result === "skipped"
    || (d.result === "copied" && !d.moved)).map((d) => (d.result !== "copied" ? d : Object.assign({}, d, { why: d.missing && d.missing.length
      ? `${count(d.missing.length, "track")} not found on your server` : "changed in Rouen while it was copied; your server has it as it was" }))) : [];
  if (left.length) return row("playlists", name, "red", `${count(left.length, "playlist")} of Rouen's own ${left.length === 1 ? "stays" : "stay"} in Rouen: ${said(left)}`);
  if (p.rouen) return row("playlists", name, "red", `${count(p.rouen, "playlist")} of Rouen's own not on your server yet; Rouen copies it each time it connects.`);
  return row("playlists", name, "green", `Your server's playlists: ${count(p.read.playlists.length, "playlist")}.`);
}

/** @param {Inputs["add"]} a @returns {Row} */
function add(a) {
  const name = "Add to library";
  if (!a) return row("add", name, "grey", "None asked for since Rouen started.");
  return a.ok ? row("add", name, "green", `Last: "${a.title}"${a.why ? ` (${a.why})` : ", taken"}.`)
    : row("add", name, "red", `Last: "${a.title}" wasn't sent: ${a.why}`);
}

/** What a control is called on the board. @type {Record<string, string>} */
const CONTROL = { play: "Play", pause: "Pause", playpause: "Play/pause", stop: "Stop", next: "Next", previous: "Previous",
  seek: "Seek", volume: "Volume", volumeBy: "Volume", mute: "Mute", settings: "Shuffle, repeat or Radio" };

/**
 * Playback controls (v1.9.65, native-remote.md §14.3): the last one, through your server and seen, or why not — what
 * the route did then (the official API, or only said) is its own, and not claimed here.
 * @param {any} status @param {Inputs["controls"]} c
 */
function controls(status, c) {
  const name = "Playback controls";
  if (!status.on) return row("controls", name, "grey", "Native mode isn't running.");
  if (!c) return row("controls", name, "grey", "None used since Rouen started.");
  const what = CONTROL[c.what] || c.what;
  return c.ok ? row("controls", name, "green", `Last: ${what}, through your server.`)
    : row("controls", name, "red", `Last: ${what} wasn't seen through your server: ${c.why}`);
}

/** The board's rows, in the order the pane shows them. @param {Inputs} i @returns {Row[]} */
function boardRows(i) {
  return [connection(i.status), library(i.status), hearts(i.status), later(i.later), smart(i.smart), playlists(i.playlists), add(i.add),
    controls(i.status, i.controls || null)];
}

module.exports = { boardRows };
