"use strict";
// ---------------------------------------------------------------------------
// Finding HQPlayers on the network. Ported from hqpweb by statelycurmudgeon
// (packages/protocol/src/discover.ts, MIT — see ./LICENSE), unchanged in what
// it does: UDP multicast to 239.192.0.199:4321 with <discover>hqplayer</discover>;
// each HQPlayer answers from its own address with
// <discover name="…" result="OK" version="…">hqplayer</discover> (measured by
// hqpweb). Multicast does not cross VLANs or routed subnets, so an HQPlayer on
// another one is added by its address instead.
//
// In Rouen it runs only when someone taps Find HQPlayers in Settings — never
// on a timer, and never on its own, whether control is on or off.
// ---------------------------------------------------------------------------

const dgram = require("node:dgram");
const { PROLOG, parseDocument } = require("./xml");

const DISCOVERY_GROUP = "239.192.0.199";
const DISCOVERY_PORT = 4321;
// A LAN has a handful of HQPlayers; stray or spoofed replies must not grow the answer without bound.
const MAX_FOUND = 32;

/**
 * @param {{ timeoutMs?: number, target?: { address: string, port: number }, probes?: number }} [opts]
 *   target: where to send the probe (default the multicast group; tests use unicast).
 *   probes: how many to send, spread over the first half of the wait (default 3).
 * @returns {Promise<Array<{ address: string, name: string, version: string }>>}
 */
function discover(opts) {
  opts = opts || {};
  const target = opts.target || { address: DISCOVERY_GROUP, port: DISCOVERY_PORT };
  const found = new Map();
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4" });
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      try { sock.close(); } catch (e) { /* already closed by an error: nothing left to release */ }
      resolve(Array.from(found.values()));
    };
    sock.on("error", done);
    sock.on("message", (msg, rinfo) => {
      try {
        const el = parseDocument(msg.toString("utf8"));
        if (el.name !== "discover" || el.attrs.result !== "OK") return;
        if (!found.has(rinfo.address) && found.size >= MAX_FOUND) return;
        // Lengths capped: the name is what Add names the HQPlayer by, and a
        // name is at most 64 characters there.
        found.set(rinfo.address, { address: rinfo.address, name: String(el.attrs.name || "").trim().slice(0, 64),
                                   version: String(el.attrs.version || "").slice(0, 120) });
      } catch (e) {
        // Not an HQPlayer reply (anything may be on that port): ignored.
      }
    });
    sock.bind(0, () => {
      try { sock.setMulticastTTL(2); } catch (e) { /* unicast target, or a platform without TTL control: the probe still goes */ }
      // UDP can drop a probe or a reply (hqpweb's testers saw scans fail
      // several times before one worked), so a few are sent, spread over the
      // first half of the wait. Replies are keyed by address, so repeats don't
      // duplicate.
      const timeoutMs = opts.timeoutMs || 2000;
      const probes = Math.max(1, opts.probes || 3);
      for (let i = 0; i < probes; i++) {
        setTimeout(() => {
          if (closed) return;
          sock.send(PROLOG + "<discover>hqplayer</discover>", target.port, target.address, (err) => {
            if (err && i === 0) done();
          });
        }, (i * timeoutMs) / (2 * probes));
      }
      setTimeout(done, timeoutMs);
    });
  });
}

module.exports = { discover, DISCOVERY_GROUP, DISCOVERY_PORT };
