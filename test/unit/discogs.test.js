"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t2 (lib/discogs.js): what Rouen asks Discogs, moved out of index.js;
// the release lookup now keeps the catalogue number and the kind of release
// too, for the albums whose tags gave none (dev/design/catalogue.md §4).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDiscogs, releaseFromResults, typeFromFormats, typesFromFormats, sanitizeDiscogsSearchTerm } = require("../../lib/discogs");

const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isLikelyNotALabel = (s) => /\b(management|agency)\b/i.test(s);
const labelGroupKey = normalize;

test("typeFromFormats — Discogs' format descriptions, the most telling first; a bare 12\" says nothing", () => {
  assert.equal(typeFromFormats(["Vinyl", "LP", "Album", "Reissue"]), "album");
  assert.equal(typeFromFormats(["Vinyl", "12\"", "EP"]), "ep");
  assert.equal(typeFromFormats(["Vinyl", "7\"", "45 RPM"]), "single", "a 7\" is a single");
  assert.equal(typeFromFormats(["CD", "Maxi-Single"]), "single");
  assert.equal(typeFromFormats(["CD", "Album", "Compilation"]), "compilation", "a compilation on an album format is a compilation");
  assert.deepEqual(typesFromFormats(["CD", "Album", "Compilation"]), ["compilation", "album"], "and both kinds are kept (t4)");
  assert.deepEqual(typesFromFormats(["File", "FLAC"]), []);
  assert.equal(typeFromFormats(["CD", "Mixed", "Album"]), "remix", "a DJ mix");
  assert.equal(typeFromFormats(["Vinyl", "Mini-Album"]), "ep");
  assert.equal(typeFromFormats(["Vinyl", "12\"", "33 ⅓ RPM"]), null, "an EP or a single: not guessed");
  assert.equal(typeFromFormats(["File", "FLAC"]), null);
  assert.equal(typeFromFormats("Album"), "album", "one string");
  assert.equal(typeFromFormats(undefined), null);
});

test("releaseFromResults — the release whose title holds the album's, else the first; label, catalogue number and kind kept", () => {
  const results = [
    { title: "Boards Of Canada - Geogaddi (Remixes)", label: ["Warp Records"], catno: "WAP 999", format: ["Vinyl", "12\""] },
    { title: "Boards Of Canada - Geogaddi", label: ["Warp Records", "Warp Records"], catno: "WARP 101", format: ["Vinyl", "LP", "Album"] },
  ];
  const d = { normalize, isLikelyNotALabel };
  assert.deepEqual(releaseFromResults(results, "Geogaddi", "Boards of Canada", d), { label: "Warp Records", catno: "WARP 101", type: "album", types: ["album"] },
    "the first result holds the title too (\"Geogaddi (Remixes)\"), but a catalogue number is an edition's: the title that IS the artist's and the album's wins");
  assert.equal(releaseFromResults([results[0]], "Geogaddi", "Boards of Canada", d).catno, "WAP 999", "no exact title: the one that holds it, as the label lookup always matched");
  const short = [{ title: "X - Geogaddi (Remixes)", catno: "A" }, { title: "X - Remixes", catno: "B" }];
  assert.equal(releaseFromResults(short, "Remixes", "X", d).catno, "B", "a short title (the review): exact means the artist's and the album's, not a title ending in it");
  assert.equal(releaseFromResults(short, "Remixes", "", d).catno, "A", "no artist to go by: the first that holds it");
  assert.deepEqual(releaseFromResults([{ title: "X - Y", label: ["Some Management"], catno: "none", format: ["CD"] }], "Y", "X", d),
    { label: null, catno: null, type: null, types: [] }, "an answer with nothing worth keeping is still an answer, not a miss");
  assert.deepEqual(releaseFromResults([{ title: "Other", label: ["Hyperdub"], catno: "HDB 1", format: ["Vinyl", "12\"", "EP"] }], "Unfound", "", d),
    { label: "Hyperdub", catno: "HDB 1", type: "ep", types: ["ep"] }, "no title match: Discogs' first, as before");
  assert.equal(releaseFromResults([], "Y", "", d), null, "nothing came back");
  assert.equal(releaseFromResults(undefined, "Y", "", d), null);
});

test("sanitizeDiscogsSearchTerm — moved unchanged", () => {
  assert.equal(sanitizeDiscogsSearchTerm("[PIAS]"), "PIAS");
  assert.equal(sanitizeDiscogsSearchTerm("!!!"), "!!!", "nothing left: the name as it was");
});

test("the client — one request at a time 1.1 s apart; release() throws on a failed request so a miss and an error differ; no token, no request", async () => {
  const calls = [];
  let clock = 10000, slept = [];
  const answers = [];
  const dc = createDiscogs({
    token: () => "tok", userAgent: "ua", normalize, isLikelyNotALabel, labelGroupKey,
    now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; },
    http: async (url, headers) => { calls.push({ url, headers }); const a = answers.shift(); if (a instanceof Error) throw a; return a; },
  });
  answers.push({ results: [{ title: "A - B", label: ["L"], catno: "L-1", format: ["CD", "Album"] }] });
  assert.deepEqual(await dc.release("B", "A"), { label: "L", catno: "L-1", type: "album", types: ["album"] });
  assert.match(calls[0].url, /type=release&release_title=B&artist=A/);
  assert.equal(calls[0].headers.Authorization, "Discogs token=tok");
  assert.deepEqual(slept, [], "the first request waits for nothing");
  answers.push({ results: [] });
  assert.equal(await dc.release("C"), null, "nothing came back: a miss");
  assert.equal(slept.length, 1, "the second request waited");
  assert.ok(slept[0] > 0 && slept[0] <= 1100);
  answers.push(new Error("HTTP 429"));
  await assert.rejects(() => dc.release("D"), /HTTP 429/, "an error is thrown, not read as a miss");
  const none = createDiscogs({ token: () => "", http: async () => { throw new Error("must not be called"); }, userAgent: "ua", normalize, isLikelyNotALabel, labelGroupKey });
  assert.equal(await none.release("B"), null);
  assert.deepEqual(await none.logo("Warp"), { logo: null, reason: "no-token" });
});

test("the client — logo(): the best name match's cover image, or why not (moved unchanged)", async () => {
  const answers = [];
  const dc = createDiscogs({ token: () => "tok", userAgent: "ua", normalize, isLikelyNotALabel, labelGroupKey, now: () => 0, sleep: async () => {},
    http: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; } });
  answers.push({ results: [{ title: "Warp Records Ltd", cover_image: "https://i/warp-ltd.jpg" }, { title: "Warp Records", thumb: "https://i/warp.jpg" }] });
  assert.deepEqual(await dc.logo("Warp Records"), { logo: "https://i/warp.jpg", reason: "ok" }, "the exact name over the first result");
  answers.push({ results: [{ title: "X", cover_image: "https://i/spacer.gif" }] });
  assert.deepEqual(await dc.logo("X"), { logo: null, reason: "filtered" });
  answers.push({ results: [] });
  assert.deepEqual(await dc.logo("X"), { logo: null, reason: "empty" });
  answers.push(new Error("HTTP 429"));
  assert.deepEqual(await dc.logo("X"), { logo: null, reason: "rate" });
  answers.push(new Error("boom"));
  assert.deepEqual(await dc.logo("X"), { logo: null, reason: "error" }, "a logo error is swallowed, as it always was: the caller counts them");
});
