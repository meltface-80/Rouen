// @ts-check
"use strict";
/*
 * http.js — an address read as JSON or as text, with a time limit: an answer that isn't 2xx throws "HTTP <status>".
 * Moved out of index.js in v1.9.70-t1, unchanged.
 */

/**
 * @param {string} url @param {Record<string, string>} headers @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
async function httpJson(url, headers, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
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
  try {
    const res = await fetch(url, { headers, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { httpJson, httpText };
