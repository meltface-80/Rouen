"use strict";
// A Roon Core as a Squeezebox player meets it, for the probe player's tests (v1.9.72-t1): the SlimProto server on a
// port of its own, and the HTTP server the audio comes from. It writes what Lyrion's server writes, in Squeezelite's
// layouts. It is a fake: what it sends is the test's choice, not evidence of what Roon sends (CLAUDE.md, "Tests").
const net = require("net");

/** A strm's payload, as the server writes one. */
function strm(o) {
  const d = Buffer.alloc(24);
  d.write(o.cmd || "s", 0, "latin1");
  d.write(o.autostart || "1", 1, "latin1");
  d.write(o.format || "f", 2, "latin1");
  d.write(o.size || "?", 3, "latin1");
  d.write(o.rate || "?", 4, "latin1");
  d.write(o.ch || "?", 5, "latin1");
  d.write(o.endian || "?", 6, "latin1");
  d[7] = o.threshold || 255;
  d[9] = 3;
  d.write("1", 10, "latin1");
  d.writeUInt32BE(o.gain || 0, 14);
  d.writeUInt16BE(o.port || 9000, 18);
  (o.ip || [0, 0, 0, 0]).forEach((x, i) => { d[20 + i] = x; });
  return Buffer.concat([d, Buffer.from(o.request || "", "latin1")]);
}

/** A server on a free port of its own; resolves with the port. */
const listen = (server) => new Promise((resolve) => { server.listen(0, "127.0.0.1", () => resolve(server.address().port)); });

/**
 * @param {Record<string, Buffer>} bodies  the audio for each request path
 */
async function createFakeCore(bodies) {
  /** Every player message, in order: { op, event (STAT's), payload }. */
  const got = [];
  const requests = [];
  const waiters = [];
  let player = null;
  const note = () => { for (const w of waiters.slice()) if (w.test()) { waiters.splice(waiters.indexOf(w), 1); w.done(); } };

  const control = net.createServer((c) => {
    player = c;
    let held = Buffer.alloc(0);
    c.on("data", (chunk) => {
      held = Buffer.concat([held, chunk]);
      while (held.length >= 8) {
        const len = held.readUInt32BE(4);
        if (held.length < 8 + len) break;
        const op = held.toString("latin1", 0, 4), payload = held.subarray(8, 8 + len);
        got.push({ op, event: op === "STAT" ? payload.toString("latin1", 0, 4) : null, payload, at: Date.now() });
        held = held.subarray(8 + len);
      }
      note();
    });
    c.on("error", () => { /* the player going away mid-test is the test's own doing */ });
  });
  const audio = net.createServer((c) => {
    let head = "";
    c.on("data", (chunk) => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      const line = head.split("\r\n")[0];
      requests.push(line);
      const body = bodies[line.split(" ")[1]] || Buffer.alloc(0);
      c.end(Buffer.concat([Buffer.from("HTTP/1.0 200 OK\r\nContent-Type: audio/L16\r\n\r\n", "latin1"), body]));
      note();
    });
    c.on("error", () => { /* as above */ });
  });
  const port = await listen(control), streamPort = await listen(audio);

  return {
    port, streamPort, got, requests,
    /** Server → player: a 2-byte length, the opcode, the payload. */
    send(op, data) {
      const h = Buffer.alloc(2);
      h.writeUInt16BE(4 + data.length);
      player.write(Buffer.concat([h, Buffer.from(op, "latin1"), data]));
    },
    events: () => got.filter((m) => m.op === "STAT" && m.event !== "STMt").map((m) => m.event),
    /** Resolves once test() is true, or fails after ms. */
    waitFor(test, ms = 4000, what = "a condition") {
      if (test()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        let timer = null;
        const w = { test, done: () => { clearTimeout(timer); resolve(); } };
        timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error("timed out waiting for " + what)); }, ms);
        waiters.push(w);
      });
    },
    close() {
      if (player) player.destroy();
      control.close();
      audio.close();
    },
  };
}

module.exports = { strm, createFakeCore };
