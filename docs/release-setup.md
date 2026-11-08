# Release and signing setup

All six apps share read-only validation in `.github/workflows/ci-validate.yml`.
Cast, Cloud, Flux, and Chord wrap it with `.github/workflows/ci-release.yml` for
publishing. The gating workflow, `.github/workflows/ci.yml`, runs on pull
requests, pushes to `main`, and manual dispatch; it detects affected apps
(`tool/ci/affected-apps.mjs`) and calls the appropriate workflow once per app.
Stream and Soundboard receive validation without publishing permissions.

## Workflow

Every pull request and every push to `main` runs the detector, then CI for each
affected app. A manual dispatch chooses its apps through the `apps` input
(`all`, `affected`, or a comma-separated list). Validation is
`node tool/ci/run.mjs --app <app> --e2e`, the same command that reproduces it
locally (`npm run ci -- --app <app>`):

1. dependency installation and native packages; provision and verify the selected app's pinned Electron
2. TypeScript (root plus the app workspace) and architecture checks
3. unit tests scoped to the app, its packages, and the shared tool tests; NDI tests (Cast only)
4. `npm run build:<app>` for the calling app (`cast`, `cloud`, `flux`, `chord`, `soundboard`, or `stream`)
5. Playwright end-to-end tests (Cast only)

Electron 44 installs its binary lazily when required. CI explicitly prepares the
selected app's runtime before native or end-to-end checks; Linux sandbox setup
uses the helper beside that verified binary, including app-local npm layouts.
Locally, `node tool/ci/run.mjs --app cast --only runtime` prepares just the runtime.
Native and end-to-end selections include this prerequisite automatically.

The required CI result rejects failed detection, missing application jobs, and
any selected app whose validation did not succeed. Skipped jobs are accepted
only for apps that were not selected. Stream's OS audio helpers and Zoom SDK
integrations require their separate platform checks; this shared validation
does not exercise real capture devices or provider sessions.

For release-enabled apps, a push to `main` can publish when the manifest
`apps/<app>/package.json#version` is a stable release version strictly greater
than its baseline (the same file before the push). Flux may additionally carry
a numeric build revision (`major.minor.patch+<number>`).

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
- A manual dispatch is CI-only unless `release` is checked. On `main`, that
  request may publish an unpublished version without a baseline increase;
  it still refuses versions older than the highest published release.

There is no prerelease workflow; prerelease versions fail the gate.

## Releases and feeds

Release-enabled apps publish from the same `IT-PSAPE/LumaCast` repository:

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

All six apps use Electron `44.10.2`; macOS builds require macOS 13 or newer.
The runtime requires 64-bit Windows 10 or newer, or a 64-bit Linux distribution
supported by both Chromium and its vendor. Electron 44 removes Windows `ia32`
and Linux `armv7l`; the existing x64 release matrix is unaffected. See the
[versioned platform policy](https://github.com/electron/electron/blob/v44.10.2/README.md#platform-support).
Keep every app's exact Electron dependency and Flux's explicit builder runtime
pin aligned with the root lockfile. Resolve test binaries from the app's
manifest so npm hoisting cannot select another app's runtime.

Release-enabled apps package Windows, macOS, and Linux with the same formula.
The workflow pins Node.js through `.nvmrc` and runs
`electron-builder --projectDir apps/<app>` with `--win`, `--mac`, or `--linux`.

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
only to the version-release and feed jobs. Each release-enabled app wrapper grants
`contents: write` on its reusable-call job and passes `secrets: inherit` so
optional signing secrets reach packaging. Stream and Soundboard call only the
read-only validation workflow. The repository-level default may remain read-only.

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

LumaCloud owns runtime update checks. Cast has no updater, startup check, or
manual update-check menu. Cloud discovers managed-app versions through the
release catalog and uses `electron-updater` against `cloud-feed` for itself.
Its background checks only notify; downloads and installations require explicit
user action. Cloud self-updates on macOS require a properly signed build.
Keep each app's `<app>-feed` metadata publishing: release discovery and older
shipped clients still use it. See [ADR-0116](adr/0116-cloud-update-supervision.md).
