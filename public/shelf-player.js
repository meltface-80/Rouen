// @ts-check
/*
 * shelf-player.js — playing from the Shelf: the zone it plays in, what that
 * zone is playing, the bar along the foot of the page (v1.9.3, v1.9.10), the
 * album in front and the tracks chosen on its back sent to play, and the zone
 * chooser. Moved out of shelf.js in v1.9.66, behaviour unchanged.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded after shelf-volume.js and before shelf.js, which creates it with the
 * page's hub (h: the shelf's own state and helpers, and the other parts):
 *
 *   const player = ShelfPlayer.create(h);
 *   player.poll()          what the zone plays now, and the bar drawn for it
 *   player.toPlaying(), player.afterPlay(), player.volClose(), player.closeZones()
 *   player.zoneId(), player.zoneKnown(), player.zoneName(), player.zoneTried(),
 *   player.zoneList(), player.np(), player.zonesOpen()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, clamp, mod, jget, toast, storeGet, storeSet, imageUrl } = h;

    // ---- Playing ---------------------------------------------------------------------
    const ZONE_KEY = "rra-shelf-zone";
    let zoneId = new URLSearchParams(location.search).get("zone") || storeGet(ZONE_KEY) || storeGet("rra-zone") || null;
    let zoneList = [];
    let zoneName = "";
    let zoneKnown = false;    // zoneId is a zone the server answered for
    let firstNowPlaying = true;
    // Throws when Rouen doesn't answer: that is a blip, not "no zones", and the
    // callers keep what they had.
    async function pickZone() {
      const j = await jget("/api/zones");
      zoneList = j.zones || [];
      if (!zoneList.length) return null;
      const hit = zoneId && zoneList.find((z) => z.zone_id === zoneId || (z.display_name || "").toLowerCase() === String(zoneId).toLowerCase());
      if (hit) return hit.zone_id;
      const active = zoneList.find((z) => z.state === "playing" || z.state === "loading");
      return (active || zoneList[0]).zone_id;
    }
    let zoneTried = false;    // Rouen has answered a poll, so "no zone" means none, not "not yet asked"
    async function pollNowPlaying() {
      try {
        if (!zoneKnown) {
          const resolved = await pickZone();
          if (!resolved) { zoneName = ""; paintNowPlaying(null, null); return; }
          zoneId = resolved;
          zoneKnown = true;
        }
        const j = await jget("/api/zone-state?zone=" + encodeURIComponent(zoneId));
        const zone = j && j.zone;
        if (!zone) { zoneKnown = false; zoneName = ""; paintNowPlaying(null, null); return; }   // gone (regrouped): picked again next time
        zoneName = zone.display_name || ((zoneList.find((z) => z.zone_id === zoneId) || {}).display_name) || "";
        paintNowPlaying(zone, zone.now_playing || null);
      } catch (e) { /* poll blip — the next one retries */ }
    }
    let npArtKey = null;
    function paintNowPlaying(zone, np) {
      // Set BEFORE anything below runs: the queue is told from here, and must
      // know it is hearing an answer. Not on a blip — then nothing is known.
      zoneTried = true;
      // Only on opening: once the shelf has been touched, or a few seconds have
      // gone, a record starting somewhere must not pull the shelf from under you.
      const ready = h.pick.ready(), readyAt = h.pick.readyAt();
      if (firstNowPlaying && ready && (Date.now() - readyAt > 15000 || h.ways.idleAt() > readyAt)) firstNowPlaying = false;
      $("#mt-zone").textContent = zoneName || (zone || zoneList.length ? "Choose a zone" : "No zones found");
      $("#mt-title").textContent = np ? (np.line1 || "") : (zone ? "Nothing playing" : "");
      $("#mt-artist").textContent = np ? (np.line2 || "") : "";
      paintTransport(zone, np);
      const key = np && np.image_key ? np.image_key : null;
      if (key !== npArtKey) {
        npArtKey = key;
        $("#mt-art").innerHTML = key ? `<img src="${imageUrl(key, 120)}" alt="">` : "";
        const img = $("#mt-art img");
        if (img) img.addEventListener("error", () => img.remove());   // no art (or no Core): the plain square
      }
      // The first time the shelf is open and something is playing, that album is
      // put in front — the record on the platter, pulled from the shelf.
      if (firstNowPlaying && ready && np && np.line3) {
        firstNowPlaying = false;
        const i = playingIndex(np);
        if (i > -1 && h.mode === "idle" && !h.drag) { h.p = h.target = i; h.kick(); h.updateInfo(true); }
      } else if (ready && zone) {
        firstNowPlaying = false;
      }
      h.queue.moved(zone);
    }
    // ---- The transport bar (v1.9.3): the remote's mini player, fixed and flat ---
    // Previous, play/pause and next, the position along the bar's top edge, the
    // album in front's Play now and Queue (v1.9.10), the zone and volume.
    // The position is the poll's, carried on by the clock between polls while
    // the zone plays, so the line moves every second rather than every four.
    let tZone = null, tNp = null, tAt = 0;
    function playingNow() { return !!tZone && (tZone.state === "playing" || tZone.state === "loading"); }
    function paintTransport(zone, np) {
      tZone = zone; tNp = np; tAt = Date.now();
      const playing = playingNow();
      const pp = $("#mt-pp");
      pp.disabled = !zone;
      pp.setAttribute("aria-label", playing ? "Pause" : "Play");
      // Previous and next (v1.9.10, from Mandarin v0.8.27): only where the zone
      // says it can — no previous on radio, no next at the end of the queue.
      $("#mt-prev").disabled = !zone || !zone.is_previous_allowed;
      $("#mt-next").disabled = !zone || !zone.is_next_allowed;
      $("#mt-play").classList.toggle("hidden", playing);
      $("#mt-pause").classList.toggle("hidden", !playing);
      volSync(zone);
      paintProgress();
    }
    function paintProgress() {
      const len = tNp && Number(tNp.length);
      let pos = tNp && Number(tNp.seek_position);
      if (!len || !Number.isFinite(pos)) { $("#mt-fill").style.width = "0"; return; }
      if (playingNow()) pos += (Date.now() - tAt) / 1000;
      $("#mt-fill").style.width = (clamp(pos / len, 0, 1) * 100).toFixed(2) + "%";
    }
    setInterval(() => { if (!document.hidden && playingNow()) paintProgress(); }, 1000);
    // Where the track is now, the poll's position carried on by the clock.
    function positionNow() {
      let pos = tNp ? Number(tNp.seek_position) : NaN;
      if (Number.isFinite(pos) && playingNow()) pos += (Date.now() - tAt) / 1000;
      return pos;
    }
    $("#mt-pp").addEventListener("click", async () => {
      if (!zoneKnown) return;
      const was = { zone: tZone, np: tNp };
      const playing = playingNow();
      // Shown at once; the poll that follows says what the zone really did. The
      // position is taken forward first, or pausing would draw the line back to
      // where the last poll left it.
      if (tZone) {
        const np = tNp && Number.isFinite(positionNow()) ? Object.assign({}, tNp, { seek_position: positionNow() }) : tNp;
        paintTransport(Object.assign({}, tZone, { state: playing ? "paused" : "playing" }), np);
      }
      if (!(await control("playpause"))) {
        // Not done: put the button back as it was (control() has said why).
        if (was.zone) paintTransport(was.zone, was.np);
        return;
      }
      setTimeout(pollNowPlaying, 400);
    });
    // A transport command to the zone in the bar: true when Roon took it,
    // otherwise false, having said why. Play/pause, previous and next share it.
    async function control(command) {
      try {
        const r = await fetch("/api/control", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone_or_output_id: zoneId, command })
        });
        if (r.ok) return true;
        toast(r.status === 503 ? "Roon isn’t connected right now" : "That didn’t work. Try again.");
      } catch (e) {
        toast("Rouen didn’t answer. Try again.");
      }
      return false;
    }
    // Previous and next: sent, and the poll that follows shows the track it
    // moved to. Neither is guessed at on screen first — what "previous" does
    // (back a track, or to the start of this one) is Roon's to say.
    async function skip(command) {
      if (zoneKnown && (await control(command))) setTimeout(pollNowPlaying, 400);
    }
    $("#mt-prev").addEventListener("click", () => skip("previous"));
    $("#mt-next").addEventListener("click", () => skip("next"));
    // A tap on the playing record brings it to the front of the shelf — when it
    // is on this shelf. Near: the shelf turns to it; far: it is put there.
    function toPlaying() {
      if (!tZone) { toast("Choose a zone to play in first"); return; }
      if (!tNp) { toast("Nothing is playing"); return; }
      // Radio or a stream: a track with no album to find.
      if (!tNp.line3) { toast("What’s playing isn’t an album on this shelf"); return; }
      const i = playingIndex(tNp);
      if (i < 0) { toast("The playing record isn’t on this shelf"); return; }
      if (h.mode === "spin") h.stopSpin();
      h.flippedV = null;
      const here = Math.round(h.p), N = h.N;
      let to = i;
      if (h.wrap()) { const d = mod(i - here + N / 2, N) - N / 2; to = here + Math.round(d); }
      if (Math.abs(to - h.p) > 30) { h.p = h.target = to; h.vp = 0; h.mode = "idle"; h.kick(); h.updateInfo(true); h.settled(); }
      else { h.vp = 0; h.settleTo(to); }
    }
    $("#mt-info").addEventListener("click", toPlaying);

    // The volume sheet (public/shelf-volume.js since v1.9.10). Reached through
    // two hoisted functions, so the shelf and the bar above can close or repaint
    // it without reading the const before its line.
    const volSheet = window.ShelfVolume.create({ zone: () => tZone, zoneId: () => zoneId, clamp, onOpen: () => closeZones() });
    function volClose() { volSheet.close(); }
    function volSync(zone) { volSheet.sync(zone); }

    // The playing record on the shelf. Whole credited NAMES agree, never "contains
    // the artist" (which opened Bonnie "Prince" Billy's album for Prince) — the
    // remote's own rule for the same job (app.js, the now-playing album link).
    // The playing line is the TRACK artist, so a compilation's names nobody on
    // the album's credit; a title only one album has is still that album.
    const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const creditNames = (s) => String(s || "").split(/ \/ |\/| feat\.? | featuring | ft\.? |,| & | \+ | and /i).map(normName).filter(Boolean);
    function playingIndex(np) {
      const title = normName(np.line3), list = h.list;
      if (!title) return -1;
      const wanted = creditNames(np.line2);
      const sameTitle = (a) => normName(a.t) === title;
      const i = list.findIndex((a) => sameTitle(a) && wanted.some((w) => creditNames(a.a).includes(w)));
      if (i > -1) return i;
      const only = list.filter(sameTitle);
      return only.length === 1 ? list.indexOf(only[0]) : -1;
    }
    // A zone to play in, or the zone list opened and false.
    async function needZone() {
      // a zone given by name (?zone=Kitchen) is turned into its id first
      if (!zoneKnown) await pollNowPlaying();
      if (!zoneKnown) { toast("Choose a zone to play in first"); openZones(); return false; }
      return true;
    }
    async function act(kind, btn) {
      const a = h.centre();
      if (!a) return;
      if (!(await needZone())) return;
      btn.disabled = true;
      try {
        const r = await fetch("/api/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offset: a.o,
            // Identity travels with the play (stale-offset defense; see /api/play).
            title: a.t, subtitle: a.a,
            zone_or_output_id: zoneId, kind,
            filter_type: "", filter_value: "", filter_parent: ""
          })
        });
        if (r.ok) {
          const where = zoneName ? " in " + zoneName : "";
          toast(kind === "play_now" ? `Playing ${a.t}${where}` : `${a.t} added to the queue${where}`);
          setTimeout(afterPlay, 1200);
        } else if (r.status === 409) {
          toast("That album isn’t in your Roon library any more");
          h.pick.loadLibrary();
        } else if (r.status === 503) {
          toast("Roon isn’t connected right now");
        } else {
          toast("That didn’t work. Try again.");
        }
      } catch (e) {
        toast("Rouen didn’t answer. Try again.");
      } finally {
        btn.disabled = false;
      }
    }
    $("#actions").addEventListener("click", (e) => { const b = e.target.closest(".act"); if (b) act(b.dataset.act, b); });

    // The chosen tracks, from their buttons under the cover (v1.9.4; v1.9.68) — one request
    // per track, as the remote's album view sends a selection: Play now plays
    // the first that goes and queues the rest behind it (play_now for each
    // would leave the last one playing alone), Play next sends them last to
    // first so they land in album order, Queue adds them in album order.
    let picksBusy = false;
    async function playPicks(kind) {
      const tsel = h.back.tsel(), tracksOf = h.back.tracksOf, endPicks = h.back.endPicks;
      if (!tsel || picksBusy) return;
      const sel = tsel, a = sel.album, st = tracksOf.get(sel.key);
      // Its list was found stale and forgotten: nothing here can be trusted to
      // play. Said, and the choosing ended, rather than a button that does nothing.
      if (!st || !st.tracks) { toast("Turn the case over again to read its tracks."); endPicks(); return; }
      // Busy from the first moment — before the zone is looked up — or two quick
      // taps both get through and every track is sent twice.
      picksBusy = true;
      const btns = document.querySelectorAll("#tsel [data-tact]");
      for (const b of btns) b.disabled = true;
      const sent = [];
      let order = [], why = "", stale = false;
      try {
        if (!(await needZone())) return;
        order = [...sel.picks].sort((x, y) => x - y);
        if (kind === "play_next") order.reverse();
        for (let k = 0; k < order.length; k++) {
          const i = order[k], t = st.tracks[i];
          if (!t) continue;
          if (order.length > 3) toast(`Adding track ${k + 1} of ${order.length}…`);
          let r;
          try {
            r = await fetch("/api/play-track", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                offset: a.o, track: i, title: t.title || "",
                zone_or_output_id: zoneId,
                kind: kind === "play_now" && sent.length ? "queue" : kind,
                // Identity travels with the play (stale-offset defense).
                album_title: a.t, album_subtitle: a.a,
                filter_type: "", filter_value: "", filter_parent: ""
              })
            });
          } catch (e) { why = "Rouen didn’t answer."; break; }
          if (r.ok) { sent.push(i); continue; }
          // The list on the back is not the album's any more: every index after
          // this one is as wrong, so stop, forget the list, and end the choosing.
          if (r.status === 409) { why = "This album’s tracks have changed in Roon — turn the case over again."; tracksOf.delete(sel.key); stale = true; break; }
          if (r.status === 503) { why = "Roon isn’t connected right now."; break; }
          if (!why) why = "Roon refused a track.";
        }
      } finally {
        picksBusy = false;
        for (const b of btns) b.disabled = false;
      }
      if (stale && h.back.tsel() === sel) endPicks();
      if (!sent.length) { toast(why || "That didn’t work. Try again."); return; }
      const where = zoneName ? " in " + zoneName : "";
      const what = sent.length === 1 ? "1 track" : `${sent.length} tracks`;
      let msg = kind === "play_now" ? `Playing ${what}${where}`
        : kind === "play_next" ? `${what} play${sent.length === 1 ? "s" : ""} next${where}`
        : `${what} added to the queue${where}`;
      if (sent.length < order.length) msg += ` — ${order.length - sent.length} didn’t go. ${why}`;
      toast(msg);
      // What went is done with. What did not stays chosen, to try again — and so
      // does anything chosen while these were on their way.
      if (h.back.tsel() === sel) {
        for (const i of sent) sel.picks.delete(i);
        if (!sel.picks.size) endPicks(); else h.back.paintPicks();
      }
      setTimeout(afterPlay, 1200);
    }
    // What a play changed: the player, and the queue if it is open (a track
    // added to the end moves nothing the player shows when the Core does not
    // say how much is queued).
    async function afterPlay() {
      const seq = h.queue.seq();
      await pollNowPlaying();
      // once: the poll has already read the queue if it saw it move
      if (h.queue.isOpen() && h.queue.seq() === seq) h.queue.load(true);
    }
    $("#tsel").addEventListener("click", (e) => { const b = e.target.closest("[data-tact]"); if (b) playPicks(b.dataset.tact); });
    $("#tsel-clear").addEventListener("click", () => h.back.endPicks());

    // the zone chooser
    const zonesEl = $("#zones");
    function openZones() {
      pickZone().catch(() => false).then((ok) => {
        // a failed read says so, rather than claiming there are no zones
        if (ok === false && !zoneList.length) { toast("Rouen didn’t answer. Try again in a moment."); return; }
        zonesEl.innerHTML = '<p>Play in</p>' + (zoneList.length
          ? zoneList.map((z) => `<button type="button" role="menuitemradio" data-zone="${esc(z.zone_id)}" aria-checked="${z.zone_id === zoneId ? "true" : "false"}">${esc(z.display_name)}<small>${z.state === "playing" ? "Playing" : z.state === "paused" ? "Paused" : ""}</small></button>`).join("")
          : '<p>No zones found</p>');
        zonesEl.classList.remove("hidden");
        volClose();
        $("#mt-zone-btn").setAttribute("aria-expanded", "true");
      });
    }
    function closeZones() { zonesEl.classList.add("hidden"); $("#mt-zone-btn").setAttribute("aria-expanded", "false"); }
    $("#mt-zone-btn").addEventListener("click", (e) => { e.stopPropagation(); if (zonesEl.classList.contains("hidden")) openZones(); else closeZones(); });
    zonesEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const b = e.target.closest("button[data-zone]");
      if (!b) return;
      zoneId = b.dataset.zone;
      zoneKnown = true;
      storeSet(ZONE_KEY, zoneId);
      // The choice rides along to the wall display, which follows ?zone= too.
      try { const u = new URL(location.href); u.searchParams.set("zone", zoneId); window.history.replaceState(null, "", u.pathname + u.search); }
      catch (err) { /* an old browser without URL: the choice still holds on this page */ }
      closeZones();
      pollNowPlaying();
    });
    document.addEventListener("click", (e) => { if (!zonesEl.classList.contains("hidden") && !e.target.closest("#zones")) closeZones(); });

    return { poll: pollNowPlaying, toPlaying, afterPlay, volClose, closeZones,
      zoneId: () => zoneId, zoneKnown: () => zoneKnown, zoneName: () => zoneName, zoneTried: () => zoneTried,
      zoneList: () => zoneList, np: () => tNp, zonesOpen: () => !zonesEl.classList.contains("hidden") };
  }

  window.ShelfPlayer = { create };
})();
