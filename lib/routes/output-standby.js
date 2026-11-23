// @ts-check
"use strict";
/*
 * output-standby.js — POST /api/output/standby { output_id, control_key?, mode: "toggle" | "standby" }: a device put in
 * standby, or toggled. Moved out of index.js unchanged in Rouen Lite's L1 (dev/quality.md, "Splitting the monoliths");
 * its helpers (shouldRetryKeyless, controlStatusOf, keylessStandbyFallback, roonErrorPayload) stay in index.js, where
 * test/unit/zonemodes.test.js reads them.
 */

/**
 * @param {{ post: Function }} app
 * @param {{ core: () => any, outputs: () => Record<string, any> | null, modes: string[],
 *           roonErrorPayload: (err: any) => any, shouldRetryKeyless: (name: string, hadKey: boolean) => boolean,
 *           controlStatusOf: (output: any, key: string) => string | null, keylessStandbyFallback: (status: any) => string | null }} d
 */
function mountOutputStandby(app, d) {
  app.post("/api/output/standby", (/** @type {any} */ req, /** @type {any} */ res) => {
    const core = d.core();
    const outputs = d.outputs() || {};
    if (!core) return res.status(503).json({ error: "Not paired with Roon Core" });
    const { output_id, control_key } = req.body || {};
    const mode = (req.body && req.body.mode) || "toggle";
    if (!output_id) return res.status(400).json({ error: "output_id required" });
    if (!d.modes.includes(mode)) {
      return res.status(400).json({ error: "invalid mode, allowed: " + d.modes.join(", ") });
    }
    if (mode === "toggle" && !control_key) {
      return res.status(400).json({ error: "control_key required for mode=toggle" });
    }
    if (control_key !== undefined && typeof control_key !== "string") {
      return res.status(400).json({ error: "control_key must be a string" });
    }

    const t = core.services.RoonApiTransport;
    const name = (outputs[output_id] && outputs[output_id].display_name) || output_id;
    const opts = control_key ? { control_key } : {};
    console.log(`[standby] ${mode} ${name}${control_key ? " (" + control_key + ")" : ""}`);
    // On a not-found, dump what the Core actually told us about this output's
    // controls — the only way to see the real key shape, and exactly the moment it
    // matters. `alreadyDumped` keeps a failure that was dumped before a retry
    // decision from printing the same block twice.
    const dumpControls = () => {
      console.warn("[standby] core reported source_controls:",
                   JSON.stringify((outputs[output_id] || {}).source_controls || null));
    };
    const fail = (err, alreadyDumped) => {
      const raw = typeof err === "string" ? err : JSON.stringify(err);
      console.warn(`[standby] failed: ${raw}`);
      if (!alreadyDumped && raw === "SourceControlNotFound") dumpControls();
      res.status(500).json(d.roonErrorPayload(err));
    };

    if (mode !== "toggle") {
      return t.standby(output_id, opts, (err) => err ? fail(err) : res.json({ ok: true }));
    }

    // Keyed toggle first. In production this is the path that works — a WiiM's
    // device-provided control accepts keyed toggle_standby with the very key it
    // refuses for convenience_switch, so the two calls resolve differently inside
    // the Core. The fallback below is cover for devices where it doesn't, not a
    // workaround for an observed failure on this one.
    t.toggle_standby(output_id, opts, (err) => {
      if (!err) return res.json({ ok: true, form: "toggle-keyed" });
      const raw = typeof err === "string" ? err : JSON.stringify(err);
      const notFound = raw === "SourceControlNotFound";
      if (notFound) dumpControls();
      if (!d.shouldRetryKeyless(raw, true)) return fail(err, notFound);

      const status = d.controlStatusOf(outputs[output_id], control_key);
      const want = d.keylessStandbyFallback(status);
      console.warn(`[standby] keyed toggle refused; status=${status || "unknown"} fallback=${want || "none"}`);
      if (!want) return fail(err, notFound);

      const after = (e2) => e2 ? fail(e2) : res.json({ ok: true, form: "keyless-" + want });
      if (want === "wake") t.convenience_switch(output_id, {}, after);
      else                 t.standby(output_id, {}, after);
    });
  });
}

module.exports = { mountOutputStandby };
