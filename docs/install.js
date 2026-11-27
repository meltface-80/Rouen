// install.js — the install page's command builder: the docker run or Compose for your setup, from the form, with
// the release marked Latest (moved out of the one-page site's index.html unchanged in 2.0.8, but for the version's
// places, which may now be on another page).
(function () {
  "use strict";

  var NAME  = "musicd-remote";                              // the container's name
  var IMAGE = "ghcr.io/meltface-80/musicd-remote:latest";   // the release marked Latest
  var REPO  = "meltface-80/MusicD-Remote";
  var FALLBACK_VERSION = "2.0.8";     // latest published release when this page was built

  var els = {
    modes:      document.getElementById("modes"),
    coreip:     document.getElementById("coreip"),
    fCoreip:    document.getElementById("f-coreip"),
    appport:    document.getElementById("appport"),
    fAppport:   document.getElementById("f-appport"),
    mount:      document.getElementById("mount"),
    mountFields:document.getElementById("mount-fields"),
    musicpath:  document.getElementById("musicpath"),
    extraMounts:document.getElementById("extra-mounts"),
    addMount:   document.getElementById("add-mount"),
    mountHint:  document.getElementById("mount-hint"),
    tzone:      document.getElementById("tzone"),
    discogskey: document.getElementById("discogskey"),
    fanartkey:  document.getElementById("fanartkey"),
    lastfmkey:  document.getElementById("lastfmkey"),
    keysHint:   document.getElementById("keys-hint"),
    cmd:        document.getElementById("cmd"),
    copy:       document.getElementById("copy"),
    tabRun:     document.getElementById("tab-run"),
    tabCompose: document.getElementById("tab-compose"),
    modeNote:   document.getElementById("mode-note"),
    afterNote:  document.getElementById("after-note"),
    verBadge:   document.getElementById("ver-badge"),
    verLine:    document.getElementById("ver-line"),
    verNote:    document.getElementById("ver-note")
  };

  var state = { mode: "same", tab: "run", version: FALLBACK_VERSION };
  var plainCmd = "";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function val(el, fallback) {
    var v = el.value.trim();
    return v === "" ? fallback : v;
  }
  // Quote a value for safe use inside a double-quoted shell string.
  function shq(v) { return '"' + v.replace(/(["\\$`])/g, "\\$1") + '"'; }
  // Keep only characters valid in an IP address or hostname.
  function ipVal() {
    var v = els.coreip.value.trim().replace(/[^A-Za-z0-9.\-:]/g, "");
    return v === "" ? "<IP_OF_YOUR_ROON_CORE>" : v;
  }
  function portVal() {
    var v = val(els.appport, "3399").replace(/[^0-9]/g, "");
    return v === "" ? "3399" : v;
  }
  function pathVal() {
    var v = els.musicpath.value.trim();
    if (v !== "") return v;
    return state.mode === "macos" ? "/Users/yourusername/Music" : "/your/path/to/Music";
  }

  // Every music folder the user has entered, first field plus any extras.
  function allPaths() {
    var out = [pathVal()];
    Array.prototype.forEach.call(els.extraMounts.querySelectorAll("input"), function (i) {
      var v = i.value.trim();
      if (v !== "") out.push(v);
    });
    return out;
  }

  // Where each folder lands INSIDE the container.
  //
  // The app scans one root and recurses into it, so a second mount at /music2
  // would simply never be looked at. One folder keeps the historic /music, so
  // nothing changes for an existing install; more than one and every folder
  // becomes its own subdirectory of /music — never /music plus /music/x, which
  // would nest a mount inside a mount.
  function mountPairs() {
    var paths = allPaths();
    if (paths.length === 1) return [{ host: paths[0], guest: "/music" }];
    var used = {}, out = [];
    paths.forEach(function (h, idx) {
      var base = h.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() || ("music" + (idx + 1));
      var name = base.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || ("music" + (idx + 1));
      if (used[name]) { var k = 2; while (used[name + "-" + k]) k++; name = name + "-" + k; }
      used[name] = true;
      out.push({ host: h, guest: "/music/" + name });
    });
    return out;
  }

  // A container runs on UTC unless told otherwise, which moves Album of the day
  // and the hour Smart Picks turns over. The 6-month and 12-month windows are
  // epoch arithmetic and are NOT affected — worth knowing before blaming the
  // clock for an empty row.
  function tzVal() {
    var v = els.tzone.value.trim().replace(/[^A-Za-z0-9_+\-\/]/g, "");
    return v === "" ? "Etc/UTC" : v;
  }

  // The optional API keys, as { name, value } pairs in .env order. Empty fields
  // are dropped, so a user who supplies none gets no .env block at all.
  //
  // Sanitised to the character sets the three services actually issue
  // (alphanumerics, and the - _ . ~ that turn up in tokens). That is not
  // cosmetic: the value is written into a shell heredoc and a .env file, and a
  // newline or a quote in it would end the block early and leave the rest of a
  // pasted secret sitting in the terminal as a command.
  var KEY_OK = /[^A-Za-z0-9._~-]/g;
  function keyVals() {
    var out = [];
    [["RRA_DISCOGS_KEY", els.discogskey], ["RRA_FANART_KEY", els.fanartkey],
     ["RRA_LASTFM_KEY", els.lastfmkey]].forEach(function (pair) {
      var raw = pair[1].value.trim();
      var val = raw.replace(KEY_OK, "");
      if (val) out.push({ name: pair[0], value: val, dropped: val !== raw });
    });
    return out;
  }

  // The .env block, or "" when there is nothing to write. Emitted as its own
  // paste step ahead of the run command: a key on the command line ends up in
  // shell history and in `docker inspect`, where a file with 600 does not.
  function envBlock() {
    var keys = keyVals();
    if (!keys.length) return "";
    return "cat > .env <<'EOF'\n" +
           keys.map(function (k) { return k.name + "=" + k.value; }).join("\n") +
           "\nEOF\nchmod 600 .env";
  }

  function renderMountHint() {
    var pairs = mountPairs();
    // Nothing to explain with no mount, or with the single historic /music.
    if (!els.mount.checked || pairs.length < 2) { els.mountHint.textContent = ""; return; }
    els.mountHint.innerHTML = "Mounted as " +
      pairs.map(function (m) { return "<code>" + esc(m.guest) + "</code>"; }).join(", ") +
      " — the scan reads every folder under <code>/music</code>. One thing to know: " +
      "Settings &rarr; <b>Label from folder depth</b> counts from <code>/music</code>, so with " +
      "several folders every depth goes up by one — level 1 is the name above, not your own " +
      "top folder.";
  }

  // A key that had characters removed is a key that will not work, so say so
  // rather than handing back a quietly shortened one. Usually a stray space or
  // a smart quote picked up from wherever the token was copied.
  var KEYS_HINT_BASE = "";
  function renderKeysHint() {
    if (!KEYS_HINT_BASE) KEYS_HINT_BASE = els.keysHint.innerHTML;
    var bad = keyVals().filter(function (k) { return k.dropped; })
                       .map(function (k) { return k.name; });
    els.keysHint.innerHTML = KEYS_HINT_BASE + (bad.length
      ? "<br><b class=\"warn\">Characters were removed from " +
        (bad.length > 1 ? bad.slice(0, -1).join(", ") + " and " + bad[bad.length - 1] : bad[0]) +
        ".</b> These keys are letters, digits and <code>. _ ~ -</code> only — check for a stray " +
        "space or a curly quote from wherever you copied it."
      : "");
  }

  function addMountRow(value) {
    var row = document.createElement("div");
    row.className = "mrow";
    var inp = document.createElement("input");
    inp.type = "text"; inp.spellcheck = false;
    inp.placeholder = "/another/music/folder";
    inp.value = value || "";
    var rm = document.createElement("button");
    rm.type = "button"; rm.textContent = "Remove";
    rm.setAttribute("aria-label", "Remove this music folder");
    rm.addEventListener("click", function () { row.remove(); render(); });
    inp.addEventListener("input", render);
    row.appendChild(inp); row.appendChild(rm);
    els.extraMounts.appendChild(row);
  }

  var NOTES = {
    same:     "Host networking lets the app <b>auto-discover your Roon Core</b> — no addresses to configure. Once it's running, enable it in <b>Roon → Settings → Extensions</b>.",
    separate: "Still host networking — Roon's discovery works across the LAN, so just make sure this machine is on the <b>same network/subnet</b> as your Roon Core.",
    macos:    "Docker Desktop on macOS can't use host networking, so the app <b>can't auto-discover the Core</b> — set your Roon Core's IP address here and the port is published instead."
  };

  // ---- command builders --------------------------------------------------
  // The published image (since v1.8.72's promotion): nothing to download or
  // build. --pull always makes every run fetch the release marked Latest, so a
  // re-created container can never quietly start an older copy left on disk —
  // the in-app update lives inside the container, and a re-create starts afresh.
  function buildRun() {
    var mac = state.mode === "macos";
    var out = [];

    var env = envBlock();
    if (env) {
      out.push({ t: "# API keys, in a file rather than on the command line — a key passed with -e\n" +
                    "# lands in your shell history and in `docker inspect`", c: "c" });
      out.push({ t: env, c: "" });
      out.push({ t: "", c: "" });
    }

    out.push({ t: "# Run it — --pull always fetches the current release every time this runs", c: "c" });

    var cmd = ["docker run -d \\"];
    cmd.push("  --name " + NAME + " \\");
    cmd.push("  --pull always \\");
    cmd.push("  --restart unless-stopped \\");
    if (mac) {
      cmd.push("  -p " + portVal() + ":3399 \\");
      cmd.push("  -e ROON_CORE_IP=" + ipVal() + " \\");
    } else {
      cmd.push("  --network host \\");
    }
    // Local time. A container is UTC otherwise, which moves Album of the day and
    // the hour Smart Picks turns over. TZ alone is enough and needs no bind
    // mount: tzdata is Priority: required in Debian, so the zone files are in
    // the bookworm-slim base this image is built on. Grouped with the other -e
    // flags rather than after the volumes.
    cmd.push("  -e TZ=" + tzVal() + " \\");
    if (env) cmd.push("  --env-file .env \\");
    cmd.push("  -v musicd-remote-data:/app/data \\");
    if (els.mount.checked) {
      mountPairs().forEach(function (m) {
        cmd.push("  -v " + shq(m.host + ":" + m.guest + ":ro") + " \\");
      });
    }
    cmd.push("  " + IMAGE);

    out.push({ t: cmd.join("\n"), c: "" });
    return out;
  }

  function buildCompose() {
    var mac = state.mode === "macos";
    var env = envBlock();
    var out = [];
    if (env) {
      out.push({ t: "# API keys, in a file rather than in the compose document — keeps them out\n" +
                    "# of the file you might paste into an issue or commit to a repo", c: "c" });
      out.push({ t: env, c: "" });
      out.push({ t: "", c: "" });
    }
    var y = [];
    // Emit a paste-safe command: bare YAML pasted into a shell makes bash try
    // to run every line ("services:: command not found"), so wrap the file
    // contents in a heredoc and chain the up command.
    y.push("# one paste: writes docker-compose.yml, then pulls the image and starts it");
    y.push("cat > docker-compose.yml <<'EOF'");
    y.push("services:");
    y.push("  musicd-remote:");
    y.push("    image: " + IMAGE);
    y.push("    pull_policy: always   # every up fetches the current release");
    y.push("    container_name: " + NAME);
    y.push("    restart: unless-stopped");
    if (mac) {
      y.push("    ports:");
      y.push("      - \"" + portVal() + ":3399\"");
    } else {
      y.push("    network_mode: host   # Roon Core auto-discovery on the local network");
    }
    // One environment block for both modes. TZ belongs in each — a container is
    // UTC otherwise — and ROON_CORE_IP only where discovery cannot run.
    y.push("    environment:");
    y.push("      TZ: \"" + tzVal() + "\"   # local time: Album of the day, Smart Picks hour");
    if (mac) y.push("      ROON_CORE_IP: \"" + ipVal() + "\"");
    // env_file, not the bare .env file: compose reads .env for SUBSTITUTION
    // inside this document, which is a different thing from passing it to the
    // container. Naming it here is what actually delivers the keys.
    if (env) y.push("    env_file: .env   # API keys — see the block above");
    y.push("    volumes:");
    y.push("      - musicd-remote-data:/app/data");
    if (els.mount.checked) {
      mountPairs().forEach(function (m) {
        y.push("      - \"" + m.host.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
               ":" + m.guest + ":ro\"   # read-only music mount");
      });
    }
    y.push("");
    y.push("volumes:");
    y.push("  musicd-remote-data:");
    y.push("    external: false   # keep this volume — it holds your Roon pairing + history");
    y.push("EOF");
    y.push("docker compose up -d");
    out.push({ t: y.join("\n"), c: "" });
    return out;
  }

  // very light highlighter for the pre block: comments, then flags/env keys
  // (flags only at the start of a token so hyphenated names in URLs stay plain)
  function highlight(text) {
    return esc(text)
      .replace(/^(#.*)$/gm, '<span class="c">$1</span>')
      .replace(/(^|\s)(--?[a-z][a-zA-Z-]*)/g, '$1<span class="k">$2</span>')
      .replace(/((?:ROON_CORE_IP|MUSIC_DIR|PORT|RRA_DEBUG)[=:])/g, '<span class="k">$1</span>');
  }

  function render() {
    var parts = state.tab === "run" ? buildRun() : buildCompose();
    plainCmd = parts.map(function (p) { return p.t; }).join("\n");
    els.cmd.innerHTML = parts.map(function (p) {
      return p.c === "c" ? '<span class="c">' + esc(p.t) + "</span>" : highlight(p.t);
    }).join("\n");

    renderMountHint();
    renderKeysHint();
    els.modeNote.innerHTML = NOTES[state.mode];

    els.afterNote.innerHTML = state.mode === "macos"
      ? "Then open <code>http://localhost:" + esc(portVal()) + "</code> on the Mac (or <code>http://&lt;this-Mac's-IP&gt;:" + esc(portVal()) + "</code> from another device) and enable <b>Rouen</b> in Roon → Settings → Extensions."
      : "Then open <code>http://&lt;this-machine-IP&gt;:3399</code> and enable <b>Rouen</b> in Roon → Settings → Extensions.";

    syncUrl();
  }

  // keep the URL shareable: re-encode form state into the query string
  function syncUrl() {
    var p = new URLSearchParams();
    if (state.mode !== "same") p.set("mode", state.mode);
    if (els.coreip.value.trim()) p.set("core", els.coreip.value.trim());
    if (portVal() !== "3399") p.set("port", portVal());
    if (!els.mount.checked) {
      p.set("mount", "0");
    } else {
      if (els.musicpath.value.trim()) p.set("music", els.musicpath.value.trim());
      // Extra folders travel as repeated music2 values, so a shared link rebuilds
      // the whole list rather than only the first field. Kept inside the checked
      // branch with `music`, or a link that says mount=0 would still carry paths.
      Array.prototype.forEach.call(els.extraMounts.querySelectorAll("input"), function (i) {
        if (i.value.trim()) p.append("music2", i.value.trim());
      });
    }
    if (els.tzone.value.trim()) p.set("tz", els.tzone.value.trim());
    var qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }

  function setMode(mode) {
    state.mode = mode;
    var labels = els.modes.querySelectorAll(".mode");
    for (var i = 0; i < labels.length; i++) {
      var sel = labels[i].getAttribute("data-mode") === mode;
      labels[i].classList.toggle("sel", sel);
      labels[i].querySelector("input").checked = sel;
    }
    var mac = mode === "macos";
    els.fCoreip.classList.toggle("hidden", !mac);
    els.fAppport.classList.toggle("hidden", !mac);
    els.musicpath.placeholder = mac ? "/Users/yourusername/Music" : "/your/path/to/Music";
    render();
  }

  function setTab(tab) {
    state.tab = tab;
    els.tabRun.classList.toggle("sel", tab === "run");
    els.tabCompose.classList.toggle("sel", tab === "compose");
    render();
  }

  // ---- wiring --------------------------------------------------------------
  els.modes.addEventListener("change", function (e) {
    if (e.target.name === "mode") setMode(e.target.value);
  });
  els.tabRun.addEventListener("click", function () { setTab("run"); });
  els.tabCompose.addEventListener("click", function () { setTab("compose"); });

  els.mount.addEventListener("change", function () {
    els.mountFields.classList.toggle("hidden", !els.mount.checked);
    render();
  });

  els.addMount.addEventListener("click", function () { addMountRow(""); render(); });
  // discogskey/fanartkey/lastfmkey are wired for rendering but are deliberately absent
  // from syncUrl() — the address bar is shared, bookmarked, and logged by
  // anything sitting in front of this page, and a secret does not belong in it.
  ["coreip", "appport", "musicpath", "tzone", "discogskey", "fanartkey", "lastfmkey"].forEach(function (id) {
    els[id].addEventListener("input", render);
  });

  els.copy.addEventListener("click", function () {
    function done() {
      els.copy.textContent = "Copied ✓";
      els.copy.classList.add("done");
      setTimeout(function () {
        els.copy.textContent = "Copy";
        els.copy.classList.remove("done");
      }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(plainCmd).then(done, fallbackCopy);
    } else fallbackCopy();
    function fallbackCopy() {
      var ta = document.createElement("textarea");
      ta.value = plainCmd;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* no clipboard available — user can select the text manually */ }
      document.body.removeChild(ta);
    }
  });

  // ---- latest release lookup ----------------------------------------------
  function setVersion(v) {
    state.version = v;
    if (els.verBadge) els.verBadge.textContent = "v" + v;   // the contents page's (site.js); not on this page
    if (els.verLine) els.verLine.textContent = "v" + v;
    render();
  }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function (data) {
      var m = String(data.tag_name || "").match(/^v?(\d+\.\d+\.\d+(?:-beta\d+)?)$/);
      if (m) { setVersion(m[1]); if (els.verNote) els.verNote.textContent = "(latest release)"; }
      else if (els.verNote) { els.verNote.textContent = "(latest known release)"; }
    })
    .catch(function () {
      // GitHub API unreachable or rate-limited — the baked-in fallback version still works.
      if (els.verNote) els.verNote.textContent = "(latest known release)";
    });

  // ---- URL query prefill (e.g. ?mode=macos&core=192.168.1.20&port=8080&music=/srv/music)
  var q = new URLSearchParams(location.search);
  if (q.get("core"))  els.coreip.value = q.get("core");
  if (q.get("port"))  els.appport.value = q.get("port");
  if (q.get("mount") === "0") { els.mount.checked = false; els.mountFields.classList.add("hidden"); }
  if (q.get("music")) { els.mount.checked = true; els.mountFields.classList.remove("hidden"); els.musicpath.value = q.get("music"); }
  q.getAll("music2").forEach(function (v) { if (v) addMountRow(v); });
  // Pre-filled from this browser, which is almost always the right answer and
  // is the difference between a correct clock and a silent UTC one.
  els.tzone.value = q.get("tz") ||
    (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })();
  var qm = q.get("mode");
  setMode(qm === "separate" || qm === "macos" ? qm : "same");
})();
