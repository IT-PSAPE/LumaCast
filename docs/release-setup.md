# Release & signing setup

This document covers the one-time human setup for signed release packaging in GitHub Actions. It does not imply that in-app auto-update is already implemented.

## Current release status

- `.github/workflows/ci.yml` validates pushes and pull requests.
- `.github/workflows/release.yml` is a single workflow that runs on pushes to `main`, PRs targeting `main`, and manual dispatch. It guards on branch, builds unsigned installers for every event, and — only when a push to `main` introduces a new `package.json` version — signs the installers and creates a matching GitHub Release with auto-generated notes.
- PR builds upload installers as workflow artifacts so reviewers can smoke-test, but never create a release.
- The app does not currently import or call `electron-updater`, so installed clients do not self-check or self-apply updates yet.

## Release flow

1. Ensure the change has passed CI.
2. Bump `version` in [../package.json](../package.json).
3. Commit and push (or merge a PR) to `main`.
4. GitHub Actions detects that `v<version>` is newer than the latest release tag, builds and signs installers for macOS, Windows, and Linux, then creates the GitHub Release `v<version>` with auto-generated notes and the platform installers + `latest*.yml` updater metadata attached.

No manual tagging, `gh release create`, or `npm version` step is required. If `package.json` is unchanged, the workflow still builds and uploads workflow artifacts but skips release creation.

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

### 2. macOS signing and notarization

Required for shipping macOS builds without Gatekeeper warnings.

Add these repository secrets:

```bash
gh secret set APPLE_CSC_LINK
gh secret set APPLE_CSC_KEY_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
```

If these secrets are absent, the workflow still produces unsigned macOS artifacts for smoke testing.

### 3. Windows code signing

Recommended for shipping Windows installers without SmartScreen warnings.

Add these repository secrets:

```bash
gh secret set WIN_CSC_LINK
gh secret set WIN_CSC_KEY_PASSWORD
```

If these secrets are absent, the workflow still produces unsigned Windows artifacts.

### 4. Linux

No signing is configured. Linux artifacts are still published to the GitHub Release.

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
- macOS artifact is produced but cannot be opened cleanly: signing or notarization secrets are missing or invalid.
- Windows artifact shows SmartScreen warnings: the build is unsigned or the signing certificate reputation is still warming up.
- Installed app does not auto-update: confirm the build is packaged, the GitHub Release contains the updater metadata files, and the release is newer than `package.json#version` in the installed app.
