// @ts-check
"use strict";
/*
 * objects.js — the object graph the Core pushes: type declarations (DEFTYPE:
 * an id, a name, ordered members with their property types) and objects
 * (PUSHOBJ / PUSHSTUB / UPDATEOBJ: an object id, a type id, sparse fields).
 * Because DEFTYPE gives every member's property type, any pushed object can be
 * read without a type registered here.
 *
 * Ported from arthursoares/roon-api-reverse-engineering (MIT, see LICENSE),
 * commit 8b67208: roon-internal-api/src/proto/objects.ts (RemotingClientV2's
 * OnPushObj / OnPushStub / OnUpdateObj, TypeMappingHelper.DefineType,
 * PropertyMapping). One addition: the graph holds at most `maxObjects`
 * objects and stops taking more past it (`overflowed` says so) — a probe on a
 * large library must not grow Rouen's memory without bound.
 *
 * And one rule (v1.9.66-t6, dev/design/native-remote.md §15.4–15.6): a push that carries a Zone's `ZoneId`, or an
 * Endpoint's `EndpointId`, is the whole object, and a member it leaves out has gone back to its default — so it is
 * dropped, not kept from before (§14.2: a `State` left at Loading while the zone played). Proven on the owner's server
 * for those two types only; every other push still lays its fields over what is held.
 */
const { BinaryReader } = require("./wire");

/** The property types, in the Core's order (PropertyType). */
const P = Object.freeze({
  Int: 0, Long: 1, Bool: 2, Guid: 3, Sooid: 4, Double: 5, Float: 6, Char: 7, DateTime: 8, Enum: 9,
  NullableInt: 10, NullableLong: 11, NullableBool: 12, NullableGuid: 13, NullableSooid: 14,
  NullableDouble: 15, NullableFloat: 16, NullableChar: 17, NullableDateTime: 18, NullableEnum: 19,
  String: 20, ByteArray: 21, Message: 22, Object: 23, LengthPrefixed: 24,
});

/**
 * @typedef {{ id: number, name: string, members: Array<{ name: string, propType: number }> }} TypeDef
 * @typedef {{ oid: bigint, typeId: number, typeName: string, fields: Record<string, any>, loaded: boolean }} RoonObject
 *   loaded: pushed with its fields, of a type declared, at least once — a stub's have not come, where
 *   an object pushed with none (a sparse struct of defaults, a search that found nothing) has them all
 */

/** A reference to another object, as an Object-typed member holds it. @param {any} v @returns {v is { $ref: bigint }} */
function isRef(v) {
  return typeof v === "object" && v !== null && "$ref" in v;
}

/** The member that names an object for good, by its type's short name: a push carrying it is the whole object. */
const IDENTITY = Object.freeze(/** @type {Record<string, string>} */ ({ Zone: "ZoneId", Endpoint: "EndpointId" }));
/** A type's short name, its namespace left off. @param {string} t */
const shortType = (t) => t.replace(/^(?:Sooloos|Roon)\.Broker\.Api\./, "");
/** Whether these fields, pushed for this type, carry its identity member. @param {string} typeName @param {Record<string, any>} fields */
function carriesIdentity(typeName, fields) {
  const id = IDENTITY[shortType(typeName)];
  return !!id && Object.keys(fields).some((k) => k.endsWith("::" + id));
}

const DATALIST = /(?:^|\.)DataList<(.+)>$/;
const COLLECTION = /(^|\.)(DataList|Query|VirtualQuery)<|\.Query$/;
// DataList enum adapters the installed API reads with ReadInteger.
const INTEGER_ENUMS = ["DsdStrategy", "MediaSource", "TidalStreamFormat", "QobuzStreamFormat", "KKBoxStreamFormat", "NugsStreamFormat"];
/** @type {Record<string, number>} */
const PRIMITIVES = { string: P.String, int: P.Int, long: P.Long, double: P.Double, float: P.Float, "System.DateTime": P.DateTime };
/**
 * How a list's element of this type is read: a primitive as itself, an enum the reader names as an integer, anything
 * else as an Object (a reference, inline, or null). A DataList's (below) and a Focus list's (focus.js, v1.9.52).
 * @param {string} el  the element type, as declared ("Sooloos.Broker.Api.AlbumType", "string")
 * @param {readonly string[]} [enums]  the enums read as an integer, by short name; DataList's own by default
 */
function codecFor(el, enums = INTEGER_ENUMS) {
  if (PRIMITIVES[el] !== undefined) return PRIMITIVES[el];
  return enums.some((n) => el === `Sooloos.Broker.Api.${n}` || el === `Roon.Broker.Api.${n}`) ? P.Int : P.Object;
}

class ObjectGraph {
  /** @param {number} [maxObjects] */
  constructor(maxObjects = 200000) {
    /** @type {Map<number, TypeDef>} */
    this.types = new Map();
    /** @type {Map<string, RoonObject>} */
    this.objects = new Map();
    this.maxObjects = maxObjects;
    this.overflowed = false;
    /** Pushes that could not be read at all (their headers cut short). */
    this.decodeErrors = 0;
    /**
     * Told of every object pushed — new, updated or stubbed — so a caller can
     * watch for the ones it waits on without scanning the whole graph.
     * @type {(o: RoonObject) => void}
     */
    this.onObject = () => {};
    /**
     * Also told of every object pushed, for as long as they watch (v1.9.28): onObject belongs
     * to whichever read or heart is running, which sets it and puts it back; a watcher stays.
     * @type {Set<(o: RoonObject, pushed: Record<string, any>, cmd?: number) => void>}   pushed: the fields this push carried;
     *   cmd: its kind (PUSHOBJ 3, PUSHSTUB 4, UPDATEOBJ 5)
     */
    this.watchers = new Set();
  }

  /**
   * One pushed frame. True when it was a type or an object.
   * @param {import("./frame").Frame} frame
   */
  ingest(frame) {
    if (frame.isResponse) return false;
    const r = new BinaryReader(frame.body);
    try {
      switch (frame.cmd) {
        case 7: this.defineType(r); return true;        // DEFTYPE
        case 3: this.pushObj(r, true, 3); return true;     // PUSHOBJ
        case 4: this.pushObj(r, false, 4); return true;    // PUSHSTUB (no fields)
        case 5: this.pushObj(r, true, 5); return true;     // UPDATEOBJ
        default: return false;
      }
    } catch (e) {
      // A header cut short — a type's name or members, an object's id or type,
      // a query's count — so nothing of this push is stored (cut-short FIELDS
      // are caught inside pushObj, and the ones read before the cut are kept).
      // Counted rather than thrown: the probe reports decodeErrors, so a
      // "Count never arrived" can be read against a decode failure.
      this.decodeErrors++;
      return false;
    }
  }

  /** @param {BinaryReader} r */
  defineType(r) {
    const id = r.flexInt();
    const name = r.string() || "";
    const count = r.flexInt();
    const members = [];
    for (let i = 0; i < count; i++) members.push({ name: r.string() || "", propType: r.integer() });
    this.types.set(id, { id, name, members });
  }

  /**
   * @param {BinaryReader} r
   * @param {boolean} populate
   * @param {number} [cmd]  the push's kind, told to watchers (v1.9.66, native-remote.md §15.1): PUSHOBJ 3, PUSHSTUB 4, UPDATEOBJ 5
   */
  pushObj(r, populate, cmd) {
    const oid = r.long();
    const typeId = r.flexInt();
    const def = this.types.get(typeId);
    const typeName = def ? def.name : `#${typeId}`;
    /** @type {Record<string, any>} */
    const fields = {};
    // Every member read to its end: a push cut short is never taken for the whole object (§15.6).
    let complete = true;
    if (populate && def) {
      const dl = DATALIST.exec(typeName);
      if (dl) {
        // DataList<T>: a count, then T values; replaces the list on every push.
        const el = dl[1];
        const codec = codecFor(el);
        const count = r.integer();
        const items = [];
        for (let i = 0; i < count && r.remaining > 0; i++) {
          try { items.push(this.readValue(r, codec)); } catch (e) { break; }   // cut short: keep what was read
        }
        fields.$count = items.length === count ? count : -1;   // -1: not all of it arrived
        fields.$items = items;
      } else if (COLLECTION.test(typeName)) {
        // Query<T>: a built-in count property at index 1, 0 ends, then the items.
        let count = 0;
        for (;;) {
          const idx = r.flexInt();
          if (idx === 0) break;
          if (idx === 1) count = r.integer();
          else break;
        }
        const items = [];
        for (let i = 0; i < count && r.remaining > 0; i++) {
          try { items.push(this.readValue(r, P.Object)); } catch (e) { break; }   // items may follow later, by oid
        }
        fields.$count = count;
        fields.$items = items;
      } else {
        // Sparse fields: a 1-based member index (0 ends), then its value.
        for (;;) {
          const idx = r.flexInt();
          if (idx === 0) break;
          const m = def.members[idx - 1];
          if (!m) { complete = false; break; }   // an index this type does not have: nothing after it can be read
          try { fields[m.name] = this.readValue(r, m.propType); } catch (e) { complete = false; break; }   // cut short: keep what was read
        }
      }
    }
    const key = oid.toString();
    const known = this.objects.get(key);
    if (known) {
      if (populate) {
        // A whole Zone or Endpoint: what it leaves out is at its default, so it goes (§15.4). The same fields object
        // is kept, emptied and filled, for any reader holding it.
        if (complete && carriesIdentity(typeName, fields)) for (const k of Object.keys(known.fields)) if (!(k in fields)) delete known.fields[k];
        Object.assign(known.fields, fields);
        known.loaded = known.loaded || !!def;   // a stub never erases a loaded object
      }
      this.onObject(known);
      for (const w of this.watchers) w(known, fields, cmd);
      return;
    }
    if (this.objects.size >= this.maxObjects) { this.overflowed = true; return; }
    const o = { oid, typeId, typeName, fields, loaded: populate && !!def };
    this.objects.set(key, o);
    this.onObject(o);
    for (const w of this.watchers) w(o, fields, cmd);
  }

  /**
   * @param {BinaryReader} r
   * @param {number} t
   * @returns {any}
   */
  readValue(r, t) {
    switch (t) {
      case P.Int: case P.Char: case P.Enum: return r.integer();
      case P.Long: case P.DateTime: return r.long();
      case P.Bool: return r.boolean();
      case P.Guid: return r.guid();
      case P.Sooid: return r.sooid();
      case P.Double: return r.double();
      case P.Float: return r.float();
      case P.NullableInt: case P.NullableChar: case P.NullableEnum: return r.optionalInteger();
      case P.NullableLong: case P.NullableDateTime: return r.optionalLong();
      case P.NullableBool: return r.optionalBoolean();
      case P.NullableGuid: return r.optionalGuid();
      case P.NullableSooid: return r.optionalSooid();
      case P.NullableDouble: return r.optionalDouble();
      case P.NullableFloat: return r.optionalFloat();
      case P.String: return r.string();
      case P.ByteArray: case P.Message: return r.byteArray();
      case P.LengthPrefixed: return r.bytes(r.integer());
      case P.Object: {
        const marker = r.long();
        if (marker === 1n) {
          // an inline value object: type id, length, its sparse fields
          const tid = r.integer();
          const sub = new BinaryReader(r.bytes(r.integer()));
          const def = this.types.get(tid);
          if (!def) return { $inline: tid };
          /** @type {Record<string, any>} */
          const obj = { $type: def.name };
          for (;;) {
            const idx = sub.flexInt();
            if (idx === 0) break;
            const m = def.members[idx - 1];
            if (!m) break;
            obj[m.name] = this.readValue(sub, m.propType);
          }
          return obj;
        }
        return marker === 0n ? null : { $ref: marker };
      }
      default: throw new Error(`unknown property type ${t}`);
    }
  }

  /** @param {bigint} oid */
  get(oid) { return this.objects.get(oid.toString()); }

  /**
   * Drops an object from this side's copy of the graph — never from the
   * Core's (§3: nothing here releases a pushed object there). Stage 1 drops
   * each page's albums once read, so a whole library stays well under the cap.
   * An object the Core pushes again later simply arrives anew.
   * @param {bigint} oid
   */
  forget(oid) { this.objects.delete(oid.toString()); }

  /** Every object whose type is this short name. @param {string} short */
  ofType(short) {
    const tail = "." + short;
    return [...this.objects.values()].filter((o) => o.typeName === short || o.typeName.endsWith(tail));
  }
}

/**
 * A member read by the end of its full name ("…::Count"): the Core names
 * members "type Namespace.Type::Member".
 * @param {RoonObject | undefined} o
 * @param {string} member
 */
function field(o, member) {
  if (!o) return undefined;
  const tail = "::" + member;
  for (const k of Object.keys(o.fields)) if (k.endsWith(tail)) return o.fields[k];
  return undefined;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Polls `read` until it gives a value or `ms` runs out: how the probe waits
 * on what the Core pushes into the graph.
 * @template T
 * @param {number} ms
 * @param {() => T | undefined} read
 * @returns {Promise<T | undefined>} the value, or undefined when time ran out
 */
async function waitFor(ms, read) {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() >= end) return undefined;
    await sleep(50);
  }
}

/** A pushed value made printable: a long as a number, bytes as hex. @param {any} v */
const plain = (v) => (typeof v === "bigint" ? Number(v) : Buffer.isBuffer(v) ? v.toString("hex") : v);

/**
 * An Image's broker key: the Image as a value (a reference, or inline) has a Url of the form
 * broker:///image/<key>.<ext> (deep-roon-mcp's reading) — an album's Image (locations.js imageKeyOf), or one of a
 * playlist's Images (playlists.js imagesOf). Moved here from locations.js in v1.9.59, unchanged.
 * @param {ObjectGraph} graph @param {any} v
 * @returns {string | null}
 */
function imageKeyFrom(graph, v) {
  const img = isRef(v) ? graph.get(v.$ref) : v;
  if (!img) return null;
  const url = img.fields ? field(img, "Url") : Object.keys(img).filter((k) => k.endsWith("::Url")).map((k) => img[k])[0];
  const m = /^broker:\/\/\/image\/([^.]+)\./.exec(String(url || ""));
  return m ? m[1] : null;
}

module.exports = { ObjectGraph, P, isRef, field, plain, sleep, waitFor, codecFor, imageKeyFrom, IDENTITY, carriesIdentity, shortType };
