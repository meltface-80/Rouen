// @ts-check
/*
 * hqp/render.js — HQPlayer control, the side-menu screen: painting the screen
 * from the last status (hqpRender), the status poll, the lists and their
 * warnings, and running a change, an undo or a restart.
 *
 * Part of the HQPlayer plugin (dev/design/plugins.md §5), whose control logic
 * is hqpweb's, by statelycurmudgeon (MIT — lib/hqp/LICENSE). Moved out of
 * public/app.js in v1.9.19 with its behaviour unchanged: what lived in
 * app.js's closure lives on the plugin's namespace, H (window.RouenHQP), and
 * what it borrowed from app.js comes from window.RouenHost. Loaded, in order,
 * only while the plugin is on (public/plugins.js).
 */
(function () {
  const H = window.RouenHQP;
  const Host = window.RouenHost;

  H.hqpRender = function hqpRender() {
    const e = H.hqpEls;
    if (!e || !H.hqpActive) return;
    const n = H.hqpNow;
    H.hqpRenderPickers(n);
    if (!n) { H.hqpNotice("Connecting…", false); return; }
    if (n.enabled === false) {
      H.hqpNotice("HQPlayer isn't installed. Install it in Settings → Plugins.", false);
      return;
    }
    if (!n.configured) {
      H.hqpNotice("Add your HQPlayer in Settings → HQPlayer — find it on your network, or add it by its address.", true);
      return;
    }
    if (n.reachable === false) {
      H.hqpNotice((n.address ? "HQPlayer at " + n.address : "HQPlayer") + " isn't answering" +
                (n.error ? " (" + n.error + ")" : "") + ". Check that it is running, and the address in Settings → HQPlayer.",
                true, true, n.restart || null);
      return;
    }
    if (!n.snapshot) { H.hqpNotice("Connecting to HQPlayer…", false); return; }
    // toggle(, force), not add/remove: those rewrite the class attribute even
    // when it already says so (see hqpSetText).
    e.notice.classList.toggle("hidden", true);
    e.panel.classList.toggle("hidden", false);

    const st = n.snapshot.status;
    const state = n.snapshot.state;
    const latency = n.health ? n.health.latencyMs : null;
    const slow = latency !== null && latency > 1500;
    H.hqpSetData(e.dot, "state", H.hqpLost ? "lost" : slow ? "slow" : "live");
    H.hqpSetProp(e.dot, "title", H.hqpLost ? "Lost touch with Rouen's server; retrying…"
      : "Answering in " + (latency === null ? "?" : latency) + " ms" + (slow ? " (slow)" : ""));
    H.hqpSetText(e.name, n.name || "HQPlayer");
    H.hqpSetText(e.engine, n.engine ? "v" + n.engine : "");

    // Keeping up? HQPlayer 5.17.2 and later report their own processing
    // speed (× real time, averaged over 3 s): judged as hqpweb calibrated it
    // on a real HQPlayer — 1.00× just holds, 0.92× falls behind, so red below
    // 1×, amber below 1.15× (little headroom). Older versions: the 30 s fit
    // of the position — red below 0.90×, amber after 15 s below 0.97×.
    const speed = n.health && n.health.speed != null ? n.health.speed : null;
    const pspeed = n.health && n.health.processSpeed != null ? n.health.processSpeed : null;
    const cls = pspeed != null ? (pspeed < 1 ? "bad" : pspeed < 1.15 ? "warn" : "ok")
      : speed == null ? "" : speed < 0.9 ? "bad"
      : (H.hqpSlowSince !== null && Date.now() - H.hqpSlowSince >= 15000) ? "warn" : "ok";
    H.hqpSetData(e.health, "state", cls);
    const verdict = cls === "bad" ? "Falling behind real time" : cls === "warn" ? "Struggling to keep up" : "Keeping up with real time ✓";
    const fmtX = (v) => (v >= 10 ? Math.round(v) + "×" : v.toFixed(1) + "×");
    H.hqpSetText(e.health, pspeed != null ? "Processing " + fmtX(pspeed) + " · " + verdict : speed == null ? "" : verdict);
    H.hqpSetProp(e.health, "title", pspeed != null
      ? "HQPlayer is processing at " + pspeed.toFixed(1) + "× real time (3-second average): it could run that many times faster " +
        "than playback needs. Below 1× it can't keep up and the audio drops out; close to 1× leaves little headroom."
      : speed == null ? "" : "Processing at " + speed.toFixed(3) + "× real time over the last 30 s. " +
        "Below 1.0 HQPlayer can't keep up and the audio will drop out.");
    const alerts = [];
    if (H.hqpLost) alerts.push("Lost touch with Rouen's server; retrying…");
    // One dip below 1× is not an overload: HQPlayer's own speed must stay
    // below it for three readings in a row first (hqpweb, as HQPTuner does).
    // And overload builds over minutes, so a recent change is named beside it.
    const lastChange = n.recentChangeAt ? new Date(n.recentChangeAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    if (cls === "bad" && (pspeed == null || H.hqpBehind >= 3)) alerts.push("HQPlayer is falling behind real time (" + (pspeed != null ? pspeed : speed).toFixed(2) + "×): it may be overloaded. " +
      (lastChange ? "Your last change was at " + lastChange + ". " : "") +
      (n.undoAvailable ? "Undo the last change below, or pick a lighter filter or modulator." : "Try a lighter filter or modulator."));
    if (slow) alerts.push("HQPlayer is answering slowly (" + latency + " ms): it may be overloaded." +
      (lastChange ? " Your last change was at " + lastChange + (n.undoAvailable ? ": undo it below while HQPlayer still answers." : ".") : ""));
    if (H.hqpCapsError) alerts.push("Couldn't read HQPlayer's lists of filters and modulators (" + H.hqpCapsError + "); trying again.");
    H.hqpSetText(e.alert, alerts.join(" "));
    e.alert.classList.toggle("hidden", !alerts.length);

    const z = H.hqpZoneLine(n.roon);
    e.track.classList.toggle("hidden", !(z && z.track));
    if (z && z.track) {
      H.hqpSetText(e.trackTitle, z.track);
      H.hqpSetText(e.trackSub, [z.artist, z.album].filter(Boolean).join(" · "));
      const src = z.image_key ? "/api/image/" + encodeURIComponent(z.image_key) + "?size=120" : "";
      if (e.trackArt.dataset.src !== src) {
        e.trackArt.dataset.src = src;
        e.trackArt.classList.toggle("hidden", !src);
        if (src) e.trackArt.src = src; else e.trackArt.removeAttribute("src");
      }
    }

    H.hqpSetText(e.rate, H.hqpFmtRate(st.activeRate, st.activeMode));
    H.hqpSetText(e.state, H.HQP_PLAYBACK[st.state] || "");
    H.hqpSetData(e.state, "state", String(st.state));
    const src = st.source;
    // The output word's width, as HQPlayer sends it: 32 in PCM, 1 in SDM
    // (measured). Not the DAC Bits setting, which no command reads.
    H.hqpSetText(e.sub, [st.activeMode + (st.activeBits ? " " + st.activeBits + "-bit" : ""),
      src ? "from " + H.hqpFmtRate(src.sampleRate, "PCM") + (src.bits ? " / " + src.bits + "-bit" : "") : "",
      src && src.song === "Roon" ? "fed by Roon" : ""].filter(Boolean).join(" · "));

    // ---- the counters ----
    const apod = st.apod || 0;
    const clips = st.clips || 0;
    e.counters.classList.toggle("hidden", !(apod > 0 || clips > 0));
    H.hqpSetText(e.apod, apod > 0 ? "Apod " + apod : "");
    H.hqpSetData(e.apod, "level", apod > 10 ? "bad" : apod > 0 ? "warn" : "");
    H.hqpSetProp(e.apod, "title", "HQPlayer's apodization counter for this track: how often the recording needed what an " +
      "apodizing filter corrects. HQPlayer's manual suggests an apodizing filter once it passes 10.");
    H.hqpSetText(e.clips, clips > 0 ? "Clips " + clips : "");
    H.hqpSetData(e.clips, "level", clips > 0 ? "bad" : "");
    H.hqpSetProp(e.clips, "title", clips > 0 ? "HQPlayer had to clip " + clips + " time" + (clips === 1 ? "" : "s") +
      ". Lowering its volume gives the signal room." : "");
    H.hqpSetText(e.apodText, n.apodization === "handled" ? "your filter handles this" : "");
    e.apodBtn.classList.toggle("hidden", n.apodization !== "suggest");
    H.hqpSetProp(e.apodBtn, "disabled", H.hqpBusy || !H.hqpCaps);

    // ---- a volume that rose without this app ----
    const jump = n.snapshot.volumeJump;
    e.jump.classList.toggle("hidden", !jump);
    if (jump) {
      H.hqpSetText(e.jumpText, "HQPlayer's volume rose from " + jump.from.toFixed(1) + " to " + jump.to.toFixed(1) +
        " dB without this app" + (jump.restarted ? " — HQPlayer most likely restarted, and came back at its saved level." : "."));
      H.hqpSetText(e.jumpBack, "Back to " + jump.from.toFixed(1) + " dB");
      H.hqpSetProp(e.jumpBack, "disabled", H.hqpBusy);
    }

    // ---- the next track won't start ----
    const g = H.hqpCaps && H.hqpCaps.guards ? H.hqpCaps.guards : null;
    const w = g ? g.wedge : null;
    e.wedge.classList.toggle("hidden", !w);
    if (w) {
      const key = JSON.stringify(w);
      H.hqpSetText(e.wedgeText, "The next track won't start: " + w.text + ". HQPlayer ignores Play until this is fixed.");
      if (e.wedgeActs.dataset.key !== key) {
        e.wedgeActs.dataset.key = key;
        e.wedgeActs.replaceChildren();
        const mode = H.hqpCaps.mode.name;
        for (const r of (w.rates || []).filter((x) => x.nearest)) {
          const b = H.hqpEl("button", "settings-update-btn hqp-flag-btn", "Output " + H.hqpFmtRate(r.rate, mode));
          b.type = "button";
          b.addEventListener("click", () => H.hqpApply({ rate: r.rate }));
          e.wedgeActs.appendChild(b);
        }
        if (H.hqpCaps.rates.some((r) => r.rate === 0 && r.allowed)) {
          const b = H.hqpEl("button", "settings-update-btn hqp-flag-btn", "Auto rate");
          b.type = "button";
          b.addEventListener("click", () => H.hqpApply({ rate: 0 }));
          e.wedgeActs.appendChild(b);
        }
        const other = H.hqpEl("button", "settings-update-btn hqp-flag-btn",
          w.cause === "modulator" ? "Choose another modulator…" : "Choose another filter…");
        other.type = "button";
        other.addEventListener("click", () => H.hqpOpenPicker(w.cause === "modulator" ? "shaper" : w.slot));
        e.wedgeActs.appendChild(other);
      }
      for (const b of e.wedgeActs.children) H.hqpSetProp(b, "disabled", H.hqpBusy);
    }
    const others = g && g.otherSources ? g.otherSources : [];
    H.hqpSetText(e.otherSrc, others.length ? "At this fixed rate: " + others.join("; ") + "." : "");
    e.otherSrc.classList.toggle("hidden", !others.length);

    // ---- the pickers' rows ----
    H.hqpSetProp(e.rows.shaper.l.firstChild, "data", H.hqpIsSdm() ? "Modulator" : "Dither");
    const inUse = n.inUse;
    for (const f of ["filter1x", "filterNx", "shaper"]) {
      const r = e.rows[f];
      const list = H.hqpCaps ? (f === "shaper" ? H.hqpCaps.shapers : H.hqpCaps.filters) : null;
      const name = list ? H.hqpNameAt(list, state[f]) : "";
      H.hqpSetText(r.v, name || "—");
      // ✓ when HQPlayer reports this choice is the one running; ⚠ when it reports another.
      let taken = null;
      if (st.state === 2 && list) {
        if (f === "shaper") taken = st.activeShaper === name;
        else if (inUse === (f === "filter1x" ? "1x" : "Nx")) taken = st.activeFilter === name;
      }
      H.hqpSetData(r.v, "taken", taken === null ? "" : taken ? "yes" : "no");
      H.hqpSetProp(r.v, "title", taken === false ? "HQPlayer reports a different one running" : taken ? "Running in HQPlayer" : "");
      if (f !== "shaper") r.hint.classList.toggle("hidden", inUse !== (f === "filter1x" ? "1x" : "Nx"));
      H.hqpSetProp(r.b, "disabled", H.hqpBusy || !H.hqpCaps);
    }
    H.hqpSetText(e.rows.presets.v, H.hqpPresetLine || "—");
    H.hqpSetProp(e.rows.presets.b, "disabled", H.hqpBusy || !H.hqpCaps);

    // ---- the last change ----
    const undo = !!n.undoAvailable;
    H.hqpSetText(e.msg, H.hqpMsg ? H.hqpMsg.text : "");
    H.hqpSetData(e.msg, "kind", H.hqpMsg ? H.hqpMsg.kind : "");
    e.msg.classList.toggle("hidden", !H.hqpMsg);
    e.undo.classList.toggle("hidden", !undo);
    H.hqpSetProp(e.undo, "disabled", H.hqpBusy);
    const restart = !!(H.hqpMsg && H.hqpMsg.restart);
    e.restart.classList.toggle("hidden", !restart);
    H.hqpSetProp(e.restart, "disabled", H.hqpBusy);
    e.result.classList.toggle("hidden", !H.hqpMsg && !undo);
  };

  H.hqpPoll = async function hqpPoll(seq) {
    if (seq !== H.hqpSeq || !H.hqpActive) return;
    // Only while the screen is on the page. A view chained from another
    // artist view puts this screen back (and its poll with it) and then takes
    // its nodes away again without leaving it.
    if (!H.hqpEls || !Host.grid.contains(H.hqpEls.root)) { H.hqpActive = false; return; }
    // Put away (an iOS app in the background): ask nothing, so the server's
    // lease runs out and it stops asking HQPlayer too. Back in view, the next
    // tick picks up.
    if (document.hidden) { H.hqpTimer = setTimeout(() => H.hqpPoll(seq), H.HQP_POLL_MS); return; }
    const writes = H.hqpWrites;
    let j = null;
    let lost = false;
    try {
      const r = await fetch("/api/hqp/now", { cache: "no-store" });
      j = await r.json().catch(() => null);
      if (!r.ok || !j) lost = true;
    } catch (e) {
      lost = true;
    }
    if (seq !== H.hqpSeq || !H.hqpActive) return;
    // A change was answered while this was out: what it says may be from
    // before the change, which is already on screen. Ask again, now.
    const crossed = writes !== H.hqpWrites;
    if (!crossed) H.hqpLost = lost;
    if (!lost && !crossed) {
      H.hqpNow = j;
      const speed = j.health && j.health.speed != null ? j.health.speed : null;
      if (speed == null || speed >= 0.97) H.hqpSlowSince = null;
      else if (H.hqpSlowSince === null) H.hqpSlowSince = Date.now();
      const ps = j.health && j.health.processSpeed != null ? j.health.processSpeed : null;
      H.hqpBehind = ps != null && ps < 1 ? H.hqpBehind + 1 : 0;
      // The lists and their warnings belong to a mode, a track and the
      // settings in effect: read them again whenever those move — but not on
      // every poll while they cannot be read (hqpCapsRetryAt).
      if (j.enabled && j.configured && j.snapshot && (!H.hqpCaps || H.hqpCaps.hintsKey !== j.hintsKey) &&
          Date.now() >= H.hqpCapsRetryAt) H.hqpLoadCaps();
    }
    H.hqpRender();
    H.hqpTimer = setTimeout(() => H.hqpPoll(seq), crossed ? 0 : H.HQP_POLL_MS);
  };

  H.hqpLoadCaps = async function hqpLoadCaps() {
    if (H.hqpCapsLoading) return;
    H.hqpCapsLoading = true;
    const seq = H.hqpSeq;
    try {
      const r = await fetch("/api/hqp/capabilities", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (seq !== H.hqpSeq || !H.hqpActive) return;
      if (r.ok && j && j.mode) {
        H.hqpCaps = j;
        H.hqpCapsError = null;
        H.hqpCapsWait = 0;
        H.hqpCapsRetryAt = 0;
      } else {
        H.hqpCapsFailed((j && j.error) || ("HTTP " + r.status));
      }
    } catch (e) {
      if (seq === H.hqpSeq) H.hqpCapsFailed(e.message);
    } finally {
      H.hqpCapsLoading = false;
    }
    if (seq !== H.hqpSeq || !H.hqpActive) return;
    H.hqpRender();
    // The presets' previews are read against the same lists: no use asking
    // for them while the lists cannot be read.
    if (!H.hqpCapsError) H.hqpLoadPresetLine();
  };

  // A failure is asked again by a later status — after 3 s, then 6, 12, up to
  // 30. Asked on every poll, an HQPlayer that keeps failing one of the eight
  // reads behind the lists got all eight again every 1.5 s: about thirteen
  // requests a second, for as long as the screen stayed open.
  H.hqpCapsFailed = function hqpCapsFailed(why) {
    H.hqpCapsError = why;
    H.hqpCapsWait = Math.min(30000, H.hqpCapsWait ? H.hqpCapsWait * 2 : 3000);
    H.hqpCapsRetryAt = Date.now() + H.hqpCapsWait;
  };

  // What the Presets row says: the presets in effect now, or how many there are.
  H.hqpLoadPresetLine = async function hqpLoadPresetLine() {
    const seq = H.hqpSeq;
    try {
      const r = await fetch("/api/hqp/presets", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (seq !== H.hqpSeq || !H.hqpActive || !r.ok || !Array.isArray(j)) return;
      const active = j.filter((p) => p.preview && p.preview.kind === "active").map((p) => p.name);
      H.hqpPresetLine = active.length ? "✓ " + active.join(", ") : j.length ? j.length + " saved" : "none yet";
      H.hqpRender();
    } catch (e) {
      // The row keeps what it said; the next change asks again.
    }
  };

  H.hqpRun = async function hqpRun(label, url, body) {
    if (H.hqpBusy) return null;
    H.hqpBusy = true;
    H.hqpSetMsg({ kind: "info", text: label + "…" }, true);
    H.hqpRender();
    const seq = H.hqpSeq;
    const src = H.hqpNow && H.hqpNow.snapshot ? H.hqpNow.snapshot.status.source : null;
    const fromRoon = !!(src && src.song === "Roon");
    let out = null;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      out = j;
      if (seq === H.hqpSeq) {
        if (H.hqpNow && H.hqpNow.snapshot && j.state) H.hqpNow.snapshot.state = j.state;
        if (H.hqpNow && typeof j.undoAvailable === "boolean") H.hqpNow.undoAvailable = j.undoAvailable;
        if (j.results) {
          // A result offering Restart playback stays until it is answered.
          const m = H.hqpDescribe(j, fromRoon);
          H.hqpSetMsg(m, !!m.restart);
        }
      }
    } catch (e) {
      if (seq === H.hqpSeq) H.hqpSetMsg({ kind: "error", text: e.message });
    } finally {
      H.hqpWrites++;
      H.hqpBusy = false;
      if (seq === H.hqpSeq) {
        H.hqpRender();
        // A rollback taught the server a combination that fails, and any
        // change can move which preset is in effect: read both again.
        if (out && out.rolledBack) H.hqpLoadCaps();
        else H.hqpLoadPresetLine();
      }
    }
    return out;
  };

  // "Restart playback": Stop, then Play, after a rollback left HQPlayer's own
  // playlist stopped. If it still will not play, HQPlayer itself needs a restart.
  H.hqpRestart = async function hqpRestart() {
    if (H.hqpBusy) return;
    H.hqpBusy = true;
    H.hqpSetMsg({ kind: "info", text: "Restarting playback…" }, true);
    H.hqpRender();
    const seq = H.hqpSeq;
    try {
      const r = await fetch("/api/hqp/restart", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      if (seq === H.hqpSeq) H.hqpSetMsg(j.ok
        ? { kind: "ok", text: "✓ Asked HQPlayer to play. If it still won't, restart HQPlayer, and check its volume afterwards." }
        : { kind: "warn", text: "HQPlayer refused Play. Restart HQPlayer, and check its volume afterwards." });
    } catch (e) {
      if (seq === H.hqpSeq) H.hqpSetMsg({ kind: "error", text: e.message });
    } finally {
      H.hqpWrites++;
      H.hqpBusy = false;
      if (seq === H.hqpSeq) H.hqpRender();
    }
  };

  H.hqpApply = function hqpApply(change) {
    const risky = Object.keys(change).some((k) => H.HQP_RISKY.indexOf(k) > -1);
    const playing = !!(H.hqpNow && H.hqpNow.snapshot && H.hqpNow.snapshot.status.state === 2);
    return H.hqpRun(risky && playing ? "Applying, and checking playback" : "Applying", "/api/hqp/change", change);
  };
})();
