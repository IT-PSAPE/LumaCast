# ADR-0043: Root Apps and the Per-App Release Pipeline

## Status

Accepted. Supersedes ADR-0035's versioning and release-output decisions (one
repository-root version, one GitHub Release). ADR-0035 remains accurate on the
CI mechanics it settled — one common workflow, validation, stable-only releases,
Xvfb, no updater in unpackaged builds — and those parts stand.

## Date

2026-09-26

## Context

The repository grew from one app into three. LumaCast (Cast) needed two
siblings: LumaCloud (Cloud) and LumaFlux (Flux), and the same repository now
carries all three. The single-app layout could not express that:

- The application *was* the root package. There was no place to put a second
  app, and any further shared code was either copy-pasted per app or extracted
  without a per-app dependency boundary.
- Releases were keyed on the root `package.json` version and published one
  `v<version>` GitHub Release from one workflow. Three apps cannot share a
  version: a Cloud change would force a Cast version bump, and a Cast release
  would ship Cloud's commit range.
- `electron-updater` is repository-shaped, not app-shaped. Cast's
  `electron-builder.yml` uses `provider: github`, so its updater reads the
  repository's *latest* release — which meant the single release was always
  the updater's source of truth. Cloud and Flux publishing from the same
  repository would have let a Cloud artifact reach a Cast install, and the
  generic feed metadata of one app would have pointed at another app's
  artifacts.
- Further shared code had no per-app home beyond the existing packages. A
  second app meant copy-pasting, or extracting a package anyway — but the
  root-app layout gave the extraction no per-app dependency-graph boundary:
  `app/renderer/features/*` was owned by "the app", so two apps could never
  legitimately contain the same feature name and nothing stopped a helper from
  being pulled back across an app boundary.

## Decision

- Apps move to `apps/<app>/`, one self-contained Electron app per directory:
  `apps/cast`, `apps/cloud`, `apps/flux`. Each owns its `package.json` —
  including its own `version`, which is the release version — its build config,
  and its main/renderer trees. The root package is the workspace root and is
  not a workspace member; the `workspaces` field covers `apps/*` and
  `packages/*`, and the root `package-lock.json` stays the single lockfile.
- Apps are self-contained. No app imports another app, by relative path, by
  app-scoped alias (`@renderer/…`, `@rendering/…`), or by module specifier
  (`@lumacast/<app>`, `@workspace/<app>/…`), and an app-scoped alias resolves
  inside the importing app only. No package imports an app. Everything two apps
  share belongs in a package under `packages/*`; `@lumacast/ui` is the
  presentation layer for that rule.
- Cloud and Flux start as blank apps. Management features for them are future
  work, not part of this decision.
- Cast keeps its identity: product name `LumaCast`, app id
  `com.lumacast.app`. The move is structural; it is not a new product and must
  not force a reinstall, a new signing identity, or a lost user-data path.
- Releases stay stable-only, and one common workflow does all the work:
  `.github/workflows/ci-release.yml` takes an `app` input. Each app has a thin
  wrapper — `cast.yml`, `cloud.yml`, `flux.yml` — that calls it, and a
  per-app concurrency group so two apps never interleave. The pipeline is not
  duplicated per app.
- An app releases on a `main` push only when its own manifest version is a
  stable semantic version strictly greater than its baseline, where the
  baseline is `apps/<app>/package.json` before the push. Unchanged version
  ends after validation; manual dispatch is CI-only; the current version must
  also exceed the highest published `<app>-v<version>`. Cast falls back to the
  previous root `package.json` as its baseline while the migration is in flight,
  so it keeps releasing; Cloud and Flux have no such history, so with no
  baseline their first push validates and publishes nothing.
- The version release is immutable, tagged `<app>-v<version>`, and carries the
  installers. A permanent `<app>-feed` release carries generic updater metadata
  only, with absolute URLs pointing back at the immutable version release, and
  is refreshed on every `main` push so a failed update heals.
- Only a Cast version release takes the repository's latest-release slot
  (`make_latest=true`). Every new build — Cast, Cloud, and Flux — uses
  `provider: generic` against its own `<app>-feed` release, so no new build
  resolves an update against another app's artifacts, and no feed release is
  ever the latest release. The latest slot stays Cast-only so legacy shipped
  Cast versions (`provider: github`) keep resolving.

## Consequences

A change ships when the app it affects bumps that app's version. A Cloud
commit no longer requires a Cast release, and a Cast release no longer ships
Cloud's commit range. Legacy Cast installs keep resolving through the
Cast-only latest slot, so there is no interruption for existing installs; the
latest-release slot is now a Cast invariant that a future app must not be able
to take. New builds update from their own `<app>-feed` instead.

Three release surfaces mean three sets of tags, feeds, and artifact names to
reason about, and the wrapper workflows are the only per-app code — the
decision logic stays in one place, exercised by `tests/tool/release-*.test.ts`
and the fixtures in `tool/check_electron_architecture.mjs`.

New apps cannot cross-import each other or reach into an app from a package, so
the "share by extraction" cost is now explicit at review time. The dependency
graph is per app: two apps may each have a `canvas` feature with edges in
opposite directions without a cycle, and the checker scopes feature graphs that
way.
