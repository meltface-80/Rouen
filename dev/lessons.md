# Lessons — the rules that cost a release to learn

Read on demand from `CLAUDE.md`: before diagnosing any "it broke in version N" report, before
writing a pixel or position test, before touching `<head>`, the waveform, or the seek bar, and
before a non-trivial review. Each rule here was paid for by a version that shipped wrong. None
of them can be checked by a tool, which is why they are prose; anything a tool CAN check belongs
in a gate (`dev/quality.md`), not here.

## Development rules

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
- **Centred in Chromium is not centred in Safari.** v1.9.70-t5 and t7 measured every Shelf tile's title in its
  middle, and the owner's iPad showed each at the top. The tile, a `<button>`, was a grid whose height came from
  `aspect-ratio`, and centred its title in the grid's one row; Chromium stretches that row to the height, Safari
  does not. A position test proves what Chromium draws. Where Safari is known to differ, the test makes Chromium
  behave as Safari does (here `align-content: start` on the tile) and measures again; and what centres a thing is a
  box whose size doesn't depend on the browser's choice (here the title's own box over the whole tile).
- **A DOM test that hangs may be the browser, and that is proved, not assumed.** From v1.9.66 the
  phone tests of `shelf-v1966.test.js` sometimes never ended: `spawnSync … headless_shell ETIMEDOUT`
  after 90 s, five times on CI and locally, and re-runs passed. It was found by looping those tests
  four at a time (about 1 run in 200 hung) and attaching gdb to the hung processes: in every one
  the renderer's main thread waited in `cc::LayerTreeHost::WaitForProtectedSequenceCompletion()`
  for a commit, with the compositor thread, the GPU process and the browser all idle. Virtual time
  had stopped at 200 to 400 ms, before the driver's first step. That is a deadlock inside the
  pinned Chromium 141, not anything the page does: turning every animation off from the first
  frame made it rarer, not gone, and `--disable-threaded-compositing` changes what pages draw.
  **v1.9.72-t20** (the owner's choice): the harness kills a page that has not ended in 30 s (pages
  end in a second or two) and runs it once more, saying so in the output; a second hang fails. When
  a different test starts hanging, attach gdb before blaming this: `gdb -p <renderer> -batch -ex
  "thread apply all bt 12"`. Kill a wrapper and Chromium can live on as orphans, which is also how
  the hung ones were caught alive to be looked at.
- **A ResizeObserver reports at a frame, and the harness's clock can outrun frames.** The Shelf kept the bar's height
  (`--foot-h`, which the volume and zone sheets stand on) up to date only from the stage's ResizeObserver. In a
  browser that is one frame late at worst; in the harness, virtual time races ahead while frames come on the wall
  clock, so a driver could open the volume sheet after the bar grew and before any frame: shelf-v1968's phone test
  failed about 1 run in 100, every time with `--foot-h` at 85px under a 124px bar (the playing track's line, 39 px,
  had come in). An earlier look had called "the bar grows" refuted; measuring `--foot-h` itself in the failing runs
  showed otherwise. **v1.9.72-t21**: a sheet has the bar measured as it opens. A size that something else is placed
  by is measured where it is used, not only when an observer says so; and a test of it grows the thing and uses it
  in one task, with no frame between (`test/dom/shelf-sheet-foot.test.js`).
- **No partial migrations.** When renaming a constant or moving it to settings, search the entire file with grep before committing to ensure zero stale references remain.

## When a bug is found

1. Identify the root cause (not the symptom).
2. Confirm the root cause explains ALL reported failures.
3. Fix the root cause, not the symptom.
4. Add the gate (test, lint rule) that would have caught it — `dev/quality.md`.
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
| H — CLAUDE.md + dev/*.md conventions | Quote the exact rule and exact violating line |

### Verify findings

For each surviving candidate, spawn one verifier agent and get: **CONFIRMED / PLAUSIBLE / REFUTED**.
- PLAUSIBLE by default — do not refute without quoting code that proves it impossible.
- REFUTED only when the code provably makes it unreachable.
- Keep CONFIRMED and PLAUSIBLE. Drop REFUTED.

### Fix all confirmed findings before committing

Do not commit with known CONFIRMED or PLAUSIBLE bugs. Fix them all in the same version bump.

---
