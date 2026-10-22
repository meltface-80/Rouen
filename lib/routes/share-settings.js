// @ts-check
"use strict";
/*
 * share-settings.js — GET/POST /api/settings/share-links, moved out of index.js unchanged in v1.9.54
 * (dev/quality.md: a self-contained route group, as index.js shrinks session by session).
 *
 * Share card links: which streaming services and which review sites appear under the card. Both lists are the
 * ones lib/share-links.js knows — the screen shows what CAN be linked to, which is why it is served even when
 * there is no album in hand.
 *
 * A stored set outliving a service it names is the ordinary case after an update, not an error, so both are
 * sanitised against the live table on the way out as well as on the way in.
 */

/**
 * The share services and the review sites turned on: the defaults until a choice is saved, else the saved choice,
 * sanitised against the live table. One rule, for the settings screen and every card that offers links (v1.9.54:
 * it stood in index.js five times).
 * @param {any} shareLinks @param {{ shareServices?: any, shareReviews?: any }} st  the saved settings
 */
const enabledServices = (shareLinks, st) => (st.shareServices === undefined
  ? shareLinks.defaultServiceIds() : shareLinks.sanitiseIds(st.shareServices, shareLinks.knownServiceIds()));
/** @param {any} shareLinks @param {{ shareReviews?: any }} st */
const enabledReviews = (shareLinks, st) => (st.shareReviews === undefined
  ? shareLinks.defaultReviewIds() : shareLinks.sanitiseIds(st.shareReviews, shareLinks.knownReviewIds()));

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ shareLinks: { SERVICES: any[], REVIEWS: any[], defaultServiceIds(): string[], defaultReviewIds(): string[],
 *                         knownServiceIds(): string[], knownReviewIds(): string[], sanitiseIds(ids: any, known: string[]): string[] },
 *           load: () => any, save: (patch: any) => any }} d
 */
function mountShareSettings(app, d) {
  const { shareLinks } = d;
  app.get("/api/settings/share-links", (/** @type {any} */ req, /** @type {any} */ res) => {
    const st = d.load();
    res.json({
      services: { all: shareLinks.SERVICES, enabled: enabledServices(shareLinks, st) },
      reviews:  { all: shareLinks.REVIEWS,  enabled: enabledReviews(shareLinks, st) },
    });
  });
  app.post("/api/settings/share-links", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    /** @type {Record<string, string[]>} */
    const patch = {};
    // `undefined` means "not being changed" and an empty ARRAY means "the user
    // turned them all off". Conflating the two is how an off switch quietly
    // turns itself back on, so only Array.isArray gets through.
    if (Array.isArray(body.services)) {
      patch.shareServices = shareLinks.sanitiseIds(body.services, shareLinks.knownServiceIds());
    }
    if (Array.isArray(body.reviews)) {
      patch.shareReviews = shareLinks.sanitiseIds(body.reviews, shareLinks.knownReviewIds());
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "services and/or reviews array required" });
    }
    d.save(patch);
    const st = d.load();
    res.json({ ok: true,
               services: st.shareServices === undefined ? shareLinks.defaultServiceIds() : st.shareServices,
               reviews:  st.shareReviews  === undefined ? shareLinks.defaultReviewIds()  : st.shareReviews });
  });
}

module.exports = { mountShareSettings, enabledServices, enabledReviews };
