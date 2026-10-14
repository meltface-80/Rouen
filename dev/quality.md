# Code quality plan

Rouen is written mostly by an AI coding assistant. That works while a project is small, and stops
working when the code grows faster than its structure: files get too big for anyone to reason
about, tests stop proving anything, and each fix starts causing new bugs. This plan is how we stop
that. It follows hqpweb's `docs/quality-plan.md` and ohshitgorillas' file-length ratchet, adapted to
a plain-JavaScript project with no build step.

**The idea:** rules in a prompt get skipped or misread; tools don't. Every rule a machine can check
moves out of `CLAUDE.md` into a gate that runs on every commit and blocks a release when it fails.
`CLAUDE.md` keeps only what no tool can check.

## Principles

1. **Gates run automatically.** Locally (pre-commit, ~10 s) and in CI (`checks.yml`), where a red
   gate stops the test image and the release. A rule that lives only in a document is ignored in a
   long session.
2. **Today's debt is recorded, not fixed all at once.** Every gate starts from a baseline of what
   already fails. New code must pass; the baseline may only shrink.
3. **Gates earn their place.** Each one names the bug class it catches. One that catches nothing
   over a few releases is reconsidered.
4. **Logic lives in small modules with tests**, not inside `index.js` or `public/app.js`.
5. **Tests prove behaviour.** For any important test, break the code on purpose and check the test
   fails. A test that cannot fail is worse than none: it reads as protection.
6. **Small steps.** One concern per change. A refactor keeps behaviour identical and proves it.
7. **Don't freeze the product.** Gates constrain how the code is written, not what it does.

## The gates

| Gate | Command | Catches | Starts as | Tightens to |
|------|---------|---------|-----------|-------------|
| **Tests that block** | `npm test` | Regressions | Static + unit + DOM suites in CI; the image and the release need them green | — |
| **File length** | `npm run lines` | Files too big to reason about | No file over 500 lines; those already over are listed in `tools/quality/length-baseline.json` and may only shrink. The owner, 2026-10-14: up to 850 may stay; over 850 is brought under 850 as part of the work ("Splitting the monoliths") | Every file over 850 under it; then the baseline holds only 500–850 |
| **Baselines** | `npm run baselines` | A baseline loosened by hand: an entry raised and then "ratcheted", a module added to the `@ts-check` exemptions, `eslint --suppress-all` | Each baseline compared with the merge-base of `origin/dev` (a pull request's base branch in CI); nothing may rise or appear | — |
| **ESLint** | `npm run lint` | Undeclared names (the `DISCOGS_TOKEN` class), use before declaration (the v1.5.66 TDZ crash), silent `catch {}`, reading `.innerHTML` (v1.6.52), unreachable code, duplicate keys/cases, unused code | Today's 236 violations in `tools/lint/eslint-suppressions.json`; only new ones fail | Suppressions empty; more rules |
| **Types** | `npm run typecheck` | Wrong property, wrong argument, misspelled name — before it runs | `// @ts-check` + JSDoc on every server module; the 15 that do not pass yet (`index.js` among them) are in `tools/quality/ts-baseline.json`, which may only shrink | Every module checked, then `public/*.js` too |
| **Static checks** | `bash test/run.sh static` | The old `CLAUDE.md` greps: syntax, stale constant names, innerHTML reads, workflow expressions, iOS head rules | Already tests | — |

`npm run gates` runs length, the baseline guard, types and lint. `npm run check` runs those and the whole suite.
`npm run tools` installs the development tools (once per clone).

### Where the old hand-run pre-flight steps went

`CLAUDE.md` used to carry six grep checks to run by hand before every commit. Each is now a test or
a lint rule:

| Was | Now |
|-----|-----|
| 1 `node --check` | `test/static/preflight.test.js` (every shipped .js) |
| 2 stale `DISCOGS_TOKEN`/`FANART_TV_KEY` grep | `preflight.test.js` + ESLint `no-undef` (catches every undeclared name) |
| 3 TDZ (`require('./index.js')`) | ESLint `no-use-before-define`. Starting `index.js` still needs a Roon Core |
| 4 `.innerHTML` read | `preflight.test.js` + ESLint `no-restricted-syntax` in `public/` |
| 5 workflow `${{ }}` expressions | `preflight.test.js` |
| 6 iOS head / one viewport meta | `test/static/pwa-icons.test.js` (head allowlist) |
| checklist: `getElementById` targets exist | `preflight.test.js` |

### Where the tools live

ESLint, TypeScript and `@types/node` are in `tools/lint/package.json`, **not** the root
`package.json`. The root file's `dependencies` are what the image and a one-tap update install, and
the updater re-runs `npm install` whenever they change; keeping the tools in their own package means
no user's box ever downloads them. `tools/` and `.githooks/` are also in `.dockerignore`.

### Moving a baseline

- A baselined file shrank: `npm run lines -- --ratchet` records the smaller number. The gate fails
  until you do, so the allowance only ever tightens.
- A suppressed lint violation was fixed: `npm run lint:prune`. Lint fails until you do.
- A baselined module now type-checks: add `// @ts-check` on line 1 and take it out of
  `tools/quality/ts-baseline.json`. The gate fails if it has the pragma and is still listed.

Never raise a baseline to make a change pass. If a change genuinely needs it, that is a question
for the owner, asked before the change.

The three gates check the code against their baselines, but not the baselines themselves: until
v1.9.10 a number raised by hand and then ratcheted, a name added to `ts-baseline.json`, or
`eslint --suppress-all` all left every gate green. `tools/quality/baselines.js` closes that. It
reads each baseline as it stood at the merge-base with `origin/dev` (`GITHUB_BASE_REF` on a pull
request, `BASELINE_BASE` to name another ref) and fails if any entry rose or appeared. With no
such ref to compare with it fails rather than passes. A baselined file that is moved or renamed
counts as an added entry: a move into a new path must come out under the limit.

## Splitting the monoliths

`index.js` (~20,300 lines) and `public/app.js` (~19,300) are the main risk: every change touches
something thousands of lines away. The way out is one feature per session, moved into its own
module under `lib/` (server) or its own script under `public/` (client), with its tests, and the
baseline ratcheted down in the same commit.

Since 2026-10-14 (the owner) every file over 850 lines is brought under 850 as part of the work,
not only these two. On 2026-10-14 that was, in lines: `index.js` 20,133, `public/app.js` 19,300,
`public/style.css` 6,120, `public/index.html` 2,045, `public/shelf.js` 1,968,
`test/unit/librarychange.test.js` 1,253, `test/dom/hqplayer.test.js` 1,026,
`test/unit/years.test.js` 935, `test/unit/qobuz-stream.test.js` 916. A session that touches one of
them moves code out of it. The native remote (`dev/design/native-remote.md`) is built as new small
modules beside the public-API code it stands in for, and that public-API code leaves the
monoliths as it is wrapped behind the same interface, so the two pieces of work go together.

Order — the logic most often involved in bugs first, and the most self-contained:

1. **Updater + security** (see below) — already half in `lib/updater.js`.
2. **Settings persistence** (`loadPersistedSettings` / `savePersistedSettings`) → `lib/settings.js`.
3. **Label scan pipeline** (`runLabelsIndexScan`, `buildFileLabelMap`) → `lib/labels/`.
4. **Waveform routes and decode orchestration** → `lib/waveform-*.js`.
5. **Discogs / FanArt.tv / Qobuz / TIDAL HTTP routes** → `lib/routes/<service>.js` (Express routers).
6. **Client:** one screen at a time out of `public/app.js` into `public/<screen>.js`, loaded as
   separate `<script>`s like `sharecard.js` already is.

Each move keeps behaviour identical, and the existing suite is the proof: it must pass before and
after with no test changed except the paths it reads.

## Security (next after the gates)

- **Login.** Built: an optional password guarding settings and the library in v1.9.22; since
  v1.9.26 (the owner, 2026-10-14) a mandatory account — a username and a password, made at install
  or at the first start after the update — guarding all of Rouen (`dev/design/login.md`). Before
  it, anyone who could reach port 3399 could change settings, read API keys back, restore a backup,
  or trigger the one-tap update.
- **Verified updates.** The updater installs whatever tarball it downloads. `release.yml` will
  publish a SHA-256 next to the tarball; the updater will download only from `github.com` /
  `objects.githubusercontent.com` over HTTPS, and refuse a tarball whose checksum does not match.

## Rules for writing tests

- A bug fix starts with a failing test that reproduces it.
- Assert behaviour, not implementation.
- Never weaken a test to make it pass. If behaviour changed on purpose, say so in the commit.
- No tests that cannot fail. Break the code on purpose for every important one.
- Two positions compared in one test come from the same source (`dev/lessons.md`).

## How we'll know it's working

- Fixes stop causing new bugs, and each bug that gets through leads to a gate that would have
  caught it.
- The length baseline's total goes down every few releases; `index.js` and `app.js` shrink.
- `CLAUDE.md` gets shorter as its rules move into tools.
