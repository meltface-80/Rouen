"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t6: the share card's glass is the whole card (Mandarin's item 387).
//
// The shaded glass pane sat 48px inside the card with rounded corners and an
// edge line, the softened cover showing as a lighter rim round it. Mandarin's
// card dropped the rim: the glass fills the card, its contents 56px from the
// card's edge, the cover 464px, the logo tile 32px in from the corner. Rouen's
// card was said to have Mandarin's look in v2.0.3-t5 and had only an earlier
// part of it (the review's size and the release line), so the card on screen
// still had its rim. Nothing compared the drawn card with the look it claimed.
//
// WHY PIXELS. The card is a PNG drawn on a canvas; where the glass ends, where
// the cover sits and where the tile sits are only in the drawing. Every
// position compared here is read from the one decoded PNG (dev/lessons.md).
//
// The cover is one flat colour, so the softened ground under the glass is flat
// too and a difference between two pixels is the glass, not the album.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const DRIVER = `
  function flat(colour, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = colour;
    x.fillRect(0, 0, size, size);
    return c.toDataURL('image/png');
  }
  // A light cover: the rim it left round an inset pane is then far lighter than the glass.
  const coverUrl = flat('#f0e0c0', 64);
  // A logo no album and no part of the card is the colour of.
  const logoUrl = flat('#ff00ff', 96);

  async function draw(extra) {
    const blob = await ShareCard.render(Object.assign({
      coverUrl, wordmarkUrl: null, logoUrl: null,
      title: 'Migrant', artist: 'The Dear Hunter', releaseRaw: '2013',
      score: null, bestNewMusic: false, review: '', reviewSource: '',
    }, extra));
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('decode'));
      i.src = URL.createObjectURL(blob);
    });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, px: (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3) };
  }

  const bare = await draw({});
  T('w', bare.w); T('h', bare.h);
  // One height, inside where the inset pane was (it began 48px down) and above the cover: beside the
  // card's left edge, beside its right, and in the middle of the glass.
  T('rim_left', bare.px(6, 60)); T('rim_right', bare.px(bare.w - 7, 60)); T('glass', bare.px(600, 60));
  // The card's very corner, which an inset pane left bare. The vignette starts far lower, so the top is one shade.
  T('corner', bare.px(2, 2));
  // The cover, 464px and 56px from the card's left: a 600px card centres it, 68px from the top. Read at its mid height.
  T('cover_in_left', bare.px(60, 300)); T('cover_out_left', bare.px(52, 300));
  T('cover_in_right', bare.px(516, 300)); T('cover_out_right', bare.px(524, 300));
  T('cover_in_top', bare.px(288, 72)); T('cover_out_top', bare.px(288, 64));
  T('cover_in_bottom', bare.px(288, 528)); T('cover_out_bottom', bare.px(288, 536));

  const tiled = await draw({ logoUrl });
  T('tile_h', tiled.h);
  // The tile: 96px, 32px in from the card's bottom-right corner.
  const R = tiled.w - 32, B = tiled.h - 32;
  T('tile_in_br', tiled.px(R - 2, B - 2)); T('tile_out_right', tiled.px(R + 3, B - 48)); T('tile_out_below', tiled.px(R - 48, B + 3));
  T('tile_in_tl', tiled.px(R - 94, B - 94)); T('tile_out_left', tiled.px(R - 99, B - 48)); T('tile_out_above', tiled.px(R - 48, B - 99));
`;

test("the share card's glass is the whole card, its cover and tile where Mandarin's are (v2.0.3-t6)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "share-card-glass", driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, r);

  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 4);
  const light = (p) => p[0] > 200 && p[1] > 180;                       // the flat cover, sharp
  const magenta = (p) => p[0] > 200 && p[1] < 60 && p[2] > 200;        // the flat logo

  await t.test("no rim: the card's edges are as shaded as the middle of the glass", () => {
    assert.equal(r.w, 1200);
    assert.equal(r.h, 600, "a card with no review keeps its height");
    assert.ok(near(r.rim_left, r.glass), `the left edge ${r.rim_left} by the glass ${r.glass}: a lighter rim of the cover is showing`);
    assert.ok(near(r.rim_right, r.glass), `the right edge ${r.rim_right} by the glass ${r.glass}`);
  });

  await t.test("no bare corner: the card's corner is glass too", () => {
    assert.ok(near(r.corner, r.glass), `the corner ${r.corner} by the glass ${r.glass}`);
  });

  await t.test("the cover is 464px, 56px from the card's left edge", () => {
    assert.ok(light(r.cover_in_left) && !light(r.cover_out_left), `left edge at 56: ${r.cover_out_left} | ${r.cover_in_left}`);
    assert.ok(light(r.cover_in_right) && !light(r.cover_out_right), `right edge at 520: ${r.cover_in_right} | ${r.cover_out_right}`);
    assert.ok(light(r.cover_in_top) && !light(r.cover_out_top), `top edge at 68: ${r.cover_out_top} | ${r.cover_in_top}`);
    assert.ok(light(r.cover_in_bottom) && !light(r.cover_out_bottom), `bottom edge at 532: ${r.cover_in_bottom} | ${r.cover_out_bottom}`);
  });

  await t.test("the logo tile is 96px, 32px in from the card's bottom-right corner", () => {
    assert.equal(r.tile_h, 600, "a short title beside the cover needs no room made for the tile");
    assert.ok(magenta(r.tile_in_br) && !magenta(r.tile_out_right) && !magenta(r.tile_out_below),
      `its bottom-right: ${r.tile_in_br}, right of it ${r.tile_out_right}, below it ${r.tile_out_below}`);
    assert.ok(magenta(r.tile_in_tl) && !magenta(r.tile_out_left) && !magenta(r.tile_out_above),
      `its top-left: ${r.tile_in_tl}, left of it ${r.tile_out_left}, above it ${r.tile_out_above}`);
  });
});
