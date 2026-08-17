# Release & signing setup

This document covers the one-time human setup for signed release packaging in GitHub Actions.

## Current release status

- `.github/workflows/ci.yml` runs on every pull request and every branch push: typecheck, the `check:architecture` layering check (plus its own fixture tests), unit tests (`npm test`), and Playwright end-to-end tests. It never packages installers.
- `.github/workflows/release.yml` triggers only on a push to `main` that touches `package.json`, or manual `workflow_dispatch`. It does **not** trigger on pull requests. A `guard` job compares `package.json#version` to the latest GitHub Release tag; the `build` and `release` jobs run only when that version is new (`should_release=true`).
- `.github/workflows/prerelease.yml` is the same shape, triggered by pushes to `testing` (also gated on `package.json`), and publishes a `v<version>-beta.<n>` GitHub pre-release instead of a stable release. It is skipped once a stable release for that base version already exists.
- **Current build matrix (both workflows): Windows only.** The `build` job's matrix has a single entry (`windows-latest` / `win`); macOS and Linux entries are present in `electron-builder.yml` and in the packaging steps below but are commented out of the matrix with `# macOS and Linux release/pre-release builds are temporarily paused.` Treat macOS and Linux release artifacts as **unverified** until that pause is lifted and CI actually exercises them.
- The app imports and initializes `electron-updater` (`app/main/app-updater.ts`); installed, packaged builds check GitHub Releases for updates on startup.

## Platform, architecture, and native prerequisites

Everything in this section is read from committed configuration
(`package.json`, `electron-builder.yml`, the workflows, and
`packages/ndi-native`), not from running a release.

- **Electron**: `^35.0.1` (`package.json` devDependency; the committed
  `package-lock.json` resolves this to `35.7.5`).
- **Node.js**: `package.json#engines.node` requires `>=22.13.0`; every
  workflow's `actions/setup-node` step pins exactly `22.13.0`. This is the
  Node used to run `npm`/build scripts and `node-gyp`, not necessarily the
  Node ABI bundled inside the Electron runtime itself.
- **Native module ABI**: the only native addon is `@lumacast/ndi-native`
  (`packages/ndi-native`), built with `node-addon-api` (Node-API), which is
  designed to be ABI-stable across Node/Electron versions rather than
  requiring an exact version match. `electron-builder` rebuilds it for
  Electron's runtime via `@electron/rebuild`, pinned to `4.2.0` in
  `package.json#overrides`.
- **Platforms configured for packaging** (`electron-builder.yml`): macOS
  (`dmg`, `zip`), Windows (`nsis`), and Linux (`AppImage`, `deb`). **Only
  Windows is currently built and released by CI** (see "Current release
  status" above); macOS and Linux are configured but unverified until their
  matrix entries are un-paused.
- **CPU architecture**: `electron-builder.yml` does not pin an `arch:` list
  under any platform target. The Windows build runs on GitHub's
  `windows-latest` runner, which is x64 — so the only architecture actually
  produced today is **Windows x64**. Any other architecture (macOS
  arm64/x64, Linux x64/arm64) is unverified.
- **Signing/notarization**: see "One-time setup" below. Only the Windows
  signing path (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`) is exercised by the
  current matrix; both workflows fall back to producing an unsigned artifact
  when the relevant secrets are absent, rather than failing.
- **NDI SDK / runtime**: `packages/ndi-native/README.md` and
  `app/main/ndi/ndi-native-module.ts` document the runtime library search
  order. Verified by CI (Windows): `Processing.NDI.Lib.x64.dll`, with Visual
  Studio Build Tools (C++ workload) and Python `3.12` required to build the
  native addon. macOS (`libndi.dylib` / `libndi_advanced.dylib`, searched in
  Homebrew, `/usr/local/lib`, and NDI SDK/app install locations) and Linux
  (`libndi.so.6`, `libndi.so`) search paths exist in
  `packages/ndi-native/src/ndi_native.cc` but are **unverified by CI** since
  no workflow currently builds or runs on those platforms. If the runtime
  library or the compiled addon is missing, the app falls back to a no-op
  NDI sender and logs a warning; it does not fail to start.

## Release flow

1. Ensure the change has passed CI (`.github/workflows/ci.yml`).
2. Bump `version` in [../package.json](../package.json).
3. Commit and push (or merge a PR) to `main`.
4. `release.yml`'s `guard` job detects that `v<version>` is newer than the latest release tag and sets `should_release=true`. The `build` job (currently Windows only) builds the app, packages it with `electron-builder`, and uploads the installer + `latest*.yml` updater metadata as a workflow artifact. The `release` job downloads that artifact and runs `gh release create v<version> --generate-notes` with it attached.

No manual tagging, `gh release create`, or `npm version` step is required. If `package.json`'s version is unchanged (or already released), the workflow's `guard` job sets `should_release=false` and the `build`/`release` jobs are skipped entirely — nothing is built or uploaded.

Pushing to `testing` with a `package.json` change follows the identical flow in `prerelease.yml`, producing `v<base_version>-beta.<n>` instead.

## One-time setup

### 1. Workflow permissions

The release workflow requests `contents: write` so `electron-builder` can upload assets to the published release.

Verify repository workflow permissions:

```bash
gh api repos/:owner/:repo/actions/permissions/workflow \
  --jq '{default_workflow_permissions, can_approve_pull_request_reviews}'
```

If repository policy is locked down, enable workflow write permission:

```bash
gh api --method PUT repos/:owner/:repo/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

### 2. macOS signing and notarization (currently unused — macOS build is paused)

The macOS packaging step, its secrets, and its signing logic are still
defined in both workflows, but the build matrix does not currently include a
`macos-*` runner (see "Current release status" above), so this step never
runs. It is documented here so re-enabling macOS in the matrix does not also
require rediscovering this setup.

Required for shipping macOS builds without Gatekeeper warnings, once macOS is
re-added to the matrix:

```bash
gh secret set APPLE_CSC_LINK
gh secret set APPLE_CSC_KEY_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
```

If these secrets are absent, the workflow produces unsigned macOS artifacts
for smoke testing instead of failing.

### 3. Windows code signing

This is the only platform the current CI matrix builds and releases.
Recommended for shipping Windows installers without SmartScreen warnings.

Add these repository secrets:

```bash
gh secret set WIN_CSC_LINK
gh secret set WIN_CSC_KEY_PASSWORD
```

If these secrets are absent, the workflow still produces unsigned Windows artifacts.

### 4. Linux (currently unused — Linux build is paused)

The Linux packaging step is defined in both workflows but, like macOS, never
runs because the build matrix does not currently include a Linux runner. No
signing is configured for Linux in `electron-builder.yml`; once re-enabled,
Linux artifacts would be published to the GitHub Release unsigned.

## Wiring app-managed auto-update

The app is wired to `electron-updater` and consumes the GitHub release metadata produced by the release workflow.

Current behavior:

- Installed builds automatically check for updates shortly after launch.
- The native application menu exposes `Check for Updates…` for a manual check.
- When a newer release is found, the app prompts the user before downloading it.
- After the update finishes downloading, the app prompts to install and restart immediately.

Operational notes:

- macOS auto-update requires a properly signed app build.
- Development builds skip update checks because `electron-updater` is intended for installed packages.
- The GitHub release must include the platform installer artifacts and generated `latest*.yml` metadata for the target platform.

## Cutting a release

1. Bump the version in `package.json` (manually, or via `npm version patch` / `minor` / `major` — without `--git-tag-version` if you don't want a local tag, since the workflow handles tagging):

```bash
npm version patch --no-git-tag-version
```

2. Commit and push to `main` (directly or via PR merge):

```bash
git commit -am "chore: bump version"
git push
```

3. Watch the workflow create the release:

```bash
gh run watch
```

## Troubleshooting

- Release was not created after pushing to `main`: confirm `package.json#version` actually changed and that `v<version>` does not already exist as a GitHub Release. Check the `guard` job's notice line for `should_release=...`.
- No macOS or Linux artifact was produced: expected — the current build matrix only includes Windows (see "Current release status"). Re-add the platform to the matrix in `release.yml`/`prerelease.yml` first.
- Windows artifact shows SmartScreen warnings: the build is unsigned or the signing certificate reputation is still warming up.
- Installed app does not auto-update: confirm the build is packaged, the GitHub Release contains the updater metadata files, and the release is newer than `package.json#version` in the installed app.
