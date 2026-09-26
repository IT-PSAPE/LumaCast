# ADR-0044: LumaCloud as the Suite Manager

## Status

Accepted. Refines ADR-0043, which left Cloud a deliberately blank app and
deferred "management features" to future work. ADR-0043's release pipeline,
tags, and feeds are unchanged and are what this decision builds on.

## Date

2026-09-26

## Context

The suite now ships three apps from one repository, each with its own
immutable `<app>-v<version>` release and `<app>-feed` updater feed
(ADR-0043). Each app can update itself, but nothing could tell a user which
suite apps exist, which are installed, which are out of date, or install one
without visiting GitHub, and nothing could move an app to an older version at
all. A hub in the style of Adobe Creative Cloud was the stated goal for
LumaCloud, and the blank shell from ADR-0043 was its placeholder.

Doing this safely has three hard constraints:

- **Identity.** Cloud must only ever install, replace, or remove software it
  can prove belongs to the suite. Every managed app is identified by its bundle
  identifier under the `com.lumacast` organization (`com.lumacast.app`,
  `com.lumacast.cloud`), with one recorded exception: Lumaflux kept its
  pre-monorepo identity `app.lumaflux.desktop` so existing installs upgrade in
  place. An installer whose bundle identity differs from the registry entry
  is not placed.
- **Integrity.** Every installer is the artifact of an immutable version
  release and is verified against the SHA-512 in that release's own
  `latest*.yml` before anything on disk is touched. Cloud never installs an
  artifact it cannot verify.
- **Consent.** Installing, replacing, removing, or launching another app is
  the user's decision, made once per app and revocable. Cloud must fail closed
  without it.

## Decision

- **`@lumacast/suite` is the renderer-safe suite model.** The package holds
  the registry of managed apps and identities, the version rules mirrored from
  `tool/release-version.mjs`, the GitHub release-catalog and updater-metadata
  parsers, installer-artifact selection per host platform and architecture,
  and the pure derivation of an app's state (not installed, up to date, update
  available, ahead, unknown). It depends on `kernel` only and imports no Node
  builtin, Electron, or React, so the Cloud renderer and main process share one
  reading of the catalog.
- **The catalog is the GitHub Releases API, read once for every app.** Cloud
  lists the repository's releases and reads each app's versions from its
  `<app>-v<version>` tags and, for Cast only, from the legacy `v<version>` tags
  that predate ADR-0043. Feed releases, drafts, prereleases, and releases
  without updater metadata are never installable. The raw list is cached in
  Cloud's user data so the hub is populated offline; a fetch failure keeps the
  cache and reports the error.
- **Installers are the release artifacts, verified by the release's own
  metadata.** For a chosen version Cloud downloads that release's
  `latest*.yml`, selects the artifact for the host (macOS zip, then dmg;
  Windows NSIS; Linux AppImage, then deb; architecture-specific names first),
  streams it while hashing, and refuses to install on a size or SHA-512
  mismatch. A downgrade is the same operation aimed at an older version; the
  catalog, not a feed, is the source of versions, because feeds only ever
  move forward.
- **Placement is a per-platform adapter behind one interface.** The
  `PlatformAdapter` seam (`apps/cloud/main/platform`) owns discovery of what
  is installed, placement, removal, and launch: macOS reads `Info.plist`
  under `/Applications` and `~/Applications` and requires the bundle
  identifier to match the registry before placing a bundle; Windows reads the
  NSIS uninstall registry keys and runs installers silently; Linux reads
  `dpkg` and the user `Applications` directory of AppImages. Elevation is
  used only when the chosen scope is not writable. Everything above the seam
  — catalog, download, verification, permissions, the operation queue, and
  IPC — is platform-neutral and unit-tested against fakes.
- **Consent is a per-app grant.** A grant records the user's explicit
  permission for Cloud to install, update, downgrade, remove, and open one
  managed identity. Main refuses all of those without a grant, so the renderer
  asks first; grants are listed and revocable in Settings. Grants can only be
  recorded for identities in the registry.
- **Cloud never installs or removes itself.** Its own entry in the hub is
  synthesized from its running version and updated through its
  `electron-updater` feed (`provider: generic`, `cloud-feed`), surfaced as
  state in the UI rather than as dialogs. The platform adapters throw on any
  request to place or remove the Cloud identity.
- **Operations are serial and observable.** One install or removal runs at
  a time; each is an operation with a status (queued, downloading, verifying,
  installing, removing, done, failed, cancelled) and progress that main pushes
  to the renderer. A queued or downloading operation can be cancelled; an
  operation that has begun placing files cannot.
- **The renderer stays sandboxed.** As in the other apps, the renderer
  reaches main only through a typed contract (`apps/cloud/shared/desktop-api.ts`)
  exposed as `window.lumacloud`, every IPC handler validates its sender and its
  arguments, and the only external destination the app will open is a GitHub
  release page.

## Consequences

Users install, update, downgrade, and remove Cast and Flux from one place, and
see at a glance which app is outdated. The version catalog is only as current
as the GitHub Releases API, which is public for this repository and
rate-limited for unauthenticated callers; the cache keeps the hub usable when
the API is unreachable, and a token can be supplied through the environment.

The legacy Cast tags remain installable until the first `cast-v<version>`
release lands, so the hub is useful before the per-app pipeline has shipped
anything. The first Cloud and Flux releases are still gated by ADR-0043's
baseline rule; until they publish, the hub shows those apps with no available
versions.

Grants are stored in Cloud's own settings and are a policy of this app, not
an operating-system permission; the OS still applies its own prompts
(Gatekeeper, UAC, `pkexec`) where it would for any installer. macOS installs
from unsigned CI artifacts are subject to Gatekeeper like any other download.

Every managed identity must be added to the registry in `@lumacast/suite`
deliberately; a fourth app is not installable until it is.
