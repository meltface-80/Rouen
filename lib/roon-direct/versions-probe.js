// @ts-check
"use strict";
/*
 * versions-probe.js — what makes a version the default one, read before anything is written (dev/design/album-versions.md
 * §5, v2.0.3-t16): an album's versions as versions.js reads them, then each library copy's AlbumEditInfo — its
 * DuplicateOf (the copy it is a duplicate of), IsUserHidden and Version, in every layer. Run by hand; nothing is
 * written. §6's write (Library::Edit with an AlbumEdit's DuplicateOf) is designed from what this shows.
 *
 *   Library::GetMultiAlbumEditInfo(AlbumEditInfoParameters { Albums, LanguagePreferences }) (proven: catalogue.md t3,
 *     edit-info.js), the copies by their objects on this connection, as versions.js read them.
 */
const { SIG } = require("./methods");
const { isRef, memberOf } = require("./objects");
const { editInfoArgs, readAnswer, layers } = require("./edit-info");

/** The AlbumEditInfo members §6 rests on. */
const WANTED = Object.freeze(["DuplicateOf", "IsUserHidden", "Version", "Title"]);

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           versions: { readIn(title: string, artist: string): Promise<any> }, log?: (line: string) => void }} deps
 */
function createVersionsProbe(deps) {
  const log = deps.log || (() => {});
  let busy = false;
  return {
    /** @param {string} title @param {string} artist @returns {Promise<any>} what was read, or { error, status } */
    async run(title, artist) {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A probe is already running.", status: 409 };
      busy = true;
      try {
        return await deps.inTurn(async () => {
          const got = await deps.versions.readIn(title, artist);
          if (!("versions" in got)) return { error: got.why, status: got.wait ? 503 : 404 };
          const about = { design: "dev/design/album-versions.md §5", complete: got.complete,
            versions: got.versions.map((/** @type {any} */ v) => ({ id: v.id, group: v.group, name: v.name, format: v.format, where: v.where, hidden: v.hidden, current: v.current })) };
          const lib = got.versions.filter((/** @type {any} */ v) => v.group !== "streaming");
          if (!lib.length) return Object.assign(about, { editInfo: null, why: "No library copy to read." });
          const s = deps.link ? deps.link.session() : null;
          if (!s) return Object.assign(about, { editInfo: null, why: "Native mode isn't connected to your server right now." });
          if (s.g.uncertain()) return Object.assign(about, { editInfo: null, why: "The connection to your server is being checked." });
          const oids = lib.map((/** @type {any} */ v) => BigInt(v.oid));
          /** @type {Array<{ languages: string[], status: string }>} */
          const tries = [];
          let res = null;
          for (const languages of [[], ["en"]]) {
            const r = await s.g.call(s.root.library.oid, SIG.albumEditInfo, editInfoArgs(s.g, oids, languages));
            tries.push({ languages, status: r.success ? "Success" : String(r.status) });
            if (r.success) { res = r; break; }
          }
          if (!res) { log("album versions probe: the edit info refused in both forms"); return Object.assign(about, { tries, editInfo: null }); }
          const answer = readAnswer(s.graph, res.payload);
          if ("undecoded" in answer) return Object.assign(about, { tries, editInfo: answer });
          const byOid = new Map(lib.map((/** @type {any} */ v) => [String(v.oid), v]));
          const editInfo = answer.items.map((it, i) => {
            const ref = memberOf(it, "Album");
            const v = (isRef(ref) && byOid.get(String(ref.$ref))) || lib[i] || null;
            /** @type {Record<string, any>} */
            const out = { version: v ? { id: v.id, name: v.name, current: v.current } : null, byPosition: !(isRef(ref) && byOid.has(String(ref.$ref))) };
            for (const name of WANTED) {
              const l = layers(s.graph, memberOf(it, name));
              // A copy named: said by which version it is, beside its object's id (only this connection's).
              if (l && name === "DuplicateOf") {
                for (const k of ["value", "local", "metadata", "base", "edit"]) {
                  const r = l[k];
                  if (r && typeof r === "object" && "ref" in r) { const of = byOid.get(String(r.ref)); if (of) l[k] = Object.assign({}, r, { isVersion: of.name }); }
                }
              }
              out[name] = l;
            }
            return out;
          });
          return Object.assign(about, { tries, form: answer.form, editInfo });
        });
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createVersionsProbe, WANTED };
