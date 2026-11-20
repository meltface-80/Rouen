// @ts-check
"use strict";
/*
 * drive-http.js — the iBroadcast drive as rclone reads it (2.0.6-t2, dev/design/ibroadcast.md §4.3): a server on
 * 127.0.0.1 only, under a random path (the host's other programs share its loopback with Rouen's container). Each folder
 * a page of links (rclone's http backend reads its listing from them), each file answered to HEAD (its size, from
 * iBroadcast's library) and to a ranged GET through the read rule (drive-reads.js): a refused read is answered 403,
 * which rclone hands Roon as a read error. A GET without a range is refused: rclone always sends one, and a whole file
 * asked for at once would go round the rule.
 */
const http = require("node:http");
const crypto = require("node:crypto");

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

/**
 * @param {{ tree: () => import("./drive-tree").Tree, reads: { read: (f: any, start: number, end: number) => Promise<any> },
 *           mtime: () => number, token?: string, log?: (line: string) => void }} o
 */
function createDriveHttp(o) {
  const token = o.token || crypto.randomBytes(16).toString("hex");
  const log = o.log || (() => {});
  /** @type {http.Server | null} */
  let server = null;
  let port = 0;

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async function handle(req, res) {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const prefix = "/" + token + "/";
    if (!u.pathname.startsWith(prefix) && u.pathname !== "/" + token) { res.writeHead(404); return res.end(); }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    let rel;
    try { rel = u.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/"); }
    catch (e) { res.writeHead(400); return res.end(); }   // a path that isn't valid percent-encoding names nothing here
    const tree = o.tree();
    const dirKey = rel.replace(/\/+$/, "");
    const listing = tree.dirs.get(dirKey);
    const lastModified = new Date(o.mtime()).toUTCString();
    if (listing && !tree.files.has(rel)) {
      const body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>\n"
        + listing.map((n) => { const dir = n.endsWith("/"); const name = dir ? n.slice(0, -1) : n;
          return `<a href="${encodeURIComponent(name)}${dir ? "/" : ""}">${esc(n)}</a>`; }).join("\n") + "\n</body></html>\n";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Last-Modified": lastModified });
      return res.end(req.method === "HEAD" ? undefined : body);
    }
    const f = tree.files.get(rel);
    if (!f) { res.writeHead(404); return res.end(); }
    const size = f.track.size;
    const head = { "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "Last-Modified": lastModified };
    if (req.method === "HEAD") { res.writeHead(200, Object.assign({ "Content-Length": size }, head)); return res.end(); }
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""));
    if (!m) { res.writeHead(416, { "Content-Range": "bytes */" + size }); return res.end(); }
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416, { "Content-Range": "bytes */" + size }); return res.end(); }
    try {
      const r = await o.reads.read(f, start, end);
      if (!r.ok) { res.writeHead(403); return res.end(); }
      const last = start + r.body.length - 1;
      res.writeHead(206, Object.assign({ "Content-Range": `bytes ${start}-${last}/${size}`, "Content-Length": r.body.length }, head));
      res.end(r.body);
    } catch (e) {
      log("drive: " + rel + " couldn't be read from iBroadcast: " + String(/** @type {any} */ (e).message));
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  }

  return {
    handle,
    /** The address rclone mounts. */
    url: () => `http://127.0.0.1:${port}/${token}/`,
    /** Listening on 127.0.0.1, on a port of the system's choosing. @returns {Promise<string>} */
    start() {
      if (server) return Promise.resolve(this.url());
      const s = http.createServer((req, res) => {
        // Nothing a read does may end Rouen: anything unforeseen is the read's failure alone.
        handle(req, res).catch((e) => { log("drive: " + String(e && e.message)); if (!res.headersSent) res.writeHead(500); res.end(); });
      });
      server = s;
      return new Promise((resolve, reject) => {
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => { port = /** @type {any} */ (s.address()).port; resolve(this.url()); });
      });
    },
    /** @returns {Promise<void>} */
    stop() {
      const s = server;
      server = null;
      if (!s) return Promise.resolve();
      return new Promise((resolve) => { s.closeAllConnections(); s.close(() => resolve()); });
    },
  };
}

module.exports = { createDriveHttp };
