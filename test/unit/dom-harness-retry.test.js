"use strict";
// v1.9.72-t20: the DOM harness and Chromium 141's renderer deadlock (test/dom/harness.js, dev/lessons.md). About one
// run in 200 of shelf-v1966's phone tests, Chromium's renderer main thread waited for ever in
// cc::LayerTreeHost::WaitForProtectedSequenceCompletion() with every other thread idle: the page never ended, and the
// suite went red after 90 s (CI 2026-10-28 and 2026-10-30, locally three times). A page that never ends is now killed
// at 30 s and run once more, and the harness says so; a second hang, and every other failure, still fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const { runChromium, HANG_MS } = require("../dom/harness");

/** execFileSync's own error when its timeout kills the child. */
const hang = () => Object.assign(new Error("spawnSync headless_shell ETIMEDOUT"), { code: "ETIMEDOUT" });

/** A stand-in for execFileSync answering each call from `answers` in turn: a string is the dumped DOM, an Error is thrown. */
function chromium(answers) {
  const calls = [];
  const exec = (bin, args, options) => {
    calls.push({ args, options });
    const a = answers[calls.length - 1];
    if (a instanceof Error) throw a;
    return a;
  };
  return { exec, calls };
}

test("THE one: a page Chromium never finishes is run once more, and that is said", () => {
  const c = chromium([hang(), "<div id=\"TESTRESULTS\">e30=</div>"]), said = [];
  const dom = runChromium(c.exec, ["--dump-dom", "/tmp/x/shelf1966-bar-phone.html"], { encoding: "utf8" }, "/tmp/x/shelf1966-bar-phone.html", (l) => said.push(l));
  assert.equal(dom, "<div id=\"TESTRESULTS\">e30=</div>");
  assert.equal(c.calls.length, 2);
  assert.deepEqual(c.calls[1].args, c.calls[0].args, "the same page, the same way");
  assert.equal(said.length, 1);
  assert.match(said[0], /shelf1966-bar-phone\.html/);
  assert.match(said[0], /deadlock/);
});

test("a second hang is a failure: nothing is retried twice", () => {
  const c = chromium([hang(), hang(), "never reached"]);
  assert.throws(() => runChromium(c.exec, [], {}, "p.html", () => {}), { code: "ETIMEDOUT" });
  assert.equal(c.calls.length, 2);
});

test("any other failure is not retried: a crash or a bad flag fails at once", () => {
  const crash = Object.assign(new Error("Command failed"), { status: 1 });
  const c = chromium([crash, "never reached"]);
  assert.throws(() => runChromium(c.exec, [], {}, "p.html", () => {}), /Command failed/);
  assert.equal(c.calls.length, 1);
});

test("a page that ends is run once, with the hang limit as its timeout and its own options kept", () => {
  const c = chromium(["dom"]), said = [];
  assert.equal(runChromium(c.exec, [], { encoding: "utf8", maxBuffer: 5 }, "p.html", (l) => said.push(l)), "dom");
  assert.equal(c.calls.length, 1);
  assert.deepEqual(c.calls[0].options, { encoding: "utf8", maxBuffer: 5, timeout: HANG_MS });
  assert.equal(HANG_MS, 30000);
  assert.deepEqual(said, []);
});
