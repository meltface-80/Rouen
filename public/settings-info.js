// @ts-check
// The ⓘ beside a setting: its note as a toast, and each named after the setting it explains. Moved out of app.js in
// v2.0.3-t12, unchanged but for app.js's toastBottomAbovePill read off the window (dev/quality.md, "Splitting the
// monoliths"); loaded by app.js.
/* ------------------------------------------------------------------ */
/*  Settings info-icon toasts                                         */
/* ------------------------------------------------------------------ */
(() => {
  let toast = null;
  let dismissTimer = null;

  function getToast() {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "settings-info-toast";
      toast.setAttribute("role", "tooltip");
      document.body.appendChild(toast);
    }
    return toast;
  }

  function hideToast() {
    if (!toast) return;
    toast.classList.remove("visible");
    clearTimeout(dismissTimer);
  }

  function showToast(text) {
    const t = getToast();
    t.textContent = text;
    t.style.bottom = /** @type {any} */ (window).toastBottomAbovePill();
    t.classList.add("visible");
    clearTimeout(dismissTimer);
    // Long enough to READ: 5s was gone halfway through the longer notes.
    // About a fifth of a second a word on top of four seconds, at most 25s;
    // any tap elsewhere still closes it at once.
    const words = String(text || "").split(/\s+/).length;
    dismissTimer = setTimeout(hideToast, Math.min(25000, 4000 + words * 220));
  }

  // Every ⓘ was announced as just "Info". Name each after the setting it
  // explains, read from the label it sits in.
  for (const btn of document.querySelectorAll(".settings-info-btn")) {
    if (btn.getAttribute("aria-label") && btn.getAttribute("aria-label") !== "Info") continue;
    const host = btn.closest(".settings-label, .settings-block-title");
    const name = host ? host.textContent.replace(/[ⓘ\u24D8]/g, "").trim() : "";
    btn.setAttribute("aria-label", name ? "About " + name : "More information");
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".settings-info-btn");
    if (btn) {
      e.stopPropagation();
      showToast(btn.dataset.info || "");
      return;
    }
    hideToast();
  }, true);
})();
