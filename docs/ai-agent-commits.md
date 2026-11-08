# Commit and release conventions

This repo has one GitHub Actions path:

- [.github/workflows/ci.yml](../.github/workflows/ci.yml) selects affected apps for validation. Cast, Cloud, Flux, and Chord use the release pipeline; Stream and Soundboard validate without publishing. A stable increase in an eligible app's manifest version on `main` can publish a release. Manual runs validate by default and publish only when `release` is checked.

## Commit messages

- Use a short sentence-case title.
- Prefer user-facing phrasing because PR titles feed generated release notes.
- Group related work into one coherent commit when possible.

Good:

> Fix overlay stack registration loop in dialog handling

Bad:

> update files

## Version bumps

Only bump `apps/<app>/package.json` when preparing an actual stable release.

| Change class | Bump |
| --- | --- |
| Bug fixes only | `patch` |
| Backward-compatible feature work | `minor` |
| Breaking change | `major` |

## Release process

1. Land the change through a passing PR.
2. Bump the selected release app's version without creating a local tag. For Cast:

```bash
npm version patch --workspace apps/cast --no-git-tag-version
```

3. Commit and push the version increase to `main`. The unified workflow validates the change, builds all platforms, creates the tag, and publishes the release.
4. Watch the unified workflow:

```bash
gh run watch
```

## What the release workflow does

After validation passes and the stable version increased, the workflow:

1. verifies that `<app>-v<version>` is unpublished and newer than the highest published version
2. builds the application on Windows, macOS, and Linux, including the native NDI addon for Cast
3. packages and uploads each platform's artifacts
4. creates `<app>-v<version>` and publishes its GitHub Release after every platform succeeds, then updates the app's `<app>-feed` metadata

An unchanged version on a push finishes after validation. A manual dispatch with `release` checked on `main` can publish an unpublished eligible version without a baseline increase; it must still exceed the highest published version. See [release setup](release-setup.md) for the complete gate and signing policy.

## Release notes

Auto-generated release notes use [.github/release.yml](../.github/release.yml). Label PRs when you want them grouped more cleanly.

## Rules for agents

- Do not bump `version` unless the human explicitly asks for release preparation.
- Do not rewrite published tags or release notes.
- Do not commit secrets.
- Do not commit generated directories such as `dist/`, `out/`, `node_modules/`, or `test-results/`.
- Prefer PRs over direct pushes to protected release branches.
