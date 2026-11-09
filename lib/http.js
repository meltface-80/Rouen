// @ts-check
"use strict";
/*
 * http.js — an address read as JSON or as text, with a time limit: an answer that isn't 2xx throws "HTTP <status>".
 * Moved out of index.js in v1.9.70-t1, unchanged. Since v2.0.3-t5 each request, once it ends, is told to one observer
 * (lib/share-trace.js: which outside site a slow share card waited on); with none set, nothing is told.
 */

/** @typedef {{ url: string, start: number, end: number, status: string }} HttpDone */
/** @type {((r: HttpDone) => void) | null} */
let observer = null;

/** The one observer told of every request's end, or null for none. @param {((r: HttpDone) => void) | null} fn */
function setHttpObserver(fn) { observer = fn; }

/**
 * @param {string} url @param {number} start @param {string} status
 */
function tell(url, start, status) {
  if (!observer) return;
  try { observer({ url, start, end: Date.now(), status }); } catch (e) { /* the observer only records: a fault there must not fail the request */ }
}

/** What a failed request says in a log: its status, a time limit reached, or the error's own name. @param {any} e */
function failure(e) {
  if (e && e.name === "AbortError") return "timed out";
  const m = /^HTTP (\d+)$/.exec(String(e && e.message));
  return m ? m[1] : "error: " + String((e && (e.cause && e.cause.code || e.code || e.message)) || e).slice(0, 60);
}

/**
 * @param {string} url @param {Record<string, string>} headers @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
async function httpJson(url, headers, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const out = await res.json();
    tell(url, start, String(res.status));
    return out;
  } catch (e) {
    tell(url, start, failure(e));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url @param {Record<string, string>} headers @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
async function httpText(url, headers, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { headers, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const out = await res.text();
    tell(url, start, String(res.status));
    return out;
  } catch (e) {
    tell(url, start, failure(e));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { httpJson, httpText, setHttpObserver };
