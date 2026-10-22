// @ts-check
"use strict";
/*
 * zone-probe.js — N3-0 (dev/design/native-remote.md §14.1, v1.9.64): your server's zones, outputs and audio
 * devices as it already sends them to native mode's connection, read once, by hand, beside the official API's
 * zones. It makes no call: it reads the graph the connection holds. Nothing is written.
 *
 *   1. The types held whose name says zone, endpoint, transport, display, output, source control, audio device, DSP
 *      or queue, each with how many are loaded.
 *   2. Each Zone, every member as sent, its ZoneId as hex, and the official zone smart.js's zoneFor matches to it.
 *   3. Each Endpoint, every member as sent, and the official output of the same name.
 *   4. Each audio device (a type ending AudioDevice, and any AudioDeviceCommonConfig), every member as sent.
 *   5. What moves: every object of those kinds, and every object a zone or endpoint names, read again after a few
 *      seconds, outside the turn, and each member that changed listed with both values, beside the official zones'
 *      seek positions then and now (by zone id).
 *
 * Values are said as smart-probe.js's describe() says them: never bytes, a list by its count and first five, an
 * object by its type and name. At most MAX_EACH of each kind.
 */
const { field, isRef } = require("./objects");
const { describe } = require("./smart-probe");
const { zoneFor } = require("./smart");

const MAX_EACH = 20;
/** Objects read twice for what moves, and objects said to have moved, at most. */
const MAX_WATCHED = 200, MAX_MOVED = 40;
const MOVE_MS = 3000;
/** The types worth listing: what a zone, its outputs and their devices may be carried by. */
const KINDS = /Zone|Endpoint|Transport|Display|Output|SourceControl|AudioDevice|Dsp|Queue/;
/** A member's short name ("…Zone::Name" → "Name"). @param {string} k */
const short = (k) => k.slice(k.lastIndexOf("::") + 2);
/** A type's short name ("Sooloos.Broker.Api.Zone" → "Zone"). @param {string} t */
const typeShort = (t) => t.replace(/^Sooloos\.Broker\.Api\./, "");
/** @param {any} v */
const hex = (v) => (Buffer.isBuffer(v) ? v.toString("hex") : null);

/** Every member of one object, as the page says it. @param {any} graph @param {any} o @returns {Record<string, any>} */
function members(graph, o) {
  return Object.fromEntries(Object.keys(o.fields).filter((k) => k !== "$items").map((k) => [short(k), describe(graph, o.fields[k])]));
}

/** A value whole, as text to compare by: describe() stops two levels down, a change below that must still show. @param {any} v */
const raw = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x)
  : x && x.type === "Buffer" && Array.isArray(x.data) ? Buffer.from(x.data).toString("hex") : x));

/** The objects a value names by reference: itself, a list's items, an inline struct's members. @param {any} v @returns {bigint[]} */
function refsOf(v) {
  if (!v || typeof v !== "object" || Buffer.isBuffer(v)) return [];
  if (isRef(v)) return [v.$ref];
  if (Array.isArray(v)) return v.flatMap(refsOf);
  if ("$type" in v) return Object.values(v).flatMap((x) => (x && typeof x === "object" && isRef(x) ? [x.$ref] : []));
  return [];
}

/** An official zone as the probe sets it beside the native one. @param {any} z */
function official(z) {
  const np = z.now_playing || null;
  return {
    zone_id: z.zone_id, display_name: z.display_name || null, state: z.state || null,
    now_playing: np && np.one_line ? np.one_line.line1 || null : null, seek_position: np ? np.seek_position ?? null : null,
    settings: z.settings || null,
    outputs: (z.outputs || []).map((/** @type {any} */ o) => ({ display_name: o.display_name || null, muted: !!o.is_muted,
      volume: o.volume ? o.volume.value ?? null : null })),
  };
}

/** How an object is named in "what moves". @param {any} o */
const nameOf = (o) => `${typeShort(o.typeName)} "${field(o, "Name") ?? String(o.oid)}"`;

/**
 * Each watched object's members now: whole (to compare) and as the page says them.
 * @param {any} graph @param {any[]} objs @returns {Map<string, { name: string, raw: Record<string, string>, shown: Record<string, any> }>}
 */
function snapshot(graph, objs) {
  return new Map(objs.map((o) => [String(o.oid), { name: nameOf(o),
    raw: Object.fromEntries(Object.keys(o.fields).filter((k) => k !== "$items").map((k) => [short(k), raw(o.fields[k])])),
    shown: members(graph, o) }]));
}

/**
 * The members that changed between two snapshots, by object; at most MAX_MOVED objects.
 * @param {ReturnType<typeof snapshot>} was @param {ReturnType<typeof snapshot>} now
 */
function moved(was, now) {
  /** @type {any[]} */
  const out = [];
  for (const [oid, before] of was) {
    const after = now.get(oid);
    if (!after) { out.push({ object: before.name, gone: true }); continue; }
    const changed = Object.keys(Object.assign({}, before.raw, after.raw)).filter((k) => before.raw[k] !== after.raw[k])
      .map((k) => ({ member: k, was: before.shown[k] ?? null, now: after.shown[k] ?? null }));
    if (changed.length) out.push({ object: before.name, changed });
  }
  return { changed: out.slice(0, MAX_MOVED), more: Math.max(0, out.length - MAX_MOVED) };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           zones: () => any[], log?: (line: string) => void, moveMs?: number }} deps
 *   zones: the official API's zones now (index.js's), each as the official API gives it; off: why it can't run (native
 *   mode off) — the library need not have been read, the probe reads none of it
 */
function createZoneProbe(deps) {
  const log = deps.log || (() => {});
  const moveMs = deps.moveMs ?? MOVE_MS;
  let busy = false;

  /** What the graph holds now, in one pass over it, read in the turn. @param {any} s */
  function read(s) {
    const graph = s.graph;
    /** @type {Record<string, number>} */
    const types = {};
    /** @type {any[]} */ const zones = [];
    /** @type {any[]} */ const endpoints = [];
    /** @type {any[]} */ const devices = [];
    /** @type {any[]} */ const kinds = [];
    for (const o of graph.objects.values()) {
      if (!o.loaded) continue;
      const t = typeShort(o.typeName);
      if (!KINDS.test(t)) continue;
      types[t] = (types[t] || 0) + 1;
      kinds.push(o);
      if (t === "Zone") zones.push(o);
      else if (t === "Endpoint") endpoints.push(o);
      if (/AudioDevice$/.test(t) || t === "AudioDeviceCommonConfig") devices.push(o);
    }
    // Watched for what moves (§14.1, 5): every object of these kinds, and every object a zone or endpoint names (the
    // position may be carried by one of those, the review), loaded, at most MAX_WATCHED.
    const named = zones.concat(endpoints).flatMap((o) => Object.values(o.fields).flatMap(refsOf))
      .map((oid) => graph.get(oid)).filter((o) => o && o.loaded);
    const watched = [...new Map(kinds.concat(named).map((o) => [String(o.oid), o])).values()].slice(0, MAX_WATCHED);
    const officials = deps.zones();
    const matched = officials.map((z) => ({ z, m: zoneFor(graph, z) }));
    const outputs = officials.flatMap((z) => z.outputs || []);
    return { graph, types, zones, endpoints, devices, watched, matched, outputs };
  }

  /** Each official zone's seek position now, by its id. */
  const seeks = () => new Map(deps.zones().map((z) => [z.zone_id, official(z).seek_position]));

  return {
    /** @returns {Promise<any>} what was read, or { error, status } when it could not be asked for */
    async run() {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A probe is already running.", status: 409 };
      busy = true;
      try {
        /** @type {any} */
        let first = null;
        const out = /** @type {any} */ (await deps.inTurn(async () => {
          const s = deps.link ? deps.link.session() : null;
          if (!s) return { error: "Native mode isn't connected to your server right now.", status: 503 };
          const r = read(s);
          first = { session: s, watched: r.watched, at: snapshot(r.graph, r.watched), seek: seeks() };
          /** One object's members, from the snapshot when it was watched. @param {any} o */
          const shown = (o) => (first.at.get(String(o.oid)) || { shown: members(r.graph, o) }).shown;
          return {
            readOnly: true, calls: 0, types: r.types,
            zones: r.zones.slice(0, MAX_EACH).map((o) => {
              const m = r.matched.find((x) => "zone" in x.m && x.m.zone === o);
              return { oid: String(o.oid), zoneIdHex: hex(field(o, "ZoneId")), members: shown(o),
                official: m ? Object.assign(official(m.z), { matchedBy: /** @type {any} */ (m.m).by }) : null };
            }),
            unmatched: r.matched.filter((x) => !("zone" in x.m)).slice(0, MAX_EACH)
              .map((x) => Object.assign(official(x.z), { why: /** @type {any} */ (x.m).notSent })),
            endpoints: r.endpoints.slice(0, MAX_EACH).map((o) => {
              const name = field(o, "Name");
              const same = r.outputs.find((/** @type {any} */ x) => x.display_name === name);
              return { oid: String(o.oid), members: shown(o),
                official: same ? { output_id: same.output_id, display_name: same.display_name, muted: !!same.is_muted,
                  volume: same.volume || null } : null };
            }),
            devices: r.devices.slice(0, MAX_EACH).map((o) => ({ oid: String(o.oid), type: typeShort(o.typeName), members: shown(o) })),
          };
        }));
        if (!first) return out;
        // What moves (§14.1, 5): read again after a few seconds, outside the turn, on the same connection only. A
        // failure here is said under `moves`; the first read stands (the review).
        await new Promise((res) => { setTimeout(res, moveMs); });
        try {
          out.moves = await deps.inTurn(async () => {
            const s = deps.link ? deps.link.session() : null;
            if (s !== first.session) return { error: "The connection changed before the second read; run the probe again." };
            const now = snapshot(s.graph, first.watched.map((/** @type {any} */ o) => s.graph.get(o.oid)).filter(Boolean));
            const later = seeks();
            return Object.assign({ afterMs: moveMs, watched: first.watched.length }, moved(first.at, now), {
              // Paired by the zone's id, not its place in the list: zones come and go (the review).
              officialSeek: [...first.seek].slice(0, MAX_EACH).map(([id, was]) => ({ zone_id: id, was: was ?? null,
                now: later.has(id) ? later.get(id) ?? null : "gone" })) });
          });
        } catch (e) {
          out.moves = { error: "The second read failed: " + (e && /** @type {any} */ (e).message) };
        }
        log(`zones probe: ${out.zones.length} zone(s), ${out.endpoints.length} endpoint(s), ${out.devices.length} device(s); `
          + `${Array.isArray(out.moves.changed) ? out.moves.changed.length : 0} object(s) moved in ${moveMs} ms`);
        return out;
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createZoneProbe, moved };
