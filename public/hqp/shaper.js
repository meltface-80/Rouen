// @ts-check
/*
 * hqp/shaper.js — HQPlayer control, the side-menu screen: the modulator and
 * dither sheet: the guide, its tabs and its picks.
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

  H.hqpOpenShaperSheet = function hqpOpenShaperSheet() {
    if (!H.hqpCaps || !H.hqpNow || !H.hqpNow.snapshot || H.hqpBusy) return;
    const label = H.hqpFieldLabel("shaper");
    Host.openLibSheet(label, (body, close) => {
      body.classList.add("hqp-pick-body");
      const pin = H.hqpEl("div", "hqp-pick-pin");
      const tabs = H.hqpEl("div", "hqp-tabs");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", label + " view");
      const tabBtn = (key, text) => {
        const b = H.hqpEl("button", "hqp-tab", text);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.dataset.tab = key;
        b.addEventListener("click", () => { H.hqpSheetTab = key; H.hqpLocal(H.HQP_TAB_KEY, key); draw(); });
        return b;
      };
      const tList = tabBtn("list", "List");
      const tGuide = tabBtn("guide", "Guide ");
      tGuide.appendChild(H.hqpEl("span", "hqp-beta", "Beta"));
      tabs.appendChild(tList); tabs.appendChild(tGuide);
      const now = H.hqpEl("p", "hqp-now");
      const msg = H.hqpEl("p", "hqp-sheet-msg hidden");
      msg.setAttribute("role", "status");
      const listTools = H.hqpEl("div", "hqp-list-tools");
      const q = H.hqpEl("input", "settings-token-input hqp-pick-search");
      q.type = "search";
      q.autocomplete = "off";
      q.setAttribute("aria-label", "Search " + label);
      const works = H.hqpEl("button", "hqp-chip", "Only what plays here");
      works.type = "button";
      works.title = "Hide what won't play at this rate, or has failed on this HQPlayer before";
      listTools.appendChild(q); listTools.appendChild(works);
      pin.appendChild(tabs); pin.appendChild(now); pin.appendChild(msg); pin.appendChild(listTools);
      body.parentNode.insertBefore(pin, body);

      let g = null;
      let worksHere = false;
      let reads = 0;           // a slower answer from an earlier read never paints over a newer one
      let scrolled = false;    // the current row is brought into view once, on open, not on every redraw
      const opened = new Set();
      const say = (m) => {
        msg.classList.toggle("hidden", !m);
        msg.textContent = m ? m.text : "";
        msg.dataset.kind = m ? m.kind : "";
      };
      const reload = async (m) => {
        const mine = ++reads;
        try {
          const next = await H.hqpFetchGuide();
          if (mine !== reads) return;
          g = next;
          say(m || null);
        } catch (e) {
          if (mine !== reads) return;
          say({ kind: "error", text: "Couldn't read the guide: " + e.message });
        }
        draw();
      };
      // A change made from here: its outcome (an undo, say) would otherwise
      // sit behind the sheet, so it is shown here too, and the view re-read.
      const after = async (p) => {
        const out = await p;
        if (!document.body.contains(body)) return;
        await reload(H.hqpMsg && H.hqpMsg.kind !== "info" ? H.hqpMsg : null);
        return out;
      };
      const pick = (name) => {
        if (H.hqpSheetTab === "list") { close(); H.hqpPickShaper(name, g); return; }
        after(H.hqpPickShaper(name, g));
      };
      const answer = async (key, value) => {
        const j = await H.hqpSend("/api/hqp/setup", { [key]: value });
        await reload(j.error ? { kind: "error", text: "Couldn't save: " + j.error } : { kind: "ok", text: "Saved. Settings → HQPlayer shows it too." });
      };

      function drawList() {
        const hints = g.hints || {};
        const s = q.value.trim().toLowerCase();
        const anyWarn = g.sections.some((sec) => sec.names.some((n) => hints[n] && hints[n].warn));
        works.classList.toggle("hidden", !anyWarn);
        works.classList.toggle("is-on", worksHere);
        works.setAttribute("aria-pressed", worksHere ? "true" : "false");
        const list = H.hqpEl("div", "hqp-pick-list");
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", label);
        let shown = 0;
        for (const sec of g.sections) {
          const names = sec.names.filter((n) => (!s || n.toLowerCase().indexOf(s) > -1) &&
            !(worksHere && hints[n] && hints[n].warn && n !== g.current));
          if (!names.length) continue;
          const open = sec.open || opened.has(sec.key) || !!s;
          const head = H.hqpEl("div", "hqp-group", sec.title + " · " + names.length);
          head.dataset.key = sec.key;
          list.appendChild(head);
          if (sec.note) list.appendChild(H.hqpRuleList([sec.note]));
          for (const n of open ? names : names.filter((x) => x === g.current)) {
            const h = hints[n] || {};
            const b = H.hqpEl("button", "hqp-pick-item");
            b.type = "button";
            b.setAttribute("role", "option");
            b.dataset.name = n;
            const isCur = n === g.current;
            b.classList.toggle("is-current", isCur);
            b.classList.toggle("is-warn", !!h.warn);
            b.setAttribute("aria-selected", isCur ? "true" : "false");
            const txt = H.hqpEl("span", "hqp-pick-text");
            const line = H.hqpEl("span", "hqp-pick-line");
            line.appendChild(H.hqpEl("span", "hqp-pick-name", n));
            if (g.badges[n]) line.appendChild(H.hqpBadge(g.badges[n]));
            if (h.gen !== undefined) line.appendChild(H.hqpEl("span", "hqp-pick-tag", "Gen" + h.gen));
            txt.appendChild(line);
            const note = g.notes[n] || h.note;
            if (h.warn) txt.appendChild(H.hqpEl("small", "hqp-pick-why is-warn", "⚠ " + h.warn));
            else if (note) txt.appendChild(H.hqpEl("small", "hqp-pick-why", note));
            b.appendChild(txt);
            if (isCur) b.appendChild(H.hqpEl("span", "hqp-pick-tick", "✓"));
            b.addEventListener("click", () => pick(n));
            list.appendChild(b);
            shown++;
          }
          if (!open) {
            const more = H.hqpEl("button", "hqp-link hqp-show-all", "Show all " + names.length);
            more.type = "button";
            more.addEventListener("click", () => { opened.add(sec.key); draw(); });
            list.appendChild(more);
          }
        }
        if (!shown && !list.querySelector(".hqp-show-all")) list.appendChild(H.hqpEl("p", "hqp-pick-empty", "Nothing matches."));
        body.appendChild(list);
        body.appendChild(H.hqpEl("p", "hqp-help", "Every " + (g.isSdm ? "modulator" : "dither") + " HQPlayer offers stays in the list."));
      }

      // What the guide is, and is not: in full the first time, then one line.
      function drawIntro() {
        const seen = H.hqpLocal(H.HQP_INTRO_KEY) === "1";
        const box = H.hqpEl("div", "hqp-intro");
        const full = () => {
          box.replaceChildren(H.hqpEl("p", "", "No set of rules can capture everything that decides which modulator or dither suits your " +
            "system. This guide gets you started and explains the main choices, with the source of each. After that, your ears are " +
            "the best guide, with HQPlayer's manual and Signalyst's posts alongside. Happy listening."));
          const ok = H.hqpEl("button", "hqp-link", H.hqpLocal(H.HQP_INTRO_KEY) === "1" ? "Close" : "Got it");
          ok.type = "button";
          ok.addEventListener("click", () => { H.hqpLocal(H.HQP_INTRO_KEY, "1"); short(); });
          box.appendChild(ok);
        };
        function short() {
          const p = H.hqpEl("p", "", "A place to start, not the last word. Your ears decide. ");
          const more = H.hqpEl("button", "hqp-link", "About this guide");
          more.type = "button";
          more.addEventListener("click", full);
          p.appendChild(more);
          box.replaceChildren(p);
        }
        if (seen) short(); else full();
        return box;
      }

      const optLabel = (key, v) => { const o = g.questions[key].options.find((x) => x.value === v); return o ? o.label : ""; };
      const optDesc = (key, v) => { const o = g.questions[key].options.find((x) => x.value === v); return o ? o.description : ""; };
      const useBtn = (text, onClick) => {
        const b = H.hqpEl("button", "settings-update-btn hqp-use", text);
        b.type = "button";
        b.disabled = H.hqpBusy;
        b.addEventListener("click", onClick);
        return b;
      };
      const using = () => H.hqpEl("span", "hqp-using", "✓ Now using");
      const variantRows = (alts) => {
        const ul = H.hqpEl("ul", "hqp-variants");
        for (const a of alts) {
          const li = H.hqpEl("li", "hqp-variant" + (a.name === g.current ? " is-now" : ""));
          const top = H.hqpEl("div", "hqp-variant-top");
          top.appendChild(H.hqpEl("strong", "", a.name));
          if (a.variant && a.variant.load) top.appendChild(H.hqpEl("span", "hqp-load", "CPU: " + a.variant.load));
          top.appendChild(a.name === g.current ? using() : useBtn("Use", () => pick(a.name)));
          li.appendChild(top);
          if (a.variant) li.appendChild(H.hqpRuleList(a.variant.rules));
          const w = g.hints[a.name];
          if (w && w.warn) li.appendChild(H.hqpEl("p", "hqp-note is-warn", "⚠ " + w.warn));
          ul.appendChild(li);
        }
        return ul;
      };

      function drawModulatorGuide(steps) {
        const m = g.modulator;
        const st = g.setup;
        const rateText = g.rateHz ? H.hqpFmtRate(g.rateHz, "SDM") : "";
        steps.appendChild(H.hqpSetupStep({
          n: 1, title: "Your DAC", q: g.questions.dsd, current: st.dsd,
          summary: optLabel("dsd", st.dsd) + ": " + (m.status === "use-pcm" ? "PCM output suits it." : "order " + m.order + "."),
          onchoose: (v) => answer("dsd", v),
          after: m.status !== "use-pcm" ? null : () => {
            const box = H.hqpEl("div", "");
            box.appendChild(H.hqpEl("p", "hqp-note", "Your DAC converts DSD, so PCM output usually sounds better. Switch to PCM, then " +
              "choose a dither. To stay in DSD, the choices below still apply."));
            box.appendChild(H.hqpRuleList([g.rules.usePcm]));
            const pcm = H.hqpCaps.modes && H.hqpCaps.modes.find((x) => x.value === 0);
            if (pcm) box.appendChild(useBtn("Switch to PCM", () => { close(); H.hqpApply({ mode: pcm.name }); }));
            return box;
          },
        }));
        steps.appendChild(H.hqpSetupStep({
          n: 2, title: "Your amplifier", q: g.questions.amp, current: st.amp, off: m.status === "needs-dac",
          summary: optDesc("amp", st.amp), onchoose: (v) => answer("amp", v),
        }));
        steps.appendChild(H.hqpSetupStep({
          n: 3, title: "Your volume", q: g.questions.volume, current: st.volume, off: m.status === "needs-dac",
          summary: optDesc("volume", st.volume), onchoose: (v) => answer("volume", v),
          extra: () => H.hqpRuleList([g.rules.gainOpt]),
        }));
        if (m.status !== "ok" && m.status !== "use-pcm") return;

        const cards = [];
        // Rate and modulator, as one choice each.
        const rateCard = H.hqpEl("li", "hqp-card");
        rateCard.appendChild(H.hqpEl("div", "hqp-card-head", "Rate and modulator"));
        if (m.pairs.length) {
          rateCard.appendChild(H.hqpEl("p", "hqp-sub", "Each choice sets both at once. Now: " + (rateText || "unknown") + "."));
          const ul = H.hqpEl("ul", "hqp-pairs");
          for (const p of m.pairs) {
            const isNow = p.rateHz === g.rateHz && p.start.name === g.current;
            const li = H.hqpEl("li", "hqp-pair" + (isNow ? " is-now" : ""));
            li.dataset.rate = String(p.rateHz);
            const name = H.hqpEl("p", "hqp-pair-name");
            name.appendChild(H.hqpEl("strong", "", p.label + " · " + p.start.name));
            name.appendChild(H.hqpBadge(p.start.isDefault ? { text: "HQPlayer's default", kind: "default" } : { text: "For your answers", kind: "yours" }));
            if (p.suitsDac) name.appendChild(H.hqpBadge({ text: "Suits your DAC", kind: "suits" }));
            li.appendChild(name);
            li.appendChild(H.hqpRuleList(p.start.rules));
            if (p.variant) {
              if (p.variant.load) li.appendChild(H.hqpEl("p", "hqp-sub", "CPU: " + p.variant.load + "."));
              li.appendChild(H.hqpRuleList(p.variant.rules));
            }
            if (p.check && p.check.invalid) li.appendChild(H.hqpEl("p", "hqp-note is-warn", "⚠ With the filter in use: " + p.check.invalid + ". If playback stops, it's put back."));
            else if (p.check && p.check.failedHere) li.appendChild(H.hqpEl("p", "hqp-note is-warn", "⚠ " + p.check.failedHere));
            li.appendChild(isNow ? using() : useBtn("Use", () => after(H.hqpApply({ rate: p.rateHz, shaper: p.start.name }))));
            ul.appendChild(li);
          }
          rateCard.appendChild(ul);
          if (m.suggestedRate) rateCard.appendChild(H.hqpRuleList(m.suggestedRate.rules));
        } else if (m.suggestedRate) {
          const sr = m.suggestedRate;
          rateCard.appendChild(H.hqpEl("p", "", sr.label + " suits " + (st.dsd === "remodulates" ? "a newer ESS chip" : "your DAC") +
            (sr.orDsd512 ? ", or DSD512 to cut ultrasonic noise further" : "") + (sr.orDsd1024 ? ", or DSD1024 with an AHM modulator" : "") +
            ". Now: " + (rateText || "unknown") + ". This HQPlayer offers none of them as a fixed rate here."));
          rateCard.appendChild(H.hqpRuleList(sr.rules));
        } else {
          rateCard.appendChild(H.hqpEl("p", "", "Now: " + (rateText || "unknown") + "."));
        }
        if (!m.rateKnown) rateCard.appendChild(H.hqpEl("p", "hqp-note", "The rate isn't known while stopped on auto, so this assumes below DSD1024. Play something to update it."));
        cards.push(rateCard);

        const atCard = H.hqpEl("li", "hqp-card");
        atCard.appendChild(H.hqpEl("div", "hqp-card-head", "At " + (rateText || "the current rate")));
        const variantsPart = () => {
          if (m.p512.offered && m.p512Listed) atCard.appendChild(H.hqpRuleList([g.rules.p512Volume]));
          if (!m.alternatives.length) return;
          if (m.start && m.start.name.startsWith("AHM")) atCard.appendChild(H.hqpEl("p", "hqp-sub", "The other AHM versions, to compare by ear:"));
          else {
            atCard.appendChild(H.hqpEl("p", "hqp-sub", "Other characters to try, by ear (they're equals, not a ranking):"));
            atCard.appendChild(H.hqpRuleList([g.rules.variantsEqual]));
          }
          atCard.appendChild(variantRows(m.alternatives));
        };
        if (m.start && m.startInPairs) variantsPart();
        else if (m.start) {
          const p = H.hqpEl("p", "hqp-start");
          p.appendChild(H.hqpEl("strong", "", m.start.name));
          p.appendChild(H.hqpBadge(m.start.isDefault ? { text: "HQPlayer's default", kind: "default" } : { text: "For your answers", kind: "yours" }));
          atCard.appendChild(p);
          atCard.appendChild(H.hqpRuleList(m.start.rules));
          const w = g.hints[m.start.name];
          if (w && w.warn) atCard.appendChild(H.hqpEl("p", "hqp-note is-warn", "⚠ " + w.warn));
          atCard.appendChild(g.current === m.start.name ? using() : useBtn("Use " + m.start.name, () => pick(m.start.name)));
          variantsPart();
        } else {
          atCard.appendChild(H.hqpEl("p", "", "None of this HQPlayer's modulators fits these answers; pick one from the list."));
        }
        if (m.machine && m.machine.state !== "keeps-up") {
          atCard.appendChild(H.hqpEl("p", "hqp-note is-warn", m.machine.state === "behind"
            ? "HQPlayer is falling behind at these settings. A lower rate or a lighter filter helps most; a lighter variant only a little."
            : "HQPlayer is only just keeping up. If playback stutters, a lower rate or a lighter filter helps most."));
          atCard.appendChild(H.hqpRuleList([m.machine.rule]));
        }
        if (m.unknown.length) atCard.appendChild(H.hqpEl("p", "hqp-note", "This HQPlayer also lists " + m.unknown.join(", ") +
          ", newer than the guide's advice. They're in the list."));
        cards.push(atCard);

        if (m.status === "use-pcm") {
          // PCM suits this DAC: the DSD choices stay available, folded away.
          const li = H.hqpEl("li", "hqp-card");
          const d = H.hqpEl("details", "");
          d.appendChild(H.hqpEl("summary", "", "Staying in DSD? Show where to start"));
          const nested = H.hqpEl("ol", "hqp-steps is-nested");
          for (const c of cards) nested.appendChild(c);
          d.appendChild(nested);
          li.appendChild(d);
          steps.appendChild(li);
        } else for (const c of cards) steps.appendChild(c);
      }

      function drawDitherGuide(steps) {
        const d = g.dither;
        const st = g.setup;
        const rateText = g.rateHz ? H.hqpFmtRate(g.rateHz, "PCM") : "";
        steps.appendChild(H.hqpSetupStep({
          n: 1, title: "Your DAC", q: g.questions.pcm, current: st.pcm, summary: optLabel("pcm", st.pcm),
          onchoose: (v) => answer("pcm", v),
        }));
        steps.appendChild(H.hqpSetupStep({
          n: 2, title: "The connection", q: g.questions.link, current: st.link, off: d.status === "needs-dac",
          summary: optLabel("link", st.link), onchoose: (v) => answer("link", v),
        }));
        if (d.status === "needs-dac") return;
        const card = H.hqpEl("li", "hqp-card");
        card.appendChild(H.hqpEl("div", "hqp-card-head", "Where to start"));
        if (d.status === "needs-rate") {
          card.appendChild(H.hqpEl("p", "", "For a ladder DAC this depends on the output rate, which isn't known while stopped on auto. Play something."));
          steps.appendChild(card);
          return;
        }
        const warnOf = (n) => { const w = g.hints[n]; return w && w.warn; };
        if (d.group.length) {
          card.appendChild(H.hqpEl("p", "hqp-sub", d.group.length > 1 ? "These are equals: try them by ear, in this order." : "This one suits your answers."));
          const chips = H.hqpEl("div", "hqp-chips");
          for (const n of d.group) {
            const b = H.hqpEl("button", "hqp-chip" + (n === g.current ? " is-on" : ""), (n === g.current ? "✓ " : warnOf(n) ? "⚠ " : "") + n);
            b.type = "button";
            b.dataset.name = n;
            b.disabled = H.hqpBusy;
            if (warnOf(n)) b.title = warnOf(n);
            b.addEventListener("click", () => { if (n !== g.current) pick(n); });
            chips.appendChild(b);
          }
          card.appendChild(chips);
        } else {
          card.appendChild(H.hqpEl("p", "", "None of this HQPlayer's dithers fits these answers; pick one from the list."));
        }
        card.appendChild(H.hqpRuleList(d.rules));
        for (const n of d.group) if (warnOf(n)) card.appendChild(H.hqpEl("p", "hqp-note is-warn", "⚠ " + n + ": " + warnOf(n)));
        if (d.raiseRate) card.appendChild(H.hqpEl("p", "hqp-note", "Now " + (rateText || "unknown") + ": a higher output rate suits a ladder DAC, if yours takes it."));
        if (d.bits) {
          const BITS = {
            ladder: "Set DAC Bits low in HQPlayer's settings (this app can't read or set it).",
            default: "Leave DAC Bits at HQPlayer's default.",
            "24": "Set DAC Bits to 24 in HQPlayer's settings: S/PDIF carries 24 bits.",
            match: "Set DAC Bits in HQPlayer's settings to what your DAC takes over I2S.",
          };
          card.appendChild(H.hqpEl("p", "hqp-note", BITS[d.bits.kind]));
          if (d.bits.rule) card.appendChild(H.hqpRuleList([d.bits.rule]));
        }
        if (d.tryDsd) {
          card.appendChild(H.hqpEl("p", "hqp-note", "Your DAC takes DSD well: DSD output usually beats PCM."));
          card.appendChild(H.hqpRuleList([d.tryDsd]));
        }
        card.appendChild(H.hqpRuleList([g.rules.neverNone]));
        steps.appendChild(card);
      }

      function draw() {
        tList.setAttribute("aria-selected", H.hqpSheetTab === "list" ? "true" : "false");
        tGuide.setAttribute("aria-selected", H.hqpSheetTab === "guide" ? "true" : "false");
        listTools.classList.toggle("hidden", H.hqpSheetTab !== "list");
        body.replaceChildren();
        if (!g) { body.appendChild(H.hqpEl("p", "hqp-pick-empty", "Reading HQPlayer's list…")); return; }
        now.replaceChildren(document.createTextNode("Now using "), H.hqpEl("strong", "", g.current || "—"));
        q.placeholder = "Search " + g.sections.reduce((n, sec) => n + sec.names.length, 0) + "…";
        if (H.hqpSheetTab === "list") {
          drawList();
          if (!scrolled) {
            scrolled = true;
            // The list's own scroller only: scrollIntoView would move every
            // ancestor, the page under the sheet included.
            const cur = body.querySelector(".hqp-pick-item.is-current");
            if (cur) setTimeout(() => {
              const c = cur.getBoundingClientRect();
              const b = body.getBoundingClientRect();
              body.scrollTop += c.top - b.top - (body.clientHeight - c.height) / 2;
            }, 0);
          }
          return;
        }
        body.appendChild(drawIntro());
        const steps = H.hqpEl("ol", "hqp-steps");
        if (g.isSdm) drawModulatorGuide(steps); else drawDitherGuide(steps);
        body.appendChild(steps);
      }

      q.addEventListener("input", () => { if (g) draw(); });
      works.addEventListener("click", () => { worksHere = !worksHere; draw(); });
      draw();
      reload();
    });
  };
})();
