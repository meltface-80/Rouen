"use strict";
// ---------------------------------------------------------------------------
// A Rouen profile becomes a Roon profile (dev/design/profiles.md §13.2, P3b, 2.0.8-t3; lib/roon-direct/profile-write.js,
// lib/profiles/routes.js). The owner, 2026-11-26: "A Rouen profile becomes a Roon profile." Account::CreateProfile and
// Profile::Edit were proven on the owner's server by the P3-probe; the server here is a stand-in that does what it is
// asked, or, for the review's cases, does not. It is not evidence of what Roon does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProfileWriter } = require("../../lib/roon-direct/profile-write");
const { liveProfiles, profileFor, profilesOf } = require("../../lib/roon-direct/session");
const { SIG } = require("../../lib/roon-direct/methods");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { Database, world, routes } = require("../lib/profiles-world");

const PID = "System.Sooid Sooloos.Broker.Api.Profile::ProfileId", PNAME = "string Sooloos.Broker.Api.Profile::Name";
const P = (oid, id, name) => ({ oid, typeName: "Sooloos.Broker.Api.Profile", loaded: true, fields: { [PID]: Buffer.from(id, "hex"), [PNAME]: name } });

/** A server holding MENZIES, whose Account lists its profiles. @param {{ refuse?: boolean, noBack?: boolean, ignoreEdit?: boolean, noAccount?: boolean }} [o] */
function server(o = {}) {
  const objects = new Map();
  const put = (x) => objects.set(x.oid.toString(), x);
  const list = { oid: 10n, typeName: "System.Collections.Generic.IList", loaded: true, fields: { $items: [{ $ref: 2n }] } };
  [P(2n, "cafebabe", "MENZIES"), list].forEach(put);
  if (!o.noAccount) put({ oid: 9n, typeName: "Sooloos.Broker.Api.Account", loaded: true, fields: { "x Sooloos.Broker.Api.Account::Profiles": { $ref: 10n } } });
  const graph = { get: (oid) => objects.get(oid.toString()), ofType: (t) => [...objects.values()].filter((x) => x.typeName.endsWith("." + t)) };
  const sent = [];
  let next = 40n;
  const g = { uncertain: () => "", defineType: () => 7, call: async (oid, sig, args) => {
    sent.push({ oid, sig });
    if (sig === SIG.createProfile) {
      if (o.refuse) return { success: false, status: "Unauthorized" };
      const oid2 = next++;
      if (!o.noBack) { put(P(oid2, "0abc" + String(oid2), "made")); list.fields.$items.push({ $ref: oid2 }); }
      return { success: true, status: "Success", payload: new BinaryWriter().long(oid2).toBuffer() };
    }
    if (sig === SIG.editProfile) { if (!o.ignoreEdit) objects.get(oid.toString()).fields[PNAME] = "renamed"; return { success: true, status: "Success" }; }
    throw new Error("not expected " + sig);
  } };
  const s = { g, graph, root: { profiles: [P(2n, "cafebabe", "MENZIES")], profileId: Buffer.from("cafebabe", "hex") } };
  return { s, sent, objects };
}
const writer = (srv, on = true) => createProfileWriter({ link: { session: () => srv.s }, inTurn: (fn) => fn(), on: () => on, timeoutMs: 60 });

test("THE one: a profile made in Roon is on the list every write reads at once, so none of its writes goes to the server's first", async () => {
  const srv = server();
  const made = await writer(srv).create("Test");
  assert.deepEqual(made, { id: "0abc40", name: "made" });
  assert.equal(srv.sent[0].oid, 9n, "on the Account");
  assert.deepEqual(profilesOf(srv.s.root).map((p) => p.id), ["cafebabe", "0abc40"], "THE one: the root's list, read at connect, kept");
  assert.equal(profileFor(srv.s.root, "0abc40").toString("hex"), "0abc40", "a write for it went to MENZIES");
  // A profile made in Roon's own app (pushed onto the Account's list) is read the same way.
  srv.objects.set("50", P(50n, "0def", "Kid"));
  srv.objects.get("10").fields.$items.push({ $ref: 50n });
  assert.deepEqual(liveProfiles(srv.s).map((p) => p.fields[PNAME]), ["MENZIES", "made", "Kid"]);
});

test("the review: refused, never sent back, renamed and not shown, native mode not in use, no Account: each said, never believed", async () => {
  assert.deepEqual(await writer(server({ refuse: true })).create("Test"), { error: 'Roon refused the new profile ("Unauthorized").' });
  assert.match((await writer(server({ noBack: true })).create("Test")).error, /didn't send the profile back/);
  assert.match((await writer(server(), false).create("Test")).notSent, /Native mode isn't in use/);
  assert.match((await writer(server({ noAccount: true })).create("Test")).notSent, /no Account/);
  const srv = server();
  assert.deepEqual(await writer(srv).rename("cafebabe", "renamed"), { ok: true });
  assert.equal(srv.sent.at(-1).oid, 2n, "on the Profile");
  assert.match((await writer(server({ ignoreEdit: true })).rename("cafebabe", "renamed")).error, /didn't show it/);
  assert.match((await writer(server()).rename("00ff", "x")).notSent, /isn't on your server/);
  const same = server();
  assert.deepEqual(await writer(same).rename("cafebabe", "MENZIES"), { ok: true });
  assert.equal(same.sent.length, 0, "a rename to the name it has, sent");
});

/** The routes over a stand-in Roon side: its profiles, and a create/rename that do or refuse as told. */
function side(o = {}) {
  const profiles = [{ id: "cafebabe", name: "MENZIES" }];
  const asked = [];
  return { asked, profiles, fn: () => ({ profiles, reread() {},
    create: async (name) => { asked.push(["create", name]); if (o.refuse) return { error: "Roon refused the new profile (\"Unauthorized\")." }; const id = "0a" + (profiles.length + 1); profiles.push({ id, name }); return { id, name }; },
    rename: async (id, name) => { asked.push(["rename", id, name]); return o.refuse ? { error: "Roon refused the new name." } : { ok: true }; } }) };
}

test("THE one for the owner: a profile added in Rouen is made in Roon and paired; Roon refusing it, none is added", { skip: !Database }, async () => {
  const w = world();
  const sd = side();
  const { ask, call } = routes(w, sd.fn);
  w.profiles.setRoon(w.profiles.first().id, "cafebabe");
  const r = await ask("POST /api/profiles", { body: { name: "Test" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.inRoon, true);
  assert.deepEqual(sd.asked, [["create", "Test"]]);
  assert.equal(w.profiles.get(r.body.added).roon_profile, "0a2", "THE one: added in Rouen and not made in Roon");
  assert.equal(call("GET /api/profiles").body.profiles.length, 2, "made twice: the new Roon profile added again by the sync");
  const before = w.profiles.list().length;
  const no = routes(w, side({ refuse: true }).fn);
  assert.deepEqual(await no.ask("POST /api/profiles", { body: { name: "Kid" } }), { status: 502, body: { error: "Roon refused the new profile (\"Unauthorized\")." }, headers: {} });
  assert.equal(w.profiles.list().length, before, "added in Rouen though Roon refused it");
  const sd2 = side();
  assert.equal((await routes(w, sd2.fn).ask("POST /api/profiles", { body: { name: "guest" } })).status, 400);
  assert.deepEqual(sd2.asked, [], "a name Rouen refuses was made in Roon");
  // Native mode not in use: made in Rouen, paired later.
  const off = routes(w, () => null);
  const k = off.call("POST /api/profiles", { body: { name: "Lee" } });
  assert.deepEqual([k.status, w.profiles.get(k.body.added).roon_profile, k.body.inRoon], [200, null, false]);
});

test("§13.2 P3b: an unpaired profile made in Roon under its name; a paired one renamed in Roon first, a refusal writing nothing", { skip: !Database }, async () => {
  const w = world();
  const sd = side();
  const { ask } = routes(w, sd.fn);
  const first = w.profiles.first().id;
  let r = await ask("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "create" } });
  assert.equal(r.status, 200);
  assert.equal(w.profiles.get(first).roon_profile, "0a2");
  assert.deepEqual(sd.asked, [["create", "Alex"]]);
  r = await ask("POST /api/profiles/:id", { params: { id: first }, body: { name: "Me" } });
  assert.deepEqual([r.status, w.profiles.get(first).name], [200, "Me"]);
  assert.deepEqual(sd.asked.at(-1), ["rename", "0a2", "Me"], "THE one: renamed in Rouen, not in Roon");
  const no = routes(w, side({ refuse: true }).fn);
  w.profiles.setRoon(first, "cafebabe");
  r = await no.ask("POST /api/profiles/:id", { params: { id: first }, body: { name: "Lewis" } });
  assert.deepEqual([r.status, w.profiles.get(first).name], [502, "Me"], "renamed in Rouen though Roon refused it");
  r = await no.ask("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "create" } });
  assert.deepEqual([r.status, w.profiles.get(first).roon_profile], [502, "cafebabe"], "a refused create changed the pairing");
  const off = routes(w, () => null);
  assert.equal(off.call("POST /api/profiles/:id", { params: { id: first }, body: { roonProfile: "create" } }).status, 400, "made with native mode not in use");
});
