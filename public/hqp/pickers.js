// @ts-check
/*
 * hqp/pickers.js — HQPlayer control, the side-menu screen: the searchable
 * picker for a filter, a rate or a mode, with HQPlayer's rules beside each
 * choice, and the guide's small helpers.
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

  // A searchable list for 36–77 choices, with HQPlayer's rules beside each:
  // "failed here before" where this machine learned one, a quieter note where
  // a choice works but is outside what the manual recommends, and HQPlayer's
  // own guide — its rating out of 5, what a filter favours, whether it
  // apodizes, a modulator's generation (hqpweb 0.1.0-alpha.2; on a v5
  // HQPlayer, HQPlayer 6's guide for the same name).
  //
  // A filter the FIXED output rate rules out is hidden by the "Compatible"
  // chip (on by default; off lists it struck through). Picking one offers the
  // output rates that fit, nearest first, or Auto, or applying it anyway:
  // the filter and the rate change together. It warns; it never blocks.
  H.hqpOpenPicker = function hqpOpenPicker(field) {
    // The modulator / dither has its own sheet, with the guide (v1.8.78).
    if (field === "shaper") return H.hqpOpenShaperSheet();
    if (!H.hqpCaps || !H.hqpNow || !H.hqpNow.snapshot || H.hqpBusy) return;
    const isFilter = field !== "shaper";
    const list = isFilter ? H.hqpCaps.filters : H.hqpCaps.shapers;
    const current = H.hqpNameAt(list, H.hqpNow.snapshot.state[field]);
    const hints = (H.hqpCaps.hints && H.hqpCaps.hints[field]) || {};
    const hintOf = (name) => (Object.prototype.hasOwnProperty.call(hints, name) ? hints[name] : null);
    const label = H.hqpFieldLabel(field);
    const chips = H.hqpPickChips;
    // The apodizing chip is set by "Choose an apodizing filter…" for this one
    // opening; the others are kept for the visit.
    const apodOnly = chips.apod;
    chips.apod = false;
    Host.openLibSheet(label, (body, close) => {
      body.classList.add("hqp-pick-body");
      const q = H.hqpEl("input", "settings-token-input hqp-pick-search");
      q.type = "search";
      q.placeholder = "Search " + list.length + "…";
      q.autocomplete = "off";
      q.setAttribute("aria-label", "Search " + label);
      const ul = H.hqpEl("div", "hqp-pick-list");
      ul.setAttribute("role", "listbox");
      ul.setAttribute("aria-label", label);
      const empty = H.hqpEl("p", "hqp-pick-empty hidden", "No match");
      const anyBlocked = isFilter && list.some((it) => { const h = hintOf(it.name); return !!(h && h.blocked); });
      const anyTop = isFilter && list.some((it) => { const h = hintOf(it.name); return !!(h && h.rating === 5); });
      const anyApod = isFilter && list.some((it) => { const h = hintOf(it.name); return !!(h && h.apodizing === true); });
      const focuses = [];
      if (isFilter) for (const it of list) {
        const h = hintOf(it.name);
        for (const t of (h && h.tags) || []) if (focuses.indexOf(t) < 0) focuses.push(t);
      }
      focuses.sort();
      // Only a chip that is DRAWN may narrow the list: one kept from another
      // picker (5/5 from the filters, say) would otherwise hide every row of
      // a list that has no such chip — the modulators — with no way to undo it.
      const state = {
        compatible: anyBlocked && chips.compatible,
        top: anyTop && chips.top,
        focus: focuses.indexOf(chips.focus) > -1 ? chips.focus : "",
        apod: anyApod && apodOnly,
      };

      // ---- the chips ----
      const chipRow = H.hqpEl("div", "hqp-chips");
      chipRow.setAttribute("role", "group");
      chipRow.setAttribute("aria-label", "Narrow the list");
      const chipBtns = [];
      const chip = (text, isOn, flip, title) => {
        const b = H.hqpEl("button", "hqp-chip", text);
        b.type = "button";
        if (title) b.title = title;
        const paint = () => {
          b.classList.toggle("is-on", isOn());
          b.setAttribute("aria-pressed", isOn() ? "true" : "false");
        };
        b.addEventListener("click", () => { flip(); for (const c of chipBtns) c.paint(); filterList(); });
        chipBtns.push({ paint });
        paint();
        chipRow.appendChild(b);
      };
      if (anyBlocked) chip("Compatible", () => state.compatible, () => { state.compatible = !state.compatible; chips.compatible = state.compatible; },
        "Hide the filters that can't do the current conversion ratio at this fixed output rate");
      if (anyTop) chip("5/5", () => state.top, () => { state.top = !state.top; chips.top = state.top; },
        "HQPlayer's own top-rated filters");
      for (const f of focuses) chip(f, () => state.focus === f, () => { state.focus = state.focus === f ? "" : f; chips.focus = state.focus; },
        "Filters HQPlayer describes as favouring " + f);
      if (anyApod) chip("apodizing", () => state.apod, () => { state.apod = !state.apod; },
        "Apodizing filters, from HQPlayer 6's own filter table");

      // ---- the rows ----
      const items = [];
      for (const it of list) {
        const h = hintOf(it.name);
        const b = H.hqpEl("button", "hqp-pick-item");
        b.type = "button";
        b.setAttribute("role", "option");
        b.dataset.name = it.name;
        const isCur = it.name === current;
        b.classList.toggle("is-current", isCur);
        b.classList.toggle("is-warn", !!(h && h.warn));
        b.classList.toggle("is-blocked", !!(h && h.blocked));
        b.setAttribute("aria-selected", isCur ? "true" : "false");
        const txt = H.hqpEl("span", "hqp-pick-text");
        const line = H.hqpEl("span", "hqp-pick-line");
        line.appendChild(H.hqpEl("span", "hqp-pick-name", it.name));
        if (h && h.rating) {
          const st = H.hqpEl("span", "hqp-pick-stars", "★".repeat(h.rating) + "☆".repeat(Math.max(0, 5 - h.rating)));
          st.title = "HQPlayer's own rating: " + h.rating + " of 5";
          st.setAttribute("aria-label", h.rating + " of 5");
          line.appendChild(st);
        }
        if (h && h.gen !== undefined) line.appendChild(H.hqpEl("span", "hqp-pick-tag", "Gen" + h.gen));
        if (h && h.apodizing === true) line.appendChild(H.hqpEl("span", "hqp-pick-tag", "apodizing"));
        else if (h && h.apodizing === "partial") line.appendChild(H.hqpEl("span", "hqp-pick-tag", "partly apodizing"));
        txt.appendChild(line);
        const guide = [];
        if (h && h.tags && h.tags.length) guide.push(h.tags.join(", "));
        if (h && h.ratioText) guide.push("ratio " + h.ratioText);
        if (guide.length) txt.appendChild(H.hqpEl("small", "hqp-pick-guide", guide.join(" · ")));
        if (h && h.blocked) txt.appendChild(H.hqpEl("small", "hqp-pick-why is-warn", "can't play this track at this rate: " + h.blocked));
        if (h && (h.warn || h.note)) txt.appendChild(H.hqpEl("small", "hqp-pick-why" + (h.warn ? " is-warn" : ""), h.warn ? "⚠ " + h.warn : h.note));
        b.appendChild(txt);
        if (isCur) b.appendChild(H.hqpEl("span", "hqp-pick-tick", "✓"));
        b.addEventListener("click", () => {
          if (it.name === current) { close(); return; }
          if (h && h.blocked) { close(); H.hqpOfferRates(field, it.name, h); return; }
          close();
          H.hqpApply({ [field]: it.name });
        });
        items.push({ b, h, name: it.name.toLowerCase(), isCur });
        ul.appendChild(b);
      }
      function filterList() {
        const s = q.value.trim().toLowerCase();
        let shown = 0;
        for (const x of items) {
          const h = x.h || {};
          // The chips never hide the current choice — it is what the list is
          // about — but a search that does not match it does.
          const keep = (!s || x.name.indexOf(s) > -1) && (x.isCur || (
            (!state.compatible || !h.blocked) &&
            (!state.top || h.rating === 5) &&
            (!state.focus || (h.tags || []).indexOf(state.focus) > -1) &&
            (!state.apod || h.apodizing === true)));
          x.b.classList.toggle("hidden", !keep);
          if (keep) shown++;
        }
        empty.classList.toggle("hidden", shown > 0);
      }
      q.addEventListener("input", filterList);
      // The search and the chips sit in a band of their own between the
      // sheet's title and the list, outside the scroller: the picker opens
      // scrolled to the current choice, often far down a 77-row list, and a
      // search made sticky INSIDE the scroller let rows show above and below it.
      const pin = H.hqpEl("div", "hqp-pick-pin");
      pin.appendChild(q);
      if (chipRow.children.length) pin.appendChild(chipRow);
      body.parentNode.insertBefore(pin, body);
      body.appendChild(ul);
      body.appendChild(empty);
      filterList();
      // The current choice in view. No focus on the search: on a phone that
      // would raise the keyboard over the list being looked at.
      const cur = items.find((x) => x.isCur);
      if (cur && cur.b.scrollIntoView) setTimeout(() => cur.b.scrollIntoView({ block: "center" }), 0);
    });
  };

  // A filter the fixed output rate rules out: the output rates that fit it,
  // nearest first, or Auto, or apply it anyway (hqpweb's RateSwitch).
  H.hqpOfferRates = function hqpOfferRates(field, name, h) {
    if (!H.hqpCaps) return;
    const mode = H.hqpCaps.mode.name;
    Host.openLibSheet(name, (body, close) => {
      body.classList.add("hqp-pick-body");
      body.appendChild(H.hqpEl("p", "hqp-rate-why", name + " " + h.blocked + ". Change the output rate with it:"));
      const ul = H.hqpEl("div", "hqp-pick-list");
      const add = (text, sub, change, isNearest) => {
        const b = H.hqpEl("button", "hqp-pick-item" + (isNearest ? " is-current" : ""));
        b.type = "button";
        const txt = H.hqpEl("span", "hqp-pick-text");
        txt.appendChild(H.hqpEl("span", "hqp-pick-name", text));
        if (sub) txt.appendChild(H.hqpEl("small", "hqp-pick-why", sub));
        b.appendChild(txt);
        b.addEventListener("click", () => { close(); H.hqpApply(change); });
        ul.appendChild(b);
      };
      // The nearest first: the least surprising switch.
      const rates = (h.rates || []).slice().sort((x, y) => (y.nearest ? 1 : 0) - (x.nearest ? 1 : 0) || x.rate - y.rate);
      for (const r of rates)
        add(H.hqpFmtRate(r.rate, mode), r.nearest ? "nearest to the rate now" : "", { [field]: name, rate: r.rate }, r.nearest);
      if (H.hqpCaps.rates.some((r) => r.rate === 0 && r.allowed))
        add("Auto", "HQPlayer picks a rate the filter can do", { [field]: name, rate: 0 }, false);
      add("Apply anyway", "keeps the output rate: HQPlayer's rules say this track won't play", { [field]: name }, false);
      body.appendChild(ul);
    });
  };

  // ---- the modulator / dither sheet (v1.8.78, hqpweb main at 525f8d7) ----
  // A sheet with two tabs. List is HQPlayer's whole list, grouped by family,
  // the older series folded (the one in use always shows). Guide asks a few
  // questions about the DAC, amplifier, volume and connection, and suggests
  // where to start, each suggestion linked to the Signalyst post it comes
  // from. Suggestions are starting points, chosen by name from this
  // HQPlayer's own list; nothing changes until something is picked. The
  // server works the whole view out (/api/hqp/guide); this draws it. The tab
  // used last is remembered on this device.
  H.HQP_TAB_KEY = "rra-hqp-advice-tab";
  H.HQP_INTRO_KEY = "rra-hqp-guide-intro-seen";
  H.hqpLocal = (k, v) => {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { /* private mode: the tab and the intro are only remembered for the visit */ }
    return null;
  };
  H.hqpSheetTab = H.hqpLocal(H.HQP_TAB_KEY) === "guide" ? "guide" : "list";

  // The rules behind a piece of advice, each linked to the post it comes from.
  H.hqpRuleList = function hqpRuleList(rules) {
    const ul = H.hqpEl("ul", "hqp-rules");
    for (const r of rules || []) {
      if (!r) continue;
      const li = H.hqpEl("li", "", r.text + " ");
      if (r.url) {
        const a = H.hqpEl("a", "", r.cite || "source");
        a.href = r.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.appendChild(document.createTextNode("("));
        li.appendChild(a);
        li.appendChild(document.createTextNode(")"));
      } else if (r.cite) {
        li.appendChild(document.createTextNode("(" + r.cite + ")"));
      }
      ul.appendChild(li);
    }
    return ul;
  };

  // One numbered step of the guide: a question until it is answered, then a
  // one-line summary and Change, which reopens the choices in place.
  H.hqpSetupStep = function hqpSetupStep(o) {
    const li = H.hqpEl("li", "hqp-step");
    const head = H.hqpEl("div", "hqp-step-head");
    const answered = o.current !== undefined && o.current !== null;
    let editing = false;
    const draw = () => {
      li.replaceChildren(head);
      const open = !o.off && (!answered || editing);
      li.classList.toggle("is-done", answered && !editing);
      li.classList.toggle("is-off", !!o.off);
      head.replaceChildren(H.hqpEl("span", "hqp-step-n", answered && !editing ? "✓" : String(o.n)), H.hqpEl("span", "hqp-step-title", o.title));
      if (o.off) { li.appendChild(H.hqpEl("p", "hqp-step-dim", o.q.question)); return; }
      if (open) {
        li.appendChild(H.hqpEl("p", "hqp-step-q", o.q.question));
        if (o.q.help) li.appendChild(H.hqpEl("p", "hqp-step-help", o.q.help));
        const choices = H.hqpEl("div", "hqp-choices");
        choices.setAttribute("role", "group");
        choices.setAttribute("aria-label", o.title);
        for (const opt of o.q.options) {
          const b = H.hqpEl("button", "hqp-choice" + (opt.value === o.current ? " is-sel" : ""));
          b.type = "button";
          b.dataset.value = opt.value;
          b.appendChild(H.hqpEl("span", "hqp-choice-label", opt.label));
          b.appendChild(H.hqpEl("span", "hqp-choice-desc", opt.description));
          b.addEventListener("click", () => {
            for (const x of choices.children) x.disabled = true;
            o.onchoose(opt.value);
          });
          choices.appendChild(b);
        }
        li.appendChild(choices);
        if (editing) {
          const cancel = H.hqpEl("button", "hqp-link", "Cancel");
          cancel.type = "button";
          cancel.addEventListener("click", () => { editing = false; draw(); });
          li.appendChild(cancel);
        }
        if (o.extra) li.appendChild(o.extra());
      } else {
        const p = H.hqpEl("p", "hqp-step-sum", o.summary + " ");
        const change = H.hqpEl("button", "hqp-link", "Change");
        change.type = "button";
        change.addEventListener("click", () => { editing = true; draw(); });
        p.appendChild(change);
        li.appendChild(p);
        if (o.after) li.appendChild(o.after());
      }
    };
    draw();
    return li;
  };

  H.hqpBadge = function hqpBadge(b) {
    return H.hqpEl("span", "hqp-badge-guide is-" + b.kind, b.text);
  };

  // A modulator picked that cannot play at this rate (AHM below DSD1024)
  // goes with a rate it plays at, as one change; with no such rate it is not
  // written, because it would only stop playback. hqpweb's one refusal.
  H.hqpPickShaper = async function hqpPickShaper(name, g) {
    if (name === g.current) return null;
    const h = g.hints ? g.hints[name] : null;
    if (g.isSdm && h && h.cantPlay) {
      const now = H.hqpFmtRate(g.rateHz, "SDM");
      if (!h.pairRate) {
        H.hqpSetMsg({ kind: "warn", text: name + " can't play at " + now + ", or at any rate this HQPlayer offers." });
        H.hqpRender();
        return null;
      }
      const to = H.hqpFmtRate(h.pairRate, "SDM");
      if (!(await Host.confirmDialog(name + " needs " + to + " or higher; it can't play at " + now + ".\n\nChange the output rate to " + to + " with it?"))) return null;
      return H.hqpApply({ shaper: name, rate: h.pairRate });
    }
    return H.hqpApply({ shaper: name });
  };

  // A JSON write from this screen: { error } on failure, never a throw.
  H.hqpSend = async function hqpSend(url, body) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j && j.error)) return { error: (j && j.error) || ("HTTP " + r.status) };
      return j;
    } catch (e) {
      return { error: e.message };
    }
  };

  H.hqpFetchGuide = async function hqpFetchGuide() {
    const r = await fetch("/api/hqp/guide", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
    return j;
  };
})();
