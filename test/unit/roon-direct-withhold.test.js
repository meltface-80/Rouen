"use strict";
// v1.9.70-t9 (lib/roon-direct/withhold.js): what a debug answer never shows. The reads probe of v1.9.70-t4 walked from
// an album to the server's Roon account and its remote-access status, and printed the account's token, names and
// email, the home's external address and the machine's hardware address; the owner pasted it into a conversation.
// The values below are made up.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { withhold, withholdDebug, WITHHELD } = require("../../lib/roon-direct/withhold");

const SECRETS = ["tok-abc123", "someone@example.com", "Firstname", "Lastname", "user-42", "203.0.113.9", "00:11:22:33:44:55",
  "hunter2", "someone-handle", "54321"];
// As the reads probe gave them, under whole()'s shape: each object its type, oid and members.
const ACCOUNT = { object: "Account", oid: "901", members: { UserId: "user-42", Token: "tok-abc123", FirstName: "Firstname", LastName: "Lastname",
  Email: "someone@example.com", UserName: "someone-handle", IsVerified: true, Avatar: "" } };
const REMOTE = { object: "RemoteAccessStatus", oid: "902", members: { IsSupported: true, LocalIPAddress: "192.168.0.57",
  PhysicalAddress: "00:11:22:33:44:55", ExternalIPAddress: "203.0.113.9", ExternalPort: 54321 } };
const ANSWER = { ran: true, steps: [{ album: { object: "AlbumLite", members: { Title: "Blue" } } },
  { broker: { object: "Broker", members: { Accounts: { items: [{ object: "AccountStatus", members: { Account: ACCOUNT, IsLoggedIn: true } }] },
    Remote: REMOTE, Devices: [{ Name: "TV Speaker", IPAddress: "192.168.0.20" }], ApiPassword: "hunter2", AccessToken: null,
    IsTokenValid: false, RefreshToken: "" } } }],
  // The push recorder's change list (push-log.js): a member's name, its value beside it.
  changed: [{ name: "Email", v: "someone@example.com" }, { name: "Volume", v: 30 }] };

test("THE one: the account and the home's addresses withheld wherever they sit; the rest as it was", () => {
  const out = withhold(ANSWER), text = JSON.stringify(out);
  for (const s of SECRETS) assert.ok(!text.includes(s), "shown: " + s);
  const status = out.steps[1].broker.members.Accounts.items[0];
  assert.deepEqual(status.members.Account, { object: "Account", oid: "901", members: { UserId: WITHHELD, Token: WITHHELD, FirstName: WITHHELD,
    LastName: WITHHELD, Email: WITHHELD, UserName: WITHHELD, IsVerified: true, Avatar: "" } }, "every member of an account, by its type, whatever its name");
  assert.equal(status.members.IsLoggedIn, true, "the status around the account stays");
  const remote = out.steps[1].broker.members.Remote.members;
  assert.deepEqual(remote, { IsSupported: true, LocalIPAddress: WITHHELD, PhysicalAddress: WITHHELD, ExternalIPAddress: WITHHELD, ExternalPort: WITHHELD });
  const broker = out.steps[1].broker.members;
  assert.equal(broker.Devices[0].IPAddress, "192.168.0.20", "a device's LAN address is kept: finding it needs it");
  assert.equal(broker.ApiPassword, WITHHELD);
  assert.deepEqual([broker.AccessToken, broker.IsTokenValid, broker.RefreshToken], [null, false, ""],
    "whether a token is set, valid or empty is worth seeing: only a value that says something is withheld");
  assert.deepEqual(out.changed, [{ name: "Email", v: WITHHELD }, { name: "Volume", v: 30 }]);
  assert.equal(out.steps[0].album.members.Title, "Blue");
  assert.equal(ANSWER.steps[1].broker.members.Remote.members.ExternalIPAddress, "203.0.113.9", "the answer itself untouched: a copy is withheld");
});

// The review of t9's first form: the type as every probe names it; Rouen's own fields and an album's name left alone.
test("an account however a probe names its type; a date or bytes in it too; Rouen's own fields and names stay", () => {
  const out = withhold({
    recorded: { object: 'Account "901"', members: { UserName: "someone-handle" } },   // settings-probe.js entry()
    struct: { struct: "Account", Email: "someone@example.com" },                     // smart-probe.js describe()
    deep: { $type: "Sooloos.Broker.Api.RemoteAccessStatus", ExternalPort: 54321 },   // deep-value.js
    dated: { object: "Account", members: { Since: new Date(0), Raw: Buffer.from("tok-abc123") } },
    qobuz: { results: [{ token: "this app's login", album_read: true }] },           // index.js's Qobuz probe: a label
    album: { name: "Secret Machines", value: 12 }, setting: { name: "Secret Mode", now: "on" },
  });
  assert.deepEqual(out.recorded.members, { UserName: WITHHELD });
  assert.deepEqual([out.struct.struct, out.struct.Email, out.deep.$type, out.deep.ExternalPort],
    ["Account", WITHHELD, "Sooloos.Broker.Api.RemoteAccessStatus", WITHHELD]);
  assert.deepEqual(out.dated.members, { Since: WITHHELD, Raw: WITHHELD });
  assert.deepEqual(out.qobuz, { results: [{ token: "this app's login", album_read: true }] }, "Rouen's own lowercase field is its own");
  assert.deepEqual([out.album.value, out.setting.now], [12, "on"], "an album's or a setting's name is not a member's");
});

test("an object met twice is shown twice; a cycle is cut; toJSON is honoured, as JSON would", () => {
  const shared = { Name: "Rock" };
  assert.deepEqual(withhold({ a: shared, b: [shared] }), { a: { Name: "Rock" }, b: [{ Name: "Rock" }] });
  const loop = { Name: "x" }; loop.self = loop;
  assert.deepEqual(withhold(loop), { Name: "x", self: "(a cycle)" });
  assert.deepEqual(withhold({ id: { toJSON: () => ({ Token: "tok-abc123", n: "7" }) } }), { id: { Token: WITHHELD, n: "7" } });
});

test("THE one for the routes: every answer under /api/debug withheld, any other untouched, the next handler reached", async (t) => {
  const app = express();
  app.use("/api/debug", withholdDebug);
  const mw = [];
  app.get("/api/debug/roon-native-reads", (req, res, next) => { mw.push("middleware"); next(); }, (req, res) => res.json(ANSWER));
  app.get("/api/status", (req, res) => res.json({ Token: "tok-abc123" }));
  const server = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const debug = await (await fetch(base + "/api/debug/roon-native-reads", { signal: AbortSignal.timeout(3000) })).text();
  assert.deepEqual(mw, ["middleware"], "a route's own middleware still reaches its next");
  assert.ok(debug.includes("Blue"), debug);
  for (const s of SECRETS) assert.ok(!debug.includes(s), "the debug route showed " + s);
  assert.equal(await (await fetch(base + "/api/status", { signal: AbortSignal.timeout(3000) })).text(), JSON.stringify({ Token: "tok-abc123" }), "an app's own answer is left as it is");
});

// Express runs what is mounted in order: a route mounted before the middleware would answer unwithheld.
test("index.js mounts the middleware before any route", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../index.js"), "utf8");
  const use = src.indexOf('app.use("/api/debug", withholdDebug);');
  assert.ok(use > 0, "the middleware is mounted");
  const first = src.search(/\bapp\.(get|post|put|delete|all|route)\(|\bapp\.use\("\/api(?!\/debug", withholdDebug\))|\bmount\w*\(app\b|\.mount\(app\)/);
  assert.ok(first > use, "a route is mounted before it, at " + src.slice(first, first + 60));
});
