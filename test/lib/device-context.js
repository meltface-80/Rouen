"use strict";
// A request from a device on Rouen profile "2", linked to the Roon profile "deadbeef", as lib/profiles/index.js's
// middleware runs one of a device's own routes (profiles.md §5, 2.0.7-t4); and what a job sees of it.

const { createProfileContext, asDevice, deviceRoon } = require("../../lib/profiles/context");

function deviceCtx() {
  const ctx = createProfileContext({ store: { first: () => ({ id: "1" }), get: (id) => (id === "2" ? { id } : null), markSeen() {} }, guest: "guest" });
  /** fn run as that device's request. */
  const run = (fn) => new Promise((resolve, reject) => {
    ctx.middleware({ headers: { cookie: "rouen_profile=2" } }, {}, () => asDevice("deadbeef", () => { Promise.resolve().then(fn).then(resolve, reject); }));
  });
  /** Whose the code running now acts as: the device's profile and Roon profile, or nulls (the household's). */
  const seen = () => ({ viewer: ctx.viewer(), roon: deviceRoon() });
  return { ctx, run, seen };
}

module.exports = { deviceCtx };
