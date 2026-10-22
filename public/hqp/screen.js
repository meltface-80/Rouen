// @ts-check
/*
 * hqp/screen.js — HQPlayer control, the side-menu screen: Settings → HQPWeb
 * → Your setup, Find your DAC, presets, and opening the screen (showHQPlayer).
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

  // ---- Settings → HQPWeb → Your setup (hqpweb's SetupSettings) ----------
  // The same answers the guide asks for, kept for this HQPlayer, with Find
  // your DAC under the PCM question: the chip table and the model table.
  H.loadHqpSetup = async function loadHqpSetup() {
    const host = document.getElementById("hqp-setup");
    if (!host) return;
    let j;
    try {
      const r = await fetch("/api/hqp/setup", { cache: "no-store" });
      j = await r.json();
      if (!r.ok) throw new Error(j && j.error ? j.error : "HTTP " + r.status);
    } catch (e) {
      host.replaceChildren(H.hqpEl("p", "settings-note", "Couldn't read the answers: " + e.message));
      return;
    }
    H.paintHqpSetup(host, j.setup || {}, j.questions || []);
  };

  H.paintHqpSetup = function paintHqpSetup(host, setup, questions) {
    host.replaceChildren();
    for (const q of questions) {
      const box = H.hqpEl("div", "hqp-setup-q");
      box.setAttribute("role", "radiogroup");
      box.setAttribute("aria-label", q.title);
      box.dataset.key = q.key;
      box.appendChild(H.hqpEl("strong", "", q.title));
      const help = H.hqpEl("p", "settings-note", q.question + (q.help ? " " + q.help : "") + " ");
      if (q.source && q.source.url) {
        const a = H.hqpEl("a", "", q.source.cite || "source");
        a.href = q.source.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        help.appendChild(document.createTextNode("("));
        help.appendChild(a);
        help.appendChild(document.createTextNode(")"));
      }
      box.appendChild(help);
      const status = H.hqpEl("p", "settings-note hqp-setup-status");
      status.setAttribute("role", "status");
      const opt = (value, label, desc) => {
        const l = H.hqpEl("label", "hqp-radio");
        const input = H.hqpEl("input");
        input.type = "radio";
        input.name = "hqp-setup-" + q.key;
        input.value = value === null ? "" : value;
        input.checked = value === null ? setup[q.key] === undefined : setup[q.key] === value;
        input.addEventListener("change", async () => {
          for (const x of box.querySelectorAll("input")) x.disabled = true;
          const r = await H.hqpSend("/api/hqp/setup", { [q.key]: value });
          for (const x of box.querySelectorAll("input")) x.disabled = false;
          if (r.error) {
            status.textContent = "Couldn't save: " + r.error;
            status.classList.add("is-error");
            H.loadHqpSetup();
            return;
          }
          setup = r.setup;
          status.textContent = "Saved.";
          status.classList.remove("is-error");
        });
        const t = H.hqpEl("span", "", label);
        if (desc) t.appendChild(H.hqpEl("small", "", desc));
        l.appendChild(input); l.appendChild(t);
        return l;
      };
      box.appendChild(opt(null, "Not set", q.notSet || ""));
      for (const o of q.options) box.appendChild(opt(o.value, o.label, o.description));
      box.appendChild(status);
      host.appendChild(box);
      if (q.key === "pcm") host.appendChild(H.hqpFindYourDac());
    }
  };

  // Settings is built in another part of this file and reaches this through window.

  // Find your DAC: read once, on first open, and filtered as you type.
  H.hqpFindYourDac = function hqpFindYourDac() {
    const d = H.hqpEl("details", "hqp-find");
    d.appendChild(H.hqpEl("summary", "", "Find your DAC: chips and common models"));
    let loaded = false;
    const cell = (c) => { const td = H.hqpEl("td"); td.appendChild(H.hqpEl("span", "hqp-ans is-" + c.tone, c.label)); return td; };
    const noteEl = (n) => {
      const s = H.hqpEl("small", "");
      if (n.lead) s.appendChild(document.createTextNode(n.lead));
      for (const a of n.advice) {
        s.appendChild(document.createTextNode(" " + a.text + " ("));
        const link = H.hqpEl("a", "", a.cite);
        link.href = a.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        s.appendChild(link);
        if (a.dated) { s.appendChild(document.createTextNode(", ")); const m = H.hqpEl("span", "hqp-dated", a.dated.label); m.title = a.dated.title; s.appendChild(m); }
        s.appendChild(document.createTextNode(")"));
      }
      if (n.tail) s.appendChild(document.createTextNode(" " + n.tail));
      return s;
    };
    const table = (headCell) => {
      const t = H.hqpEl("table", "hqp-dt");
      const th = H.hqpEl("thead");
      const tr = H.hqpEl("tr");
      for (const h of [headCell, "DSD", "PCM"]) tr.appendChild(H.hqpEl("th", "", h));
      th.appendChild(tr); t.appendChild(th);
      const tb = H.hqpEl("tbody");
      t.appendChild(tb);
      return { t, tb };
    };
    d.addEventListener("toggle", async () => {
      if (!d.open || loaded) return;
      loaded = true;
      let data;
      try {
        const r = await fetch("/api/hqp/dacs", { cache: "no-store" });
        data = await r.json();
        if (!r.ok) throw new Error("HTTP " + r.status);
      } catch (e) {
        loaded = false;
        d.appendChild(H.hqpEl("p", "settings-note", "Couldn't read the table: " + e.message));
        return;
      }
      d.appendChild(H.hqpEl("p", "settings-note", "Look for the chip on the spec sheet first; some models changed chips under the same name."));
      const chips = table("Chip or design");
      for (const c of data.chips) {
        const tr = H.hqpEl("tr");
        const td = H.hqpEl("td", "", c.chips);
        if (c.note.lead || c.note.tail || c.note.advice.length) td.appendChild(noteEl(c.note));
        tr.appendChild(td); tr.appendChild(cell(c.dsd)); tr.appendChild(cell(c.pcm));
        chips.tb.appendChild(tr);
      }
      d.appendChild(chips.t);
      const filter = H.hqpEl("input", "settings-token-input hqp-dq");
      filter.type = "search";
      filter.placeholder = "Filter models, e.g. Holo";
      filter.setAttribute("aria-label", "Filter models");
      filter.autocapitalize = "off";
      filter.spellcheck = false;
      d.appendChild(filter);
      const models = table("Model");
      const drawModels = () => {
        const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
        models.tb.replaceChildren();
        let any = false;
        for (const grp of data.groups) {
          const rows = grp.models.filter((m) => words.every((w) => m.search.indexOf(w) > -1));
          if (!rows.length) continue;
          any = true;
          const mk = H.hqpEl("tr", "hqp-mk");
          const th = H.hqpEl("th", "", grp.maker);
          th.colSpan = 3;
          mk.appendChild(th);
          models.tb.appendChild(mk);
          for (const m of rows) {
            const tr = H.hqpEl("tr");
            const td = H.hqpEl("td", "", m.models);
            const sm = noteEl(m.note);
            sm.insertBefore(document.createTextNode(m.chip + (m.note.lead || m.note.tail || m.note.advice.length ? ". " : "")), sm.firstChild);
            td.appendChild(sm);
            tr.appendChild(td); tr.appendChild(cell(m.dsd)); tr.appendChild(cell(m.pcm));
            models.tb.appendChild(tr);
          }
        }
        if (!any) {
          const tr = H.hqpEl("tr");
          const td = H.hqpEl("td", "hqp-pick-empty", "No model matches. Try the chip, or the maker's name.");
          td.colSpan = 3;
          tr.appendChild(td);
          models.tb.appendChild(tr);
        }
      };
      filter.addEventListener("input", drawModels);
      drawModels();
      d.appendChild(models.t);
      const foot = H.hqpEl("p", "settings-note", "Not listed, or wrong? ");
      const a = H.hqpEl("a", "", "Report it to hqpweb on GitHub");
      a.href = data.issues; a.target = "_blank"; a.rel = "noopener noreferrer";
      foot.appendChild(a);
      foot.appendChild(document.createTextNode(" with a link to the spec sheet. The table is hqpweb's, by statelycurmudgeon, checked on " +
        data.checked + " against makers' pages, reviews and Signalyst's posts. Modulator advice marked “" + data.cutovers[0].label +
        "” predates HQPlayer 5.11 (Feb 2025); AHM advice marked “" + data.cutovers[1].label + "” predates 6.1's AHM 4B (Sep 2026)."));
      d.appendChild(foot);
    });
    return d;
  };

  H.hqpPresetSummary = function hqpPresetSummary(s) {
    const mode = s.mode || "";
    return [
      s.mode,
      s.rate !== undefined ? H.hqpFmtRate(s.rate, mode) : "",
      s.filter1x ? "1x " + s.filter1x : "",
      s.filterNx ? "Nx " + s.filterNx : "",
      s.shaper || "",
      s.volume !== undefined ? s.volume + " dB" : "",
    ].filter(Boolean).join(" · ");
  };

  // Presets: one tap applies (and Undo still works); a badge says what that
  // means here — already in effect, a quick change, or a major one (mode or
  // rate) — and anything this HQPlayer cannot take is listed and skipped.
  H.hqpOpenPresets = async function hqpOpenPresets() {
    if (!H.hqpCaps || H.hqpBusy) return;
    let list = null;
    let editing = false;
    let listEl = null;
    let errEl = null;
    let closeSheet = null;
    const load = async () => {
      try {
        const r = await fetch("/api/hqp/presets", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(j)) throw new Error((j && j.error) || ("HTTP " + r.status));
        list = j;
        errEl.textContent = "";
      } catch (e) {
        errEl.textContent = "Couldn't read the presets: " + e.message;
      }
      draw();
    };
    const send = async (url, method, body) => {
      try {
        const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        return true;
      } catch (e) {
        errEl.textContent = e.message;
        return false;
      }
    };
    function draw() {
      if (!listEl) return;
      listEl.textContent = "";
      if (list === null) { listEl.appendChild(H.hqpEl("p", "hqp-pick-empty", "Loading…")); return; }
      if (!list.length) {
        listEl.appendChild(H.hqpEl("p", "hqp-pick-empty", "No presets yet. Save the current settings below."));
        return;
      }
      for (const p of list) {
        const pv = p.preview || { kind: "quick", missing: [] };
        const row = H.hqpEl("div", "hqp-preset");
        const main = H.hqpEl("button", "hqp-preset-main");
        main.type = "button";
        main.disabled = pv.kind === "active";
        const nm = H.hqpEl("span", "hqp-preset-name", p.name);
        nm.appendChild(H.hqpEl("span", "hqp-badge", pv.kind === "active" ? "✓ in effect" : pv.kind));
        nm.lastChild.dataset.kind = pv.kind;
        main.appendChild(nm);
        // More than one DAC (v1.8.85): say which presets are this DAC's own.
        const multiDac = !!(H.hqpNow && (H.hqpNow.dacs || []).length > 1);
        if (multiDac && p.scope) nm.appendChild(H.hqpEl("span", "hqp-badge hqp-badge-dac", "this DAC only"));
        main.appendChild(H.hqpEl("small", "hqp-preset-sum", H.hqpPresetSummary(p.settings || {})));
        if (pv.predicted) main.appendChild(H.hqpEl("small", "hqp-preset-warn", "⚠ won't play here: " + pv.predicted.text));
        if (pv.missing && pv.missing.length) {
          main.appendChild(H.hqpEl("small", "hqp-preset-warn", "⚠ " +
            pv.missing.map((m) => H.hqpFieldLabel(m.field) + " " + m.reason).join("; ") + " (skipped)"));
        } else if (pv.unchecked) {
          main.appendChild(H.hqpEl("small", "hqp-preset-sum", "Switches mode; its names are checked when it is applied"));
        }
        main.addEventListener("click", async () => {
          if (pv.kind === "active") return;
          if (pv.predicted &&
              !(await Host.confirmDialog(p.name + ": " + pv.predicted.text + ".\n\nApply it anyway? If playback stops, the app tries to put the old settings back."))) return;
          if (pv.kind === "major" && !pv.predicted &&
              !(await Host.confirmDialog("Apply “" + p.name + "”?\n\nThis changes the mode or the output rate: playback may pause " +
                                    "for a few seconds, and if it does not recover the app tries to put the old settings back."))) return;
          if (closeSheet) closeSheet();
          H.hqpRun("Applying " + p.name, "/api/hqp/presets/" + encodeURIComponent(p.id) + "/apply", {});
        });
        row.appendChild(main);
        if (editing) {
          const acts = H.hqpEl("span", "hqp-preset-acts");
          const act = (text, fn, danger) => {
            const b = H.hqpEl("button", "settings-update-btn" + (danger ? " hqp-danger" : ""), text);
            b.type = "button";
            b.addEventListener("click", fn);
            acts.appendChild(b);
          };
          act("Rename", async () => {
            const name = window.prompt("Rename preset", p.name);
            if (name === null || !name.trim() || name.trim() === p.name) return;
            if (await send("/api/hqp/presets/" + encodeURIComponent(p.id), "PATCH", { name: name.trim() })) load();
          });
          act("Update", async () => {
            const vol = p.settings && p.settings.volume !== undefined ? " (including the volume, as before)" : "";
            if (!(await Host.confirmDialog("Replace “" + p.name + "” with HQPlayer's current settings" + vol + "?"))) return;
            if (await send("/api/hqp/presets/" + encodeURIComponent(p.id), "PATCH", { fromCurrent: true })) load();
          });
          if (H.hqpNow && (H.hqpNow.dacs || []).length > 1) {
            act(p.scope ? "For all DACs" : "This DAC only", async () => {
              if (await send("/api/hqp/presets/" + encodeURIComponent(p.id), "PATCH", { dacOnly: !p.scope })) load();
            });
          }
          act("Delete", async () => {
            if (!(await Host.confirmDialog("Delete the preset “" + p.name + "”?"))) return;
            if (await send("/api/hqp/presets/" + encodeURIComponent(p.id), "DELETE", {})) load();
          }, true);
          row.appendChild(acts);
        }
        listEl.appendChild(row);
      }
    }
    Host.openLibSheet("Presets", (body, close) => {
      closeSheet = close;
      listEl = H.hqpEl("div", "hqp-preset-list");
      errEl = H.hqpEl("p", "hqp-err");
      errEl.setAttribute("role", "alert");
      body.appendChild(listEl);
      body.appendChild(errEl);
      draw();
    }, (foot) => {
      foot.classList.add("hqp-preset-foot");
      const name = H.hqpEl("input", "settings-token-input hqp-preset-input");
      name.type = "text";
      name.maxLength = 64;
      name.placeholder = "Save the current settings as…";
      name.setAttribute("aria-label", "Preset name");
      const volLab = H.hqpEl("label", "hqp-preset-vol");
      const vol = H.hqpEl("input");
      vol.type = "checkbox";
      volLab.appendChild(vol);
      volLab.appendChild(document.createTextNode(" with the volume"));
      const save = H.hqpEl("button", "settings-update-btn", "Save");
      save.type = "button";
      save.addEventListener("click", async () => {
        const n = name.value.trim();
        if (!n) { errEl.textContent = "Give the preset a name."; return; }
        save.disabled = true;
        const ok = await send("/api/hqp/presets", "POST", { name: n, fromCurrent: true, includeVolume: vol.checked });
        save.disabled = false;
        if (ok) { name.value = ""; vol.checked = false; load(); H.hqpLoadPresetLine(); }
      });
      const edit = H.hqpEl("button", "settings-update-btn", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => {
        editing = !editing;
        edit.textContent = editing ? "Done" : "Edit";
        draw();
      });
      foot.appendChild(name); foot.appendChild(volLab); foot.appendChild(save); foot.appendChild(edit);
    }, () => { H.hqpLoadPresetLine(); });
    load();
  };

  H.showHQPlayer = async function showHQPlayer() {
    Host.enterFullWall("HQPWeb");
    H.hqpActive = true;
    const seq = ++H.hqpSeq;
    Host.setBanner(null);
    Host.grid.innerHTML = "";
    H.hqpNow = null;
    H.hqpCaps = null;
    H.hqpCapsError = null;
    H.hqpCapsWait = 0;
    H.hqpCapsRetryAt = 0;
    H.hqpLost = false;
    H.hqpBusy = false;
    H.hqpSlowSince = null;
    H.hqpBehind = 0;
    H.hqpPresetLine = "";
    H.hqpSetMsg(null);
    H.hqpEls = H.hqpBuild();
    Host.grid.appendChild(H.hqpEls.root);
    H.hqpRender();
    await H.hqpPoll(seq);
  };
})();
