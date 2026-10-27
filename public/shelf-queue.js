// @ts-check
/*
 * shelf-queue.js — the Shelf's queue pane (v1.9.5): what the zone in the bar
 * will play, read while the pane is open, and played from any track in it.
 * Moved out of shelf.js in v1.9.66, behaviour unchanged.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h: the
 * shelf's own state and helpers, and the other parts, the player's zone
 * among them):
 *
 *   const queue = ShelfQueue.create(h);
 *   queue.setOpen(on), queue.isOpen(), queue.load(silent), queue.moved(zone)
 *   queue.seq(), queue.armed(), queue.disarm()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, jget, toast, imageUrl } = h;

    // ---- The queue -------------------------------------------------------------------
    // What the zone in the player will play: the track playing, then the rest.
    // Read from /api/queue (one subscribe, answered, unsubscribed — see there)
    // when the pane opens, when the zone changes, when the poll says the zone's
    // queue has moved (a track ended, something was added — the remote's own
    // signal, v1.8.65), after this page plays something, and every 30 s as a
    // floor for what none of those see (a reorder in Roon's own app).
    let qOpen = false;       // the pane is open: read only while it can be seen
    let qSeq = 0;
    let qShown = null;        // the zone whose queue is on screen
    let qSig = null;          // what is on screen, to skip a redraw of the same
    let qItems = [];
    let qArmed = null;        // the queue_item_id offering "Play from here"
    let qWatch = null;        // the poll's view of the queue, to see it move
    const fmtLen = (secs) => {
      secs = Math.max(0, Math.round(Number(secs) || 0));
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
      return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
    };
    function qMessage(text) { const m = $("#q-msg"); m.textContent = text; m.classList.toggle("hidden", !text); }
    function qClear(text) {
      qShown = null; qSig = null; qItems = []; qArmed = null;
      $("#q-list").textContent = "";
      $("#q-sum").textContent = "";
      qMessage(text);
    }
    async function loadQueue(silent) {
      if (!qOpen) return;
      $("#q-zone").textContent = h.player.zoneKnown() ? h.player.zoneName() : "";
      if (!h.player.zoneKnown() || !h.player.zoneId()) {
        qClear(!h.player.zoneTried() ? "Reading the queue…" : h.player.zoneList().length ? "Choose a zone in the player below to see its queue." : "No zones found.");
        return;
      }
      const zone = h.player.zoneId(), seq = ++qSeq;
      // another zone's list must not stand in for this one's while it is read
      if (qShown !== zone) qClear("Reading the queue…");
      try {
        const j = await jget("/api/queue?zone=" + encodeURIComponent(zone));
        if (seq !== qSeq || !qOpen || zone !== h.player.zoneId()) return;
        drawQueue(zone, Array.isArray(j.items) ? j.items : []);
      } catch (e) {
        if (seq !== qSeq || !qOpen || zone !== h.player.zoneId()) return;
        // a blip under a list already shown: keep it; the next read puts it
        // right. Not Roon gone (503): a list that can no longer be played from
        // is not kept up as though it could.
        if (silent && qShown === zone && e.status !== 503) return;
        qClear(e.status === 503 ? "Roon isn’t connected right now." : "The queue couldn’t be read.");
      }
    }
    const QUEUE_CAP = 100;   // index.js's subscribe_queue(zoneId, 100, …)
    const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
    function drawQueue(zone, items) {
      const sig = JSON.stringify([!!h.player.np(), items]);
      qShown = zone;
      if (sig === qSig) return;
      qSig = sig;
      qItems = items;
      let total = 0;
      for (const it of items) if (Number(it.length) > 0) total += Number(it.length);
      // /api/queue reads the first 100 (index.js, subscribe_queue): a list
      // that long may be longer, and its total is then not known either
      const capped = items.length >= QUEUE_CAP;
      $("#q-sum").textContent = !items.length ? ""
        : capped ? `${QUEUE_CAP}+ tracks`
        : `${items.length} track${items.length === 1 ? "" : "s"}${total ? " · " + fmtLen(total) : ""}`;
      qMessage(items.length ? "" : "Nothing is queued.");
      // Roon's queue starts at the track it is on — "now playing" only while
      // the zone has one; a stopped zone's first track is simply next
      const playing = !!h.player.np();
      const ol = $("#q-list"), top = ol.scrollTop, frag = document.createDocumentFragment();
      // a row or its button with the keyboard's focus keeps it across the redraw
      const had = ol.contains(document.activeElement) ? document.activeElement : null;
      const hadRow = had && had.closest("li.q-row");
      const focusQid = hadRow ? hadRow.dataset.qid : null, focusGo = !!(had && had.classList.contains("q-go"));
      items.forEach((it, i) => {
        const now = playing && i === 0;
        if (i === 0 || (playing && i === 1)) {
          const head = document.createElement("li");
          head.className = "q-h";
          head.textContent = now ? "Now playing" : "Up next";
          frag.appendChild(head);
        }
        const li = document.createElement("li");
        li.className = "q-row" + (now ? " now" : "");
        li.dataset.qid = String(it.queue_item_id);
        const art = it.image_key ? `<img src="${imageUrl(it.image_key, 120)}" alt="" loading="lazy">` : "";
        const len = Number(it.length) > 0 ? fmtLen(it.length) : "";
        li.innerHTML = `<button class="q-item" type="button"><span class="q-art">${art}</span>`
          + `<span class="q-text"><span class="q-t">${esc(it.title || "")}</span><span class="q-a">${esc(it.subtitle || "")}</span></span>`
          + `<span class="q-len">${len}</span></button>`
          + (now ? "" : `<button class="act primary q-go" type="button">${PLAY_SVG}Play from here</button>`);
        frag.appendChild(li);
      });
      ol.textContent = "";
      ol.appendChild(frag);
      ol.scrollTop = top;
      // a track offered before the list was read again is offered still, if it
      // is still to come
      if (qArmed !== null) {
        const li = [...ol.querySelectorAll("li.q-row")].find((x) => x.dataset.qid === qArmed);
        if (li && !li.classList.contains("now")) li.classList.add("armed"); else qArmed = null;
      }
      if (focusQid !== null) {
        const li = [...ol.querySelectorAll("li.q-row")].find((x) => x.dataset.qid === focusQid);
        const el = li && li.querySelector(focusGo && li.classList.contains("armed") ? ".q-go" : ".q-item");
        if (el) el.focus({ preventScroll: true });
      }
    }
    function disarm() {
      qArmed = null;
      for (const x of document.querySelectorAll("#q-list .armed")) x.classList.remove("armed");
    }
    // the offer, scrolled into the list's view if it opened below its edge —
    // the list only, never the page (the window must never scroll)
    function revealIn(ol, li) {
      // measured on screen: offsetTop counts from the pane, not the list, and
      // would scroll by everything above the list too
      const box = ol.getBoundingClientRect();
      const over = li.getBoundingClientRect().bottom - (box.top + ol.clientTop + ol.clientHeight);
      if (over > 0) ol.scrollTop += over + 8;
    }
    $("#q-list").addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
    $("#q-list").addEventListener("click", (e) => {
      const li = e.target.closest(".q-row");
      if (!li) return;
      if (e.target.closest(".q-go")) { playFromHere(li, e.target.closest(".q-go")); return; }
      // the track playing: the record it is from, brought to the front, as a tap
      // on the player does
      if (li.classList.contains("now")) { disarm(); h.player.toPlaying(); return; }
      const was = li.classList.contains("armed");
      disarm();
      if (!was) { li.classList.add("armed"); qArmed = li.dataset.qid; revealIn($("#q-list"), li); }
    });
    let qBusy = false;
    async function playFromHere(li, btn) {
      const it = qItems.find((x) => String(x.queue_item_id) === li.dataset.qid);
      const zone = qShown;
      if (qBusy || !it || !zone) return;
      qBusy = true;
      btn.disabled = true;
      try {
        const r = await fetch("/api/play-from-here", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone_or_output_id: zone, queue_item_id: it.queue_item_id })
        });
        if (r.ok) {
          toast(`Playing from ${it.title || "here"}`);
          disarm();
          // Roon a moment to move, then both the player and the list
          setTimeout(h.player.afterPlay, 600);
        } else {
          toast(r.status === 503 ? "Roon isn’t connected right now" : "That didn’t work. Try again.");
        }
      } catch (e) {
        toast("Rouen didn’t answer. Try again.");
      } finally {
        qBusy = false;
        btn.disabled = false;
      }
    }
    // Called by every poll: the zone's queue has moved when the track, the
    // count still queued or shuffle changes — or the zone itself.
    function queueMoved(zone) {
      const np = zone && zone.now_playing;
      const sig = JSON.stringify([h.player.zoneKnown() ? h.player.zoneId() : null, np ? [np.line1, np.line2, np.line3, np.length] : null,
        zone && Number.isFinite(zone.queue_items_remaining) ? zone.queue_items_remaining : null,
        !!(zone && zone.settings && zone.settings.shuffle)]);
      if (qOpen) $("#q-zone").textContent = h.player.zoneKnown() ? h.player.zoneName() : "";
      if (sig === qWatch) return;
      qWatch = sig;
      if (qOpen) loadQueue(true);
    }
    setInterval(() => { if (qOpen && !document.hidden) loadQueue(true); }, 30000);
    // Opened or closed (shelf-panes.js's setQueue, which slides the pane): read only
    // while it can be seen, so a closed pane costs the Core nothing.
    function setOpen(on) {
      qOpen = !!on;
      if (qOpen) loadQueue(false); else disarm();
    }

    return { setOpen, load: loadQueue, moved: queueMoved, disarm,
      isOpen: () => qOpen, seq: () => qSeq, armed: () => qArmed !== null };
  }

  window.ShelfQueue = { create };
})();
