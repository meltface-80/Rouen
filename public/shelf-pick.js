// @ts-check
/*
 * shelf-pick.js — what is on the Shelf: the library as Rouen sends it, the
 * choices on the left that narrow it, and reading it again when it changes
 * (moved out of shelf.js in v1.9.66, behaviour unchanged). Since v1.9.67 (a
 * user's request): Labels and Types tiles, and the shelf's order — by artist,
 * by label and catalogue number (as a record shop files electronic music), by
 * year, or random. Since v1.9.70-t5 (dev/design/shelf-focus.md): a Format tab
 * (shelf-format.js), a Favourites tab, and the genres sorted by how many, A to
 * Z or Z to A — the genres, formats and favourites Roon's own, read by native
 * mode.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h: the
 * shelf's own state and helpers, and the other parts once made):
 *
 *   const pick = ShelfPick.create(h);
 *   pick.buildList()     the choices applied to the library, in shelf order
 *   pick.renderTiles(keepScroll), pick.renderPick(), pick.loadLibrary()
 *   pick.sel, pick.chosen(), pick.labelOf(cat, id), pick.albumCount()
 *   pick.order(), pick.orderText(), pick.tabsFor(list), pick.lineOf(a)
 *   pick.ready(), pick.readyAt(), pick.libRev()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, rng, hash, imageUrl, jget, TICK } = h;

    const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(["#", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const DISC = '<svg class="disc" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".16"/><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    const SHUFFLE = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';

    // ---- Library ---------------------------------------------------------------
    let genres = [];          // [{ name, count }], commonest first
    let labels = [];          // [{ name, count }], commonest first (v1.9.67)
    let kinds = [];           // [{ id, one, many }], what a release can be, as the server names them (v1.9.67)
    let albums = [];          // [{ o, t, a, k, g, b, y, l, c, ty }] in artist order
    let libRev = null;        // /api/live's library revision the list was read at
    let ready = false;
    let readyAt = 0;          // when it first was: the playing record is put in front only soon after
    let fans = [];            // per genre: up to three image keys for its tile
    // What the genres, formats and favourites came from (v1.9.70-t5): native mode's library read, and how many carried
    // each; null from a server before t5.
    let facts = null;
    const FMT = /** @type {any} */ (window).ShelfFormat;
    /** The genres' order on their tab (v1.9.70-t5, the owner): "count" (how many, the default), "az" or "za". */
    let genreSort = "count";
    try { const g = localStorage.getItem("shelf-genre-sort"); if (g === "az" || g === "za") genreSort = g; }
    catch (e) { /* storage blocked: by how many, as before */ }
    let labelFans = [];       // per label: the same

    // ---- Choices ---------------------------------------------------------------
    // order holds one of label, year or random; empty is the artist order (the default).
    const sel = { genre: new Set(), artist: new Set(), year: new Set(), label: new Set(), type: new Set(), format: new Set(), fav: new Set(), order: new Set() };
    const NARROWING = ["genre", "artist", "year", "label", "type", "format", "fav"];
    /** The kinds of release an album is (v1.9.67-t4: several at once, a live compilation under both tiles); ["none"] for one no source says. */
    const NONE = ["none"];
    const typesOf = (a) => (a.ty && a.ty.length ? a.ty : NONE);
    /** A kind's name, for many (the tiles) or one (the back of a case), as the server names it; "none" is Unknown. @param {string} id @param {boolean} many */
    const kindName = (id, many) => { if (id === "none") return "Unknown"; const k = kinds.find((x) => x.id === id); return k ? (many ? k.many : k.one) : id; };
    /** The kinds the library has, in the server's order, then any it doesn't name (a later build's), then Unknown. */
    const kindsHere = () => {
      const have = new Set(albums.flatMap(typesOf));
      const named = kinds.map((k) => k.id).filter((id) => have.has(id));
      const other = [...have].filter((id) => id !== "none" && !named.includes(id)).sort();
      return named.concat(other, have.has("none") ? ["none"] : []);
    };
    const ORDERS = [["artist", "A → Z by artist", "As a shop files them: by the artist's name, then the title."],
      ["label", "By label and catalogue №", "Each label together, its releases in catalogue order. Albums with no label come last, by artist."],
      ["catno", "By catalogue №", "The numbers in order across every label, as a shop's stock list. Albums with no number come last, by artist."],
      ["year", "By year", "Oldest first. Albums with no year come last."],
      ["random", "Random order", "The shelf in a random order, as on the Random albums screen. Only the albums your other choices leave, if you have made any."]];
    const ORDER_TEXT = Object.fromEntries(ORDERS.map(([id, name]) => [id, name]));
    const order = () => [...sel.order][0] || "artist";
    let chosen = [];          // [cat, id] in the order chosen: the chips, and Undo
    let tab = "genre";
    let shuffleSeed = 1;
    let waitingText = "Reading your library…";

    // An album's decade, as its Years tile names it (v1.9.10, from Mandarin
    // v0.8.27): "1960" for 1960–1969; "none" for an album no source dated.
    const decadeOf = (a) => (a.y ? String(Math.floor(a.y / 10) * 10) : "none");
    function passes(a, skip) {
      if (skip !== "genre" && sel.genre.size && !a.g.some((i) => sel.genre.has(i))) return false;
      if (skip !== "artist" && sel.artist.size && !sel.artist.has(a.b)) return false;
      if (skip !== "year" && sel.year.size && !sel.year.has(decadeOf(a))) return false;
      if (skip !== "label" && sel.label.size && !sel.label.has(a.l)) return false;
      if (skip !== "type" && sel.type.size && !typesOf(a).some((t) => sel.type.has(t))) return false;
      if (skip !== "format" && sel.format.size && !a.fk.some((k) => sel.format.has(k))) return false;
      if (skip !== "fav" && sel.fav.size && !a.fv) return false;
      return true;
    }
    // Labels and catalogue numbers in a shop's order, as the Library's sort collates them (lib/release-facts.js
    // naturalCompare: "en", numbers as numbers, case alike): "WARP 61" before "WARP 123", "Label 9" before "Label 10".
    const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const labelName = (a) => (a.l === null || a.l === undefined ? "" : labels[a.l] ? labels[a.l].name : "");
    const byLabel = (x, y) => {
      if ((x.l === null) !== (y.l === null)) return x.l === null ? 1 : -1;   // unlabelled last
      return natural.compare(labelName(x), labelName(y)) || natural.compare(x.c || "\uffff", y.c || "\uffff") || natural.compare(x.t, y.t);
    };
    // By catalogue number alone (v1.9.67-t5): the numbers across every label, numbers as numbers; unnumbered last.
    const byCat = (x, y) => {
      if (!x.c !== !y.c) return x.c ? -1 : 1;
      return natural.compare(x.c || "", y.c || "") || natural.compare(x.t, y.t);
    };
    const byYear = (x, y) => {
      if (!x.y !== !y.y) return x.y ? -1 : 1;   // undated last
      return (x.y || 0) - (y.y || 0);
    };
    /** The order's tabs: where a new letter, label or decade begins. @param {any[]} list */
    function tabsFor(list) {
      const by = order();
      const keyOf = by === "label" ? (a) => (a.l === null ? "" : labelName(a)) : by === "year" ? (a) => (a.y ? decadeOf(a) + "s" : "") : (a) => a.b;
      return list.map((a, i) => (by !== "random" && by !== "catno" && (i === 0 || keyOf(list[i - 1]) !== keyOf(a)) ? keyOf(a) : ""));
    }
    /** The back of the case's line under the title: its label, catalogue number and kind. @param {any} a */
    const lineOf = (a) => [labelName(a), a.c, ...(a.ty && a.ty.length ? a.ty.map((t) => kindName(t, false)) : [])].filter(Boolean).join(" · ");
    function seededShuffle(arr, seed) {
      const r = rng(seed);
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      return arr;
    }
    function buildList() {
      const out = albums.filter((a) => passes(a));
      const by = order();
      // The list arrives in artist order, and a stable sort keeps it within a label or a year.
      return by === "random" ? seededShuffle(out, shuffleSeed) : by === "label" ? out.sort(byLabel) : by === "catno" ? out.sort(byCat) : by === "year" ? out.sort(byYear) : out;
    }
    function labelOf(cat, id) {
      if (cat === "genre") return (genres[id] || { name: "?" }).name;
      if (cat === "label") return (labels[id] || { name: "?" }).name;
      if (cat === "type") return kindName(String(id), true);
      if (cat === "format") return FMT.nameOf(String(id));
      if (cat === "fav") return "Favourites";
      if (cat === "order") return ORDER_TEXT[id] || String(id);
      if (cat === "year") return id === "none" ? "Undated" : id + "s";
      return id;
    }
    function newSeed() { return ((Math.random() * 4294967295) >>> 0) || 1; }
    function toggle(cat, id) {
      const s = sel[cat];
      // One order at a time; the artist order is the default, and no chip.
      if (cat === "order") {
        if (order() === id) return;
        s.clear(); chosen = chosen.filter(([c]) => c !== "order");
        if (id !== "artist") { s.add(id); chosen.push([cat, id]); }
        if (id === "random") shuffleSeed = newSeed();
        h.refresh();
        return;
      }
      if (s.has(id)) { s.delete(id); chosen = chosen.filter(([c, i]) => !(c === cat && i === id)); }
      else { s.add(id); chosen.push([cat, id]); }
      h.refresh();
    }
    function clearCat(cat) { sel[cat].clear(); chosen = chosen.filter(([c]) => c !== cat); h.refresh(); }
    function clearAll() { for (const k in sel) sel[k].clear(); chosen = []; h.refresh(); }

    // ---- The selection centre ---------------------------------------------------
    const tilesEl = $("#tiles");
    // keepScroll: a re-read of the library leaves the list where it was scrolled.
    // Every caller follows this with renderPick(), which brings the counts.
    function renderTiles(keepScroll) {
      tilesEl.className = "tiles " + tab;
      let html = "";
      if (!ready) {
        tilesEl.innerHTML = "";
        return;
      }
      if (tab === "genre") {
        // The genres in the order chosen (the owner, v1.9.70-t5): by how many (as sent), A to Z, or Z to A.
        const at = genres.map((g, i) => i);
        if (genreSort !== "count") at.sort((x, y) => genres[x].name.localeCompare(genres[y].name, undefined, { sensitivity: "base" }) * (genreSort === "za" ? -1 : 1));
        const sorts = [["count", "#N"], ["az", "A → Z"], ["za", "Z → A"]].map(([id, name]) =>
          `<button class="g-sort" type="button" data-sort="${id}" aria-pressed="${genreSort === id}">${name}</button>`).join("");
        const none = facts && facts.native && !facts.withGenres;
        html = none ? '<p class="tiles-msg">Your server sent no genres with its library to native mode. Rouen shows Roon’s own genres here, and none came.</p>'
          : !genres.length ? '<p class="tiles-msg">Genres appear once Rouen has read Roon’s genre list, which it does after each library sync. Artists and Random work now.</p>'
          : `<div class="g-sorts" role="group" aria-label="Sort the genres">${sorts}</div>` + at.map((i) => { const g = genres[i]; return `<button class="tile t-genre" type="button" data-cat="genre" data-id="${i}" aria-pressed="false">
            <span class="fan" aria-hidden="true">${(fans[i] || []).map((k, n) => `<span class="m m${n}"><img src="${imageUrl(k, 500)}" alt="" loading="lazy" decoding="async"></span>`).join("")}</span>
            <span class="t-row"><span class="t-name">${esc(g.name)}</span><span class="t-count"></span></span><span class="tick">${TICK}</span></button>`; }).join("");
      } else if (tab === "artist") {
        html = LETTERS.map((l) => `<button class="tile t-letter" type="button" data-cat="artist" data-id="${l}" aria-pressed="false" aria-label="Artists under ${l === "#" ? "#: names starting with 0, or with no letter A to Z" : l}">
          <span class="ch">${l}</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`).join("");
      } else if (tab === "year") {
        // The decades the library has, newest first (as the Library's Decade
        // focus lists them), then the albums with no year.
        const ds = [...new Set(albums.map(decadeOf))];
        const years = ds.filter((d) => d !== "none").sort((x, y) => +y - +x);
        if (ds.includes("none")) years.push("none");
        html = years.length && years[0] !== "none"
          ? years.map((d) => `<button class="tile t-decade${d === "none" ? " undated" : ""}" type="button" data-cat="year" data-id="${d}" aria-pressed="false" aria-label="${d === "none" ? "Albums with no year" : "The " + d + "s"}">
          <span class="ch">${d === "none" ? "Undated" : d + "s"}</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`).join("")
          : '<p class="tiles-msg">Decades appear once Rouen has read your albums’ release years, which it does after each library sync. Genres, Artists and Random work now.</p>';
      } else if (tab === "label") {
        // As the genre tiles: a fan of three covers, the name and how many (v1.9.67).
        html = labels.length ? labels.map((l, i) => `<button class="tile t-genre t-label" type="button" data-cat="label" data-id="${i}" aria-pressed="false">
            <span class="fan" aria-hidden="true">${(labelFans[i] || []).map((k, n) => `<span class="m m${n}"><img src="${imageUrl(k, 500)}" alt="" loading="lazy" decoding="async"></span>`).join("")}</span>
            <span class="t-row"><span class="t-name">${esc(l.name)}</span><span class="t-count"></span></span><span class="tick">${TICK}</span></button>`).join("")
          : '<p class="tiles-msg">Labels appear once the label scan has read them: switch Labels on in Settings → Setup.</p>';
      } else if (tab === "format") {
        // Three groups (the owner): the file formats, the quality, the exact resolutions — Roon's, read by native mode.
        const groups = FMT.groups(albums.flatMap((a) => a.fk));
        html = !facts || !facts.native ? '<p class="tiles-msg">Formats come from Roon itself, read by native mode. Turn it on in Settings → Native mode.</p>'
          : !facts.withFormat ? '<p class="tiles-msg">Your server sent no formats with its library to native mode, so there is nothing to choose by yet.</p>'
          : groups.map(([head, keys]) => `<h3 class="f-head">${esc(head)}</h3>` + keys.map((k) => `<button class="tile t-decade t-type t-format${k === "none" ? " undated" : ""}" type="button" data-cat="format" data-id="${esc(k)}" aria-pressed="false">
          <span class="ch">${esc(FMT.nameOf(k))}</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`).join("")).join("");
      } else if (tab === "fav") {
        html = !facts || !facts.native ? '<p class="tiles-msg">Favourites are your hearts in Roon itself, read by native mode. Turn it on in Settings → Native mode.</p>'
          : `<button class="tile t-decade t-type" type="button" data-cat="fav" data-id="fav" aria-pressed="false">
          <span class="ch">Favourites</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`;
      } else if (tab === "type") {
        html = kindsHere().map((id) => `<button class="tile t-decade t-type${id === "none" ? " undated" : ""}" type="button" data-cat="type" data-id="${esc(id)}" aria-pressed="false">
          <span class="ch">${esc(kindName(id, true))}</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`).join("");
      } else {
        // The order: one of four, the artist order by default (v1.9.67); Random keeps its reshuffle and the spin.
        html = ORDERS.map(([id, name, note]) => `<button class="tile t-order" type="button" data-cat="order" data-id="${id}" aria-pressed="false">${id === "random" ? SHUFFLE : ""}
            <span class="t-row"><span class="t-name">${name}</span></span>
            <span class="t-note">${note}</span><span class="tick">${TICK}</span></button>`).join("")
          + `<div class="rand-acts">
            <button class="act" type="button" id="reshuffle">Shuffle again</button>
          </div>
          <button class="spin-big" type="button" id="spin-big"><span class="disc-rot">${DISC}</span><span><b>Spin the shelf</b><span>It lands on something in three seconds</span></span></button>`;
      }
      tilesEl.innerHTML = html;
      if (!keepScroll) $("#tiles-wrap").scrollTop = 0;
    }
    function updateTiles() {
      let gCount = null, lCount = null, yCount = null, bCount = null, tCount = null, fCount = null, vCount = 0;
      if (tab === "genre") {
        gCount = new Array(genres.length).fill(0);
        for (const a of albums) if (passes(a, "genre")) for (const i of a.g) gCount[i]++;
      } else if (tab === "artist") {
        lCount = {};
        for (const a of albums) if (passes(a, "artist")) lCount[a.b] = (lCount[a.b] || 0) + 1;
      } else if (tab === "year") {
        yCount = {};
        for (const a of albums) if (passes(a, "year")) { const d = decadeOf(a); yCount[d] = (yCount[d] || 0) + 1; }
      } else if (tab === "label") {
        bCount = new Array(labels.length).fill(0);
        for (const a of albums) if (a.l !== null && passes(a, "label")) bCount[a.l]++;
      } else if (tab === "type") {
        tCount = {};
        for (const a of albums) if (passes(a, "type")) for (const t of typesOf(a)) tCount[t] = (tCount[t] || 0) + 1;
      } else if (tab === "format") {
        fCount = {};
        for (const a of albums) if (passes(a, "format")) for (const k of a.fk) fCount[k] = (fCount[k] || 0) + 1;
      } else if (tab === "fav") {
        for (const a of albums) if (a.fv && passes(a, "fav")) vCount++;
      }
      for (const el of tilesEl.querySelectorAll(".tile")) {
        const cat = el.dataset.cat;
        const id = cat === "genre" || cat === "label" ? +el.dataset.id : el.dataset.id;
        el.setAttribute("aria-pressed", (cat === "order" ? order() === id : sel[cat].has(id)) ? "true" : "false");
        const c = el.querySelector(".t-count");
        let n = null;
        if (cat === "genre") n = gCount[id];
        else if (cat === "artist") n = lCount[id] || 0;
        else if (cat === "year") n = yCount[id] || 0;
        else if (cat === "label") n = bCount[id];
        else if (cat === "type") n = tCount[id] || 0;
        else if (cat === "format") n = fCount[id] || 0;
        else if (cat === "fav") n = vCount;
        if (c) c.textContent = n === null ? "" : String(n);
        el.classList.toggle("zero", n === 0);
      }
      const re = $("#reshuffle");
      if (re) re.disabled = order() !== "random" || h.N < 2;
    }
    function renderPick() {
      for (const t of document.querySelectorAll(".tab")) {
        const k = t.dataset.tab;
        t.setAttribute("aria-selected", k === tab ? "true" : "false");
        t.querySelector(".badge").textContent = sel[k].size ? String(sel[k].size) : "";
      }
      const filtered = NARROWING.some((c) => sel[c].size);
      $("#pick-sum").innerHTML = !ready ? esc(waitingText)
        : filtered ? `<b>${h.N.toLocaleString()}</b> of ${albums.length.toLocaleString()} albums on the shelf`
        : `The whole library · <b>${albums.length.toLocaleString()}</b> albums`;
      // a phone's way back to the shelf (v1.9.69-t1) says what it will show
      $("#pick-done").innerHTML = !ready ? "Show the shelf" : `Show <b>${h.N.toLocaleString()}</b> album${h.N === 1 ? "" : "s"}`;
      const shown = chosen.length > 7 ? chosen.slice(0, 6) : chosen;
      $("#chips").innerHTML = shown.map(([c, i]) => `<span class="chip">${c === "artist" ? "<i>Artists</i>" : ""}<span>${esc(labelOf(c, i))}</span><button class="x" type="button" data-cat="${c}" data-id="${esc(i)}" aria-label="Remove ${esc(labelOf(c, i))}">×</button></span>`).join("")
        + (chosen.length > 7 ? `<span class="chip more">+${chosen.length - 6} more</span>` : "");
      const cats = new Set(chosen.map(([c]) => c));
      $("#reset-all").classList.toggle("hidden", !(chosen.length >= 2 && cats.size >= 2));
      const n = sel[tab].size;
      const noun = { genre: ["genre", "genres"], artist: ["letter", "letters"], year: ["decade", "decades"], label: ["label", "labels"], type: ["type", "types"],
        format: ["format", "formats"], fav: ["choice", "choices"] }[tab];
      $("#sec-note").textContent =
        tab === "order" ? (order() === "random" ? "On: the shelf is shuffled" : "How the shelf is filed. One order at a time.")
        : n ? `${n} ${noun[n === 1 ? 0 : 1]} chosen`
        : tab === "artist" ? "Tap letters. # holds names that start with 0, or have no letter A–Z."
        : tab === "year" ? "Tap decades. Choose as many as you like."
        : tab === "label" ? "Tap labels. Choose as many as you like; the Order tab files the shelf by label."
        : tab === "type" ? "Tap kinds of release. Choose as many as you like."
        : tab === "format" ? "Tap formats, qualities or resolutions, as Roon has them. Choose as many as you like."
        : tab === "fav" ? "Your hearts in Roon, for the profile chosen in Settings → Native mode."
        : "Tap to choose. Choose as many as you like.";
      $("#sec-clear").classList.toggle("hidden", tab === "order" || n < 2);
      updateTiles();
    }
    // A genre's little fan of covers: one that will not load is left out.
    tilesEl.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.parentNode.remove(); }, true);
    tilesEl.addEventListener("click", (e) => {
      if (e.target.closest("#spin-big")) { h.spin(1, 2.4); return; }
      const gs = e.target.closest(".g-sort");
      if (gs) {
        genreSort = gs.dataset.sort;
        try { localStorage.setItem("shelf-genre-sort", genreSort); } catch (err) { /* storage blocked: kept for this visit only */ }
        renderTiles(true); renderPick();
        return;
      }
      if (e.target.closest("#reshuffle")) { shuffleSeed = newSeed(); h.refresh(); return; }
      const t = e.target.closest(".tile");
      if (t) toggle(t.dataset.cat, t.dataset.cat === "genre" || t.dataset.cat === "label" ? +t.dataset.id : t.dataset.id);
    });
    for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => { tab = t.dataset.tab; renderTiles(); renderPick(); });
    $("#chips").addEventListener("click", (e) => {
      const x = e.target.closest(".x");
      if (!x) return;
      // An order's chip taken off is the artist order again.
      if (x.dataset.cat === "order") toggle("order", "artist");
      else toggle(x.dataset.cat, x.dataset.cat === "genre" || x.dataset.cat === "label" ? +x.dataset.id : x.dataset.id);
    });
    $("#sec-clear").addEventListener("click", () => clearCat(tab));
    $("#reset-all").addEventListener("click", clearAll);
    $("#note-reset").addEventListener("click", clearAll);
    // Undo takes back the last choice that NARROWED the shelf: an order only
    // refiles it, so undoing that would leave an empty shelf empty.
    $("#undo").addEventListener("click", () => {
      const last = [...chosen].reverse().find(([c]) => c !== "order");
      if (last) toggle(last[0], last[1]);
    });

    // ---- Reading the library, and keeping up with it -------------------------------
    let loading = null;
    let libSig = null;        // what the server says the list it sent holds
    let retryMs = 5000;
    function loadLibrary() {
      if (loading) return loading;
      loading = (async () => {
        try {
          const j = await jget("/api/shelf/albums" + (ready && libSig ? "?sig=" + encodeURIComponent(libSig) : ""));
          retryMs = 5000;
          // The revision moved for something the shelf doesn't show (a badge, a
          // label): nothing to redraw.
          if (j.same) { libRev = j.rev || libRev; return; }
          // Choices are kept by NAME: the genre list is ordered by count, so a
          // genre can sit at another place in the new one.
          const namesChosen = new Map([...sel.genre].map((i) => [i, genres[i] ? genres[i].name : null]));
          const labelsChosen = new Map([...sel.label].map((i) => [i, labels[i] ? labels[i].name : null]));
          genres = Array.isArray(j.genres) ? j.genres : [];
          labels = Array.isArray(j.labels) ? j.labels : [];
          kinds = Array.isArray(j.kinds) ? j.kinds : [];
          facts = j.facts || null;
          albums = Array.isArray(j.albums) ? j.albums : [];
          for (const a of albums) a.fk = FMT.keysOf(a.fx);   // its Format tiles, worked out once a list (shelf-format.js)
          libRev = j.rev || null;
          libSig = j.sig || null;
          const at = new Map(genres.map((g, i) => [g.name, i]));
          const moved = (i) => { const n = namesChosen.get(i); return n != null && at.has(n) ? at.get(n) : -1; };
          sel.genre = new Set([...sel.genre].map(moved).filter((i) => i > -1));
          const atL = new Map(labels.map((l, i) => [l.name, i]));
          const movedL = (i) => { const n = labelsChosen.get(i); return n != null && atL.has(n) ? atL.get(n) : -1; };
          sel.label = new Set([...sel.label].map(movedL).filter((i) => i > -1));
          chosen = chosen.map(([c, i]) => (c === "genre" ? [c, moved(i)] : c === "label" ? [c, movedL(i)] : [c, i]))
            .filter(([c, i]) => (c !== "genre" && c !== "label") || i > -1);
          // A decade the library no longer has has no tile to un-tick: let it go,
          // as a genre that has gone is.
          const decades = new Set(albums.map(decadeOf));
          sel.year = new Set([...sel.year].filter((d) => decades.has(d)));
          chosen = chosen.filter(([c, i]) => c !== "year" || decades.has(i));
          // A kind the library no longer has, likewise (the review: a tile that has gone can't be un-ticked).
          const have = new Set(albums.flatMap(typesOf));
          sel.type = new Set([...sel.type].filter((t) => have.has(t)));
          chosen = chosen.filter(([c, i]) => c !== "type" || have.has(i));
          // A format the library no longer has, and Favourites with native mode off, likewise (v1.9.70-t5).
          const fmts = new Set(albums.flatMap((a) => a.fk));
          sel.format = new Set([...sel.format].filter((k) => fmts.has(k)));
          if (!facts || !facts.native) sel.fav.clear();
          chosen = chosen.filter(([c, i]) => (c !== "format" || fmts.has(i)) && (c !== "fav" || sel.fav.has(i)));
          // Three covers for each genre's tile, spread through its albums; and each label's.
          const fanOf = (name, keys) => {
            const out = [], step = Math.max(1, Math.floor(keys.length / 3)), start = hash(name) % Math.max(1, keys.length);
            for (let n = 0; n < Math.min(3, keys.length); n++) out.push(keys[(start + n * step) % keys.length]);
            return out;
          };
          const keysOf = genres.map(() => []), keysOfL = labels.map(() => []);
          for (const a of albums) if (a.k) {
            for (const gi of a.g) if (keysOf[gi]) keysOf[gi].push(a.k);
            if (a.l !== null && keysOfL[a.l]) keysOfL[a.l].push(a.k);
          }
          fans = keysOf.map((keys, gi) => fanOf(genres[gi].name, keys));
          labelFans = keysOfL.map((keys, li) => fanOf(labels[li].name, keys));
          const wasReady = ready;
          if (!wasReady) readyAt = Date.now();
          ready = true;
          renderTiles(wasReady);
          h.refresh({ reread: wasReady });
          if (!wasReady) {
            // Somewhere in the middle of the collection rather than at "A", until
            // the record that is playing is found and put in front.
            if (h.N > 1 && order() !== "random") { h.p = h.target = Math.floor(Math.random() * h.N); h.kick(); h.updateInfo(true); }
            h.player.poll();
          }
        } catch (e) {
          // After the first read, a failed re-read leaves the shelf as it is —
          // what is on screen is still a true library, only older — and the next
          // /api/live poll asks again.
          if (!ready) {
            const unpaired = e.status === 503 && /paired/i.test(e.message);
            const building = e.status === 503 && !unpaired;
            waitingText = unpaired ? "Waiting for Roon…" : building ? "Reading your library…" : "Rouen didn’t answer. Trying again…";
            renderPick();
            if (unpaired) h.showNote("Waiting for Roon", "The shelf fills as soon as Rouen is paired with Roon and has read your library.", false);
            else if (building) h.showNote("Reading your library", "Rouen is still reading your Roon library, or hasn’t found any albums in it yet. The shelf fills as soon as there are some.", false);
            else h.showNote("Can’t reach Rouen", "Rouen didn’t answer. The shelf keeps trying.", false);
            // Asked again, less often the longer it waits.
            setTimeout(loadLibrary, retryMs);
            retryMs = Math.min(60000, retryMs * 2);
          }
        } finally {
          loading = null;
        }
      })();
      return loading;
    }

    return { sel, buildList, labelOf, renderTiles, renderPick, loadLibrary, order, tabsFor, lineOf, labelName,
      orderText: () => ORDER_TEXT[order()],
      chosen: () => chosen, albumCount: () => albums.length, ready: () => ready, readyAt: () => readyAt, libRev: () => libRev };
  }

  window.ShelfPick = { create };
})();
