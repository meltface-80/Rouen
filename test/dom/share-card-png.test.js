"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t7: the share card's PNG is made when the card is drawn, not when the page is next idle.
//
// The owner's log (2026-11-09, the Android app): the PNG step alone took 4066, 4087, 4161, 4207 and 4318 ms on five
// cards and 13082 ms on a sixth, and 110-210 ms on four others, whatever the card's size (a 463 KB card 4161 ms, a
// 1.5 MB one 154 ms). canvas.toBlob does not encode when it is called: Chromium encodes a PNG in the page's idle
// tasks, and only when none has come does it force the encode, after 1 s on a desktop and 4 s on a phone
// (kIdleTaskStartTimeoutDelayMs), then up to 9 s more once started (canvas_async_blob_creator.cc). An Android WebView
// showing a still sheet gave the page no idle task, so every card whose answer came after the sheet had settled waited
// out the 4 s.
//
// WHAT THIS CAN AND CANNOT SHOW. The WebView's idle scheduling is the device's and is not reproduced here. What is
// held here is the dependence itself: toBlob is replaced with one that never answers, which is the WebView's toBlob
// with the 4 s taken to its limit. A card that still arrives does not wait on it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { decodePng } = require("../../lib/png");

const DRIVER = `
  function flat(colour, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = colour;
    x.fillRect(0, 0, size, size);
    return c.toDataURL('image/png');
  }
  const coverUrl = flat('#f0e0c0', 64);

  // The WebView's toBlob, its wait taken to the limit: asked, and never answering.
  let asked = 0;
  HTMLCanvasElement.prototype.toBlob = function () { asked++; };

  // The card's bytes, kept as its Blob is made (2.0.4-t2): read here, at once, they leave nothing for the page to wait on.
  // Read from the Blob (blob.arrayBuffer(), an <img> of it) they were work the page's clock does not wait for, and under
  // load the 30 s budget ran out while it went on (7 runs in 100): the page ended with no result.
  let pngParts = null;
  const RealBlob = window.Blob;
  window.Blob = function (parts, opts) {
    if (opts && opts.type === 'image/png') pngParts = parts;
    return new RealBlob(parts, opts);
  };
  window.Blob.prototype = RealBlob.prototype;

  const timing = {};
  const made = ShareCard.render({
    coverUrl, wordmarkUrl: null, logoUrl: null,
    title: 'Migrant', artist: 'The Dear Hunter', releaseRaw: '2013',
    score: null, bestNewMusic: false, review: 'A record that only has to answer to itself.', reviewSource: 'Wikipedia',
  }, timing);
  const blob = await Promise.race([made, window.__sleep(8000).then(() => null)]);
  T('asked', asked);
  T('drawn', !!blob);
  if (blob) {
    T('is_blob', blob instanceof RealBlob);
    T('type', blob.type);
    T('size', blob.size);
    // The PNG's bytes as base64, for the test to decode outside the page (lib/png).
    const bytes = pngParts && pngParts.length === 1 && pngParts[0] instanceof Uint8Array ? pngParts[0] : null;
    let bin = '';
    if (bytes) for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    T('png', bytes ? btoa(bin) : null);
    T('timed_h', timing.height);
    T('encode_ms', timing.encode_ms);
    T('bytes', timing.bytes);
  }
`;

test("the share card's PNG does not wait for the page to be idle (v2.0.3-t7)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "share-card-png", driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, r);

  await t.test("a card is made though canvas.toBlob never answers", () => {
    assert.equal(r.drawn, true, "no card after 8 s: it is waiting on canvas.toBlob, which encodes only in the page's idle time");
    assert.equal(r.asked, 0, "canvas.toBlob is not asked at all");
  });

  await t.test("it is the same thing as before: a PNG in a Blob, the card's size", () => {
    assert.equal(r.is_blob, true);
    assert.equal(r.type, "image/png");
    assert.equal(typeof r.png, "string", "the bytes the card's Blob was made of");
    const png = Buffer.from(r.png, "base64");
    assert.equal(png.length, r.size, "they are the whole Blob");
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "the PNG signature");
    const img = decodePng(png);
    assert.equal(img.width, 1200);
    assert.equal(img.height, r.timed_h, "the decoded picture is as tall as the card drawn");
  });

  await t.test("the PNG step is still timed, and its size told", () => {
    assert.equal(typeof r.encode_ms, "number");
    assert.ok(r.encode_ms < 2000, `the PNG took ${r.encode_ms} ms`);
    assert.equal(r.bytes, r.size, "the timings carry the PNG's size");
  });
});
