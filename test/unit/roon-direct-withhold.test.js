"use strict";
// v1.9.70-t9 (lib/roon-direct/withhold.js): what a debug answer never shows. The reads probe of v1.9.70-t4 walked from
// an album to the server's Roon account and its remote-access status, and printed the account's token, names and
// email, the home's external address and the machine's hardware address; the owner pasted it into a conversation.
// The values below are made up.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
// v1.9.70-t13: the owner's server as the reads probe gave it (2026-10-28). The remote-access status is the object
// "Mobile" (RemoteAccessStatus is only a number inside it), and its ReasonForNotReady is a JSON text carrying the home's
// external address; a streaming service's sign-in name is "Username". Both were shown. Made-up values.
test("THE one for t13: the server's Mobile object whole, and a streaming service's Username, are withheld", () => {
  const MOBILE = { object: "Mobile", oid: "35", members: { IsSupported: true, RemoteAccessStatus: 4, LocalIPAddress: "192.168.0.57",
    PhysicalAddress: "00:11:22:33:44:55", ExternalIPAddress: "203.0.113.9",
    ReasonForNotReady: '{"external_ip": {"actual_external_ip":"203.0.113.77"}}', CurrentPort: 55000 } };
  const TIDAL = { object: "Tidal", oid: "95", members: { LoginStatus: 4, Username: "someone.relay@example.com", SupportsMasters: true } };
  const QOBUZ = { object: "Qobuz", oid: "97", members: { LoginStatus: 2, UserName: "qobuz-handle" } };
  const out = withhold({ broker: { object: "Broker", members: { Mobile: MOBILE, Tidal: TIDAL, Qobuz: QOBUZ } } }), text = JSON.stringify(out);
  for (const s of ["203.0.113.77", "203.0.113.9", "someone.relay@example.com", "qobuz-handle", "55000", "192.168.0.57"]) assert.ok(!text.includes(s), "shown: " + s);
  const m = out.broker.members;
  assert.equal(m.Mobile.object, "Mobile", "what was withheld is still named");
  assert.equal(m.Tidal.members.LoginStatus, 4, "a service's state stays");
  assert.equal(m.Tidal.members.SupportsMasters, true);
});

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

// The suites run with no npm install (checks.yml), so no Express here: the middleware is driven as Express drives it,
// a request, a response whose json sends, and next. That only /api/debug goes through it is index.js's mounting, below.
test("THE one for the routes: the middleware withholds what the route answers, and the route is reached", () => {
  let sent = null, reached = 0;
  const res = { json(v) { sent = JSON.stringify(v); return this; } };
  withholdDebug({ path: "/roon-native-reads" }, res, () => { reached++; });
  assert.equal(reached, 1, "next: the route itself is reached");
  res.json(ANSWER);   // what the route answers
  assert.ok(sent && sent.includes("Blue"), sent);
  for (const s of SECRETS) assert.ok(!sent.includes(s), "the debug route showed " + s);
});

// Express runs what is mounted in order: a route mounted before the middleware would answer unwithheld.
test("index.js mounts the middleware before any route", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../index.js"), "utf8");
  const use = src.indexOf('app.use("/api/debug", withholdDebug);');
  assert.ok(use > 0, "the middleware is mounted, under /api/debug alone: an app's own answers are left as they are");
  assert.equal(src.split("withholdDebug").length - 1, 2, "required once and mounted once, nowhere else");
  const first = src.search(/\bapp\.(get|post|put|delete|all|route)\(|\bapp\.use\("\/api(?!\/debug", withholdDebug\))|\bmount\w*\(app\b|\.mount\(app\)/);
  assert.ok(first > use, "a route is mounted before it, at " + src.slice(first, first + 60));
});
