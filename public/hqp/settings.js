// @ts-check
/*
 * hqp/settings.js — Settings → HQPlayer, its whole page: your HQPlayers
 * (found on the network or added by address), the DACs behind the one in
 * use, Your setup, and forgetting the combinations learned not to work.
 *
 * Part of the HQPlayer plugin (dev/design/plugins.md §5). Moved out of
 * public/app.js and public/index.html in v1.9.19 with its behaviour unchanged
 * but for the switch, which was Rouen's (public/plugins.js) and since v1.9.33 is
 * Install and Remove on Settings → Plugins (plugins.md §7): this inserts
 * its part of the page into the page plugins.js made, then wires it, as
 * app.js did. Loaded only while the plugin is on.
 */
(function () {
  const H = window.RouenHQP;
  // window.__showToast is app.js's bridge (as app.js's Settings code aliased it).
  const showToast = (msg, kind) => {
    if (window.__showToast) window.__showToast(msg, kind);
  };
  const body = document.querySelector('[data-plugin-body="hqplayer"]');
  if (!body) return;
  body.insertAdjacentHTML("beforeend", `
        <!-- Several HQPlayers (v1.8.85, hqpweb's Instances) and the DACs
             behind the one in use. Built below from /api/hqp/settings;
             the address row below adds one by hand. -->
        <div class="settings-block">
          <div class="settings-block-title">Your HQPlayers <button class="settings-info-btn" data-info="Every HQPlayer this can control — one per room, say. The one marked In use is what the HQPlayer screen talks to; you can also switch there. Its guide answers and the settings it learned not to work are kept for each HQPlayer separately." aria-label="About your HQPlayers">ⓘ</button></div>
          <div id="hqp-players" class="hqp-list"></div>
          <div class="settings-row settings-row-top hqp-conn-actions">
            <button id="hqp-find" class="settings-update-btn" type="button">Find HQPlayers</button>
          </div>
          <div id="hqp-found" class="hqp-list hidden"></div>
          <div class="settings-note" id="hqp-find-note">Looks on your network for HQPlayers with network control switched on. One on another network (a VLAN) can't be found this way: add it by its address below.</div>
        </div>

        <div class="settings-block">
          <div class="settings-block-title">Add by address</div>
          <div class="settings-token-row">
            <input id="hqp-host" class="settings-token-input" type="text" inputmode="url" placeholder="e.g. 192.168.1.20 or hqplayer.local" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="HQPlayer address">
            <input id="hqp-port" class="settings-token-input hqp-port-input" type="number" inputmode="numeric" min="1" max="65535" placeholder="4321" aria-label="HQPlayer control port">
          </div>
          <div class="settings-row settings-row-top hqp-conn-actions">
            <button id="hqp-test" class="settings-update-btn" type="button">Test</button>
            <button id="hqp-save" class="settings-update-btn" type="button">Add</button>
          </div>
          <div class="settings-note" id="hqp-conn-note">The computer HQPlayer runs on. Its control port is 4321 unless you have changed it.</div>
        </div>

        <div class="settings-block" id="hqp-dacs-block">
          <div class="settings-block-title">DACs <button class="settings-info-btn" data-info="For an HQPlayer that plays to more than one DAC — a saved HQPlayer profile for each, all behind one Roon zone. HQPlayer can't tell another app which DAC it is using, or switch to another, so name them here and choose the one in use (here or on the HQPlayer screen) whenever you switch in HQPlayer. The guide's answers, the settings learned not to work and a DAC's own presets then follow your choice. With one DAC there is nothing to do." aria-label="About DACs">ⓘ</button></div>
          <div class="settings-note" id="hqp-dacs-for"></div>
          <div id="hqp-dacs" class="hqp-list"></div>
          <div class="settings-token-row">
            <input id="hqp-dac-name" class="settings-token-input" type="text" maxlength="64" placeholder="e.g. Desk DAC" autocomplete="off" aria-label="New DAC's name">
            <button id="hqp-dac-add" class="settings-update-btn" type="button">Add a DAC</button>
          </div>
        </div>

        <!-- Your setup (v1.8.78, hqpweb's "Your setup"): what the modulator and
             dither guide reads, per HQPlayer. Built below from
             /api/hqp/setup; Find your DAC from /api/hqp/dacs on first open. -->
        <div class="settings-block">
          <div class="settings-block-title">Your setup</div>
          <div class="settings-note">What the modulator and dither guide needs to know and HQPlayer can't tell it. <span id="hqp-setup-for">Kept for this HQPlayer.</span></div>
          <div id="hqp-setup" class="hqp-setup"></div>
        </div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Settings that didn't work</span>
            <button id="hqp-forget" class="settings-update-btn" type="button">Forget</button>
          </div>
          <div class="settings-note" id="hqp-learned-note">When a change stops playback or HQPlayer can't keep up, it is undone and remembered, and the screen warns about it next time.</div>
        </div>

        <div class="settings-block">
          <div class="settings-note">
            Not affiliated with, endorsed by, or supported by Signalyst. HQPlayer is a
            trademark of its owner, used here only to identify compatible software.
          </div>
        </div>
`);

  // ----- HQPlayer (v1.8.74; several HQPlayers and their DACs, v1.8.85) -----
  // Your HQPlayers (found on the network or added by address),
  // the DACs behind the one in use, and forgetting the
  // combinations learned not to work. Every write here is JSON — the server
  // refuses anything else from any page (see lib/hqp/service.js).
  const hqpHostEl    = document.getElementById("hqp-host");
  const hqpPortEl    = document.getElementById("hqp-port");
  const hqpTestBtn   = document.getElementById("hqp-test");
  const hqpSaveBtn   = document.getElementById("hqp-save");
  const hqpConnNote  = document.getElementById("hqp-conn-note");
  const hqpForgetBtn = document.getElementById("hqp-forget");
  const hqpLearnNote = document.getElementById("hqp-learned-note");
  const hqpPlayersEl = document.getElementById("hqp-players");
  const hqpFindBtn   = document.getElementById("hqp-find");
  const hqpFoundEl   = document.getElementById("hqp-found");
  const hqpFindNote  = document.getElementById("hqp-find-note");
  const hqpDacsEl    = document.getElementById("hqp-dacs");
  const hqpDacsFor   = document.getElementById("hqp-dacs-for");
  const hqpDacName   = document.getElementById("hqp-dac-name");
  const hqpDacAdd    = document.getElementById("hqp-dac-add");
  const hqpSetupFor  = document.getElementById("hqp-setup-for");
  const HQP_CONN_NOTE = hqpConnNote ? hqpConnNote.textContent : "";
  const HQP_LEARN_NOTE = hqpLearnNote ? hqpLearnNote.textContent : "";
  let hqpState = null;   // the last /api/hqp/settings answer

  const hqpMk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const hqpBtn = (label, aria, fn) => {
    const b = hqpMk("button", "settings-update-btn", label);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", fn);
    return b;
  };
  const hqpAddr = (p) => p.host + (p.port && p.port !== 4321 ? ":" + p.port : "");

  // The one being controlled.
  function hqpTargetName(j) {
    const p = (j.players || []).find((x) => x.id === j.current);
    return p ? p.name : "";
  }

  function paintHqpPlayers(j) {
    if (!hqpPlayersEl) return;
    hqpPlayersEl.textContent = "";
    const list = j.players || [];
    if (!list.length) {
      hqpPlayersEl.appendChild(hqpMk("div", "settings-note", "None yet. Find them on your network, or add one by its address."));
      return;
    }
    for (const p of list) {
      const row = hqpMk("div", "hqp-item");
      row.dataset.id = p.id;
      const txt = hqpMk("div", "hqp-item-txt");
      const title = hqpMk("div", "hqp-item-title", p.name);
      if (p.id === j.active) title.appendChild(hqpMk("span", "hqp-pill", "In use"));
      txt.appendChild(title);
      const named = (p.dacs || []).filter((d) => d.name);
      txt.appendChild(hqpMk("div", "hqp-item-sub", hqpAddr(p) +
        (named.length > 1 ? " · " + named.length + " DACs" : "")));
      const acts = hqpMk("div", "hqp-item-acts");
      if (p.id !== j.active) acts.appendChild(hqpBtn("Use", "Use " + p.name, () => hqpWrite("/api/hqp/players/" + encodeURIComponent(p.id) + "/select", {}, "POST", p.name + " is in use")));
      acts.appendChild(hqpBtn("Rename", "Rename " + p.name, () => {
        const name = window.prompt("Name this HQPlayer", p.name);
        if (name === null || !name.trim() || name.trim() === p.name) return;
        hqpWrite("/api/hqp/players/" + encodeURIComponent(p.id), { name: name.trim() }, "PATCH", "Renamed");
      }));
      acts.appendChild(hqpBtn("Remove", "Remove " + p.name, async () => {
        const ask = window.__confirmDialog || ((m) => Promise.resolve(window.confirm(m)));
        if (!(await ask("Remove " + p.name + " (" + hqpAddr(p) + ")?\n\nIts guide answers and the settings it learned " +
                        "not to work are kept, and come back if you add it again under the same name."))) return;
        hqpWrite("/api/hqp/players/" + encodeURIComponent(p.id), {}, "DELETE", "Removed");
      }));
      row.appendChild(txt);
      row.appendChild(acts);
      hqpPlayersEl.appendChild(row);
    }
  }

  function paintHqpDacs(j) {
    if (!hqpDacsEl) return;
    const block = document.getElementById("hqp-dacs-block");
    const owner = j.current;
    // Nothing to name DACs for until there is an HQPlayer.
    if (block) block.classList.toggle("hidden", !owner);
    if (!owner) return;
    if (hqpDacsFor) {
      hqpDacsFor.textContent = (j.dacs || []).length > 1
        ? "Behind " + hqpTargetName(j) + ". Choose the one HQPlayer is using now."
        : "Behind " + hqpTargetName(j) + ": one DAC. Add another only if you switch DACs in HQPlayer itself.";
    }
    hqpDacsEl.textContent = "";
    const dacs = j.dacs || [];
    if (dacs.length < 2) return;
    for (const d of dacs) {
      const row = hqpMk("div", "hqp-item");
      row.dataset.id = d.id;
      const txt = hqpMk("div", "hqp-item-txt");
      const title = hqpMk("div", "hqp-item-title", d.name || "DAC");
      if (d.id === j.dac) title.appendChild(hqpMk("span", "hqp-pill", "In use"));
      txt.appendChild(title);
      const acts = hqpMk("div", "hqp-item-acts");
      const base = "/api/hqp/players/" + encodeURIComponent(owner);
      if (d.id !== j.dac) acts.appendChild(hqpBtn("Use", "Use " + d.name, () => hqpWrite(base + "/dac", { dac: d.id }, "POST", d.name + " is in use")));
      acts.appendChild(hqpBtn("Rename", "Rename " + d.name, () => {
        const name = window.prompt("Name this DAC", d.name);
        if (name === null || !name.trim() || name.trim() === d.name) return;
        hqpWrite(base + "/dacs/" + encodeURIComponent(d.id), { name: name.trim() }, "PATCH", "Renamed");
      }));
      if (d.id !== "main") {
        acts.appendChild(hqpBtn("Remove", "Remove " + d.name, async () => {
          const ask = window.__confirmDialog || ((m) => Promise.resolve(window.confirm(m)));
          if (!(await ask("Remove " + d.name + "?\n\nIts guide answers and the settings it learned not to work go with it. " +
                          "Presets kept for it alone are kept for all your DACs instead."))) return;
          hqpWrite(base + "/dacs/" + encodeURIComponent(d.id), {}, "DELETE", "Removed");
        }));
      }
      row.appendChild(txt);
      row.appendChild(acts);
      hqpDacsEl.appendChild(row);
    }
  }

  function paintHqpSettings(j) {
    if (!j) return;
    hqpState = j;
    if (hqpForgetBtn) hqpForgetBtn.disabled = !j.learned_count;
    if (hqpLearnNote) {
      hqpLearnNote.textContent = j.learned_count
        ? HQP_LEARN_NOTE + " Remembered now: " + j.learned_count + "."
        : HQP_LEARN_NOTE;
    }
    paintHqpPlayers(j);
    paintHqpDacs(j);
    if (hqpSetupFor) {
      const dac = (j.dacs || []).length > 1 ? (j.dacs.find((d) => d.id === j.dac) || {}).name : "";
      const who = hqpTargetName(j);
      hqpSetupFor.textContent = who
        ? "Kept for " + who + (dac ? ", with " + dac : "") + "."
        : "Kept for each HQPlayer.";
    }
    // The credit box at the top of the page follows the setting (plugin.js).
    if (H.paintCredit) H.paintCredit(j);
  }

  async function loadHqpSettings() {
    if (!hqpPlayersEl) return;
    try {
      const r = await fetch("/api/hqp/settings", { cache: "no-store" });
      if (r.ok) paintHqpSettings(await r.json());
    } catch (e) { /* the pane keeps what it shows; reopening Settings asks again */ }
  }

  async function hqpPostJson(url, body, method) {
    try {
      const r = await fetch(url, {
        method: method || "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j && j.error)) return { error: (j && j.error) || ("HTTP " + r.status) };
      return j;
    } catch (e) {
      return { error: e.message };
    }
  }

  // A change to the list or the DACs: every answer is the whole settings
  // view, so the pane repaints from it. The guide's answers belong to the
  // HQPlayer and DAC in use, so they are read again too.
  async function hqpWrite(url, body, method, done) {
    const j = await hqpPostJson(url, body, method);
    if (j.error) {
      showToast("Couldn't save: " + j.error, "error");
      loadHqpSettings();
      return null;
    }
    paintHqpSettings(j);
    if (done) showToast(done);
    H.loadHqpSetup();
    return j;
  }

  // The address as typed, or null with the reason shown.
  function hqpTyped() {
    const host = hqpHostEl ? hqpHostEl.value.trim() : "";
    const portText = hqpPortEl ? hqpPortEl.value.trim() : "";
    const port = portText === "" ? 4321 : Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      if (hqpConnNote) hqpConnNote.textContent = "The port is a whole number from 1 to 65535 — 4321 unless you changed it in HQPlayer.";
      return null;
    }
    return { host, port };
  }

  if (hqpSaveBtn) {
    hqpSaveBtn.addEventListener("click", async () => {
      const a = hqpTyped();
      if (!a) return;
      if (!a.host) { if (hqpConnNote) hqpConnNote.textContent = "Enter HQPlayer's address first."; return; }
      hqpSaveBtn.disabled = true;
      if (hqpConnNote) hqpConnNote.textContent = "Adding " + a.host + "…";
      const j = await hqpWrite("/api/hqp/players", { host: a.host, port: a.port }, "POST");
      hqpSaveBtn.disabled = false;
      if (j) {
        const p = (j.players || []).find((x) => x.id === j.added);
        if (hqpHostEl) hqpHostEl.value = "";
        if (hqpConnNote) {
          hqpConnNote.textContent = "Added" + (p ? " " + p.name : "") + ".";
        }
      } else if (hqpConnNote) {
        hqpConnNote.textContent = HQP_CONN_NOTE;
      }
    });
  }
  if (hqpTestBtn) {
    hqpTestBtn.addEventListener("click", async () => {
      const a = hqpTyped();
      if (!a) return;
      if (!a.host) { if (hqpConnNote) hqpConnNote.textContent = "Enter HQPlayer's address first."; return; }
      hqpTestBtn.disabled = true;
      if (hqpConnNote) hqpConnNote.textContent = "Asking " + a.host + "…";
      const j = await hqpPostJson("/api/hqp/test", { host: a.host, port: a.port });
      hqpTestBtn.disabled = false;
      if (!hqpConnNote) return;
      if (j.ok) {
        hqpConnNote.textContent = "Found " + (j.name ? "“" + j.name + "” — " : "") +
          (j.product || "HQPlayer") + (j.engine ? " " + j.engine : "") + ". Add it to use it.";
      } else {
        hqpConnNote.textContent = "Nothing answered as HQPlayer at " + a.host + ":" + a.port +
          (j.error ? " (" + j.error + ")" : "") + ". Is HQPlayer running, and do its own " +
          "settings allow control from the network?";
      }
    });
  }
  if (hqpHostEl) hqpHostEl.addEventListener("input", () => { if (hqpConnNote) hqpConnNote.textContent = HQP_CONN_NOTE; });

  // Find HQPlayers: hqpweb's discovery, run once per tap. What it finds is
  // listed with Add; what is already in the list says so.
  if (hqpFindBtn) {
    hqpFindBtn.addEventListener("click", async () => {
      hqpFindBtn.disabled = true;
      if (hqpFindNote) hqpFindNote.textContent = "Looking…";
      const j = await hqpPostJson("/api/hqp/discover", {});
      hqpFindBtn.disabled = false;
      if (!hqpFoundEl || !hqpFindNote) return;
      hqpFoundEl.textContent = "";
      if (j.error) {
        hqpFoundEl.classList.add("hidden");
        hqpFindNote.textContent = "Couldn't look: " + j.error;
        return;
      }
      const found = j.found || [];
      hqpFoundEl.classList.toggle("hidden", !found.length);
      if (!found.length) {
        hqpFindNote.textContent = "None answered. Check that HQPlayer is running with control from the network " +
          "allowed. On another network (a VLAN), add it by its address below.";
        return;
      }
      hqpFindNote.textContent = "Found " + found.length + ".";
      for (const d of found) {
        const row = hqpMk("div", "hqp-item");
        const txt = hqpMk("div", "hqp-item-txt");
        txt.appendChild(hqpMk("div", "hqp-item-title", d.name || d.address));
        txt.appendChild(hqpMk("div", "hqp-item-sub", d.address + (d.version ? " · " + d.version.replace(/^Signalyst\s+/, "") : "")));
        const acts = hqpMk("div", "hqp-item-acts");
        if (d.added) {
          acts.appendChild(hqpMk("span", "hqp-pill", "Added"));
        } else {
          const b = hqpBtn("Add", "Add " + (d.name || d.address), async () => {
            b.disabled = true;
            const r = await hqpWrite("/api/hqp/players", { name: d.name || "", host: d.address }, "POST", "Added " + (d.name || d.address));
            if (r) { b.replaceWith(hqpMk("span", "hqp-pill", "Added")); }
            else b.disabled = false;
          });
          acts.appendChild(b);
        }
        row.appendChild(txt);
        row.appendChild(acts);
        hqpFoundEl.appendChild(row);
      }
    });
  }

  // Add a DAC. The first time, the DAC already there is named as well: a
  // choice between "DAC" and "Desk DAC" says nothing about which is which.
  if (hqpDacAdd) {
    hqpDacAdd.addEventListener("click", async () => {
      const j0 = hqpState;
      if (!j0) return;
      const owner = j0.current;
      const name = hqpDacName ? hqpDacName.value.trim() : "";
      if (!owner) return;
      if (!name) { showToast("Name the DAC first", "error"); return; }
      const body = { name };
      if ((j0.dacs || []).length < 2) {
        const cur = window.prompt("And what is the DAC " + hqpTargetName(j0) + " uses now called?", "Main DAC");
        if (cur === null) return;
        body.currentName = cur.trim() || "Main DAC";
      }
      hqpDacAdd.disabled = true;
      const r = await hqpWrite("/api/hqp/players/" + encodeURIComponent(owner) + "/dacs", body, "POST", "Added " + name);
      hqpDacAdd.disabled = false;
      if (r && hqpDacName) hqpDacName.value = "";
    });
  }
  if (hqpForgetBtn) {
    hqpForgetBtn.addEventListener("click", async () => {
      hqpForgetBtn.disabled = true;
      const j = await hqpPostJson("/api/hqp/learned", {}, "DELETE");
      if (j.error) showToast("Couldn't forget them: " + j.error, "error");
      else showToast("Forgot " + j.forgotten + " combination" + (j.forgotten === 1 ? "" : "s"));
      loadHqpSettings();
    });
  }

  H.loadHqpSettings = loadHqpSettings;
})();
