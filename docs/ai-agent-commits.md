# Commit and release conventions

This repo has one GitHub Actions path:

- [.github/workflows/ci-release.yml](../.github/workflows/ci-release.yml): validates pull requests and `main`, then packages and publishes a stable release only when `package.json#version` increases on `main`.

## Commit messages

- Use a short sentence-case title.
- Prefer user-facing phrasing because PR titles feed generated release notes.
- Group related work into one coherent commit when possible.

Good:

> Fix overlay stack registration loop in dialog handling

Bad:

> update files

## Version bumps

Only bump `package.json` when preparing an actual stable release.

| Change class | Bump |
| --- | --- |
| Bug fixes only | `patch` |
| Backward-compatible feature work | `minor` |
| Breaking change | `major` |

## Release process

1. Land the change through a passing PR.
2. Bump the version without creating a local tag:

```bash
npm version patch --no-git-tag-version
```

3. Commit and push the version increase to `main`. The unified workflow validates the change, builds all platforms, creates the tag, and publishes the release.
4. Watch the unified workflow:

```bash
gh run watch
```

## What the release workflow does

After validation passes and the stable version increased, the workflow:

1. verifies that `v<version>` is not already published
2. builds the native addon and application on Windows, macOS, and Linux
3. packages and uploads each platform's artifacts
4. creates `v<version>` and publishes one GitHub Release after every platform succeeds

If the version is unchanged, the workflow finishes after validation. A manual workflow dispatch retries the current version only when its release does not exist.

## Release notes

Auto-generated release notes use [.github/release.yml](../.github/release.yml). Label PRs when you want them grouped more cleanly.

## Rules for agents

- Do not bump `version` unless the human explicitly asks for release preparation.
- Do not rewrite published tags or release notes.
- Do not commit secrets.
- Do not commit generated directories such as `dist/`, `out/`, `node_modules/`, or `test-results/`.
- Prefer PRs over direct pushes to protected release branches.
