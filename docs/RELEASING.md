# Release Process

This checklist is the release runbook for Open Wemo.

The current repo workflow is:

- day-to-day work lands on `develop`
- release candidates are merged to `main`
- CI runs on `main` / `master`
- a pushed tag matching `v*.*.*` triggers the GitHub release workflow
- GitHub release notes are generated from commit subjects between the previous tag and the new tag

## Release Checklist

### 1. Stabilize the release branch

- [ ] Start from `develop`
- [ ] Pull the latest branch state
- [ ] Confirm the working tree is clean
- [ ] Review the commits that will go into the release
- [ ] Clean up noisy commit history before release if needed (squash fixups, avoid vague subjects, make commit titles user-facing)

```bash
git checkout develop
git pull origin develop
git status
git log --oneline origin/main..HEAD
```

Notes:

- The release workflow uses commit subjects to build the GitHub release notes, so commit titles matter.
- Good subjects: `Fix LED Mode reviving devices that are intentionally off`
- Bad subjects: `wip`, `fix stuff`, `debug`, `try again`

### 2. Update release-facing docs

- [ ] Update `README.md` for any user-visible changes
- [ ] Update API docs if endpoints or payloads changed (`docs/API.md`)
- [ ] Update protocol or architecture docs if behavior changed significantly
- [ ] Make sure contributor workflow is still accurate if the process changed (`CONTRIBUTING.md`)

For the current release, specifically verify the docs cover:

- LED Mode behavior
- standby threshold behavior
- any changed expectations for Insight devices

### 3. Bump versions consistently

- [ ] Choose the correct semver bump
- [ ] Update version in root package
- [ ] Update version in bridge package
- [ ] Update version in web package
- [ ] Re-check for any hard-coded version references that should match the release

Files to update:

- `package.json`
- `packages/bridge/package.json`
- `packages/web/package.json`

Versioning guide:

- patch: bug fixes, no breaking changes
- minor: new features, backward-compatible
- major: breaking changes

### 4. Run the full validation pass

- [ ] Install dependencies if needed
- [ ] Run typecheck
- [ ] Run lint
- [ ] Run tests
- [ ] Run at least a Linux release build locally
- [ ] Prefer running all platform builds before tagging if practical

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run build:linux
# optional but recommended before release
bun run build:all
```

### 5. Do release-candidate smoke testing

- [ ] Launch the local build you intend to ship
- [ ] Verify the app starts cleanly
- [ ] Verify the most important changed behaviors manually
- [ ] Verify no obvious regressions in core flows

Suggested smoke-test areas:

- device discovery
- device on/off control
- Insight status reporting
- LED Mode toggle behavior
- standby threshold behavior
- timer flow if related code changed

### 6. Prepare the final release commit set

- [ ] Commit doc updates, version bumps, and release-prep changes
- [ ] Make sure the final commit set is understandable when read as release notes
- [ ] Push the final `develop` branch state

```bash
git add .
git commit -m "Prepare vX.Y.Z release"
git push origin develop
```

### 7. Merge to the release branch

- [ ] Merge `develop` into `main`
- [ ] Push `main`
- [ ] Wait for CI on `main` to pass before tagging

```bash
git checkout main
git pull origin main
git merge develop --no-ff -m "Merge develop for vX.Y.Z"
git push origin main
```

Current CI behavior from `.github/workflows/ci.yml`:

- lint/typecheck job
- test job
- Linux build verification job

### 8. Create and push the release tag

- [ ] Create an annotated semver tag
- [ ] Push the tag
- [ ] Confirm the release workflow starts

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Current release trigger from `.github/workflows/release.yml`:

- push tags matching `v*.*.*`

### 9. Verify the GitHub release output

- [ ] Confirm the GitHub release was created
- [ ] Confirm all expected binaries are attached
- [ ] Confirm the release body reads well
- [ ] Edit the release text manually if the generated notes need cleanup or grouping

Expected artifacts:

- Windows: `open-wemo-*-win.exe`
- macOS ARM: `open-wemo-*-mac`
- macOS Intel: `open-wemo-*-mac-intel`
- Linux: `open-wemo-*-linux`

Release note source:

- generated from `git log PREV_TAG..HEAD --pretty=format:"- %s" --no-merges`

### 10. Post-release follow-through

- [ ] Smoke-test one downloaded release artifact from GitHub
- [ ] Confirm the version shown in shipped binaries matches the tag
- [ ] Open follow-up issues for anything intentionally deferred
- [ ] Sync your local branches back to the normal development flow

```bash
git checkout develop
git pull origin develop
```

## Quick Command Checklist

```bash
git checkout develop
git pull origin develop
git status
git log --oneline origin/main..HEAD

bun install
bun run typecheck
bun run lint
bun test
bun run build:linux

git checkout main
git pull origin main
git merge develop --no-ff -m "Merge develop for vX.Y.Z"
git push origin main

git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

## Repo-Specific Reminders

- Keep commit subjects clean because they become release notes.
- Bump all three package versions together.
- Do not tag before CI passes on `main`.
- If the release includes user-visible behavior changes, update `README.md` in the same release.
- If the release includes protocol or API behavior changes, update the corresponding files in `docs/` before tagging.
