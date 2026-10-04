"use strict";
// v1.8.77: where a Smart Pick opens when it is not in the library. The Share
// Card's service links, with the service the pick CAME from pointed at the
// album itself — its id is known, and Qobuz's search link would land on the
// download store instead of opening the app.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const shareLinks = require("../../lib/share-links");
const qobuzDeep = require("../../lib/qobuz-deeplink");

const { smartPickServiceLinks } = loadIndexFunctions(["smartPickServiceLinks"], { shareLinks, qobuzDeep });
const enabled = ["qobuz", "tidal", "spotify"];

test("a Qobuz pick opens the Qobuz app on the album; the others search", () => {
  const l = smartPickServiceLinks({ artist: "Seefeel", album: "Quique", service: "qobuz", album_id: "0123abc" }, { enabled });
  assert.deepEqual(l.map(x => x.id), enabled);
  assert.equal(l[0].url, qobuzDeep.deepLink("0123abc"));
  assert.match(l[1].url, /^https:\/\/tidal\.com\/search\?q=/);
  assert.match(l[2].url, /spotify/);
});

test("a TIDAL pick opens the TIDAL album", () => {
  const l = smartPickServiceLinks({ artist: "Seefeel", album: "Quique", service: "tidal", album_id: "98765" }, { enabled });
  assert.equal(l.find(x => x.id === "tidal").url, "https://tidal.com/browse/album/98765");
  assert.match(l.find(x => x.id === "qobuz").url, /search|qobuz/);
  assert.notEqual(l.find(x => x.id === "qobuz").url, qobuzDeep.deepLink("98765"),
    "a TIDAL id was used for a Qobuz link");
});

test("no id: plain service links; switched-off services are left out", () => {
  const l = smartPickServiceLinks({ artist: "Seefeel", album: "Quique", service: "qobuz", album_id: "" }, { enabled: ["spotify"] });
  assert.deepEqual(l.map(x => x.id), ["spotify"]);
});
