"use strict";
// What the playlist-play tests share (playlist-play.test.js, playlist-play-states.test.js): the fake server with its
// one run, moved on by the driver, and the driver's look at the page's two buttons and its toasts.
// Not a test file: test/run.sh takes *.test.js only.

const zone = (/** @type {string} */ id, /** @type {string} */ name) => ({ zone_id: id, display_name: name, state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o" + id, display_name: name, is_muted: false, volume: null }], now_playing: null });
const ZONES = [zone("z1", "Living Room"), zone("z2", "Kitchen")];
const TRACKS = [
  { index: 0, title: "Rosanna", subtitle: "Toto", image_key: null },
  { index: 1, title: "Billie Jean", subtitle: "Michael Jackson", image_key: null },
  { index: 2, title: "Lowdown", subtitle: "Boz Scaggs", image_key: null },
  { index: 3, title: "Another Day", subtitle: "", image_key: null },
  { index: 4, title: "Roxanne", subtitle: "The Police", image_key: null },
];
const OWN = [
  { title: "Delta", subtitle: "Dee", album_title: "Fourth", album_subtitle: "Dee", album_offset: 10, track_index: 3, image_key: null },
  { title: "Alpha", subtitle: "Ay", album_title: "First", album_subtitle: "Ay", album_offset: 11, track_index: 0, image_key: null },
  { title: "Charlie", subtitle: "Cee", album_title: "Third", album_subtitle: "Cee", album_offset: 12, track_index: 2, image_key: null },
  { title: "Bravo", subtitle: "Bee", album_title: "Second", album_subtitle: "Bee", album_offset: 13, track_index: 1, image_key: null },
];

// The run the fake server holds for z1 (z2 has none). The status read answers with it as it stands; the driver moves
// it on. window.__slow = { start, stop, ask } holds an answer back that many ms; window.__askFails fails the status read.
const STUB = `
window.__run = null; window.__runs = 0; window.__slow = {}; window.__askFails = false;
window.__ordered = []; window.__whole = []; window.__taps = []; window.__stops = []; window.__own = []; window.__asks = [];
window.__refuse = {};
try { localStorage.setItem("rra-zone", "z1"); localStorage.removeItem("rouen.playlist-sort"); } catch (e) { /* storage optional */ }
window.__installFetch(function (url, opts) {
  var post = opts && opts.method === "POST", body = post ? JSON.parse(opts.body || "{}") : null;
  var copy = function () { return window.__run ? JSON.parse(JSON.stringify(window.__run)) : null; };
  // The answer as it stands when asked, given after the wait: a slow answer is an old one.
  var after = function (ms, answer) { return ms ? new Promise(function (r) { setTimeout(function () { r(answer); }, ms); }) : answer; };
  if (url.indexOf("/api/playlist/play-ordered/stop") > -1) {
    window.__stops.push(body);
    // As the server does: the run ends when its track in flight has landed, and the answer comes then.
    var end = function () {
      if (window.__run && !window.__run.done && (!body.id || body.id === window.__run.id)) { window.__run.done = true; window.__run.stopped = "user"; }
      return window.__json({ job: copy() });
    };
    return window.__slow.stop ? new Promise(function (r) { setTimeout(function () { r(end()); }, window.__slow.stop); }) : end();
  }
  if (url.indexOf("/api/playlist/play-ordered/status") > -1) {
    window.__asks.push(url);
    if (window.__askFails) return window.__json({ error: "down" }, 502);
    return after(window.__slow.ask, window.__json({ job: url.indexOf("zone=z1") > -1 ? copy() : null }));
  }
  if (url.indexOf("/api/playlist/play-ordered") > -1) {
    window.__ordered.push(body);
    window.__run = { id: "run" + (++window.__runs), kind: body.kind, total: body.tracks.length, sent: 0, queued: 0, failed: 0,
      first_error: "", done: false, stopped: null, seconds: 0, offset: body.offset, title: body.title };
    return after(window.__slow.start, window.__json({ ok: true, job: copy() }));
  }
  if (url.indexOf("/api/playlist/play-track") > -1) { window.__taps.push(body); return window.__json({ ok: true, invoked: "Play Now" }); }
  if (url.indexOf("/api/playlist/play") > -1) { window.__whole.push(body); return window.__json({ ok: true, invoked: "Play Now" }); }
  if (url.indexOf("/api/play-track") > -1) {
    window.__own.push(body);
    return window.__refuse[body.title] ? window.__json({ error: "Not in the library" }, 404) : window.__json({ ok: true });
  }
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [{ id: "u1", name: "Own Mix", track_total: 4, art_keys: [] }] });
  if (url.indexOf("/api/user-playlist") > -1) return window.__json({ id: "u1", name: "Own Mix", track_total: 4, tracks: ${JSON.stringify(OWN)} });
  if (url.indexOf("/api/roon-smart") > -1) return window.__json({ available: false, playlists: [] });
  if (url.indexOf("/api/roon-playlists") > -1) return window.__json({ available: false, why: "" });
  if (url.indexOf("/api/smart-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/playlists") > -1)
    return window.__json({ playlists: [{ offset: 0, title: "Session Work", subtitle: "5 Tracks", image_key: null },
      { offset: 1, title: "Other List", subtitle: "5 Tracks", image_key: null }], total: 2 });
  if (url.indexOf("/api/playlist/art") > -1) return window.__json({ art_keys: [] });
  if (url.indexOf("/api/playlist/track-artists") > -1) return window.__json({ status: "off" });
  if (url.indexOf("/api/playlist?") > -1)
    return window.__json({ title: url.indexOf("Other") > -1 ? "Other List" : "Session Work", subtitle: "5 Tracks", image_key: null,
      tracks: ${JSON.stringify(TRACKS)}, total: 5, truncated: false, can_play: true });
  if (url.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONES[0])} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: ${JSON.stringify(ZONES)} });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

// The page's two buttons as they stand, and every toast since the last look.
const LOOK = `
  var toastEl = document.getElementById("toast"), toasts = [];
  new MutationObserver(function () { toasts.push(toastEl.textContent); }).observe(toastEl, { childList: true, characterData: true, subtree: true });
  var said = function () { var t = toasts.slice(); toasts.length = 0; return t; };
  var btns = function () {
    return Array.prototype.map.call(document.querySelectorAll(".playlist-detail .playlist-actions > .action-btn"), function (b) {
      return { text: b.textContent, off: b.disabled, label: b.getAttribute("aria-label"), fits: b.scrollWidth <= b.clientWidth,
        stop: !!b.dataset.run, focus: document.activeElement === b };
    });
  };
  var press = async function (i) { document.querySelectorAll(".playlist-detail .playlist-actions > .action-btn")[i].click(); await window.__sleep(300); };
  var sort = async function (k) { document.querySelector('.playlist-sort-btn[data-sort="' + k + '"]').click(); await window.__sleep(100); };
  var poll = async function () { await window.__sleep(1700); };
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
`;

module.exports = { STUB, LOOK, TRACKS, OWN };
