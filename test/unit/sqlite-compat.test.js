"use strict";
/*
 * Rouen's database on Node's own SQLite (Rouen Lite, dev/design/rouen-lite.md §3.1): lib/sqlite-compat.js answers
 * better-sqlite3's calls as better-sqlite3 does; and every suite written against better-sqlite3 runs, unchanged, on
 * node:sqlite behind it (test/lib/sqlite-as-better.js), none skipped.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { openDatabaseModule, adapterOver } = require("../../lib/sqlite-compat");

const Database = adapterOver(require("node:sqlite"));

test("better-sqlite3's calls, as it answers them", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT, v INTEGER)");
  const ins = db.prepare("INSERT INTO t (k, v) VALUES (@k, $v)");
  assert.deepEqual(ins.run({ k: "a", v: 1 }), { changes: 1, lastInsertRowid: 1 });
  db.prepare("INSERT INTO t (k, v) VALUES (:k, ?)");
  db.prepare("INSERT INTO t (k, v) VALUES (?, ?)").run("b", undefined);
  const row = db.prepare("SELECT k, v FROM t WHERE k = ?").get("b");
  assert.deepEqual(row, { k: "b", v: null }, "undefined bound as NULL; a plain object, as better-sqlite3's");
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(db.prepare("SELECT k FROM t WHERE k = ?").get("zz"), undefined);
  assert.deepEqual(db.prepare("SELECT k FROM t ORDER BY id").all(), [{ k: "a" }, { k: "b" }]);
  assert.deepEqual([...db.prepare("SELECT k FROM t ORDER BY id").iterate()], [{ k: "a" }, { k: "b" }]);
  assert.deepEqual(db.prepare("SELECT k, v FROM t ORDER BY id").raw().all(), [["a", 1], ["b", null]]);
  assert.equal(db.prepare("UPDATE t SET v = 2").run().changes, 2);
  assert.equal(db.pragma("user_version", { simple: true }), 0);
  assert.ok(Array.isArray(db.pragma("table_info(t)")));
});

test("a transaction: committed, rolled back when it throws, and a savepoint inside another", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (k TEXT)");
  const add = db.prepare("INSERT INTO t VALUES (?)");
  const count = () => db.prepare("SELECT COUNT(*) AS n FROM t").get().n;
  assert.equal(db.transaction((k) => { add.run(k); return "done"; })("a"), "done");
  assert.equal(count(), 1);
  assert.throws(() => db.transaction(() => { add.run("b"); throw new Error("no"); })(), /no/);
  assert.equal(count(), 1, "rolled back");
  db.transaction(() => {
    add.run("c");
    assert.throws(() => db.transaction(() => { add.run("d"); throw new Error("inner"); })());
    add.run("e");
  })();
  assert.deepEqual(db.prepare("SELECT k FROM t ORDER BY rowid").all().map((r) => r.k), ["a", "c", "e"], "the inner one alone undone");
});

test("a COMMIT refused leaves no transaction open, and the next ones work (the review)", () => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (pid INTEGER REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED)");
  // A deferred foreign key is checked at COMMIT: the COMMIT itself fails.
  assert.throws(() => db.transaction(() => { db.prepare("INSERT INTO c VALUES (42)").run(); })(), /FOREIGN KEY/);
  assert.equal(db.db.isTransaction, false, "rolled back, not left open");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM c").get().n, 0);
  assert.equal(db.transaction(() => db.transaction(() => 1)())(), 1, "a nested one after it works");
});

test("the module: better-sqlite3 where it loads, else node:sqlite behind the adapter, else none", () => {
  const real = { real: true };
  assert.equal(openDatabaseModule((n) => (n === "better-sqlite3" ? real : require(n))), real, "Docker and Windows: unchanged");
  const lite = openDatabaseModule((n) => { if (n === "better-sqlite3") throw new Error("no build for Android"); return require(n); });
  assert.equal(typeof lite, "function");
  assert.equal(new lite(":memory:").prepare("SELECT 1 AS a").get().a, 1);
  assert.equal(openDatabaseModule(() => { throw new Error("nothing"); }), null);
});

test("every suite written against better-sqlite3 passes on node:sqlite behind the adapter, none skipped", () => {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js") && f !== path.basename(__filename))
    .filter((f) => /require\("better-sqlite3"\)/.test(fs.readFileSync(path.join(dir, f), "utf8")))
    .map((f) => path.join(dir, f));
  assert.ok(files.length >= 8, "the suites that use the database: " + files.length);
  const r = spawnSync(process.execPath, ["--require", path.join(__dirname, "..", "lib", "sqlite-as-better.js"), "--test",
    "--test-reporter=tap", ...files], { encoding: "utf8", timeout: 120000,
    // A test run of its own: the runner's context, inherited, would make it report to this one instead of printing.
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")) });
  const n = (what) => Number((new RegExp("^# " + what + " (\\d+)$", "m").exec(r.stdout) || [])[1]);
  assert.equal(n("fail"), 0, r.stdout.split("\n").filter((l) => /^not ok/.test(l)).join("\n"));
  assert.equal(n("skipped"), 0, "a suite skipped: it didn't get the database");
  assert.ok(n("pass") >= 100, "they ran: " + n("pass"));
});
