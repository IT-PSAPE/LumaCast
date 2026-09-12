# ADR-0035: Unified CI and Stable Release Pipeline

## Status

Accepted.

## Decision

Use one GitHub Actions workflow for validation and stable releases. Pull requests run validation only. Pushes to `main` run the same validation, then compare the current stable `package.json` version with the version before the push. An unchanged version ends successfully; an increase with no existing `v<version>` release fans out to Windows, macOS, and Linux packaging. GitHub publishes the release only after all three packages succeed.

Reject version downgrades and prerelease version strings. A manual dispatch may retry the current stable version when its release tag is absent. Keep release-note grouping in `.github/release.yml`; do not maintain a prerelease workflow.

## Consequences

Validation and release status appear in one workflow run. Release packaging cannot start before the validated commit passes, and a failed platform prevents publication. The standard runner architectures produce Windows x64, macOS x64, and Linux x64 artifacts; signing remains conditional on repository secrets.
