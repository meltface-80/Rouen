"use strict";
// ---------------------------------------------------------------------------
// A Pitchfork review page read (lib/pitchfork-review.js, moved out of index.js in v2.0.3-t12): the review's body from
// its JSON-LD Review block (kept on the server: only the score, the flag and a link are shown), its score and its Best
// New Music flag from the page's preloaded state.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePitchforkReviewHtml } = require("../../lib/pitchfork-review");

const strip = (h) => String(h).replace(/<[^>]*>/g, "");

test("the body from the Review block, the score and the flag from the page's state", () => {
  const page = '<script type="application/ld+json">{ not json </script>' +
    '<script type="application/ld+json">{"@type":"Article","reviewBody":"not this"}</script>' +
    '<script type="application/ld+json">{"@type":"Review","reviewBody":"<p>Fleetwood Mac at their best.</p>"}</script>' +
    '<script>window.__S = {"musicRating":{"isBestNewMusic":true,"score":9.4},"isBestNewMusic":true}</script>';
  assert.deepEqual(parsePitchforkReviewHtml(page, strip), { description: "Fleetwood Mac at their best.", score: 9.4, isBestNewMusic: true });
});

test("a page without them: no body, no score, not Best New Music", () => {
  assert.deepEqual(parsePitchforkReviewHtml("<html>Not found</html>", strip), { description: null, score: null, isBestNewMusic: false });
  const noScore = '<script type="application/ld+json">{"@type":"Review","reviewBody":"  "}</script>"isBestNewMusic":false';
  assert.deepEqual(parsePitchforkReviewHtml(noScore, strip), { description: null, score: null, isBestNewMusic: false });
});
