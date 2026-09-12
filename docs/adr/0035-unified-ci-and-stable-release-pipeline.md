# ADR-0035: Unified CI and Stable Release Pipeline

## Status

Accepted.

## Decision

Use one GitHub Actions workflow for validation and stable releases. Pull requests run validation only. Pushes to `main` run the same validation, then compare the current stable `package.json` version with the version before the push. An unchanged version ends successfully; an increase with no existing `v<version>` release fans out to Windows, macOS, and Linux packaging. GitHub publishes the release only after all three packages succeed.

Reject version downgrades and prerelease version strings. A manual dispatch may retry the current stable version when its release tag is absent. Keep release-note grouping in `.github/release.yml`; do not maintain a prerelease workflow.

## Consequences

Linux end-to-end validation requires Xvfb and a correctly installed Electron SUID sandbox helper. The validation job sets root ownership and mode `4755` on `node_modules/electron/dist/chrome-sandbox` before launch; this setup is confined to the disposable CI runner. Browser diagnostics remain enabled to expose startup failures. The existing Electron smoke and theme regression tests exercise this launch setup.

Unpackaged application launches do not initialize `electron-updater`. They can still service the manual update command with the existing installed-build explanation, but avoiding updater construction prevents Electron's Linux development version (`0.0`) from terminating end-to-end startup as invalid semver.

Validation and release status appear in one workflow run. Release packaging cannot start before the validated commit passes, and a failed platform prevents publication. The standard runner architectures produce Windows x64, macOS x64, and Linux x64 artifacts; signing remains conditional on repository secrets.
