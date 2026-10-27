"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t7: the Windows build, pinned.
//
// Nothing here can run GitHub Actions or build on Windows, so what would
// quietly break the promise if it drifted is pinned as text:
//   * every release gets the two files (the executable and the payload a
//     Windows install updates from), by the same workflow run that makes the
//     release — so a Windows install is offered the release when every other
//     install is, and finds something to install;
//   * every working-branch push keeps a Windows build with its run, to try
//     before merging, as the test image is;
//   * the names the workflow attaches are the ones the updater looks for;
//   * the bootstrap inside the executable uses Node's own modules only, since
//     nothing else is there when it first runs;
//   * the build's output never rides into an image, a payload or a commit.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");
const { REPO_ROOT } = require("../lib/extract");
const { EXE_SUFFIX, PAYLOAD_SUFFIX, windowsAssetNames } = require("../../lib/windows-release");
const build = require("../../tools/windows/build");

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

test("the Windows workflow (v1.9.67-t7)", async (t) => {
  const win = read(".github/workflows/windows.yml");
  const release = read(".github/workflows/release.yml");
  const testImg = read(".github/workflows/test-image.yml");

  await t.test("THE one: release.yml attaches the build to every release, after the release exists", () => {
    const job = /^  windows:\n((?:(?!^  \S)[\s\S])*)/m.exec(release);
    assert.ok(job, "release.yml has no windows job");
    assert.match(job[1], /needs:\s*release/, "the Windows build must follow the release it goes on");
    assert.match(job[1], /uses:\s*\.\/\.github\/workflows\/windows\.yml/);
    assert.match(job[1], /publish:\s*true/, "release.yml does not ask for the build to be attached");
    assert.match(job[1], /contents:\s*write/, "the caller must grant what attaching an asset needs");
  });

  await t.test("test-image.yml keeps a build with every working-branch run, after the checks", () => {
    const job = /^  windows:\n((?:(?!^  \S)[\s\S])*)/m.exec(testImg);
    assert.ok(job, "test-image.yml has no windows job");
    assert.match(job[1], /needs:\s*checks/, "a red branch gets no Windows build, as it gets no image");
    assert.match(job[1], /uses:\s*\.\/\.github\/workflows\/windows\.yml/);
    assert.doesNotMatch(job[1], /publish/, "a test build is never attached to a release");
    assert.match(job[1], /contents:\s*read/);
    assert.match(win, /upload-artifact@v\d+/, "windows.yml no longer keeps the test build with the run");
    assert.match(win, /if:\s*inputs\.publish == false\s*\n\s+uses:\s*actions\/upload-artifact/, "the artifact is kept only for a test build");
  });

  await t.test("the workflow builds on Windows with the build script, and attaches the two names the updater knows", () => {
    assert.match(win, /runs-on:\s*windows-latest/);
    // The image's major (Dockerfile node:20): better-sqlite3 9.6 has a prebuilt
    // binary for it and none for 22, which left npm compiling on a runner whose
    // Visual Studio node-gyp did not know.
    assert.match(win, /node-version:\s*20/, "the executable is built on Node 20, as the image is");
    assert.match(win, /npm install --omit=dev/, "the payload's node_modules come from a production install on the runner");
    assert.match(win, /run:\s*node tools\/windows\/build\.js --out dist/);
    assert.match(win, /gh release upload "\$TAG" "dist\/\$EXE" "dist\/\$PAYLOAD"/, "the two files are not attached to the release");
    assert.match(win, new RegExp('exe=Rouen-v\\$V' + EXE_SUFFIX.replace(/\./g, "\\.")), "the executable's name differs from lib/windows-release.js");
    assert.match(win, new RegExp('payload=Rouen-v\\$V' + PAYLOAD_SUFFIX.replace(/\./g, "\\.")), "the payload's name differs from lib/windows-release.js");
    assert.match(win, /publish:\s*\n\s+description:[^\n]*\n\s+type:\s*boolean\s*\n\s+default:\s*false/, "publish must be opt-in");
    assert.match(win, /gh release view "\$TAG"[\s\S]*exists=/, "windows.yml no longer skips a release that carries the build");
    assert.doesNotMatch(win, /:latest\b/, "windows.yml touches `latest`");
    assert.doesNotMatch(win, /^\s+permissions:/m, "windows.yml asks for permissions of its own: the callers grant them (read for a test build, write to attach)");
    assert.doesNotMatch(win, /\$GITHUB_REPOSITORY(?!_)[^ "]/, "a name derived from the repository would move on a rename");
  });

  await t.test("the names, from one place", () => {
    assert.deepEqual(windowsAssetNames("1.2.3"), { exe: "Rouen-v1.2.3" + EXE_SUFFIX, payload: "Rouen-v1.2.3" + PAYLOAD_SUFFIX });
  });
});

test("the build script (tools/windows/build.js)", async (t) => {
  await t.test("the payload names what goes in: the release tarball's exclusions, the output and the tools' modules out", () => {
    const release = read(".github/workflows/release.yml");
    const tarballExcludes = [...release.matchAll(/--exclude='\.\/([^']+)'/g)].map((m) => m[1]);
    assert.ok(tarballExcludes.length >= 4, "release.yml's tarball excludes not found");
    const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rouen-root-"));
    try {
      for (const d of [".git", "old", "data", "dist", "lib", "public", "tools/lint/node_modules", "node_modules/node-uuid/dist", "node_modules/.cache"]) {
        fs.mkdirSync(path.join(root, d), { recursive: true });
      }
      for (const f of ["index.js", "package.json", "config.json", ".update", "MusicD-Remote-v1.tar.gz", "package-lock.json"]) fs.writeFileSync(path.join(root, f), "");
      const entries = build.payloadEntries(root, "dist");
      for (const e of tarballExcludes) {
        if (e === "node_modules") continue;   // the one difference: the payload is the tarball WITH node_modules
        assert.ok(!entries.includes(e.replace(/^\*/, "MusicD-Remote-v1")), "the payload no longer leaves out " + e);
      }
      assert.deepEqual(entries, ["index.js", "lib", "node_modules", "package.json", "public", "tools"]);
      // bsdtar (Windows' tar) matches an --exclude at every depth: `./dist`
      // would take node_modules/node-uuid/dist with it, and index.js would not
      // start. So the top level is named outright, and the only patterns left
      // are ones harmless at any depth.
      const args = build.payloadArgs(root, path.join(root, "dist"), "/p.tgz");
      const excludes = args.filter((a) => a.startsWith("--exclude=")).map((a) => a.slice(10));
      assert.deepEqual(excludes, build.NESTED_EXCLUDES);
      for (const e of excludes) assert.ok(e.includes("/") && !e.startsWith("."), "a top-level name as an --exclude pattern: " + e);
      assert.deepEqual(args.slice(-(entries.length + 2)), ["-C", root, ...entries]);
      assert.deepEqual(build.payloadEntries(root, path.join("..", "elsewhere")).includes("dist"), true, "an output outside the checkout excludes nothing");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await t.test("the single-executable config: the bootstrap, the payload, the version", () => {
    const out = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rouen-sea-"));
    try {
      const cfg = build.seaConfig(out, path.join(out, "p.tar.gz"), "1.2.3");
      const json = JSON.parse(fs.readFileSync(cfg.file, "utf8"));
      assert.equal(json.main, path.join(REPO_ROOT, "lib", "windows-bootstrap.js"));
      assert.equal(json.disableExperimentalSEAWarning, true, "the executable would print a warning at every start");
      assert.equal(json.assets["app.tgz"], path.join(out, "p.tar.gz"));
      assert.equal(fs.readFileSync(json.assets["version.txt"], "utf8").trim(), "1.2.3");
      assert.equal(json.output, cfg.blob);
      assert.ok(path.isAbsolute(json.output));
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
  });

  await t.test("npm knows the build", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.scripts["build:windows"], "node tools/windows/build.js");
  });
});

test("the bootstrap inside the executable (lib/windows-bootstrap.js)", async (t) => {
  const src = read("lib/windows-bootstrap.js");
  await t.test("requires Node's own modules only: nothing else is on disk when it first runs", () => {
    const required = [...src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    assert.ok(required.length >= 5, "no requires found");
    for (const r of required) {
      const bare = r.replace(/^node:/, "");
      assert.ok(builtinModules.includes(bare) || bare === "sea", r + " is not one of Node's own modules");
    }
  });
  await t.test("runs only inside a single executable", () => {
    assert.match(src, /sea\.isSea\(\)/, "the bootstrap no longer checks it is inside an executable: `node lib/windows-bootstrap.js` and every test would run it");
  });
});

test("the build's output stays out of images, payloads and commits", () => {
  assert.ok(read(".gitignore").split("\n").includes("dist/"), ".gitignore lacks dist/");
  assert.ok(read(".dockerignore").split("\n").map((l) => l.trim()).includes("dist"), ".dockerignore lacks dist");
  const tsconfig = JSON.parse(read("tools/lint/tsconfig.json").replace(/^\s*"\/\/":.*\n/m, ""));
  assert.ok(tsconfig.include.includes("../windows/**/*.js"), "tools/windows is not type-checked");
  const { judge } = require("../../tools/quality/tscheck");
  assert.deepEqual(judge({ "tools/windows/x.js": false }, []).length, 1, "tools/windows is not required to carry // @ts-check");
});
