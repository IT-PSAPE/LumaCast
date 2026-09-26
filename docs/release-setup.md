# Release and signing setup

LumaCast uses one reusable pipeline for every app: `.github/workflows/ci-release.yml`.
Thin wrappers (`cast.yml`, `cloud.yml`, `flux.yml`, `chord.yml`) call it with their `app` input
on pull request, push to `main`, and manual dispatch.

## Workflow

Every pull request, every push to `main`, and every manual dispatch runs CI:

1. dependency installation
2. TypeScript and architecture checks
3. unit and NDI tests
4. `npm run build:<app>` for the calling app (`@lumacast/cast`, `@lumacast/cloud`, `@lumacast/flux`, `@lumacast/chord`)
5. Playwright end-to-end tests (Cast only)

Only a push to `main` can release, and only when the calling app's manifest
`apps/<app>/package.json#version` is a stable `major.minor.patch` strictly
greater than its baseline (the same file before the push):

- An unchanged version stops after validation.
- A missing baseline never auto-releases. Cloud and Flux have no history, so
  their first push cannot publish. Cast falls back to the previous root
  `package.json` version left by the repository-to-apps migration.
- A downgrade or prerelease string fails the gate.
- The current version must also exceed the highest already published
  `<app>-v<version>` release. A delayed or reverted push older than the maximum
  fails instead of handing the latest slot or feed to an old version.
- An already published `<app>-v<version>` tag is a no-op for installers; the
  feed job still runs so it can heal.
- A manual dispatch is CI-only and never packages.

There is no prerelease workflow; prerelease versions fail the gate.

## Releases and feeds

All apps release from the same `IT-PSAPE/LumaCast` repository:

- Each version release is an immutable `<app>-v<version>` tag carrying raw
  installers and raw `latest*.yml` updater metadata.
- Each app owns one permanent `<app>-feed` release carrying rewritten metadata
  only. Every artifact URL is rewritten to an absolute URL on the immutable
  version release that produced it. Installers live in the version release.
- Only Cast takes the repository latest slot (`--latest=true`), preserving the
  legacy Cast GitHub updater. Cloud, Flux, and every feed release publish with
  `--latest=false`.
- The feed only moves forward. Its guard requires a published version release
  and refuses any incoming version below the highest version the feed serves.
  A partial upload that splits channel files heals by republishing the known
  version (same-version repair), never by downgrade.
- Version releases are assembled as drafts, uploaded, then published once, so a
  partial upload is never visible. The first feed is likewise created as a
  draft, uploaded, then published, so no empty visible feed ever appears.

LumaCloud reads this same release list through the GitHub Releases API to
offer installs, updates, and downgrades of every app (ADR-0044): a version is
installable only when its `<app>-v<version>` (or legacy Cast `v<version>`)
release is published, not a draft or prerelease, and carries `latest*.yml`.
Feed releases are never installable from Cloud.

## Build matrix

Every app packages Windows, macOS, and Linux with the same formula. The workflow
pins Node.js `22.13.0` and runs `electron-builder --projectDir apps/<app>`
with `--win`, `--mac`, or `--linux`.

| Runner | Output | Architecture |
| --- | --- | --- |
| `windows-latest` | NSIS installer | x64 |
| `macos-14` | DMG and ZIP | x64 |
| `ubuntu-latest` | AppImage and DEB | x64 |

Each platform uploads its installer, archive, blockmap, and `latest*.yml`
metadata under an app-specific artifact name (`release-<app>-<platform>`). The
version job combines them into one `<app>-v<version>` release.

Only Cast builds the native NDI addon (`npm run build:ndi-native`). Installer
names and the Cast product ID (`com.lumacast.app`, `LumaCast-<version>-<mac|win|linux>.<ext>`)
are unchanged.

The NDI native module loads the NDI runtime dynamically on the installed machine.
A missing runtime disables NDI output without preventing the application from starting.

The feed job needs Node.js plus `npm ci` because `tool/release-feed.mjs` parses
YAML with `js-yaml`, which is a root devDependency.

## Repository permissions

The reusable workflow defaults to `contents: read` and grants `contents: write`
only to the version-release and feed jobs. Each app wrapper grants
`contents: write` on its reusable-call job and passes `secrets: inherit` so
optional signing secrets reach packaging. The repository-level default may remain read-only.

Check the current setting with:

```bash
gh api repos/:owner/:repo/actions/permissions/workflow \
  --jq '{default_workflow_permissions, can_approve_pull_request_reviews}'
```

## macOS signing and notarization

Configure these repository secrets for a signed and notarized macOS release
(all apps share the same formula; secrets are optional):

```bash
gh secret set APPLE_CSC_LINK
gh secret set APPLE_CSC_KEY_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
```

Without them, the workflow produces unsigned macOS artifacts.

## Windows signing

Configure these repository secrets for signed Windows installers (same formula
for all apps; secrets are optional):

```bash
gh secret set WIN_CSC_LINK
gh secret set WIN_CSC_KEY_PASSWORD
```

Without them, the workflow produces unsigned Windows artifacts. Linux artifacts are unsigned.

## Cutting a release

Bump the calling app's manifest without creating a local tag:

```bash
npm version patch --workspace apps/cast --no-git-tag-version
```

Commit and merge the version increase into `main`. The pipeline creates the
`<app>-v<version>` tag and GitHub Release after validation and packaging succeed.
Do not create or push a release tag manually.

Monitor the run with:

```bash
gh run watch
```

If a release run fails after the version reaches `main`, fix the failure and
rerun the original workflow. A rerun never rebuilds an already published
version; it only heals the `<app>-feed` from the published release.

## Auto-update

Packaged builds use `electron-updater` against their app's `<app>-feed`
metadata. Cast wires the runtime updater end to end: installed builds check for
updates after launch and expose `Check for Updates…` in the native application
menu, and macOS auto-update requires a properly signed build. Cloud and Flux are
blank shells: only generic packaging and feeds are configured for them, with no
runtime updater yet.
