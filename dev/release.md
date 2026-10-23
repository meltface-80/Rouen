# Release procedure

Read on demand from `CLAUDE.md`: before every push of a build, after every merge, when the user
says "merged" or "marked/moved to latest", and before touching `README.md`, `docker-compose.yml`,
the docs site, or a workflow. Every rule here is the user's decision; changing one is the user's
call, never a side effect.

## Branches (the owner's model, 2026-10-12 — supersedes "feature branch → main")

```
main   ←── only the owner merges, and only from dev. Merging here cuts a release.
  │
dev    ←── integration. Every finished stage lands here, by a PR the owner merges.
  │         Pushes to dev move the `:dev` image, which the owner's test box pulls.
  ├── roon-direct/stage-0-probe     one concern per branch, cut from dev
  ├── quality/updater-checksums
  └── …
```

- **Every piece of work is its own branch, cut from the current `dev`**, named
  `<area>/<what>` (`roon-direct/stage-0-probe`, `quality/updater-checksums`, `fix/<bug>`). One
  concern per branch. Never commit to `dev` or `main` directly.
- **A build branch carries its own version bump and CHANGELOG entry.** Versions keep counting up
  on `dev`; only the version on `main` when the owner merges becomes a release.
- **Test builds are numbered `X.Y.Z-tN`, with a lowercase `t` (the owner, 2026-10-22).** Every
  build going into `dev` takes the next test number of the coming release — `1.9.66-t1`,
  `1.9.66-t2`, … — where `X.Y.Z` is the version after the current Latest. The plain `X.Y.Z` is given only when the owner says to
  merge to `main` for a stable release: then a last build branch into `dev` bumps `package.json`
  to `X.Y.Z` and adds an `## [X.Y.Z]` entry above the test entries, gathering what they changed
  (`release.yml` takes the release notes from that entry, and tags `vX.Y.Z`). The test image is
  `<image>:X.Y.Z-tN-test`. The updater orders `X.Y.Z-tN` below `X.Y.Z` and above the release
  before it, so a test box is offered the stable release when it lands. 1.9.66 (the settings
  probe), merged into `dev` before this rule, is `1.9.66-t1`; the next build after a stable
  `X.Y.Z` is `X.Y.(Z+1)-t1`. `test/static/changelog.test.js` knows the scheme: a test series
  starts at `t1`, counts up by one, and its stable entry sits above it. `release.yml` refuses to
  release a `-tN` version, so a merge to `main` before the stable bump tags and builds nothing.
- Push the branch. CI (`test-image.yml`) runs every gate and the whole suite, then builds
  `ghcr.io/meltface-80/musicd-remote:<version>-test`. Once that run is green, give the owner the
  docker command for it (template below).
- **Then open a pull request from the branch into `dev`** — never into `main` — saying what it
  changes, what was broken on purpose to prove the tests, and what is not covered. The owner
  reviews and merges it. **Claude never merges a pull request**, into `dev` or anywhere else.
- **A merged branch is finished.** It is deleted and never reused; follow-up work is a new branch
  from the new `dev`.
- Before starting a branch, and before every follow-up push to one, check whether its PR has
  already been merged (`git ls-remote`, the PR's state). Pushing to a merged branch is how
  v1.8.63 and v1.8.85 lost work.
- If `dev` has moved on while a branch was open, merge `dev` into the branch (never rebase or
  force-push a pushed branch) and re-run `npm run check`.
- **No conflicts to start with (the owner, 2026-10-21).** v1.9.32, v1.9.33 and v1.9.34 were open
  at once, each with its own entry at the top of `CHANGELOG.md` and its own `package.json`
  version. Every merge after the first conflicted, and resolving a conflict by taking one side
  lost 1.9.33's whole entry and part of 1.9.32's. So:
  - **One build branch with an open pull request at a time.** The next one opens only after the
    last is merged into `dev`. Work started meanwhile goes on its own branch without a version
    bump or CHANGELOG entry until then.
  - **The version bump and CHANGELOG entry are the branch's last commit.** Merge the latest `dev`
    in first, then bump to the version after `dev`'s, so the pull request opens with nothing to
    resolve. If `dev` moves before the merge, merge it in again (Claude, not the owner) and
    re-check.
  - **A CHANGELOG conflict keeps both entries, never one side**, newest version on top.
    `test/static/changelog.test.js` fails a CHANGELOG with a version missing, one twice, or a
    marker left in it, and a top entry that isn't `package.json`'s version. It cannot see a
    section lost from an entry still there, which is why the rule above comes first.
- **`dev` → `main` is the owner's alone.** Claude never opens that PR unless asked.
- Recommended to the owner (set in GitHub → Settings → Branches, not by Claude): protect `main` and
  `dev` — pull requests only, and the `Checks` jobs required to pass.
- **No tarball is committed** (since v1.8.70 — see "Images" below).
- **Two-phase release handshake (revised 2026-07-28 — supersedes the earlier rule).**
  - **"merged"** (to `main`) = the owner tested `dev` and merged it. This is the nod to
    **cut the release**: confirm the tag `vX.Y.Z` and a **pre-release** exist for it, and
    create them if the workflow didn't. Also confirm the version IMAGE
    `ghcr.io/meltface-80/musicd-remote:X.Y.Z` was pushed (release.yml's `image` job — check
    its run). Do NOT touch README / docs-site versions yet.
  - **"marked/moved to latest"** = the user is happy and has promoted the release. `latest.yml`
    then points `ghcr.io/…:latest` at it by itself — confirm that run went green. NOW run
    the full promotion pass: every README version reference, the docs-site fallback
    version/examples, **`docker-compose.yml`**, and the current-stable note (under README.md below) + the
    version-history table (`dev/history.md`), as a docs-only commit on the freshly-restarted branch. Since
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
repo documentation (`README.md`, `CHANGELOG.md`, `CLAUDE.md`, `dev/**`, `docker-compose.yml`) is NOT a
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
4. `npm run check` — gates and the whole suite (`dev/quality.md`)
5. Commit in a single commit: code + `package.json` + `CHANGELOG.md`
6. Push the branch (cut from `dev` — see Branches above)
7. Wait for that commit's **Test image** run (`test-image.yml`) to finish green — check it via
   the GitHub API (`actions_list` workflow runs for the branch, matching the pushed SHA). Its
   `checks` job (gates + suite) runs first and the image is built only if it passes. A failed or
   cancelled run means there is nothing to test yet: fix it, don't hand out the command.
8. Give the user the docker command for `:<version>-test` (see template below)
9. Open a pull request from the branch into `dev` (never `main`). The owner merges it; once
   merged, the branch is finished — delete it, and start the next piece from the new `dev`

---

## Images (since v1.8.70)

Everything is published to **`ghcr.io/meltface-80/musicd-remote`**, for `linux/amd64` and
`linux/arm64`, by three workflows:

| Workflow | When | Tags |
|----------|------|------|
| `test-image.yml` | every push to a non-`main` branch (not docs-only), after `checks.yml` passes | `<version>-test` (pinned — use this one), `test` (last test build, any branch), and `dev` when the branch is `dev` (what the owner's test box pulls) |
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
## [X.Y.Z-tN] — YYYY-MM-DD

### Added / Fixed / Changed
- Description of change
```

`X.Y.Z-tN` for a test build into `dev`; `X.Y.Z` only for the stable release (see Branches).

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
