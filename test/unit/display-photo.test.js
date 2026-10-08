"use strict";
// ---------------------------------------------------------------------------
// v1.8.86: /api/display/photo passes the wall display's artist photos through
// from fanart.tv, so the page can read the pixels behind its Remote button.
// It must fetch ONLY an address fetchArtistPhotos handed out — anything else
// would make the server fetch whatever a request names.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions, indexSource } = require("../lib/extract");

test("only a photo address the server itself handed out is fetched", () => {
  const artistPhotoCache = new Map([
    ["miles davis", ["https://assets.fanart.tv/fanart/music/x/artistbackground/miles.jpg"]],
    ["nobody", []],
  ]);
  const { displayPhotoAllowed } = loadIndexFunctions(["displayPhotoAllowed"], { artistPhotoCache });
  assert.equal(displayPhotoAllowed("https://assets.fanart.tv/fanart/music/x/artistbackground/miles.jpg"), true);
  for (const u of ["https://assets.fanart.tv/fanart/music/x/artistbackground/other.jpg",
                   "http://assets.fanart.tv/fanart/music/x/artistbackground/miles.jpg",
                   "http://127.0.0.1:3399/api/settings", "file:///etc/passwd", "", null, undefined, 5]) {
    assert.equal(displayPhotoAllowed(u), false, "allowed " + JSON.stringify(u));
  }
});

test("the route checks the address, the switch, the type and the size before sending anything", () => {
  const src = indexSource();
  const at = src.indexOf('app.get("/api/display/photo"');
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf("\n});", at));
  assert.match(body, /if \(!displayEnabled\)/);
  assert.match(body, /displayPhotoAllowed\(u\)/);
  assert.match(body, /\^image\\\//);
  assert.match(body, /DISPLAY_PHOTO_MAX/);
  assert.match(body, /AbortController/);
});
