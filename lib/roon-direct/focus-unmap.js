// @ts-check
"use strict";
/*
 * focus-unmap.js — N2e-3b-4 (dev/design/native-remote.md §12.18, v1.9.66-t16): a Roon smart playlist's album Focus as
 * the view of Rouen's Dynamic Playlist editor, so any of Roon's smart playlists — made in Roon, or moved there by
 * Rouen — is edited in Rouen (the owner: "a playlist created in Roon must be editable in Rouen"). The inverse of
 * focus-map.js, and believed only when it is: the view, mapped forward again (mapFocus), must be the very Focus Roon
 * holds — its genres and how they combine, its order and direction, and every other filter. A Focus the editor can't
 * show (a track Focus, a filter Rouen has no facet for, an order Rouen hasn't, a date range that isn't whole decades)
 * is refused, named, never shown approximately and saved back changed.
 *
 * Pure: reads the graph as sent, asks the server nothing.
 */
const { field } = require("./objects");
const { focusFields, genreList, readList } = require("./focus");
const { readExtra, readOrder, differs } = require("./focus-write");
const { mapFocus, ORDERING, nullDate } = require("./focus-map");

/** The Focus members the editor shows (or that order what is shown, not what is held: the languages). */
const SHOWN = new Set(["UiLanguage", "LanguagePreferences", "Ordering", "GenresMode", "RequireGenreObjects", "ExcludeGenreObjects", "LabelsMode",
  "RequireFileFormats", "ExcludeFileFormats", "RequireSampleRates", "ExcludeSampleRates", "RequireBitsPerSample", "ExcludeBitsPerSample",
  "RequireLabels", "ExcludeLabels", "RequirePlayedInLastNDays", "ExcludePlayedInLastNDays", "RequireImportedInLastNDays",
  "ExcludeImportedInLastNDays", "MinDate", "MaxDate"]);
/** Rouen's sort for each of Roon's AlbumOrdering it maps (focus-map.js ORDERING, inverted). */
const SORT_OF = /** @type {Record<number, string>} */ (Object.fromEntries(Object.entries(ORDERING).map(([k, v]) => [v, k])));
/** Roon's OrderingDirection: Descending. Default (0) and Ascending (1) are Rouen's ascending (§12.18). */
const DESCENDING = 2;
/** Roon's file formats as Rouen's facets name them (focus-map.js FORMAT, SERVICE, inverted). */
const FORMAT_OF = /** @type {Record<number, string>} */ ({ 1: "FLAC", 4: "MPEG", 5: "WAVE", 6: "OGG", 7: "AIFF", 13: "DSF", 14: "DSDIFF" });
const SERVICE_OF = /** @type {Record<number, string>} */ ({ 12: "tidal", 15: "qobuz" });
const KKBOX = 17, EVER_DAYS = 36500, MONTH_DAYS = 30, GENRES_ANY_OF = 1;
/** The Played and Added choices the editor has (app.js LIB_PLAYED_OPTIONS, index.js libAddedWindows): another isn't shown. */
const PLAYED_SHOWN = ["any", "never", "6", "12"], ADDED_SHOWN = ["7", "30", "90", "365"];

/** @param {string} k */
const short = (k) => k.slice(k.lastIndexOf("::") + 2);
/** A member left at its default: nothing to show. @param {any} v */
const isDefault = (v) => v === false || v === 0 || v === null || v === undefined || v === "";
/** The same names, in any order. @param {string[]} a @param {string[]} b */
const same = (a, b) => [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * Roon's file formats as Rouen's Source and Format facets: required services alone are the sources picked; with Local,
 * the services excluded are the ones not picked (KKBox excluded too when sources were picked, as the map makes it).
 * Approximate on purpose: the round trip below is the judge.
 * @param {{ require: number[], exclude: number[] }} f
 * @returns {{ source: string[], format: string[] } | { why: string }}
 */
function sourcesOf(f) {
  for (const n of f.require.concat(f.exclude)) {
    if (!FORMAT_OF[n] && !SERVICE_OF[n] && n !== KKBOX) return { why: `a file format Rouen's editor doesn't have (Roon's ${n})` };
  }
  const reqSvc = f.require.filter((n) => SERVICE_OF[n]).map((n) => SERVICE_OF[n]);
  const excSvc = f.exclude.filter((n) => SERVICE_OF[n]).map((n) => SERVICE_OF[n]);
  const format = f.require.filter((n) => FORMAT_OF[n]).map((n) => FORMAT_OF[n]).concat(f.exclude.filter((n) => FORMAT_OF[n]).map((n) => "!" + FORMAT_OF[n]));
  if (f.require.includes(KKBOX)) return { why: "a KKBox source (Rouen's editor has none)" };
  /** @type {string[]} */
  let source = [];
  if (reqSvc.length) source = reqSvc;
  else if (f.exclude.includes(KKBOX)) source = ["local", ...["qobuz", "tidal"].filter((x) => !excSvc.includes(x))];
  else source = excSvc.map((x) => "!" + x);
  return { source, format };
}

/**
 * Its Played filter as the editor's choice, or null. @param {{ require: number | null, exclude: number | null }} p
 * @returns {string | null}
 */
function playedOf(p) {
  if (p.require === null && p.exclude === null) return "any";
  if (p.require === null && p.exclude === EVER_DAYS) return "never";
  if (p.require === EVER_DAYS && p.exclude === null) return "played";
  if (p.require === null && typeof p.exclude === "number" && p.exclude > 0 && p.exclude % MONTH_DAYS === 0) return String(p.exclude / MONTH_DAYS);
  return null;
}

/**
 * Its date range as whole decades, or null. @param {{ min: number, max: number } | null} d
 * @returns {string[] | null}
 */
function decadesOf(d) {
  if (!d) return [];
  const y0 = d.min >> 16, y1 = (d.max >> 16) - 9;
  if (y0 % 10 !== 0 || y1 % 10 !== 0 || y1 < y0 || d.min !== nullDate(y0, 0, 0) || d.max !== nullDate(y1 + 9, 12, 31)) return null;
  const out = [];
  for (let y = y0; y <= y1; y += 10) out.push(String(y));
  return out;
}

/**
 * A Roon smart playlist as the editor's view, or why it can't be shown whole.
 * @param {any} graph @param {any} p  the Playlist object
 * @returns {{ view: Record<string, any> } | { why: string[] }}
 */
function viewOf(graph, p) {
  if (field(p, "TrackCriteria") != null) return { why: ["it holds a track Focus, which Rouen's editor can't show"] };
  const f = focusFields(graph, p);
  if (!f) return { why: ["its Focus hasn't been sent, or isn't an album Focus"] };
  /** @type {string[]} */
  const why = [];
  const require = genreList(graph, f, "RequireGenreObjects"), exclude = genreList(graph, f, "ExcludeGenreObjects");
  if (!require || !exclude) why.push("its genres didn't read whole");
  /** Its genres by name, as Roon's own app also writes them (§12.11: "r&b random"): the same genres as its objects, or refused. */
  const byName = { RequireGenres: require, ExcludeGenres: exclude };
  for (const k of Object.keys(f).filter((x) => x !== "$type")) {
    const name = short(k), v = f[k];
    if (SHOWN.has(name)) continue;
    const list = Buffer.isBuffer(v) ? readList(graph, k, v) : null;
    if (name === "RequireGenres" || name === "ExcludeGenres") {
      const objects = byName[name];
      const names = list && list.whole ? list.items.map(String) : null;
      if (names && names.length && !(objects && same(names, objects.map((g) => g.name)))) why.push(`its genres by name (${name}), which aren't the genres it holds`);
      else if (!names && !isDefault(v)) why.push(`its ${name} didn't read whole`);
      continue;
    }
    if (list ? (list.count || 0) > 0 || !list.whole : !isDefault(v)) why.push(`its ${name} filter, which Rouen's editor doesn't have`);
  }
  const modeKey = Object.keys(f).find((k) => k.endsWith("::GenresMode"));
  const mode = modeKey && typeof f[modeKey] === "number" ? f[modeKey] : 0;   // left out at its default: And (§12.13)
  if (require && require.length > 1 && mode !== GENRES_ANY_OF) why.push("its genres must all match, where Rouen's editor matches any of them");
  const order = readOrder(f);
  const sort = order ? SORT_OF[order.ordering] : undefined;
  if (!order) why.push("its order didn't read");
  else if (sort === undefined) why.push(`its order (Roon's ${order.ordering}), which Rouen's editor doesn't have`);
  const ex = readExtra(graph, f);
  if ("why" in ex) why.push(ex.why);
  if (why.length || "why" in ex || !require || !exclude || !order || sort === undefined) return { why };
  const extra = ex.extra;
  const src = sourcesOf(extra.formats);
  const decade = decadesOf(extra.dates);
  const played = playedOf(extra.played);
  if ("why" in src) why.push(`its ${src.why}`);
  if (!decade) why.push("its date range, which isn't whole decades");
  if (!played || !PLAYED_SHOWN.includes(played)) why.push("its Played filter, which Rouen's editor doesn't have");
  const days = extra.imported.require !== null ? extra.imported.require : extra.imported.exclude;
  if (extra.imported.require !== null && extra.imported.exclude !== null) why.push("its Added filter both ways");
  else if (days !== null && !ADDED_SHOWN.includes(String(days))) why.push(`its Added in the last ${days} days, which Rouen's editor doesn't have`);
  if (why.length || "why" in src || !decade || !played) return { why };
  const tag = (/** @type {any[]} */ inc, /** @type {any[]} */ exc) => inc.map(String).concat(exc.map((x) => "!" + String(x)));
  /** @type {Record<string, any>} */
  const view = { sort, dir: order.direction === DESCENDING ? "desc" : "asc", played,
    genre: tag(require.map((g) => g.name), exclude.map((g) => g.name)), decade, source: src.source, format: src.format,
    rate: tag(extra.rates.require, extra.rates.exclude), bits: tag(extra.bits.require, extra.bits.exclude),
    label: tag(extra.labels.require, extra.labels.exclude),
    added: extra.imported.require !== null ? [String(extra.imported.require)] : extra.imported.exclude !== null ? ["!" + extra.imported.exclude] : [] };
  if (sort === "random") {
    const o = Object.entries(f).find(([k]) => k.endsWith("::Ordering"));
    const seedKey = o && o[1] && typeof o[1] === "object" ? Object.keys(o[1]).find((k) => k.endsWith("::RandomSeed")) : undefined;
    view.seed = seedKey ? Number(o && o[1][seedKey]) : 0;   // left out at its default (§12.13)
  }
  // The judge: mapped forward again, the very Focus Roon holds — else not shown (the editor would save it back changed).
  const back = mapFocus({ name: "", view, limit: undefined }, null, null);
  if ("why" in back) return { why: back.why };
  const mf = back.focus;
  const direction = order.direction === DESCENDING ? DESCENDING : 1;
  if (!same(mf.include, require.map((g) => g.name)) || !same(mf.exclude, exclude.map((g) => g.name))) return { why: ["its genres, which Rouen's editor can't show exactly"] };
  if (mf.ordering !== order.ordering || mf.direction !== direction) return { why: ["its order, which Rouen's editor can't show exactly"] };
  const d = differs(mf.extra, ex);
  if (d) return { why: [`its ${d}, which Rouen's editor can't show exactly`] };
  return { view };
}

module.exports = { viewOf, sourcesOf, decadesOf, playedOf };
