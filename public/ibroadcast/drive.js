// @ts-check
/*
 * ibroadcast/drive.js — the drive's part of Settings → Plugins → iBroadcast (2.0.6-t2, dev/design/ibroadcast.md §4):
 * whether it can be made here and why not, whether it is mounted, the probe's albums (up to 20: search the library, Add,
 * Remove), and what was read: served, refused, downloaded, with the whole report shown on the page to copy (a link would
 * open without the login's cookie in the Android app, which opens links outside it). Shown signed in;
 * settings.js says when (window.RouenIBroadcastDrive).
 */
(function () {
  const W = /** @type {any} */ (window);
  const body = /** @type {HTMLElement | null} */ (document.querySelector('[data-plugin-body="ibroadcast"]'));
  if (!body) return;
  body.insertAdjacentHTML("beforeend", `
        <div class="settings-block" id="ib-drive" hidden>
          <div class="settings-block-title">Drive for Roon (a probe)</div>
          <div class="settings-note" id="ib-drive-status"></div>
          <div class="settings-note">Rouen shows these albums to Roon as a folder: in Roon, add <strong>/mnt/ibroadcast</strong> as a storage folder, and leave its audio analysis as it is. A file's start and end are always read; its music only while it plays or is queued.</div>
          <div id="ib-drive-albums"></div>
          <div class="settings-token-row">
            <input id="ib-drive-q" class="settings-token-input" type="search" placeholder="Find an album or artist in iBroadcast" autocomplete="off" aria-label="Find an album to add">
          </div>
          <div id="ib-drive-found"></div>
          <div class="settings-note" id="ib-drive-totals"></div>
          <div class="settings-row settings-row-top ib-actions">
            <button id="ib-drive-refresh" class="settings-update-btn" type="button">Refresh</button>
            <button id="ib-drive-show" class="settings-update-btn" type="button">Show the report</button>
            <button id="ib-drive-copy" class="settings-update-btn" type="button" hidden>Copy the report</button>
          </div>
          <pre class="ib-drive-report" id="ib-drive-report" hidden></pre>
        </div>`);
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const block = $("ib-drive"), status = $("ib-drive-status"), list = $("ib-drive-albums"), q = /** @type {HTMLInputElement} */ ($("ib-drive-q"));
  const found = $("ib-drive-found"), totals = $("ib-drive-totals"), refresh = $("ib-drive-refresh");
  const show = $("ib-drive-show"), copy = $("ib-drive-copy"), report = $("ib-drive-report");
  const toast = (/** @type {string} */ m, /** @type {string} [k] */ k) => { if (W.__showToast) W.__showToast(m, k); };
  /** @param {number} b */
  const size = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
  /** @type {any} */
  let state = null;
  let on = false;

  /** A row: an album's words, and one button. @param {any} a @param {string} label @param {() => void} act */
  function row(a, label, act) {
    const r = document.createElement("div");
    r.className = "settings-row ib-drive-row";
    const t = document.createElement("span");
    t.className = "settings-label";
    t.textContent = a.artist + " — " + a.title + (a.year ? " (" + a.year + ")" : "") + " · " + a.tracks + " track" + (a.tracks === 1 ? "" : "s");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "settings-update-btn";
    b.textContent = label;
    b.addEventListener("click", act);
    r.append(t, b);
    return r;
  }

  /** @param {any} s  GET /api/ibroadcast/drive */
  function paint(s) {
    state = s;
    const m = s.mount || {};
    status.textContent = !s.available ? s.why
      : m.error ? m.error
      : m.mounted ? "Mounted: Roon sees it at /mnt/ibroadcast."
      : s.albums.length ? "Not mounted yet." : "Add albums below to make the drive.";
    list.textContent = "";
    for (const a of s.albums) list.appendChild(row(a, "Remove", () => { choose(s.albums.filter((x) => x.id !== a.id).map((x) => x.id)); }));
    const t = s.totals || {};
    totals.textContent = t.files ? `Read so far: ${t.files} file${t.files === 1 ? "" : "s"} · starts ${size(t.start)} · ends ${size(t.tail)} · music ${size(t.audio)}`
      + ` · ${t.refused} read${t.refused === 1 ? "" : "s"} refused · downloaded ${size(t.downloaded)}` : "Nothing read yet.";
  }

  async function look() {
    if (!on) return;
    try {
      const r = await fetch("/api/ibroadcast/drive", { cache: "no-store" });
      if (r.ok) paint(await r.json());
    } catch (e) { /* no answer: the block keeps what it showed, and Refresh asks again */ }
  }

  /** @param {string[]} ids */
  async function choose(ids) {
    try {
      const r = await fetch("/api/ibroadcast/drive/albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      // Not JSON (a proxy's error page): the status alone says it failed, and is said below.
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't change the drive (" + r.status + ")");
      paint(j);
    } catch (e) { toast(/** @type {Error} */ (e).message, "error"); }
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing;
  q.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(async () => {
      const text = q.value.trim();
      found.textContent = "";
      if (!text) return;
      try {
        const r = await fetch("/api/ibroadcast/drive/search?q=" + encodeURIComponent(text), { cache: "no-store" });
        const res = r.ok ? await r.json() : [];
        if (q.value.trim() !== text) return;
        const have = new Set(((state && state.albums) || []).map((/** @type {any} */ a) => a.id));
        for (const a of res) if (!have.has(a.id)) found.appendChild(row(a, "Add", () => { choose([...have, a.id]); found.textContent = ""; q.value = ""; }));
        if (!found.children.length) found.textContent = "No album of yours in iBroadcast matches.";
      } catch (e) { found.textContent = "iBroadcast's library couldn't be searched."; }
    }, 300);
  });
  refresh.addEventListener("click", look);
  show.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/ibroadcast/drive/report", { cache: "no-store" });
      if (!r.ok) throw new Error("The report couldn't be read (" + r.status + ")");
      report.textContent = JSON.stringify(await r.json(), null, 2);
      report.hidden = false;
      copy.hidden = false;
    } catch (e) { toast(/** @type {Error} */ (e).message, "error"); }
  });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(report.textContent || ""); toast("Report copied"); }
    catch (e) { toast("Couldn't copy: select the report and copy it by hand.", "error"); }
  });

  W.RouenIBroadcastDrive = {
    /** Signed in or not: the block shown, and read. @param {boolean} signedIn */
    signedIn(signedIn) { on = signedIn; block.hidden = !signedIn; if (signedIn) look(); },
    stop() { on = false; block.hidden = true; report.hidden = true; copy.hidden = true; },
  };
})();
