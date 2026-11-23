// @ts-check
"use strict";
/*
 * sqlite-compat.js — Rouen's database where better-sqlite3 can't be built: Node's own node:sqlite behind the calls of
 * better-sqlite3's that Rouen makes (Rouen Lite, dev/design/rouen-lite.md §3.1). better-sqlite3 is a native module
 * built for Linux and Windows; Android has no build of it, and Node 22.5 and later carry SQLite of their own.
 *
 *   openDatabaseModule()  better-sqlite3 where it loads (Docker, Windows: unchanged), else this adapter; null where
 *                         neither is there (the cache then lives in memory, as before)
 *
 * The calls covered, as better-sqlite3 answers them: new Database(file); db.prepare(sql) → run (→ { changes,
 * lastInsertRowid }), get, all, iterate, raw(); db.exec(sql); db.pragma("x = y") (→ rows, or the value with
 * { simple: true }); db.transaction(fn) → a function running fn in a transaction (a savepoint inside another), rolled
 * back when fn throws; db.close(). Parameters as better-sqlite3 takes them: positional, or one object whose names the
 * SQL writes @name, :name or $name; undefined is bound as NULL.
 */

/** @typedef {{ run: Function, get: Function, all: Function, iterate: Function, setReturnArrays?: Function, setAllowBareNamedParameters?: Function }} NodeStatement */

/** better-sqlite3's Database class, over node:sqlite's DatabaseSync. @param {any} sqlite  require("node:sqlite") */
function adapterOver(sqlite) {
  /** Parameters as node:sqlite binds them: undefined as NULL, as better-sqlite3 has bound it. @param {any[]} params */
  const bind = (params) => params.map((p) => {
    if (p === undefined) return null;
    if (p && typeof p === "object" && !Buffer.isBuffer(p) && !(p instanceof Uint8Array)) {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [k, v] of Object.entries(p)) out[k] = v === undefined ? null : v;
      return out;
    }
    return p;
  });

  /**
   * A row as better-sqlite3 gives it: a plain object (node:sqlite's have no prototype, so `row.hasOwnProperty` and a
   * strict comparison with an object literal would differ), or an array as raw() asks.
   * @param {any} row
   */
  const plain = (row) => (row && typeof row === "object" && !Array.isArray(row) ? Object.assign({}, row) : row);

  class Statement {
    /** @param {NodeStatement} st */
    constructor(st) {
      this.st = st;
      // Names written @name, :name or $name, given bare in an object, as better-sqlite3 takes them.
      if (st.setAllowBareNamedParameters) st.setAllowBareNamedParameters(true);
    }
    /** @param {...any} p */
    run(...p) { const r = this.st.run(...bind(p)); return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }; }
    /** @param {...any} p */
    get(...p) { return plain(this.st.get(...bind(p))); }
    /** @param {...any} p */
    all(...p) { return this.st.all(...bind(p)).map(plain); }
    /** @param {...any} p */
    *iterate(...p) { for (const row of this.st.iterate(...bind(p))) yield plain(row); }
    /** Rows as arrays, not objects. @param {boolean} [on] */
    raw(on = true) {
      if (!this.st.setReturnArrays) throw new Error("This Node's SQLite can't return rows as arrays");
      this.st.setReturnArrays(on);
      return this;
    }
  }

  class Database {
    /** @param {string} file */
    constructor(file) {
      this.db = new sqlite.DatabaseSync(file);
      this.saved = 0;
    }
    /** @param {string} sql */
    prepare(sql) { return new Statement(this.db.prepare(sql)); }
    /** @param {string} sql */
    exec(sql) { this.db.exec(sql); return this; }
    /** @param {string} p @param {{ simple?: boolean }} [o] */
    pragma(p, o = {}) {
      const rows = this.db.prepare("PRAGMA " + p).all().map(plain);
      if (!o.simple) return rows;
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    }
    /**
     * A function running fn in a transaction: committed when fn returns, rolled back when it throws; inside another,
     * a savepoint, as better-sqlite3 nests them.
     * @template {(...a: any[]) => any} F @param {F} fn @returns {F}
     */
    transaction(fn) {
      const self = this;
      return /** @type {F} */ (function (/** @type {any[]} */ ...args) {
        // Whether one is open, as SQLite says it (the review: a count of our own went wrong after a failed COMMIT).
        const nested = self.db.isTransaction;
        const name = "rouen_sp" + (++self.saved);
        self.db.exec(nested ? "SAVEPOINT " + name : "BEGIN");
        let r;
        try {
          r = fn.apply(this, args);
        } catch (e) {
          // SQLite may have rolled back itself (a full disk): undone only while there is something to undo.
          if (self.db.isTransaction) self.db.exec(nested ? "ROLLBACK TO " + name + "; RELEASE " + name : "ROLLBACK");
          throw e;
        }
        try {
          self.db.exec(nested ? "RELEASE " + name : "COMMIT");
        } catch (e) {
          // A COMMIT refused (a deferred constraint): nothing of it kept, and the database left out of a transaction.
          if (!nested && self.db.isTransaction) self.db.exec("ROLLBACK");
          throw e;
        }
        return r;
      });
    }
    close() { this.db.close(); return this; }
  }
  return Database;
}

/**
 * The database module: better-sqlite3 where it loads, else node:sqlite behind the adapter, else null.
 * @param {(name: string) => any} [load]  require, or the tests' stand-in
 */
function openDatabaseModule(load = require) {
  try { return load("better-sqlite3"); }
  catch (e) {
    // Rouen Lite has none by design; anywhere else, a better-sqlite3 that won't load is worth saying (the review).
    if (process.env.ROUEN_LITE !== "1") console.warn("[db] better-sqlite3 couldn't load (" + String(e && /** @type {any} */ (e).message) + "): Node's own SQLite instead");
  }
  try {
    // Node marks its SQLite experimental and says so once on stderr; Rouen's log needn't carry it every start.
    const emit = process.emitWarning;
    process.emitWarning = /** @type {any} */ ((/** @type {any} */ w, /** @type {any[]} */ ...rest) => {
      if (String(w && w.message ? w.message : w).includes("SQLite is an experimental feature")) return;
      return emit.call(process, w, ...rest);
    });
    try { return adapterOver(load("node:sqlite")); }
    finally { process.emitWarning = emit; }
  } catch (e) {
    return null;   // neither: the cache lives in memory, as index.js says when it finds no database
  }
}

module.exports = { openDatabaseModule, adapterOver };
