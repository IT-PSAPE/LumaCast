# ADR-0048: Requested Manual Releases

## Status

Accepted. Amends ADR-0043's trigger rule that a manual dispatch is CI-only, and
extends ADR-0047's manual override with a `release` input. Every other release
rule of ADR-0043 stands.

## Date

2026-09-27

## Context

ADR-0043 releases an app only when a `main` push raises its manifest version
above the version before that push. When that push's run fails before the
release gate (Flux 0.11.1: a stale test failed validation), the fix lands in a
later push whose baseline already carries the new version, so the gate reports
`version-unchanged` and the version is never built or released. The only way
out was a throwaway version bump.

## Decision

- A manual dispatch of `ci.yml` takes a `release` boolean input, default
  `false`. `ci.yml` passes it to `ci-release.yml` only for a
  `workflow_dispatch`; every other event passes `false`.
- Without `release`, a manual dispatch stays CI-only (`manual-ci-only`).
- With `release`, on `main`, the release gate and the update feed run as for a
  push. `tool/release-version.mjs` releases the current manifest version with
  reason `manual-release` without requiring a baseline increase, but still
  refuses an invalid version, skips a version already published
  (`tag-exists`), and fails a version older than the highest published
  `<app>-v<version>`.
- The `apps` input selects which apps a requested release covers, so
  `apps=flux, release=true` releases Flux alone.

## Consequences

- A version stranded by a failed push is released by one manual dispatch
  instead of a synthetic bump.
- Re-dispatching a requested release is a no-op per app whose version is
  already published, and the feed job still heals a stale feed.
- A plain manual CI run can never publish by accident; releasing requires
  checking `release` and running on `main`.
