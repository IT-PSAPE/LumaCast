# Release and signing setup

LumaCast uses one GitHub Actions workflow for validation and stable releases: `.github/workflows/ci-release.yml`.

## Workflow

Every pull request runs:

1. dependency installation
2. TypeScript and architecture checks
3. unit and NDI tests
4. the production build
5. Playwright end-to-end tests

Pushes to `main` run the same validation. After it passes, the release gate compares the current stable `package.json#version` with the version before the push and checks GitHub for `v<version>`.

- An unchanged version stops after validation.
- A version downgrade or prerelease string fails the gate.
- A higher unpublished version builds Windows, macOS, and Linux packages in parallel.
- The GitHub Release is created only after every platform succeeds.
- A manual dispatch retries the current stable version when its release is absent.

There is no prerelease workflow.

## Build matrix

The workflow pins Node.js `22.13.0` and builds the native NDI addon before packaging the application with `electron-builder`.

| Runner | Output | Architecture |
| --- | --- | --- |
| `windows-latest` | NSIS installer | x64 |
| `macos-14` | DMG and ZIP | x64 |
| `ubuntu-latest` | AppImage and DEB | x64 |

Each platform uploads its installer, archive, blockmap, and `latest*.yml` updater metadata. The publishing job combines those artifacts into one stable GitHub Release.

The NDI native module loads the NDI runtime dynamically on the installed machine. A missing runtime disables NDI output without preventing the application from starting.

## Repository permissions

Repository Actions must be enabled. The workflow defaults to `contents: read` and grants `contents: write` only to the final publishing job. The repository-level default may remain read-only.

Check the current setting with:

```bash
gh api repos/:owner/:repo/actions/permissions/workflow \
  --jq '{default_workflow_permissions, can_approve_pull_request_reviews}'
```

## macOS signing and notarization

Configure these repository secrets for a signed and notarized macOS release:

```bash
gh secret set APPLE_CSC_LINK
gh secret set APPLE_CSC_KEY_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
```

Without them, the workflow produces unsigned macOS artifacts.

## Windows signing

Configure these repository secrets for signed Windows installers:

```bash
gh secret set WIN_CSC_LINK
gh secret set WIN_CSC_KEY_PASSWORD
```

Without them, the workflow produces unsigned Windows artifacts. Linux artifacts are unsigned.

## Cutting a release

Update both `package.json` and `package-lock.json` without creating a local tag:

```bash
npm version patch --no-git-tag-version
```

Commit and merge the version increase into `main`. The unified workflow creates the Git tag and GitHub Release after validation and packaging succeed. Do not create or push a release tag manually.

Monitor the run with:

```bash
gh run watch
```

If a release run fails after the version reaches `main`, fix the failure and rerun the original workflow. A manual dispatch can retry the current version while `v<version>` remains unpublished.

## Auto-update

Packaged builds use `electron-updater` and the published `latest*.yml` metadata. Installed builds check for updates after launch and expose `Check for Updates…` in the native application menu. macOS auto-update requires a properly signed build.
