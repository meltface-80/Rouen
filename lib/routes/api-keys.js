// @ts-check
"use strict";
/*
 * api-keys.js — the Discogs token, the FanArt.tv key and the Last.fm key in Settings, moved out of index.js unchanged
 * in v1.9.67 (dev/quality.md: a session that touches index.js moves code out of it).
 *
 *   GET  /api/settings/discogs-token   { set, masked, source, check }   source "env": the install command supplied it
 *   POST /api/settings/discogs-token   body: { token }
 *   GET  /api/settings/fanart-key      { set, masked, source, check }
 *   POST /api/settings/fanart-key      body: { key }   — also clears the cached "no logo" verdicts and refetches
 *   GET  /api/settings/lastfm-key      { set, masked, source, check }
 *   POST /api/settings/lastfm-key      body: { key }   — also forgets what the old key could not read
 *
 * A saved key outranks the env seed from then on. Each answer carries the key's check (lib: index.js keyCheck): a
 * read answers from the last check, a save checks afresh.
 */

/**
 * @typedef {{ get: () => { key: string, source: string }, set: (key: string) => void, afterSave?: (key: string) => any }} KeySlot
 *   afterSave: what the service needs once a new key is kept; its result (FanArt.tv: how many misses were cleared)
 *   goes into the answer as `cleared` when it is a number
 * @param {{ get: Function, post: Function }} app
 * @param {{ keyCheck: (kind: string, key: string, fresh: boolean) => Promise<any>, save: (patch: Record<string, any>) => boolean,
 *           discogs: KeySlot, fanart: KeySlot, lastfm: KeySlot }} d
 */
function mountApiKeys(app, d) {
  /** @type {Array<[string, string, string, string, string]>} kind, route, body field, persisted field, what the log calls it */
  const KEYS = [["discogs", "discogs-token", "token", "discogsToken", "discogs token"],
    ["fanart", "fanart-key", "key", "fanartKey", "fanart key"],
    ["lastfm", "lastfm-key", "key", "lastfmKey", "last.fm key"]];
  for (const [kind, route, field, persisted, called] of KEYS) {
    const slot = /** @type {KeySlot} */ (/** @type {any} */ (d)[kind]);
    app.get("/api/settings/" + route, async (/** @type {any} */ req, /** @type {any} */ res) => {
      const { key, source } = slot.get();
      res.json({
        set: !!key,
        masked: key ? "••••••••" + key.slice(-4) : "",
        source,
        check: await d.keyCheck(kind, key, false),
      });
    });
    app.post("/api/settings/" + route, (/** @type {any} */ req, /** @type {any} */ res) => {
      const key = ((req.body && req.body[field]) || "").trim();
      if (!key) return res.status(400).json({ ok: false, error: field + " is empty" });
      slot.set(key);
      const saved = d.save({ [persisted]: key });
      const cleared = slot.afterSave ? slot.afterSave(key) : undefined;
      console.log("[settings] " + called + " set (" + key.length + " chars), persisted=" + saved +
        (typeof cleared === "number" ? ", cleared " + cleared + " cached no-logo verdicts" : ""));
      d.keyCheck(kind, key, true).then((check) => res.json(Object.assign({ ok: true, saved }, typeof cleared === "number" ? { cleared } : {}, { check })));
    });
  }
}

module.exports = { mountApiKeys };
