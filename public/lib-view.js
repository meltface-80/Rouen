// @ts-check
/*
 * lib-view.js — what the Library wall's Sort and Focus are made of, and what a saved view holds: moved out of
 * app.js in v1.9.67 (dev/quality.md), unchanged but for the Label & catalogue № sort and the Album type facet
 * added then (a user's request). Loaded before app.js, which reads them as window.RouenLibView.
 *
 * Roon's own Sort/Focus live on a private API, so these are built from this extension's own snapshot.
 */
(() => {
  "use strict";

  // `asc`/`desc` are the human meanings of the two arrow directions for that
  // sort, and `dir` is which one you get when you first pick it: alphabetical
  // sorts open A→Z, everything quantitative opens with the biggest/newest
  // first, which is what people mean by "sort by year" or "most played".
  const LIB_SORT_OPTIONS = [
    { id: "album",      label: "Album name",   dir: "asc",
      asc: "A → Z", desc: "Z → A" },
    { id: "artist",     label: "Artist",       dir: "asc",
      asc: "A → Z", desc: "Z → A" },
    // Each label together, its releases in catalogue order (v1.9.67): the way a
    // shop files electronic music. Albums with no label come last.
    { id: "label",      label: "Label & catalogue №", dir: "asc",
      asc: "A → Z", desc: "Z → A",
      note: "labels from the label scan, catalogue numbers from file tags" },
    // "Release date", not "year", since v1.8.60: the server orders by the day
    // wherever a source states one (the id stays "year" — saved views and
    // smart playlists store it). An album known only by its year sorts after
    // that year's dated albums newest-first, and before them oldest-first.
    { id: "year",       label: "Release date", dir: "desc",
      asc: "Oldest first", desc: "Newest first",
      note: "from dates collected during scanning" },
    { id: "added",      label: "Recently added", dir: "desc",
      asc: "Oldest first", desc: "Newest first",
      // Deliberately not "when you added it": Roon publishes no import date,
      // so this is the extension's own evidence — file timestamps, and albums
      // turning up between library scans.
      note: "from dates Rouen could work out" },
    { id: "plays",      label: "Most played",  dir: "desc",
      asc: "Least played first", desc: "Most played first",
      note: "from plays Rouen has seen" },
    { id: "lastplayed", label: "Last played",  dir: "desc",
      asc: "Longest ago first", desc: "Most recent first",
      note: "from plays Rouen has seen" },
    { id: "random",     label: "Random",       dir: "asc" }   // no direction
  ];
  const LIB_PLAYED_OPTIONS = [
    { id: "any",   label: "Any" },
    { id: "never", label: "Never played" },
    { id: "6",     label: "Not in 6 months" },
    { id: "12",    label: "Not in 12 months" }
  ];
  // Random has no meaningful direction, so the arrow control hides for it.
  const libSortHasDir = (id) => id !== "random";
  function libSortDefaultDir(id) {
    const o = LIB_SORT_OPTIONS.find(x => x.id === id);
    return o ? o.dir : "asc";
  }
  // Every multi-select Focus facet, in the order the sheet lays them out. This
  // list is the client's half of libFacetDefs() on the server; the SERVER is
  // what decides which of them actually have values, and the sheet renders
  // whatever /api/library/facets returns rather than assuming. Keeping the ids
  // in one array is what stops the query builder, the saved-view snapshot, the
  // reset and the active-count from drifting apart as facets are added.
  const LIB_FACET_IDS = ["genre", "source", "decade", "label", "type", "format",
                         "rate", "bits", "chan", "letter", "added"];
  const libEmptyFacets = () => {
    const o = {};
    for (const id of LIB_FACET_IDS) o[id] = [];
    return o;
  };
  // Derived from LIB_FACET_IDS rather than listed again: a facet added to that
  // array is savable immediately, instead of working on the Library screen and
  // silently vanishing the moment somebody saves the view as a playlist.
  const SMART_VIEW_KEYS = ["sort", "dir", "seed", "played"].concat(LIB_FACET_IDS);

  // A one-line human description, so the picker says what a saved view DOES
  // rather than only what it was named.
  function describeLibView(v) {
    const bits = [];
    const sortOpt = LIB_SORT_OPTIONS.find(o => o.id === v.sort);
    if (sortOpt) bits.push(sortOpt.label + (v.dir === "desc" ? " ↓" : " ↑"));
    // Decades read as "1980s"; everything else is already a display name, and
    // an excluded value says so rather than reading as if it were included.
    const shown = (id, val) => (val.charAt(0) === "!" ? "not " : "") +
      (id === "decade" ? val.replace("!", "") + "s" : val.replace(/^!/, ""));
    for (const id of LIB_FACET_IDS) {
      const sel = v[id];
      if (Array.isArray(sel) && sel.length) bits.push(sel.map(x => shown(id, x)).join(", "));
    }
    if (v.played && v.played !== "any") {
      const opt = LIB_PLAYED_OPTIONS.find(p => p.id === v.played);
      bits.push(opt ? opt.label.toLowerCase() : "not played in " + v.played + " months");
    }
    return bits.join(" · ");
  }

  // Album counts a dynamic playlist can be limited to. The ceiling is the
  // play-time one: 400 albums is ~3,200 Roon calls and minutes of queueing.
  const SMART_LIMITS = [25, 50, 100, 200, 400];
  const SMART_LIMIT_DEFAULT = 100;   // matches smartLimitDefault() on the server
  // What a new playlist is made OF, asked first because it changes what the
  // playlist DOES rather than which albums it matches — and because it is the
  // one choice that can't be inferred from the focus.
  //
  // Both modes run the same album query. "Albums" queues whole records in
  // order; "Tracks" expands them and lists the tracks individually. The filter
  // itself is always album-level: Roon's API publishes no track list without
  // opening each album one at a time, so a genuinely track-level FILTER would
  // mean indexing every track in the library — thousands of Roon calls, redone
  // on every change — which is the traffic the snapshot exists to avoid. This
  // is stated in the sheet rather than hidden, so the choice is understood.
  const SMART_MODES = [
    { id: "albums", label: "Albums",
      note: "Queues whole albums, in their own running order." },
    { id: "tracks", label: "Tracks",
      note: "Lists the tracks from those albums, so you can play or queue them one at a time." }
  ];
  const SMART_MODE_DEFAULT = "albums";   // matches smartModeDefault() on the server
  // What order it comes out in — a separate axis from what it is made of.
  const SMART_ORDERS = [
    { id: "album",  label: "Album order" },
    { id: "random", label: "Random" }
  ];
  const SMART_ORDER_DEFAULT = "album";   // matches smartOrderDefault() on the server

  /** @type {any} */ (window).RouenLibView = { LIB_SORT_OPTIONS, LIB_PLAYED_OPTIONS, libSortHasDir, libSortDefaultDir, LIB_FACET_IDS,
    libEmptyFacets, SMART_VIEW_KEYS, describeLibView, SMART_LIMITS, SMART_LIMIT_DEFAULT, SMART_MODES, SMART_MODE_DEFAULT, SMART_ORDERS, SMART_ORDER_DEFAULT };
})();
