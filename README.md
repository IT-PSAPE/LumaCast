# LumaCast Prototype

Cross-platform Electron prototype for a ProPresenter-style presentation workflow focused on reusable content, slide rendering, and NDI output.

The repository is a workspace of four apps and their shared packages:

- `apps/cast` — LumaCast, the NDI presentation app
- `apps/cloud` — LumaCloud, the suite manager: installs, updates, downgrades, and removes the other apps
- `apps/flux` — Lumaflux, the photo editor
- `apps/chord` — LumaChord, the lyric-video maker: audio plus timed lyric cues rendered and exported as video

Each app is self-contained: it ships its own main process, renderer, and
`package.json` (which owns its release version), and it shares only the
headless packages under `packages/`. No app imports another, and no package
imports an app; `tool/check_electron_architecture.mjs` enforces both.

## Stack

- Electron + TypeScript
- React
- React-Konva
- SQLite via `node:sqlite`
- Native NDI bridge in `packages/ndi-native`

## Requirements

- Node.js `22.13.0` or newer (CI pins exactly `22.13.0`)
- npm `11.6.2` or newer (`package.json#packageManager`)

For the native NDI addon build, also install the toolchain for your
platform. CI compiles and packages the addon on Windows, macOS, and Linux;
the transport tests use a mock NDI runtime. Installed applications still
need the platform NDI runtime described below.

- **Windows**: Visual Studio Build Tools with the C++
  workload, Python `3.12` or newer, and an NDI Runtime/Tools install
  providing `Processing.NDI.Lib.x64.dll`.
- **macOS**: Xcode Command Line Tools, and an NDI SDK/
  runtime install providing `libndi.dylib`.
- **Linux**: a C++17 toolchain, and an NDI SDK/runtime
  install providing `libndi.so`.

## Install

`package-lock.json` at the repository root is the only lockfile. The root
package is the workspace root; `apps/*` and `packages/*` are its members.

For local development:

```bash
npm install
```

For CI or any clean reproducible install:

```bash
npm ci
```

## Run

Start an app in development:

```bash
npm run dev:cast
npm run dev:cloud
npm run dev:flux
npm run dev:chord
```

`npm run dev` is an alias for `npm run dev:cast`.

Build production assets:

```bash
npm run build           # all four apps
npm run build:cast
npm run build:cloud
npm run build:flux
npm run build:chord
```

Preview the built renderer bundle:

```bash
npm run preview
```

## Testing

Run unit tests:

```bash
npm test
```

Run end-to-end tests:

```bash
npm run test:e2e
```

Check the architecture rules against the working tree:

```bash
npm run check:architecture
```

Run the architecture rule fixtures:

```bash
npm run test:architecture
```

`npm run test:e2e` now bootstraps itself from a fresh shell:

- builds the app
- installs the Playwright Chromium browser if needed
- starts the preview server automatically
- writes Playwright artifacts to `test-results/`

## Native NDI addon

Build the addon explicitly when you need the real NDI path:

```bash
npm run build:ndi-native
```

Clean or rebuild it:

```bash
npm run clean:ndi-native
npm run rebuild:ndi-native
```

If the addon is missing or the runtime library cannot be found, the app falls back to a no-op sender and logs a warning.

## CI and releases

- One entry point, [.github/workflows/ci.yml](.github/workflows/ci.yml), runs on every pull request and push to `main`. Its `detect` job works out which apps the change affects ([tool/ci/affected-apps.mjs](tool/ci/affected-apps.mjs): the app's own tree, any package it imports directly or transitively, or shared tooling) and calls the common pipeline, [.github/workflows/ci-release.yml](.github/workflows/ci-release.yml), once per affected app. A documentation-only change runs nothing. A manual run takes an `apps` input: `all`, `affected`, or a list such as `cast,flux`.
- CI is reproducible locally. `npm run ci -- --app cast` runs exactly the validation steps CI runs for Cast (add `--e2e` for the Playwright suite); `npm run ci:affected` runs the apps the gate would select for your diff against `origin/main`; `npm run ci:apps -- --base origin/main` only prints the selection. Use the Node version in `.nvmrc` (`nvm use`) to match CI. Only packaging for Windows and Linux needs the hosted runners.
- Releases are stable only; there is no prerelease workflow.
- A push to `main` releases an app only when that app's own `package.json` version (`apps/<app>/package.json`) is a stable semantic version **strictly greater** than its baseline. The baseline is the app manifest as it stood before the push; Cast falls back to the previous root `package.json` while the migration is in flight, and Cloud and Flux have no such history, so their first push validates and publishes nothing. A manual dispatch is CI-only. An unchanged version ends after validation.
- The version release is immutable, tagged `<app>-v<version>`, and carries the installers. A permanent `<app>-feed` release carries generic updater metadata only: its installer URLs are absolute and point at the immutable `<app>-v<version>` release that produced them.
- All three apps ship `provider: generic` against their own `<app>-feed` release. Only legacy shipped Cast versions read the repository's "latest release" slot (`provider: github`); that slot is still taken only by a Cast version release (`make_latest=true`), and no other app or feed release ever takes it.
- Cast keeps its identity through the move: product name `LumaCast`, app id `com.lumacast.app`, current version `0.1.28`.
- Release note grouping is configured in [.github/release.yml](.github/release.yml).

See [docs/ai-agent-commits.md](docs/ai-agent-commits.md) for commit and release conventions, and [docs/release-setup.md](docs/release-setup.md) for signing, packaging, and platform-support detail.

## Updater status

Installed Cast builds check for updates on startup and expose a manual `Check for Updates…` action from the native application menu, wired through `electron-updater`. New builds of every app resolve updates from their own app-isolated `<app>-feed` release via `provider: generic`, so a Cloud or Flux update can never resolve against a Cast release; only legacy shipped Cast versions read the repository's latest release directly. Cloud updates itself the same way from `cloud-feed` and shows the updater's state in its own UI; it also installs, updates, downgrades, and removes Cast and Flux from the repository's releases after a per-app permission grant (see [docs/adr/0044-lumacloud-suite-manager.md](docs/adr/0044-lumacloud-suite-manager.md)). Flux has no runtime updater, menu, or startup checks implemented yet.

## Architecture

- `apps/cast/main/`: Electron main process, IPC, and NDI integration
- `apps/cast/renderer/`: React workbench and editor surfaces
- `packages/kernel/`: dependency-free primitives shared by every package
- `packages/composition/`: the visual-document domain model and headless scene contract
- `packages/automation/`: the cue/macro/trigger model and deterministic runtime
- `packages/commands/`: shortcut and app-menu command vocabulary
- `packages/protocol/`: the versioned IPC surface, codecs, and snapshot patches
- `packages/persistence-sqlite/`: SQLite schema, migrations, and the `CastRepository` store
- `packages/engine/`: the NDI output-engine runtime and diagnostics
- `packages/playback/`: headless playback decisions
- `packages/canvas/`: the Konva render/editing layer
- `packages/ui/`: shared, domain-agnostic React UI primitives and the Tailwind theme (`@lumacast/ui/theme.css`)
- `packages/suite/`: the renderer-safe LumaCast suite model (app registry, version rules, release-catalog and updater-metadata parsing, app-state derivation) that LumaCloud renders
- `packages/markers/`: timed lyric cues (CSV/LRC/SRT parsing and formatting, timestamp helpers, format detection) shared by LumaCast's audio-sync markers and LumaChord's lyric-video import/export
- `packages/ndi-native/`: native Node-API bridge for NDI

`packages/canvas` and `packages/ui` are the only packages that may use React and
React DOM for presentation; only `packages/canvas` may additionally use Konva and
React-Konva (Electron stays banned for both). `packages/ui` depends only on
`packages/kernel`, so a shared control can never couple itself to a domain model
or to one app.

See [AGENTS.md](AGENTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layering rules and per-package charters, and [docs/adr/0043-root-apps-and-per-app-release-pipeline.md](docs/adr/0043-root-apps-and-per-app-release-pipeline.md) for the app layout and release pipeline decisions, and [docs/adr/0044-lumacloud-suite-manager.md](docs/adr/0044-lumacloud-suite-manager.md) for the LumaCloud suite manager.

## Notes

- `node:sqlite` still emits an experimental/release-candidate warning on current Node 22+ lines. That warning is expected.
- The persistence database is stored in the Electron user data path as `lumacast.sqlite`. Older installs with a `recast.sqlite` file are renamed automatically on first launch.
