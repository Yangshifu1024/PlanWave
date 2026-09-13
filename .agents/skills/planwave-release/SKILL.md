---
name: planwave-release
description: Cut a PlanWave release — verify the full gate, bump the version everywhere, commit, and after explicit confirmation push the v* tag that triggers multi-platform release CI. Use whenever the user wants to release, ship, publish, or tag a PlanWave version, bump the version, or says 发版/发布/出新版本/打个tag — even a bare "release 0.3.0" or "发个版".
---

# PlanWave release

A release is: bump the version everywhere → commit on `main` → push → push a `v*` tag. The tag push is what triggers `.github/workflows/release.yml`, which builds GHCR docker images, Windows NSIS, macOS dmg (universal), Linux AppImage+deb, Android APK — and an iOS ipa only when the `IOS_CERTIFICATE` secret is configured (otherwise it's skipped with a notice). Pushing a new tag cancels an in-flight older release (workflow concurrency).

**This skill always stops before pushing.** The tag push ships the release and is effectively irreversible (artifacts are published, the version is consumed). Follow AGENTS.md: never push `main` or a tag without the user's explicit yes, even if every check is green.

## 1. Determine the version

- An explicit version in the invocation wins (accept `0.3.0` or `v0.3.0`).
- Otherwise derive a suggestion:
  - Latest tag: `git fetch --tags && git describe --tags --abbrev=0`
  - What's shipping: `git log <latest-tag>..HEAD --oneline`
  - Suggest the next semver from those commits: breaking changes (`feat!` / `BREAKING CHANGE`) → bump the **minor** while the project is 0.x; `feat` → minor; `fix`/`chore`/`docs` → patch.
- State the suggestion and the commits it's based on, then ask the user to confirm or override. Never bump an unconfirmed version.
- Never reuse a version that already has a tag: the Android `versionCode` is derived from the tag and existing releases are immutable. If a release went wrong, pick a new number, don't move the tag.

## 2. Pre-flight — abort on any failure

Run these before touching any file; a red tree never gets bumped.

1. `git status --porcelain` — must be empty. The bump rewrites 7 files; committing on a dirty tree mixes unrelated changes into the release commit.
2. `git branch --show-current` must be `main`, then `git pull --ff-only` — releases are always cut from an up-to-date main (GitHub Flow).
3. Full gate, in fail-fast order:
   - `pnpm lint` (clippy `-D warnings` + eslint)
   - `pnpm test:rust`
   - `pnpm test:web`
   - `pnpm build:web` (also builds the WASM data layer and runs `tsc`)

On failure: stop, show the failing output, and let the user decide what to fix. Do not bump.

## 3. Bump

```
pnpm bump <version>
```

The script strips a leading `v` itself. It rewrites `package.json` (root, `apps/web`, `apps/client`), `apps/client/tauri.conf.json`, and root `Cargo.toml`, then refreshes `Cargo.lock` (`cargo update -w`) and `pnpm-lock.yaml`. Never edit versions by hand.

Verify with `git status --porcelain`: expect exactly those 7 files. Anything else in the diff — investigate before committing.

## 4. Commit

```
git commit -m "chore(release): vX.Y.Z"
```

This matches existing release history; no body needed.

## 5. Summarize, then STOP

Show the user, concretely:

- The version and the commits going out since the previous tag
- What release CI will build once the tag lands (list the artifacts; note iOS is skipped unless signing secrets are set)
- That pushing this tag cancels any in-flight older release

Then ask, and wait: "Push main + tag vX.Y.Z now?" A yes to the summary is consent to push; silence or anything ambiguous is not.

## 6. Push (only after the user's explicit yes)

```
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Then offer to monitor the release run (`gh run list --workflow=release.yml`, `gh run watch <run-id>`). The full pipeline takes a while — five platforms build in parallel after the shared web-dist job.
