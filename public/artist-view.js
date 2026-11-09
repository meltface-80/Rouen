// @ts-check
/*
 * artist-view.js — the artist page: an artist's albums in the library on the shared grid, its header (photo and
 * biography), a band's members, and Back to the screen it was opened from. Moved out of public/app.js in v2.0.3-t3,
 * unchanged (dev/quality.md, "Splitting the monoliths"); app.js loads it (as touchnav.js loads artists.js), and it
 * reads what app.js sets up (window.__buildAlbumTile, window.__live) only when a page opens. Exposes window.__showArtistAlbums,
 * window.__exitArtistView and window.__artistViewActive, as it did inside app.js.
 */
/* ------------------------------------------------------------------ */
/*  Artist albums view                                                 */
/* ------------------------------------------------------------------ */
(() => {
  const grid         = document.getElementById("album-grid");
  const countBar     = document.getElementById("content-count");
  const albumCountTitleEl = document.getElementById("album-count");
  const homeView     = document.getElementById("home-view");
  const homeSections = document.getElementById("home-sections");
  const topbarBack    = document.getElementById("topbar-back");
  const topbarRefresh = document.getElementById("topbar-refresh");
  const topbarSearch  = document.getElementById("topbar-search");

  let artistViewActive = false;
  let saved            = null;   // snapshot of the screen we came from
  // The artist on screen, and the library revision its albums were read at
  // (v1.8.65): an album of theirs added to Roon, or one whose badge changed,
  // reaches the page while it is open — see refreshArtistView.
  let artistViewName  = null;
  let artistViewStamp = null;
  let artistReadSeq   = 0;
  // The bio fetch's generation (renderArtistBioHead), bumped by showArtistAlbums and exitArtistView. Declared here,
  // above its first use, since the move out of app.js (v2.0.3-t3); unchanged otherwise.
  let bioSeq = 0;
  // "Appears on" (v2.0.3-t3, dev/design/plays-on.md §2): with native mode on, every record your server credits the artist
  // on, each tile labelled with their roles, in place of "Also appears on". Null until the server answers "ok" — the
  // page is then exactly as before. appearsSeq is the read's generation, bumped by a new page and by Back.
  let artistViewAppears = null;
  let artistViewAppearsAll = false;   // More pressed: the whole list, not its first APPEARS_SHOWN
  let artistViewData = null;          // the last /api/artist-albums answer, painted again when "Appears on" arrives
  let appearsSeq = 0;
  const APPEARS_SHOWN = 24;
  const ARTIST_VIEW_DEPS = ["library"];
  const liveApi = () => window.__live || null;
  // The page's children, keyed so a re-read can reuse every one that did not
  // change: the section headings by their text, the tiles by what they show.
  // (The bio block keys itself when it arrives.)
  function artistViewEntries(j) {
    const L = liveApi();
    const tileKey = (a) => "artist|" + (L ? L.tileKey(a) : JSON.stringify(a));
    const heading = (text) => ({ key: "hdr:" + text, build: () => {
      const hdr = document.createElement("div");
      hdr.className = "artist-section-header";
      hdr.textContent = text;
      return hdr;
    } });
    const out = [];
    const appears = artistViewAppears && artistViewAppears.length ? artistViewAppears : null;
    if (j.primary.length) {
      if ((appears || j.featured).length) out.push(heading("Albums"));
      for (const a of j.primary) out.push({ key: tileKey(a), build: () => window.__buildAlbumTile(a) });
    }
    if (appears) {
      out.push(heading("Appears on"));
      const shown = artistViewAppearsAll ? appears : appears.slice(0, APPEARS_SHOWN);
      for (const a of shown) out.push({ key: "appears|" + a.roles.join(",") + "|" + tileKey(a), build: () => appearsTile(a) });
      if (appears.length > APPEARS_SHOWN) out.push({ key: "appears-more:" + (artistViewAppearsAll ? "less" : "more"), build: () => appearsMore(appears.length) });
    } else if (j.featured.length) {
      out.push(heading("Also appears on"));
      for (const a of j.featured) out.push({ key: tileKey(a), build: () => window.__buildAlbumTile(a) });
    }
    return out;
  }
  // A record's tile as the grid's others are, with the artist's roles on it ("Played · Produced") under its artist.
  function appearsTile(a) {
    const el = window.__buildAlbumTile(a);
    const meta = el.querySelector(".album-meta");
    if (meta && a.roles && a.roles.length) {
      const line = document.createElement("div");
      line.className = "album-artist album-roles";
      line.textContent = a.roles.join(" · ");
      meta.appendChild(line);
      el.setAttribute("aria-label", (el.getAttribute("aria-label") || "") + " (" + a.roles.join(", ") + ")");
    }
    return el;
  }
  function appearsMore(n) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "more-toggle artist-appears-more";
    b.textContent = artistViewAppearsAll ? "Less" : `More (${n - APPEARS_SHOWN})`;
    b.addEventListener("click", () => {
      artistViewAppearsAll = !artistViewAppearsAll;
      if (artistViewData && artistViewName) paintArtistView(artistViewData, artistViewName);
    });
    return b;
  }
  // The page painted again from an answer, keeping every tile that did not change, the bio and the members where they
  // are, and the scroll where it was.
  function viewTotal(j) { return j.primary.length + (artistViewAppears && artistViewAppears.length ? artistViewAppears : j.featured).length; }
  function paintArtistView(j, name) {
    const L = liveApi();
    if (!L) return;
    const entries = artistViewEntries(j);
    for (const k of ["artist-members", "artist-bio"]) { const el = Array.prototype.find.call(grid.children, x => x.__tileKey === k); if (el) entries.unshift({ key: k, build: () => el }); }
    const mainEl = document.querySelector("main");
    const top = mainEl ? mainEl.scrollTop : 0;
    L.paintRow(grid, entries);
    if (mainEl && mainEl.scrollTop !== top) mainEl.scrollTop = top;
    artistCountBar(viewTotal(j), name);
  }
  // The artist's "Appears on" from the server: its list on "ok", null on any other answer (the page keeps "Also appears
  // on"). "pending" (the server still reading, past its wait) is asked again a few times while the same page is up.
  async function fetchAppears(name, seq) {
    for (let tries = 0; tries < 5; tries++) {
      const r = await fetch("/api/artist/appears-on?artist=" + encodeURIComponent(name));
      if (!r.ok) return null;
      const j = await r.json();
      if (seq !== appearsSeq) return null;
      if (j.status !== "pending") return j.status === "ok" && Array.isArray(j.albums) ? j.albums : null;
      await new Promise((res) => { setTimeout(res, 1000); });
      if (seq !== appearsSeq) return null;
    }
    return null;
  }
  async function loadAppears(name) {
    const seq = ++appearsSeq;
    try {
      const list = await fetchAppears(name, seq);
      if (seq !== appearsSeq || !artistViewActive || artistViewName !== name || !artistViewData) return;
      if (!list && !artistViewAppears) return;   // nothing shown, nothing to show: "Also appears on" as it was
      artistViewAppears = list;                  // a list, or (native mode gone off since) back to "Also appears on"
      paintArtistView(artistViewData, name);
    } catch (e) { /* offline or the server restarting: "Also appears on" stays, as it was before this section */ }
  }
  function resetAppears() {
    appearsSeq++;
    artistViewAppears = null;
    artistViewAppearsAll = false;
    artistViewData = null;
  }
  // "2 albums · The BeauBowBelles" — in the TOP BAR beside the brass <, where
  // every other screen names itself (v1.8.77, at the user's word). It was a
  // line of its own above the grid, while the bar beside Back kept the title
  // of the screen the artist was opened from.
  function artistCountBar(total, artistName) {
    if (countBar) countBar.classList.add("hidden");
    if (!albumCountTitleEl) return;
    albumCountTitleEl.textContent = `${total} album${total !== 1 ? "s" : ""} · ${artistName}`;
    albumCountTitleEl.classList.remove("hidden");
  }
  async function refreshArtistView() {
    const L = liveApi();
    if (!L || !artistViewActive || !artistViewName) return;
    const name = artistViewName;
    const seq = ++artistReadSeq;
    const stamp = L.stamp(ARTIST_VIEW_DEPS);
    try {
      const r = await fetch("/api/artist-albums?artist=" + encodeURIComponent(name));
      if (!r.ok) return;   // what is on screen stays; the next change retries
      const j = await r.json();
      if (!artistViewActive || artistViewName !== name || seq !== artistReadSeq) return;
      artistViewStamp = stamp;
      if (!(j.primary.length + j.featured.length)) return;  // an artist whose albums all left: keep the page rather than blank it mid-read
      artistViewData = j;
      paintArtistView(j, name);
      // The library changed, so its offsets may have: "Appears on" is asked again (the server keeps its own answer).
      if (artistViewAppears) loadAppears(name);
    } catch (e) {
      // Offline, or the server restarting: the page stays as it is.
    }
  }
  if (window.__live) {
    window.__live.on(() => {
      if (!artistViewActive || !artistViewName) return;
      if (artistViewStamp === window.__live.stamp(ARTIST_VIEW_DEPS)) return;
      window.__live.whenIdle("artist-view", refreshArtistView);
    });
  }

  // opts.restore === false: the caller is building its OWN screen (Home, a
  // fresh wall) and has already reset the view flags — putting the captured
  // screen and its flags back would fight that, e.g. re-arming the library
  // wall's paging over a Home screen. Drop the snapshot instead.
  function exitArtistView(opts) {
    if (!artistViewActive) return;
    artistViewActive = false;
    bioSeq++;   // any in-flight bio must not prepend into the restored screen
    resetAppears();
    if (saved && opts && opts.restore === false) {
      if (topbarBack) {
        if (saved.topbarBackLabel) topbarBack.setAttribute("aria-label", saved.topbarBackLabel);
        topbarBack.title = saved.topbarBackTitle || "";
      }
      saved = null;
      grid.innerHTML = "";
      // The artist view owns this bar; without clearing it, its "← Back"
      // button survives onto the screen the caller is about to show.
      if (countBar) { countBar.innerHTML = ""; countBar.classList.add("hidden"); }
      return;
    }
    // Restore exactly the screen the artist view was opened from (the Home
    // landing, or an album wall) so Back doesn't dump the user somewhere else.
    if (saved) {
      // Put the ORIGINAL NODES back — never re-parse an HTML string. Album
      // tiles carry their behaviour on the node itself (click + long-press
      // listeners, and a closure holding the album's offset/title used to open
      // and play it); serializing to markup and re-parsing drops all of that,
      // so the wall came back looking perfect with every tile dead. Moving live
      // nodes through a DocumentFragment keeps them intact.
      grid.innerHTML = "";
      grid.appendChild(saved.gridNodes);
      grid.classList.toggle("hidden", saved.gridHidden);
      if (homeView)     homeView.classList.toggle("hidden", saved.homeViewHidden);
      if (homeSections) homeSections.classList.toggle("hidden", saved.homeSectionsHidden);
      if (countBar) {
        countBar.innerHTML = "";
        countBar.appendChild(saved.countNodes);
        countBar.classList.toggle("hidden", saved.countHidden);
      }
      if (topbarBack) {
        topbarBack.classList.toggle("hidden", saved.topbarBackHidden);
        if (saved.topbarBackLabel) topbarBack.setAttribute("aria-label", saved.topbarBackLabel);
        topbarBack.title = saved.topbarBackTitle || "";
      }
      if (topbarRefresh) topbarRefresh.classList.toggle("hidden", saved.topbarRefreshHidden);
      if (topbarSearch)  topbarSearch.classList.toggle("hidden", saved.topbarSearchHidden);
      if (albumCountTitleEl) {
        albumCountTitleEl.textContent = saved.titleText || "";
        albumCountTitleEl.classList.toggle("hidden", saved.titleHidden);
      }
      // Re-arm the screens whose behaviour lives OUTSIDE the restored nodes:
      // the library wall's infinite scroll (parked on the way in, else it never
      // pages again) and the labels browser's chrome/mode.
      // Only re-arm the wall if nothing else entered it meanwhile (a fresh
      // entry bumps the sequence and owns the paging state now).
      const libSeqNow = window.__libraryWallSeq ? window.__libraryWallSeq() : 0;
      if (window.__restoreLibraryWall && saved.libraryWallSeq === libSeqNow) {
        window.__restoreLibraryWall(saved.libraryWallWasActive);
      }
      if (window.__unparkLabels) window.__unparkLabels(saved.labels);
      // ...and a plugin's screen (HQPlayer's poll), which lives outside its nodes too.
      if (window.RouenPlugins) window.RouenPlugins.resume();
      // Land back where the user was, not at the top of the wall.
      const mainEl = document.querySelector("main");
      if (mainEl && typeof saved.scrollTop === "number") mainEl.scrollTop = saved.scrollTop;
      // The screen just put back heard nothing while it was away: bring it up
      // to date where it stands (v1.8.65 — see liveCatchUp).
      if (window.__liveCatchUp) window.__liveCatchUp();
    }
    const back = saved && saved.fromAlbum;
    saved = null;
    // Opened from an album: back to that album, over the screen it was on.
    if (back && !(opts && opts.reopen === false) && window.__openAlbum) {
      window.__openAlbum(back.album, back.opts);
    }
  }
  // The shared Back beside the menu: while the artist view is up it steps out
  // of it (to the album it came from), ahead of its usual "go Home". Capture
  // phase, so it runs before — and stops — the Home listener.
  if (topbarBack) topbarBack.addEventListener("click", (e) => {
    if (!artistViewActive) return;
    e.stopImmediatePropagation();
    exitArtistView();
  }, true);

  async function showArtistAlbums(artistName, how) {
    const fromAlbum = (how && how.fromAlbum) || null;
    if (window.__leavePlaylistScreens) window.__leavePlaylistScreens({ keepChrome: true });
    if (!artistName) return;
    // Drop any active/pending search (incl. the delayed external-sources fetch)
    // — reachable from the album-modal artist link with a search still live,
    // which would otherwise append external rows under this view's grid. The
    // search artist-chip stops the search itself; this covers every other path.
    if (window.__clearSearchIfActive) window.__clearSearchIfActive();
    // Artist → album → artist chaining: put the FIRST screen back before
    // capturing, so what we snapshot below is the real originating screen (and
    // its live view flags), not a half-torn-down artist view.
    if (artistViewActive) exitArtistView({ reopen: false });
    // The artist view takes over the shared grid (and snapshot-restores it on
    // Back) — park the library wall's infinite scroll so it can't append into
    // this view, remembering whether it was live so Back can re-arm it.
    const libraryWallWasActive = window.__leaveLibraryWall ? !!window.__leaveLibraryWall() : false;
    const libraryWallSeq = window.__libraryWallSeq ? window.__libraryWallSeq() : 0;
    // Same for the labels browser: park its chrome (bar, sheets, select modes)
    // but keep the mode/label it was showing so Back restores it whole.
    const labels = window.__parkLabels ? window.__parkLabels() : null;
    // A multi-select started on the previous wall must not leak in here — its
    // action bar would stay on screen and this view's tiles would select
    // instead of open. Runs BEFORE the capture so the restored screen comes
    // back with its selection cleared in both the DOM and the state.
    if (window.__exitAlbumSelectMode) window.__exitAlbumSelectMode();
    // Invalidate any in-flight bio fetch NOW — bumping only inside
    // renderArtistBioHead left a window where artist A's late bio could
    // prepend into artist B's freshly-rendered grid.
    bioSeq++;
    // Snapshot the screen we're leaving (Home landing or an album wall) so the
    // "← Back" button restores it exactly.
    // Move the live nodes out into fragments rather than copying markup — see
    // exitArtistView for why (tile listeners + album identity live on the nodes).
    // Read the scroll position BEFORE the grid is drained. Moving every tile
    // out collapses <main> to a couple of hundred pixels, and a scroller that
    // no longer has the range CLAMPS its scrollTop to 0 there and then — so
    // reading it after the drain stored 0 every time, and the restore below
    // faithfully put 0 back. The comment at the bottom of exitArtistView has
    // always said "land back where the user was"; it never could.
    const mainEl = document.querySelector("main");
    const savedScrollTop = mainEl ? mainEl.scrollTop : 0;
    const gridNodes = document.createDocumentFragment();
    while (grid.firstChild) gridNodes.appendChild(grid.firstChild);
    const countNodes = document.createDocumentFragment();
    if (countBar) while (countBar.firstChild) countNodes.appendChild(countBar.firstChild);
    saved = {
      gridNodes,
      countNodes,
      libraryWallWasActive,
      libraryWallSeq,
      labels,
      scrollTop:          savedScrollTop,
      gridHidden:         grid.classList.contains("hidden"),
      homeViewHidden:     homeView     ? homeView.classList.contains("hidden")     : true,
      homeSectionsHidden: homeSections ? homeSections.classList.contains("hidden") : true,
      countHidden:        countBar ? countBar.classList.contains("hidden") : true,
      topbarBackHidden:    topbarBack    ? topbarBack.classList.contains("hidden")    : true,
      topbarRefreshHidden: topbarRefresh ? topbarRefresh.classList.contains("hidden") : true,
      topbarSearchHidden:  topbarSearch  ? topbarSearch.classList.contains("hidden")  : true,
      // The grid screen's title. The artist view replaces it with the artist's
      // name while it is up, and the screen it came from gets its own back.
      titleText:   albumCountTitleEl ? albumCountTitleEl.textContent : "",
      titleHidden: albumCountTitleEl ? albumCountTitleEl.classList.contains("hidden") : true,
      topbarBackLabel:     topbarBack ? topbarBack.getAttribute("aria-label") : null,
      topbarBackTitle:     topbarBack ? topbarBack.title : "",
      fromAlbum,
    };
    artistViewActive = true;
    // Reveal the shared album grid and leave the Home landing / search results.
    // The search artist-chip calls stopSearch() first, which hides the grid and
    // re-shows the Home sections; without this the artist albums would render
    // into a hidden grid behind the Home rows (the reported bug).
    if (homeView)     homeView.classList.add("hidden");
    if (homeSections) homeSections.classList.add("hidden");
    grid.classList.remove("hidden");
    // The shared Back — the < beside the menu, as on every other screen —
    // takes this view back (see the capture listener above); Refresh and
    // Search don't belong here.
    if (topbarBack) {
      topbarBack.classList.remove("hidden");
      topbarBack.setAttribute("aria-label", fromAlbum ? "Back to the album" : "Back");
      topbarBack.title = fromAlbum ? "Back to the album" : "Back";
    }
    if (topbarRefresh) topbarRefresh.classList.add("hidden");
    if (topbarSearch)  topbarSearch.classList.add("hidden");
    // The artist's name beside Back, as every other screen names itself there
    // — not the title of the screen this was opened from. On a desktop that
    // was the genre still sitting behind the album popup, so the bar said
    // "Rock" over Radiohead's albums (reported). Back puts the old title back.
    if (albumCountTitleEl) {
      albumCountTitleEl.textContent = artistName;
      albumCountTitleEl.classList.remove("hidden");
    }

    // Loading: the name is in the bar already (above); the count joins it
    // when the albums arrive. The line above the grid stays out of the way —
    // it is only used again to say a read failed.
    if (countBar) countBar.classList.add("hidden");
    grid.innerHTML = "";

    // This artist is the one on screen now: a read still in flight for the
    // previous one — this page's first load or a live re-read — must not paint.
    artistViewName = artistName;
    resetAppears();
    const mySeq = ++artistReadSeq;
    const L = liveApi();
    const stamp = L ? L.stamp(ARTIST_VIEW_DEPS) : null;
    try {
      const r = await fetch("/api/artist-albums?artist=" + encodeURIComponent(artistName));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (!artistViewActive || mySeq !== artistReadSeq) return;
      artistViewStamp = stamp;
      artistViewData = j;
      const total = j.primary.length + j.featured.length;

      artistCountBar(total, artistName);

      if (!total) {
        const empty = document.createElement("div");
        empty.className = "artist-view-empty";
        empty.textContent = `No albums found for "${artistName}"`;
        grid.appendChild(empty);
        return;
      }

      // Keyed as they are built (artistViewEntries), so the first live re-read
      // can reuse them rather than rebuild the page.
      const frag = document.createDocumentFragment();
      for (const e of artistViewEntries(j)) {
        const el = e.build();
        el.__tileKey = e.key;
        frag.appendChild(el);
      }
      grid.appendChild(frag);

      // Artist header (avatar + validated bio) loads after the albums so the
      // grid is never blocked on external services. One of the artist's own
      // album titles pins their identity for the lookup (see /api/artist-bio).
      const bioAlbum = (j.primary[0] && j.primary[0].title) ||
                       (j.featured[0] && j.featured[0].title) || "";
      renderArtistBioHead(artistName, bioAlbum);
      window.RouenAlbumCredits.members(artistName, grid, { mine: () => artistViewActive && artistViewName === artistName, open: (n) => showArtistAlbums(n) });
      loadAppears(artistName);
    } catch (e) {
      if (!artistViewActive || mySeq !== artistReadSeq) return;   // another page owns the bar now
      if (countBar) {
        countBar.classList.remove("hidden");
        countBar.innerHTML = `<span class="count-text" style="color:var(--danger)"></span>`;
        countBar.querySelector(".count-text").textContent = "Error: " + e.message;
      }
    }
  }

  // Build the LMS-style artist header: round avatar, bio with Show more,
  // "Bio: <source>" attribution. Decorative — any failure leaves the plain
  // album grid, and a view/artist switch mid-fetch renders nothing stale.
  async function renderArtistBioHead(artistName, albumTitle) {
    const seq = bioSeq;   // generation is bumped by showArtistAlbums/exitArtistView, not here
    try {
      const r = await fetch("/api/artist-bio?artist=" + encodeURIComponent(artistName) +
                            "&album=" + encodeURIComponent(albumTitle || ""));
      if (!r.ok) return;
      const j = await r.json();
      const b = j.bio;
      if (!b || !b.text) return;
      if (seq !== bioSeq || !artistViewActive) return;   // superseded / view closed

      // LMS-remote layout: large centred round portrait on top, bio beneath
      // it full-width, then a centred Show more and a centred "Bio: <source>"
      // caption — not a thumbnail beside the text.
      const head = document.createElement("div");
      head.className = "artist-bio-head";
      if (b.image) {
        const img = document.createElement("img");
        img.className = "artist-bio-avatar";
        img.alt = "";
        img.onerror = () => img.remove();   // dead portrait URL — no broken-image circle
        img.src = b.image;
        head.appendChild(img);
      }
      const body = document.createElement("div");
      body.className = "artist-bio-body";
      const text = document.createElement("div");
      text.className = "bio-text";
      text.dataset.clipped = "true";
      text.textContent = b.text;
      const foot = document.createElement("div");
      foot.className = "artist-bio-foot";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "bio-toggle hidden";
      toggle.textContent = "Show more";
      const src = document.createElement("span");
      src.className = "artist-bio-src";
      src.textContent = b.source ? "Bio: " + b.source : "";
      foot.appendChild(toggle); foot.appendChild(src);
      body.appendChild(text); body.appendChild(foot);
      head.appendChild(body);
      head.__tileKey = "artist-bio";   // a live re-read of the albums keeps it where it is
      grid.prepend(head);
      if (window.__setupBioToggle) window.__setupBioToggle(text, toggle);
    } catch (e) { /* bio is decorative — the album grid stands alone */ }
  }

  window.__showArtistAlbums = showArtistAlbums;
  window.__exitArtistView   = exitArtistView;
  window.__artistViewActive = () => artistViewActive;
})();
