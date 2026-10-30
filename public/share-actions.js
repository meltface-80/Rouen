// @ts-check
/*
 * share-actions.js — the buttons under the share card: Copy image, Share… and Download. Moved out of app.js in
 * v1.9.72-t22, when the Android app got its own way to each (dev/design/android-app.md §4.17).
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 *   RouenShareActions.build({ actions, hintEl, errEl }, blob, title, artist)
 *   RouenShareActions.iosStandalone()   also window.__iosStandalone (Backup & restore's Download asks it too)
 *
 * In a browser: Copy image through the clipboard, Share… through Web Share, Download as a link, each where the browser
 * has it. In the Android app none of those works in its WebView (a download link goes nowhere, there is no Web Share,
 * the image clipboard is refused), so the card's PNG is handed to the app (window.RouenPhone: CardShare.kt), as
 * Mandarin's page did with its app (window.MusicDShare).
 */
(() => {
  "use strict";

  /*
   * An iOS app added to the home screen, as opposed to iOS in a browser tab.
   *
   * Two separate facts, and both are needed. `navigator.standalone` is the
   * iOS-only flag for a home-screen launch; the display-mode query is the
   * standard one and covers an installed app elsewhere. The platform test is
   * what keeps this from firing on an installed desktop PWA, where downloading
   * works perfectly well — and it checks maxTouchPoints because an iPad reports
   * its platform as "MacIntel" and is indistinguishable from a Mac without it.
   */
  function iosStandalone() {
    try {
      const p = (navigator.platform || "") + " " + (navigator.userAgent || "");
      const isIOS = /iPhone|iPad|iPod/.test(p) ||
                    (/Mac/.test(p) && (navigator.maxTouchPoints || 0) > 1);
      if (!isIOS) return false;
      if (/** @type {any} */ (navigator).standalone === true) return true;
      return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    } catch (e) {
      // A UA sniff that throws must not take the share sheet with it; the
      // download button is the safe answer because it is what every other
      // platform gets.
      return false;
    }
  }

  /**
   * The Android app's three, when the page is in it: each takes the PNG as base64 and the file name, and answers
   * {"ok": true} or {"error": "…"} as JSON text (RouenPhone.kt). Null in a browser, or in an app too old to have them.
   * @returns {{ cardCopy: Function, cardShare: Function, cardSave: Function } | null}
   */
  function appCard() {
    const app = /** @type {any} */ (window).RouenPhone;
    if (!app || typeof app.cardCopy !== "function" || typeof app.cardShare !== "function" || typeof app.cardSave !== "function") return null;
    return app;
  }

  /**
   * The card's PNG as base64, without the data: prefix, for the app.
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const url = String(r.result || ""); res(url.slice(url.indexOf(",") + 1)); };
      r.onerror = () => rej(new Error("The card couldn't be read."));
      r.readAsDataURL(blob);
    });
  }

  /**
   * One of the app's acts: the error it gives, if it gives one, is thrown.
   * @param {Function} act  @param {Blob} blob  @param {string} fileName
   */
  async function inApp(act, blob, fileName) {
    const png = await blobToBase64(blob);
    /** @type {any} */
    let answer;
    try { answer = JSON.parse(String(act(png, fileName))); } catch (e) { answer = { error: "The app didn't answer." }; }
    if (!answer || answer.error) throw new Error((answer && answer.error) || "The app didn't answer.");
  }

  /**
   * @param {{ actions: HTMLElement, hintEl: HTMLElement, errEl: HTMLElement }} els
   * @param {Blob} blob  @param {string} title  @param {string} artist
   */
  function build(els, blob, title, artist) {
    const { actions, hintEl, errEl } = els;
    actions.innerHTML = "";
    const fileName =
      `${(artist || "artist").replace(/[^a-z0-9]+/gi, "_")}-` +
      `${(title  || "card"  ).replace(/[^a-z0-9]+/gi, "_")}.png`;

    const app = appCard();
    if (app) {
      // In the Android app (v1.9.72-t22): the three, by the app. A refusal says why under the card.
      /** @param {string} cls @param {string} name @param {string} label @param {string} done @param {Function} act */
      const appBtn = (cls, name, label, done, act) => {
        const b = mkBtn(cls, icon(name), label);
        b.onclick = async () => {
          errEl.textContent = "";
          try {
            await inApp(act, blob, fileName);
            if (done) { setLabel(b, done); setTimeout(() => setLabel(b, label), 2500); }
          } catch (e) { errEl.textContent = /** @type {Error} */ (e).message || String(e); }
        };
        actions.appendChild(b);
      };
      appBtn("ghost", "copy", "Copy image", "Copied!", (/** @type {string} */ png, /** @type {string} */ name) => app.cardCopy(png, name));
      appBtn("primary", "share", "Share…", "", (/** @type {string} */ png, /** @type {string} */ name) => app.cardShare(png, name));
      appBtn("ghost", "download", "Download", "Saved to Pictures", (/** @type {string} */ png, /** @type {string} */ name) => app.cardSave(png, name));
      hintEl.textContent = "Tap a button above, or long-press the card to save.";
      return;
    }

    const canShare = (() => {
      try {
        if (!navigator.share || !navigator.canShare) return false;
        const probe = new File([new Uint8Array([0])], "p.png", { type: "image/png" });
        return navigator.canShare({ files: [probe] });
      } catch { return false; }
    })();
    const canCopy = typeof window.ClipboardItem !== "undefined"
      && navigator.clipboard && typeof navigator.clipboard.write === "function";

    if (canCopy) {
      const b = mkBtn("ghost", icon("copy"), "Copy image");
      b.onclick = async () => {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
          setLabel(b, "Copied!"); setTimeout(() => setLabel(b, "Copy image"), 2000);
        } catch (e) { errEl.textContent = /** @type {Error} */ (e).message || String(e); }
      };
      actions.appendChild(b);
    }
    if (canShare) {
      const b = mkBtn("primary", icon("share"), "Share…");
      b.onclick = async () => {
        try {
          const file = new File([blob], fileName, { type: "image/png" });
          await navigator.share({ files: [file] });
        } catch (e) {
          const err = /** @type {Error} */ (e);
          if (err && err.name !== "AbortError") errEl.textContent = err.message || String(err);
        }
      };
      actions.appendChild(b);
    }
    // NOT on an installed iOS app. `<a download>` is not implemented in WebKit
    // on iOS — the attribute is ignored, so the button either navigates away
    // from the app to a blob: URL or does nothing at all, and in a standalone
    // PWA there is no browser chrome to get back from it. Long-pressing the
    // image gives the real Save Image, which is what the hint already says.
    //
    // Narrowed to STANDALONE rather than to iOS: in Safari proper the tab is
    // still there to return from, and on every other platform it works.
    if (!iosStandalone()) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.appendChild(document.createTextNode(""));
      a.innerHTML = `${icon("download")}<span>Download</span>`;
      actions.appendChild(a);
    }

    hintEl.textContent = (canCopy || canShare)
      ? "Tap a button above, or long-press the card to save."
      : "Long-press the card to save.";
  }

  /** @param {string} cls @param {string} iconSvg @param {string} label */
  function mkBtn(cls, iconSvg, label) {
    const b = document.createElement("button");
    b.className = cls;
    b.type = "button";
    b.innerHTML = `${iconSvg}<span>${label}</span>`;
    return b;
  }
  /** @param {HTMLElement} btn @param {string} text */
  function setLabel(btn, text) {
    const s = btn.querySelector("span");
    if (s) s.textContent = text;
  }
  /** @param {string} name */
  function icon(name) {
    /** @type {Record<string, string>} */
    const I = {
      share:    '<polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
      copy:     '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ""}</svg>`;
  }

  /** @type {any} */ (window).RouenShareActions = { build, iosStandalone };
  // Backup & restore's Download needs the same answer (v1.8.84): one copy.
  /** @type {any} */ (window).__iosStandalone = iosStandalone;
})();
