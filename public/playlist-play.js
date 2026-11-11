// @ts-check
// Play now and Queue on a playlist's page follow the Sort (v2.0.3-t11, dev/design/playlist-artists.md §7). The owner,
// 2026-11-09: "Sort-by order doesnt change the playback order. Roon doesn't have this so the reverse code cannot be
// used. Anyway to get around this".
//
// Roon can play a whole playlist, in its own order, or one track of it. So with the rows sorted, the tracks are sent
// one at a time in the order on the screen: the first Roon accepts plays (or queues), the rest queue behind it.
//
//   A Roon playlist: Rouen's server sends them (POST /api/playlist/play-ordered), since a long playlist takes minutes
//     and a phone does not keep a page awake that long. The page asks how far it has got, and the button pressed is
//     the run's Stop meanwhile. In Playlist order nothing changes: Roon's own single action, as before.
//   A playlist made in Rouen: its tracks were always sent one at a time, from this page (moved here from app.js); now
//     in the order on the screen.
//
// test/dom/playlist-play.test.js, test/dom/playlist-play-states.test.js.
(function () {
  "use strict";
  /** @type {any} */
  const W = window;
  const POLL_MS = 1500;
  /** Polls that fail one after another before the page stops asking (30 s). The run itself goes on, on the server. */
  const GIVE_UP_POLLS = 20;
  /** A toast that ends something minutes long is read later than it lands (app.js's TOAST_REPORT_MS). */
  const REPORT_MS = 9000;
  /** The button pressed is the run's Stop the moment the run starts: the second tap of a double tap is not a Stop. */
  const ARM_MS = 800;

  /** @param {string} msg @param {string | null} [kind] @param {number} [ms]  how long it stays; the app's own time when not given */
  const toast = (msg, kind, ms) => {
    if (W.RouenHost) W.RouenHost.toast(msg, kind, ms);
  };
  /** The zone in use, as every screen reads it (app.js). @returns {string} */
  const zoneNow = () => (W.__selectedZoneId ? W.__selectedZoneId() : "") || "";
  const plural = (/** @type {number} */ n) => `${n} track${n === 1 ? "" : "s"}`;
  const post = (/** @type {string} */ url, /** @type {any} */ body) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ask = (/** @type {string} */ zone) =>
    fetch(`/api/playlist/play-ordered/status?zone=${encodeURIComponent(zone)}`, { cache: "no-store" });

  /**
   * The page's tracks as its rows stand now, and whether that is other than the playlist's own order.
   * @param {HTMLElement} wrap @param {Array<any>} tracks  in the playlist's order, as the rows were built from them
   */
  function shown(wrap, tracks) {
    const ol = /** @type {HTMLElement | null} */ (wrap.querySelector("ol.playlist-tracks"));
    if (!ol || !ol.dataset.sort || ol.dataset.sort === "order") return { sorted: false, list: tracks };
    // __order: the row's place in the playlist, set by playlist-tracks.js when it adds the Sort.
    const list = /** @type {any[]} */ (Array.from(ol.children)).map((li) => tracks[li.__order]).filter(Boolean);
    return { sorted: list.length > 0, list: list.length ? list : tracks };
  }

  /**
   * A button switched off for the length of a request. Switching it off takes the focus it had (a keyboard's place on
   * the page), so what this returns gives both back.
   * @param {HTMLButtonElement} btn
   */
  function busy(btn) {
    const had = document.activeElement === btn;
    btn.disabled = true;
    btn.dataset.busy = "1";
    return () => {
      delete btn.dataset.busy;
      btn.disabled = false;
      if (had && btn.isConnected) btn.focus({ preventScroll: true });
    };
  }

  // ---- A Roon playlist: the server's run, watched ------------------------------------------------------------------

  /**
   * One run this page is watching: a zone's, by its id. Its buttons are found in `wrap` each time they are drawn, so
   * a page opened again while its run goes on takes it over by giving its own wrap.
   * @typedef {{ zone: string, id: string, wrap: HTMLElement, job: any, fails: number, timer: any, since: number,
   *             stopping: boolean }} Watch
   * @type {Map<string, Watch>}
   */
  const watching = new Map();

  /** @param {HTMLElement} wrap @returns {HTMLButtonElement[]} */
  const buttons = (wrap) => /** @type {any[]} */ (Array.from(wrap.querySelectorAll(".playlist-actions > .action-btn[data-kind]")));

  /**
   * The first of `forms` the button has room for, written only when it changes. The button cuts what does not fit at
   * both ends (it centres its text), which turned "999 of 1000" into "999 of 100" on a small phone.
   * @param {HTMLButtonElement} b @param {string[]} forms  longest first @param {string} spoken
   */
  function say(b, forms, spoken) {
    if (b.dataset.said !== forms[0]) {
      b.dataset.said = forms[0];
      for (const f of forms) {
        b.textContent = f;
        if (b.scrollWidth <= b.clientWidth) break;
      }
    }
    if (b.getAttribute("aria-label") !== spoken) b.setAttribute("aria-label", spoken);
  }

  /**
   * The buttons as the zone in use has them: its run's Stop and count when this page watches one, else as built.
   * @param {HTMLElement} wrap
   */
  function render(wrap) {
    const w = watching.get(zoneNow());
    const on = w && w.wrap === wrap ? w : null;
    for (const b of buttons(wrap)) {
      if (!b.dataset.label) b.dataset.label = b.textContent || "";
      if (on && b.dataset.kind === on.job.kind) {
        // The page's grid is announced as it changes; a count that moves every poll is not for reading out.
        if (b.parentElement) b.parentElement.setAttribute("aria-live", "off");
        b.dataset.run = on.zone;
        b.disabled = on.stopping;
        const sent = on.job.sent, total = on.job.total;
        if (on.stopping) say(b, ["Stopping…"], "Stopping");
        else say(b, [`Stop · ${sent} of ${total}`, `Stop · ${sent}/${total}`, "Stop"], `Stop sending tracks: ${sent} of ${total} sent`);
        continue;
      }
      if (b.dataset.run || b.dataset.said) {
        delete b.dataset.run;
        delete b.dataset.said;
        b.textContent = b.dataset.label;
        b.removeAttribute("aria-label");
      }
      if (!b.dataset.busy) b.disabled = !!on;        // the other button waits while a run goes
    }
  }

  /** @param {Watch} w */
  function drop(w) {
    clearTimeout(w.timer);
    if (watching.get(w.zone) === w) watching.delete(w.zone);
    render(w.wrap);
  }

  /** The run has ended: the buttons back, and how it went. @param {Watch} w @param {any} job */
  function finish(w, job) {
    drop(w);
    const lost = job.failed ? ` (${job.failed} couldn't be found: ${job.first_error})` : "";
    const sort = job.failed ? "error" : null;
    // Stopped here, or by a Play now on the zone ("other"): how far it had got, of the tracks tried.
    if (job.stopped === "user" || job.stopped === "other") {
      toast(`Stopped after ${job.sent} of ${plural(job.total)}${lost}`, sort, REPORT_MS);
    } else if (!job.queued) {
      toast(job.first_error || "Roon refused those tracks", "error", REPORT_MS);
    } else if (job.stopped) {
      toast(`Stopped after ${job.sent} of ${plural(job.total)}: Roon refused ${job.failed} (${job.first_error})`, "error", REPORT_MS);
    } else if (job.failed) {
      toast(`Sent ${job.queued} of ${plural(job.total)}${lost}`, "error", REPORT_MS);
    } else {
      toast(`Sent all ${plural(job.total)} in the order shown`, null, REPORT_MS);
    }
  }

  /** @param {Watch} w */
  async function poll(w) {
    let job = null, ok = false;
    try {
      const r = await ask(w.zone);
      if (r.ok) { job = (await r.json()).job; ok = true; }
    } catch (e) { /* offline, or the server restarting: counted below, and asked again */ }
    if (watching.get(w.zone) !== w) return;          // stopped, or another run took the zone, while this was out
    if (!ok) {
      if (++w.fails >= GIVE_UP_POLLS) {
        drop(w);
        toast("Couldn't reach the extension; it may still be sending the tracks", "error", REPORT_MS);
        return;
      }
    } else {
      w.fails = 0;
      // No run, or another's: the server restarted, or the zone was given a run from another device.
      if (!job || job.id !== w.id) { drop(w); return; }
      if (job.done) { finish(w, job); return; }
      w.job = job;
      render(w.wrap);
    }
    w.timer = setTimeout(() => poll(w), POLL_MS);
  }

  /**
   * @param {string} zone @param {any} job @param {HTMLElement} wrap
   * @param {boolean} pressed  started by a press just now (its Stop is not armed at once), not taken up as the page opened
   */
  function watch(zone, job, wrap, pressed) {
    const old = watching.get(zone);
    if (old && old.id === job.id) {                  // the page opened again: its buttons are the run's now
      old.wrap = wrap;
      old.job = job;
      render(wrap);
      return;
    }
    if (old) drop(old);
    /** @type {Watch} */
    const w = { zone, id: job.id, wrap, job, fails: 0, timer: null, since: pressed ? Date.now() : 0, stopping: false };
    watching.set(zone, w);
    render(wrap);
    w.timer = setTimeout(() => poll(w), POLL_MS);
  }

  /** @param {HTMLButtonElement} btn  the run's Stop @param {HTMLElement} wrap */
  async function stop(btn, wrap) {
    const w = watching.get(btn.dataset.run || "");
    if (!w) { render(wrap); return; }
    if (Date.now() - w.since < ARM_MS) return;
    const had = document.activeElement === btn;
    w.stopping = true;
    render(w.wrap);
    try {
      // By its id: a run another device has started on the zone since is not this page's to stop.
      const r = await post("/api/playlist/play-ordered/stop", { zone_or_output_id: w.zone, id: w.id });
      const j = await r.json().catch(() => ({}));
      if (watching.get(w.zone) === w) {
        if (r.ok && j.job && j.job.id === w.id && j.job.done) finish(w, j.job);
        else if (r.ok) drop(w);                      // nothing of this page's is running there any more
        else toast(j.error || "Couldn't stop that", "error");
      }
    } catch (e) {
      toast("Couldn't reach the extension", "error");
    }
    w.stopping = false;
    if (watching.get(w.zone) === w) render(w.wrap);
    if (had && btn.isConnected) btn.focus({ preventScroll: true });
  }

  // The zone changed in the picker: the buttons are the new zone's (a run on the old one goes on, and is reported).
  document.addEventListener("change", (e) => {
    const t = /** @type {HTMLElement | null} */ (e.target);
    if (t && t.id === "zone-select") for (const w of Array.from(watching.values())) render(w.wrap);
  });

  /**
   * Play now / Queue for a Roon playlist's page.
   * @param {{ offset: number, title: string, tracks: Array<{ index: number, title?: string }>, wrap: HTMLElement,
   *           plain: (kind: string, btn: HTMLButtonElement) => void }} o
   *   tracks: as /api/playlist gave them; wrap: the page, its buttons carrying data-kind; plain: Roon's own action
   *   for the whole playlist, used whenever the rows are in the playlist's order
   * @returns {(kind: string, btn: HTMLButtonElement) => void}
   */
  function roon(o) {
    // Shuffle (2.0.4-t4; gert_mogensen, the Roon forum, 2026-11-10: "And maybe a Shuffle play in playlist?"): Roon's own
    // Shuffle of the whole playlist, beside Play now and Queue, which app.js builds as soon as this returns.
    queueMicrotask(() => shuffleButton(o));
    // A run already going for this playlist on the zone in use (the page left and come back to, or reloaded). By its
    // name: the place in Roon's list is a hint that moves when a playlist is added above it.
    const zone = zoneNow();
    if (zone) {
      ask(zone).then((r) => (r.ok ? r.json() : null)).then((j) => {
        const job = j && j.job, mine = watching.get(zone);
        if (!job || job.done || job.title !== o.title || !o.wrap.isConnected) return;
        if (mine && mine.id !== job.id) return;      // a run started from this page while this was out: the newer one
        watch(zone, job, o.wrap, false);
      }).catch(() => { /* not reachable now: the buttons stay Play now and Queue, which is what they do */ });
    }
    return async (kind, btn) => {
      if (btn.dataset.run) { stop(btn, o.wrap); return; }
      const now = shown(o.wrap, o.tracks);
      if (!now.sorted) { o.plain(kind, btn); return; }
      const z = zoneNow();
      if (!z) { toast("Choose a zone first", "error"); return; }
      const free = buttons(o.wrap).map(busy);        // both: a second run started beside the first replaces it
      let job = null;
      try {
        const r = await post("/api/playlist/play-ordered", { offset: o.offset, title: o.title, zone_or_output_id: z, kind,
          tracks: now.list.map((t) => ({ index: t.index, title: t.title || "" })) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.job) job = j.job;
        else toast(j.error || "Roon refused that", "error");
      } catch (e) {
        toast("Couldn't reach the extension", "error");
      }
      for (const f of free) f();
      if (!job) return;
      toast(`Sending ${plural(job.total)} in the order shown…`);
      watch(z, job, o.wrap, true);
    };
  }

  /**
   * Shuffle after Queue, when the playlist has Roon's Play menu (Play now and Queue are there): Roon's own Shuffle of
   * the whole playlist, whatever the Sort, as a playlist's Shuffle is in Roon. No data-kind: a run in the order shown
   * never takes it over.
   * @param {{ wrap: HTMLElement, plain: (kind: string, btn: HTMLButtonElement) => void }} o
   */
  function shuffleButton(o) {
    const row = o.wrap.querySelector(".playlist-actions");
    const queue = row && row.querySelector('.action-btn[data-kind="queue"]');
    if (!row || !queue || row.querySelector(".playlist-shuffle")) return;
    // A square button with Roon's shuffle mark, as the ⋯ beside it: Play now and Queue keep their width on a phone (a
    // run's "Stop · 999 of 1000" needs it).
    const b = document.createElement("button");
    b.type = "button";
    b.className = "overflow-btn playlist-shuffle";
    b.setAttribute("aria-label", "Shuffle");
    b.title = "Shuffle";
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>' +
      '<polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
    b.addEventListener("click", () => o.plain("shuffle", b));
    queue.insertAdjacentElement("afterend", b);
  }

  // ---- A playlist made in Rouen: sent from this page ---------------------------------------------------------------

  /**
   * Play now / Queue for a playlist made in Rouen: its tracks one at a time, in the order on the screen. Sequential by
   * necessity: /api/play-track has no batch form, and sending them side by side would queue them in any order.
   * @param {{ tracks: Array<any>, wrap: HTMLElement }} o  tracks: as /api/user-playlist gave them
   * @returns {(kind: string, btn: HTMLButtonElement) => Promise<void>}
   */
  function own(o) {
    return async (kind, btn) => {
      const zone = zoneNow();
      if (!zone) { toast("Choose a zone first", "error"); return; }
      const tracks = shown(o.wrap, o.tracks).list;
      if (!tracks.length) { toast("Nothing in this playlist", "error"); return; }
      btn.disabled = true;
      let queued = 0, failed = 0, firstError = "";
      try {
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          if (tracks.length > 3) toast(`Adding track ${i + 1} of ${tracks.length}…`);
          try {
            const r = await post("/api/play-track", {
              offset: t.album_offset, track: t.track_index, title: t.title,
              zone_or_output_id: zone,
              // The kind asked goes to the first track Roon accepts; the rest queue behind it. (Until v2.0.3-t11 it
              // went to the first tried, so a Play now whose first track was gone queued the rest and played nothing.)
              kind: queued === 0 ? kind : "queue",
              album_title: t.album_title, album_subtitle: t.album_subtitle });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { failed++; if (!firstError) firstError = j.error || `HTTP ${r.status}`; }
            else queued++;
          } catch (e) {
            failed++;
            if (!firstError) firstError = "Couldn't reach the extension";
          }
        }
      } finally {
        btn.disabled = false;
      }
      if (!queued) { toast(firstError || "Roon refused those tracks", "error", REPORT_MS); return; }
      let msg = `${kind === "queue" ? "Queued" : "Playing"} ${plural(queued)}`;
      if (failed) msg += ` (${failed} couldn't be found: ${firstError})`;
      toast(msg, failed ? "error" : null, REPORT_MS);
    };
  }

  W.RouenPlaylistPlay = { roon, own };
})();
