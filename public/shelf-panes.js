// @ts-check
/*
 * shelf-panes.js — the Shelf's side panes (v1.9.5): the choices on the left
 * and the queue on the right each fold away to their own edge and come back
 * from the small tab hanging off them, so the shelf can have the whole
 * screen. Kept per device: a tablet on a stand is set up once. shelf.css does
 * the sliding; the shelf re-measures itself as its column widens (the
 * ResizeObserver on the stage). Moved out of shelf.js in v1.9.67-t5,
 * behaviour unchanged.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h: the
 * shelf's own state and helpers, and the other parts, the queue among them):
 *
 *   const panes = ShelfPanes.create(h);
 *   panes.setPick(on, save), panes.setQueue(on, save), panes.restore()
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, storeGet, storeSet } = h;
    const screenEl = $("#screen");
    const PICK_KEY = "rra-shelf-pick", QUEUE_KEY = "rra-shelf-queue";
    /** @param {HTMLElement} el @param {boolean} open @param {string} what */
    function tabSays(el, open, what) {
      const label = (open ? "Hide " : "Show ") + what;
      el.setAttribute("aria-expanded", open ? "true" : "false");
      el.setAttribute("aria-label", label);
      el.title = label;
    }
    // A tap slides: .sliding switches the columns' transition on for the length
    // of the slide (shelf.css says why only then). The stage's ResizeObserver
    // follows it frame by frame where it is delivered; the shelf is also laid
    // out on the next frame and once the slide is over, so it always ends up
    // measured for the room it has, whether or not an observer was told.
    let paneTimer = 0;
    const paneMs = () => (parseFloat(getComputedStyle(screenEl).getPropertyValue("--pane-d")) || 0.32) * 1000;
    function startSlide() {
      screenEl.classList.add("sliding");
      requestAnimationFrame(h.layout);
      clearTimeout(paneTimer);
      paneTimer = setTimeout(() => { screenEl.classList.remove("sliding"); h.layout(); }, paneMs() + 60);
    }
    // save: a tap (slides, and is kept); otherwise the state this device left
    /** @param {boolean} on @param {boolean} save */
    function setPick(on, save) {
      if (save) startSlide();
      screenEl.classList.toggle("pick-off", !on);
      tabSays($("#pick-tab"), on, "the choices");
      if (save) storeSet(PICK_KEY, on ? "on" : "off");
    }
    /** @param {boolean} on @param {boolean} save */
    function setQueue(on, save) {
      if (save) startSlide();
      const open = !!on;
      screenEl.classList.toggle("queue-on", open);
      tabSays($("#queue-tab"), open, "the queue");
      if (save) storeSet(QUEUE_KEY, open ? "on" : "off");
      // read only while it can be seen: a closed pane costs the Core nothing
      h.queue.setOpen(open);
    }
    $("#pick-tab").addEventListener("click", () => setPick(screenEl.classList.contains("pick-off"), true));
    $("#queue-tab").addEventListener("click", () => setQueue(!h.queue.isOpen(), true));
    // The panes as this device left them (no slide: nothing is .sliding).
    function restore() {
      setPick(storeGet(PICK_KEY) !== "off", false);
      setQueue(storeGet(QUEUE_KEY) === "on", false);
    }
    return { setPick, setQueue, restore };
  }

  window.ShelfPanes = { create };
})();
