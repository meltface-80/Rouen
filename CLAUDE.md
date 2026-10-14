# Rouen — repository rules

This file is the repository's rule sheet. Procedure lives in the documents it names, read on
demand; nothing here restates them. A rule here overrides any default behaviour unless the owner
says otherwise in that session.

| Read | When |
|---|---|
| `dev/quality.md` | Before adding a module, touching `tools/`, or anything that would move a baseline |
| `dev/release.md` | Before every push of a build, after every merge, on "merged" / "marked latest", before touching `README.md`, `docker-compose.yml`, the docs site or a workflow |
| `dev/lessons.md` | Before diagnosing an "it broke in version N" report, writing a pixel/position test, touching `<head>`, the waveform or the seek bar, and before a non-trivial review |
| `dev/design/*.md` | Before working on the feature a design covers |
| `dev/history.md` | When a past version is referenced or a regression is being dated |
| `test/README.md` | Before writing or moving tests |

## Spec authority

A feature with a design in `dev/design/` is specified there. Code matches it, or the design changes
first: a departure lands as an edit to the design in the same commit as the code, named in the
commit message, never as code that quietly disagrees. An open question the design does not settle
goes to the owner before the code that depends on it is written; it is not resolved by picking.

## Gates

`npm run check` is the bar and is green before every push: file length, `@ts-check` + `tsc`,
ESLint, and the static, unit and DOM suites. The pre-commit hook runs the fast half; CI
(`checks.yml`) runs all of it and blocks the test image and the release. `--no-verify` and
workflow edits that skip a gate stay off the table.

Baselines only shrink. Never raise a length entry, add a lint suppression or `eslint-disable`, or
add a module to the `@ts-check` baseline to make a change pass; if it seems necessary, ask first.
If `index.js` cannot be started (no Roon Core), say so; do not claim it was.

## Code

- New logic goes in a new module under `lib/` (server) or `public/<screen>.js` (client): under 500
  lines, opening with `// @ts-check`, with its tests. Never appended to `index.js` or `public/app.js`.
- A session that touches `index.js` or `public/app.js` moves one feature out of it (order in
  `dev/quality.md`) and ratchets the baseline in the same commit.
- No incomplete implementations: no `// ...`, no `// rest stays the same`.
- A `catch` that stays silent carries a comment saying truthfully why silence is safe.
- A rename or a move to settings is finished in one commit: zero stale references.
- Nothing enters `<head>` unless the head allowlist (`test/static/pwa-icons.test.js`) permits it —
  iOS bakes it into the home-screen shortcut for ever (`dev/lessons.md`).
- **A stale installed PWA looks exactly like a regression.** On any "version N broke X" report, ask
  for the shortcut to be deleted and re-added before diagnosing (`dev/lessons.md`).
- The Roon `extension_id` never changes; the image, container, volume (`musicd-remote`,
  `musicd-remote-data`) and tarball names keep theirs. "Rouen" is a display name only.
- Roon's public extension API is the foundation. Its private protocol is used only as
  `dev/design/roon-native.md` allows, method by method.

## Tests

A bug fix starts with a failing test that reproduces it. A test that matters is broken on purpose
once, and must fail, before it is trusted. Two positions compared in one test come from one source
(`dev/lessons.md`). No test may need a real Roon Core, HQPlayer or network service; the fakes are
not evidence, and device-only behaviour (iOS windows, safe areas) is not testable here.

## Bugs

Root cause, not symptom; it must explain every reported failure. A hypothesis that survives none of
the checks in `dev/lessons.md` is not a root cause, and shipping a fix for it attaches a false
explanation to a real change. The CHANGELOG names the class of error, and the gate that would have
caught it is added.

## Owner's decisions — never changed unasked

- Never merge or close a pull request, open one into `main`, create a GitHub release, or change
  Latest/pre-release. The owner merges and promotes; marking Latest also moves the `:latest` image.
- **When in doubt, ask the owner** — and explain plainly what is being asked and why.
- `README.md` versions, the docs site and `docker-compose.yml` move only at promotion
  (`dev/release.md`).
- Every install keeps the one-tap in-app update. The update check runs every 7 days plus once at
  startup.
- Releases are titled `Rouen + HQPWeb vX.Y.Z`. hqpweb (statelycurmudgeon) is credited;
  CrystalGipsy / HQPlayer Bridge is not, and nothing from it is used.
- No tarball or other release artefact is committed. The two historical tarballs once in `old/`
  (v1.5.37, v1.5.49) were removed by the owner on 2026-06-26 and live only in git history.

## Builds and commits

Branches (`dev/release.md`): every piece of work is its own branch cut from `dev`, one concern
each. When its CI is green it goes to `dev` by a pull request **the owner merges**. Only the owner
merges `dev` into `main`; that is what cuts a release. Claude never merges a pull request, never
commits to `dev` or `main`, never pushes to a branch whose PR is merged, and never rewrites
pushed history.

A build bumps `package.json`'s version and adds a CHANGELOG entry, in one commit with the code. A
change touching only `docs/`, `dev/`, `*.md` or `docker-compose.yml` is not a build: no bump, no
image. After a push, the docker command is given only once that commit's test-image run is green.

## Markdown

`dev/` and `README.md` are full English. Decisions go in the commit message, and in a design or
`dev/*.md` when they change a rule. `CHANGELOG.md` and `dev/history.md` are where a version's story
is told.

## Delegation

Work through four roles for every non-trivial change: **architect** (map side effects, including
mobile rendering), **reviewer** (edge cases, empty states, errors), **developer** (complete code),
**QA** (`npm run check`, reported as `[PASS]` / `[FAIL] reason`). Changes touching the label scan,
Discogs/FanArt.tv, settings persistence, the updater, Roon's private protocol or new UI get the
multi-agent review in `dev/lessons.md`. Rote, may be delegated: porting a named test case, moving
a feature into a module with behaviour unchanged. Judgment, never delegated: anything in
`dev/design/`, gate semantics, the updater, Roon's private protocol, and any write to a user's
Roon library.
