// @ts-check
"use strict";
/*
 * roon-sync.js — Rouen's profiles and Roon's, kept together (dev/design/profiles.md §13.2–13.3, 2.0.8-t2, P3a). The
 * owner, 2026-11-26: "I want Roon profiles to show up in Rouen"; "Link each one"; "Pair once".
 *
 *   - Each Rouen profile is paired with at most one Roon profile, and each Roon profile with at most one Rouen profile.
 *   - While a Rouen profile is not paired, the pairing is open (Settings → Profiles says so) and no Roon profile is added:
 *     the one it is waiting for may be the one meant for it.
 *   - Once every Rouen profile is paired, each Roon profile no Rouen profile is paired with is added as a Rouen profile
 *     under its name, paired with it, unless it was removed from Rouen (§13.3: "Rouen only"), which is remembered so the
 *     next read does not add it back. Pairing a Rouen profile with it again forgets that.
 *   - A Rouen profile paired with a Roon profile your server no longer has is "gone": kept, with its listening, with no
 *     hearts until it is paired again (§13.3).
 * Nothing here writes to Roon (creating there is P3b's).
 */

const HIDDEN = "roon_removed";
/** Set once the Native mode choice from before 2.0.8-t2 has been carried to Rouen's first profile (or found not to be). */
const CARRIED = "roon_choice_carried";

/**
 * @param {{ store: ReturnType<typeof import("./store").createProfileStore>, db: () => any,
 *   roon: () => { profiles: Array<{ id: string, name: string }>, former?: string | null } | null, log?: (line: string) => void }} d
 *   roon: your server's profiles as native mode last read them, and the Roon profile chosen in Settings → Native mode
 *   before 2.0.8-t2 (former), or null while native mode isn't in use (nothing then changes)
 */
function createRoonSync(d) {
  const log = d.log || (() => {});

  /** The Roon profiles removed from Rouen on purpose, by id. @returns {string[]} */
  function hidden() {
    const db = d.db();
    const row = db ? db.prepare("SELECT v FROM profiles_meta WHERE k = ?").get(HIDDEN) : null;
    try { const v = row ? JSON.parse(row.v) : []; return Array.isArray(v) ? v.map(String) : []; }
    catch (e) { return []; }   // a value no one could have written by this module: as none hidden, so nothing is lost from view
  }
  /** @param {string[]} ids */
  function setHidden(ids) {
    d.db().prepare("INSERT OR REPLACE INTO profiles_meta (k, v) VALUES (?, ?)").run(HIDDEN, JSON.stringify([...new Set(ids)]));
  }

  /**
   * A Rouen profile's Roon side: "paired" (your server has it, or native mode isn't read to say), "gone" (paired with one
   * your server no longer has), or "none".
   * @param {{ roon_profile: string | null }} p @param {{ profiles: Array<{ id: string }> } | null} roon
   */
  function stateOf(p, roon) {
    if (!p.roon_profile) return "none";
    if (!roon) return "paired";
    return roon.profiles.some((r) => r.id === p.roon_profile) ? "paired" : "gone";
  }

  /**
   * A new profile under a Roon profile's name: numbered when Rouen already has that name (cut short, so the number
   * fits), and "<name> (Roon)" or "Roon profile" when the name is one Rouen can't take (Guest's, or none: the review).
   * @param {string} name
   */
  function addNamed(name) {
    const n0 = String(name || "").trim();
    const tries = n0 ? [n0, `${n0} (Roon)`, "Roon profile"] : ["Roon profile"];
    for (const base of tries) {
      for (let i = 1; i <= 20; i++) {
        const n = i === 1 ? base : `${base.slice(0, 36)} ${i}`;
        try { return d.store.add(n); }
        catch (e) { if (!/already/.test(String(/** @type {Error} */ (e).message))) break; }   // not a name Rouen takes: the next
      }
    }
    throw new Error(`no name Rouen can take for "${name}"`);
  }

  /**
   * Whether a pairing can be made: refused when another Rouen profile has that Roon profile, before anything is written.
   * @param {string} id @param {string | null} roonId
   */
  function check(id, roonId) {
    const other = roonId ? d.store.list().find((p) => p.id !== String(id) && p.roon_profile === roonId) : null;
    if (other) throw new Error(`already paired with ${other.name}`);
  }

  let carried = false;
  /**
   * On the update to profiles paired with Roon's (the owner, 2026-11-26: "When this ships as a latest version and people
   * update I need it to pull through their Roon profiles and have them named accordingly in Rouen"): Rouen's first
   * profile, which holds every play kept before profiles, is paired with the Roon profile native mode acted as until
   * now — the one chosen in Settings → Native mode before 2.0.8-t2, else the server's first, as native mode took then —
   * and takes its name unless it was renamed in Rouen; Roon's other profiles then show up named as in Roon (sync). Once,
   * ever, after the server's profiles have been read: a first profile unpaired by hand afterwards stays so. Answers
   * whether it paired one.
   */
  function carry() {
    if (carried) return false;
    const roon = d.roon();
    if (!roon || !roon.profiles.length) return false;   // native mode's profiles not read yet: tried again on the next ask
    const db = d.db();
    if (!db) return false;
    if (db.prepare("SELECT v FROM profiles_meta WHERE k = ?").get(CARRIED)) { carried = true; return false; }
    const f = d.store.first();
    const onServer = (/** @type {string | null | undefined} */ id) => !!id && roon.profiles.some((r) => r.id === id);
    const want = onServer(roon.former) ? /** @type {string} */ (roon.former) : roon.profiles[0].id;
    const ok = !!(f && !f.roon_profile && !d.store.list().some((p) => p.roon_profile === want));
    if (ok && f) {
      d.store.setRoon(f.id, want);
      const r = roon.profiles.find((x) => x.id === want);
      // Named as in Roon, unless renamed in Rouen; a name Rouen can't take (another profile's) leaves its own.
      if (r && f.name === d.store.madeName() && r.name !== f.name) {
        try { d.store.update(f.id, { name: r.name }); }
        catch (e) { log(`[profiles] "${f.name}" kept its name: ${/** @type {Error} */ (e).message}`); }
      }
      log(`[profiles] the first profile paired with Roon's "${r ? r.name : want}", as native mode acted until now`);
    }
    db.prepare("INSERT OR REPLACE INTO profiles_meta (k, v) VALUES (?, ?)").run(CARRIED, "1");
    carried = true;
    return ok;
  }

  /**
   * The Roon profiles no Rouen profile is paired with, added as Rouen profiles (once every Rouen profile has one, and not
   * those removed on purpose). Answers the names added. @returns {string[]}
   */
  function syncNow() {
    carry();
    const roon = d.roon();
    if (!roon || !roon.profiles.length) return [];
    const list = d.store.list();
    if (list.some((p) => !p.roon_profile)) return [];
    const gone = hidden();
    /** @type {string[]} */
    const added = [];
    for (const r of roon.profiles) {
      if (gone.includes(r.id) || list.some((p) => p.roon_profile === r.id)) continue;
      // One that can't be added is said in the log and left for the next read; the rest, and the page, go on (the review).
      try {
        const made = addNamed(r.name);
        d.store.setRoon(made.id, r.id);
        added.push(made.name);
      } catch (e) { log(`[profiles] Roon's "${r.name}" not added: ${/** @type {Error} */ (e).message}`); }
    }
    if (added.length) log(`[profiles] from Roon: ${added.join(", ")}`);
    return added;
  }

  /** The adoption under way, so asks while it runs share it. @type {Promise<string[]> | null} */
  let adopting = null;
  /**
   * Every Rouen profile is a Roon profile (the owner, 2026-11-26: "there's no need for the link selection … They are Roon
   * profiles either way"): one with none (made before 2.0.8-t3, or while native mode wasn't in use) is paired with the
   * Roon profile of its name no one has, else made in Roon under its name; then Roon's others are added (sync). In the
   * background, one at a time; a Roon profile removed from Rouen is not taken. Answers the names paired or made.
   * @returns {Promise<string[]>}
   */
  function adopt() {
    if (adopting) return adopting;
    adopting = (async () => {
      /** @type {string[]} */
      const done = [];
      if (!d.roon() || !(/** @type {any} */ (d.roon())).profiles.length) return done;
      carry();
      for (const p of d.store.list()) {
        const now = d.roon();
        const fresh = d.store.get(p.id);
        if (!now || !fresh || fresh.roon_profile) continue;
        const taken = new Set(d.store.list().map((x) => x.roon_profile).filter(Boolean));
        const gone = hidden();
        const same = now.profiles.find((r) => !taken.has(r.id) && !gone.includes(r.id) && r.name.toLowerCase() === p.name.toLowerCase());
        if (same) { d.store.setRoon(p.id, same.id); done.push(p.name); continue; }
        const make = /** @type {any} */ (now).create;
        if (!make) break;
        const made = await make(p.name);
        if (made && "id" in made && !(d.store.get(p.id) || {}).roon_profile) { d.store.setRoon(p.id, made.id); done.push(p.name); }
        else if (made && !("id" in made)) log(`[profiles] "${p.name}" not made in Roon: ${made.notSent || made.error}`);
      }
      if (done.length) log(`[profiles] made Roon's: ${done.join(", ")}`);
      syncNow();   // Roon's others, now every Rouen profile has one
      return done;
    })().finally(() => { adopting = null; });
    return adopting;
  }
  return {
    stateOf, carry, adopt,
    /** Whether a Rouen profile is waiting to be paired (§13.2's pairing). */
    sync: syncNow,
    check,
    /**
     * A pairing checked before it is written: refused when another Rouen profile has that Roon profile; taken, it is no
     * longer one removed on purpose. @param {string} id @param {string | null} roonId
     */
    pair(id, roonId) {
      check(id, roonId);
      d.store.setRoon(id, roonId);
      if (roonId && hidden().includes(roonId)) setHidden(hidden().filter((x) => x !== roonId));
    },
    /**
     * A Rouen profile removed, after the removal succeeded (the review): its Roon profile is not added back by the next
     * read (§13.3). @param {string | null} roonId  the Roon profile it was paired with
     */
    removed(roonId) {
      if (roonId) setHidden(hidden().concat(roonId));
    },
    /** The household's Roon profile (§13.2): the one paired with Rouen's first profile, or null. */
    household: () => { const f = d.store.first(); return (f && f.roon_profile) || null; },
  };
}

module.exports = { createRoonSync };
