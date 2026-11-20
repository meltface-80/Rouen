// @ts-check
/*
 * ibroadcast/settings.js — Settings → Plugins → iBroadcast, its page (2.0.6-t1, dev/design/ibroadcast.md §3.4), from
 * Mandarin's public/app/settings-ibroadcast.js less its upload. Loaded only while the plugin is on (public/plugins.js),
 * and registered with RouenPlugins last:
 *
 *   signed out   Sign in on iBroadcast: iBroadcast's link to tap and the code to approve Rouen with there, asked
 *                after every two seconds until the sign-in completes or fails; Cancel lets it go.
 *   signed in    who, Premium, the formats iBroadcast takes, what the library holds, Read library now, Sign out.
 */
(function () {
  const W = /** @type {any} */ (window);
  const top = /** @type {HTMLElement | null} */ (document.querySelector('[data-plugin-top="ibroadcast"]'));
  const body = /** @type {HTMLElement | null} */ (document.querySelector('[data-plugin-body="ibroadcast"]'));
  if (!top || !body || !W.RouenPlugins) return;

  body.insertAdjacentHTML("beforeend", `
        <div class="settings-block" id="ib-account">
          <div class="settings-block-title">Your iBroadcast account</div>
          <div class="settings-note" id="ib-status"></div>
          <div class="settings-row settings-row-top" id="ib-signin-row">
            <button id="ib-signin" class="action-btn primary" type="button">Sign in on iBroadcast</button>
          </div>
          <div id="ib-pending" hidden>
            <div class="settings-note">Open <a id="ib-link" href="#" target="_blank" rel="noopener noreferrer"></a> and approve Rouen with this code:</div>
            <div class="ib-code" id="ib-code"></div>
            <div class="settings-row settings-row-top"><button id="ib-cancel" class="settings-update-btn" type="button">Cancel</button></div>
          </div>
          <div id="ib-signed" hidden>
            <div class="settings-row"><span class="settings-label">Premium</span><span class="ib-value" id="ib-premium"></span></div>
            <div class="settings-row"><span class="settings-label">Formats</span><span class="ib-value" id="ib-formats"></span></div>
          </div>
        </div>
        <div class="settings-block" id="ib-library-block" hidden>
          <div class="settings-block-title">Your iBroadcast library</div>
          <div class="settings-note" id="ib-library"></div>
          <div class="settings-row settings-row-top ib-actions">
            <button id="ib-read" class="settings-update-btn" type="button">Read library now</button>
            <button id="ib-signout" class="settings-update-btn" type="button">Sign out</button>
          </div>
        </div>`);
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const status = $("ib-status"), signinRow = $("ib-signin-row"), signin = /** @type {HTMLButtonElement} */ ($("ib-signin"));
  const pendingBox = $("ib-pending"), link = /** @type {HTMLAnchorElement} */ ($("ib-link")), code = $("ib-code");
  const cancel = $("ib-cancel"), signed = $("ib-signed"), premium = $("ib-premium"), formats = $("ib-formats");
  const libBlock = $("ib-library-block"), libText = $("ib-library"), readNow = /** @type {HTMLButtonElement} */ ($("ib-read"));
  const signout = $("ib-signout");

  const toast = (/** @type {string} */ m, /** @type {string} [k] */ k) => { if (W.__showToast) W.__showToast(m, k); };
  /** A size in bytes as the page says it. @param {number} b */
  const size = (b) => (b >= 1e12 ? (b / 1e12).toFixed(1) + " TB" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
  /** @param {number} n @param {string} one */
  const count = (n, one) => n.toLocaleString() + " " + one + (n === 1 ? "" : "s");

  /** What the page says of the library ([l]: the state's library). @param {any} l */
  function libraryWords(l) {
    if (l.reading) return "Reading your iBroadcast library…";
    const failed = l.error ? "The last reading failed: " + l.error + ". " : "";
    if (typeof l.albums !== "number") return failed + "Your library is read shortly after signing in.";
    return failed + count(l.albums, "album") + " · " + count(l.tracks, "track") + " (" + l.lossless.toLocaleString() + " lossless) · "
      + size(l.bytes) + " · read " + new Date(l.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let again;
  let live = false;
  /** Changes made since a reading was asked for: a reading from before one is not painted over it. */
  let changes = 0;

  /** @param {any} j  GET /api/ibroadcast/status */
  function paint(j) {
    const on = !!(j && j.connected), pending = !on && j && j.pending;
    signinRow.hidden = on || !!pending;
    pendingBox.hidden = !pending;
    if (pending) {
      link.href = pending.url;
      link.textContent = String(pending.url).replace(/^https?:\/\//, "");
      code.textContent = pending.code || "";
    }
    signed.hidden = !on;
    libBlock.hidden = !on;
    status.textContent = on ? "Signed in as " + ((j.user && j.user.name) || "your account")
      : pending ? (pending.error || "Waiting for Rouen to be approved on iBroadcast…") : "Not signed in.";
    premium.textContent = !on ? "" : j.premium === true ? "Yes: Roon will get your files as they are"
      : j.premium === false ? "No: iBroadcast streams only 128 kbps MP3 copies" : "iBroadcast didn't say";
    formats.textContent = on ? ((j.formats || []).map((/** @type {string} */ f) => f.toUpperCase()).join(", ") || "iBroadcast didn't say") : "";
    const l = (on && j.library) || {};
    libText.textContent = on ? libraryWords(l) : "";
    readNow.disabled = !!l.reading;
    clearTimeout(again);
    if (live && ((pending && !pending.error) || l.reading || (on && j.describing))) again = setTimeout(look, 2000);
  }

  async function look() {
    const before = changes;
    try {
      const j = await (await fetch("/api/ibroadcast/status", { cache: "no-store" })).json();
      if (changes === before && live) paint(j);
    } catch (e) { /* no answer: the page keeps the last state, and the next look asks again */ }
  }

  /** @param {string} path */
  async function post(path) {
    changes++;
    const r = await fetch("/api/ibroadcast" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    // Not JSON (a proxy's error page): the status alone says it failed, and is said below.
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "iBroadcast didn't answer (" + r.status + ")");
    return j;
  }

  signin.addEventListener("click", async () => {
    signin.disabled = true;
    // The link is shown to tap, not opened for the person: a tab opened after an answer is blocked on a phone, and the
    // Android app's page opens links its own way.
    try { paint(await post("/signin")); }
    catch (e) { toast(/** @type {Error} */ (e).message, "error"); }
    finally { signin.disabled = false; }
  });
  cancel.addEventListener("click", async () => {
    try { paint(await post("/signin/cancel")); } catch (e) { toast(/** @type {Error} */ (e).message, "error"); }
  });
  readNow.addEventListener("click", async () => {
    readNow.disabled = true;
    libText.textContent = "Reading your iBroadcast library…";
    try { paint(await post("/library")); toast("iBroadcast library read"); }
    catch (e) { toast(/** @type {Error} */ (e).message, "error"); look(); }
  });
  signout.addEventListener("click", async () => {
    const confirmDialog = W.__confirmDialog || ((/** @type {string} */ m) => Promise.resolve(window.confirm(m)));
    if (!await confirmDialog("Sign out of iBroadcast? Rouen forgets the sign-in and the library it read; your iBroadcast account is unchanged.")) return;
    try { paint(await post("/signout")); toast("Signed out of iBroadcast"); } catch (e) { toast(/** @type {Error} */ (e).message, "error"); }
  });

  W.RouenPlugins.register("ibroadcast", {
    start() { live = true; top.hidden = false; body.hidden = false; look(); },
    stop() { live = false; clearTimeout(again); top.hidden = true; body.hidden = true; },
    // No screen of its own yet: its side-menu entry stays hidden (public/plugins.js).
    show() {},
    settingsOpened() { look(); },
  });
})();
