"use strict";
// ---------------------------------------------------------------------------
// P3-probe (lib/roon-direct/profile-probe.js, dev/design/profiles.md §13.6): a Roon profile made
// (Account::CreateProfile) and renamed (Profile::Edit), tried once by hand, with a read-only count of whose playlists
// the connection holds. The server here is a stand-in that does what it is asked (or, for the review's cases, does
// not); it is not evidence of what Roon does — the owner's run is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProfileProbe } = require("../../lib/roon-direct/profile-probe");
const { SIG, ALLOWED } = require("../../lib/roon-direct/methods");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { PROFILE_CREATE, PROFILE_EDIT } = require("../../lib/roon-direct/schemas");

const ID = (h) => Buffer.from(h, "hex");
const P = (oid, id, name) => ({ oid, typeName: "Sooloos.Broker.Api.Profile", loaded: true,
  fields: { "System.Sooid Sooloos.Broker.Api.Profile::ProfileId": ID(id), "string Sooloos.Broker.Api.Profile::Name": name } });
const PL = (oid, profileOid) => ({ oid, typeName: "Sooloos.Broker.Api.Playlist", loaded: true,
  fields: Object.assign({ "System.Sooid Sooloos.Broker.Api.Playlist::PlaylistId": ID("aa" + String(oid)) },
    profileOid === undefined ? {} : { "Sooloos.Broker.Api.Profile Sooloos.Broker.Api.Playlist::Profile": { $ref: profileOid } }) });

/** @param {{ refuse?: boolean, noProfileSent?: boolean, namesNone?: boolean, ignoreEdit?: boolean, refuseEdit?: boolean, noAccount?: boolean, throwCreate?: boolean, noSession?: boolean, off?: string, throwEdit?: boolean, listNotSent?: boolean, accountList?: boolean, twins?: boolean, reconnect?: boolean }} [o] */
function rig(o = {}) {
  const objects = new Map();
  const put = (x) => objects.set(x.oid.toString(), x);
  [P(2n, "cafebabe", "Owner"), P(3n, "deadbeef", o.twins ? "Owner" : "test123"), PL(20n, 2n), PL(21n, 2n), PL(22n, 3n), PL(23n), PL(24n, 77n)].forEach(put);
  const account = { oid: 9n, typeName: "Sooloos.Broker.Api.Account", loaded: true, fields: { "string Sooloos.Broker.Api.Account::Email": "secret@example.invalid" } };
  if (o.accountList) {
    put({ oid: 10n, typeName: "System.Collections.Generic.IList", loaded: true, fields: { $items: [{ $ref: 2n }, { $ref: 3n }] } });
    account.fields["System.Collections.Generic.IList<Sooloos.Broker.Api.Profile> Sooloos.Broker.Api.Account::Profiles"] = { $ref: 10n };
  }
  if (!o.noAccount) put(account);
  const graph = {
    get: (oid) => objects.get(oid.toString()),
    ofType: (short) => [...objects.values()].filter((x) => x.typeName.endsWith("." + short)),
  };
  const sent = [], types = [], log = [];
  const g = {
    defineType: (name, members) => { types.push({ name, members: members.map((m) => m.name) }); return 7; },
    call: async (oid, sig, args) => {
      sent.push({ oid, sig, args: args.toString("hex") });
      if (sig === SIG.createProfile) {
        if (o.throwCreate) throw new Error("Your server didn't answer CreateProfile in time.");
        if (o.refuse) return { success: false, status: "Unauthorized", payload: Buffer.alloc(0) };
        if (!o.noProfileSent) put(P(40n, "0123abcd", "Rouen probe 10:20:30"));
        if (o.accountList && !o.noProfileSent) objects.get("10").fields.$items.push({ $ref: 40n });
        return { success: true, status: "Success", payload: o.namesNone ? Buffer.alloc(0) : new BinaryWriter().long(40n).toBuffer() };
      }
      if (sig === SIG.editProfile) {
        if (o.throwEdit) throw new Error("Your server didn't answer Edit in time.");
        if (o.refuseEdit) return { success: false, status: "InvalidArguments" };
        if (!o.ignoreEdit) objects.get("40").fields["string Sooloos.Broker.Api.Profile::Name"] = "Rouen probe 10:20:30 renamed";
        return { success: true, status: "Success" };
      }
      throw new Error("not expected: " + sig);
    },
  };
  const s = { g, graph, root: { profiles: [] } };
  let listed = 0, at = "2026-11-26T10:20:30Z";
  // reconnect: the connection replaced while the probe waited for its turn; the old one must never be written to.
  const stale = { g: { defineType: () => 7, call: async (oid, sig) => { sent.push({ oid, sig, stale: true }); return { success: true, status: "Success" }; } },
    graph: { get: () => undefined, ofType: () => [] }, root: { profiles: [] } };
  let turned = !o.reconnect;
  const probe = createProfileProbe({ link: { session: () => (o.noSession ? null : turned ? s : stale) }, inTurn: async (fn) => { turned = true; return fn(); }, off: () => o.off || null,
    playlists: { list: async () => { listed++; return o.listNotSent ? { notSent: "Your server hasn't sent its playlists yet." } : { playlists: [] }; } }, log: (l) => log.push(l), timeoutMs: 60,
    now: () => new Date(at) });
  return { probe, sent, types, log, listed: () => listed, clock: (iso) => { at = iso; } };
}

test("THE trial: profiles and their playlists counted, a profile made and renamed, left for the owner to delete", async () => {
  const { probe, sent, types, listed } = rig();
  const out = await probe.run();
  assert.equal(listed(), 1, "the playlists listed first, so they are on the graph");
  assert.deepEqual(out.profiles, ["Owner", "test123"]);
  assert.deepEqual(out.playlistsByProfile, { byProfile: [{ id: "cafebabe", name: "Owner", playlists: 2 }, { id: "deadbeef", name: "test123", playlists: 1 }],
    noProfile: 1, elsewhere: 1 });
  assert.equal(out.name, "Rouen probe 10:20:30");
  assert.equal(out.create, "made, named as asked");
  assert.equal(out.rename, "renamed, and shown on this connection");
  assert.match(out.left, /^Delete "Rouen probe 10:20:30 renamed" in Roon/);
  const made = out.steps.find((x) => x.step === "the profile made");
  assert.equal(made.id, "0123abcd");
  assert.equal(made.onTheAccountsList, null, "the Account carries no list of profiles here: said so, not guessed");
  // The wire: CreateProfile on the Account, Edit on the Profile made, each an inline struct with only its Name.
  const [c, e] = sent;
  assert.equal(c.oid, 9n, "on the Account");
  assert.equal(c.sig, SIG.createProfile);
  const body = (s) => { const b = new BinaryWriter().flexInt(1).string(s).flexInt(0).toBuffer(); return new BinaryWriter().long(1n).flexInt(7).flexInt(b.length).bytes(b).toBuffer().toString("hex"); };
  assert.equal(c.args, body("Rouen probe 10:20:30"), "flexLong 1, type 7, length, member 1 (Name), the name, end");
  assert.equal(e.oid, 40n, "on the profile the answer named");
  assert.equal(e.sig, SIG.editProfile);
  assert.equal(e.args, body("Rouen probe 10:20:30 renamed"));
  // Each type declared whole, as the catalogue has it.
  assert.deepEqual(types[0], { name: "Sooloos.Broker.Api.ProfileCreate", members: PROFILE_CREATE.members.map(([m]) => m) });
  assert.deepEqual(types[1], { name: "Sooloos.Broker.Api.ProfileEdit", members: PROFILE_EDIT.members.map(([m]) => m) });
  assert.equal(types[0].members.length, 7);
  assert.equal(types[1].members.length, 9);
  assert.ok(ALLOWED.has(SIG.createProfile) && ALLOWED.has(SIG.editProfile), "both on the allowlist");
});

test("nothing of the Account is reported, only that it was found", async () => {
  const out = await rig().probe.run();
  assert.doesNotMatch(JSON.stringify(out, (k, v) => (typeof v === "bigint" ? String(v) : v)), /secret@example|Email/);
  assert.deepEqual(out.steps.find((x) => x.step === "Account"), { step: "Account", found: true });
});

test("the review: each way it can go wrong is said so, and where a profile may have been made, where to look", async () => {
  const refused = await rig({ refuse: true }).probe.run();
  assert.equal(refused.create, 'refused ("Unauthorized")');
  assert.equal(refused.rename, "not tried");
  assert.equal(refused.left, "Nothing was made.");

  const neverCame = await rig({ noProfileSent: true }).probe.run();
  assert.equal(neverCame.create, "answered Success, but the profile it named never arrived");
  assert.match(neverCame.left, /^Look for "Rouen probe 10:20:30"/);

  const namedNone = await rig({ namesNone: true }).probe.run();
  assert.equal(namedNone.create, "answered Success, but named no profile");

  assert.equal((await rig({ ignoreEdit: true }).probe.run()).rename, "answered Success, but the new name didn't show on this connection: check it in Roon");
  const editRefused = await rig({ refuseEdit: true }).probe.run();
  assert.equal(editRefused.rename, 'refused ("InvalidArguments")');
  assert.match(editRefused.left, /^Delete "Rouen probe 10:20:30" in Roon/, "the name it still has");

  const threw = await rig({ throwCreate: true }).probe.run();
  assert.equal(threw.steps.at(-1).error, "Your server didn't answer CreateProfile in time.");
  assert.match(threw.left, /^Look for "Rouen probe 10:20:30"/);
});

test("nothing sent without an Account, a connection, or with native mode not in use", async () => {
  const none = rig({ noAccount: true });
  const out = await none.probe.run();
  assert.equal(out.create, "not tried: your server sent this connection no Account object");
  assert.equal(none.sent.length, 0);
  assert.equal(out.playlistsByProfile.byProfile.length, 2, "the read-only part still said");

  const noSession = rig({ noSession: true });
  assert.deepEqual(await noSession.probe.run(), { error: "Native mode isn't connected to your server right now.", status: 503 });
  const off = rig({ off: "Native mode is off." });
  assert.deepEqual(await off.probe.run(), { error: "Native mode is off.", status: 409 });
  assert.equal(off.sent.length + noSession.sent.length, 0);
});

test("the review: a profile made and a rename that threw still says what to delete", async () => {
  const out = await rig({ throwEdit: true }).probe.run();
  assert.equal(out.create, "made, named as asked");
  assert.equal(out.steps.at(-1).error, "Your server didn't answer Edit in time.");
  assert.match(out.left, /^Delete "Rouen probe 10:20:30" in Roon/);
});

test("the review: playlists that couldn't be read are said unread, never counted as none", async () => {
  const out = await rig({ listNotSent: true }).probe.run();
  assert.deepEqual(out.playlistsByProfile, { unread: "Your server hasn't sent its playlists yet." });
  assert.deepEqual(out.steps[0], { step: "playlists listed", error: "Your server hasn't sent its playlists yet." });
  assert.equal(out.create, "made, named as asked", "the rest still tried");
});

test("the review: two profiles of one name are counted apart, by id", async () => {
  const out = await rig({ twins: true }).probe.run();
  assert.deepEqual(out.playlistsByProfile.byProfile, [{ id: "cafebabe", name: "Owner", playlists: 2 }, { id: "deadbeef", name: "Owner", playlists: 1 }]);
});

test("the Account's own list of profiles, when it carries one, is checked for the one made", async () => {
  const out = await rig({ accountList: true }).probe.run();
  assert.equal(out.steps.find((x) => x.step === "the profile made").onTheAccountsList, true);
  assert.doesNotMatch(JSON.stringify(out, (k, v) => (typeof v === "bigint" ? String(v) : v)), /Email|secret/);
});

test("the review: a second run within ten minutes makes no second profile; one after does, and a run that sent nothing holds nothing back", async () => {
  const r = rig();
  await r.probe.run();
  r.clock("2026-11-26T10:29:00Z");
  assert.deepEqual(await r.probe.run(), { error: "The profile probe ran less than ten minutes ago, and each run makes a profile in Roon: run it again later.", status: 409 });
  assert.equal(r.sent.filter((x) => x.sig === SIG.createProfile).length, 1);
  r.clock("2026-11-26T10:30:31Z");
  assert.match((await r.probe.run()).create, /^made/, "ten minutes on, it runs (the stand-in names every profile it makes alike)");
  assert.equal(r.sent.filter((x) => x.sig === SIG.createProfile).length, 2);
  const none = rig({ noAccount: true });
  await none.probe.run();
  assert.equal((await none.probe.run()).create, "not tried: your server sent this connection no Account object", "nothing sent: not held back");
});

test("the review: a connection replaced while the probe waited for its turn is never written to", async () => {
  const r = rig({ reconnect: true });
  const out = await r.probe.run();
  assert.equal(out.create, "made, named as asked");
  assert.ok(r.sent.length > 0 && !r.sent.some((x) => x.stale), "every call on the connection in force when the turn came");
});
