"use strict";
// ---------------------------------------------------------------------------
// v1.8.87: /api/display/photo passes the wall display's artist photos through
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
    // fanart's JSON is not ours to trust: an address it gave that points
    // anywhere else is refused even though it is in the cache.
    ["odd", ["https://169.254.169.254/latest/meta-data", "https://evil.example/fanart.tv/x.jpg"]],
  ]);
  const { displayPhotoAllowed } = loadIndexFunctions(["displayPhotoAllowed", "displayPhotoHostOk"], { artistPhotoCache });
  assert.equal(displayPhotoAllowed("https://assets.fanart.tv/fanart/music/x/artistbackground/miles.jpg"), true);
  for (const u of ["https://assets.fanart.tv/fanart/music/x/artistbackground/other.jpg",
                   "http://assets.fanart.tv/fanart/music/x/artistbackground/miles.jpg",
                   "http://127.0.0.1:3399/api/settings", "file:///etc/passwd", "", null, undefined, 5,
                   "https://169.254.169.254/latest/meta-data", "https://evil.example/fanart.tv/x.jpg"]) {
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
  assert.match(body, /DISPLAY_PHOTO_TYPES\.test\(type\)/);
  assert.match(body, /DISPLAY_PHOTO_MAX/);
  assert.match(body, /AbortController/);
});

test("redirects are followed only to fanart.tv, and only raster images are relayed", () => {
  const { displayPhotoHostOk } = loadIndexFunctions(["displayPhotoHostOk"], {});
  assert.equal(displayPhotoHostOk("https://assets.fanart.tv/a.jpg"), true);
  assert.equal(displayPhotoHostOk("https://fanart.tv/a.jpg"), true);
  for (const u of ["http://assets.fanart.tv/a.jpg", "https://fanart.tv.evil.example/a.jpg", "https://evilfanart.tv/a.jpg",
                   "https://10.0.0.1/a.jpg", "not a url"]) {
    assert.equal(displayPhotoHostOk(u), false, u);
  }
  const src = indexSource();
  const body = src.slice(src.indexOf('app.get("/api/display/photo"'), src.indexOf('app.get("/api/display/content"'));
  assert.match(body, /redirect: "manual"/, "fetch must not follow redirects by itself");
  assert.match(body, /displayPhotoHostOk\(to\)/, "a redirect target must be checked");
  assert.match(body, /nosniff/);
  const types = new RegExp(/DISPLAY_PHOTO_TYPES = \/(.*)\/i;/.exec(src)[1], "i");
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) assert.ok(types.test(t), t);
  for (const t of ["image/svg+xml", "text/html", "image/x-icon"]) assert.ok(!types.test(t), t + " would be relayed");
});

test("the page asks the route by the name the route reads", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const page = fs.readFileSync(path.join(__dirname, "../../public/display.js"), "utf8");
  assert.match(page, /"\/api\/display\/photo\?u=" \+ encodeURIComponent\(u\)/);
  assert.match(indexSource(), /app\.get\("\/api\/display\/photo"[\s\S]{0,200}req\.query\.u\b/);
});
