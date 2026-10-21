// @ts-check
/*
 * hqp/core.js — HQPlayer control, the side-menu screen: the screen's constants
 * and state, its small helpers, and the DOM it builds (hqpBuild), with the
 * HQPlayer, DAC and zone pickers at its top.
 *
 * Part of the HQPlayer plugin (dev/design/plugins.md §5), whose control logic
 * is hqpweb's, by statelycurmudgeon (MIT — lib/hqp/LICENSE). Moved out of
 * public/app.js in v1.9.19 with its behaviour unchanged: what lived in
 * app.js's closure lives on the plugin's namespace, H (window.RouenHQP), and
 * what it borrowed from app.js comes from window.RouenHost. Loaded, in order,
 * only while the plugin is on (public/plugins.js).
 */
(function () {
  // The plugin's namespace, and the three flags app.js kept before v1.9.19.
  const H = window.RouenHQP = { hqpActive: false, hqpSeq: 0, hqpTimer: null };
  const Host = window.RouenHost;

  // ===========================================================================
  // HQPLAYER (v1.8.74)
  //
  // A screen for HQPlayer's DSP — the 1x and Nx filters, the modulator (SDM)
  // or dither (PCM), the volume, presets and undo — for a Roon that plays
  // through HQPlayer. The control logic is hqpweb's, by statelycurmudgeon
  // (MIT), ported to the server in lib/hqp/. This is the page, and it is kept
  // thin on purpose: the SERVER resolves names to HQPlayer's list indices,
  // applies, reads HQPlayer's settings back (an OK from HQPlayer proves
  // nothing), watches playback, rolls a change back if it stops or cannot
  // keep up, and works out the warning each picker shows beside each choice.
  // The page asks, shows what came back, and says what happened.
  //
  // Live by polling /api/hqp/now every 1.5 s while the screen is open — and
  // that poll is also what keeps the server polling HQPlayer, so leaving the
  // screen (leavePlaylistScreens) stops both.
  // ===========================================================================
  H.HQP_POLL_MS = 1500;
  H.HQP_PLAYBACK = ["Stopped", "Paused", "Playing", "Stopping"];
  H.HQP_RISKY = ["mode", "rate", "filterNx", "filter1x", "shaper"];
  H.HQP_FIELD = {
    mode: "Mode", rate: "Output rate", filterNx: "Nx filter", filter1x: "1x filter", volume: "Volume",
    invert: "Invert", filter20k: "20 kHz filter", adaptive: "Adaptive volume", convolution: "Convolution",
    matrixProfile: "Matrix profile",
  };
  H.hqpNow = null;           // the last /api/hqp/now answer
  H.hqpLost = false;         // this app's own server stopped answering
  H.hqpCaps = null;          // the lists and their warnings (/api/hqp/capabilities)
  H.hqpCapsLoading = false;
  H.hqpCapsError = null;     // why the lists could not be read, while they cannot
  H.hqpCapsWait = 0;         // ms before asking again after a failure: 3 s, doubling to 30 s
  H.hqpCapsRetryAt = 0;      // not before then — a failure is not asked again on every poll
  H.hqpWrites = 0;           // changes answered so far: a poll sent before one is not trusted after it
  H.hqpBusy = false;         // a change is running
  H.hqpMsg = null;           // { kind: ok|warn|error|info, text }
  H.hqpMsgTimer = null;
  H.hqpSlowSince = null;     // when playback first dipped below 0.97× real time
  H.hqpBehind = 0;           // polls in a row with HQPlayer's own speed below 1× (hqpweb: 3 before the alarm)
  H.hqpPresetLine = "";      // what the Presets row says
  H.hqpEls = null;           // the screen's live nodes
  // The picker's chips (hqpweb 0.1.0-alpha.2): "compatible" hides the filters
  // the fixed output rate rules out, on by default; the others narrow by
  // HQPlayer's own guide. Kept for the visit, so reopening the list keeps them.
  H.hqpPickChips = { compatible: true, top: false, focus: "", apod: false };

  H.hqpNameAt = (list, i) => {
    const hit = (list || []).find((x) => x.index === i);
    return hit ? hit.name : "";
  };
  H.hqpIsSdm = () => !!(H.hqpCaps && H.hqpCaps.mode && String(H.hqpCaps.mode.name).startsWith("SDM"));
  H.hqpFieldLabel = (f) => (f === "shaper" ? (H.hqpIsSdm() ? "Modulator" : "Dither") : (H.HQP_FIELD[f] || f));
  /** "DSD256", "384 kHz", "1.536 MHz"; 0 is "Auto". */
  H.hqpFmtRate = function hqpFmtRate(hz, modeName) {
    if (!hz) return "Auto";
    if (String(modeName || "").startsWith("SDM") && hz % 44100 === 0) return "DSD" + hz / 44100;
    if (hz >= 1000000) return +(hz / 1000000).toFixed(4) + " MHz";
    return +(hz / 1000).toFixed(1) + " kHz";
  };
  H.hqpShow = function hqpShow(field, v) {
    if (field === "rate") return H.hqpFmtRate(Number(v), H.hqpCaps && H.hqpCaps.mode ? H.hqpCaps.mode.name : "");
    if (field === "volume") return Number(v).toFixed(1) + " dB";
    if (typeof v === "boolean") return v ? "on" : "off";
    return v === "" ? "none" : String(v);
  };

  // What a change did, in one line. Ported from hqpweb's describe().
  // `fromRoon`: Roon was the source when the change was made.
  H.hqpDescribe = function hqpDescribe(r, fromRoon) {
    const base = H.hqpDescribeCore(r, fromRoon);
    if (!r.skipped || !r.skipped.length) return base;
    const sk = r.skipped.map((x) => H.hqpFieldLabel(x.field) + " (" + x.reason + ")").join("; ");
    return Object.assign({}, base, { kind: "warn", text: base.text + " · Skipped: " + sk });
  };
  H.hqpDescribeCore = function hqpDescribeCore(r, fromRoon) {
    if (r.rolledBack) {
      const rb = r.rolledBack;
      const back = rb.results.map((x) => H.hqpFieldLabel(x.field) + " back to " + H.hqpShow(x.field, x.actual)).join(", ");
      // The rollback puts back what it can; anything it could not is said.
      const missed = rb.skipped && rb.skipped.length
        ? "Couldn't put back: " + rb.skipped.map((x) => H.hqpFieldLabel(x.field) + " (" + x.reason + ")").join("; ") + "."
        : "";
      const rec = rb.playback || {};
      // Measured by hqpweb (5.35.10): from HQPlayer's own playlist it does not
      // resume by itself and nothing resumes it reliably, so the listener
      // chooses — Restart playback, below. Roon resumes by itself, or is
      // resumed in Roon. (hqpweb 0.1.0-beta.2; it no longer says HQPlayer
      // "may need a restart".)
      const stopped = rec.kind !== "playing" && rec.kind !== "not-checked";
      // An overloaded HQPlayer can stop answering altogether, and then no undo
      // reaches it (hqpweb, af08939: "don't overpromise rollback"). Said as
      // what it is — tried, not done — with the one thing that helps then.
      const unreached = rec.kind === "inconclusive" && /^couldn't roll back/.test(rec.detail || "");
      const tail = unreached
        ? "HQPlayer didn't answer, so the old settings may not be back (" + rec.detail.replace(/^couldn't roll back: /, "") +
          "). If it won't play, restart HQPlayer, and check its volume afterwards."
        : rec.kind === "playing" ? "Playback resumed."
        : !stopped ? ""
        : fromRoon ? "Playback stopped (" + rec.detail + "): resume it in Roon."
        : "Playback stopped (" + rec.detail + "): restart it below. If it still won't play, restart HQPlayer.";
      const why = r.incompatible
        ? [r.incompatible.text + ".", back ? back + "." : "", missed, tail, "That is one of HQPlayer's own rules, not a limit of this machine."]
        : [r.playback.detail + ".", back ? back + "." : "", missed, tail, "Noted here as failed; you can clear that in Settings → HQPWeb."];
      return { kind: "warn", text: (unreached ? "Tried to undo it: " : "Undone: ") + why.filter(Boolean).join(" "),
               restart: stopped && !unreached && !fromRoon };
    }
    const failed = r.results.filter((x) => !x.applied);
    const notes = r.results.filter((x) => x.note).map((x) => H.hqpFieldLabel(x.field) + " " + x.note);
    if (failed.length) {
      return {
        kind: "warn",
        text: failed.map((x) => H.hqpFieldLabel(x.field) + ": asked for " + H.hqpShow(x.field, x.requested) +
                                ", HQPlayer reports " + H.hqpShow(x.field, x.actual)).concat(notes).join(" · "),
      };
    }
    if (!r.results.length) return { kind: "warn", text: "Nothing was applied" };
    const done = r.results.map((x) => H.hqpFieldLabel(x.field) + " → " + H.hqpShow(x.field, x.actual)).join(", ");
    const pb = r.playback.kind === "playing" ? "playback OK"
      : r.playback.kind === "not-checked" && /^nothing/.test(r.playback.detail || "") ? "not playing, so not checked"
      : r.playback.kind === "inconclusive" ? "playback not checked (" + r.playback.detail + ")" : "";
    return { kind: "ok", text: ["✓ " + done, pb].concat(notes).filter(Boolean).join(" · ") };
  };

  H.hqpSetMsg = function hqpSetMsg(m, sticky) {
    H.hqpMsg = m;
    clearTimeout(H.hqpMsgTimer);
    // A result fades after 30 s, as hqpweb's footer does; an Undo button that
    // is still valid stays. "Applying…" stays until it is answered.
    if (m && !sticky) H.hqpMsgTimer = setTimeout(() => { H.hqpMsg = null; H.hqpRender(); }, 30000);
  };

  H.hqpEl = function hqpEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // Write a node only when what it shows has changed. Each poll rewrote some
  // thirty nodes and attributes on a screen where nothing had moved — and the
  // result line is role="status", which a screen reader announces again
  // whenever its text is replaced, even by the same text.
  H.hqpSetText = function hqpSetText(el, s) { if (el.textContent !== s) el.textContent = s; };
  H.hqpSetProp = function hqpSetProp(el, k, v) { if (el[k] !== v) el[k] = v; };
  H.hqpSetData = function hqpSetData(el, k, v) { if (el.dataset[k] !== v) el.dataset[k] = v; };

  // The screen, built once per visit as live nodes; hqpRender() only updates them.
  H.hqpBuild = function hqpBuild() {
    const root = H.hqpEl("div", "hqp-screen");
    const els = { root };
    els.notice = H.hqpEl("div", "hqp-notice hidden");
    els.noticeText = H.hqpEl("p", "hqp-notice-text");
    els.noticeBtn = H.hqpEl("button", "settings-update-btn hqp-notice-btn hidden", "Open Settings → HQPWeb");
    els.noticeBtn.type = "button";
    els.noticeBtn.addEventListener("click", () => {
      if (window.__openSettingsPane) window.__openSettingsPane("hqplayer");
    });
    // How to restart an HQPlayer that has stopped answering (hqpweb's recovery):
    // overload builds over minutes, and then nothing can reach it to undo anything.
    els.noticeRestart = H.hqpEl("details", "hqp-restart hidden");
    els.noticeRestart.appendChild(H.hqpEl("summary", "", "If it doesn't come back within a minute"));
    els.noticeRestartBody = H.hqpEl("div", "");
    els.noticeRestart.appendChild(els.noticeRestartBody);
    els.notice.appendChild(els.noticeText);
    els.notice.appendChild(els.noticeRestart);
    els.notice.appendChild(els.noticeBtn);

    // Which HQPlayer, and which DAC behind it (v1.8.85) — shown only when
    // there is a choice. Above the notice, so an HQPlayer that has stopped
    // answering can still be switched away from.
    els.pickers = H.hqpEl("div", "hqp-pickers hidden");
    const picker = (label, aria, onPick) => {
      const box = H.hqpEl("label", "hqp-picker hidden");
      box.appendChild(H.hqpEl("span", "", label));
      const wrap = H.hqpEl("div", "settings-select-wrap");
      const sel = H.hqpEl("select", "settings-select");
      sel.setAttribute("aria-label", aria);
      sel.addEventListener("change", () => onPick(sel.value));
      wrap.appendChild(sel);
      box.appendChild(wrap);
      els.pickers.appendChild(box);
      return { box, sel };
    };
    els.playerPick = picker("HQPlayer", "Which HQPlayer", (id) =>
      H.hqpSwitch("/api/hqp/players/" + encodeURIComponent(id) + "/select", {}));
    els.dacPick = picker("DAC", "Which DAC HQPlayer is using", (dac) =>
      H.hqpSwitch("/api/hqp/players/" + encodeURIComponent((H.hqpNow && H.hqpNow.active) || "") + "/dac", { dac }));
    root.appendChild(els.pickers);
    root.appendChild(els.notice);

    els.panel = H.hqpEl("div", "hqp-panel hidden");
    root.appendChild(els.panel);

    // ---- what is playing, and how ----
    const head = H.hqpEl("div", "hqp-head");
    els.dot = H.hqpEl("span", "hqp-dot");
    els.dot.setAttribute("aria-hidden", "true");
    els.name = H.hqpEl("span", "hqp-name");
    els.engine = H.hqpEl("span", "hqp-engine");
    head.appendChild(els.dot); head.appendChild(els.name); head.appendChild(els.engine);
    els.panel.appendChild(head);

    els.alert = H.hqpEl("p", "hqp-alert hidden");
    els.panel.appendChild(els.alert);

    els.track = H.hqpEl("div", "hqp-track hidden");
    els.trackArt = H.hqpEl("img", "hqp-track-art");
    els.trackArt.alt = "";
    els.trackArt.addEventListener("error", () => { els.trackArt.classList.add("hidden"); });
    const tt = H.hqpEl("div", "hqp-track-text");
    els.trackTitle = H.hqpEl("span", "hqp-track-title");
    els.trackSub = H.hqpEl("span", "hqp-track-sub");
    tt.appendChild(els.trackTitle); tt.appendChild(els.trackSub);
    els.track.appendChild(els.trackArt); els.track.appendChild(tt);
    els.panel.appendChild(els.track);

    const headline = H.hqpEl("div", "hqp-headline");
    els.rate = H.hqpEl("span", "hqp-rate");
    els.state = H.hqpEl("span", "hqp-state");
    headline.appendChild(els.rate); headline.appendChild(els.state);
    els.panel.appendChild(headline);
    els.sub = H.hqpEl("div", "hqp-sub");
    els.panel.appendChild(els.sub);
    els.health = H.hqpEl("div", "hqp-health");
    els.panel.appendChild(els.health);

    // HQPlayer's apodization and clip counters, once either is above 0
    // (hqpweb 0.1.0-alpha.2). Past 10 apodizations in a track the manual
    // suggests an apodizing filter, and the button opens the list narrowed to
    // them; with one already in use, the line says it is handling it.
    els.counters = H.hqpEl("div", "hqp-counters hidden");
    els.apod = H.hqpEl("span", "hqp-counter");
    els.clips = H.hqpEl("span", "hqp-counter");
    els.apodText = H.hqpEl("span", "hqp-counter-note");
    els.apodBtn = H.hqpEl("button", "hqp-link", "Choose an apodizing filter…");
    els.apodBtn.type = "button";
    els.apodBtn.addEventListener("click", () => {
      const slot = H.hqpNow && H.hqpNow.inUse === "Nx" ? "filterNx" : "filter1x";
      H.hqpPickChips = { compatible: H.hqpPickChips.compatible, top: false, focus: "", apod: true };
      H.hqpOpenPicker(slot);
    });
    els.counters.appendChild(els.apod); els.counters.appendChild(els.clips);
    els.counters.appendChild(els.apodText); els.counters.appendChild(els.apodBtn);
    els.panel.appendChild(els.counters);

    // The volume rose 10 dB or more without this app — HQPlayer restarting
    // comes back at its saved level (measured on v6: −3 dB).
    els.jump = H.hqpEl("div", "hqp-flag hidden");
    els.jumpText = H.hqpEl("p", "hqp-flag-text");
    const jumpActs = H.hqpEl("div", "hqp-flag-acts");
    els.jumpBack = H.hqpEl("button", "settings-update-btn hqp-flag-btn");
    els.jumpBack.type = "button";
    els.jumpBack.addEventListener("click", () => {
      const j = H.hqpNow && H.hqpNow.snapshot && H.hqpNow.snapshot.volumeJump;
      if (j) H.hqpApply({ volume: j.from });
    });
    els.jumpDismiss = H.hqpEl("button", "settings-update-btn hqp-flag-btn", "Dismiss");
    els.jumpDismiss.type = "button";
    els.jumpDismiss.addEventListener("click", async () => {
      try {
        await fetch("/api/hqp/volume-jump/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      } catch (e) {
        // The next poll still shows the flag, and Dismiss can be pressed again.
      }
      // A status asked for before the dismissal still carries the flag: not trusted after it.
      H.hqpWrites++;
      if (H.hqpNow && H.hqpNow.snapshot) delete H.hqpNow.snapshot.volumeJump;
      H.hqpRender();
    });
    jumpActs.appendChild(els.jumpBack); jumpActs.appendChild(els.jumpDismiss);
    els.jump.appendChild(els.jumpText); els.jump.appendChild(jumpActs);
    els.panel.appendChild(els.jump);

    // "The next track won't start": HQPlayer is stopped and the track queued
    // in its own playlist cannot play with this filter at this fixed rate.
    // HQPlayer itself just ignores Play. The fixes: a rate that fits, Auto.
    els.wedge = H.hqpEl("div", "hqp-flag is-bad hidden");
    els.wedgeText = H.hqpEl("p", "hqp-flag-text");
    els.wedgeActs = H.hqpEl("div", "hqp-flag-acts");
    els.wedge.appendChild(els.wedgeText); els.wedge.appendChild(els.wedgeActs);
    els.panel.appendChild(els.wedge);

    // No volume control here (v1.8.78): this screen set HQPlayer's own volume
    // beside Rouen's own slider for the Roon zone, which is the one to use.
    // What is kept from hqpweb protects the listener rather than duplicating
    // a control: the flag above when HQPlayer's volume jumps by itself, and
    // the engine's rule that an automatic undo never raises it.

    // ---- the quick controls ----
    const row = (field, label) => {
      const b = H.hqpEl("button", "hqp-row");
      b.type = "button";
      b.dataset.field = field;
      const l = H.hqpEl("span", "hqp-row-label", label);
      const hint = H.hqpEl("span", "hqp-row-hint hidden", "in use");
      l.appendChild(hint);
      const v = H.hqpEl("span", "hqp-row-value");
      const chev = H.hqpEl("span", "hqp-row-chev", "›");
      chev.setAttribute("aria-hidden", "true");
      b.appendChild(l); b.appendChild(v); b.appendChild(chev);
      return { b, l, hint, v };
    };
    els.panel.appendChild(H.hqpEl("h3", "hqp-section-title", "DSP"));
    els.rows = {};
    for (const [f, label] of [["filter1x", "1x filter"], ["filterNx", "Nx filter"], ["shaper", "Modulator"]]) {
      const r = row(f, label);
      r.b.addEventListener("click", () => H.hqpOpenPicker(f));
      els.rows[f] = r;
      els.panel.appendChild(r.b);
    }
    const pr = row("presets", "Presets");
    pr.b.addEventListener("click", H.hqpOpenPresets);
    els.rows.presets = pr;
    els.panel.appendChild(pr.b);
    els.panel.appendChild(H.hqpEl("p", "hqp-help",
      "1x is used for sources below 50 kHz (44.1 and 48k), Nx for higher rates. A preset is a saved set of " +
      "these, by name, so it works across modes and HQPlayers."));
    // With a fixed rate: the source rates the next album might use that the
    // current filters cannot play.
    els.otherSrc = H.hqpEl("p", "hqp-help hqp-other-src hidden");
    els.panel.appendChild(els.otherSrc);

    // ---- what the last change did, and the way back ----
    els.result = H.hqpEl("div", "hqp-result hidden");
    els.msg = H.hqpEl("p", "hqp-msg");
    els.msg.setAttribute("role", "status");
    els.undo = H.hqpEl("button", "settings-update-btn hqp-undo hidden", "Undo last change");
    els.undo.type = "button";
    els.undo.addEventListener("click", () => H.hqpRun("Undoing", "/api/hqp/undo", {}));
    els.restart = H.hqpEl("button", "settings-update-btn hqp-undo hidden", "Restart playback");
    els.restart.type = "button";
    els.restart.addEventListener("click", H.hqpRestart);
    els.result.appendChild(els.msg); els.result.appendChild(els.undo); els.result.appendChild(els.restart);
    els.panel.appendChild(els.result);

    // Whose work this is, said on the screen itself (v1.8.85) as well as in
    // Settings → HQPWeb, where the full thanks are.
    const foot = H.hqpEl("div", "hqp-foot");
    const credit = H.hqpEl("p", "hqp-foot-credit");
    credit.appendChild(document.createTextNode("♥ Built on "));
    const link = H.hqpEl("a", "", "hqpweb");
    link.href = "https://github.com/statelycurmudgeon/hqpweb";
    link.target = "_blank"; link.rel = "noopener noreferrer";
    credit.appendChild(link);
    credit.appendChild(document.createTextNode(", statelycurmudgeon's hard work — thank you. MIT licence."));
    foot.appendChild(credit);
    foot.appendChild(H.hqpEl("p", "", "Not affiliated with, endorsed by, or supported by " +
      "Signalyst. HQPlayer is a trademark of its owner, used here only to identify compatible software."));
    root.appendChild(foot);
    return els;
  };

  H.hqpNotice = function hqpNotice(text, withSettings, isError, restart) {
    const e = H.hqpEls;
    H.hqpSetText(e.noticeText, text);
    e.noticeRestart.classList.toggle("hidden", !restart);
    const key = restart ? JSON.stringify(restart) : "";
    if (restart && e.noticeRestart.dataset.key !== key) {
      e.noticeRestart.dataset.key = key;
      const ul = H.hqpEl("ul", "");
      for (const step of restart.steps) ul.appendChild(H.hqpEl("li", "", step));
      e.noticeRestartBody.replaceChildren(H.hqpEl("p", "", "It may be overloaded, or stopped. Restart it:"), ul, H.hqpEl("p", "", restart.after));
    }
    e.noticeBtn.classList.toggle("hidden", !withSettings);
    e.notice.classList.toggle("is-error", !!isError);
    e.notice.classList.toggle("hidden", false);
    e.panel.classList.toggle("hidden", true);
  };

  // The Roon zone to name over HQPlayer's status: the selected one if it plays
  // through HQPlayer, otherwise one that is playing, otherwise the first.
  H.hqpZoneLine = function hqpZoneLine(list) {
    if (!list || !list.length) return null;
    return list.find((z) => z.zone_id === Host.selectedZoneId) ||
           list.find((z) => z.state === "playing") || list[0];
  };

  // Switch HQPlayer or DAC, then read the screen again at once: the lists,
  // the warnings and the presets all belong to the new choice.
  H.hqpSwitch = async function hqpSwitch(url, body) {
    // Not while a change is being applied or watched: its result, and its
    // Undo, belong to the HQPlayer and DAC it was made on.
    if (H.hqpBusy) {
      H.hqpSetMsg({ kind: "warn", text: "Wait for the change to finish before switching." });
      H.hqpRender();
      return;
    }
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
    } catch (err) {
      H.hqpSetMsg({ kind: "error", text: "Couldn't switch: " + err.message });
    }
    H.hqpWrites++;
    H.hqpCaps = null;
    // A fresh poll loop under a new sequence number: the old one, possibly
    // mid-request, sees the number move and stops — clearTimeout alone left
    // it running beside the new one, one more loop per switch.
    clearTimeout(H.hqpTimer);
    H.hqpPoll(++H.hqpSeq);
  };

  // Fill a picker only when its choices change, so an open list is never
  // rebuilt under the finger by a poll.
  H.hqpFillPick = function hqpFillPick(p, items, value) {
    const show = items.length > 1;
    p.box.classList.toggle("hidden", !show);
    if (!show) return false;
    const key = JSON.stringify(items);
    if (p.sel.dataset.key !== key) {
      p.sel.dataset.key = key;
      p.sel.replaceChildren(...items.map((x) => { const o = H.hqpEl("option", "", x.name); o.value = x.id; return o; }));
    }
    H.hqpSetProp(p.sel, "value", value);
    return true;
  };

  H.hqpRenderPickers = function hqpRenderPickers(n) {
    const e = H.hqpEls;
    const players = n && n.enabled ? (n.players || []) : [];
    const dacs = n && n.enabled && n.configured ? (n.dacs || []).map((d) => ({ id: d.id, name: d.name || "DAC" })) : [];
    const a = H.hqpFillPick(e.playerPick, players, n ? n.active : "");
    const b = H.hqpFillPick(e.dacPick, dacs, n ? n.dac : "");
    e.pickers.classList.toggle("hidden", !a && !b);
  };
})();
