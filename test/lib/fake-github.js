"use strict";
// ---------------------------------------------------------------------------
// A GitHub with no network, for the updater's tests (lib/updater.js): API
// paths answered from a table, downloads served from files or refused with a
// 404. Shared by updater-image.test.js and updater-windows.test.js since
// v1.9.67-t5; the two copies it replaces had already begun to differ.
// ---------------------------------------------------------------------------
const https = require("node:https");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

/**
 * Run fn against a fake GitHub. `answers`: API path prefix → JSON (anything
 * else is a 404). `files`: download URL → path of a file to serve (anything
 * else is a 404). Returns fn's result and every download URL that was asked.
 * @template T
 * @param {Record<string, any>} answers
 * @param {() => Promise<T>} fn
 * @param {Record<string, string>} [files]
 */
async function withGitHub(answers, fn, files) {
  files = files || {};
  const saved = { request: https.request, get: https.get };
  const downloads = [];
  https.request = /** @type {any} */ ((opts, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const hit = Object.keys(answers).find((p) => opts.path.startsWith(p));
      const res = new EventEmitter();
      res.statusCode = hit ? 200 : 404;
      res.headers = {};
      res.resume = () => {};
      cb(res);
      res.emit("data", hit ? JSON.stringify(answers[hit]) : "{}");
      res.emit("end");
    });
    return req;
  });
  https.get = /** @type {any} */ ((opts, cb) => {
    const url = "https://" + opts.hostname + opts.path;
    downloads.push(url);
    const req = new EventEmitter();
    setImmediate(() => {
      const file = files[url];
      // A stream with the response's fields; its own resume(), which pipe() relies on.
      const res = new PassThrough();
      res.statusCode = file ? 200 : 404;
      res.headers = {};
      cb(res);
      if (file) fs.createReadStream(file).pipe(res); else res.end();
    });
    return req;
  });
  try { return { result: await fn(), downloads }; }
  finally { https.request = saved.request; https.get = saved.get; }
}

module.exports = { withGitHub };
