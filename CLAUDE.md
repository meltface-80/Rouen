# Claude Code — Project Rules for Roon Random Albums Extension

Read this file at the start of every session. These rules are permanent and override any
default behaviours. Do not deviate from them unless the user explicitly says so in that session.

---

## ZERO-TOLERANCE QUALITY MANDATE

**Regressions are not acceptable. Bugs introduced by a change are a failure, not a follow-up task.**

### Agent workflow — run for every non-trivial change

Every change must pass through all four agents before committing:

1. **Architect Agent** — scan files, map side effects, verify the change won't break adjacent behaviour or mobile rendering.
2. **Reviewer Agent** — ensure the change handles edge cases, empty states, and errors safely.
3. **Developer Agent** — apply complete, production-grade code. No inline placeholders (`// ...` or `// rest stays the same`).
4. **QA Agent** — run `npm run check` (see Gates below), verify pass status, and report results clearly.

Keep output compact — no wall-of-text explanations. Tag results clearly: `[PASS]` or `[FAIL] reason`.

### Gates — machines enforce these, not this file (since v1.9.8)

Every rule a tool can check lives in a tool now. **`QUALITY.md` is the plan** — the gates, why each
exists, how its baseline moves, and the order the monoliths are split in. Read it before any change
that adds a module, touches `tools/`, or would move a baseline.

```bash
npm run tools     # once per clone: ESLint + TypeScript into tools/lint (never the app's deps)
npm run gates     # file length + @ts-check/tsc + ESLint (~10 s; the pre-commit hook runs it)
npm test          # static + unit + DOM suites (~3 min)
npm run check     # both — run before every push
```

CI (`checks.yml`) runs the same commands, and **the test image and the release both need it green**.
The pre-commit hook (`.githooks/`, switched on by the session hook in `.claude/settings.json`) runs
the gates and the static suite. `--no-verify` is off the table.

Where the old hand-run pre-flight steps went:

| Was | Now |
|-----|-----|
| 1 `node --check` | `test/static/preflight.test.js` (every shipped .js) |
| 2 stale `DISCOGS_TOKEN`/`FANART_TV_KEY` grep | `preflight.test.js` + ESLint `no-undef` (catches EVERY undeclared name) |
| 3 TDZ (`require('./index.js')`) | ESLint `no-use-before-define`. Starting `index.js` still needs a Roon Core — when one is not available, say so |
| 4 `.innerHTML` read | `preflight.test.js` + ESLint `no-restricted-syntax` in `public/` |
| 5 workflow `${{ }}` expressions | `preflight.test.js` |
| 6 iOS head / one viewport meta | `test/static/pwa-icons.test.js` (head allowlist — nothing outside it may enter `<head>`) |
| checklist: `getElementById` targets exist | `preflight.test.js` |

**Baselines only shrink.** The 33 files over 500 lines (`tools/quality/length-baseline.json`), the
236 recorded lint violations (`tools/lint/eslint-suppressions.json`) and the 15 modules without
`// @ts-check` (`tools/quality/ts-baseline.json`) are today's debt. New code must pass outright.
**Never raise a baseline, add a suppression, add an `eslint-disable`, or add a file to a baseline
to make a change pass** — if it seems necessary, stop and ask the user first.

- **New logic goes in a new module** under `lib/` (or its own `public/<screen>.js`), under 500
  lines, opening with `// @ts-check`, with its tests — never appended to `index.js` or `app.js`.
- **Each session that touches a monolith moves one feature out of it** (order in `QUALITY.md`)
  and records the smaller number with `npm run lines -- --ratchet` in the same commit.
- **A test proves something only if it fails when the code breaks.** For an important test, break
  the code on purpose and watch it fail before trusting it.

### Before every push — what no tool checks

- [ ] `npm run check` is green (or the DOM suite's absence is stated)
- [ ] Every new `catch` comment honestly says why silence is safe — not swallowing a symptom
- [ ] Nothing new in `<head>` that iOS reads — see the rules below; the head allowlist in
      `test/static/pwa-icons.test.js` is the reference for what is permitted
- [ ] `package.json` version bumped, CHANGELOG.md entry added

### Development rules

- **No incomplete implementations.** Write the full code. Never leave `// rest stays the same`.
- **No silent catch.** `catch (e) {}` must have a comment explaining why silence is safe.
- **Variable name freeze.** Once a variable is named, all references — declaration, assignment, template literals, log messages — use the identical name. Never mix camelCase and UPPER_SNAKE for the same value.
- **Declaration before use.** With `let`/`const` in Node.js, a bare assignment `x = val` on line N while `let x` is on line N+500 is a ReferenceError. Always declare at the first-use site.
- **Nothing goes in `<head>` without knowing whether iOS reads it.** The four lines
  charset / viewport / theme-color / title are the confirmed-good set (v1.6.50, installed and
  verified filling an iPhone screen); icon `<link>`s are inert and safe. Anything else — a
  manifest link, any `apple-*` meta — changes how iOS sizes the window, is baked in when the user
  adds the shortcut, and cannot be undone by shipping a new build. **A "still broken" report after
  such a change is not evidence the fix failed**: the old window config is still in the shortcut
  until it is deleted and re-added. Ask the user to reinstall the shortcut BEFORE diagnosing.
- **A stale installed PWA looks exactly like a regression. Rule it out FIRST.** The rule above says
  this for `<head>` changes; it is not limited to them. iOS keeps a home-screen shortcut's app state
  across updates, and a shortcut that has gone bad reproduces as "you broke X in version N" with
  perfect consistency — the user is not wrong about what they see, and no amount of reading the diff
  will find it. **v1.7.88–89**: "album covers aren't populating, v1.7.87 was fine". Two versions were
  spent on it; a third of a session went into a root cause that did not exist, and a fix shipped under
  a claim that turned out to be false. Deleting the shortcut and re-adding it fixed it with no code
  change. What SHOULD have happened, in this order:
    1. Ask for a delete-and-re-add of the shortcut before diagnosing anything.
    2. Diff the suspect versions for code that could plausibly cause the symptom. If `index.js` and
       the data path are untouched, a data-shaped symptom (missing artwork, empty rows, wrong counts)
       is almost certainly not in the diff.
    3. Reproduce it side by side. `git worktree add /tmp/vNN <tag>` plus
       `MUSICD_PUBLIC_DIR=/tmp/vNN/public node --test <probe>` runs the harness against BOTH versions
       from one script. Identical output is a real answer: the regression is not in the code.
  A hypothesis that survives none of those three is not a root cause, and shipping a fix for it
  attaches a false explanation to a real change.
- **Two numbers from two different moments are not a measurement.** The harness has two clocks:
  the driver runs inside the virtual time budget, and `--screenshot` fires when that budget
  EXPIRES — seconds of page-time later. A `getBoundingClientRect` reported by the driver and a
  pixel read out of the screenshot describe different frames, and in a Now-playing fixture the page
  moves 8.5px between them. **v1.7.90**: an assertion built that way reported the seek thumb riding
  8.5px off the waveform. It did not. A fix was written and nearly shipped — the native thumb hidden,
  the playhead redrawn into the canvas — before measuring BOTH values out of the same screenshot
  showed the thumb had been exactly on the midline all along. The whole change was reverted.
  When a test compares two positions, take both from the same source: two driver-time rects, or two
  screenshot-time pixel scans. Never one of each. (The real 2px defect in the same area was found
  the correct way, and the pixel test that pins it now scans for the waveform's bars AND the thumb
  in the one image.)
- **Ask what a statistic SATURATES at, and reduce with the same one at every scale.** The
  waveform drew a brick for five versions because each bar was the loudest SAMPLE in its slice,
  and a limiter puts something on the ceiling inside nearly any window you can name — so the
  measurement had no range left to show and every bar came out the same height. **v1.8.24**: a
  bar is an RMS level now, and the reduction is RMS too, because the RMS of RMS values IS the
  RMS of the whole span — a bar folded twice equals one computed once, so the picture does not
  depend on how many bars fit the screen. The rule the first version broke was never "prefer
  peaks", it was DO NOT AVERAGE PEAKS; measuring a level and then keeping the LOUDEST one is
  the same mistake one layer down and draws the same brick. Two corollaries learned the same
  day: **a downmix is an ADDITION** (`-ac 1` averages the channels rather than taking the
  louder, so an out-of-phase passage decodes to silence — RMS 0 against the pair's 2896), and
  **a short decode is not a short track** (a waveform is a map from time to a picture, so
  two thirds of a file drawn across the whole bar puts the playhead over the wrong music, by a
  margin that grows as it plays, and nothing about it looks wrong).
- **Two mappings from time to x will disagree, and the disagreement is zero in the middle.** A
  range input cannot let its thumb hang off either end, so its thumb travels `thumbW/2` to
  `w - thumbW/2` while anything drawn under it is laid from 0 to `w`. The error is
  `thumbW * (0.5 - frac)`: half a thumb ahead of the music at the start, level halfway,
  half a thumb behind at the end. **A test written at the midpoint passes against both
  mappings and says nothing** — which is exactly why v1.8.0's shipped for four versions.
  Anything drawn to line up with a native control is inset to that control's travel, and the
  width it travels in is ONE number both of them read (`--seek-thumb`).
- **A canvas is transparent between what it draws.** A fixture whose waveform is quiet where the
  assertion looks will pass with the drawing wrong, because the page shows through the gaps. Pixel
  tests over a canvas need a full-scale fixture at the point being checked, and a paused zone, or
  the playhead walks away from the coordinates being sampled.
- **Device-only behaviour cannot be tested here.** The DOM harness is headless Chromium: no browser
  chrome, no safe areas, `dvh` == `vh` == `100%`. No assertion in this suite can observe iOS window
  behaviour, so writing more of them buys confidence and no coverage. What the suite CAN do is pin a
  known-good state so it is not changed silently — that is what the head allowlist does.
- **No partial migrations.** When renaming a constant or moving it to settings, search the entire file with grep before committing to ensure zero stale references remain.

### When a bug is found

1. Identify the root cause (not the symptom).
2. Confirm the root cause explains ALL reported failures.
3. Fix the root cause, not the symptom.
4. Add the relevant pre-flight check above if one would have caught it.
5. Document what class of error it was in the CHANGELOG.

---

## Code review workflow (multi-agent)

For any non-trivial change, run a full code review using parallel agents before committing. The `/code-review --effort high` skill automates this. It must be run on any change that touches:
- The label scan pipeline (`runLabelsIndexScan`, `buildFileLabelMap`, pass logic)
- Discogs or FanArt.tv API integration
- Settings persistence (`savePersistedSettings`, `loadPersistedSettings`)
- New UI components in `public/app.js` or `public/index.html`

### Review angles (run in parallel via Agent tool)

Spawn all 8 angles simultaneously, then verify surviving candidates:

| Angle | What it hunts |
|-------|---------------|
| A — line-by-line diff scan | Inverted conditions, null deref, missing await, wrong variable |
| B — removed-behavior auditor | Dropped guards, deleted error paths, narrowed validation |
| C — cross-file tracer | Broken call sites, mismatched request/response shapes |
| D — reuse | Code that re-implements an existing helper |
| E — simplification | Redundant state, dead code, unnecessary nesting |
| F — efficiency | Sync I/O on hot paths, redundant computation |
| G — altitude | Bandaids layered on shared infrastructure |
| H — CLAUDE.md conventions | Quote the exact rule and exact violating line |

### Verify findings

For each surviving candidate, spawn one verifier agent and get: **CONFIRMED / PLAUSIBLE / REFUTED**.
- PLAUSIBLE by default — do not refute without quoting code that proves it impossible.
- REFUTED only when the code provably makes it unreachable.
- Keep CONFIRMED and PLAUSIBLE. Drop REFUTED.

### Fix all confirmed findings before committing

Do not commit with known CONFIRMED or PLAUSIBLE bugs. Fix them all in the same version bump.

---

## Repository — branch + PR workflow

- Develop on a **feature branch** of `meltface-80/MusicD-Remote` (e.g. `claude/<topic>`). Never commit directly to `main`.
- For each change: commit to the branch and push. CI builds the **test image**
  `ghcr.io/meltface-80/musicd-remote:<version>-test` from the push (`test-image.yml`); once
  that run has finished green, give the user the docker command for it (see below). The user
  tests the branch build, then opens and merges the PR themselves. **No tarball is committed**
  (since v1.8.70 — see "Images" below).
- **Never open or merge a pull request yourself** unless the user explicitly asks. The user merges.
- **Two-phase release handshake (revised 2026-07-28 — supersedes the earlier rule).**
  - **"merged"** = the user tested the branch build and merged it. This is the nod to
    **cut the release**: confirm the tag `vX.Y.Z` and a **pre-release** exist for it, and
    create them if the workflow didn't. Also confirm the version IMAGE
    `ghcr.io/meltface-80/musicd-remote:X.Y.Z` was pushed (release.yml's `image` job — check
    its run). Do NOT touch README / docs-site versions yet.
  - **"marked/moved to latest"** = the user is happy and has promoted the release. `latest.yml`
    then points `ghcr.io/…:latest` at it by itself — confirm that run went green. NOW run
    the full promotion pass: every README version reference, the docs-site fallback
    version/examples, **`docker-compose.yml`**, and this file's current-stable note +
    version-history table, as a docs-only commit on the freshly-restarted branch. Since
    v1.8.72's promotion every install command pulls `ghcr.io/…:latest` with `--pull always`
    (Compose: `pull_policy: always`) and names no version, so what moves per release is the
    README title, the "new in" feature entries and the docs site's badge and fallback — but
    still read the install commands and `docker-compose.yml` against the builder's output.
    `docker-compose.yml` is on that list because it was NOT, and sat at v1.7.73 through
    twenty releases: nothing generates it (the docs-site builder writes its own, per user), so
    it only ever changes when someone remembers.
  - After every merge, VERIFY the release actually appeared (`list_releases` / `git
    ls-remote --tags`). The workflow failing silently is how v1.6.52-v1.6.55 shipped with
    no tag and no release at all.
- **Never write a literal `${{ ... }}`-style expression token in a workflow file**, not even
  inside a shell comment: Actions evaluates them anywhere in the file, and an invalid one
  fails the run at startup with zero jobs — which looks like "nothing happened", not an
  error. (Caused the v1.6.52-55 release outage.)
- The `old/` folder contains two permanent historical tarballs (v1.5.37 and v1.5.49). **Do not add to or remove from this folder.**

---

## Every build — required steps (in order)

**Docs-only exception:** a change that touches only `docs/` (the GitHub Pages site) and/or
repo documentation (`README.md`, `CHANGELOG.md`, `CLAUDE.md`, `docker-compose.yml`) is NOT a
build. `docker-compose.yml` counts because it can only ever name an ALREADY-PUBLISHED image —
so it is a post-release edit by nature, exactly like the README's install commands. It skips
the version bump, the CHANGELOG entry and the docker install command, and builds no test image
(`test-image.yml` ignores pushes that touch only `docs/**`, `*.md` and `docker-compose.yml`) — `docs/` is never part
of the running extension. `npm run gates` still runs (it is cheap and index.js must stay
untouched), and the change still gets a normal review before commit. The v1.6.36 bump for the original docs page was reverted
for exactly this reason — do not repeat it.

1. Make code changes
2. Bump `package.json` version
3. Add a CHANGELOG.md entry (see format below)
4. `npm run check` — gates and the whole suite (see Gates above)
5. Commit in a single commit: code + `package.json` + `CHANGELOG.md`
6. Push to the feature branch
7. Wait for that commit's **Test image** run (`test-image.yml`) to finish green — check it via
   the GitHub API (`actions_list` workflow runs for the branch, matching the pushed SHA). Its
   `checks` job (gates + suite) runs first and the image is built only if it passes. A failed or
   cancelled run means there is nothing to test yet: fix it, don't hand out the command.
8. Give the user the docker command for `:<version>-test` (see template below)

---

## Images (since v1.8.70)

Everything is published to **`ghcr.io/meltface-80/musicd-remote`**, for `linux/amd64` and
`linux/arm64`, by three workflows:

| Workflow | When | Tags |
|----------|------|------|
| `test-image.yml` | every push to a non-`main` branch (not docs-only) | `<version>-test` (pinned — use this one) and `test` (last test build, any branch) |
| `release.yml` → `image` job | every merge to `main` that creates a new version | `<version>` |
| `latest.yml` | a release marked Latest (`released`/`edited`), or run by hand with a version | `latest` → `<version>` (built from the tag first if missing) |

- **Every install keeps the one-tap in-app update, the image included — a user requirement
  (2026-10-02).** v1.8.70 replaced it on the image with the pull command; the user rejected
  that and v1.8.71 restored it. Do not reintroduce a pull-only image.
- **The update check runs every 7 days, plus once at startup — the user's decision
  (2026-10-02).** v1.8.72 moved it to every 12 hours to match Mandarin; the user put it back
  in v1.8.73. `UPDATE_CHECK_MS` is pinned by a test. Do not change it unless asked.
- An in-app update unpacks the release INSIDE the container, so it lasts until the container is
  recreated. That is why every install command carries `--pull always` (Compose:
  `pull_policy: always`): a recreate then fetches the current `:latest` rather than restarting
  the stale local copy, which would quietly put the user back on an older version.
- The published image is built with `MUSICD_IMAGE=ghcr.io/…`. The app reads it to offer
  `docker pull …:latest` BESIDE the Update button (Settings → System, Roon's Settings page) —
  only for a release that exists as an image (`FIRST_IMAGE` = 1.8.70 in `lib/updater.js`).
- The image keeps the paths, port and (root) user it always had: an existing `musicd-remote-data`
  volume must keep working when a tarball install switches to the image.
- The release still carries a tarball asset, and must keep it: EVERY one-tap update installs from
  it — native, locally built container and published image alike.
- The package is PUBLIC: it took the public repository's visibility on its first push
  (v1.8.70's test image), verified by pulling the manifest with an anonymous token — no
  `docker login` is needed. If a pull ever answers `denied`, check GitHub → Packages →
  musicd-remote → Package settings before anything else.
- No tarballs are committed to the repo any more.

---

## GitHub releases — user-controlled

The user manually publishes releases on GitHub when they are satisfied with testing.

- **Never create a GitHub release yourself.**
- **Never change the latest/pre-release status yourself.** Marking a release Latest is also
  what moves the `:latest` image — that is the user's call, every time.

---

## README.md — frozen until told otherwise

- The README contains version references: its title and the "new in vX" feature entries. Its
  install commands pull `ghcr.io/meltface-80/musicd-remote:latest` (since v1.8.72's promotion) and
  carry none.
- **Do not change any version number in README.md** unless the user explicitly says
  "promote to latest" or "update the README".
- Current stable version in the README: **v1.9.7** (until the user says otherwise). Moved there at the user's word
  ("Also update readme.md and GitHub.io") on `claude/v1.9.7-docs`, a docs-only branch from main made after v1.9.7's
  merge (#199) — v1.9.7's own branch was already merged when the docs were ready, so they could not ride in it.
  v1.9.7 was marked Latest the same evening. v1.9.4–v1.9.6 were never promoted on their own; the README's
  "new in v1.9.4–v1.9.7" Shelf entry and the docs site's Shelf card cover all four.
- Before that the README pointed at **v1.9.3**. Promoted at the user's word
  ("promote to latest") on `claude/lastfm-api`, after v1.9.3 was marked Latest, in the same branch as the Last.fm
  key instructions and the uninstall section, so one merge brings all three. v1.9.2 was never promoted on its own
  (it shipped inside v1.9.3's merge); its fix is listed in v1.9.3's README entry. Before that the README pointed at
  v1.9.1, moved there in v1.9.1's own branch ("I only want a single merge"), which also folded in v1.8.87's
  never-run promotion.
- **The README and the docs site are titled "Rouen + HQPWeb"** (the user's wording, 2026-10-08), and
  each carries a section of that name crediting statelycurmudgeon's hqpweb, linking its repository,
  and giving its usage steps — Rouen's own and hqpweb run on its own, the latter taken from hqpweb's
  README. The project spells itself "hqpweb"; body text uses that. CrystalGipsy / HQPlayer Bridge is
  NOT credited anywhere, at hqpweb's developer's request — and nothing from that project is used.
- The extension is named **Rouen** since v1.8.74 (it was MusicD Remote; "for Roon" is descriptive, not part of the name). The rename is display-only: the Docker image/container/volume (`musicd-remote`, `musicd-remote-data`), log file names and the repository keep their names. The Roon `extension_id` must NEVER change — it would force every user to re-authorize.
- **Releases are titled `Rouen + HQPWeb vX.Y.Z`** (since v1.9.1, the user's wording — v1.8.87 was
  renamed to it by hand; from v1.8.74 to v1.8.85 they were `Rouen vX.Y.Z`), never `MusicD Remote
  vX.Y.Z`. `release.yml` sets the title (`--title "Rouen + HQPWeb $TAG"`), pinned by
  `test/static/images.test.js`. Every release from v1.8.74 to v1.8.76 came out as "MusicD Remote …"
  because the rename missed the workflow, and the user renamed each by hand. After every merge,
  check the new release's TITLE as well as its existence.
- **The repository is now `meltface-80/Rouen`** (renamed by the user; the old `MusicD-Remote` URL
  redirects). Nothing may derive a published name from the repository name. All three image
  workflows derived the image from `$GITHUB_REPOSITORY`, so the rename silently moved every image
  to `ghcr.io/meltface-80/rouen` while every install command still pulled `musicd-remote`, and its
  `:latest` stayed at v1.8.73 (fixed in the v1.8.76 reissue). The image is NAMED `musicd-remote`
  in the workflows, and a test fails if it is derived again.
- **The release tarball keeps its name**, `MusicD-Remote-vX.Y.Z.tar.gz`. The updater finds the
  asset by extension, so renaming it would be safe, but it is not part of the display name and
  stays as it is unless the user asks.

---

## CHANGELOG.md format

Add a new section at the top, above the previous version:

```
## [X.Y.Z] — YYYY-MM-DD

### Added / Fixed / Changed
- Description of change
```

---

## After each build — docker install command template

Once the test image's run is green, give this command with the version filled in. It pulls
FIRST, and everything after the pull sits inside `&& { … }`, so a failed pull leaves the
running container untouched. **Lines pasted one after another do not do that**: a shell runs
each one whatever the last one did. That is how the template stood until 2026-10-03, when the
user ran it for v1.8.74 before the image was built — the pull failed, and the stop and the
remove ran anyway. Use the music path the user actually runs with (that day it was
`/mnt/dietpi_userdata/MyMusic`). Drop the `/music` mount line when the user is testing a
Qobuz/Tidal streaming-only scenario.

```bash
sudo docker pull ghcr.io/meltface-80/musicd-remote:NEW-test && {
  sudo docker stop musicd-remote
  sudo docker rm musicd-remote
  sudo docker run -d \
    --name musicd-remote \
    --restart unless-stopped \
    --network host \
    -v musicd-remote-data:/app/data \
    -v /mnt/dietpi_userdata/MyMusic:/music:ro \
    ghcr.io/meltface-80/musicd-remote:NEW-test
}
# NOTE: the volume holds the Roon pairing + history. New installs (and the
# user's box, after the one-time v1.6.32 copy migration) use
# musicd-remote-data; pre-v1.6.32 installs must copy roon-random-albums-data
# into it once (see README Updating) — a wrong/renamed volume silently
# starts empty (re-pairing, lost history).
```

Old locally built images (`musicd-remote:<version>`, from the tarball days) can be removed once
the switch is made: `sudo docker images musicd-remote` lists them, `sudo docker image rm
musicd-remote:<version>` removes one. Never suggest `docker image prune -a` — it takes every
unused image on the machine, not just this app's. Removing an image never touches a volume.

---

## Version history

The per-version table (what each release changed, and the class of error each fix was) is in
**`HISTORY.md`**. Read it when diagnosing a regression or when a version is referenced; add a row
there for every release, as before.
