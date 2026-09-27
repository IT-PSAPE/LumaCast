# ADR-0047: One CI Entry Point Gated by Affected App

## Status

Accepted. Refines ADR-0043: the per-app pipeline in `ci-release.yml` stands;
the per-app trigger wrappers (`cast.yml`, `cloud.yml`, `flux.yml`, `chord.yml`)
are replaced by one gating workflow.

## Date

2026-09-27

## Context

ADR-0043 gave every app its own workflow file, each triggered on every pull
request and every push to `main`. That made a one-line copy change in one app
start four full pipelines, and the cost grows linearly with each app the
repository gains. The validation steps were also written only in YAML, so the
suite that CI ran could not be reproduced on a laptop, and 30 test failures
accumulated unnoticed until every app's run went red on the same push.

## Decision

- **One entry point.** `.github/workflows/ci.yml` is the only workflow that
  triggers on `pull_request`, `push` to `main`, and `workflow_dispatch`. Its
  `detect` job computes the affected apps and each app's job calls
  `ci-release.yml` only when selected. Per-app concurrency groups move to those
  caller jobs, so the release guarantees of ADR-0043 are unchanged.
- **Ownership is derived, not declared.** `tool/ci/affected-apps.mjs` builds the
  app-to-package graph from the workspaces' static `@lumacast/*` imports plus
  declared workspace dependencies, closed transitively. `apps/<app>/**` and
  `tests/apps/<app>/**` select that app; `packages/<pkg>/**` and
  `tests/packages/<pkg>/**` select every app that consumes the package; shared
  tooling (root manifests and configuration, `tool/`, `scripts/`,
  `tests/tool/`, `tests/benchmarks/`, `.github/`) selects every app;
  documentation selects none; anything unclassified selects every app.
- **Baseline.** A push diffs from the head of the last successful push run of
  the workflow on the branch, so an app whose previous run failed is retried by
  the next push even when that push does not touch it. A pull request diffs from
  its base branch. Without a usable baseline every app runs.
- **Manual override.** A manual dispatch takes an `apps` input: `all`
  (default), a comma-separated list, or `affected`. This is the escape hatch
  when a shared change is known to matter to specific apps only.
- **One definition of "CI passes".** `tool/ci/run.mjs` runs the validation
  steps — typecheck, architecture checks, unit tests scoped to the app and its
  packages, Cast's native NDI tests, the app build, and Cast's end-to-end suite
  — and `ci-release.yml` calls it. `npm run ci -- --app <app>` reproduces a
  CI run locally; `npm run ci:affected` runs what the gate would select for
  the current diff against `origin/main`. `.nvmrc` pins the CI Node version so
  local runs share it.

## Consequences

- A change scoped to one app runs one pipeline; a shared-package change runs
  only its consumers; a documentation change runs nothing but the detector.
- Branch protection can require the single `CI result` job, which is green
  when every selected app passed and when nothing was selected.
- Adding an app means adding one `apps/<app>` workspace and one caller job in
  `ci.yml`; detection needs no configuration.
- Unit tests are run per app rather than once per push. A package test runs
  in every consumer's job, which is redundant but keeps each app's job
  self-sufficient and its result meaningful on its own.
- Packaging for Windows and Linux still needs the hosted runners; everything
  before packaging runs identically on a developer machine.
